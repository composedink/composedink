#!/bin/sh
# Builds, packs and publishes the public host packages in dependency order.
# Run from the repo root with an npm identity that can publish @composedink/*:
#   NPM_CONFIG_USERCONFIG=~/.config/npm/npmrc mise exec -- deploy/publish-npm.sh [version]
# npm 11's `npm login` writes its token to ~/.config/npm/npmrc, which Node 22's npm does not read
# without NPM_CONFIG_USERCONFIG. A 2FA account prompts for a one-time password per package
# (a browser URL on npm 11); a granular access token with "bypass 2FA" avoids the prompts.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
version=${1:-}
out=${PACK_OUT:-"$root/test-results/npm-pack"}
mkdir -p "$out"
for p in blocks host-runtime host-tanstack; do
  (
    cd "$root/packages/$p"
    [ -n "$version" ] && npm version "$version" --no-git-tag-version >/dev/null
    vp pack >/dev/null
    pnpm pack --pack-destination "$out" >/dev/null
  )
done
for p in blocks host-runtime host-tanstack; do
  v=$(jq -r .version "$root/packages/$p/package.json")
  tgz="$out/composedink-$p-$v.tgz"
  echo "publishing @composedink/$p@$v $(shasum -a 256 "$tgz" | cut -d' ' -f1)"
  npm publish "$tgz" --access public
done
for p in blocks host-runtime host-tanstack; do
  npm view "@composedink/$p" version dist.tarball dist.integrity
done
