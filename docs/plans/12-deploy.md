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
