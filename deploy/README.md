# Deploying composed

Two deliverables: the artifact server container (`apps/server`) behind HTTPS, and the three
public npm packages hellotimber installs. Nothing here rebuilds components; the server only
stores immutable bytes.

## Environments

| Name       | URL                                      | Host                                                                                               |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| staging    | https://composedink-staging.devbox.party | Coolify at hosting.devbox.party, project `composed`, env `staging`, app `8oitzjt2m9ihdsvk364lmb4e` |
| production | https://cdn.composed.ink                 | not deployed; needs composed.ink nameservers, then the same recipe with the ACME rule below        |

The devbox is reached through a Cloudflare tunnel; `*.devbox.party` resolves to it already, so a
staging host needs no DNS work. A non-devbox domain (cdn.composed.ink) additionally needs the
tunnel ingress rule for `/.well-known/acme-challenge/` → `http://localhost:80` ahead of the host's
443 rule, or Traefik never gets a certificate and the edge answers 502.

## Container contract

- Image: `apps/server/Dockerfile`, built from the repo root (`docker build -f apps/server/Dockerfile .`).
  No build args; the image carries only `apps/server/src` on `node:22-alpine`.
- Port `4849`; health `GET /healthz` → `200 ok`. The server binds IPv4 (`0.0.0.0`), so a probe
  must use `127.0.0.1`, not `localhost` (Alpine resolves it to `::1` first and gets refused).
- Storage: `COMPOSED_STORAGE=/data`, a named volume owned by UID 1000 (`node`). The image creates
  and chowns `/data` so a fresh named volume inherits the ownership. Staging's volume is
  `8oitzjt2m9ihdsvk364lmb4e-composed-cdn-staging-data`.
- Secret: `COMPOSED_TOKEN`, the bearer for `PUT`. Injected as a Coolify environment variable
  (runtime, literal). `GET` and `OPTIONS` need no token.
- Restart policy and rollback are Coolify's: a deploy starts the new container, waits for the
  health check, then removes the old one; an unhealthy new container is removed and the old one
  kept. Redeploying any earlier commit is the rollback. The volume survives replacement.

## Coolify recipe (what created staging, via the API with the `devbox` token from `~/.config/coolify/config.json`)

```sh
H=https://hosting.devbox.party/api/v1; T=<token>
curl -X POST $H/projects -d '{"name":"composed"}'                              # → project uuid
curl -X POST $H/projects/<project>/environments -d '{"name":"staging"}'        # → env uuid
curl -X POST $H/applications/public -d '{
  "project_uuid":"<project>","server_uuid":"hfbqjiy2sx09u1xoleaiqcan","environment_uuid":"<env>",
  "name":"composed-cdn-staging","git_repository":"https://github.com/composedink/composedink",
  "git_branch":"main","build_pack":"dockerfile","dockerfile_location":"/apps/server/Dockerfile",
  "base_directory":"/","ports_exposes":"4849","domains":"https://composedink-staging.devbox.party",
  "health_check_enabled":true,"health_check_path":"/healthz","health_check_port":"4849",
  "instant_deploy":false}'                                                     # → app uuid
curl -X PATCH $H/applications/<app> -d '{"health_check_host":"127.0.0.1","health_check_start_period":10}'
curl -X POST $H/applications/<app>/envs -d '{"key":"COMPOSED_TOKEN","value":"<openssl rand -hex 32>","is_literal":true}'
curl -X POST $H/applications/<app>/storages -d '{"type":"persistent","name":"composed-cdn-staging-data","mount_path":"/data"}'
curl -X POST $H/deploy -d '{"uuid":"<app>","force":true}'                      # GET /deployments/<uuid> until finished
```

All calls take `-H "Authorization: Bearer $T" -H 'Content-Type: application/json'`. Deploys are
not automatic: `POST /deploy` after pushing to `main`. `POST /applications/<app>/restart` restarts
without rebuilding. Coolify drops the Dockerfile's `HEALTHCHECK` and uses its own settings.

## Verify a deployment

```sh
COMPOSED_TOKEN=<token> deploy/verify.sh https://composedink-staging.devbox.party
```

Publishes a throwaway `verify/verify/<time>.0.0` release and checks: health, traversal and
`..` rejection, unauthenticated PUT, staged files invisible until `release.json`, public GET with
`Cache-Control: public, max-age=31536000, immutable` and `Access-Control-Allow-Origin: *`,
same-bytes retry 200, conflicting bytes 409, no new files after commit. Re-run after a restart or
redeploy and compare the printed sha256 of an earlier release's `remoteEntry.js`: it must not
change. The staging token lives at `~/.config/composed/staging-cdn-token` on the author Mac.

## Publish the npm packages

```sh
NPM_CONFIG_USERCONFIG=~/.config/npm/npmrc mise exec -- deploy/publish-npm.sh
```

Builds (`vp pack`), packs (`pnpm pack`, which resolves `workspace:` and `catalog:` to exact
versions) and publishes `@composedink/blocks`, `host-runtime`, `host-tanstack` in that order, then
prints the registry records. Bump versions first with `deploy/publish-npm.sh 0.2.0`.

## Author device

```sh
composed config scope <scope> --server https://composedink-staging.devbox.party --token-ref composed/staging-cdn-token
```

Tokens stay in `$COMPOSED_HOME`; documents and locks only carry the public URLs.

## Repeat the end-to-end deployment proofs

From the repo root, with dependencies installed:

```sh
# Local server (default).
mise exec -- vp run host-tanstack#e2e
# Persistent staging server; the token is passed to the temporary authority as COMPOSED_TOKEN.
COMPOSED_RELEASE_SERVER=https://composedink-staging.devbox.party \
  COMPOSED_RELEASE_TOKEN=$(cat ~/.config/composed/staging-cdn-token) \
  mise exec -- vp run host-tanstack#e2e
# Consume the last release-proof.json, packing the current package versions locally.
mise exec -- vp run tarball-consumer
# After npm publication, consume exact registry versions without packing or file overrides.
COMPOSED_NPM_VERSION=0.1.0 mise exec -- vp run tarball-consumer
```

Each deployed tracer run uses a fresh `verify-<time>-<uuid>` scope: `--minor` allocates
from the fresh local authority, so reusing a scope would collide at `0.1.0` on immutable
storage. The component stays `hello`, the MDX binding stays `Hello`, and no token is written
to a lock or proof. Scope configuration lives only in the temporary author home.

The tracer writes `test-results/release-proof.json` and, in deployed mode,
`release-proof-staging.json`, including the URL, version, remote entry SHA-256, scope
mapping and release lock. It checks retry/conflict, prerendered fallback, real remote
interaction, React identity and blocked-remote fallback. The consumer writes
`tarball-consumer-proof.json` with source, exact versions and build success after a
successful install/build. Registry mode requires all three versions to exist on npm.

Build subprocesses use `tests/deny-network.mjs`: external networking is denied except
`COMPOSED_ALLOW_HOST` (hostname for any port, or `hostname:port` for one port). Both
proofs derive that allowance from the release server/lock. Without an explicit allowance,
`COMPOSED_DENY_PORT` still rejects the local artifact port as before.
