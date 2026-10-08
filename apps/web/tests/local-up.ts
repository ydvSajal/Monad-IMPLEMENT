/**
 * Local demo stack: needs the anvil fork on :8545 (tests/README.md). Deploys GigEscrow, serves an in-process
 * Postgres on :55432, seeds demo jobs, prints the env for `next dev`. Keep it running: the DB lives in it.
 *   FUND=0xYourWallet node tests/local-up.ts   (FUND gets 100 MON + 1000 USDC on the fork)
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import fs from "node:fs";
import path from "node:path";
import { type Address } from "viem";

import { USDC, deployEscrow, newActor, now, rpc, send, setUsdc } from "./harness.ts";

const DAY = 86400;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const g = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../deployments/10143.json"), "utf8"));

const deployer = await newActor("deployer");
const escrow = await deployEscrow(deployer, [
  USDC, g.receiptRouter, g.groundedReputation, g.erc8004Identity, deployer.address, 500n, BigInt(7 * DAY),
]);
process.env.NEXT_PUBLIC_GIG_ESCROW = escrow;
const lib = await import("../lib/gig.ts");

const pg = new PGlite();
await pg.exec(fs.readFileSync(path.resolve(import.meta.dirname, "../db/schema.sql"), "utf8"));
await new PGLiteSocketServer({ db: pg, port: 55432, host: "127.0.0.1", maxConnections: 10 }).start();

const client = await newActor("client", 2_000_000_000n);
await send(client, { address: USDC, abi: lib.usdcAbi, functionName: "approve", args: [escrow, 2n ** 255n] });

const demo = [
  { title: "Landing page for a Monad wallet", body: "Next.js + Tailwind, 3 sections, mobile first. Figma provided.", category: "development", amount: 50_000_000n, minScore: 0, minReviewers: 0 },
  { title: "Audit a 200-line ERC-20 vesting contract", body: "Foundry tests + written report. Trusted freelancers only.", category: "smart-contracts", amount: 120_000_000n, minScore: 70, minReviewers: 1 },
  { title: "Write 5 tweets about agent payments", body: "Plain English, no hype. Draft in a Google Doc.", category: "writing", amount: 15_000_000n, minScore: 0, minReviewers: 0 },
  { title: "Logo and brand kit for a DeFi dashboard", body: "Three concepts, vector files, dark and light variants.", category: "design", amount: 80_000_000n, minScore: 0, minReviewers: 0 },
  { title: "Launch thread and 2-week social plan", body: "Testnet launch for a freelance marketplace. Voice: calm, specific.", category: "marketing", amount: 35_000_000n, minScore: 50, minReviewers: 1 },
  { title: "Label 2,000 support tickets for intent", body: "CSV in, CSV out. Spot checks on 10%. Guidelines supplied.", category: "data-ai", amount: 60_000_000n, minScore: 0, minReviewers: 0 },
  { title: "Port a Solidity subgraph to Ponder", body: "Existing subgraph has 4 entities. Tests must pass against a fork.", category: "development", amount: 200_000_000n, minScore: 70, minReviewers: 2 },
];
for (const d of demo) {
  const id = await lib.publicClient.readContract({ address: escrow, abi: lib.escrowAbi, functionName: "nextJobId" });
  await send(client, {
    address: escrow, abi: lib.escrowAbi, functionName: "create",
    args: [d.amount, d.minScore, d.minReviewers, BigInt((await now()) + 7 * DAY), 3 * DAY, ZERO, lib.metaHashOf(d.title, d.body)],
  });
  await pg.query("insert into jobs (chain_job_id, client, title, body, meta_hash, category) values ($1,$2,$3,$4,$5,$6)", [
    id.toString(), client.address, d.title, d.body, lib.metaHashOf(d.title, d.body), d.category,
  ]);
}

if (process.env.FUND) {
  await rpc("anvil_setBalance", [process.env.FUND, "0x56BC75E2D63100000"]);
  await setUsdc(process.env.FUND as Address, 1_000_000_000n);
}
console.log(`
escrow  ${escrow}
demo client ${client.address}, ${demo.length} jobs seeded${process.env.FUND ? `, funded ${process.env.FUND}` : ""}

Run the app (from apps/web):
  NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 NEXT_PUBLIC_CHAIN_ID=10143 NEXT_PUBLIC_GIG_ESCROW=${escrow} \\
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres DB_POOL_MAX=1 pnpm dev
`);
