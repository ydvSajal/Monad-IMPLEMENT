# GigTrust

Freelancers get hired on a score that only paying clients can move, and the score follows them off the platform.

> GigTrust uses Grounded (https://grounded.sajal.sbs), a separately built reputation protocol by the same author, as an onchain dependency. GigTrust's own work is the escrow contract, per-job trust gating, the marketplace app and the job flows. Grounded contracts were not modified.

## How it works
- Client funds `GigEscrow` (budget + 5% fee) with a per-job trust bar (min Grounded score, min paying reviewers).
- Freelancer `accept`s onchain; the contract calls `grounded.meets(...)` and reverts `AgentNotTrusted` if the bar is not met.
- On release the client signs one EIP-3009 authorization; the escrow hands the budget to the client and `ReceiptRouter.payWithAuthorization` pulls it straight back to the freelancer's payout wallet in the same tx. Receipt payer = client, so only that client can rate. Any failure reverts everything.
- Silent client: `autoRelease` after 7 days pays the freelancer, issues no receipt, so no rating. Nobody accepts: `refund`.
- Ghosting freelancer: each job has a deliver-by deadline (set at accept); after it the client can `refund` in full.
- Bad delivery: the client can `dispute` inside the review window, which stops auto-release. Then, in order:
  1. Settle: the freelancer `offerSettlement`s a share, and the client `settle`s. The share goes through the router, so the client still gets a receipt and can rate (tag `dispute`).
  2. Arbiter: an optional per-job arbiter (named by the client at creation, visible before accept) can `rule` any split.
  3. Timeout: unresolved after 7 days, anyone calls `resolveTimeout` for a 50/50 split. Both lose, so both have a reason to settle.
  The fee is charged only on what the freelancer receives.
- Client track record onchain (`clientStats`: posted / paid / disputed), shown on every job, so trust runs both ways.
- Proposals must be signed by an operator of the ERC-8004 agent (checked onchain by the API), one per agent per job, and are ranked by Grounded score. Nobody can apply in another freelancer's name.
- No owner, admin, pauser or proxy. Config is immutable.

Why these features: see `docs/RESEARCH.md`.

## Layout
`contracts/` Foundry (`GigEscrow`, tests, deploy script) · `apps/web/` Next.js · `deployments/10143.json` · `docs for new/` specs.

## Run
```bash
git submodule update --init            # NOT --recurse-submodules
cd contracts && forge test             # unit + invariant (in WSL on Windows)
MONAD_FORK_RPC=https://testnet-rpc.monad.xyz forge test -n monad --match-path "test/fork/*"
cd ../apps/web && pnpm install && pnpm dev
```
The web app links the Grounded SDK from a sibling checkout (`link:../../../MONAD10k/packages/sdk`, build it first) because `@sajalydv/grounded-sdk` is not on npm yet. Apply `apps/web/db/schema.sql` to Postgres.

Deploy: `FEE_RECIPIENT=0x… forge script script/Deploy.s.sol --rpc-url $NEXT_PUBLIC_RPC_URL --account $DEPLOYER_ACCOUNT --broadcast`, then set `NEXT_PUBLIC_GIG_ESCROW`.

## Status
Done and tested: contract (45 unit incl. 2 fuzz, 1 invariant over every path incl. disputes, 6 live-fork tests: receipt payer == client on release and on dispute settlement, trust-bar refusal, wrong-agent/amount signatures revert). Web app builds and reads live Grounded scores. Proposal signature checks were verified against the live identity registry (forged signer 403, altered pitch 401).
Not done: testnet deploy, seeded demo jobs, demo video.

## Rating and the passkey rpId (read this)
Grounded verifies passkeys for rpId `grounded.sajal.sbs`. A page on another domain cannot create one, and Grounded's playground only rates receipts it paid itself. So in-app rating (`RateBox`, SDK `BrowserPasskey`) works only when GigTrust is served from `grounded.sajal.sbs` or a subdomain such as `gigs.grounded.sajal.sbs` (one DNS record). Elsewhere the UI shows the receipt id and links to Grounded. A server-side `SoftwareAuthenticator` seed script for demo clients is the disclosed fallback; ratings are never faked.

## Known limits
- Trust bar is checked at `accept` only; a score drop mid-job keeps the job.
- If a freelancer unsets their payout wallet after accepting, `release` and `autoRelease` revert until they reset it (UI rechecks before signing).
- A freelancer withdrawing from an `Accepted` job refunds the client and ends the job (no relisting).
- Receipt id is cached in the client's browser after release (localStorage).
- Arbiter and timeout payouts go directly to the freelancer and issue no receipt, so those outcomes can't be rated. Only a mutual settlement produces one.
- A client can name an arbiter they secretly control. The contract only blocks the client's own address. Freelancers should accept arbiter jobs only when they know the arbiter.
- One job is one milestone. For milestones, post several jobs; each release gives its own receipt.
