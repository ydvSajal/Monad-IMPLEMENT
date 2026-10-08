import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  parseEventLogs,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const RPC = "http://127.0.0.1:8545";
export const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address;
const USDC_BALANCES_SLOT = 9n; // FiatToken `balances` mapping, found by probing the fork

export const chain = defineChain({
  id: 10143,
  name: "Monad Testnet (local fork)",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const pc = createPublicClient({ chain, transport: http(RPC) });

const artifact = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../../../contracts/out/GigEscrow.sol/GigEscrow.json"), "utf8"),
) as { abi: Abi; bytecode: { object: Hex } };
/** Full ABI from forge (includes custom errors, so reverts decode to names). */
export const escrowFullAbi = artifact.abi;

export const rpc = <T = unknown>(method: string, params: unknown[] = []) =>
  pc.transport.request({ method, params } as never) as Promise<T>;

export interface Actor {
  name: string;
  account: ReturnType<typeof privateKeyToAccount>;
  address: Address;
  wallet: WalletClient;
}

export async function newActor(name: string, usdc = 0n): Promise<Actor> {
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  await rpc("anvil_setBalance", [account.address, toHex(10n ** 20n)]);
  if (usdc) await setUsdc(account.address, usdc);
  return { name, account, address: account.address, wallet };
}

export async function setUsdc(who: Address, amount: bigint) {
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, USDC_BALANCES_SLOT]));
  await rpc("anvil_setStorageAt", [USDC, slot, pad(toHex(amount), { size: 32 })]);
}

export async function send(
  who: Actor,
  req: { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] },
) {
  const hash = await who.wallet.writeContract({ ...(req as object), account: who.account, chain } as never);
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`tx reverted: ${req.functionName}`);
  return rc;
}

export async function deployEscrow(deployer: Actor, args: readonly unknown[]): Promise<Address> {
  const hash = await deployer.wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args,
    account: deployer.account,
    chain,
  } as never);
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (!rc.contractAddress) throw new Error("deploy failed");
  return rc.contractAddress;
}

export const snapshot = () => rpc<string>("evm_snapshot");
export const revert = (id: string) => rpc("evm_revert", [id]);
export async function warp(seconds: number) {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
}
export const now = async () => Number((await pc.getBlock()).timestamp);

/** Decoded events of one kind from a receipt (forge ABI is untyped, so args come back loosely typed). */
export function events<T extends Record<string, unknown>>(rc: { logs: readonly unknown[] }, eventName: string): T[] {
  return (parseEventLogs({ abi: escrowFullAbi, eventName, logs: rc.logs as never }) as unknown as { args: T }[]).map((e) => e.args);
}
