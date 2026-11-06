#!/bin/sh
# Verifies a deployed artifact server. Usage: COMPOSED_TOKEN=... deploy/verify.sh https://host [scope]
# Publishes scope/verify/<unix-time>.0.0 (immutable, so each run uses a fresh version) and checks
# the public contract. Exits non-zero on the first failing check.
set -eu
base=${1:?base url}; scope=${2:-verify}; v="$(date +%s).0.0"; dir="$base/c/$scope/verify/$v"
auth="Authorization: Bearer ${COMPOSED_TOKEN:?token}"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check() { [ "$2" = "$3" ] && echo "ok   $1 ($2)" || { echo "FAIL $1: got $2 want $3"; exit 1; }; }
check healthz "$(code "$base/healthz")" 200
check "traversal rejected" "$(code -X PUT -H "$auth" --data x "$base/c/$scope/verify/$v/..%2Fescape.js")" 400
check "dotdot segment rejected" "$(code -X PUT -H "$auth" --data x "$base/c/$scope/../verify/$v/a.js")" 400
check "unauthenticated PUT" "$(code -X PUT --data x "$dir/remoteEntry.js")" 401
check "staged file PUT" "$(code -X PUT -H "$auth" --data 'export const v=1;' "$dir/remoteEntry.js")" 200
# Query string avoids a CDN caching this 404 for the final URL (Cloudflare caches 404s on .js briefly).
check "staged file invisible" "$(code "$dir/remoteEntry.js?staged=$v")" 404
sha=$(printf 'export const v=1;' | shasum -a 256 | cut -d' ' -f1)
check "release.json commit" "$(code -X PUT -H "$auth" --data "{\"files\":{\"remoteEntry.js\":\"$sha\"}}" "$dir/release.json")" 200
check "public GET" "$(code "$dir/remoteEntry.js")" 200
hdr=$(curl -sI "$dir/remoteEntry.js")
check "immutable cache" "$(printf '%s' "$hdr" | grep -ic 'cache-control: public, max-age=31536000, immutable')" 1
check "CORS" "$(printf '%s' "$hdr" | grep -ic 'access-control-allow-origin: \*')" 1
check "same bytes re-PUT" "$(code -X PUT -H "$auth" --data 'export const v=1;' "$dir/remoteEntry.js")" 200
check "conflicting bytes re-PUT" "$(code -X PUT -H "$auth" --data 'export const v=2;' "$dir/remoteEntry.js")" 409
check "committed version cannot grow" "$(code -X PUT -H "$auth" --data x "$dir/extra.js")" 409
echo "published $dir/remoteEntry.js sha256 $(curl -s "$dir/remoteEntry.js" | shasum -a 256 | cut -d' ' -f1)" > "${VERIFY_OUT:-/dev/null}"
echo "published $dir/remoteEntry.js sha256 $(curl -s "$dir/remoteEntry.js" | shasum -a 256 | cut -d' ' -f1)"
