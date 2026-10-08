"use client";

import { Grounded, BrowserPasskey } from "@sajalydv/grounded-sdk";
import { useState } from "react";

import { ADDR, GROUNDED_SITE, monad, publicClient } from "@/lib/gig";
import { useWallet } from "@/lib/wallet";

const RP_ID = "grounded.sajal.sbs"; // Grounded's ReviewerRegistry only verifies passkeys for this rpId

/**
 * Rating needs a passkey whose rpId is Grounded's. A browser only allows that on grounded.sajal.sbs or a
 * subdomain of it, so on any other host we explain it and link out instead of failing mid-flow.
 */
export function RateBox({ receiptId, agentId, tag }: { receiptId: bigint; agentId: bigint; tag: "quality" | "dispute" }) {
  const { wallet } = useWallet();
  const [score, setScore] = useState(90);
  const [msg, setMsg] = useState("");
  const hostOk = typeof window !== "undefined" && (location.hostname === RP_ID || location.hostname.endsWith(`.${RP_ID}`));

  const rate = async () => {
    try {
      if (!wallet) throw new Error("Connect a wallet first");
      const g = new Grounded({
        chain: "monad-testnet",
        publicClient: publicClient as never, // linked SDK has its own viem copy
        walletClient: wallet as never,
        addresses: { groundedReputation: ADDR.grounded, receiptRegistry: ADDR.receipts, receiptRouter: ADDR.router, reviewerRegistry: ADDR.reviewers, erc8004Identity: ADDR.identity, usdc: ADDR.usdc },
      });
      setMsg("Creating and binding passkey (first time only)…");
      const key = await BrowserPasskey.create({ rpId: RP_ID, name: "GigTrust client" });
      await g.bindPasskey(key);
      setMsg("Rating…");
      await g.rate({ receiptId, score, tag, authenticator: key });
      setMsg("Rated. The score is now updated on Grounded.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  void monad;
  return (
    <div className="card">
      <h2>Rate this freelancer</h2>
      <p>Receipt <b>#{String(receiptId)}</b> was issued with you as payer. One rating per receipt, signed with a passkey.</p>
      {hostOk ? (
        <>
          <input type="number" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} />
          <button onClick={rate}>Sign with passkey and rate</button>
        </>
      ) : (
        <p className="muted">
          Passkeys are bound to <code>{RP_ID}</code>, so rating works from a page on that domain. See{" "}
          <a href={`${GROUNDED_SITE}/agents/${agentId}`}>agent #{String(agentId)} on Grounded</a>; quote receipt #{String(receiptId)}.
        </p>
      )}
      <p className="muted">{msg}</p>
    </div>
  );
}
