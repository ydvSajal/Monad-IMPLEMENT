# GigTrust
Spec: `docs for new/`. Grounded (dependency, unmodified) lives in `C:\Users\sajal\GITHUB\MONAD10k`.
Status (8 Oct): GigEscrow (incl. deliver deadline, disputes: settle/arbiter/50-50 timeout, clientStats) + 52 tests green (WSL forge; fork tests need `-n monad`). Web app builds (Tailwind v4 + shadcn + React Bits MicroSlats hero, glass job cards, categories, wallet sign-in via SIWE cookie); proposals are operator-signed. 45 vitest tests green (`pnpm test` in apps/web, needs anvil fork). NOT deployed. Why: `docs/RESEARCH.md`. Rating in-app needs a grounded.sajal.sbs subdomain (see README).
Rules: no admin on contracts; gas = estimate x 1.15; explicit `git add` paths; viem types differ across the linked SDK, cast `as never` at the boundary.
