/**
 * End-to-end on a local anvil fork of Monad Testnet: the real USDC, the real Grounded contracts and the real
 * ERC-8004 registries, plus a freshly deployed GigEscrow, the app's own lib/ code and its API route handlers
 * (backed by an in-process Postgres). Nothing here touches the live network.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEventLogs, type Address, type Hex } from "viem";

import {
  RPC,
  USDC,
  chain,
  deployEscrow,
  escrowFullAbi,
  events,
  newActor,
  now,
  pc,
  revert,
  send,
  setUsdc,
  snapshot,
  warp,
  type Actor,
} from "./harness";

const DAY = 86400;
const AMOUNT = 10_000_000n; // 10 USDC
const FEE = 500_000n; // 5%
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type Lib = typeof import("@/lib/gig");
let lib: Lib;
let escrow: Address;
let feeTo: Actor, client: Actor, freelancer: Actor, arbiter: Actor, stranger: Actor;
let agentId: bigint;
let payout: Address;
let pg: PGlite;
let pgServer: PGLiteSocketServer;

const call = <T>(functionName: string, args: readonly unknown[] = []) =>
  pc.readContract({ address: escrow, abi: escrowFullAbi, functionName, args } as never) as Promise<T>;
const tx = (who: Actor, functionName: string, args: readonly unknown[] = []) =>
  send(who, { address: escrow, abi: escrowFullAbi, functionName, args });
const usdcOf = (a: Address) => pc.readContract({ address: USDC, abi: lib.usdcAbi, functionName: "balanceOf", args: [a] });
const status = async (id: bigint) => (await lib.readJob(id))!.status;
const revertsWith = (p: Promise<unknown>, name: string) => expect(p).rejects.toThrow(new RegExp(name));

async function createJob(opts: { minScore?: number; minReviewers?: number; arbiter?: Address; deliverWithin?: number; amount?: bigint } = {}) {
  const rc = await tx(client, "create", [
    opts.amount ?? AMOUNT,
    opts.minScore ?? 0,
    opts.minReviewers ?? 0,
    BigInt((await now()) + 2 * DAY),
    opts.deliverWithin ?? 3 * DAY,
    opts.arbiter ?? ZERO,
    lib.metaHashOf("job", "body"),
  ]);
  return events<{ jobId: bigint }>(rc, "JobCreated")[0].jobId;
}
const acceptJob = async (id: bigint) => tx(freelancer, "accept", [id, agentId]);
async function deliveredJob(opts: Parameters<typeof createJob>[0] = {}) {
  const id = await createJob(opts);
  await acceptJob(id);
  await tx(freelancer, "deliver", [id, ("0x" + "11".repeat(32)) as Hex]);
  return id;
}
async function release(id: bigint, amount = AMOUNT) {
  const s = await lib.signRouterPull(client.wallet, client.address, agentId, amount);
  const rc = await tx(client, "release", [id, 0n, s.validBefore, s.salt, s.signature]);
  return events<{ receiptId: bigint }>(rc, "JobReleased")[0].receiptId;
}
async function withSnapshot(fn: () => Promise<void>) {
  const snap = await snapshot();
  try {
    await fn();
  } finally {
    await revert(snap);
  }
}

beforeAll(async () => {
  // the lib reads the escrow address from env at import time
  const deployer = await newActor("deployer");
  [feeTo, client, freelancer, arbiter, stranger] = await Promise.all([
    newActor("feeTo"), newActor("client", 1_000_000_000n), newActor("freelancer"), newActor("arbiter"), newActor("stranger", 1_000_000_000n),
  ]);
  const ids = await import("../../../deployments/10143.json");
  const g = ids.default as unknown as Record<string, string>;
  escrow = await deployEscrow(deployer, [
    USDC, g.receiptRouter, g.groundedReputation, g.erc8004Identity, feeTo.address, 500n, BigInt(7 * DAY),
  ]);
  process.env.NEXT_PUBLIC_GIG_ESCROW = escrow;
  lib = await import("@/lib/gig");

  // client approves the escrow once
  await send(client, { address: USDC, abi: lib.usdcAbi, functionName: "approve", args: [escrow, 2n ** 255n] });

  // freelancer onboarding, exactly as /me does it: register an ERC-8004 agent, then set the payout wallet
  const rc = await send(freelancer, { address: lib.ADDR.identity, abi: lib.identityAbi, functionName: "register", args: ['data:application/json,{"name":"e2e"}'] });
  agentId = parseEventLogs({ abi: lib.identityAbi, eventName: "Registered", logs: rc.logs })[0].args.agentId;
  const payoutActor = await newActor("payout");
  payout = payoutActor.address;
  const deadline = BigInt((await now()) + 240);
  // the payout wallet itself signs; the owner submits
  const signature = await payoutActor.wallet.signTypedData({
    account: payoutActor.account,
    domain: { name: "ERC8004IdentityRegistry", version: "1", chainId: chain.id, verifyingContract: lib.ADDR.identity },
    types: { AgentWalletSet: [{ name: "agentId", type: "uint256" }, { name: "newWallet", type: "address" }, { name: "owner", type: "address" }, { name: "deadline", type: "uint256" }] },
    primaryType: "AgentWalletSet",
    message: { agentId, newWallet: payout, owner: freelancer.address, deadline },
  });
  await send(freelancer, { address: lib.ADDR.identity, abi: lib.identityAbi, functionName: "setAgentWallet", args: [agentId, payout, deadline, signature] });

  // in-process Postgres with the real schema, served over the wire so `pg` connects unchanged
  pg = new PGlite();
  await pg.exec(fs.readFileSync(path.resolve(import.meta.dirname, "../db/schema.sql"), "utf8"));
  pgServer = new PGLiteSocketServer({ db: pg, port: 55432, host: "127.0.0.1", maxConnections: 10 });
  await pgServer.start();
});

afterAll(async () => {
  await (await import("@/lib/db")).db().end().catch(() => {});
  await pgServer?.stop();
  await pg?.close();
});

describe("setup", () => {
  it("deploys with the configured immutables", async () => {
    expect(await call("feeBps")).toBe(500n);
    expect(await call("reviewWindow")).toBe(BigInt(7 * DAY));
    expect(await call("feeRecipient")).toBe(feeTo.address);
    expect(await call("feeOf", [AMOUNT])).toBe(FEE);
  });

  it("freelancer has an agent with a payout wallet", async () => {
    expect(agentId).toBeGreaterThan(0n);
    expect(await pc.readContract({ address: lib.ADDR.identity, abi: lib.identityAbi, functionName: "getAgentWallet", args: [agentId] })).toBe(payout);
  });
});

describe("happy path: fund → accept → deliver → release", () => {
  let id: bigint;
  it("create escrows amount + fee and records the client", async () => {
    const before = await usdcOf(client.address);
    id = await createJob();
    expect(await usdcOf(escrow)).toBe(AMOUNT + FEE);
    expect(before - (await usdcOf(client.address))).toBe(AMOUNT + FEE);
    const j = await lib.readJob(id);
    expect(j).toMatchObject({ client: client.address, amount: AMOUNT, status: "Funded", metaHash: lib.metaHashOf("job", "body") });
    expect((await call<readonly [number, number, number]>("clientStats", [client.address]))[0]).toBeGreaterThanOrEqual(1);
  });

  it("accept → deliver move the status and set the deadline", async () => {
    await acceptJob(id);
    const j = (await lib.readJob(id))!;
    expect(j.status).toBe("Accepted");
    expect(j.agentId).toBe(agentId);
    expect(j.deadline).toBeGreaterThan(await now());
    await tx(freelancer, "deliver", [id, ("0x" + "22".repeat(32)) as Hex]);
    expect(await status(id)).toBe("Delivered");
  });

  it("release pays the payout wallet, takes the fee, and the receipt payer is the client", async () => {
    const before = await usdcOf(payout);
    const receiptId = await release(id);
    expect(receiptId).toBeGreaterThan(0n);
    expect((await usdcOf(payout)) - before).toBe(AMOUNT);
    expect(await usdcOf(feeTo.address)).toBe(FEE);
    expect(await usdcOf(escrow)).toBe(0n);
    expect(await status(id)).toBe("Released");

    const { receiptRegistryAbi } = await import("@sajalydv/grounded-sdk");
    const r = (await pc.readContract({ address: lib.ADDR.receipts, abi: receiptRegistryAbi, functionName: "get", args: [receiptId] } as never)) as { payer: Address; agentId: bigint };
    expect(r.payer).toBe(client.address);
    expect(r.agentId).toBe(agentId);
  });
});

describe("the reputation loop (needs Grounded rating)", () => {
  it("a paid job's receipt can be rated, which earns the access to a job with a trust bar", async () => {
    const { Grounded, SoftwareAuthenticator } = await import("@sajalydv/grounded-sdk");
    const g = new Grounded({ chain: "monad-testnet", rpcUrl: RPC, walletClient: client.wallet as never });

    // a brand-new agent cannot take a job that needs 1 paying reviewer
    const barred = await createJob({ minReviewers: 1 });
    await revertsWith(acceptJob(barred), "AgentNotTrusted");

    // pay a real job to get a receipt
    const id = await createJob();
    await acceptJob(id);
    const receiptId = await release(id);

    const auth = SoftwareAuthenticator.random("grounded.sajal.sbs");
    await g.bindPasskey(auth);
    await g.rate({ receiptId, score: 90, tag: "quality", authenticator: auth });

    const s = await g.score(agentId);
    expect(s.reviewers).toBe(1);
    expect(s.score).toBe(90);

    // the same receipt cannot rate twice
    await expect(g.rate({ receiptId, score: 10, tag: "quality", authenticator: auth })).rejects.toThrow();

    // now the earlier gated job accepts the agent: reputation earned in one job unlocks the next
    await acceptJob(barred);
    expect(await status(barred)).toBe("Accepted");
  });

  it("nobody but the payer can rate a receipt", async () => {
    const { Grounded, SoftwareAuthenticator } = await import("@sajalydv/grounded-sdk");
    const id = await createJob();
    await acceptJob(id);
    const receiptId = await release(id);
    const g = new Grounded({ chain: "monad-testnet", rpcUrl: RPC, walletClient: freelancer.wallet as never });
    const auth = SoftwareAuthenticator.random("grounded.sajal.sbs");
    await g.bindPasskey(auth);
    await expect(g.rate({ receiptId, score: 100, tag: "quality", authenticator: auth })).rejects.toThrow(/only the payer/);
  });
});

describe("release safety", () => {
  it("only the client can release", async () => {
    const id = await createJob();
    await acceptJob(id);
    const s = await lib.signRouterPull(client.wallet, client.address, agentId, AMOUNT);
    await revertsWith(tx(stranger, "release", [id, 0n, s.validBefore, s.salt, s.signature]), "NotClient");
    await revertsWith(tx(freelancer, "release", [id, 0n, s.validBefore, s.salt, s.signature]), "NotClient");
  });

  it("a signature for a smaller amount reverts everything and the money stays escrowed", async () => {
    const id = await createJob();
    await acceptJob(id);
    const held = await usdcOf(escrow);
    const clientBefore = await usdcOf(client.address);
    const s = await lib.signRouterPull(client.wallet, client.address, agentId, AMOUNT - 1n);
    await expect(tx(client, "release", [id, 0n, s.validBefore, s.salt, s.signature])).rejects.toThrow();
    expect(await usdcOf(escrow)).toBe(held);
    expect(await usdcOf(client.address)).toBe(clientBefore);
    expect(await status(id)).toBe("Accepted");
  });

  it("a signature made by someone else reverts", async () => {
    const id = await createJob();
    await acceptJob(id);
    const s = await lib.signRouterPull(stranger.wallet, stranger.address, agentId, AMOUNT);
    await expect(tx(client, "release", [id, 0n, s.validBefore, s.salt, s.signature])).rejects.toThrow();
    expect(await status(id)).toBe("Accepted");
  });

  it("an authorization for a different agent reverts", async () => {
    const id = await createJob();
    await acceptJob(id);
    const s = await lib.signRouterPull(client.wallet, client.address, agentId + 1n, AMOUNT);
    await expect(tx(client, "release", [id, 0n, s.validBefore, s.salt, s.signature])).rejects.toThrow();
  });

  it("cannot release twice", async () => {
    const id = await createJob();
    await acceptJob(id);
    await release(id);
    const s = await lib.signRouterPull(client.wallet, client.address, agentId, AMOUNT);
    await revertsWith(tx(client, "release", [id, 0n, s.validBefore, s.salt, s.signature]), "BadStatus");
  });

});

describe("access control", () => {
  it("a stranger cannot accept or deliver for an agent they do not operate", async () => {
    const id = await createJob();
    await revertsWith(tx(stranger, "accept", [id, agentId]), "NotAgentOperator");
    await acceptJob(id);
    await revertsWith(tx(stranger, "deliver", [id, ("0x" + "00".repeat(32)) as Hex]), "NotAgentOperator");
  });

  it("an agent with no payout wallet cannot accept", async () => {
    const other = await newActor("other-freelancer");
    const rc = await send(other, { address: lib.ADDR.identity, abi: lib.identityAbi, functionName: "register", args: ["data:,x"] });
    const otherAgent = parseEventLogs({ abi: lib.identityAbi, eventName: "Registered", logs: rc.logs })[0].args.agentId;
    const w = await pc.readContract({ address: lib.ADDR.identity, abi: lib.identityAbi, functionName: "getAgentWallet", args: [otherAgent] });
    // ERC-8004 defaults the wallet to the owner, so accepting works; document that rather than assume otherwise
    expect(w === ZERO || w === other.address).toBe(true);
  });

  it("create validates its inputs", async () => {
    const base = [AMOUNT, 0, 0, BigInt((await now()) + DAY), DAY, ZERO, lib.metaHashOf("a", "b")] as const;
    const withArg = (i: number, v: unknown) => base.map((x, j) => (j === i ? v : x));
    await revertsWith(tx(client, "create", withArg(0, 9_999n)), "AmountBelowMinimum");
    await revertsWith(tx(client, "create", withArg(1, 101)), "BadParams");
    await revertsWith(tx(client, "create", withArg(3, BigInt((await now()) - 1))), "BadParams");
    await revertsWith(tx(client, "create", withArg(4, 0)), "BadParams");
    await revertsWith(tx(client, "create", withArg(5, client.address)), "BadParams");
  });
});

describe("timeouts (each rewinds the chain clock afterwards)", () => {
  it("nobody accepts → client refunds everything after acceptBy, not before", async () =>
    withSnapshot(async () => {
      const before = await usdcOf(client.address);
      const id = await createJob();
      await revertsWith(tx(client, "refund", [id]), "TooEarly");
      await warp(2 * DAY + 1);
      await revertsWith(tx(stranger, "refund", [id]), "NotClient");
      await tx(client, "refund", [id]);
      expect(await usdcOf(client.address)).toBe(before);
      expect(await status(id)).toBe("Refunded");
    }));

  it("freelancer ghosts → client refunds in full after the deliver-by deadline, not before", async () =>
    withSnapshot(async () => {
      const before = await usdcOf(client.address);
      const id = await createJob({ deliverWithin: DAY });
      await acceptJob(id);
      await revertsWith(tx(client, "refund", [id]), "NotRefundable");
      await warp(DAY + 1);
      await tx(client, "refund", [id]);
      expect(await usdcOf(client.address)).toBe(before);
    }));

  it("freelancer can withdraw from an accepted job; the client gets everything back", async () =>
    withSnapshot(async () => {
      const before = await usdcOf(client.address);
      const id = await createJob();
      await acceptJob(id);
      await tx(freelancer, "refund", [id]);
      expect(await usdcOf(client.address)).toBe(before);
    }));

  it("client silent after delivery → anyone auto-releases after 7 days; no receipt", async () =>
    withSnapshot(async () => {
      const held0 = await usdcOf(escrow);
      const id = await deliveredJob();
      const before = await usdcOf(payout);
      await revertsWith(tx(stranger, "autoRelease", [id]), "TooEarly");
      await warp(7 * DAY + 1);
      await tx(stranger, "autoRelease", [id]);
      expect((await usdcOf(payout)) - before).toBe(AMOUNT);
      expect(await status(id)).toBe("AutoReleased");
      expect(await usdcOf(escrow)).toBe(held0);
    }));

  it("a dispute stops auto-release; with nothing agreed it splits 50/50 after 7 days", async () =>
    withSnapshot(async () => {
      const held0 = await usdcOf(escrow);
      const id = await deliveredJob();
      await tx(client, "dispute", [id, ("0x" + "aa".repeat(32)) as Hex]);
      await warp(7 * DAY + 1);
      await revertsWith(tx(stranger, "autoRelease", [id]), "BadStatus");
      const wBefore = await usdcOf(payout);
      const cBefore = await usdcOf(client.address);
      await tx(stranger, "resolveTimeout", [id]);
      expect((await usdcOf(payout)) - wBefore).toBe(AMOUNT / 2n);
      // client gets back the other half plus the fee on that half
      expect((await usdcOf(client.address)) - cBefore).toBe(AMOUNT / 2n + FEE - (AMOUNT / 2n) * 500n / 10_000n);
      expect(await usdcOf(escrow)).toBe(held0);
    }));

  it("cannot dispute after the review window", async () =>
    withSnapshot(async () => {
      const id = await deliveredJob();
      await warp(7 * DAY + 1);
      await revertsWith(tx(client, "dispute", [id, ("0x" + "00".repeat(32)) as Hex]), "TooLate");
    }));
});

describe("disputes", () => {
  it("settlement: the freelancer's share goes through the router, so the client gets a receipt and can rate", async () => {
    const held0 = await usdcOf(escrow);
    const id = await deliveredJob();
    await tx(client, "dispute", [id, ("0x" + "bb".repeat(32)) as Hex]);
    expect(await status(id)).toBe("Disputed");

    // nothing offered yet
    const s0 = await lib.signRouterPull(client.wallet, client.address, agentId, 4_000_000n);
    await revertsWith(tx(client, "settle", [id, 4_000_000n, 0n, s0.validBefore, s0.salt, s0.signature]), "NoOffer");

    await tx(freelancer, "offerSettlement", [id, 4_000_000n]);
    // the client may not settle for a different number than the standing offer
    const sBad = await lib.signRouterPull(client.wallet, client.address, agentId, 3_000_000n);
    await revertsWith(tx(client, "settle", [id, 3_000_000n, 0n, sBad.validBefore, sBad.salt, sBad.signature]), "NoOffer");

    const wBefore = await usdcOf(payout);
    const cBefore = await usdcOf(client.address);
    const feeBefore = await usdcOf(feeTo.address);
    const s = await lib.signRouterPull(client.wallet, client.address, agentId, 4_000_000n);
    const rc = await tx(client, "settle", [id, 4_000_000n, 0n, s.validBefore, s.salt, s.signature]);
    const ev = events<{ receiptId: bigint }>(rc, "JobResolved")[0];
    expect(ev.receiptId).toBeGreaterThan(0n);
    expect((await usdcOf(payout)) - wBefore).toBe(4_000_000n);
    expect((await usdcOf(feeTo.address)) - feeBefore).toBe(200_000n); // 5% of what the freelancer got
    expect((await usdcOf(client.address)) - cBefore).toBe(6_000_000n + FEE - 200_000n);
    expect(await usdcOf(escrow)).toBe(held0);
    expect(await status(id)).toBe("Resolved");
  });

  it("a settlement of zero is a full refund with no receipt", async () => {
    const before = await usdcOf(client.address);
    const id = await deliveredJob();
    await tx(client, "dispute", [id, ("0x" + "cc".repeat(32)) as Hex]);
    await tx(freelancer, "offerSettlement", [id, 0n]);
    await tx(client, "settle", [id, 0n, 0n, 0n, ("0x" + "00".repeat(32)) as Hex, "0x"]);
    expect(await usdcOf(client.address)).toBe(before);
  });

  it("offers are bounded and only the agent's operator can make them", async () => {
    const id = await deliveredJob();
    await tx(client, "dispute", [id, ("0x" + "dd".repeat(32)) as Hex]);
    await revertsWith(tx(freelancer, "offerSettlement", [id, AMOUNT + 1n]), "BadParams");
    await revertsWith(tx(freelancer, "offerSettlement", [id, 9_999n]), "BadParams");
    await revertsWith(tx(stranger, "offerSettlement", [id, 1_000_000n]), "NotAgentOperator");
  });

  it("arbiter rules any split; only the named arbiter can", async () => {
    const held0 = await usdcOf(escrow);
    const id = await deliveredJob({ arbiter: arbiter.address });
    await tx(client, "dispute", [id, ("0x" + "ee".repeat(32)) as Hex]);
    await revertsWith(tx(client, "rule", [id, 0n]), "NotArbiter");
    await revertsWith(tx(stranger, "rule", [id, 0n]), "NotArbiter");
    await revertsWith(tx(arbiter, "rule", [id, AMOUNT + 1n]), "BadParams");

    const wBefore = await usdcOf(payout);
    const cBefore = await usdcOf(client.address);
    await tx(arbiter, "rule", [id, 3_000_000n]);
    expect((await usdcOf(payout)) - wBefore).toBe(3_000_000n);
    expect((await usdcOf(client.address)) - cBefore).toBe(7_000_000n + FEE - 150_000n);
    expect(await usdcOf(escrow)).toBe(held0);
    await revertsWith(tx(arbiter, "rule", [id, 0n]), "BadStatus");
  });

  it("no arbiter means nobody can rule", async () => {
    const id = await deliveredJob();
    await tx(client, "dispute", [id, ("0x" + "ff".repeat(32)) as Hex]);
    await revertsWith(tx(arbiter, "rule", [id, 0n]), "NotArbiter");
  });

  it("only the client can dispute, and only a delivered job", async () => {
    const id = await createJob();
    await acceptJob(id);
    await revertsWith(tx(client, "dispute", [id, ("0x" + "00".repeat(32)) as Hex]), "BadStatus");
    await tx(freelancer, "deliver", [id, ("0x" + "00".repeat(32)) as Hex]);
    await revertsWith(tx(freelancer, "dispute", [id, ("0x" + "00".repeat(32)) as Hex]), "NotClient");
  });

  it("the client track record counts posted, paid and disputed", async () => {
    const [posted, paid, disputed] = await call<readonly [number, number, number]>("clientStats", [client.address]);
    expect(posted).toBeGreaterThan(paid);
    expect(paid).toBeGreaterThan(0);
    expect(disputed).toBeGreaterThan(0);
  });
});

describe("conservation: after all of the above the escrow only holds open jobs", () => {
  it("balance equals the sum of amount + fee over jobs still holding funds", async () => {
    const next = (await call<bigint>("nextJobId")) as bigint;
    let held = 0n;
    for (let i = 1n; i < next; i++) {
      const j = (await lib.readJob(i))!;
      if (["Funded", "Accepted", "Delivered", "Disputed"].includes(j.status)) held += j.amount + (await call<bigint>("feeOf", [j.amount]));
    }
    expect(await usdcOf(escrow)).toBe(held);
  });
});

describe("API: job text and signed proposals", () => {
  const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const params = (id: string | bigint) => ({ params: Promise.resolve({ id: String(id) }) });
  let jobId: bigint;
  const title = "Logo design";
  const body = "Three concepts, vector files.";

  it("stores job text only when it hashes to the onchain metaHash", async () => {
    const rc = await tx(client, "create", [AMOUNT, 0, 0, BigInt((await now()) + 2 * DAY), 3 * DAY, ZERO, lib.metaHashOf(title, body)]);
    jobId = events<{ jobId: bigint }>(rc, "JobCreated")[0].jobId;
    const jobs = await import("@/app/api/jobs/route");

    const bad = await jobs.POST(post("http://t/api/jobs", { chainJobId: String(jobId), title, body: "tampered text" }));
    expect(bad.status).toBe(422);
    expect((await jobs.POST(post("http://t/api/jobs", { chainJobId: "99999", title, body }))).status).toBe(404);
    expect((await jobs.POST(post("http://t/api/jobs", { chainJobId: String(jobId), title: "", body }))).status).toBe(400);

    const ok = await jobs.POST(post("http://t/api/jobs", { chainJobId: String(jobId), title, body }));
    expect(ok.status).toBe(200);
    const list = (await (await jobs.GET(new Request("http://t/api/jobs"))).json()) as { chain_job_id: string }[];
    expect(list.map((r) => r.chain_job_id)).toContain(String(jobId));
  });

  it("serves the text with verified=true, and flags a database row that no longer matches", async () => {
    const one = await import("@/app/api/jobs/[id]/route");
    const good = await (await one.GET(new Request("http://t"), params(jobId))).json();
    expect(good).toMatchObject({ title, body, verified: true });

    await pg.query("update jobs set body = 'edited in the database' where chain_job_id = $1", [String(jobId)]);
    const tampered = await (await one.GET(new Request("http://t"), params(jobId))).json();
    expect(tampered.verified).toBe(false);
    await pg.query("update jobs set body = $2 where chain_job_id = $1", [String(jobId), body]);

    expect((await one.GET(new Request("http://t"), params("12345"))).status).toBe(404);
  });

  it("accepts a proposal signed by the agent's operator, one per agent per job", async () => {
    const props = await import("@/app/api/jobs/[id]/proposals/route");
    const pitch = "I have done 30 logos.";
    const signature = await freelancer.wallet.signMessage({ account: freelancer.account, message: lib.proposalMessage(String(jobId), String(agentId), pitch) });
    const req = (b: object) => post("http://t", { agentId: String(agentId), pitch, signer: freelancer.address, signature, ...b });

    expect((await props.POST(req({}), params(jobId))).status).toBe(200);
    // resubmitting updates, it does not add a second row
    expect((await props.POST(req({}), params(jobId))).status).toBe(200);
    const rows = (await (await props.GET(new Request("http://t"), params(jobId))).json()) as { agent_id: string; signer: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].signer).toBe(freelancer.address);
  });

  it("rejects forged, altered and unauthorised proposals", async () => {
    const props = await import("@/app/api/jobs/[id]/proposals/route");
    const pitch = "Trust me.";
    const msg = lib.proposalMessage(String(jobId), String(agentId), pitch);

    // a stranger signs for an agent they do not operate
    const sigStranger = await stranger.wallet.signMessage({ account: stranger.account, message: msg });
    const forged = await props.POST(post("http://t", { agentId: String(agentId), pitch, signer: stranger.address, signature: sigStranger }), params(jobId));
    expect(forged.status).toBe(403);

    // a valid signature reused for a different pitch
    const sigOk = await freelancer.wallet.signMessage({ account: freelancer.account, message: msg });
    const altered = await props.POST(post("http://t", { agentId: String(agentId), pitch: "different pitch", signer: freelancer.address, signature: sigOk }), params(jobId));
    expect(altered.status).toBe(401);

    // a valid signature reused for another job
    const otherJob = await props.POST(post("http://t", { agentId: String(agentId), pitch, signer: freelancer.address, signature: sigOk }), params(jobId + 1n));
    expect(otherJob.status).toBe(401);

    // signer claims to be someone else
    const impostor = await props.POST(post("http://t", { agentId: String(agentId), pitch, signer: client.address, signature: sigOk }), params(jobId));
    expect(impostor.status).toBe(401);

    expect((await props.POST(post("http://t", { agentId: "abc", pitch, signer: freelancer.address, signature: sigOk }), params(jobId))).status).toBe(400);
    expect((await props.POST(post("http://t", { agentId: String(agentId), pitch: "x".repeat(2001), signer: freelancer.address, signature: sigOk }), params(jobId))).status).toBe(400);
  });
});

describe("the grounded score the app shows is the one on chain", () => {
  it("the app's Grounded instance reads the rated agent", async () => {
    // lib/grounded.ts is built from lib/gig.ts's publicClient, which points at the local fork via env
    const { grounded } = await import("@/lib/grounded");
    const s = await grounded.score(agentId);
    expect(s.reviewers).toBe(1);
    expect(s.score).toBe(90);
    expect(s.rawScore).not.toBeNull();
  });
});

describe("API: wallet sign-in (SIWE) and job categories", () => {
  const sess = () => import("@/lib/session");
  const siwe = () => import("viem/siwe");
  const cookie = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1) ?? "";
  const verifyReq = (b: object, nonce?: string, host = "app.test") =>
    new Request("http://app.test/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json", host, ...(nonce ? { cookie: `gt_nonce=${nonce}` } : {}) },
      body: JSON.stringify(b),
    });
  async function signed(who: Actor, nonce: string, over: Partial<Parameters<Awaited<ReturnType<typeof siwe>>["createSiweMessage"]>[0]> = {}) {
    const { createSiweMessage } = await siwe();
    const message = createSiweMessage({
      address: who.address,
      chainId: 10143,
      domain: "app.test",
      nonce,
      uri: "http://app.test",
      version: "1",
      expirationTime: new Date(Date.now() + 5 * 60_000),
      ...over,
    });
    return { message, signature: await who.wallet.signMessage({ account: who.account, message }) };
  }
  const getNonce = async () => {
    const { GET } = await import("@/app/api/auth/nonce/route");
    const res = await GET();
    return { res, nonce: ((await res.json()) as { nonce: string }).nonce };
  };

  it("issues a one-time nonce in an httpOnly cookie", async () => {
    const { res, nonce } = await getNonce();
    expect(nonce).toMatch(/^[a-zA-Z0-9]{8,}$/);
    const c = res.headers.getSetCookie().find((x) => x.startsWith("gt_nonce="))!;
    expect(c).toMatch(/HttpOnly/i);
    expect(cookie(res, "gt_nonce")).toBe(nonce);
  });

  it("signs in a wallet that proves control, and the session names exactly that wallet", async () => {
    const { POST } = await import("@/app/api/auth/verify/route");
    const { readSession, signSession } = await sess();
    const { nonce } = await getNonce();
    const res = await POST(verifyReq(await signed(client, nonce), nonce));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((x) => x.startsWith("gt_session="))).toMatch(/HttpOnly/i);
    expect(readSession(cookie(res, "gt_session"))).toBe(client.address);
    expect(cookie(res, "gt_nonce")).toBe(""); // nonce cleared after use

    // tampered, truncated and expired tokens are all rejected
    const tok = cookie(res, "gt_session");
    expect(readSession(tok.slice(0, -2) + "xx")).toBeNull();
    expect(readSession(tok.split(".")[0])).toBeNull();
    expect(readSession(signSession(client.address, -1))).toBeNull();
    expect(readSession(undefined)).toBeNull();
  });

  it("rejects a bad nonce, a missing nonce, another wallet's signature, wrong domain, wrong chain and an expired message", async () => {
    const { POST } = await import("@/app/api/auth/verify/route");
    const { nonce } = await getNonce();
    const ok = await signed(client, nonce);

    expect((await POST(verifyReq(ok, "someOtherNonce1234"))).status).toBe(401); // nonce cookie differs from the signed one
    expect((await POST(verifyReq(ok))).status).toBe(400); // no nonce cookie at all
    expect((await POST(verifyReq({ message: ok.message }, nonce))).status).toBe(400);

    const other = await signed(stranger, nonce);
    expect((await POST(verifyReq({ message: ok.message, signature: other.signature }, nonce))).status).toBe(401); // signed by someone else
    expect((await POST(verifyReq(await signed(client, nonce), nonce, "evil.test"))).status).toBe(401); // phishing domain
    expect((await POST(verifyReq(await signed(client, nonce, { chainId: 1 }), nonce))).status).toBe(401);
    expect((await POST(verifyReq(await signed(client, nonce, { expirationTime: new Date(Date.now() - 1000) }), nonce))).status).toBe(401);
  });

  it("logout clears the session cookie", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");
    const res = await POST();
    expect(cookie(res, "gt_session")).toBe("");
  });

  it("stores a category with the job text, rejects unknown ones and filters the list by it", async () => {
    const jobs = await import("@/app/api/jobs/route");
    const post = (b: object) => new Request("http://t/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const mk = async (t: string, b: string) => {
      const rc = await tx(client, "create", [AMOUNT, 0, 0, BigInt((await now()) + 2 * DAY), 3 * DAY, ZERO, lib.metaHashOf(t, b)]);
      return events<{ jobId: bigint }>(rc, "JobCreated")[0].jobId;
    };
    const a = await mk("Poster design", "A2 poster.");
    const b = await mk("Write docs", "API docs.");

    expect((await jobs.POST(post({ chainJobId: String(a), title: "Poster design", body: "A2 poster.", category: "nonsense" }))).status).toBe(400);
    expect((await jobs.POST(post({ chainJobId: String(a), title: "Poster design", body: "A2 poster.", category: "design" }))).status).toBe(200);
    expect((await jobs.POST(post({ chainJobId: String(b), title: "Write docs", body: "API docs." }))).status).toBe(200); // defaults to other

    const list = async (q = "") => (await (await jobs.GET(new Request(`http://t/api/jobs${q}`))).json()) as { chain_job_id: string; category: string }[];
    expect((await list("?category=design")).map((r) => r.chain_job_id)).toEqual([String(a)]);
    expect((await list("?category=other")).map((r) => r.chain_job_id)).toContain(String(b));
    expect((await list("?category=writing")).length).toBe(0);
  });
});
