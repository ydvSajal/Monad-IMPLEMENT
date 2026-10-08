# Local test suite

Everything runs against a local **anvil fork of Monad Testnet** (real USDC, real Grounded, real ERC-8004 registries),
so nothing touches the live network and no real funds are used.

```bash
# 1. fork (WSL on Windows)
anvil --fork-url https://testnet-rpc.monad.xyz --port 8545 --silent

# 2. contracts (Foundry; unit + invariant + live-fork)
cd contracts
forge test --no-match-path "test/fork/*"
MONAD_FORK_RPC=https://testnet-rpc.monad.xyz forge test -n monad --match-path "test/fork/*"

# 3. app (needs the forge build output in contracts/out, and Chrome for the browser test)
cd apps/web
pnpm test            # e2e.test.ts + ui.test.ts
```

| File | What it covers |
|---|---|
| `e2e.test.ts` | GigEscrow deployed on the fork and driven with the app's own `lib/` code: onboarding, funding, accept/deliver/release with real EIP-3009 signatures, receipt payer == client, rating through the Grounded SDK and the trust bar it unlocks, refund / auto-release / dispute / settle / arbiter / 50-50 timeout (chain clock rewound after each), access control, conservation of funds, plus the API routes (hash-checked job text, categories, signed proposals, SIWE sign-in: nonce, domain, chain, expiry, forged signatures) on an in-process Postgres (PGlite). |
| `ui.test.ts` | Real Chrome against the production build, with an injected wallet that signs with local keys: wallet sign-in (SIWE), `/me` onboarding, post and fund a job, signed proposal, accept, deliver, release, dispute and settlement. |

The in-process database and the Next.js server are started and stopped by the tests.
