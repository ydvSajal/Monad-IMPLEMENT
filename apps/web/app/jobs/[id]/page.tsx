"use client";

import type { ScoreResult } from "@sajalydv/grounded-sdk";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
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
  usdc as fmt,
  type OnchainJob,
} from "@/lib/gig";
import { grounded } from "@/lib/grounded";
import { useWallet } from "@/lib/wallet";
import { RateBox } from "./RateBox";

interface Text { title: string; body: string; verified: boolean }
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
    try { await fn(); setMsg("Done."); await load(); }
    catch (e) { setMsg(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)); }
  };

  if (!job) return <p className="muted">{text === null ? "Loading…" : "Job not found onchain."}</p>;

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
    const rc = await tx("release", [jobId, 0n, s.validBefore, s.salt, s.signature]);
    keepReceipt(parseEventLogs({ abi: escrowAbi, eventName: "JobReleased", logs: rc.logs })[0].args.receiptId);
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
    const rc = await tx("settle", [jobId, job.offer, 0n, s.validBefore, s.salt, s.signature]);
    keepReceipt(parseEventLogs({ abi: escrowAbi, eventName: "JobResolved", logs: rc.logs })[0].args.receiptId);
  });
  const rule = act(async () => { await tx("rule", [jobId, parseUnits(share || "0", 6)]); });
  const simple = (fn: "autoRelease" | "refund" | "resolveTimeout") => act(async () => { await tx(fn, [jobId]); });

  return (
    <>
      <h1>{text?.title ?? `Job #${jobId}`} <span className="pill">{job.status}</span></h1>
      {text && !text.verified && <p className="bad">Offchain text does not match the onchain hash. Do not trust it.</p>}
      {text && <pre>{text.body}</pre>}
      <div className="card">
        <b>{fmt(job.amount)} USDC</b> held in escrow · client <code>{job.client.slice(0, 8)}…</code>
        {stats && (
          <span className={stats[2] > stats[1] ? "bad" : "muted"}>
            {" "}· client record: {stats[0]} posted, {stats[1]} paid, {stats[2]} disputed
          </span>
        )}
        <div className="muted">
          Trust bar: score ≥ {job.minScore} from ≥ {job.minReviewers} paying reviewers · accept by {when(job.acceptBy)} ·
          deliver within {Math.round(job.deliverWithin / 86400)} days of accepting
        </div>
        <div className="muted">
          Arbiter: {job.arbiter === ZERO ? "none (unresolved disputes split 50/50)" : <code>{job.arbiter}</code>}
          {job.agentId > 0n && <> · freelancer <Link href={`/freelancers/${job.agentId}`}>agent #{String(job.agentId)}</Link></>}
        </div>
      </div>

      {job.status === "Funded" && (
        <div className="card">
          <h2>Apply / accept</h2>
          <label>Your ERC-8004 agent id</label>
          <input value={agentInput} onChange={(e) => setAgentInput(e.target.value)} />
          {meets === false && (
            <p className="bad">
              This agent does not meet the bar (score ≥ {job.minScore}, ≥ {job.minReviewers} paying reviewers); accepting would revert{" "}
              <code>AgentNotTrusted</code>. <Link href={`/freelancers/${agentInput}`}>See its score</Link>.
            </p>
          )}
          {meets === true && <p className="ok">Meets the bar.</p>}
          <label>Pitch (offchain, signed by your agent&apos;s wallet)</label>
          <textarea rows={3} value={pitch} onChange={(e) => setPitch(e.target.value)} />
          <div className="row">
            <button onClick={apply} disabled={!agentInput || !pitch}>Sign &amp; send proposal</button>
            <button onClick={act(async () => { await tx("accept", [jobId, agent]); })} disabled={!agentInput || meets === false}>Accept job (onchain)</button>
          </div>
          {proposals.length > 0 && <h2>Proposals (ranked by grounded reputation)</h2>}
          {proposals.map((p) => (
            <div key={p.agent_id} className="muted">
              agent <Link href={`/freelancers/${p.agent_id}`}>#{p.agent_id}</Link>{" "}
              {p.score && p.score.reviewers > 0
                ? <b>{p.score.score}/100 · {p.score.reviewers} paying reviewers · {p.score.disputes} disputes</b>
                : <b>new</b>}
              {p.score?.ownerChangedAt && <span className="bad"> · owner changed {p.score.ownerChangedAt.toLocaleDateString()}</span>}
              : {p.pitch}
            </div>
          ))}
          {isClient && now > job.acceptBy && <button onClick={simple("refund")}>Refund (nobody accepted)</button>}
        </div>
      )}

      {job.status === "Accepted" && (
        <div className="card">
          <p className="muted">Deliver by {when(job.deadline)}.</p>
          <button onClick={deliver}>Mark delivered (freelancer)</button>{" "}
          {isClient && <button onClick={release}>Release payment (client)</button>}{" "}
          {isClient && now > job.deadline && <button onClick={simple("refund")}>Refund: deadline missed</button>}
          {!isClient && <button onClick={simple("refund")}>Withdraw from job (freelancer)</button>}
        </div>
      )}

      {job.status === "Delivered" && (
        <div className="card">
          {isClient && now <= reviewEnds && (
            <>
              <button onClick={release}>Release payment &amp; get a receipt to rate</button>{" "}
              <button onClick={dispute}>Dispute delivery</button>
              <p className="muted">Review window ends {when(reviewEnds)}. After that it auto-releases to the freelancer.</p>
            </>
          )}
          {now > reviewEnds && <button onClick={simple("autoRelease")}>Auto-release to freelancer (no receipt, no rating)</button>}
          {!isClient && now <= reviewEnds && <p className="muted">Client has until {when(reviewEnds)} to release or dispute.</p>}
        </div>
      )}

      {job.status === "Disputed" && (
        <div className="card">
          <h2>Dispute</h2>
          <p className="muted">
            Settle on a split, or {job.arbiter === ZERO ? "nobody decides" : "the arbiter decides"}. If unresolved by {when(job.deadline)},
            anyone can split it 50/50.
          </p>
          {job.offered && <p>Freelancer&apos;s offer: <b>{fmt(job.offer)} USDC</b> to freelancer, {fmt(job.amount - job.offer)} back to client.</p>}
          {!isClient && !isArbiter && (
            <div className="row">
              <input value={share} onChange={(e) => setShare(e.target.value)} placeholder="USDC you'll settle for" />
              <button onClick={offer}>Offer settlement (freelancer)</button>
            </div>
          )}
          {isClient && job.offered && <button onClick={settle}>Accept offer{job.offer > 0n ? " & get a receipt to rate" : ""}</button>}
          {isArbiter && (
            <div className="row">
              <input value={share} onChange={(e) => setShare(e.target.value)} placeholder="USDC to freelancer" />
              <button onClick={rule}>Rule (arbiter)</button>
            </div>
          )}
          {now > job.deadline && <button onClick={simple("resolveTimeout")}>Split 50/50 (deadline passed)</button>}
        </div>
      )}

      {(job.status === "Released" || job.status === "Resolved") && isClient && (
        receiptId !== null && receiptId > 0n
          ? <RateBox receiptId={receiptId} agentId={job.agentId} tag={job.status === "Resolved" ? "dispute" : "quality"} />
          : <p className="muted">No receipt cached in this browser. Ratings need a receipt from release or settlement; see <a href={`${GROUNDED_SITE}/agents/${job.agentId}`}>Grounded</a>.</p>
      )}
      {job.status === "AutoReleased" && <p className="muted">Auto-released: no receipt was issued, so this job cannot be rated.</p>}
      {msg && <p className="muted">{msg}</p>}
    </>
  );
}
