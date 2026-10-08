import { NextResponse } from "next/server";
import { isAddress, type Address, type Hex } from "viem";

import { db } from "@/lib/db";
import { ADDR, identityAbi, proposalMessage, publicClient } from "@/lib/gig";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rows } = await db().query(
    "select agent_id::text, pitch, signer, created_at from proposals where job_id = $1 order by id",
    [id],
  );
  return NextResponse.json(rows);
}

/** Same rule as GigEscrow._isOperator: owner, approved, or approved-for-all. */
async function isOperator(agentId: bigint, who: Address) {
  const read = (functionName: "ownerOf" | "getApproved", args: [bigint]) =>
    publicClient.readContract({ address: ADDR.identity, abi: identityAbi, functionName, args });
  const owner = await read("ownerOf", [agentId]);
  const w = who.toLowerCase();
  if (owner.toLowerCase() === w || (await read("getApproved", [agentId])).toLowerCase() === w) return true;
  return publicClient.readContract({ address: ADDR.identity, abi: identityAbi, functionName: "isApprovedForAll", args: [owner, who] });
}

/** A proposal must be signed by an operator of the agent, so nobody can apply in another freelancer's name. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { agentId, pitch, signer, signature } = (await req.json()) as { agentId: string; pitch: string; signer: Address; signature: Hex };
  if (!/^\d+$/.test(id) || !/^\d+$/.test(agentId ?? "") || !pitch?.trim() || pitch.length > 2_000 || !isAddress(signer ?? "")) {
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }
  try {
    const ok = await publicClient.verifyMessage({ address: signer, message: proposalMessage(id, agentId, pitch), signature });
    if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });
    if (!(await isOperator(BigInt(agentId), signer))) {
      return NextResponse.json({ error: "signer does not control this agent" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "could not verify agent" }, { status: 400 });
  }
  try {
    await db().query(
      "insert into proposals (job_id, agent_id, pitch, signer) values ($1,$2,$3,$4) on conflict (job_id, agent_id) do update set pitch = excluded.pitch, signer = excluded.signer",
      [id, agentId, pitch, signer],
    );
  } catch {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
