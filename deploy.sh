#!/usr/bin/env bash
set -euo pipefail

# Deploy to VPS: rsync this repo to /var/www/<NAME>, then run post_deploy.sh there.
# Usage: ./deploy.sh [path-to-ssh-private-key]
#   Or set SSH_PRIVATE_KEY (or DEPLOY_SSH_KEY) with the key path.
# Called by GitHub Action; key is typically passed as secret.

CONFIG_FILE="app.config"
VPS_HOST="root@vps3.marekventur.com"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Verify before deploy ==="
./verify.sh

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: $CONFIG_FILE not found in $SCRIPT_DIR"
  exit 1
fi

# NAME from config (lines starting with # are ignored)
NAME=$(grep -E '^NAME=' "$CONFIG_FILE" | cut -d= -f2-)
if [[ -z "$NAME" ]]; then
  echo "ERROR: NAME not found in $CONFIG_FILE"
  exit 1
fi

# SSH key: first argument, or env SSH_PRIVATE_KEY, or DEPLOY_SSH_KEY
SSH_KEY="${1:-${SSH_PRIVATE_KEY:-${DEPLOY_SSH_KEY:-}}}"
if [[ -z "$SSH_KEY" ]]; then
  echo "ERROR: Pass SSH private key path as first argument or set SSH_PRIVATE_KEY / DEPLOY_SSH_KEY"
  exit 1
fi
if [[ ! -f "$SSH_KEY" ]]; then
  echo "ERROR: SSH key file not found: $SSH_KEY"
  exit 1
fi

RSYNC_DEST="$VPS_HOST:/var/www/$NAME"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)

echo "=== Deploying to $RSYNC_DEST ==="
rsync -avz --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude node_modules \
  --exclude .git \
  --exclude build \
  --exclude data \
  --exclude .react-router \
  --exclude ".env*" \
  --exclude "*.log" \
  . "$RSYNC_DEST"

echo "=== Running post_deploy.sh on VPS ==="
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "cd /var/www/$NAME && chmod +x post_deploy.sh && ./post_deploy.sh"

echo "=== Deploy finished ==="
