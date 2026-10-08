import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { metaHashOf } from "@/lib/gig";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rows } = await db().query("select chain_job_id, client, title, body, meta_hash from jobs where chain_job_id = $1", [id]);
  const r = rows[0];
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  // never serve text that does not match what was hashed onchain
  const verified = metaHashOf(r.title, r.body) === r.meta_hash;
  return NextResponse.json({ ...r, verified });
}
