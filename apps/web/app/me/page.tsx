"use client";

import { ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { parseEventLogs, type Address } from "viem";

import { SignInGate } from "@/components/SignInGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADDR, identityAbi, monad, publicClient } from "@/lib/gig";
import { useWallet } from "@/lib/wallet";

export default function Me() {
  const { account, wallet, write } = useWallet();
  const [uri, setUri] = useState("data:application/json,{\"name\":\"my agent\"}");
  const [agentId, setAgentId] = useState("");
  const [payout, setPayout] = useState("");
  const [msg, setMsg] = useState("");
  const [registered, setRegistered] = useState(false);
  const [walletSet, setWalletSet] = useState(false);

  const run = (fn: () => Promise<void>) => async () => {
    try {
      setMsg("Waiting for wallet…");
      await fn();
      setMsg("Done.");
      toast.success("Done");
    } catch (e) {
      const m = e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e);
      setMsg(m);
      toast.error(m.length > 140 ? `${m.slice(0, 140)}…` : m);
    }
  };

  const register = run(async () => {
    const rc = await write({ address: ADDR.identity, abi: identityAbi, functionName: "register", args: [uri] });
    const [ev] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: rc.logs });
    setAgentId(ev.args.agentId.toString());
    setPayout(account ?? "");
    setRegistered(true);
  });

  // the payout wallet itself must sign (EIP-712, domain ERC8004IdentityRegistry v1), deadline <= now + 5 min
  const setWalletFn = run(async () => {
    if (!wallet || !account) throw new Error("Connect a wallet first");
    const owner = await publicClient.readContract({ address: ADDR.identity, abi: identityAbi, functionName: "ownerOf", args: [BigInt(agentId)] });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
    const signature = await wallet.signTypedData({
      account,
      domain: { name: "ERC8004IdentityRegistry", version: "1", chainId: monad.id, verifyingContract: ADDR.identity },
      types: { AgentWalletSet: [
        { name: "agentId", type: "uint256" }, { name: "newWallet", type: "address" },
        { name: "owner", type: "address" }, { name: "deadline", type: "uint256" },
      ] },
      primaryType: "AgentWalletSet",
      message: { agentId: BigInt(agentId), newWallet: payout as Address, owner, deadline },
    });
    await write({ address: ADDR.identity, abi: identityAbi, functionName: "setAgentWallet", args: [BigInt(agentId), payout as Address, deadline, signature] });
    setWalletSet(true);
  });

  const step = "glass space-y-4 rounded-xl p-6";
  const head = (n: string, done: boolean) => (
    <h2 className="flex items-center gap-2 text-lg font-semibold">
      {done && <CheckCircleIcon weight="fill" className="size-5 text-primary" />}
      {n}
    </h2>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Freelancer setup</h1>
      <p className="mt-1 mb-8 text-muted-foreground">Two steps, one time. Your reputation will live on this identity.</p>
      <SignInGate title="Sign in to set up your profile">
        <div className="space-y-6">
          <div className={step}>
            {head("1. Register an ERC-8004 identity", registered)}
            <div className="space-y-2">
              <Label>Agent URI</Label>
              <Input value={uri} onChange={(e) => setUri(e.target.value)} />
            </div>
            <Button className="rounded-full" onClick={register} disabled={!account}>Register</Button>
          </div>
          <div className={step}>
            {head("2. Set your payout wallet", walletSet)}
            <p className="muted text-sm">Required: without one, the router cannot pay you and you cannot accept jobs. The payout wallet signs; use the connected wallet.</p>
            <div className="space-y-2">
              <Label>Agent id</Label>
              <Input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Payout wallet</Label>
              <Input value={payout} onChange={(e) => setPayout(e.target.value)} placeholder={account ?? ""} />
            </div>
            <Button className="rounded-full" onClick={setWalletFn} disabled={!account || !agentId || payout.toLowerCase() !== account?.toLowerCase()}>Set payout wallet</Button>
          </div>
          {agentId && (
            <Link href={`/freelancers/${agentId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
              View your profile <ArrowRightIcon />
            </Link>
          )}
          <p className="muted min-h-5 text-sm">{msg}</p>
        </div>
      </SignInGate>
    </div>
  );
}
