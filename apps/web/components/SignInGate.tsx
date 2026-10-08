"use client";

import { LockKeyIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWallet } from "@/lib/wallet";

/** Renders children once the wallet owner has signed in (SIWE). Browsing stays public; posting and setup are gated. */
export function SignInGate({ children, title = "Sign in to continue" }: { children: ReactNode; title?: string }) {
  const { signedIn, signIn, ready } = useWallet();
  if (!ready) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (signedIn) return <>{children}</>;
  return (
    <div className="glass mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl p-8 text-center">
      <LockKeyIcon className="size-10 text-primary" weight="duotone" />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">One signature proves the wallet is yours. No transaction, no gas.</p>
      <Button
        className="rounded-full"
        onClick={() => signIn().then(() => toast.success("Signed in")).catch((e) => toast.error(e instanceof Error ? e.message : "Sign-in failed"))}
      >
        Sign in with wallet
      </Button>
    </div>
  );
}
