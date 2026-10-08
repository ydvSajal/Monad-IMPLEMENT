import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Toaster } from "@/components/ui/sonner";
import { WalletProvider } from "@/lib/wallet";

import "./globals.css";

export const metadata: Metadata = {
  title: "GigTrust",
  description: "Freelancers get hired on a score only paying clients can move.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <WalletProvider>
          <SiteHeader />
          <main className="flex-1 pt-24 has-[[data-hero]]:pt-0">{children}</main>
          <SiteFooter />
          <Toaster position="bottom-right" />
        </WalletProvider>
      </body>
    </html>
  );
}
