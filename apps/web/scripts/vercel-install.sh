#!/usr/bin/env bash
# Vercel install step. The Grounded SDK is not on npm yet and package.json links it from a sibling checkout
# (link:../../../MONAD10k/packages/sdk), so fetch and build that checkout first, then install the app.
# Drop this script once @sajalydv/grounded-sdk is published and package.json depends on it normally.
set -euo pipefail

SDK_REPO="${GROUNDED_REPO:-https://github.com/ydvSajal/MONAD10K.git}"
SDK_REF="${GROUNDED_REF:-chore/npm-scope-sajalydv}"
SDK_DIR="$(cd ../../.. && pwd)/MONAD10k"   # must match the link: path, case-sensitive on Linux

if [ ! -d "$SDK_DIR/packages/sdk/dist" ]; then
  rm -rf "$SDK_DIR"
  git clone --depth 1 --branch "$SDK_REF" "$SDK_REPO" "$SDK_DIR"
  (cd "$SDK_DIR/packages/sdk" && npm install --no-audit --no-fund --no-package-lock && npm run build)
fi

pnpm install --no-frozen-lockfile
