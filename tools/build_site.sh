#!/usr/bin/env bash
# Assemble the deployable site into dist/.
#
# site-config.js, data/, the item pages, sitemap.xml and sw.js are generated,
# not committed (see .gitignore), so a host that deploys straight from the repo
# serves a site with no data at all. This rebuilds them from data.json and
# copies only what a browser should ever see - no tools/, no *.sql, no
# data.json, no node_modules.
set -euo pipefail

cd "$(dirname "$0")/.."
DIST=dist

command -v python3 >/dev/null || {
  echo "build_site.sh needs python3 to generate the item pages." >&2
  exit 1
}

# The browser's data: site-config.js, the hashed catalogue index and listings,
# and one file per item - all split from data.json (tools/build_assets.js).
node tools/build_assets.js

# The sitemap needs absolute URLs, so the base address has to come from the
# host. Netlify sets URL to the primary domain (https://plushpriceguide.com)
# and DEPLOY_PRIME_URL to this deploy's own address, schemes included.
if [ "${CONTEXT:-}" = "production" ] && [ -n "${URL:-}" ]; then
  BASE="$URL"                                    # Netlify production
elif [ -n "${DEPLOY_PRIME_URL:-}" ]; then
  BASE="$DEPLOY_PRIME_URL"                       # Netlify deploy preview / branch deploy
else
  BASE=""                                        # local build; no sitemap, not an error
fi

if [ -n "$BASE" ]; then
  python3 tools/build_pages.py --base-url "$BASE"
else
  echo "No URL in the environment: building without a sitemap."
  python3 tools/build_pages.py
fi

# Per-environment runtime config (accounts, error reporting, analytics) replaces
# the inert committed copy. A preview with no staging settings gets accounts
# switched off. See docs/ENVIRONMENTS.md. Written first so the service worker
# precaches the deployed copy's hash, not the committed one's.
RUNTIME_CONFIG="$(mktemp)"
trap 'rm -f "$RUNTIME_CONFIG"' EXIT
python3 tools/build_runtime_config.py > "$RUNTIME_CONFIG"

# Must follow build_pages.py: it hashes item/_offline.html into the cache name.
BEARCHART_CONFIG_JS="$RUNTIME_CONFIG" python3 tools/build_pwa.py

rm -rf "$DIST"
mkdir -p "$DIST/data"
cp -r item icons images vendor "$DIST"/
# The browser's data: hashed index/listings and per-item files. Not
# data/manifest.json (a build input), and never data.json itself.
cp -r data/h data/items "$DIST/data/"
cp ./*.html ./*.js ./*.css favicon.ico manifest.webmanifest robots.txt _headers "$DIST"/
[ -f sitemap.xml ] && cp sitemap.xml "$DIST"/

cp "$RUNTIME_CONFIG" "$DIST/config.js"

# Link previews (Facebook, iMessage, Discord) need an absolute image address,
# which only the host knows. The pages carry a root-relative one for local use.
if [ -n "$BASE" ]; then
  sed -i "s#content=\"/icons/ppg-og-image.png\"#content=\"${BASE%/}/icons/ppg-og-image.png\"#" "$DIST"/*.html
fi

echo "dist/: $(find "$DIST" -type f | wc -l) files"
