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

command -v python3 >/dev/null || {
  echo "build_site.sh needs python3 to generate the item pages." >&2
  exit 1
}

# The sitemap needs absolute URLs, so the base address has to come from the
# host. Each names it differently, and Vercel's carries no scheme.
if [ -n "${DEPLOY_PRIME_URL:-}" ]; then
  BASE="$DEPLOY_PRIME_URL"                       # Netlify deploy preview
elif [ -n "${URL:-}" ]; then
  BASE="$URL"                                    # Netlify production
elif [ "${VERCEL_ENV:-}" = "production" ] && [ -n "${VERCEL_PROJECT_PRODUCTION_URL:-}" ]; then
  BASE="https://$VERCEL_PROJECT_PRODUCTION_URL"  # Vercel production
elif [ -n "${VERCEL_URL:-}" ]; then
  BASE="https://$VERCEL_URL"                     # Vercel preview
else
  BASE=""                                        # local build; no sitemap, not an error
fi

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
cp -r item icons images "$DIST"/
cp ./*.html ./*.js ./*.css favicon.ico manifest.webmanifest robots.txt "$DIST"/
[ -f sitemap.xml ] && cp sitemap.xml "$DIST"/

# Link previews (Facebook, iMessage, Discord) need an absolute image address,
# which only the host knows. The pages carry a root-relative one for local use.
if [ -n "$BASE" ]; then
  sed -i "s#content=\"/icons/og-image.png\"#content=\"${BASE%/}/icons/og-image.png\"#" "$DIST"/*.html
fi

echo "dist/: $(find "$DIST" -type f | wc -l) files"
