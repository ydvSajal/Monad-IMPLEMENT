"use client";

import { CaretDownIcon, ListIcon, ShieldCheckIcon, SignOutIcon, UserCircleIcon, XIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MetaMaskFox } from "@/components/MetaMaskFox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWallet } from "@/lib/wallet";

const LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/jobs/new", label: "Post a job" },
  { href: "/me", label: "Freelancer" },
];

/**
 * Two-state floating nav. Top of a page with a [data-hero]: transparent bar over the hero. After scrolling past
 * max(280, hero/2), and always on pages without a hero, it is a glass pill. Styles: .gt-nav in globals.css.
 */
export function SiteHeader() {
  const { account, signedIn, signIn, signOut, ready } = useWallet();
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      const hero = document.querySelector<HTMLElement>("[data-hero]");
      // the transparent bar only works over the hero; elsewhere content scrolls under it, so use the glass pill from the start
      setScrolled(!hero || window.scrollY > Math.max(280, hero.offsetHeight * 0.5));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [path]);

  useEffect(() => setOpen(false), [path]); // close the mobile menu on route change

  const short = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "";
  const doSignIn = () => signIn().then(() => toast.success("Signed in")).catch((e) => toast.error(e instanceof Error ? e.message : "Sign-in failed"));
  const active = (href: string) => path === href || (href === "/jobs" && path.startsWith("/jobs/") && path !== "/jobs/new");

  return (
    <header className={cn("gt-nav", scrolled && "is-scrolled", open && "is-open")}>
      <div className="gt-nav-bar">
        <Link href="/" className="gt-nav-logo">
          <ShieldCheckIcon weight="fill" className="gt-nav-logo-icon" />
          GigTrust
        </Link>

        <nav className="gt-nav-links" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="gt-nav-link" data-active={active(l.href) || undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="gt-nav-end">
          {signedIn && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="gt-nav-account">
                  {short}
                  <CaretDownIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem asChild>
                  <Link href="/me"><UserCircleIcon /> Freelancer setup</Link>
                </DropdownMenuItem>
                {signedIn && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => signOut().then(() => toast("Signed out"))}>
                      <SignOutIcon /> Sign out
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {ready && !signedIn && (
            <button type="button" className="gt-nav-cta gt-nav-metamask" onClick={doSignIn} aria-label="Sign in with MetaMask">
              <span className="gt-nav-fox"><MetaMaskFox className="size-4" /></span>
              <span>Sign in<span className="max-[680px]:hidden"> with MetaMask</span></span>
            </button>
          )}
          <button type="button" className="gt-nav-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <XIcon className="size-5" /> : <ListIcon className="size-5" />}
          </button>
        </div>
      </div>

      <nav className="gt-nav-panel" aria-label="Mobile" hidden={!open}>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="gt-nav-link" data-active={active(l.href) || undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
