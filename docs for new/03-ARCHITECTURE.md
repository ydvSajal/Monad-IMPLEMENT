# GigTrust: System Architecture

## 1. Components

```
                ┌──────────────────────────── GigTrust (new) ───────────────────────────┐
 Client ──┐     │  Next.js web app  ──reads──►  Postgres (job text, proposals)          │
          ├────►│        │                                                               │
 Freelancer┘    │        │ viem / Grounded SDK                                           │
                │        ▼                                                               │
                │  GigEscrow.sol  (funds, trust bar, fee, timeouts)                      │
                └────────┬───────────────────────────────┬──────────────────────────────┘
                         │ payWithAuthorization          │ meets(agentId, min, n)
                         ▼                               ▼
                ┌──────────────────────── Grounded (deployed, unchanged) ───────────────┐
                │  ReceiptRouter ──► ReceiptRegistry ◄── GroundedReputation ◄── ReviewerRegistry
                └────────┬──────────────────────────────────────────┬───────────────────┘
                         ▼                                          ▼
                 USDC (EIP-3009)                         ERC-8004 Identity + Reputation
```

## 2. Trust boundaries

| Component | Trusted for | Not trusted for |
|---|---|---|
| GigEscrow | Holding funds per its code | Nothing else; no admin exists |
| Grounded contracts | Score computation, receipts | Immutable; GigTrust can't change them |
| ERC-8004 registries | Identity, payout wallet | Upgradeable, owned by their deployer (inherited Grounded assumption) |
| Web app + Postgres | Job text, UX | Never for money or scores. Scores come from chain; job text verified against `metaHash` |

## 3. Flows

### 3.1 Freelancer onboarding
1. Connect wallet.
2. If no ERC-8004 agent: `identity.register(agentURI)`.
3. Set payout wallet: `setAgentWallet(agentId, wallet, deadline, sig)` (EIP-712 domain `ERC8004IdentityRegistry` v1, signed by the wallet; deadline ≤ now + 5 min).
4. Profile shows Grounded `score()` (unrated = "new", not "bad").

### 3.2 Job lifecycle
```
create ──► Funded ──accept (meets?)──► Accepted ──deliver──► Delivered
   │          │                            │                     │
   │      refund (after acceptBy)    release / freelancer    release ──► Released ──► rate
   │          ▼                        withdraws (refund)        │
   │      Refunded                                          autoRelease (after window)
   │                                                             ▼
   │                                                       AutoReleased (no receipt)
```

### 3.3 Release + rate (sequence)
1. Client clicks Release. App calls `router.authorizationNonce(agentId, salt)` with a random `salt`.
2. Wallet signs `ReceiveWithAuthorization` (to = router).
3. App sends `GigEscrow.release(...)` (gas = estimate × 1.15).
4. Escrow: status Released → USDC to client → `router.payWithAuthorization` → freelancer wallet. Emits `JobReleased(jobId, receiptId)`.
5. App reads `receiptId` from the event and opens the rate step (TRD §4.3): passkey bound once, then Grounded `rate({ receiptId, score, authenticator })` posts ERC-8004 feedback and calls `ground`.
6. Profile refreshes from `scoreOf`.

## 4. Repo layout

```
GIGTRUST/
  docs/                 this plan
  contracts/            Foundry: src/GigEscrow.sol, test/, script/Deploy.s.sol
  apps/web/             Next.js
  deployments/10143.json
  .env.example
  README.md             disclosure (plan §5), judge path, addresses
```

Grounded is consumed as a dependency: `IGroundedReputation` + the router ABI vendored into `contracts/src/interfaces/` (interfaces only, with a header comment naming the source), and the SDK as an npm/git dependency for the web app.

## 5. ADRs

- **ADR-1 Release via `payWithAuthorization`, not `pay`.** Only this keeps the client as receipt payer, so only clients can rate. Atomic refund-then-pull keeps escrow safe.
- **ADR-2 Per-job trust bar via `meets`, not `GroundedGate`.** Gate thresholds are immutable per contract; jobs need their own.
- **ADR-3 No arbiter.** No-admin rule. Timeouts favour the freelancer after delivery; clients are protected upfront by the trust bar. Arbitration is roadmap.
- **ADR-4 Auto-release issues no receipt.** A rating must come from a client who chose to pay.
- **ADR-5 Fee is the anti-wash lever GigTrust adds.** Grounded makes fake reviews need a payment; GigTrust's fee makes that payment lossy even when it goes to yourself.
- **ADR-6 Postgres only for text.** Everything with value lives onchain and is the source of truth.

## 6. Failure modes

| Failure | Result | Handling |
|---|---|---|
| EIP-3009 signature expired/invalid at release | tx reverts, funds stay in escrow | UI re-signs |
| Freelancer unset payout wallet after accept | `release` reverts `NoAgentWallet` in router | Client can't pay; freelancer must reset it; `autoRelease` also fails. Document; check wallet again in UI before release |
| Public RPC rate limit (25 req/s) | Slow reads | Pace reads (same fix as Grounded explorer); fallback RPC env |
| Passkey rpId mismatch | Rating fails | TRD §4.3 options |
| Agent NFT transferred mid-job | New owner receives payment (payout wallet follows the identity registry) | Warn in UI; out of scope to block |
