# GigTrust: Technical Requirements

## 1. Constraints

- Monad Testnet (10143), USDC `0x534b…43A3` (6 decimals, EIP-3009).
- Grounded contracts are **read/written, never modified**.
- Contract rules (same as Grounded): no owner, admin, pauser or proxy. Config is `immutable`. Custom errors. An event for every state change.
- Monad bills the gas **limit**: every write uses `estimateGas × 1.15`.
- No secrets in git. Deployer key in a Foundry keystore.

## 2. The key design point: who is the payer

`ReceiptRouter.pay(agentId, token, value)` records `msg.sender` as payer. If `GigEscrow` called `pay`, the **escrow** would be the payer and the client could never rate (Grounded's `rate` requires the receipt's payer to sign).

So release uses `ReceiptRouter.payWithAuthorization`, which records `from` (the signer) as payer, in one atomic transaction:

1. Client signs an EIP-3009 `ReceiveWithAuthorization`: `from = client`, `to = ReceiptRouter`, `value = job.amount`, `nonce = router.authorizationNonce(agentId, salt)`.
2. Client calls `GigEscrow.release(jobId, validAfter, validBefore, salt, signature)`.
3. Escrow marks the job `Released`, transfers `job.amount` USDC **to the client**, then calls `router.payWithAuthorization(agentId, usdc, client, amount, validAfter, validBefore, salt, signature)`.
4. Router pulls the USDC from the client and forwards it to the freelancer's ERC-8004 payout wallet. Receipt payer = client.

If step 4 fails for any reason, the whole transaction reverts, including the refund in step 3, so the client can never walk away with the escrowed funds. Grounded is not changed at all.

## 3. `GigEscrow.sol`

### 3.1 Immutables

| Name | Value |
|---|---|
| `usdc` | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| `router` | `ReceiptRouter` `0xab44…c62e` |
| `grounded` | `IGroundedReputation` `0xaDDd…bF82` |
| `identity` | ERC-8004 Identity `0x8004A818…BD9e` |
| `feeRecipient` | set at deploy |
| `feeBps` | 500 (5%) |
| `reviewWindow` | 7 days |

### 3.2 Job struct

```solidity
enum Status { None, Funded, Accepted, Delivered, Released, AutoReleased, Refunded }

struct Job {
    address client;
    uint96  amount;        // paid to freelancer, 6 dp
    uint256 agentId;       // 0 until accepted
    uint8   minScore;      // trust bar, 0..100
    uint32  minReviewers;
    uint40  acceptBy;
    uint40  deliveredAt;
    Status  status;
    bytes32 metaHash;      // keccak of offchain job JSON
}
```

### 3.3 Functions

| Function | Caller | Checks | Effect |
|---|---|---|---|
| `create(amount, minScore, minReviewers, acceptBy, metaHash) → jobId` | client | `amount ≥ 10_000` (Grounded router floor 0.01 USDC), `minScore ≤ 100`, `acceptBy > now` | Pulls `amount + fee` from client. Fee is held until release, refunded on `refund`. `JobCreated` |
| `accept(jobId, agentId)` | freelancer | status `Funded`, `now ≤ acceptBy`, caller is owner or approved operator of `agentId` in Identity, `identity.getAgentWallet(agentId) != 0`, `grounded.meets(agentId, minScore, minReviewers)` (skipped when both are 0) | status `Accepted`. `JobAccepted` |
| `deliver(jobId, deliveryHash)` | freelancer (agent owner) | status `Accepted` | status `Delivered`, `deliveredAt = now`. `JobDelivered` |
| `release(jobId, validAfter, validBefore, salt, sig) → receiptId` | client | status `Accepted` or `Delivered` | §2 flow; fee to `feeRecipient`. status `Released`. `JobReleased(jobId, receiptId)` |
| `autoRelease(jobId)` | anyone | status `Delivered`, `now > deliveredAt + reviewWindow` | `amount` direct to payout wallet (no receipt); fee to `feeRecipient`. status `AutoReleased` |
| `refund(jobId)` | client | status `Funded` and `now > acceptBy`; **or** status `Accepted` and caller is the freelancer (freelancer withdraws) | `amount + fee` to client. status `Refunded` |

Errors: `BadStatus`, `NotClient`, `NotAgentOperator`, `AgentNotTrusted(agentId)`, `NoAgentWallet(agentId)`, `TooEarly`, `TooLate`, `AmountBelowMinimum`.

Rules: checks-effects-interactions (status written before any transfer). `SafeERC20`. No `receive()`. Per-job thresholds are why GigTrust calls `meets` directly instead of inheriting `GroundedGate` (whose thresholds are fixed at deploy).

### 3.4 Tests (Foundry)

- Unit: every function, every revert, fee math, status machine.
- Fork (`-n monad`, opt-in via `MONAD_FORK_RPC`): real USDC + real Grounded. Assert `ReceiptRegistry` receipt payer == client after `release`; `accept` reverts for an unrated agent with `minScore > 0`; `accept` succeeds for an unrated agent on an open job.
- Invariant: `usdc.balanceOf(escrow) == Σ (amount + fee)` over jobs in `Funded/Accepted/Delivered`.
- Adversarial: client tries `release` with a signature for a different agent or amount (reverts, funds stay); freelancer front-runs the authorization straight to the token (impossible: payee is the router).

## 4. Off-chain

### 4.1 Web app (Next.js App Router)

Pages: `/` (pitch + live stats), `/jobs`, `/jobs/new`, `/jobs/[id]`, `/freelancers/[agentId]`, `/me`.

- Wallet: injected wallet via viem (`window.ethereum`). Add Privy only if it is needed (no prize-driven integrations).
- Reads: Grounded SDK `score()`, `check()`; `GigEscrow` state via viem `readContract`; job lists from Postgres + `JobCreated` events.
- Writes: `create` (approve + create), `accept`, `deliver`, `release` (sign EIP-3009 via `signTypedData` with USDC's domain `"USDC"` v2, then call), `rate`.

### 4.2 Database (Postgres)

```sql
jobs(id bigint pk, chain_job_id bigint unique, client text, title text, body text,
     meta_hash text, created_at timestamptz)
proposals(id serial pk, job_id bigint references jobs, agent_id numeric, pitch text,
          created_at timestamptz)
```

`meta_hash` must equal `keccak256` of the canonical JSON, so the onchain job is the source of truth and the DB is just a cache for text.

### 4.3 Rating and the passkey rpId

Grounded's `ReviewerRegistry` checks WebAuthn assertions against rpId `grounded.sajal.sbs`. A passkey created on GigTrust's domain will **not** verify. Options, in order:

1. **Rate on Grounded's site.** After release, GigTrust deep-links to `https://grounded.sajal.sbs` with the receipt id; the client binds a passkey (once) and rates there. Zero new code in Grounded if the playground already supports rating a receipt. **Check this first.**
2. **Host GigTrust on a subdomain**, e.g. `gigs.grounded.sajal.sbs`. WebAuthn allows a page to use its own domain or a registrable parent as rpId, so that page can create and use passkeys with rpId `grounded.sajal.sbs`. Rating stays inside GigTrust. Needs one DNS record only.
3. Demo fallback: server-side `SoftwareAuthenticator` for seeded clients only, disclosed in README.

Recommended: option 2 if allowed by the hackathon (it shares a domain with a prior project, so disclose), else option 1.

### 4.4 Environment variables (`.env.example`)

```
NEXT_PUBLIC_CHAIN_ID=10143
NEXT_PUBLIC_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_GIG_ESCROW=            # after deploy
GROUNDED_ADDRESSES=                # path to Grounded deployments/10143.json
DATABASE_URL=                      # Postgres
MONAD_FORK_RPC=                    # opt-in fork tests
```

## 5. Gas budget (Monad bills the limit)

Measured on Grounded: `pay` ~302k, `ground` ~353k, `bind` ~158k. Estimate for `release` = escrow overhead + `payWithAuthorization`; measure on fork on D1 and write the real number in the README. Never hardcode limits.

## 6. Security checklist

- No admin, no upgrade, immutable fee.
- Atomic release (§2).
- Trust bar checked at `accept` time only; a freelancer whose score drops mid-job keeps the job (document it).
- Freelancer can't release to themselves: `release` is client-only, and the EIP-3009 signature must come from the client.
- `metaHash` verified by the web app before displaying job text.
- Slither + Aderyn before deploy; findings triaged in `docs/static-analysis.md`.
