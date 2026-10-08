import Link from "next/link";

import { db } from "@/lib/db";
import { ADDR, readJob, usdc } from "@/lib/gig";

export const dynamic = "force-dynamic";

export default async function Jobs({ searchParams }: { searchParams: Promise<{ minScore?: string; open?: string }> }) {
  const q = await searchParams;
  if (!ADDR.escrow) return <p className="muted">Escrow not deployed yet. Set NEXT_PUBLIC_GIG_ESCROW.</p>;

  const { rows } = await db().query("select chain_job_id::text as id, title from jobs order by chain_job_id desc limit 50");
  // reads paced by the public RPC limit: one small batch of parallel reads
  const jobs = (await Promise.all(rows.map(async (r) => ({ ...r, chain: await readJob(BigInt(r.id)) }))))
    .filter((j) => j.chain && j.chain.status === "Funded")
    .filter((j) => (q.open ? j.chain!.minScore === 0 && j.chain!.minReviewers === 0 : true))
    .filter((j) => (q.minScore ? j.chain!.minScore <= Number(q.minScore) : true));

  return (
    <>
      <h1>Open jobs</h1>
      <p className="muted">
        Filter: <Link href="/jobs">all</Link> · <Link href="/jobs?open=1">open to new talent</Link> ·{" "}
        <Link href="/jobs?minScore=70">bar ≤ 70</Link>
      </p>
      {jobs.length === 0 && <p className="muted">No open jobs.</p>}
      {jobs.map((j) => (
        <div className="card" key={j.id}>
          <Link href={`/jobs/${j.id}`}><b>{j.title}</b></Link>
          <div className="muted">
            {usdc(j.chain!.amount)} USDC · bar: score ≥ {j.chain!.minScore} from ≥ {j.chain!.minReviewers} paying reviewers
            {j.chain!.minScore === 0 && j.chain!.minReviewers === 0 && " (open to new talent)"}
          </div>
        </div>
      ))}
    </>
  );
}
