# Plan 12 — Deploy artifact delivery and npm integrations

> Execute only this plan, task-by-task. Tick and commit verified tasks. Stop and report contract/code discrepancies. Paths are composedink-relative. Do not modify hellotimber.

**Depends on:** 09. Execute before 10; plan numbers do not imply execution order.

**Goal:** deliver the existing artifact server at `https://cdn.composed.ink`, publish the three host packages to npm, and configure the author device so plan 10 can use npm packages and real locked URLs.

**Build contract:** TanStack Start is required. MF hosts use `@tanstack/react-start/plugin/rsbuild`;
component builds use Rsbuild/Rspack + `@module-federation/rsbuild-plugin`, named `var` remotes
loaded as `type: "global"`. Materialization includes the catalogued Rsbuild/React/MF build tools;
sourceHash covers files, generated lock and settings. MDX loaders register sibling locks through
`this.addDependency` for dev SSR invalidation. Vite+ remains tests/lint/format and non-MF apps.

**Files:** `apps/server/{Dockerfile,README.md}`, deployment configuration under `deploy/`, public package manifests/pack configuration only if deployment verification requires corrections, deployment runbook. Device configuration stays under `$COMPOSED_HOME`, never in Git or Loro. Do not add sync/accounts or server bundling.

### Task 1 — Prepare and deploy the container

- [ ] Run 09's server tests and build its container. Document deployment environment, port, persistent artifact volume, token injection, health/readiness check, restart policy and rollback to the previous image. Keep immutable artifact storage across replacement; deploy does not rebuild components.
- [ ] Deploy apps/server as a container behind HTTPS at cdn.composed.ink. Lachlan owns composed.ink. List these as human tasks in the runbook: create/confirm DNS records, provision/authorize TLS and confirm certificate renewal. Prepare exact values from the selected deployment before handoff; do not invent credentials or mark these tasks done without evidence.
- [ ] Inject the existing publication token securely. Public GET and module CORS require no token; PUT remains authenticated. Test traversal rejection, complete-upload visibility and immutable caching against the deployed endpoint. Redeploy/restart and verify old URLs still return identical bytes.

### Task 2 — Publish the integration packages

- [ ] Lachlan has created npm org `composedink`. Use its authorized publisher identity to publish `@composedink/blocks`, `@composedink/host-runtime` and `@composedink/host-tanstack`. Run `mise exec -- vp pack` in each package; publish the verified pack outputs, not raw workspace source. Retain JS/types, explicit exports and React peer dependencies from 09.
- [ ] Record package versions, tarball checksums and npm registry URLs. Install those exact versions from npm into an isolated copy of the example host with no workspace links; build and exercise the release-lock page. This gate proves npm deployment rather than only local tarball compatibility.

### Task 3 — Configure and prove the author path

- [ ] Use 09's `composed config scope <scope> --server https://cdn.composed.ink --token-ref <ref>` to map the author scope and store a token reference on the author device. Tokens never enter document state or exported locks.
- [ ] With the existing studio, create/check/publish a small component, pin the returned version and release-export a temp post. Assert the locked absolute entry URL points at cdn.composed.ink. Build the isolated npm-installed example without network or component execution during compilation; serve its prerendered fallback with JS off, then enable JS and load the real remote with one React identity. Blocking the remote preserves fallback.
- [ ] Record server image/version, public package versions, scope mapping (without token), immutable URLs and smoke results for 10. Leave DNS/TLS or publication tasks explicitly incomplete if human access is unavailable; plan 10 cannot proceed on a local-test-server substitute.

**Verification:** `mise exec -- vp run composed-server#test`, `mise exec -- vp run @composedink/core#test`, `mise exec -- vp run host-tanstack#build`, `mise exec -- vp run host-tanstack#e2e`, and `mise exec -- vp pack` in each public package. Container build/deploy, registry publication and isolated npm installation use the selected provider/package tools documented here during execution; no future composed commands are required. Archive HTTPS/CORS/immutable-retry results, npm installation evidence and real-server lock. DNS/TLS completion must be confirmed by the human tasks above.

**Out of scope:** blog deployment, hellotimber edits, accounts/sync, listing, server builds, authored-component npm export.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests use vite-plus/test and package vite.config.ts. Stage only this unit's files and commit verified tasks. These commands are implementation gates, not results of this documentation revision.

### Implementation log — 2026-11-06

Implemented the Tasks 2/3 infrastructure switches without publishing packages or changing
Coolify, production DNS/TLS, or hellotimber:

- `tests/tracer.ts` accepts paired `COMPOSED_RELEASE_SERVER` / `COMPOSED_RELEASE_TOKEN`.
  The deployed path skips the local CDN, configures the temporary author's scope using
  token-ref `COMPOSED_TOKEN`, and passes that environment reference to studio/CLI and
  authenticated retry/conflict PUTs. Publishing computes `--minor` from the fresh local
  authority only, so persistent storage would collide at `0.1.0`. A per-run
  `verify-<time>-<uuid>` scope avoids that; component `hello` and MDX binding `Hello` stay
  unchanged. Default local behavior remains available.
- Release proofs now include remote-entry SHA-256 and scope mapping without the token,
  plus assertions of interaction, React identity and blocked-remote fallback on the released
  page (these previously ran only on the later dev preview). Both modes retain the original
  tracer assertions. Deployed runs also write `release-proof-staging.json`.
- `tests/tarball-consumer.ts` reads manifest versions when packing. With `COMPOSED_NPM_VERSION`,
  it skips packing, installs exact versions explicitly from npm, removes file overrides,
  retains the Vite override, and asserts isolated pnpm registry paths, versions, compiled
  exports and absence of `workspace:`. Its proof records source, versions and build success.
- `tests/deny-network.mjs` permits an explicit hostname or host:port while retaining the
  default `COMPOSED_DENY_PORT` rejection. Both proofs derive the allowed host from the
  release URL. `tests/deny-network.test.ts` exercises fetch and socket behavior for default
  denial, matching host, matching host:port, wrong host and wrong port.
- `deploy/README.md` documents commands and proof semantics. pnpm 12 warned that the
  fixture's existing `package.json` pnpm overrides are ignored; removed that duplicate
  field, retaining effective overrides in the existing `pnpm-workspace.yaml`.

Verified staging portions (these do not complete the production/npm gates above):

- [x] Configure a temporary author scope against staging with an environment token reference.
- [x] Create/publish/pin/release-export against staging; assert the locked absolute URL.
- [x] Retry 200 / conflicting PUT 409; released fallback with JS off, real remote interaction
      with one React identity, and blocked-remote fallback.
- [x] Pack all three 0.1.0 packages and build/prerender an isolated tarball-installed host
      against the staging release lock under the network guard.
- [x] Independently curl the public remote: HTTP 200, immutable one-year caching, matching SHA-256.
- [ ] Install and exercise the published npm packages: blocked on boss's OTP publication.
- [ ] Production cdn.composed.ink, permanent author configuration and server image/version
      handoff remain outside this unit; no deployment changes or image inspection performed.

Staging publication: version `0.1.0`,
`https://composedink-staging.devbox.party/c/verify-1793977439724-c933362d-3f5b-4e9b-b885-e26fc4ff8c76/hello/0.1.0/remoteEntry.js`.
Entry SHA-256: `be1184968458caec078276fb61f445e319d42557d672d75b11a5100f8f641830`.

Evidence (gitignored, retained on this machine): `test-results/release-proof.json`,
`release-proof-staging.json`, `staging-remote-headers.txt`, `staging-remoteEntry.js`,
`tarball-consumer-proof.json`, `package-artifacts.json` (0.1.0 archive checksums and intended
registry URLs, explicitly unpublished), `tracer-local.log`, `tracer-staging.log`,
`tarball-consumer.log`, `registry-consumer.log`, plus the tracer's existing screenshots,
locks, module trace and build logs. Registry failure does not overwrite the last successful
consumer proof; its `source` remains `tarballs`.

Verification commands/results (all from the repo root):

- `mise exec -- vp install`: passed, lockfile unchanged.
- `mise exec -- vp check --fix`: passed, no warnings/lint/type errors in 160 files.
- `mise exec -- vp fmt` twice after fixes: passed and stable; `git diff --check` passed.
- `mise exec -- vp test run tests/deny-network.test.ts`: passed, 1 test.
- `mise exec -- vp run host-tanstack#e2e`: passed; all six groups true.
- `COMPOSED_RELEASE_SERVER=https://composedink-staging.devbox.party COMPOSED_RELEASE_TOKEN=$(cat ~/.config/composed/staging-cdn-token) mise exec -- vp run host-tanstack#e2e`:
  passed; all six groups true. The token was read and inherited, never printed or committed.
- `URL=$(mise exec -- node -p 'JSON.parse(require("fs").readFileSync("test-results/release-proof-staging.json")).publication.url')`
  then `curl --fail --silent --show-error -D test-results/staging-remote-headers.txt "$URL" -o test-results/staging-remoteEntry.js`:
  HTTP/2 200, `cache-control: public, max-age=31536000, immutable`; independent
  `shasum -a 256 test-results/staging-remoteEntry.js` matched the proof.
- `mise exec -- vp run tarball-consumer`: passed against staging, all three packages 0.1.0,
  no workspace links, successful guarded build and `/posts/tracer` prerender. Repeated after
  removing the obsolete pnpm field; passed again.
- `COMPOSED_NPM_VERSION=0.1.0 mise exec -- vp run tarball-consumer`: expected exit 1 at
  `pnpm install --ignore-scripts --registry=https://registry.npmjs.org`, public npm 404 for
  `@composedink/host-runtime` on the first attempt and `@composedink/host-tanstack` after the
  pnpm field cleanup. No packing, file overrides, build or publish occurred in registry mode.
  The installed-package assertions cannot run until the packages exist. The root script's
  existing runtime resolves Node 26.12.0 here; the tracer explicitly runs Node 22.22.3.
- `mise exec -- vp run -r test`: passed, 9/9 tasks, including the existing long core
  durability test. Archived as `workspace-tests.log`; quality/formatter/network-test tails
  are in `check.log`, `fmt-first.log`, `fmt-stable.log`, `network-guard.log`.

No plan/API discrepancies required stopping implementation. Incomplete gates are the
explicitly deferred npm OTP publication/registry installation and production configuration.
