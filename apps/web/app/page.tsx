import { ArrowRightIcon, HandshakeIcon, LockKeyIcon, ReceiptIcon, SealCheckIcon, UserCircleMinusIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { CSSProperties } from "react";

import AnimatedContent from "@/components/AnimatedContent";
import BlurText from "@/components/BlurText";
import CountUp from "@/components/CountUp";
import { GlassCard } from "@/components/GlassCard";
import { HeroSlats } from "@/components/HeroSlats";
import { JobCard } from "@/components/JobCard";
import { Button } from "@/components/ui/button";
import { loadOpenJobs } from "@/lib/browse";
import { ADDR, GROUNDED_SITE, escrowAbi, publicClient } from "@/lib/gig";

export const dynamic = "force-dynamic";

async function jobCount(): Promise<number | null> {
  if (!ADDR.escrow) return null;
  try {
    return Number((await publicClient.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: "nextJobId" })) - 1n);
  } catch {
    return null;
  }
}

export default async function Home() {
  const [posted, open] = await Promise.all([jobCount(), loadOpenJobs({}, 30).catch(() => ({ jobs: [], counts: {} }))]);
  const escrowed = open.jobs.reduce((n, j) => n + Number(j.amount), 0);

  return (
    <>
      <section data-hero className="relative isolate flex min-h-[100dvh] items-center overflow-hidden pt-24">
        <div className="absolute inset-0 -z-10">
          <HeroSlats />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
        </div>
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl">
            <BlurText as="h1" text="Hire on a score only paying clients can move." delay={90} className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl" />
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Every review is backed by a real escrow payment, and reputation lives in Grounded where nobody can edit it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full">
                <Link href="/jobs">Browse jobs <ArrowRightIcon /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full bg-white/60 backdrop-blur">
                <Link href="/jobs/new">Post a job</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <AnimatedContent distance={30} duration={0.7}>
          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              { k: "Jobs posted", v: posted ?? 0, hue: "var(--hue-blue)" },
              { k: "Open now", v: open.jobs.length, hue: "var(--hue-pink)" },
              { k: "USDC held in escrow", v: Math.round(escrowed), hue: "var(--hue-orange)" },
            ].map((s) => (
              <GlassCard key={s.k} className="p-6" style={{ "--tint": s.hue } as CSSProperties}>
                <dd className="font-mono text-4xl font-semibold tabular-nums" style={{ color: s.hue }}>
                  <CountUp to={s.v} duration={1.6} separator="," />
                </dd>
                <dt className="mt-1 text-sm text-muted-foreground">{s.k}</dt>
              </GlassCard>
            ))}
          </dl>
        </AnimatedContent>
      </section>

      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Money moves once. Reputation follows the receipt.</h2>
          <p className="mt-4 max-w-md text-muted-foreground">
            Escrow holds the budget, the client releases it with a signature, and that payment is the only thing that can produce a rating.
          </p>
        </div>
        <ol className="space-y-4">
          {[
            { Icon: LockKeyIcon, hue: "var(--hue-blue)", t: "Fund", d: "The client deposits budget plus the 5% fee. The contract refuses freelancers below the trust bar." },
            { Icon: HandshakeIcon, hue: "var(--hue-violet)", t: "Deliver", d: "The freelancer accepts, delivers before the deadline, and the client reviews within seven days." },
            { Icon: ReceiptIcon, hue: "var(--hue-teal)", t: "Release and rate", d: "Release pays the freelancer through Grounded and issues a receipt. Only that client can rate it." },
          ].map(({ Icon, hue, t, d }) => (
            <AnimatedContent key={t} distance={40} duration={0.7}>
              <GlassCard as="li" className="flex gap-4 p-6" style={{ "--tint": hue } as CSSProperties}>
                <Icon className="mt-0.5 size-7 shrink-0" style={{ color: hue }} weight="duotone" />
                <div>
                  <h3 className="text-lg font-semibold">{t}</h3>
                  <p className="mt-1 text-muted-foreground">{d}</p>
                </div>
              </GlassCard>
            </AnimatedContent>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Why the score holds up</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-6">
          <GlassCard className="p-8 md:col-span-4" style={{ "--tint": "var(--hue-blue)", background: "linear-gradient(135deg, color-mix(in oklab, var(--hue-blue) 9%, white), color-mix(in oklab, var(--hue-violet) 7%, white))" } as CSSProperties}>
            <SealCheckIcon className="size-9 text-[var(--hue-blue)]" weight="duotone" />
            <h3 className="mt-4 text-2xl font-semibold">Ratings need a receipt</h3>
            <p className="mt-2 max-w-lg text-muted-foreground">
              A rating can only point at a payment the client chose to make. Fake reviews cost real money, plus the platform fee.
            </p>
          </GlassCard>
          <GlassCard className="p-8 md:col-span-2" style={{ "--tint": "var(--hue-pink)", background: "linear-gradient(160deg, color-mix(in oklab, var(--hue-pink) 9%, white), color-mix(in oklab, var(--hue-orange) 7%, white))" } as CSSProperties}>
            <UserCircleMinusIcon className="size-9 text-[var(--hue-pink)]" weight="duotone" />
            <h3 className="mt-4 text-xl font-semibold">No self-reviews</h3>
            <p className="mt-2 text-muted-foreground">Grounded excludes a freelancer&apos;s own wallets from their score.</p>
          </GlassCard>
          <GlassCard className="p-8 md:col-span-6" style={{ "--tint": "var(--hue-teal)", background: "linear-gradient(90deg, color-mix(in oklab, var(--hue-teal) 9%, white), white 70%)" } as CSSProperties}>
            <h3 className="text-xl font-semibold">Portable by design</h3>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              The score lives on-chain in Grounded, so it follows the freelancer off GigTrust and we cannot edit it.{" "}
              <a href={GROUNDED_SITE} className="text-primary underline-offset-4 hover:underline">See the public explorer</a>.
            </p>
          </GlassCard>
        </div>
      </section>

      {open.jobs.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Fresh in escrow</h2>
            <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              All open jobs <ArrowRightIcon />
            </Link>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {open.jobs.slice(0, 3).map((j) => (
              <JobCard key={j.id} {...j} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
