// Fail fast, with the command to run, if the local fork is not up.
export default async function setup() {
  try {
    const r = await fetch("http://127.0.0.1:8545", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const { result } = (await r.json()) as { result: string };
    if (Number(result) !== 10143) throw new Error(`chain id ${result}, expected 10143 (a fork of Monad Testnet)`);
  } catch (e) {
    throw new Error(
      `No local Monad Testnet fork on :8545 (${e instanceof Error ? e.message : e}).\n` +
        "Start one (in WSL on Windows):  anvil --fork-url https://testnet-rpc.monad.xyz --port 8545 --silent",
    );
  }
}
