"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Address, type WalletClient } from "viem";

import { monad, publicClient, padGas } from "./gig";

interface Ctx {
  account: Address | null;
  wallet: WalletClient | null;
  connect: () => Promise<void>;
  /** simulate, pad gas ×1.15 (Monad bills the limit), send, wait. Returns the receipt. */
  write: (req: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>>;
}

const WalletCtx = createContext<Ctx>({ account: null, wallet: null, connect: async () => {}, write: async () => { throw new Error("no wallet"); } });
export const useWallet = () => useContext(WalletCtx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Address | null>(null);
  const [wallet, setWallet] = useState<WalletClient | null>(null);

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
    const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
    eth?.request({ method: "eth_accounts" }).then((a) => {
      const [addr] = a as Address[];
      if (addr) attach(addr);
    });
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

  return <WalletCtx.Provider value={{ account, wallet, connect, write }}>{children}</WalletCtx.Provider>;
}
