#!/usr/bin/env bash
#
# Plush Price Guide daily refresh.
#
#   ./tools/daily_update.sh
#
# Refreshes the ASKING-PRICE side of the database from the eBay Browse API,
# rebuilds data.json and seed.sql (and the site's generated files), and runs the test suite. Safe to run
# unattended: it writes to a temp copy first and only swaps it in if the tests
# pass, so a bad fetch can never leave a broken site published.
#
# WHAT THIS DOES AND DOES NOT REFRESH
#   Refreshed daily:     current eBay asking prices (active listings).
#   NOT refreshed:       sold prices. There is no API that will give them to us
#                        (see README, "Live data"). Sold comps arrive when you
#                        add them - by hand, or via tools/import_sales.py.
#
# So valuations do not change on their own. Only the ask-vs-sold spread does.
# That is a real limitation, not an oversight, and pretending otherwise would
# mean inventing sales.
#
# Requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in the environment.
# Install as a cron job or systemd timer - see tools/README-automation.md.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

LOG_DIR="${BEARCHART_LOG_DIR:-$ROOT/logs}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/daily-$(date +%Y-%m-%d).log"

# Keep two weeks of logs, no more.
find "$LOG_DIR" -name 'daily-*.log' -mtime +14 -delete 2>/dev/null || true

exec > >(tee -a "$LOG") 2>&1

echo "=============================================================="
echo "Plush Price Guide daily refresh - $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "=============================================================="

PATH="/usr/local/bin:$PATH"
export PATH

# Credentials from .env, so a cron line never carries secrets.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

ITEM_LIMIT="${BEARCHART_ITEM_LIMIT:-40}"
PER_ITEM="${BEARCHART_PER_ITEM:-20}"

fail() { echo "FAILED: $*"; exit 1; }

# --- 1. back up what we have, so a bad run is always reversible --------------
BACKUP="$(mktemp -d)"
trap 'rm -rf "$BACKUP"' EXIT
for f in data.json seed.sql recent_bears.js tools/catalogue_wiki.json tools/active_listings.json; do
  [ -f "$f" ] && cp "$f" "$BACKUP/$(basename "$f")"
done
echo "backed up current state to $BACKUP"

restore() {
  echo "restoring previous state"
  for f in data.json seed.sql recent_bears.js; do
    [ -f "$BACKUP/$f" ] && cp "$BACKUP/$f" "$ROOT/$f"
  done
  [ -f "$BACKUP/catalogue_wiki.json" ] && \
    cp "$BACKUP/catalogue_wiki.json" "$ROOT/tools/catalogue_wiki.json"
  if [ -f "$BACKUP/active_listings.json" ]; then
    cp "$BACKUP/active_listings.json" "$ROOT/tools/active_listings.json"
  else
    # None existed before this run: a file the failed run wrote must go too.
    rm -f "$ROOT/tools/active_listings.json"
  fi
  # The generated site files (site-config.js, data/, item pages, sw.js) were
  # rebuilt from the data being rolled back; rebuild them from the restored
  # data.json so a local `npm start` serves what is committed.
  echo "rebuilding generated files from the restored data.json"
  node tools/build_assets.js && python3 tools/build_pages.py && python3 tools/build_pwa.py \
    || echo "WARNING: could not rebuild generated files; run npm run build:dev"
  return 0
}

# --- 2. refresh asking prices ------------------------------------------------
if [ -n "${EBAY_CLIENT_ID:-}" ] && [ -n "${EBAY_CLIENT_SECRET:-}" ]; then
  echo
  echo "--- fetching active eBay listings (asking prices) ---"
  if ! python3 tools/ebay_active.py --priced-only --limit "$ITEM_LIMIT" \
        --per-item "$PER_ITEM"; then
    echo "WARNING: eBay fetch failed. Keeping yesterday's listings and carrying on."
  fi
else
  echo
  echo "--- skipping eBay fetch: EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set ---"
fi

# --- 3. rebuild --------------------------------------------------------------
echo
echo "--- rebuilding ---"
python3 tools/build_data.py || { restore; fail "build_data.py"; }
python3 tools/export_sql.py || { restore; fail "export_sql.py"; }
# The browser's data files, the per-item pages and the service worker are all
# generated from data.json (never committed; the deploy rebuilds them too).
# Regenerated here so the tests below check what will be published.
node tools/build_assets.js || { restore; fail "build_assets.js"; }
python3 tools/build_pages.py || { restore; fail "build_pages.py"; }
# Rebuilds the service worker cache name from a hash of what it precaches. Skip
# this and installed visitors keep yesterday's catalogue forever - offline
# support turning into stale support is the classic way to ship one.
python3 tools/build_pwa.py || { restore; fail "build_pwa.py"; }

# --- 4. verify before publishing --------------------------------------------
echo
echo "--- verifying ---"
if ! npm test --silent; then
  restore
  fail "tests failed - previous state restored, nothing published"
fi

echo
echo "--- summary ---"
python3 - <<'PY'
import json
d = json.load(open("data.json"))
active = d.get("active_listings") or []
print("  items:           %d" % len(d["items"]))
print("  sold comps:      %d" % len(d["sales"]))
print("  active listings: %d (asking prices, never used in a valuation)" % len(active))
if d.get("active_listings_fetched_at"):
    print("  listings as of:  %s" % d["active_listings_fetched_at"])
PY

echo
echo "OK - $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
