"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES } from "@/lib/categories";
import { cn } from "@/lib/utils";

const SORTS = [
  { v: "newest", l: "Newest" },
  { v: "budget-desc", l: "Budget, high to low" },
  { v: "budget-asc", l: "Budget, low to high" },
  { v: "closing", l: "Closing soon" },
];
const BARS = [
  { v: "any", l: "Any trust bar" },
  { v: "open", l: "Open to new talent" },
  { v: "50", l: "Bar up to 50" },
  { v: "70", l: "Bar up to 70" },
];

/** URL is the state: every filter is a shareable link and the server page does the work. */
export function JobFilters({ counts }: { counts: Record<string, number> }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${path}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  useEffect(() => {
    if (q === (sp.get("q") ?? "")) return;
    timer.current = setTimeout(() => set({ q: q.trim() || null }), 300);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const cat = sp.get("category") ?? "";
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const chip = (slug: string, label: string, n: number) => (
    <button
      key={slug || "all"}
      type="button"
      onClick={() => set({ category: slug || null })}
      aria-pressed={cat === slug}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        cat === slug ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label} <span className="ml-1 font-mono text-xs opacity-70">{n}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {chip("", "All", total)}
        {CATEGORIES.map((c) => chip(c.slug, c.label, counts[c.slug] ?? 0))}
      </div>
      <div className="glass grid gap-3 rounded-xl p-3 sm:grid-cols-2 lg:grid-cols-[1fr_190px_200px_110px_110px]">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search jobs" placeholder="Search title or description" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={sp.get("bar") ?? "any"} onValueChange={(v) => set({ bar: v === "any" ? null : v })}>
          <SelectTrigger aria-label="Trust bar" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{BARS.map((b) => <SelectItem key={b.v} value={b.v}>{b.l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sp.get("sort") ?? "newest"} onValueChange={(v) => set({ sort: v === "newest" ? null : v })}>
          <SelectTrigger aria-label="Sort" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map((s) => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
        </Select>
        <Input aria-label="Minimum budget" inputMode="decimal" placeholder="Min USDC" defaultValue={sp.get("min") ?? ""} onBlur={(e) => set({ min: e.target.value || null })} />
        <Input aria-label="Maximum budget" inputMode="decimal" placeholder="Max USDC" defaultValue={sp.get("max") ?? ""} onBlur={(e) => set({ max: e.target.value || null })} />
      </div>
    </div>
  );
}
