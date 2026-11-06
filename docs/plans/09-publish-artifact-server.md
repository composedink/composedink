# Plan 09 — Publish, artifact server and release export

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 02, 04, 05, 08. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** immutable publication and reproducible offline host compilation, plus safe round-tripping of outside-file edits. No deployment or real npm publish is required to complete this implementation plan.

**Build contract:** TanStack Start is required. MF hosts use `@tanstack/react-start/plugin/rsbuild`;
component builds use Rsbuild/Rspack + `@module-federation/rsbuild-plugin`, named `var` remotes
loaded as `type: "global"`. Materialization includes the catalogued Rsbuild/React/MF build tools;
sourceHash covers files, generated lock and settings. MDX loaders register sibling locks through
`this.addDependency` for dev SSR invalidation. Vite+ remains tests/lint/format and non-MF apps.

**Files:** `apps/server/{package.json,tsconfig.json,vite.config.ts,src/main.ts,src/artifacts.ts,tests/artifacts.test.ts,Dockerfile,README.md}`; `packages/core/src/{publish,export}.ts`, `src/store/{intents,receipts,export-history}.ts`, `src/model/{apply,releases}.ts` and tests; `apps/cli/src/{import,config}.ts`; host remark/runtime tests; publishable package manifests/pack configs; example release e2e.

### Task 1 — Serve immutable artifacts

- [x] Implement token-authenticated PUT and public GET under `/c/<scope>/<name>/<version>/...`; strict path/version validation, safe filesystem storage, correct MIME, immutable caching and CORS for module loading. Same bytes returns 200; differing bytes at an existing version returns 409. Upload a complete manifest/artifact set before exposing its entry; reject partial release visibility. Token comes from environment/server config and device token reference, never doc/lock.
- [x] component.publish captures source frontiers, checks/builds locally, allocates semver bump under authority serialization, PUTs artifacts to scope's configured server, and calls model/releases to mutate the immutable release record only after success. Store writes only local files, never Loro; all Loro mutation remains in model (+ web binding). Persist publish intent so retry uses the same version/bytes. A lost response must not bump again. sourceHash records files plus exact dependency resolution/build settings.
- [x] Ship device-only `composed config scope <scope> --server <url> --token-ref <ref>` in CLI config, persisting scope mapping/token reference under COMPOSED_HOME; never token values in docs/locks.
- [x] Implement deps.pin. Post deps remains version intent; release export rejects dev/unpublished pins, resolves exact release/version/absolute entry/sourceHash. Config changes do not redirect existing locks.

### Task 2 — Release and import safely

- [x] Register `doc.import(i: Mutation<{doc;file:string}>): Promise<{head:Frontiers;imported:boolean}>`, the reconciliation step without writing files. Generate human-only `composed import <doc> --file <path>` with the same adapter capability as --direct, excluded from MCP. Use target lock.base/view; export performs the same reconciliation before replacing an edited file. Diff scratch projection at base, map deltas into fork, merge, normalize, and retain hidden dim text. Unknown/missing base requires explicit base recovery; never guess latest. No CLI --direct bypass. Before diff, reject file hashes matching earlier per-destination `(mdxHash,lockHash,base,at)` exports rather than current lock with RecoveryRequired naming versions. Merged import and receipt keyed `(target path,lock.base,sha256 outside file)` share a durable transaction; repeated import/crash retry returns stored result payload. Receipts/history live under state/, never in Loro. ExportResult.directory is return-only.
- [x] Claim a target lease keyed by canonical destination, not only doc ID; TargetBusy prevents two documents overwriting one folder. Use 02's protocol: import outside edit → snapshot head → project → evaluate → intent → rename MDX → rename lock → complete. Compare stored hashes and preserve unexpected bytes after a crash.
- [x] Host remark validates each usage's literal props → defaults → canonical instance hash, never whole-file MDX hash. Production preview locks render fallback only, no remote registration, one build warning per post with composed export <doc>. Lock sha256 is only composed outside-edit detection; formatter rewrites import benignly. Missing usage fails with file:line and `composed export <doc>`. Build is lock-only: deny outgoing network and instrument module loading to prove no fallback/component execution.
- [x] Update tracer harness: keep dev-preview checks, but build/prerender production evidence from artifacts published to a local test server and a release lock. Also build a preview-lock fixture: it must warn once and render fallback without attempting remote load. No special production bypass flag. JS-off and failed-remote fallback remain identical.

### Task 3 — Package public integrations

- [x] Configure `vp pack` for blocks/host-runtime/host-tanstack under @composedink, with JS/types and explicit exports; retain TS-source exports for workspace consumption via the supported packaging mechanism. Verify installed tarballs in an isolated host fixture, without undeclared siblings. Keep React peer/dev dependencies. Publish documentation specifies npm credentials/release steps; actual npm publication is a separately authorized external action.

**Verification:** run `mise exec -- vp run composed-server#test`, `mise exec -- vp run @composedink/core#test`, `mise exec -- vp run host-tanstack#e2e`, and each public package's `mise exec -- vp pack` from its directory. Test immutable retries/conflicting bytes, invalid token, traversal, incomplete upload, CORS, CDN outage, lost publish ack, production preview fallback/warning/no-registration and missing instance. Test repeated outside import after crash returns one receipt, earlier MDX/current lock fails naming versions without diff, and formatter-only MDX edits round-trip. Hand-edit exported clean MDX after concurrent studio edits; import/export preserves both plus hidden text. Kill between file renames, recover; introduce unexpected bytes and observe RecoveryRequired. Build with network denied, serve published HTML with JS off and then remote from artifact URL.

**Out of scope:** accounts/sync, server bundling, deployment, real registry publish, listing/promote, federated SSR, RSS bodies.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

2026-11-06 — Task 1 verified. Added the Node 22.22.3 artifact app, filesystem
staging and atomic complete-set publication, authenticated PUT, immutable retry/409,
public GET with CORS/cache/MIME, Dockerfile and local operation instructions.
A regression additionally recreates a crash after writing the staging manifest but
before directory promotion: retry now completes promotion. Its red and green logs
are plan-09-server-crash-red.log and plan-09-server-final.log under test-results/.
Publication checks/builds the captured frontiers, persists exact artifact bytes and
version before PUT, and writes releases only through model/releases after success.
A lost-response test reopens the authority and verifies identical bytes/version.
Added device scope config with environment token references, deps.pin, exact release
resolution and UnpinnedDependency validation. Tokens never enter documents/locks.
Evidence: plan-09-server-red.log, plan-09-publish.log, plan-09-focused.log (13 tests),
plan-09-task1-tests-final.log (9/9 tasks), plan-09-check.log and final-check.log.
Task 2 and Task 3 verification is being completed; no contradiction or stop.

2026-11-06 — Task 2 verified. Registered human-only doc.import/CLI import over the
retained-base clean/full importer, with canonical destination receipt keys and the
existing durable reconciliation/history envelopes. CLI enforces the direct-acceptance
capability even when --direct is supplied; MCP excludes import. Exports and explicit
imports claim canonical target SQLite leases until transaction completion; recovery
claims the same lease. Symlink aliases and a second document targeting the same folder
fail TargetBusy. Existing rename-fault, unexpected-byte, formatter/hidden-text and
old-MDX/current-lock tests remain green. Added publish/import round-trip and target tests.
Host missing-instance diagnostics now include file:line; props/default/hash validation
continues to ignore whole-file formatting. Host tests prove one production-preview
warning per post; browser proof confirms fallback-only and no remoteEntry request.

The tracer publishes to the local artifact app, checks 200 retry / 409 conflict, pins a
release, merges studio and outside-file edits on export, compiles with artifact/external
network access denied, and loads the released remote in production. Module traces exclude
authored block/fallback implementations; JS-off and blocked-remote fallback checks pass.
The missing-sidecar case emits the required unresolved Hello render error (TanStack's
prerender command exits zero despite that render error; evidence asserts the error text).
The last authoring interaction now reloads explicitly after live updates and waits for
initial counter state; interrupted reloads accept only ERR_ABORTED from a superseding
live navigation. No product bypass or weakened timing assertion was introduced.

Evidence: plan-09-task2-focused.log (4 files / 14 tests), target-final.log, host-tests.log,
e2e-final.log (all six tracer assertions and identity/own-dependency/restart checks true),
preview-build.log, release-build.log, release-proof.json, outside-edit-proof.json,
missing-sidecar-build.log, server-module-trace.json and production-fallback.png.
Final authoring timings: fallback 967.32 ms, code 911.47 ms, dependency 775.59 ms.
Common gate: final-check.log, no warnings/errors (152 files); final-tests.log,
9/9 tasks, core 27 files / 94 tests, CLI 3 files / 5 tests. No contradiction or stop.

2026-11-06 — Task 3 verified. Added vp pack entry/declaration configuration for
@composedink/blocks, host-runtime and host-tanstack. Workspace exports stay TypeScript;
pnpm's supported publishConfig.exports produces explicit .mjs/.d.mts archive exports.
All archives contain dist plus package documentation, and keep React peer/dev dependencies.
Added the runnable root tarball-consumer gate and publishing instructions. It installs
only the packed public integrations into an isolated example with no workspace links,
uses local sibling-archive overrides, denies external/artifact network during compilation,
and builds/prerenders the released post. No npm publication or deployment was performed.

Evidence: plan-09-pack-blocks.log, pack-host-runtime.log, pack-host-tanstack.log,
plan-09-tarball-consumer-final.log and tarball-consumer-proof.json. The latter records
all three archive paths, workspaceLinks:false and build:true. Archives and installed
fixture are retained under test-results/. Common checks remain green: final-check.log
(152 files, zero warnings/errors), format-stable.log, final-tests.log (9/9 successful;
core 27 files / 94 tests); server-final.log (1/1), host-tests.log (1/1), task2-focused.log
(14/14), target-final.log (1/1), and e2e-final.log (all tracer assertions true).
Task 1: e12da05. Task 2: 9320c39. This task's following commit completes Plan 09.
All checkboxes are complete. No reproduced contract contradiction and no stop.
Push to origin main follows the final clean-tree/check gate. No hellotimber writes.

2026-11-06 — Final review follow-up for Tasks 1–2. Export now accepts omitted --to
and resolves the most recently completed device destination from export intents/history.
The tracer hand-edits the exported file and invokes composed export tracer without --to;
concurrent studio and outside edits both survive. Remembered-destination red evidence is
plan-09-remembered-red.log; the focused green is plan-09-cache-remembered.log (4 tests).
Release artifact cache directories include sourceHash independently of the version-based
federation name. This prevents stale bytes after a crash before persisting a publish intent
and subsequent edits at the same allocated version. The real-bundle regression changes
source at one release version and checks the new implementation marker; reverting the cache
fix reproduces the failure (plan-09-release-cache-red.log). Final tracer rerun is
plan-09-e2e-completion.log: all assertions true, fallback 958.42 ms, code 972.78 ms,
dependency 707.96 ms. Publication/packaging remain local only. The completion full-suite
rerun and final push are recorded below once finished.

Completion follow-up gates passed: plan-09-completion-tests.log is 9/9 successful,
including core 27 files / 94 tests and CLI 3 files / 5 tests. The added release-cache
regression also passes in the separate 4-test cache/remembered-destination gate. Final check has zero
warnings/errors; formatting is stable. The follow-up feat(core) commit below contains
only the remembered-destination/cache correction and its tests/log. Origin main was
still c06433e before push; all implementation commits carry the requested co-author.
