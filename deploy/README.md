# Deploying composed

Two deliverables: the artifact server container (`apps/server`) behind HTTPS, and the three
public npm packages hellotimber installs. Nothing here rebuilds components; the server only
stores immutable bytes.

## Environments

| Name       | URL                                      | Host                                                                                               |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| staging    | https://composedink-staging.devbox.party | Coolify at hosting.devbox.party, project `composed`, env `staging`, app `8oitzjt2m9ihdsvk364lmb4e` |
| production | https://cdn.composed.ink                 | not deployed; needs composed.ink nameservers, then the same recipe with the ACME rule below        |

The devbox is reached through Cloudflare tunnel `7ba2ef4b-efb4-4738-a9c5-d964ed7a18cd`;
`*.devbox.party` resolves to it already, so a staging host needs no DNS work. A non-devbox
domain needs two things, done for cdn.composed.ink on 2026-11-06 with the `cf` CLI pinned in
`.config/mise.toml` (`mise exec -- cf`, OAuth via `cf auth login`):

```sh
cf dns records create -z cf51948b3e7e1a758d257bb0fc782a56 --body '{"type":"CNAME","name":"cdn",
  "content":"7ba2ef4b-efb4-4738-a9c5-d964ed7a18cd.cfargotunnel.com","proxied":true,"ttl":1}'
cf tunnels config get 7ba2ef4b-...   # PUT replaces the whole config: keep every rule, insert before the 404 catch-all
cf tunnels config update 7ba2ef4b-... --body '{"config":{"ingress":[ ...existing...,
  {"path":"^/\\.well-known/acme-challenge/","service":"http://localhost:80","hostname":"cdn.composed.ink","originRequest":{}},
  {"service":"https://localhost:443","hostname":"cdn.composed.ink","originRequest":{"matchSNItoHost":true}},
  {"service":"http_status:404"}]}}'
```

Without the ACME rule Traefik never gets a certificate and the edge answers 502. The first
probe after deploy returned 502 for a few seconds while Traefik issued the certificate.
Cloudflare proxies and caches the immutable artifacts (`cf-cache-status: HIT`); it also caches a
`.js` 404 briefly, which only matters if something fetches a URL before its release commits.

## Container contract

- Image: `apps/server/Dockerfile`, built from the repo root (`docker build -f apps/server/Dockerfile .`).
  No build args. Multi-stage since plan 16: `node:22.22.3-bookworm-slim` installs the workspace,
  bundles the server (`dist/main.mjs`, with `@composedink/core/model`) and deploys production
  dependencies; the `node:22.22.3-alpine` runtime holds only `dist/`, `node_modules/loro-crdt` and
  `package.json` (no `@rsbuild`, `@mdx-js` or `vite-plus`). `.dockerignore` keeps `node_modules`,
  `dist`, `.git`, `test-results` and the Tauri build output out of the context.
- Port `4849`; health `GET /healthz` → `200 ok` once the database answers (`503` otherwise). The
  server binds IPv4 (`0.0.0.0`), so a probe must use `127.0.0.1`, not `localhost` (Alpine resolves
  it to `::1` first and gets refused).
- Storage: `COMPOSED_STORAGE=/data`, a named volume owned by UID 1000 (`node`). The image creates
  and chowns `/data` so a fresh named volume inherits the ownership. Artifacts and `server.db`
  (accounts, devices, pairing codes, the sync update log and snapshots; SQLite in WAL mode, so
  `server.db-wal` and `server.db-shm` sit beside it) share that volume. Staging's volume is
  `8oitzjt2m9ihdsvk364lmb4e-composed-cdn-staging-data`.
- Secrets, injected as Coolify environment variables (runtime, literal):
  - `COMPOSED_TOKEN`, the bearer for artifact `PUT`. `GET` and `OPTIONS` need no token.
  - `COMPOSED_BOOTSTRAP_TOKEN`, which signs in the first device (`composed login <server>
    --bootstrap <token>`). **Required until the first login**: with no account in `server.db` and
    no variable the container exits at start with `COMPOSED_BOOTSTRAP_TOKEN is required until the
    first device signs in`, and Coolify keeps the old container. Once an account exists it is
    ignored. Staging and production must have it set before their next deploy of `main` (both
    have it as of plan 16; deploying is a separate authorized action).
- Routes beside `/c/`: `/auth` (pairing, device list and revocation), `/sync` (update log,
  pulls, `text/event-stream` changes, and since plan 17 link management under `/sync/links`) and
  `/s` (shared preview link pages and named-guest comments). Limits: 8 MiB per update, 64 MiB per
  snapshot or link creation, 10 failed sign-ins per minute (429), 60 guest requests a minute per
  link token (429 with `Retry-After`). The event stream sends a `: ping` every 25 s, so a proxy
  idle timeout above 30 s keeps it open; clients reconnect and also poll every 30 s. Details in
  `apps/server/README.md`.
- Link pages (`/s/<token>`) are public to anyone holding the URL. They send a strict CSP (only
  their one inline script, by hash; `connect-src 'self'`, no remote scripts, images or frames),
  `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, so the
  edge must not cache or rewrite them. Unknown, revoked and expired tokens all answer one identical 404. Guest posts require an `Origin` whose host equals `Host`, so the proxy must pass `Host`
  through unchanged (Traefik does); the guest cookie gains `Secure` from `X-Forwarded-Proto: https`.
- A link URL uses the server origin the creating device logged in with, so devices must log in
  with the public origin (`composed login https://cdn.composed.ink ...`), not a tunnel or
  container address.
- Restart policy and rollback are Coolify's: a deploy starts the new container, waits for the
  health check, then removes the old one; an unhealthy new container is removed and the old one
  kept. Redeploying any earlier commit is the rollback: a pre-plan-16 image serves artifacts and
  ignores `server.db`; plan 16's and plan 17's migrations only add tables (`003-links` adds `links`
  and `render_snapshots`), and an older image leaves a newer `user_version` alone. The volume
  survives replacement.

## Reset the first account (lost first device)

The bootstrap token works only while `accounts` is empty. If the first device's `session.secret`
is lost before a second device is paired (it happened on staging on 2026-11-07: a stray
`composed logout`), nobody can sign in again. The host is not reachable by SSH, but Coolify runs
an application's post-deployment command inside the new container, so a one-off reset is:

```sh
# post_deployment_command (JSON-encode it in the PATCH body):
#   node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/data/server.db");
#     d.exec("DELETE FROM render_snapshots;DELETE FROM links;DELETE FROM updates;DELETE FROM docs;
#     DELETE FROM pairing_codes;DELETE FROM devices;DELETE FROM accounts")'
curl -X PATCH $H/applications/<app> -d "$(jq -n --arg c "$CMD" '{post_deployment_command:$c}')"
curl -X POST $H/deploy -d '{"uuid":"<app>","force":true}'      # the deployment log shows the output
curl -X PATCH $H/applications/<app> -d '{"post_deployment_command":""}'
```

This deletes every synced document and link on that server, so it is only for a server with no
data worth keeping (staging). Then `composed login <server> --bootstrap <token>` again, on a home
that stays (`COMPOSED_HOME=~/.config/composed/staging-home` holds the staging proof device).

## Verify the image locally

```sh
docker build -f apps/server/Dockerfile -t composed-server:plan17 .
docker run --rm --user root --entrypoint sh composed-server:plan17 -c \
  'ls -a /app/node_modules; find / -xdev \( -name "@rsbuild" -o -name "@mdx-js" -o -name "vite-plus" \) -print'
docker run -d --name composed-plan17 -e COMPOSED_TOKEN=t -e COMPOSED_BOOTSTRAP_TOKEN=b \
  -v composed-plan17-data:/data -p 127.0.0.1::4849 composed-server:plan17
curl -fsS http://$(docker port composed-plan17 4849)/healthz   # ok
docker exec composed-plan17 ls -l /data/server.db
docker rm -f composed-plan17 && docker volume rm composed-plan17-data
```

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
curl -X POST $H/applications/<app>/envs -d '{"key":"COMPOSED_BOOTSTRAP_TOKEN","value":"<openssl rand -base64 32>","is_literal":true}'
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

Done on the author Mac on 2026-11-06: scope `lachieh` → `https://cdn.composed.ink`, token ref
`COMPOSED_CDN_TOKEN` (`~/.composed/scopes.json`). The studio process needs that variable set,
e.g. `COMPOSED_CDN_TOKEN=$(cat ~/.config/composed/production-cdn-token) composed studio`.
Tokens stay in `$COMPOSED_HOME` and `~/.config/composed/{staging,production}-cdn-token`;
documents and locks only carry the public URLs. In this checkout, mise loads a gitignored root
`.env` (`.config/mise.toml`, `_.file`) holding `COMPOSED_CDN_TOKEN` and the production
`COMPOSED_BOOTSTRAP_TOKEN`, so `mise exec -- composed studio` has the author scope token. The first
production device (`macmini`, account created 2026-11-07) lives on `~/.composed`.

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
