# What breaks freelance marketplaces, and what GigTrust does about it

Researched 8 Oct 2026. Most sources are vendor blogs and review sites, so treat their numbers as indicative.

| Problem (sources) | Seen at | GigTrust answer | Where |
|---|---|---|---|
| Fake or bought reviews; ratings gamed by both sides ([jobbers](https://www.jobbers.io/?p=143130), [hireinsouth](https://www.hireinsouth.com/post/freelancer-review)) | Upwork, Fiverr, Freelancer.com | Only a client whose own USDC paid the freelancer can rate, once per receipt, signed with a passkey. The agent's own wallets are excluded by Grounded. Raw ERC-8004 score shown next to the grounded one. | Grounded + `release`/`settle` |
| Client vanishes after the work is done; payment reversals ([gerald](https://joingerald.com/learn/work--income/is-freelancer-legit-review), [sumsub](https://sumsub.com/blog/the-hidden-cost-of-opportunity-how-to-spot-scams-in-the-freelance-marketplace)) | all | Budget is escrowed before anyone works; a silent client is auto-released after 7 days. Onchain payments cannot be charged back. | `create`, `autoRelease` |
| Freelancer takes the job and never delivers | all | A deliver-by deadline is set at accept; after it the client gets a full refund. | `refund` |
| Plagiarised or AI-junk deliverables ([jobbers](https://www.jobbers.io/?p=140965)) | all | The client can dispute inside the review window. Settle, arbiter, or a 50/50 timeout; no admin can take the funds. | `dispute` … `resolveTimeout` |
| Slow, opaque platform dispute support ([hireinsouth](https://www.hireinsouth.com/post/freelancer-review)) | Freelancer.com | Every dispute exit is time-bounded and onchain. A juror DAO (Braintrust) or Kleros court is not available on Monad; a per-job arbiter is the lightweight version. | `rule` |
| Proposal spam and impersonation (one source: about 30% of applications to one Upwork job fake, unverified) | Upwork | Proposals are signed by the agent's operator and checked onchain: one per agent per job, ranked by grounded score. | `/api/jobs/[id]/proposals` |
| Reputation bought by acquiring an account | all | Grounded tracks `ownerChangedAt`; proposals and profiles flag an owner change. | Grounded |
| Freelancers can't vet clients | all | Onchain `clientStats` (posted/paid/disputed), shown on every job. | `clientStats` |
| Fee opacity (Braintrust 0–15% by source) | Braintrust | Immutable 5% fee, charged only on what the freelancer actually receives. | `feeOf` |
| Off-platform payment traps, task scams via WhatsApp ([skydo](https://www.skydo.com/blog/10-red-flags-and-warning-signs-of-freelancer-scams)) | all | Partly: a job only counts toward reputation if paid through escrow, which removes the reason to go off-platform. No chat moderation. | — |

## Looked at and skipped
- **Milestones in one contract** (LaborX, ArbiSecure-style). Post one job per milestone; same safety, much less code.
- **Oracle auto-release** (GitHub PR merged, etc.). Only fits code work, and it adds a trusted oracle.
- **Juror tokens / staking** (Kleros, Braintrust). Needs a token and a juror pool, which a hackathon marketplace doesn't have.
- **KYC.** Off-chain, regulated, and out of scope; trust here comes from paid history, not identity documents.

## Sources
- https://www.jobbers.io/?p=143130
- https://www.jobbers.io/?p=140965
- https://jobbers.io/blockchain-web3-freelance-platforms-vs-traditional-in-2026-complete-comparison/
- https://www.hireinsouth.com/post/freelancer-review
- https://www.hireinsouth.com/post/braintrust-pricing
- https://www.usebraintrust.com/dispute-resolution
- https://typefully.com/Kleros_io/a-smarter-solution-for-freelancers-zPanoKX
- https://sumsub.com/blog/the-hidden-cost-of-opportunity-how-to-spot-scams-in-the-freelance-marketplace
- https://www.skydo.com/blog/10-red-flags-and-warning-signs-of-freelancer-scams
- https://hackquest.io/projects/ArbiSecure
