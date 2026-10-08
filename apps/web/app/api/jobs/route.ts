import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isCategory } from "@/lib/categories";
import { metaHashOf, readJob } from "@/lib/gig";

export async function GET(req: Request) {
  const category = new URL(req.url).searchParams.get("category");
  const { rows } = await db().query(
    "select chain_job_id, client, title, body, category, created_at from jobs where ($1::text is null or category = $1) order by chain_job_id desc limit 200",
    [category],
  );
  return NextResponse.json(rows);
}

/** Store job text only if it hashes to the metaHash the escrow holds for that job. */
export async function POST(req: Request) {
  const { chainJobId, title, body, category = "other" } = (await req.json()) as { chainJobId: string; title: string; body: string; category?: string };
  if (!chainJobId || !title?.trim() || !body?.trim() || title.length > 200 || body.length > 10_000 || !isCategory(category)) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const job = await readJob(BigInt(chainJobId));
  if (!job) return NextResponse.json({ error: "job not found onchain" }, { status: 404 });
  if (job.metaHash !== metaHashOf(title, body)) {
    return NextResponse.json({ error: "text does not match onchain metaHash" }, { status: 422 });
  }
  await db().query(
    "insert into jobs (chain_job_id, client, title, body, meta_hash, category) values ($1,$2,$3,$4,$5,$6) on conflict (chain_job_id) do nothing",
    [chainJobId, job.client, title, body, job.metaHash, category],
  );
  return NextResponse.json({ ok: true });
}
