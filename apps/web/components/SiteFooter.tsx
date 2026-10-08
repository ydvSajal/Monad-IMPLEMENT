import { ShieldCheckIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";

import { GROUNDED_SITE } from "@/lib/gig";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <span className="inline-flex items-center gap-2">
          <ShieldCheckIcon weight="fill" className="size-5 text-primary" />
          GigTrust runs on Monad Testnet. Reputation lives in Grounded.
        </span>
        <nav className="flex gap-5">
          <Link href="/jobs" className="hover:text-foreground">Jobs</Link>
          <Link href="/jobs/new" className="hover:text-foreground">Post a job</Link>
          <a href={GROUNDED_SITE} className="hover:text-foreground">Grounded</a>
        </nav>
      </div>
    </footer>
  );
}
