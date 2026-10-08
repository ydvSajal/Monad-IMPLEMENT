"use client";

import Link from "next/link";

import { useWallet } from "@/lib/wallet";

export function Nav() {
  const { account, connect } = useWallet();
  return (
    <header>
      <Link href="/" className="brand">GigTrust</Link>
      <nav>
        <Link href="/jobs">Jobs</Link>
        <Link href="/jobs/new">Post a job</Link>
        <Link href="/me">Me</Link>
        <button onClick={() => connect().catch((e) => alert(e.message))}>
          {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}
        </button>
      </nav>
    </header>
  );
}
