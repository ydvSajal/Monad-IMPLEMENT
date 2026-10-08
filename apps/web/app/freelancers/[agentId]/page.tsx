import { ArrowSquareOutIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react/ssr";

import { ADDR, GROUNDED_SITE, ZERO, identityAbi, publicClient } from "@/lib/gig";
import { grounded } from "@/lib/grounded";

export const dynamic = "force-dynamic";

export default async function Freelancer({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  if (!/^\d+$/.test(agentId)) return <p className="bad mx-auto max-w-7xl px-4 py-10 sm:px-6">Bad agent id.</p>;
  const id = BigInt(agentId);

  const [score, raw, wallet] = await Promise.all([
    grounded.score(id),
    grounded.rawScore(id).catch(() => null),
    publicClient.readContract({ address: ADDR.identity, abi: identityAbi, functionName: "getAgentWallet", args: [id] }).catch(() => null),
  ]);

  const unrated = score.confidence === "none";
  const hasWallet = !!wallet && wallet !== ZERO;
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Agent #{agentId}</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-5">
        <div className="glass relative overflow-hidden rounded-xl p-8 md:col-span-3">
          <div className="pointer-events-none absolute -right-12 -top-12 size-52 rounded-full bg-primary/15 blur-3xl" />
          <div className="text-sm text-muted-foreground">Grounded score (paid reviews only)</div>
          <div className="mt-2 font-mono text-6xl font-semibold tabular-nums">{unrated ? "New" : score.score}</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {unrated ? "Unrated. New is not bad." : `${score.reviewers} paying reviewers, ${score.confidence} confidence`}
          </div>
        </div>
        <div className="glass rounded-xl p-8 md:col-span-2">
          <div className="text-sm text-muted-foreground">Raw ERC-8004 stars (anyone can post)</div>
          <div className="mt-2 font-mono text-4xl font-semibold tabular-nums">{raw ?? "-"}</div>
          <div className="mt-2 text-sm text-muted-foreground">Not payment-backed. Compare.</div>
        </div>
      </div>

      <p className={`glass mt-4 flex items-start gap-2 rounded-xl p-4 text-sm ${hasWallet ? "ok" : "bad"}`}>
        {hasWallet ? <CheckCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0" /> : <WarningCircleIcon weight="fill" className="mt-0.5 size-4 shrink-0" />}
        <span className="break-all">{hasWallet ? `Payout wallet ${wallet}` : "No payout wallet set: cannot accept jobs."}</span>
      </p>
      <p className="mt-6">
        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`${GROUNDED_SITE}/agents/${agentId}`}>
          Same score on the public Grounded explorer <ArrowSquareOutIcon />
        </a>
      </p>
    </div>
  );
}
