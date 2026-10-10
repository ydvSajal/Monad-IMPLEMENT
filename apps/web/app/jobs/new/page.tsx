"use client";

import { CaretDownIcon, LockKeyIcon, ScalesIcon, SealCheckIcon, SparkleIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { isAddress, parseEventLogs, parseUnits, type Address } from "viem";

import { JobCard } from "@/components/JobCard";
import { SignInGate } from "@/components/SignInGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES } from "@/lib/categories";
import { ADDR, ZERO, escrowAbi, metaHashOf, publicClient, usdc as fmt, usdcAbi } from "@/lib/gig";
import { cn } from "@/lib/utils";
import { useWallet } from "@/lib/wallet";

const HUE: Record<string, string> = {
  design: "var(--hue-pink)",
  development: "var(--hue-blue)",
  "smart-contracts": "var(--hue-violet)",
  writing: "var(--hue-orange)",
  marketing: "var(--hue-green)",
  "data-ai": "var(--hue-teal)",
  other: "var(--muted-foreground)",
};

const TRUST = [
  { id: "open", Icon: SparkleIcon, t: "Open to anyone", d: "New freelancers can accept.", score: "0", reviewers: "0" },
  { id: "proven", Icon: UsersThreeIcon, t: "Proven", d: "Score 50+ from 1 paying client.", score: "50", reviewers: "1" },
  { id: "top", Icon: SealCheckIcon, t: "Top rated", d: "Score 70+ from 3 paying clients.", score: "70", reviewers: "3" },
] as const;

const DAY = 86400;
const dateIn = (days: number) => new Date(Date.now() + days * DAY * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Single-choice row of pills. Native radio semantics, keyboard included. */
function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string; hue?: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            style={on && o.hue ? { borderColor: o.hue, color: o.hue, background: `color-mix(in oklab, ${o.hue} 8%, white)` } : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors active:scale-[0.98]",
              on ? "border-primary bg-accent font-medium text-accent-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border/70 pt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function NewJob() {
  const { account, write } = useWallet();
  const router = useRouter();
  const [f, setF] = useState({ title: "", body: "", category: "development", amount: "50", minScore: "0", minReviewers: "0", days: "7", deliverDays: "14", arbiter: "" });
  const [trust, setTrust] = useState<string>("open");
  const [showArbiter, setShowArbiter] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const n = Number(f.amount);
  const valid = Number.isFinite(n) && n >= 0.01;
  const fee = valid ? n * 0.05 : 0;
  const arbiterBad = f.arbiter !== "" && !isAddress(f.arbiter);
  const ready = f.title.trim() && f.body.trim() && valid && !arbiterBad && !busy;

  const pickTrust = (id: string) => {
    setTrust(id);
    const p = TRUST.find((t) => t.id === id);
    if (p) setF({ ...f, minScore: p.score, minReviewers: p.reviewers });
  };

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
      const acceptBy = BigInt(Math.floor(Date.now() / 1000) + Number(f.days) * DAY);
      const rc = await write({
        address: ADDR.escrow,
        abi: escrowAbi,
        functionName: "create",
        args: [amount, Number(f.minScore), Number(f.minReviewers), acceptBy, Number(f.deliverDays) * DAY, (f.arbiter || ZERO) as Address, metaHashOf(f.title, f.body)],
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
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Post a job</h1>
      <p className="mt-2 mb-10 max-w-xl text-muted-foreground">The budget waits in escrow and moves only when you approve the delivery.</p>
      <SignInGate title="Sign in to post a job">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          {/* ---- the brief */}
          <div className="space-y-8">
            <div className="space-y-2">
              <Label htmlFor="job-title" className="text-sm text-muted-foreground">Title</Label>
              <input
                id="job-title"
                value={f.title}
                onChange={set("title")}
                maxLength={200}
                placeholder="What do you need done?"
                className="w-full border-0 border-b border-border bg-transparent pb-3 text-2xl font-semibold tracking-tight outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary md:text-3xl"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="job-body" className="text-sm text-muted-foreground">Description</Label>
              <textarea
                id="job-body"
                rows={5}
                value={f.body}
                onChange={set("body")}
                placeholder="Scope, deliverables, links, and what done looks like."
                className="w-full resize-y rounded-xl border border-border bg-card p-4 text-base leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-3 focus:ring-ring/15"
              />
            </div>

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Category</p>
              <Chips
                label="Category"
                value={f.category}
                onChange={(v) => setF({ ...f, category: v })}
                options={CATEGORIES.map((c) => ({ v: c.slug, l: c.label, hue: HUE[c.slug] }))}
              />
            </div>

            <Block title="Budget and timing">
              <div className="grid gap-8 sm:grid-cols-2">
                <div className="space-y-3">
                  <Label htmlFor="job-budget" className="text-sm text-muted-foreground">Budget</Label>
                  <div className="relative">
                    <Input id="job-budget" inputMode="decimal" value={f.amount} onChange={set("amount")} className="h-14 rounded-xl pr-16 font-mono text-2xl font-semibold tabular-nums" aria-invalid={!valid} />
                    <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">USDC</span>
                  </div>
                  <Chips label="Quick budget" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} options={["25", "50", "100", "250"].map((v) => ({ v, l: `${v}` }))} />
                  {!valid && <p className="text-sm text-destructive">Minimum is 0.01 USDC.</p>}
                </div>
                <div className="space-y-6">
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Freelancers can accept for</p>
                    <Chips label="Accept window" value={f.days} onChange={(v) => setF({ ...f, days: v })} options={["3", "7", "14", "30"].map((v) => ({ v, l: `${v} days` }))} />
                  </div>
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Deliver within, after accepting</p>
                    <Chips label="Delivery window" value={f.deliverDays} onChange={(v) => setF({ ...f, deliverDays: v })} options={["3", "7", "14", "30"].map((v) => ({ v, l: `${v} days` }))} />
                  </div>
                </div>
              </div>
            </Block>

            <Block title="Who can take it">
              <div role="radiogroup" aria-label="Trust bar" className="grid gap-3 sm:grid-cols-3">
                {TRUST.map(({ id, Icon, t, d }) => {
                  const on = trust === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => pickTrust(id)}
                      className={cn(
                        "rounded-xl border p-4 text-left transition-colors active:scale-[0.99]",
                        on ? "border-primary bg-accent/60 ring-3 ring-ring/10" : "border-border bg-card hover:border-foreground/20",
                      )}
                    >
                      <Icon className={cn("size-6", on ? "text-primary" : "text-muted-foreground")} weight="duotone" />
                      <p className="mt-3 font-medium">{t}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{d}</p>
                    </button>
                  );
                })}
              </div>
              <button type="button" onClick={() => setTrust("custom")} className={cn("text-sm text-primary hover:underline", trust === "custom" && "hidden")}>
                Set a custom bar
              </button>
              {trust === "custom" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="min-score">Min score (0 to 100)</Label>
                    <Input id="min-score" inputMode="numeric" value={f.minScore} onChange={set("minScore")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="min-reviewers">Min paying reviewers</Label>
                    <Input id="min-reviewers" inputMode="numeric" value={f.minReviewers} onChange={set("minReviewers")} />
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground">The contract itself refuses freelancers below the bar.</p>
            </Block>

            <section className="border-t border-border/70 pt-6">
              <button type="button" onClick={() => setShowArbiter((s) => !s)} aria-expanded={showArbiter} className="flex w-full items-center gap-3 text-left">
                <ScalesIcon className="size-5 text-[var(--hue-violet)]" weight="duotone" />
                <span className="flex-1">
                  <span className="block font-medium">If something goes wrong</span>
                  <span className="block text-sm text-muted-foreground">Refunds, disputes and an optional arbiter</span>
                </span>
                <CaretDownIcon className={cn("size-4 text-muted-foreground transition-transform", showArbiter && "rotate-180")} />
              </button>
              {showArbiter && (
                <div className="mt-5 space-y-4 pl-8">
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li>Missed delivery deadline: you take a full refund.</li>
                    <li>Disputed delivery: settle on any split together.</li>
                    <li>No deal in 7 days: the arbiter decides, or it splits 50/50.</li>
                  </ul>
                  <div className="space-y-2">
                    <Label htmlFor="arbiter">Arbiter address (optional)</Label>
                    <Input id="arbiter" value={f.arbiter} onChange={set("arbiter")} placeholder="0x… or leave empty" className="font-mono text-sm" aria-invalid={arbiterBad} />
                    {arbiterBad && <p className="text-sm text-destructive">Not a valid address.</p>}
                    <p className="text-xs text-muted-foreground">Freelancers see the arbiter before accepting.</p>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ---- live preview + deposit, sticky beside the brief */}
          <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
            <div>
              <p className="mb-3 text-sm text-muted-foreground">How freelancers will see it</p>
              <div inert className="select-none">
                <JobCard
                  id="preview"
                  title={f.title || "Your job title"}
                  body={f.body || "Your description shows here."}
                  category={f.category}
                  amount={valid ? n.toFixed(2) : "0.00"}
                  minScore={Number(f.minScore) || 0}
                  minReviewers={Number(f.minReviewers) || 0}
                  acceptBy={Math.floor(Date.now() / 1000) + Number(f.days) * DAY}
                  clientPaid={0}
                  clientPosted={0}
                  clientDisputed={0}
                />
              </div>
            </div>

            <div className="glass space-y-4 rounded-xl p-6">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Budget</dt><dd className="font-mono tabular-nums">{fmtN(n, valid)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Platform fee, 5%</dt><dd className="font-mono tabular-nums">{fmtN(fee, valid)}</dd></div>
                <div className="flex justify-between border-t border-border/70 pt-3 text-base font-semibold"><dt>You deposit</dt><dd className="font-mono tabular-nums">{fmtN(n + fee, valid)} USDC</dd></div>
              </dl>
              <p className="text-sm text-muted-foreground">
                Open until {dateIn(Number(f.days))}. Delivery due {f.deliverDays} days after a freelancer accepts. If nobody accepts, the whole deposit comes back.
              </p>
              <Button size="lg" className="h-12 w-full rounded-full text-base" onClick={submit} disabled={!ready}>
                <LockKeyIcon weight="bold" /> Fund and post
              </Button>
              {status && <p className="muted text-sm">{status}</p>}
            </div>
          </aside>
        </div>
      </SignInGate>
    </div>
  );
}

function fmtN(x: number, ok: boolean) {
  return ok ? x.toFixed(2) : "-";
}
