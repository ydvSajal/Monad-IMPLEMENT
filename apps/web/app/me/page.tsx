"use client";

import Link from "next/link";
import { useState } from "react";
import { parseEventLogs, type Address } from "viem";

import { ADDR, identityAbi, monad, publicClient } from "@/lib/gig";
import { useWallet } from "@/lib/wallet";

export default function Me() {
  const { account, wallet, write } = useWallet();
  const [uri, setUri] = useState("data:application/json,{\"name\":\"my agent\"}");
  const [agentId, setAgentId] = useState("");
  const [payout, setPayout] = useState("");
  const [msg, setMsg] = useState("");

  const run = (fn: () => Promise<void>) => async () => {
    try { setMsg("Waiting for wallet…"); await fn(); setMsg("Done."); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  const register = run(async () => {
    const rc = await write({ address: ADDR.identity, abi: identityAbi, functionName: "register", args: [uri] });
    const [ev] = parseEventLogs({ abi: identityAbi, eventName: "Registered", logs: rc.logs });
    setAgentId(ev.args.agentId.toString());
    setPayout(account ?? "");
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
  });

  return (
    <>
      <h1>Freelancer setup</h1>
      {!account && <p className="muted">Connect a wallet first.</p>}
      <div className="card">
        <h2>1. Register an ERC-8004 identity</h2>
        <label>Agent URI</label>
        <input value={uri} onChange={(e) => setUri(e.target.value)} />
        <button onClick={register} disabled={!account}>Register</button>
      </div>
      <div className="card">
        <h2>2. Set your payout wallet</h2>
        <p className="muted">Required: without one, the router cannot pay you and you cannot accept jobs. The payout wallet signs; use the connected wallet.</p>
        <label>Agent id</label>
        <input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        <label>Payout wallet</label>
        <input value={payout} onChange={(e) => setPayout(e.target.value)} placeholder={account ?? ""} />
        <button onClick={setWalletFn} disabled={!account || !agentId || payout.toLowerCase() !== account?.toLowerCase()}>Set payout wallet</button>
      </div>
      {agentId && <p><Link href={`/freelancers/${agentId}`}>View your profile →</Link></p>}
      <p className="muted">{msg}</p>
    </>
  );
}
