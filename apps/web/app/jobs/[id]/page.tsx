"use client";

import type { ScoreResult } from "@sajalydv/grounded-sdk";
import { CheckCircleIcon, CircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { keccak256, parseEventLogs, parseUnits, toHex, zeroHash } from "viem";

import {
  ADDR,
  GROUNDED_SITE,
  ZERO,
  escrowAbi,
  groundedAbi,
  identityAbi,
  proposalMessage,
  publicClient,
  readJob,
  signRouterPull,
  findFrontRunReceipt,
  usdc as fmt,
  type OnchainJob,
} from "@/lib/gig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { categoryLabel } from "@/lib/categories";
import { grounded } from "@/lib/grounded";
import { cn } from "@/lib/utils";
import { useWallet } from "@/lib/wallet";
import { RateBox } from "./RateBox";

interface Text { title: string; body: string; verified: boolean; category?: string }
interface Proposal { agent_id: string; pitch: string; score?: ScoreResult | null }

const receiptKey = (id: bigint) => `gigtrust:receipt:${id}`;
const when = (t: number) => new Date(t * 1000).toLocaleString();

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const jobId = BigInt(use(params).id);
  const { account, wallet, write } = useWallet();
  const [job, setJob] = useState<OnchainJob | null>(null);
  const [text, setText] = useState<Text | null>(null);
  const [stats, setStats] = useState<readonly [number, number, number] | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [pitch, setPitch] = useState("");
  const [share, setShare] = useState("");
  const [meets, setMeets] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [receiptId, setReceiptId] = useState<bigint | null>(null);

  const load = useCallback(async () => {
    const j = await readJob(jobId);
    setJob(j);
    if (j) publicClient.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: "clientStats", args: [j.client] }).then(setStats);
    fetch(`/api/jobs/${jobId}`).then((r) => (r.ok ? r.json() : null)).then(setText);
    // proposals ranked by grounded (paid-only) reputation, never by anything in our DB
    fetch(`/api/jobs/${jobId}/proposals`)
      .then((r) => (r.ok ? r.json() : []))
      .then(async (ps: Proposal[]) => {
        const scored = await Promise.all(ps.map(async (p) => ({ ...p, score: await grounded.score(p.agent_id).catch(() => null) })));
        setProposals(scored.sort((a, b) => (b.score?.score ?? -1) * (b.score?.reviewers ?? 0) - (a.score?.score ?? -1) * (a.score?.reviewers ?? 0)));
      });
    const saved = localStorage.getItem(receiptKey(jobId));
    if (saved) setReceiptId(BigInt(saved));
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  // tell the freelancer before they try: does this agent meet the bar?
  useEffect(() => {
    setMeets(null);
    if (!job || !/^\d+$/.test(agentInput) || job.status !== "Funded") return;
    if (job.minScore === 0 && job.minReviewers === 0) return setMeets(true);
    publicClient
      .readContract({ address: ADDR.grounded, abi: groundedAbi, functionName: "meets", args: [BigInt(agentInput), job.minScore, job.minReviewers] })
      .then(setMeets, () => setMeets(null));
  }, [agentInput, job]);

  const act = (fn: () => Promise<void>) => async () => {
    setMsg("Waiting for wallet…");
    try { await fn(); setMsg("Done."); toast.success("Done"); await load(); }
    catch (e) {
      const m = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
      setMsg(m);
      toast.error(m.length > 140 ? `${m.slice(0, 140)}…` : m);
    }
  };

  if (!job) {
    return text === null ? (
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-10 sm:px-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    ) : (
      <p className="mx-auto max-w-7xl px-4 py-10 text-muted-foreground sm:px-6">Job not found onchain.</p>
    );
  }

  const me = account?.toLowerCase();
  const isClient = me === job.client.toLowerCase();
  const isArbiter = job.arbiter !== ZERO && me === job.arbiter.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const reviewEnds = job.deliveredAt + 7 * 86400;
  const agent = BigInt(/^\d+$/.test(agentInput) ? agentInput : "0");
  const tx = (functionName: string, args: readonly unknown[]) => write({ address: ADDR.escrow, abi: escrowAbi, functionName, args });
  const needWallet = () => {
    if (!wallet || !account) throw new Error("Connect a wallet first");
    return { wallet, account };
  };
  const payoutWalletSet = async () => {
    const w = await publicClient.readContract({ address: ADDR.identity, abi: identityAbi, functionName: "getAgentWallet", args: [job.agentId] });
    if (w === ZERO) throw new Error("Freelancer has no payout wallet set; they must set one first");
  };
  // The router relays a payment signature for anyone. If someone front-ran ours, the freelancer was paid from
  // the client's wallet and our tx reverted: prove it with that receipt and take the escrowed copy back.
  const payOrRecover = async (account: `0x${string}`, value: bigint, send: () => ReturnType<typeof tx>, event: "JobReleased" | "JobResolved") => {
    try {
      const rc = await send();
      keepReceipt(parseEventLogs({ abi: escrowAbi, eventName: event, logs: rc.logs })[0].args.receiptId);
    } catch (e) {
      const id = await findFrontRunReceipt(account, job.agentId, value);
      if (id === undefined) throw e;
      toast.info("Your payment was relayed by someone else. Reclaiming the escrowed copy…");
      await tx("claimPaid", [jobId, id]);
      keepReceipt(id);
    }
  };
  const keepReceipt = (id: bigint) => {
    localStorage.setItem(receiptKey(jobId), id.toString());
    setReceiptId(id);
  };

  const apply = act(async () => {
    const { wallet, account } = needWallet();
    const signature = await wallet.signMessage({ account, message: proposalMessage(String(jobId), agentInput, pitch) });
    const r = await fetch(`/api/jobs/${jobId}/proposals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: agentInput, pitch, signer: account, signature }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
  });
  const deliver = act(async () => {
    const link = prompt("Delivery link (hashed onchain)") ?? "";
    await tx("deliver", [jobId, keccak256(toHex(link))]);
  });
  const release = act(async () => {
    const { wallet, account } = needWallet();
    await payoutWalletSet();
    const s = await signRouterPull(wallet, account, job.agentId, job.amount);
    await payOrRecover(account, job.amount, () => tx("release", [jobId, 0n, s.validBefore, s.salt, s.signature]), "JobReleased");
  });
  const dispute = act(async () => {
    const reason = prompt("What is wrong with the delivery? (hashed onchain, keep a copy)") ?? "";
    await tx("dispute", [jobId, keccak256(toHex(reason))]);
  });
  const offer = act(async () => { await tx("offerSettlement", [jobId, parseUnits(share || "0", 6)]); });
  const settle = act(async () => {
    const { wallet, account } = needWallet();
    if (job.offer === 0n) return void (await tx("settle", [jobId, 0n, 0n, 0n, zeroHash, "0x"]));
    await payoutWalletSet();
    const s = await signRouterPull(wallet, account, job.agentId, job.offer);
    await payOrRecover(account, job.offer, () => tx("settle", [jobId, job.offer, 0n, s.validBefore, s.salt, s.signature]), "JobResolved");
  });
  const rule = act(async () => { await tx("rule", [jobId, parseUnits(share || "0", 6)]); });
  const simple = (fn: "autoRelease" | "refund" | "resolveTimeout") => act(async () => { await tx(fn, [jobId]); });


  const FLOW = ["Funded", "Accepted", "Delivered", "Released"] as const;
  const flowIdx = job.status === "AutoReleased" ? 3 : FLOW.indexOf(job.status as (typeof FLOW)[number]);
  const side = job.status === "Disputed" || job.status === "Resolved" || job.status === "Refunded";
  const panel = "glass rounded-xl p-6 space-y-4";
  const btn = "rounded-full";

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        {text?.category && <p className="mb-2 text-sm text-muted-foreground">{categoryLabel(text.category)}</p>}
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {text?.title ?? `Job #${jobId}`} <span className="pill align-middle">{job.status}</span>
        </h1>
        <ol className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" aria-label="Job progress">
          {FLOW.map((f, i) => {
            const done = !side && i <= flowIdx;
            return (
              <li key={f} className={cn("inline-flex items-center gap-1.5", done ? "text-primary" : "text-muted-foreground")}>
                {done ? <CheckCircleIcon weight="fill" className="size-4" /> : <CircleIcon className="size-4" />}
                {f}
              </li>
            );
          })}
          {side && (
            <li className="inline-flex items-center gap-1.5 text-destructive">
              <WarningCircleIcon weight="fill" className="size-4" />
              {job.status}
            </li>
          )}
        </ol>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          {text && !text.verified && (
            <p className="bad rounded-xl border border-destructive/50 p-4">Offchain text does not match the onchain hash. Do not trust it.</p>
          )}
          {text && <p className="glass whitespace-pre-wrap rounded-xl p-6 leading-relaxed">{text.body}</p>}
          <div className={panel}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <b className="font-mono text-3xl tabular-nums">{fmt(job.amount)} USDC</b>
              <span className="text-sm text-muted-foreground">held in escrow</span>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-mono">{job.client.slice(0, 8)}…{job.client.slice(-4)}</dd>
                {stats && (
                  <dd className={stats[2] > stats[1] ? "bad" : "muted"}>
                    client record: {stats[0]} posted, {stats[1]} paid, {stats[2]} disputed
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-muted-foreground">Trust bar</dt>
                <dd>score ≥ {job.minScore} from ≥ {job.minReviewers} paying reviewers</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Timing</dt>
                <dd>accept by {when(job.acceptBy)}</dd>
                <dd className="text-muted-foreground">deliver within {Math.round(job.deliverWithin / 86400)} days of accepting</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Arbiter</dt>
                <dd>{job.arbiter === ZERO ? "none (unresolved disputes split 50/50)" : <code className="break-all">{job.arbiter}</code>}</dd>
                {job.agentId > 0n && (
                  <dd>freelancer <Link className="text-primary hover:underline" href={`/freelancers/${job.agentId}`}>agent #{String(job.agentId)}</Link></dd>
                )}
              </div>
            </dl>
          </div>

          {job.status === "Funded" && proposals.length > 0 && (
            <div className={panel}>
              <h2 className="text-lg font-semibold">Proposals (ranked by grounded reputation)</h2>
              <div className="space-y-3">
                {proposals.map((p) => (
                  <div key={p.agent_id} className="rounded-lg border border-border/60 p-4 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-foreground">
                      agent <Link className="font-mono text-primary hover:underline" href={`/freelancers/${p.agent_id}`}>#{p.agent_id}</Link>
                      {p.score && p.score.reviewers > 0 ? (
                        <b className="rounded-full bg-accent px-2.5 py-0.5 text-xs text-accent-foreground">
                          {p.score.score}/100 · {p.score.reviewers} paying reviewers · {p.score.disputes} disputes
                        </b>
                      ) : (
                        <b className="rounded-full border border-border px-2.5 py-0.5 text-xs">new</b>
                      )}
                      {p.score?.ownerChangedAt && <span className="bad text-xs">owner changed {p.score.ownerChangedAt.toLocaleDateString()}</span>}
                    </div>
                    <div className="muted">{p.pitch}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          {job.status === "Funded" && (
            <div className={panel}>
              <h2 className="text-lg font-semibold">Apply / accept</h2>
              <div className="space-y-2">
                <Label htmlFor="agent">Your ERC-8004 agent id</Label>
                <Input id="agent" inputMode="numeric" value={agentInput} onChange={(e) => setAgentInput(e.target.value)} />
              </div>
              {meets === false && (
                <p className="bad text-sm">
                  This agent does not meet the bar (score ≥ {job.minScore}, ≥ {job.minReviewers} paying reviewers); accepting would revert{" "}
                  <code>AgentNotTrusted</code>. <Link className="underline" href={`/freelancers/${agentInput}`}>See its score</Link>.
                </p>
              )}
              {meets === true && <p className="ok text-sm">Meets the bar.</p>}
              <div className="space-y-2">
                <Label htmlFor="pitch">Pitch (offchain, signed by your agent&apos;s wallet)</Label>
                <Textarea id="pitch" rows={3} value={pitch} onChange={(e) => setPitch(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className={btn} variant="outline" onClick={apply} disabled={!agentInput || !pitch}>Sign &amp; send proposal</Button>
                <Button className={btn} onClick={act(async () => { await tx("accept", [jobId, agent]); })} disabled={!agentInput || meets === false}>Accept job (onchain)</Button>
              </div>
              {isClient && now > job.acceptBy && <Button className={btn} variant="outline" onClick={simple("refund")}>Refund (nobody accepted)</Button>}
            </div>
          )}

          {job.status === "Accepted" && (
            <div className={panel}>
              <p className="muted text-sm">Deliver by {when(job.deadline)}.</p>
              <div className="flex flex-wrap gap-2">
                <Button className={btn} onClick={deliver}>Mark delivered (freelancer)</Button>
                {isClient && <Button className={btn} variant="outline" onClick={release}>Release payment (client)</Button>}
                {isClient && now > job.deadline && <Button className={btn} variant="outline" onClick={simple("refund")}>Refund: deadline missed</Button>}
                {!isClient && <Button className={btn} variant="outline" onClick={simple("refund")}>Withdraw from job (freelancer)</Button>}
              </div>
            </div>
          )}

          {job.status === "Delivered" && (
            <div className={panel}>
              {isClient && now <= reviewEnds && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button className={btn} onClick={release}>Release payment &amp; get a receipt to rate</Button>
                    <Button className={btn} variant="destructive" onClick={dispute}>Dispute delivery</Button>
                  </div>
                  <p className="muted text-sm">Review window ends {when(reviewEnds)}. After that it auto-releases to the freelancer.</p>
                </>
              )}
              {now > reviewEnds && <Button className={btn} onClick={simple("autoRelease")}>Auto-release to freelancer (no receipt, no rating)</Button>}
              {!isClient && now <= reviewEnds && <p className="muted text-sm">Client has until {when(reviewEnds)} to release or dispute.</p>}
            </div>
          )}

          {job.status === "Disputed" && (
            <div className={panel}>
              <h2 className="text-lg font-semibold">Dispute</h2>
              <p className="muted text-sm">
                Settle on a split, or {job.arbiter === ZERO ? "nobody decides" : "the arbiter decides"}. If unresolved by {when(job.deadline)},
                anyone can split it 50/50.
              </p>
              {job.offered && <p>Freelancer&apos;s offer: <b>{fmt(job.offer)} USDC</b> to freelancer, {fmt(job.amount - job.offer)} back to client.</p>}
              {!isClient && !isArbiter && (
                <div className="flex flex-wrap gap-2">
                  <Input value={share} onChange={(e) => setShare(e.target.value)} placeholder="USDC you'll settle for" className="flex-1" />
                  <Button className={btn} onClick={offer}>Offer settlement (freelancer)</Button>
                </div>
              )}
              {isClient && job.offered && <Button className={btn} onClick={settle}>Accept offer{job.offer > 0n ? " & get a receipt to rate" : ""}</Button>}
              {isArbiter && (
                <div className="flex flex-wrap gap-2">
                  <Input value={share} onChange={(e) => setShare(e.target.value)} placeholder="USDC to freelancer" className="flex-1" />
                  <Button className={btn} onClick={rule}>Rule (arbiter)</Button>
                </div>
              )}
              {now > job.deadline && <Button className={btn} variant="outline" onClick={simple("resolveTimeout")}>Split 50/50 (deadline passed)</Button>}
            </div>
          )}

          {(job.status === "Released" || job.status === "Resolved") && isClient &&
            (receiptId !== null && receiptId > 0n ? (
              <RateBox receiptId={receiptId} agentId={job.agentId} tag={job.status === "Resolved" ? "dispute" : "quality"} />
            ) : (
              <p className="muted glass rounded-xl p-6 text-sm">
                No receipt cached in this browser. Ratings need a receipt from release or settlement; see{" "}
                <a className="text-primary underline" href={`${GROUNDED_SITE}/agents/${job.agentId}`}>Grounded</a>.
              </p>
            ))}
          {job.status === "AutoReleased" && <p className="muted glass rounded-xl p-6 text-sm">Auto-released: no receipt was issued, so this job cannot be rated.</p>}
          {msg && <p className="muted text-sm">{msg}</p>}
        </aside>
      </div>
    </div>
  );
}
