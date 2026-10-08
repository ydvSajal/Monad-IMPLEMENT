"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";
import { createSiweMessage } from "viem/siwe";

import { monad, publicClient, padGas } from "./gig";

interface Ctx {
  account: Address | null;
  wallet: WalletClient | null;
  connect: () => Promise<void>;
  /** wallet address that proved control via SIWE (httpOnly cookie), or null */
  session: Address | null;
  /** true when the SIWE session matches the connected wallet */
  signedIn: boolean;
  /** connect (if needed) and sign one SIWE message */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** session lookup finished (avoids a signed-out flash on reload) */
  ready: boolean;
  /** simulate, pad gas ×1.15 (Monad bills the limit), send, wait. Returns the receipt. */
  write: (req: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>>;
}

const WalletCtx = createContext<Ctx>({ account: null, wallet: null, connect: async () => {}, session: null, signedIn: false, signIn: async () => {}, signOut: async () => {}, ready: false, write: async () => { throw new Error("no wallet"); } });
export const useWallet = () => useContext(WalletCtx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address | null>(null);
  const [wallet, setWallet] = useState<WalletClient | null>(null);
  const [session, setSession] = useState<Address | null>(null);
  const [ready, setReady] = useState(false);

  const attach = useCallback((addr: Address) => {
    const eth = (window as unknown as { ethereum: Parameters<typeof custom>[0] }).ethereum;
    setWallet(createWalletClient({ account: addr, chain: monad, transport: custom(eth) }));
    setAccount(addr);
  }, []);

  const connect = useCallback(async () => {
    const eth = (window as unknown as { ethereum?: Parameters<typeof custom>[0] & { request: (a: unknown) => Promise<unknown> } }).ethereum;
    if (!eth) throw new Error("No injected wallet found");
    const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${monad.id.toString(16)}` }] });
    } catch {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: `0x${monad.id.toString(16)}`, chainName: monad.name, nativeCurrency: monad.nativeCurrency, rpcUrls: monad.rpcUrls.default.http }],
      });
    }
    attach(addr);
  }, [attach]);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((j: { address: Address | null }) => setSession(j.address)).catch(() => {}).finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async () => {
    const eth = (window as unknown as { ethereum?: Parameters<typeof custom>[0] }).ethereum;
    if (!eth) throw new Error("No injected wallet found");
    let addr = account;
    let w = wallet;
    if (!addr || !w) {
      await connect();
      const [a] = (await (eth as unknown as { request: (x: unknown) => Promise<unknown> }).request({ method: "eth_accounts" })) as Address[];
      addr = a;
      w = createWalletClient({ account: a, chain: monad, transport: custom(eth) });
    }
    const { nonce } = (await (await fetch("/api/auth/nonce")).json()) as { nonce: string };
    const message = createSiweMessage({
      address: addr,
      chainId: monad.id,
      domain: window.location.host,
      nonce,
      uri: window.location.origin,
      version: "1",
      expirationTime: new Date(Date.now() + 5 * 60_000), // a captured signature stops working after 5 minutes
      statement: "Sign in to GigTrust. This does not send a transaction or cost gas.",
    });
    const signature = await w.signMessage({ account: addr, message });
    const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "sign-in failed");
    setSession(((await res.json()) as { address: Address }).address);
  }, [account, wallet, connect]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
  }, []);

  useEffect(() => {
    const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown>; on?: (e: string, f: (a: Address[]) => void) => void; removeListener?: (e: string, f: (a: Address[]) => void) => void } }).ethereum;
    eth?.request({ method: "eth_accounts" }).then((a) => {
      const [addr] = a as Address[];
      if (addr) attach(addr);
    });
    const onChange = ([addr]: Address[]) => (addr ? attach(addr) : (setAccount(null), setWallet(null)));
    eth?.on?.("accountsChanged", onChange);
    return () => eth?.removeListener?.("accountsChanged", onChange);
  }, [attach]);

  const write: Ctx["write"] = useCallback(
    async (req) => {
      if (!wallet || !account) throw new Error("Connect a wallet first");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = req as any;
      const gas = padGas(await publicClient.estimateContractGas({ ...r, account }));
      const hash = await wallet.writeContract({ ...r, account, chain: monad, gas });
      return publicClient.waitForTransactionReceipt({ hash });
    },
    [wallet, account],
  );

  return <WalletCtx.Provider value={{ account, wallet, connect, session, signedIn: !!account && !!session && account.toLowerCase() === session.toLowerCase(), signIn, signOut, ready, write }}>{children}</WalletCtx.Provider>;
}
