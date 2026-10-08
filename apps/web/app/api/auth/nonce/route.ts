import { NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";

import { NONCE_COOKIE, cookieOpts } from "@/lib/session";

export async function GET() {
  const nonce = generateSiweNonce();
  const res = NextResponse.json({ nonce });
  res.cookies.set(NONCE_COOKIE, nonce, cookieOpts(300));
  return res;
}
