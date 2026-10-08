"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { isAddress, parseEventLogs, parseUnits, type Address } from "viem";

import { SignInGate } from "@/components/SignInGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES } from "@/lib/categories";
import { ADDR, ZERO, escrowAbi, metaHashOf, publicClient, usdc as fmt, usdcAbi } from "@/lib/gig";
import { useWallet } from "@/lib/wallet";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="glass space-y-4 rounded-xl p-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="muted mt-1 text-sm">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export default function NewJob() {
  const { account, write } = useWallet();
  const router = useRouter();
  const [f, setF] = useState({ title: "", body: "", category: "development", amount: "50", minScore: "0", minReviewers: "0", days: "7", deliverDays: "14", arbiter: "" });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const feeEstimate = (() => {
    const n = Number(f.amount);
    return Number.isFinite(n) && n > 0 ? { fee: n * 0.05, total: n * 1.05 } : null;
  })();

  const submit = async () => {
    setBusy(true);
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
        body: JSON.stringify({ chainJobId: id.toString(), title: f.title, body: f.body, category: f.category }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Job funded and posted");
      router.push(`/jobs/${id}`);
    } catch (e) {
      const m = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
      setStatus(m);
      toast.error(m.length > 140 ? `${m.slice(0, 140)}…` : m);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Post a job</h1>
      <p className="mt-1 mb-8 text-muted-foreground">Fund the budget into escrow. It is released only when you approve the delivery.</p>
      <SignInGate title="Sign in to post a job">
        <div className="space-y-6">
          <Section title="The work">
            <Field label="Title">
              <Input value={f.title} onChange={set("title")} maxLength={200} />
            </Field>
            <Field label="Category">
              <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c.slug} value={c.slug}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Description">
              <Textarea rows={6} value={f.body} onChange={set("body")} />
            </Field>
          </Section>

          <Section title="Budget and deadlines">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Budget (USDC, min 0.01)">
                <Input inputMode="decimal" value={f.amount} onChange={set("amount")} />
              </Field>
              <Field label="Accept-by (days)">
                <Input inputMode="numeric" value={f.days} onChange={set("days")} />
              </Field>
              <Field label="Deliver within (days after accept)">
                <Input inputMode="numeric" value={f.deliverDays} onChange={set("deliverDays")} />
              </Field>
            </div>
            {feeEstimate && (
              <p className="muted text-sm">
                You deposit <b className="font-mono text-foreground">{feeEstimate.total.toFixed(2)} USDC</b> (budget plus {feeEstimate.fee.toFixed(2)} platform fee). The fee is refunded if nobody accepts.
              </p>
            )}
          </Section>

          <Section title="Trust bar" hint="0 and 0 means open to new talent. The contract refuses freelancers who do not meet the bar.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trust bar: min score (0–100)">
                <Input inputMode="numeric" value={f.minScore} onChange={set("minScore")} />
              </Field>
              <Field label="Trust bar: min paying reviewers">
                <Input inputMode="numeric" value={f.minReviewers} onChange={set("minReviewers")} />
              </Field>
            </div>
          </Section>

          <Section
            title="If something goes wrong"
            hint="Miss the delivery deadline and you can take a full refund. If you dispute a delivery, you and the freelancer can settle on any split; otherwise the arbiter decides, and with no arbiter it splits 50/50 after 7 days. Freelancers see the arbiter before accepting."
          >
            <Field label="Arbiter address (optional)">
              <Input value={f.arbiter} onChange={set("arbiter")} placeholder="empty = no arbiter" />
            </Field>
          </Section>

          <div className="flex flex-wrap items-center gap-4">
            <Button size="lg" className="rounded-full" onClick={submit} disabled={!f.title || !f.body || busy}>Fund and post</Button>
            <p className="muted text-sm">{status}</p>
          </div>
        </div>
      </SignInGate>
    </div>
  );
}
