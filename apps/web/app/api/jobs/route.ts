import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { metaHashOf, readJob } from "@/lib/gig";

export async function GET() {
  const { rows } = await db().query(
    "select chain_job_id, client, title, body, created_at from jobs order by chain_job_id desc limit 200",
  );
  return NextResponse.json(rows);
}

/** Store job text only if it hashes to the metaHash the escrow holds for that job. */
export async function POST(req: Request) {
  const { chainJobId, title, body } = (await req.json()) as { chainJobId: string; title: string; body: string };
  if (!chainJobId || !title?.trim() || !body?.trim() || title.length > 200 || body.length > 10_000) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  const job = await readJob(BigInt(chainJobId));
  if (!job) return NextResponse.json({ error: "job not found onchain" }, { status: 404 });
  if (job.metaHash !== metaHashOf(title, body)) {
    return NextResponse.json({ error: "text does not match onchain metaHash" }, { status: 422 });
  }
  await db().query(
    "insert into jobs (chain_job_id, client, title, body, meta_hash) values ($1,$2,$3,$4,$5) on conflict (chain_job_id) do nothing",
    [chainJobId, job.client, title, body, job.metaHash],
  );
  return NextResponse.json({ ok: true });
}
