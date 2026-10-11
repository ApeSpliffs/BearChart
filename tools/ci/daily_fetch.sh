#!/usr/bin/env bash
# Daily network step, called by .github/workflows/daily.yml.
# Reads credentials only from the environment (EBAY_*), never from arguments.
# Exits 0 when credentials are missing or the source is down. The CI checkout
# has no tools/active_listings.json (it is gitignored), so the build then
# carries forward the listings the committed data.json already publishes
# (tools/build_data.py load_active_listings), with their original
# fetched_at date - stale, never silently empty.
set -euo pipefail
if [ -n "${EBAY_CLIENT_ID:-}" ] && [ -n "${EBAY_CLIENT_SECRET:-}" ]; then
  python3 tools/ebay_active.py --priced-only --limit "${BEARCHART_ITEM_LIMIT:-40}" \
    || echo "::warning::eBay fetch failed; the build carries forward the listings in data.json"
else
  echo "::notice::No eBay credentials; skipping fetch (listings carried forward from data.json)"
fi
