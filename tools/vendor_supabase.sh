#!/usr/bin/env bash
# Copy the pinned supabase-js browser bundle into vendor/ and print its SRI hash.
#
# The site loads supabase-js from its own origin, never a CDN: the version is
# fixed (package.json devDependencies, exact), reviewed in git, and checked by
# Subresource Integrity. To upgrade:
#   npm install --save-dev --save-exact @supabase/supabase-js@X.Y.Z
#   ./tools/vendor_supabase.sh
#   then set SUPABASE_VERSION and SUPABASE_SRI in auth.js to what this prints,
#   delete the old vendor/supabase-js-*.min.js, and run npm test (a drift test
#   compares the file's hash with auth.js).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('@supabase/supabase-js/package.json').version")
SRC=node_modules/@supabase/supabase-js/dist/umd/supabase.js
DEST="vendor/supabase-js-${VERSION}.min.js"

[ -f "$SRC" ] || { echo "missing $SRC - run npm install first" >&2; exit 1; }
mkdir -p vendor
cp "$SRC" "$DEST"
echo "version: $VERSION"
echo "file:    $DEST"
echo "sri:     sha384-$(openssl dgst -sha384 -binary "$DEST" | openssl base64 -A)"
