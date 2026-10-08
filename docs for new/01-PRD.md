# GigTrust: Product Requirements

## 1. Problem

Freelance platform reviews have three failures:

1. **Fake reviews are cheap.** Review farms and self-hired gigs inflate ratings. Clients cannot tell earned stars from bought ones.
2. **The platform owns your reputation.** Leave Upwork or Fiverr and years of reviews stay behind. This locks freelancers in.
3. **Reviews can be edited or hidden** by the platform, and clients have to trust that they weren't.

## 2. Solution

A marketplace where:

- Payment runs through an onchain escrow. On release, the payment goes through Grounded's `ReceiptRouter`, which issues a **receipt with the client as payer**.
- Only that client, holding that receipt, can leave **one** rating, signed with a passkey. Grounded counts it in an onchain weighted median.
- A freelancer's score lives in Grounded, keyed by their ERC-8004 agent id. Any app can read it. GigTrust cannot edit it.
- Clients set a **per-job trust bar** (min score, min paying reviewers), and the escrow contract enforces it when a freelancer accepts.
- A platform fee on every job means each fake review costs real money even if the "client" is the freelancer's own second wallet.

## 3. Users

| User | Wants |
|---|---|
| Client | Hire someone whose reviews are real; pay safely; leave a review that counts |
| Freelancer | Get paid reliably; build a reputation that leaves with them |
| Other apps / judges | Read a freelancer's score without trusting GigTrust |

## 4. Scope

| ID | Feature | Priority |
|---|---|---|
| F1 | Freelancer onboarding: register an ERC-8004 identity (or link an existing one) and set its payout wallet | P0 |
| F2 | Profile page: grounded score, reviewers, total paid, raw ERC-8004 score side by side, link to Grounded explorer | P0 |
| F3 | Post job: title, description, budget (USDC), trust bar (min score, min reviewers), accept-by date | P0 |
| F4 | Fund job: client deposits budget + fee into `GigEscrow` | P0 |
| F5 | Apply + accept: freelancer applies offchain; client picks; freelancer accepts onchain, gated by the trust bar | P0 |
| F6 | Deliver: freelancer marks delivered (onchain), with an offchain link | P0 |
| F7 | Release: client signs one EIP-3009 authorization; escrow pays freelancer through Grounded, receipt payer = client | P0 |
| F8 | Rate: client rates 0–100 with a passkey after release | P0 |
| F9 | Timeouts: refund if never accepted; auto-release to freelancer if client is silent after delivery (no receipt, so no rating) | P0 |
| F10 | "Open to new talent" jobs (min score 0, min reviewers 0) so new freelancers can start | P1 |
| F11 | Job board filters by trust bar | P1 |
| F12 | Dispute tag: client can file a Grounded `dispute` rating instead of a quality one (counted separately, never moves score) | P2 |

## 5. User stories and acceptance

**S1 – Client hires safely.** As a client, I post a job requiring score ≥ 70 from ≥ 3 paying reviewers.
- Acceptance: a freelancer below the bar calls `accept` and it reverts `AgentNotTrusted`. The UI explains why before they try.

**S2 – Freelancer gets paid.** As a freelancer, I deliver and the client releases.
- Acceptance: USDC lands in my ERC-8004 payout wallet; a Grounded `ReceiptIssued` event shows payer = client, agent = me.

**S3 – Client's review counts.** After release, I rate the freelancer 90.
- Acceptance: the Grounded score on the public explorer changes. Reviewer count goes up by 1.

**S4 – Silent client.** I delivered and the client never responds.
- Acceptance: after the review window, anyone can call `autoRelease`; I'm paid. No receipt is issued, so no rating is possible. That is intended: a rating must come from a client who chose to pay.

**S5 – Never accepted.** No freelancer accepts by the accept-by date.
- Acceptance: client calls `refund` and gets budget + fee back.

**S6 – Portability.** A judge opens `https://grounded.sajal.sbs/agents/<id>` for a GigTrust freelancer.
- Acceptance: same score as GigTrust shows, with no GigTrust involvement.

## 6. Metrics (demo scale)

- ≥ 3 freelancers, ≥ 6 completed paid jobs on testnet, ≥ 1 refused acceptance.
- Every rating on a GigTrust freelancer traceable to a GigTrust escrow release tx.
- Time from "release" click to score update: under 1 minute.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Wash trading: freelancer funds a job from their own second wallet | Platform fee (default 5%) is lost on every fake job; Grounded excludes the freelancer's owner and payout wallets as reviewers and caps weight by log2 of amount; one rating per receipt. Claim "fake reviews cost money", never "impossible". |
| Freelancer has no ERC-8004 payout wallet | Onboarding sets it; `accept` checks `getAgentWallet != 0` so funds can't get stuck at release. |
| Agent NFT sold after reviews earned | Profile shows Grounded `lastOwnerOf` vs current owner; warn on mismatch (SDK `ratingsAfterOwnerChange`). |
| Passkey rpId is `grounded.sajal.sbs`, not GigTrust's domain | TRD §4.3. |
| Prior-work rule of the second hackathon | Plan §0 and §5. |
