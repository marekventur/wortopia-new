#!/usr/bin/env bash
set -euo pipefail

# Run from repo root on the VPS (e.g. /var/www/<name>).
# Reads NAME and PORT from app.config.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f app.config ]]; then
  echo "ERROR: app.config not found in $SCRIPT_DIR"
  exit 1
fi
# shellcheck source=/dev/null
source app.config

export NAME
export PORT

echo "=== Post-deploy: $NAME (port $PORT) ==="
npm ci
npm run build

if npx pm2 describe "$NAME" &>/dev/null; then
  echo "Reloading PM2 app from ecosystem: $NAME"
  npx pm2 delete "$NAME"
fi
echo "Starting PM2 app: $NAME"
npx pm2 start ecosystem.config.cjs

npx pm2 save
echo "=== Done ==="
