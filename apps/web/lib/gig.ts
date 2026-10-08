import { createPublicClient, defineChain, fallback, http, keccak256, parseAbi, toHex, type Address, type WalletClient } from "viem";

export const monad = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143),
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.monad.xyz"] } },
});

// Grounded + token addresses are fixed deployments on Monad Testnet (deployments/10143.json).
export const ADDR = {
  escrow: (process.env.NEXT_PUBLIC_GIG_ESCROW ?? "") as Address,
  usdc: "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address,
  router: "0xab442c3cbc2997a6218FEA0DD253c3717edfc62e" as Address,
  grounded: "0xaDDd1f2F876CD253C57177b675905Bdb0061bF82" as Address,
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  receipts: "0xa89b76Ea9AcEA12A66Fb23d318219b9119362301" as Address,
  reviewers: "0xFb38DcB72C222d3943579b4F2c4C91ebcBE4eBa6" as Address,
};

export const GROUNDED_SITE = "https://grounded.sajal.sbs";

export const escrowAbi = parseAbi([
  "struct Job { address client; uint96 amount; uint256 agentId; address arbiter; uint96 offer; uint8 minScore; uint32 minReviewers; uint40 acceptBy; uint40 deliveredAt; uint40 deadline; uint32 deliverWithin; uint8 status; bool offered; bytes32 metaHash; }",
  "function create(uint256 amount, uint8 minScore, uint32 minReviewers, uint40 acceptBy, uint32 deliverWithin, address arbiter, bytes32 metaHash) returns (uint256)",
  "function accept(uint256 jobId, uint256 agentId)",
  "function deliver(uint256 jobId, bytes32 deliveryHash)",
  "function release(uint256 jobId, uint256 validAfter, uint256 validBefore, bytes32 salt, bytes signature) returns (uint256)",
  "function autoRelease(uint256 jobId)",
  "function refund(uint256 jobId)",
  "function dispute(uint256 jobId, bytes32 reasonHash)",
  "function offerSettlement(uint256 jobId, uint96 toFreelancer)",
  "function settle(uint256 jobId, uint96 toFreelancer, uint256 validAfter, uint256 validBefore, bytes32 salt, bytes signature) returns (uint256)",
  "function rule(uint256 jobId, uint96 toFreelancer)",
  "function resolveTimeout(uint256 jobId)",
  "function feeOf(uint256 amount) view returns (uint256)",
  "function nextJobId() view returns (uint256)",
  "function reviewWindow() view returns (uint256)",
  "function getJob(uint256 jobId) view returns (Job)",
  "function clientStats(address) view returns (uint32 posted, uint32 paid, uint32 disputed)",
  "event JobCreated(uint256 indexed jobId, address indexed client, uint96 amount, address arbiter, bytes32 metaHash)",
  "event JobReleased(uint256 indexed jobId, uint256 receiptId)",
  "event JobResolved(uint256 indexed jobId, uint96 toFreelancer, uint8 how, uint256 receiptId)",
]);

export const identityAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function getApproved(uint256) view returns (address)",
  "function isApprovedForAll(address, address) view returns (bool)",
  "function getAgentWallet(uint256) view returns (address)",
  "function register(string agentURI) returns (uint256)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

export const groundedAbi = parseAbi(["function meets(uint256 agentId, uint8 minScore, uint32 minReviewers) view returns (bool)"]);

export const routerAbi = parseAbi(["function authorizationNonce(uint256 agentId, bytes32 salt) pure returns (bytes32)"]);

export const STATUS = ["None", "Funded", "Accepted", "Delivered", "Released", "AutoReleased", "Refunded", "Disputed", "Resolved"] as const;
export type StatusName = (typeof STATUS)[number];

export const publicClient = createPublicClient({
  chain: monad,
  transport: process.env.NEXT_PUBLIC_RPC_URL_FALLBACK
    ? fallback([http(), http(process.env.NEXT_PUBLIC_RPC_URL_FALLBACK)])
    : http(),
});

export interface OnchainJob {
  id: bigint;
  client: Address;
  amount: bigint;
  agentId: bigint;
  minScore: number;
  minReviewers: number;
  acceptBy: number;
  deliveredAt: number;
  deadline: number; // Accepted: deliver-by. Disputed: resolve-by.
  deliverWithin: number;
  arbiter: Address;
  offer: bigint;
  offered: boolean;
  status: StatusName;
  metaHash: `0x${string}`;
}

export async function readJob(id: bigint): Promise<OnchainJob | null> {
  const r = await publicClient.readContract({ address: ADDR.escrow, abi: escrowAbi, functionName: "getJob", args: [id] });
  if (r.status === 0) return null;
  return {
    ...r,
    id,
    acceptBy: Number(r.acceptBy),
    deliveredAt: Number(r.deliveredAt),
    deadline: Number(r.deadline),
    status: STATUS[r.status] ?? "None",
  };
}

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Client's EIP-3009 ReceiveWithAuthorization to the router, for `release` and `settle`. */
export async function signRouterPull(wallet: WalletClient, from: Address, agentId: bigint, value: bigint) {
  const salt = keccak256(toHex(crypto.getRandomValues(new Uint8Array(32))));
  const nonce = await publicClient.readContract({ address: ADDR.router, abi: routerAbi, functionName: "authorizationNonce", args: [agentId, salt] });
  // chain time, not the browser clock: a skewed clock would sign an authorization that is already expired
  const validBefore = (await publicClient.getBlock()).timestamp + 3600n;
  const signature = await wallet.signTypedData({
    account: wallet.account ?? from, // injected wallets: a json-rpc account; a local key signs in-process
    domain: { name: "USDC", version: "2", chainId: monad.id, verifyingContract: ADDR.usdc },
    types: { ReceiveWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "ReceiveWithAuthorization",
    message: { from, to: ADDR.router, value, validAfter: 0n, validBefore, nonce },
  });
  return { validBefore, salt, signature };
}

/** Message a freelancer signs to post a proposal as an agent. Bound to job + pitch so it can't be replayed elsewhere. */
export const proposalMessage = (jobId: string, agentId: string, pitch: string) =>
  `GigTrust proposal\njob: ${jobId}\nagent: ${agentId}\npitch-hash: ${keccak256(toHex(pitch))}`;

/** Canonical offchain job JSON: fixed key order, so keccak256 of it is reproducible. */
export function canonicalMeta(title: string, body: string): string {
  return JSON.stringify({ title, body });
}

export const metaHashOf = (title: string, body: string) => keccak256(toHex(canonicalMeta(title, body)));

/** Monad bills the gas limit: pad every estimate by 15%. */
export const padGas = (g: bigint) => (g * 115n) / 100n;

export const usdc = (n: bigint) => (Number(n) / 1e6).toFixed(2);
