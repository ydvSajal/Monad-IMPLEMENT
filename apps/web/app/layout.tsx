import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Nav } from "./Nav";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";

export const metadata: Metadata = {
  title: "GigTrust",
  description: "Freelancers get hired on a score only paying clients can move.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Nav />
          <main>{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
