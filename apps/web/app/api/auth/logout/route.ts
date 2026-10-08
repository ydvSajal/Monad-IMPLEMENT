import { NextResponse } from "next/server";

import { SESSION_COOKIE, cookieOpts } from "@/lib/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOpts(0));
  return res;
}
