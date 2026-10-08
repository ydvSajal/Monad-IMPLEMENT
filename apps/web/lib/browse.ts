import type { JobCardData } from "@/components/JobCard";
import { db } from "@/lib/db";
import { ADDR, escrowAbi, publicClient, readJob, usdc } from "@/lib/gig";

export interface BrowseQuery {
  category?: string;
  q?: string;
  bar?: string; // any | open | 50 | 70
  min?: string;
  max?: string;
  sort?: string; // newest | budget-desc | budget-asc | closing
}

/** Open (Funded) jobs: text from the DB, truth (amount, bar, status, client record) from the chain. Paced for the public RPC. */
export async function loadOpenJobs(query: BrowseQuery, limit = 60): Promise<{ jobs: JobCardData[]; counts: Record<string, number> }> {
  if (!ADDR.escrow) return { jobs: [], counts: {} };
  const { rows } = await db().query(
    "select chain_job_id::text as id, title, body, category from jobs order by chain_job_id desc limit $1",
    [limit],
  );
  const read = await Promise.all(rows.map(async (r) => ({ ...r, chain: await readJob(BigInt(r.id)) })));
  const open = read.filter((j) => j.chain && j.chain.status === "Funded");

  const counts: Record<string, number> = {};
  for (const j of open) counts[j.category] = (counts[j.category] ?? 0) + 1;

  const clients = [...new Set(open.map((j) => j.chain!.client))];
  const stats = new Map(
    await Promise.all(
      clients.map(async (c) => {
        const [posted, paid, disputed] = await publicClient
          .readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: "clientStats", args: [c] })
          .catch(() => [0, 0, 0] as const);
        return [c, { posted, paid, disputed }] as const;
      }),
    ),
  );

  const q = query.q?.toLowerCase();
  const min = query.min ? Number(query.min) : null;
  const max = query.max ? Number(query.max) : null;
  const barMax = query.bar && /^\d+$/.test(query.bar) ? Number(query.bar) : null;

  const jobs = open
    .filter((j) => !query.category || j.category === query.category)
    .filter((j) => !q || j.title.toLowerCase().includes(q) || j.body.toLowerCase().includes(q))
    .filter((j) => (query.bar === "open" ? j.chain!.minScore === 0 && j.chain!.minReviewers === 0 : true))
    .filter((j) => (barMax === null ? true : j.chain!.minScore <= barMax))
    .filter((j) => (min === null || Number.isNaN(min) ? true : Number(j.chain!.amount) / 1e6 >= min))
    .filter((j) => (max === null || Number.isNaN(max) ? true : Number(j.chain!.amount) / 1e6 <= max))
    .sort((a, b) => {
      switch (query.sort) {
        case "budget-desc": return Number(b.chain!.amount - a.chain!.amount);
        case "budget-asc": return Number(a.chain!.amount - b.chain!.amount);
        case "closing": return a.chain!.acceptBy - b.chain!.acceptBy;
        default: return Number(b.id) - Number(a.id);
      }
    })
    .map((j) => {
      const s = stats.get(j.chain!.client)!;
      return {
        id: j.id,
        title: j.title,
        body: j.body,
        category: j.category,
        amount: usdc(j.chain!.amount),
        minScore: j.chain!.minScore,
        minReviewers: j.chain!.minReviewers,
        acceptBy: j.chain!.acceptBy,
        clientPosted: s.posted,
        clientPaid: s.paid,
        clientDisputed: s.disputed,
      };
    });

  return { jobs, counts };
}
