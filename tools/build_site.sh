#!/usr/bin/env bash
# Assemble the deployable site into dist/.
#
# The 2,042 item pages, sitemap.xml and sw.js are generated, not committed
# (see .gitignore), so a host that deploys straight from the repo serves a
# site with no item pages at all. This rebuilds them and copies only what a
# browser should ever see - no tools/, no *.sql, no data.json, no node_modules.
set -euo pipefail

cd "$(dirname "$0")/.."
DIST=dist

# Netlify sets URL for the production site and DEPLOY_PRIME_URL for previews.
# Without a base URL build_pages.py writes no sitemap, which is not an error.
BASE="${DEPLOY_PRIME_URL:-${URL:-}}"

if [ -n "$BASE" ]; then
  python3 tools/build_pages.py --base-url "$BASE"
else
  echo "No URL in the environment: building without a sitemap."
  python3 tools/build_pages.py
fi

# Must follow build_pages.py: it hashes item/_offline.html into the cache name.
python3 tools/build_pwa.py

rm -rf "$DIST"
mkdir -p "$DIST"
cp -r item icons "$DIST"/
cp ./*.html ./*.js ./*.css manifest.webmanifest robots.txt "$DIST"/
[ -f sitemap.xml ] && cp sitemap.xml "$DIST"/

echo "dist/: $(find "$DIST" -type f | wc -l) files"
