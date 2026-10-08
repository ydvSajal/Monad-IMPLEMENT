import { Grounded } from "@sajalydv/grounded-sdk";

import { ADDR, publicClient } from "./gig";

// Reads only. Scores come from the chain, never from our DB.
export const grounded = new Grounded({
  chain: "monad-testnet",
  // the linked SDK resolves its own viem copy, so the client types differ nominally
  publicClient: publicClient as never,
  addresses: {
    groundedReputation: ADDR.grounded,
    receiptRegistry: ADDR.receipts,
    receiptRouter: ADDR.router,
    reviewerRegistry: ADDR.reviewers,
    erc8004Identity: ADDR.identity,
    usdc: ADDR.usdc,
  },
});
