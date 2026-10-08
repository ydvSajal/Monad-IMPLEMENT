"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress, parseEventLogs, parseUnits, type Address } from "viem";

import { ADDR, ZERO, escrowAbi, metaHashOf, publicClient, usdc as fmt, usdcAbi } from "@/lib/gig";
import { useWallet } from "@/lib/wallet";

export default function NewJob() {
  const { account, write } = useWallet();
  const router = useRouter();
  const [f, setF] = useState({ title: "", body: "", amount: "50", minScore: "0", minReviewers: "0", days: "7", deliverDays: "14", arbiter: "" });
  const [status, setStatus] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    try {
      if (!account) throw new Error("Connect a wallet first");
      if (!ADDR.escrow) throw new Error("Escrow not deployed (NEXT_PUBLIC_GIG_ESCROW)");
      if (f.arbiter && !isAddress(f.arbiter)) throw new Error("Arbiter must be an address or empty");
      const amount = parseUnits(f.amount, 6);
      const fee = (await publicClient.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: "feeOf", args: [amount] })) as bigint;
      const allowance = (await publicClient.readContract({ address: ADDR.usdc, abi: usdcAbi, functionName: "allowance", args: [account, ADDR.escrow] })) as bigint;
      if (allowance < amount + fee) {
        setStatus("Approve USDC…");
        await write({ address: ADDR.usdc, abi: usdcAbi, functionName: "approve", args: [ADDR.escrow, amount + fee] });
      }
      setStatus(`Funding ${fmt(amount + fee)} USDC (${fmt(fee)} platform fee)…`);
      const acceptBy = BigInt(Math.floor(Date.now() / 1000) + Number(f.days) * 86400);
      const rc = await write({
        address: ADDR.escrow,
        abi: escrowAbi,
        functionName: "create",
        args: [amount, Number(f.minScore), Number(f.minReviewers), acceptBy, Number(f.deliverDays) * 86400, (f.arbiter || ZERO) as Address, metaHashOf(f.title, f.body)],
      });
      const [ev] = parseEventLogs({ abi: escrowAbi, eventName: "JobCreated", logs: rc.logs });
      const id = ev.args.jobId;
      setStatus("Saving job text…");
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainJobId: id.toString(), title: f.title, body: f.body }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      router.push(`/jobs/${id}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <h1>Post a job</h1>
      <label>Title</label>
      <input value={f.title} onChange={set("title")} maxLength={200} />
      <label>Description</label>
      <textarea rows={6} value={f.body} onChange={set("body")} />
      <div className="row">
        <div><label>Budget (USDC, min 0.01)</label><input value={f.amount} onChange={set("amount")} /></div>
        <div><label>Accept-by (days)</label><input value={f.days} onChange={set("days")} /></div>
      </div>
      <div className="row">
        <div><label>Trust bar: min score (0–100)</label><input value={f.minScore} onChange={set("minScore")} /></div>
        <div><label>Trust bar: min paying reviewers</label><input value={f.minReviewers} onChange={set("minReviewers")} /></div>
      </div>
      <p className="muted">0 and 0 = open to new talent. You deposit budget + 5% fee; the fee is refunded if nobody accepts.</p>
      <div className="row">
        <div><label>Deliver within (days after accept)</label><input value={f.deliverDays} onChange={set("deliverDays")} /></div>
        <div><label>Arbiter address (optional)</label><input value={f.arbiter} onChange={set("arbiter")} placeholder="empty = no arbiter" /></div>
      </div>
      <p className="muted">
        Miss the delivery deadline and you can take a full refund. If you dispute a delivery, you and the freelancer can settle on any split;
        otherwise the arbiter decides, and with no arbiter it splits 50/50 after 7 days. Freelancers see the arbiter before accepting.
      </p>
      <button onClick={submit} disabled={!f.title || !f.body}>Fund and post</button>
      <p className="muted">{status}</p>
    </>
  );
}
