/**
 * Browser test: real Chrome drives the real Next.js app (dev server) against the local anvil fork.
 * An injected EIP-1193 wallet signs with local keys, so every button that sends a transaction or asks for a
 * signature (EIP-712 and personal_sign) runs the same code path a MetaMask user would hit.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { execSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hexToString, isHex, type Hex } from "viem";

import { RPC, USDC, chain, deployEscrow, escrowFullAbi, events, newActor, now, pc, rpc, send, setUsdc, type Actor } from "./harness";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 3112;
const BASE = `http://127.0.0.1:${PORT}`;
const DAY = 86400;
const usdcAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

let server: ChildProcess;
let browser: Browser;
let page: Page;
let pg: PGlite;
let pgServer: PGLiteSocketServer;
let escrow: `0x${string}`;
let current: Actor; // whoever the injected wallet currently is
let feeTo: Actor, client: Actor, freelancer: Actor, payout: Actor;
let agentId: bigint;

const bal = (a: string) => pc.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a as never] }) as Promise<bigint>;

/** What the page's `window.ethereum.request` calls into. */
async function wallet(method: string, params: unknown[]): Promise<unknown> {
  const a = current;
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [a.address];
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "eth_sendTransaction": {
      const t = params[0] as { to: `0x${string}`; data?: Hex; gas?: Hex; value?: Hex };
      return a.wallet.sendTransaction({
        account: a.account, chain, to: t.to, data: t.data, gas: t.gas ? BigInt(t.gas) : undefined, value: t.value ? BigInt(t.value) : undefined,
      } as never);
    }
    case "eth_signTypedData_v4": {
      const td = JSON.parse(params[1] as string) as { domain: object; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };
      const { EIP712Domain: _drop, ...types } = td.types;
      void _drop;
      // JSON turns uint/int into strings; viem wants bigint
      const message = Object.fromEntries(
        Object.entries(td.message).map(([k, v]) => {
          const t = td.types[td.primaryType].find((f) => f.name === k)?.type ?? "";
          return [k, /^u?int/.test(t) ? BigInt(v as string) : v];
        }),
      );
      const domain = { ...td.domain, chainId: Number((td.domain as { chainId: number }).chainId) };
      return a.account.signTypedData({ domain, types, primaryType: td.primaryType, message } as never);
    }
    case "personal_sign": {
      const raw = params[0] as string;
      return a.account.signMessage({ message: isHex(raw) ? hexToString(raw) : raw });
    }
    default:
      return rpc(method, params);
  }
}

async function as(who: Actor, url: string) {
  current = who;
  await page.goto(`${BASE}${url}`);
}
const pill = (text: string) => page.locator(`.pill:text-is("${text}")`).waitFor({ timeout: 45_000 });
const clickBtn = (text: string | RegExp) => page.getByRole("button", { name: text }).click();
/** Gated pages (/me, /jobs/new) ask for one SIWE signature; the session cookie is per wallet, so re-sign when the actor changes. */
const gate = async () => {
  const b = page.getByRole("button", { name: "Sign in with MetaMask" });
  if (await b.waitFor({ timeout: 8_000 }).then(() => true, () => false)) await b.click();
  await page.getByRole("button", { name: "Sign in with MetaMask" }).waitFor({ state: "detached" });
};

beforeAll(async () => {
  const deployer = await newActor("deployer");
  [feeTo, client, freelancer, payout] = await Promise.all([newActor("feeTo"), newActor("client"), newActor("freelancer"), newActor("payout")]);
  void payout;
  await setUsdc(client.address, 500_000_000n);

  const ids = (await import("../../../deployments/10143.json")).default as unknown as Record<string, string>;
  escrow = await deployEscrow(deployer, [USDC, ids.receiptRouter, ids.groundedReputation, ids.erc8004Identity, feeTo.address, 500n, BigInt(7 * DAY)]);

  pg = new PGlite();
  await pg.exec(fs.readFileSync(path.resolve(import.meta.dirname, "../db/schema.sql"), "utf8"));
  pgServer = new PGLiteSocketServer({ db: pg, port: 55432, host: "127.0.0.1", maxConnections: 10 });
  await pgServer.start();

  const webDir = path.resolve(import.meta.dirname, "..");
  // NEXT_PUBLIC_* are inlined at build time, so build after the escrow is deployed; this is the bundle that ships
  const env = {
    ...process.env,
    NEXT_PUBLIC_RPC_URL: RPC,
    NEXT_PUBLIC_CHAIN_ID: "10143",
    NEXT_PUBLIC_GIG_ESCROW: escrow,
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:55432/postgres",
    DB_POOL_MAX: "1", // the in-process test database serves one connection
    SESSION_SECRET: "ui-test-session-secret", // production builds refuse to run without one
  };
  const next = path.join(webDir, "node_modules/next/dist/bin/next");
  const built = spawnSync(process.execPath, [next, "build"], { cwd: webDir, env, encoding: "utf8" });
  if (built.status !== 0) throw new Error("next build failed:\n" + (built.stdout + built.stderr).slice(-2000));
  const log = fs.openSync(path.join(webDir, "tests/.server.log"), "w");
  server = spawn(process.execPath, [next, "start", "-p", String(PORT)], { cwd: webDir, env, stdio: ["ignore", log, log] });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("next start did not come up");
    await new Promise((r) => setTimeout(r, 1000));
  }

  browser = await chromium.launch({ executablePath: CHROME, headless: true });
  page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(30_000);
  await page.exposeFunction("__wallet", wallet);
  await page.addInitScript(() => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: ({ method, params }: { method: string; params?: unknown[] }) =>
        (window as unknown as { __wallet: (m: string, p: unknown[]) => Promise<unknown> }).__wallet(method, params ?? []),
      on() {},
      removeListener() {},
    };
  });
  page.on("console", (m) => { if (m.type() === "error") console.log("[browser]", m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "https://example.com/delivered-work" : undefined));
}, 300_000);

afterAll(async () => {
  await browser?.close();
  if (server?.pid) {
    try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" }); } catch {}
  }
  await pgServer?.stop();
  await pg?.close();
});

describe("freelancer onboarding in the UI", () => {
  it("registers an identity and sets the payout wallet through /me", async () => {
    await as(freelancer, "/me");
    await page.getByRole("button", { name: /^0x/ }).waitFor(); // wallet auto-connected
    await gate();
    await clickBtn("Register");
    await page.locator("p.muted", { hasText: "Done." }).waitFor({ timeout: 45_000 }); // the page's own success message
    agentId = BigInt(await page.locator('label:text-is("Agent id") + input').inputValue());

    // the payout wallet signs itself, so make the connected wallet the payout wallet (the UI enforces this)
    await clickBtn("Set payout wallet");
    await expect
      .poll(async () =>
        (await pc.readContract({
          address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
          abi: [{ type: "function", name: "getAgentWallet", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] }],
          functionName: "getAgentWallet",
          args: [agentId],
        })) as string,
      { timeout: 60_000 })
      .toBe(freelancer.address);
  });
});

describe("full job through the browser", () => {
  const TITLE = "Brand logo";

  it("client posts and funds a job from /jobs/new (approve + create + save text)", async () => {
    await as(client, "/jobs/new");
    await gate();
    await page.locator('label:text-is("Title") + input').fill(TITLE);
    await page.locator('label:text-is("Description") + textarea').fill("Three concepts, vector files.");
    await page.locator("#job-budget").fill("20");
    await clickBtn("Fund and post");
    await page.waitForURL(/\/jobs\/1$/);
    await pill("Funded");
    await page.getByText("20.00 USDC").waitFor();
    expect(await bal(escrow)).toBe(21_000_000n); // 20 + 5% fee
    // the offchain text was accepted only because its hash matches the onchain metaHash
    await page.getByRole("heading", { name: new RegExp(TITLE) }).waitFor();
  });

  it("the job list and the freelancer profile render live data", async () => {
    await as(client, "/jobs");
    await page.getByText(TITLE).first().waitFor();
    await as(client, `/freelancers/${agentId}`);
    await page.getByRole("heading").first().waitFor();
  });

  it("freelancer sends a signed proposal, then accepts, then delivers", async () => {
    await as(freelancer, "/jobs/1");
    await page.locator('label:text-is("Your ERC-8004 agent id") + input').fill(String(agentId));
    await page.getByText("Meets the bar.").waitFor();
    await page.getByRole("textbox").last().fill("I have designed 30 logos.");
    await clickBtn("Sign & send proposal");
    await page.getByText("Proposals (ranked by grounded reputation)").waitFor();
    await page.locator("div.muted", { hasText: "I have designed 30 logos." }).waitFor();

    await clickBtn("Accept job (onchain)");
    await pill("Accepted");
    await clickBtn("Mark delivered (freelancer)");
    await pill("Delivered");
  });

  it("client releases with a signed authorization: freelancer paid, fee taken, receipt shown", async () => {
    const before = await bal(freelancer.address);
    await as(client, "/jobs/1");
    await clickBtn(/Release payment/);
    await pill("Released");
    expect((await bal(freelancer.address)) - before).toBe(20_000_000n);
    expect(await bal(feeTo.address)).toBe(1_000_000n);
    expect(await bal(escrow)).toBe(0n);
    // rating box appears, and explains why it can't run off the Grounded domain
    await page.getByText("Rate this freelancer").waitFor();
    await page.getByText(/Passkeys are bound to/).waitFor();
  });
});

describe("dispute through the browser", () => {
  it("client disputes, freelancer offers a settlement, client accepts it and gets a receipt", async () => {
    // set up a delivered job directly; the UI part under test starts at the dispute
    await send(client, { address: USDC, abi: [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [escrow, 2n ** 200n] });
    const rc = await send(client, {
      address: escrow, abi: escrowFullAbi, functionName: "create",
      args: [10_000_000n, 0, 0, BigInt((await now()) + 2 * DAY), 3 * DAY, "0x0000000000000000000000000000000000000000", "0x" + "00".repeat(32)],
    });
    const jobId = events<{ jobId: bigint }>(rc, "JobCreated")[0].jobId;
    await send(freelancer, { address: escrow, abi: escrowFullAbi, functionName: "accept", args: [jobId, agentId] });
    await send(freelancer, { address: escrow, abi: escrowFullAbi, functionName: "deliver", args: [jobId, "0x" + "11".repeat(32)] });

    await as(client, `/jobs/${jobId}`);
    await clickBtn("Dispute delivery");
    await pill("Disputed");

    await as(freelancer, `/jobs/${jobId}`);
    await page.getByPlaceholder("USDC you'll settle for").fill("4");
    await clickBtn("Offer settlement (freelancer)");
    await page.getByText(/Freelancer's offer:/).waitFor();

    const wBefore = await bal(freelancer.address);
    const cBefore = await bal(client.address);
    await as(client, `/jobs/${jobId}`);
    await clickBtn(/Accept offer/);
    await pill("Resolved");
    expect((await bal(freelancer.address)) - wBefore).toBe(4_000_000n);
    // client gets back 6 USDC plus the unused fee: 0.5 - 5% of 4 = 0.3
    expect((await bal(client.address)) - cBefore).toBe(6_300_000n);
  });
});
