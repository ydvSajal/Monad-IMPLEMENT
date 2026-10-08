# GigTrust: Plan

Working name: **GigTrust**. It is a freelance marketplace where every review is backed by a real escrow payment, and reputation is portable. Rename freely.

GigTrust is a **separate project** from Grounded. It uses Grounded as an external, already-deployed dependency on Monad Testnet (chain 10143), and does not copy Grounded code into this repo.

## 0. Before writing any code

1. **Read the second hackathon's rules on prior work.** If it bans reusing earlier projects, GigTrust must still be fine, because it only *calls* deployed contracts, like any app calls Uniswap. Disclose it anyway (see §5).
2. **Confirm the chain.** Grounded exists only on Monad Testnet. If the second hackathon requires another chain, stop: this plan does not work without redeploying Grounded, which is out of scope.
3. **Write down the submission deadline** in §3 (unknown when this was written).

## 1. One line

Freelancers get hired on a score that only paying clients can move, and the score follows them off the platform.

## 2. What is new vs reused

| Piece | Source | Notes |
|---|---|---|
| Reputation contracts, scoring, passkey reviewer binding, receipts | **Grounded (deployed)** | Read and write via addresses below. No changes. |
| `@sajalydv/grounded-sdk` | **Grounded** | Install from npm once published, else from the Grounded repo (`file:` or git dependency). |
| `GigEscrow.sol` (job escrow, per-job trust gate, fee) | **New** | Core of this project. |
| Web app (post job, apply, fund, deliver, release, rate, profile) | **New** | Next.js. |
| Job/proposal metadata store | **New** | Postgres. Money and reputation stay onchain. |

Grounded addresses (Monad Testnet, deployed block 68082112):

| Contract | Address |
|---|---|
| GroundedReputation | `0xaDDd1f2F876CD253C57177b675905Bdb0061bF82` |
| ReceiptRouter | `0xab442c3cbc2997a6218FEA0DD253c3717edfc62e` |
| ReceiptRegistry | `0xa89b76Ea9AcEA12A66Fb23d318219b9119362301` |
| ReviewerRegistry | `0xFb38DcB72C222d3943579b4F2c4C91ebcBE4eBa6` |
| ERC-8004 Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |

Grounded's passkey rpId is `grounded.sajal.sbs`. That matters: see TRD §4.3.

## 3. Milestones

Deadline: **TBD (fill in)**. The plan assumes about 6 build days. Each day ends with something runnable.

| Day | Deliverable | Done when |
|---|---|---|
| D1 | Repo scaffold, Foundry + Next.js, `GigEscrow` happy path (fund, accept, deliver, release via `payWithAuthorization`) | Fork test: client funds, freelancer accepts, client releases, Grounded receipt has payer = client |
| D2 | Escrow edge paths: refund before accept, auto-release after review window, fee, per-job trust gate; invariants | `forge test` green incl. fork; no admin functions |
| D3 | Deploy `GigEscrow` to testnet; web: connect wallet, freelancer profile (Grounded score), job board | Live URL shows real scores from Grounded |
| D4 | Web: post job + fund, apply, accept, deliver, release (client signs EIP-3009) | Full paid job on testnet from the browser |
| D5 | Web: rate after release (passkey via Grounded flow), profile updates; seed 3 freelancers with real jobs | Profile shows grounded vs raw ERC-8004 score |
| D6 | Demo video, README, judge path, freeze | Fresh clone runs; demo under 3 min |

**Kill switch:** if browser passkey rating (D5) blocks twice, rate from a server-side helper using the SDK `SoftwareAuthenticator` for the demo, and state that in the README. Do not fake ratings.

## 4. Demo story (the "wow")

Two freelancers with similar raw ERC-8004 stars. One has ratings from real paid jobs; the other has stars from accounts that never paid. A client posts a job with "min score 70, 3 paying reviewers". The escrow contract **refuses** the second freelancer's acceptance onchain (`AgentNotTrusted`). The first one delivers, gets paid, gets rated, and the score moves on the public Grounded explorer, outside GigTrust. That last step proves portability.

## 5. Disclosure text (README + submission form)

> GigTrust uses Grounded (https://grounded.sajal.sbs), a separately built reputation protocol by the same author, as an onchain dependency. GigTrust's own work is the escrow contract, per-job trust gating, the marketplace app and the job flows. Grounded contracts were not modified.

## 6. Non-goals (MVP)

- Arbitration or dispute resolution. No admin, so no arbiter. Timeouts only. Roadmap item.
- Clients being rated by freelancers. Grounded rates ERC-8004 agents; clients are not agents.
- Chat, file delivery, search ranking, KYC, fiat.
- Mainnet.
