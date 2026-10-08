import { BriefcaseIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Suspense } from "react";

import { JobCard } from "@/components/JobCard";
import { JobFilters } from "@/components/JobFilters";
import { Button } from "@/components/ui/button";
import { loadOpenJobs, type BrowseQuery } from "@/lib/browse";
import { ADDR } from "@/lib/gig";

export const dynamic = "force-dynamic";

export default async function Jobs({ searchParams }: { searchParams: Promise<BrowseQuery> }) {
  const q = await searchParams;
  if (!ADDR.escrow) return <p className="mx-auto max-w-7xl px-4 py-10 text-muted-foreground">Escrow not deployed yet. Set NEXT_PUBLIC_GIG_ESCROW.</p>;
  const { jobs, counts } = await loadOpenJobs(q);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Open jobs</h1>
          <p className="mt-1 text-muted-foreground">Funded in escrow. Clients set the trust bar, the contract enforces it.</p>
        </div>
        <Button asChild className="rounded-full">
          <Link href="/jobs/new">Post a job</Link>
        </Button>
      </div>

      <Suspense>
        <JobFilters counts={counts} />
      </Suspense>

      {jobs.length === 0 ? (
        <div className="glass mt-8 flex flex-col items-center gap-3 rounded-xl px-6 py-16 text-center">
          <BriefcaseIcon className="size-10 text-primary" weight="duotone" />
          <h2 className="text-lg font-semibold">No jobs match</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Clear a filter, or be the first to post work in this category.</p>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="rounded-full"><Link href="/jobs">Clear filters</Link></Button>
            <Button asChild className="rounded-full"><Link href="/jobs/new">Post a job</Link></Button>
          </div>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((j) => (
            <JobCard key={j.id} {...j} />
          ))}
        </div>
      )}
    </div>
  );
}
