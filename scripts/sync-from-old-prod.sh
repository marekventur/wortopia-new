#!/usr/bin/env bash
set -euo pipefail

# Rebuilds the v2 database from the old wortopia.de PostgreSQL database.
#
# The old site stays the source of truth: everything currently in the v2
# database is replaced. Safe to run repeatedly — each run produces the same
# result from the same source.
#
# The new database is built to one side and only swapped in at the end, so the
# site is down for a restart rather than for the length of the import.
#
#   ./scripts/sync-from-old-prod.sh                  # dump over ssh, then swap
#   ./scripts/sync-from-old-prod.sh --dump FILE      # use a dump you already have
#   ./scripts/sync-from-old-prod.sh --build-only     # build, don't touch the live site
#
# Requires: pg_restore locally, ssh access to the old server (unless --dump).

OLD_HOST="${OLD_HOST:-root@178.79.161.163}"
OLD_DB="${OLD_DB:-wortopia}"
APP_NAME="${APP_NAME:-wortopia-new}"
APP_DIR="${APP_DIR:-/var/www/wortopia-new}"
LIVE_DB="$APP_DIR/data/app.db"
PM2="npx --yes pm2@6.0.14"

# Accounts to leave behind entirely. Repeat --drop-email per address.
DROP_ARGS=()
DUMP_FILE=""
BUILD_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump)       DUMP_FILE="$2"; shift 2 ;;
    --drop-email) DROP_ARGS+=(--drop-email "$2"); shift 2 ;;
    --build-only) BUILD_ONLY=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="${WORK_DIR:-/var/tmp/wortopia-sync-$STAMP}"
mkdir -p "$WORK_DIR"
NEW_DB="$WORK_DIR/app.db"

echo "=== Wortopia: rebuild v2 database from the old site ==="
echo "work dir: $WORK_DIR"
echo

# --- 1. dump ----------------------------------------------------------------
if [[ -z "$DUMP_FILE" ]]; then
  DUMP_FILE="$WORK_DIR/wortopia.pgc"
  echo "--- Dumping $OLD_DB from $OLD_HOST ---"
  # -Fc so pg_restore can pull single tables; read-only on the old server.
  ssh -o BatchMode=yes "$OLD_HOST" "pg_dump -Fc -Z6 '$OLD_DB'" > "$DUMP_FILE"
  echo "    $(du -h "$DUMP_FILE" | cut -f1) written"
else
  echo "--- Using existing dump: $DUMP_FILE ---"
fi

# A truncated dump would otherwise produce a plausible-looking but incomplete
# database, so check it lists the tables we need before going any further.
for t in users user_emails user_results; do
  pg_restore -l "$DUMP_FILE" | grep -q "TABLE DATA public $t " \
    || { echo "ERROR: dump has no '$t' table data — refusing to continue." >&2; exit 1; }
done
echo "    dump contains users, user_emails, user_results"
echo

# --- 2. build ---------------------------------------------------------------
echo "--- Building new database ---"
CARRY=()
[[ -r "$LIVE_DB" ]] && CARRY=(--carry-over "$LIVE_DB")
node --import tsx/esm scripts/rebuild-from-dump.ts \
  "$DUMP_FILE" "$NEW_DB" "${CARRY[@]}" "${DROP_ARGS[@]+"${DROP_ARGS[@]}"}"
echo

# --- 3. sanity-check the result --------------------------------------------
echo "--- Checking the new database ---"
node -e '
const D = require("better-sqlite3");
const db = new D(process.argv[1], { readonly: true });
const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const users = n("users"), results = n("user_results"), words = n("words");
console.log(`    users ${users}, results ${results}, words ${words}`);
if (users < 100)   { console.error("    users below 100 — refusing the swap");   process.exit(1); }
if (results < 1e5) { console.error("    results below 100k — refusing the swap"); process.exit(1); }
if (words < 1000)  { console.error("    word list nearly empty — refusing the swap"); process.exit(1); }
db.close();
' "$NEW_DB"
echo

if [[ "$BUILD_ONLY" == "1" ]]; then
  echo "=== Built, not swapped (--build-only) ==="
  echo "New database: $NEW_DB"
  exit 0
fi

# --- 4. swap ----------------------------------------------------------------
BACKUP_DIR="$APP_DIR/data/backup-$STAMP"
echo "--- Swapping in (site restarts) ---"
mkdir -p "$BACKUP_DIR"

$PM2 stop "$APP_NAME" >/dev/null
# Stop first: the running server holds the WAL open, and copying underneath it
# would capture a torn database.
for f in app.db app.db-wal app.db-shm; do
  [[ -e "$APP_DIR/data/$f" ]] && mv "$APP_DIR/data/$f" "$BACKUP_DIR/$f"
done
cp "$NEW_DB" "$LIVE_DB"
$PM2 start "$APP_NAME" >/dev/null

echo "    previous database saved to $BACKUP_DIR"
echo

# --- 5. verify --------------------------------------------------------------
echo "--- Verifying ---"
for i in $(seq 1 30); do
  sleep 2
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3006/4 || true)"
  [[ "$code" == "200" ]] && break
done
echo "    GET /4 -> ${code:-no response}"
$PM2 describe "$APP_NAME" | grep -E "status|restarts" | head -2 || true

if [[ "${code:-}" != "200" ]]; then
  echo
  echo "SITE IS NOT RESPONDING. To roll back:" >&2
  echo "  $PM2 stop $APP_NAME" >&2
  echo "  rm -f $APP_DIR/data/app.db*" >&2
  echo "  mv $BACKUP_DIR/* $APP_DIR/data/" >&2
  echo "  $PM2 start $APP_NAME" >&2
  exit 1
fi

echo
echo "=== Done. Rollback if needed: $BACKUP_DIR ==="
