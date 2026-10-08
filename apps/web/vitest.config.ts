import path from "node:path";
import { defineConfig } from "vitest/config";

// Needs a local anvil fork of Monad Testnet on :8545 (see tests/README.md); everything else is started by the tests.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 400_000,
    fileParallelism: false, // one shared anvil, one shared DB
    env: {
      NEXT_PUBLIC_RPC_URL: "http://127.0.0.1:8545",
      NEXT_PUBLIC_CHAIN_ID: "10143",
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:55432/postgres",
      DB_POOL_MAX: "1",
    },
  },
});
