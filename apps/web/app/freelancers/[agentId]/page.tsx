import { ADDR, GROUNDED_SITE, identityAbi, publicClient } from "@/lib/gig";
import { grounded } from "@/lib/grounded";

export const dynamic = "force-dynamic";

export default async function Freelancer({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  if (!/^\d+$/.test(agentId)) return <p className="bad">Bad agent id.</p>;
  const id = BigInt(agentId);

  const [score, raw, wallet] = await Promise.all([
    grounded.score(id),
    grounded.rawScore(id).catch(() => null),
    publicClient.readContract({ address: ADDR.identity, abi: identityAbi, functionName: "getAgentWallet", args: [id] }).catch(() => null),
  ]);

  const unrated = score.confidence === "none";
  return (
    <>
      <h1>Agent #{agentId}</h1>
      <div className="row">
        <div className="card">
          <div className="muted">Grounded score (paid reviews only)</div>
          <div className="big">{unrated ? "New" : score.score}</div>
          <div className="muted">
            {unrated ? "Unrated. New is not bad." : `${score.reviewers} paying reviewers · ${score.confidence} confidence`}
          </div>
        </div>
        <div className="card">
          <div className="muted">Raw ERC-8004 stars (anyone can post)</div>
          <div className="big">{raw ?? "–"}</div>
          <div className="muted">Not payment-backed. Compare.</div>
        </div>
      </div>
      <p className={wallet && wallet !== "0x0000000000000000000000000000000000000000" ? "ok" : "bad"}>
        {wallet && wallet !== "0x0000000000000000000000000000000000000000" ? `Payout wallet ${wallet}` : "No payout wallet set: cannot accept jobs."}
      </p>
      <p><a href={`${GROUNDED_SITE}/agents/${agentId}`}>Same score on the public Grounded explorer →</a></p>
    </>
  );
}
