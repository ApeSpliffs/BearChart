#!/usr/bin/env bash
# Daily network step, called by .github/workflows/daily.yml.
# Reads credentials only from the environment (EBAY_*), never from arguments.
# Exits 0 when credentials are missing or the source is down: yesterday's
# listings stay in place and the build still runs.
set -euo pipefail
if [ -n "${EBAY_CLIENT_ID:-}" ] && [ -n "${EBAY_CLIENT_SECRET:-}" ]; then
  python3 tools/ebay_active.py --priced-only --limit "${BEARCHART_ITEM_LIMIT:-40}" \
    || echo "::warning::eBay fetch failed; keeping yesterday's listings"
else
  echo "::notice::No eBay credentials; skipping fetch"
fi
