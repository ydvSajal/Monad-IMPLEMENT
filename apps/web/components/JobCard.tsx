import {
  CalendarBlankIcon,
  CodeIcon,
  DatabaseIcon,
  MegaphoneIcon,
  PaintBrushIcon,
  PenNibIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { CSSProperties, ComponentType } from "react";

import { GlassCard } from "@/components/GlassCard";
import { categoryLabel } from "@/lib/categories";

const ICONS: Record<string, ComponentType<{ className?: string; style?: CSSProperties; weight?: "duotone" }>> = {
  design: PaintBrushIcon,
  development: CodeIcon,
  "smart-contracts": ShieldCheckIcon,
  writing: PenNibIcon,
  marketing: MegaphoneIcon,
  "data-ai": DatabaseIcon,
  other: SquaresFourIcon,
};

// One accent hue per category: the icon and the card's cursor spotlight take it.
const HUES: Record<string, string> = {
  design: "var(--hue-pink)",
  development: "var(--hue-blue)",
  "smart-contracts": "var(--hue-violet)",
  writing: "var(--hue-orange)",
  marketing: "var(--hue-green)",
  "data-ai": "var(--hue-teal)",
};

export interface JobCardData {
  id: string;
  title: string;
  body: string;
  category: string;
  amount: string; // "120.00"
  minScore: number;
  minReviewers: number;
  acceptBy: number;
  clientPaid: number;
  clientPosted: number;
  clientDisputed: number;
}

const closes = (acceptBy: number) => {
  const s = acceptBy - Math.floor(Date.now() / 1000);
  if (s <= 0) return "Closed";
  const d = Math.floor(s / 86400);
  return d >= 1 ? `Closes in ${d}d` : `Closes in ${Math.max(1, Math.floor(s / 3600))}h`;
};

export function JobCard(j: JobCardData) {
  const Icon = ICONS[j.category] ?? SquaresFourIcon;
  const hue = HUES[j.category] ?? "var(--hue-blue)";
  const open = j.minScore === 0 && j.minReviewers === 0;
  return (
    <Link href={`/jobs/${j.id}`} className="block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <GlassCard className="flex h-full flex-col gap-4 p-5" style={{ "--tint": hue } as CSSProperties}>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-4" style={{ color: hue }} weight="duotone" />
            {categoryLabel(j.category)}
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums">
            {j.amount} <span className="text-xs font-normal text-muted-foreground">USDC</span>
          </span>
        </div>
        <div className="flex-1">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug">{j.title}</h3>
          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{j.body}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={
              open
                ? "inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-accent-foreground"
                : "inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-primary"
            }
          >
            <SealCheckIcon className="size-3.5" weight="duotone" />
            {open ? "Open to new talent" : `Score ${j.minScore}+ from ${j.minReviewers}+ reviewer${j.minReviewers === 1 ? "" : "s"}`}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <CalendarBlankIcon className="size-3.5" />
            {closes(j.acceptBy)}
          </span>
        </div>
        <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
          Client paid {j.clientPaid} of {j.clientPosted} jobs
          {j.clientDisputed > 0 && <>, {j.clientDisputed} disputed</>}
        </div>
      </GlassCard>
    </Link>
  );
}

export function JobCardSkeleton() {
  return <div className="glass h-56 animate-pulse rounded-xl" />;
}
