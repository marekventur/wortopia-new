#!/usr/bin/env bash
set -euo pipefail

# Local verify before deploy: install deps, typecheck, build.
# Run on GitHub or locally; deploy.sh runs this first so we don't deploy a broken app.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Verify (local build) ==="
npm ci
npm run typecheck
npm run build
echo "=== Verify OK ==="
