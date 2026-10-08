import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Address } from "viem";

export const SESSION_COOKIE = "gt_session";
export const NONCE_COOKIE = "gt_nonce";
const WEEK = 7 * 24 * 3600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  return "dev-only-session-secret"; // ponytail: dev fallback, prod throws above
}

const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** Signed, httpOnly session = proof the browser controls `address` (SIWE verified at login). Not a bearer for funds. */
export function signSession(address: Address, ttl = WEEK) {
  const payload = Buffer.from(JSON.stringify({ a: address, e: Math.floor(Date.now() / 1000) + ttl })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

export function readSession(token: string | undefined): Address | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(mac(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { a: Address; e: number };
    return e > Date.now() / 1000 ? a : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Address | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export const cookieOpts = (maxAge: number) =>
  ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge }) as const;
export const SESSION_TTL = WEEK;
