import Link from "next/link";

import { ADDR, GROUNDED_SITE, escrowAbi, publicClient } from "@/lib/gig";

export const dynamic = "force-dynamic";

async function jobCount(): Promise<number | null> {
  if (!ADDR.escrow) return null;
  try {
    return Number((await publicClient.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: "nextJobId" })) - 1n);
  } catch {
    return null;
  }
}

export default async function Home() {
  const jobs = await jobCount();
  return (
    <>
      <h1>Hire on a score only paying clients can move.</h1>
      <p className="muted">
        Every GigTrust review is backed by a real escrow payment. A freelancer&apos;s reputation lives in{" "}
        <a href={GROUNDED_SITE}>Grounded</a>, so it follows them off this platform and we cannot edit it.
      </p>
      <div className="card">
        <b>{jobs === null ? "Escrow not deployed yet" : `${jobs} jobs posted`}</b>
        <p className="muted">Clients set a trust bar per job. The escrow contract refuses freelancers who do not meet it.</p>
        <div className="row">
          <Link className="btn" href="/jobs/new">Post a job</Link>
          <Link className="btn" href="/jobs">Browse jobs</Link>
        </div>
      </div>
      <p className="muted">
        Fake reviews cost real money: every job pays a 5% platform fee, a rating needs the receipt of a payment the client
        chose to make, and Grounded excludes the freelancer&apos;s own wallets. Auto-released jobs issue no receipt, so no rating.
      </p>
    </>
  );
}
