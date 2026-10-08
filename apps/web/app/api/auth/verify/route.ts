import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";

import { monad, publicClient } from "@/lib/gig";
import { NONCE_COOKIE, SESSION_COOKIE, SESSION_TTL, cookieOpts, signSession } from "@/lib/session";

/** SIWE login: message must name this host, our chain and the one-time nonce we issued. */
export async function POST(req: Request) {
  const { message, signature } = (await req.json().catch(() => ({}))) as { message?: string; signature?: Hex };
  const nonce = req.headers.get("cookie")?.match(new RegExp(`${NONCE_COOKIE}=([^;]+)`))?.[1];
  if (!message || !signature || !nonce) return NextResponse.json({ error: "bad input" }, { status: 400 });

  const fields = parseSiweMessage(message);
  if (!fields.address || fields.chainId !== monad.id) return NextResponse.json({ error: "bad message" }, { status: 401 });

  const ok = await verifySiweMessage(publicClient, {
    message,
    signature,
    domain: req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host, // behind a proxy the public host is forwarded
    nonce,
  }).catch(() => false);
  if (!ok) return NextResponse.json({ error: "signature rejected" }, { status: 401 });

  const res = NextResponse.json({ address: fields.address });
  res.cookies.set(SESSION_COOKIE, signSession(fields.address), cookieOpts(SESSION_TTL));
  res.cookies.set(NONCE_COOKIE, "", cookieOpts(0)); // single use
  return res;
}
