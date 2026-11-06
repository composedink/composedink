# Plan 11 — macOS desktop shell

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 03, 04, 05, 06, 07, 08, 09. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** a distributable Tauri 2 macOS shell uses the existing authority/editor; no second store or editor is created. Full MVP completion also requires the separately authorized consumer unit 10.

**Files:** `apps/desktop/{package.json,README.md,src-tauri/Cargo.toml,src-tauri/tauri.conf.json,src-tauri/src/main.rs,src-tauri/capabilities/default.json}`, sidecar packaging scripts and `tests/desktop-smoke.ts`; necessary CLI studio lifecycle support. Add only Tauri tooling/native dependencies needed for this shell; Node remains mise-managed for development.

### Task 1 — Prove sidecar packaging before shell expansion

- [x] Spike Node SEA carrying CLI, Rolldown native binding and Loro WASM on a clean macOS launch environment without mise/global Node. Record architecture, bundled resources and launch logs. If SEA cannot load native/WASM assets reliably, bundle an architecture-matched Node binary plus JS/resource directory; do not pretend a development Node path is a distributable runtime.
- [x] Sidecar uses the same `$COMPOSED_HOME`, election lock and socket. Starting desktop while studio is active connects to it; starting against an inline CLI waits at most one short command, then uses studio service (headless auto-start if absent). Test authority exit while desktop is open, stale lock and explicit recovery, without spawning a second writer.

### Task 2 — Mount the existing studio safely

- [x] Tauri loads the locally authenticated studio URL from the sidecar handshake and reuses apps/web. Bind loopback only; use an ephemeral token/origin checks, not a hardcoded secret. Keep service token away from remote component code. Only trusted local editor UI can invoke operations.
- [x] Package web assets and sidecar executable/resources. Configure least necessary Tauri capabilities for launch/open/file selection; do not expose generic shell execution to page JS. Studio never loads component remotes in its own origin. Live previews use the blog/example dev server on its own origin; own components execute in-page there. P3 adds editor-side usercontent sandbox. Document that this shell is not the P3 untrusted-code isolation boundary.
- [x] Closing the window detaches if other clients need the owner; shut down an owned idle sidecar gracefully after flushing writes. Never kill a studio authority owned by another session. Reopen/relaunch restores selected document from device UI state, not replicated post metadata.
- [x] Provide macOS dev/package/smoke scripts and document unsigned local build limitations. Signing/notarization uses externally provided credentials only in an authorized release workflow; not needed to claim local packaging evidence.

- [ ] Native acceptance (`smoke:gui`): window typing, relaunch screenshot and native cold launch time; pending unlocked macOS session.

**Verification:** add `composed-desktop#smoke` and run `mise exec -- vp run composed-desktop#smoke`, plus `mise exec -- vp run composed-web#e2e` and `mise exec -- vp run @composedink/core#durability`. Launch the packaged app, type a unique sentence, flip an alternative, dim and stash, relaunch and verify through a separately spawned `composed cat`. With an existing studio and terminal client, assert one lock owner and one set of numbered updates. Exercise a component remote with hooks and its failed-remote fallback. Run packaging smoke without PATH access to development Node. Preserve process/resource logs and a screenshot as evidence; a window opening alone is insufficient.

**Out of scope:** Windows/Linux polish, App Store, mobile/Expo decision, sync/accounts, code signing infrastructure, untrusted-component sandbox, native model inference.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

2026-11-06 — R8 first, before shell implementation. Node 22.22.3, macOS
arm64. Real ad-hoc signed SEA with embedded Rspack native addon, Loro WASM,
Harper binaryInlined module (27,200,854 bytes), and CLI entry source runs with
PATH=/usr/bin:/bin. Extraction + process.dlopen loads 63 Rspack exports;
WebAssembly.validate accepts Loro. CLI source evaluation fails on ESM imports;
Rolldown's actual CLI → CJS bundle fails with INVALID_TLA_FORMAT (top-level await).
This does not claim native addons are impossible in SEA: they loaded. The current
ESM/worker/resource graph requires filesystem modules or substantial SEA-specific
rewriting. Choose the plan's fallback: architecture-matched mise Node binary plus
JS/resource tree, preserving package resolution and worker URLs. Evidence:
test-results/plan-11-sea.log and plan-11-sea/{sea.json,bundle-result.txt,composed-sea}.
The SEA is 176 MiB before adding the full CLI dependency graph.

Component builds will use a bundled mise pnpm binary and bundled Node on a private
PATH. Preserve the catalog and blocks source package in their workspace-relative
layout: existing materialization can link blocks and install each component's exact
lock into COMPOSED_HOME/build. Registry network is still needed for uncached author
npm dependencies. No development Node or pnpm is part of the runtime contract.

Task 1 verified: plan-11-lifecycle.log proves inline-owner wait, stale metadata,
two desktop attachments/one SQLite owner, terminal connection retention, idle
shutdown, SIGKILL/re-election and preservation of an external studio. Runtime
new/check/lint/preview logs prove Loro persistence, Harper worker and a real
Rspack remote/fallback export with PATH=/usr/bin:/bin. mise Node is selected via
mise where (vp's process.execPath is a dylib-dependent runtime); pnpm needs its
adjacent dist folder, so copy the complete mise installation. Common check passes
156 files with no warnings/errors; plan-11-task1-tests.log: 9/9 successful.
No contract contradiction. Task 2 native-window/package verification follows.

2026-11-06 — Task 2 implementation and non-GUI verification. Added the macOS
Tauri 2 shell with a Rust-only sidecar launcher, loopback handshake navigation,
zero page-native capabilities and origin-restricted navigation. The studio serves
built apps/web assets and retains its random token/exact WebSocket Origin checks.
HTTP rejects foreign Host/Origin and cross-site requests; packaged CSP prevents
remote scripts/frames and permits Harper's inlined data fetch. WASM has its proper
MIME type. The selected document is stored only in device localStorage.

The initial Tauri resource glob omitted pnpm symlinks (reproduced missing core
import). The tested fallback resource tree is therefore a gzip tar archive with
symlinks intact; the app extracts atomically into a SHA-256-named device cache.
Node and complete pnpm installation are bundled, with PATH limited to bundled bin
plus /usr/bin:/bin. Rspack and Rolldown native bindings and both WASM runtimes work.
The app is ad-hoc signed, not notarized; no deployment/publication occurred.

Owned studios drain queued writes before idle exit; connected clients and registered
preview subscriptions retain them. Existing external studios survive detach. The
bridge reacquires through existing SQLite election after authority death. Detach
during startup is handled after opening the lease, preventing an orphaned client.

**Human-authorized verification amendment:** the Mac reports
CGSSessionScreenIsLocked=true. The user explicitly instructed continuing all
headless checks, separating native GUI checks into a named skipped check, and
committing/pushing verified work. `smoke:runtime` exercises the exact runtime
archive extracted from the packaged .app, with PATH=/usr/bin:/bin, using HTTP,
WebSocket, separately spawned bundled CLI and headless Chromium on built assets.
`smoke:gui` reports `skipped: gui session locked` with its reason. Native window
text entry, window relaunch screenshot and native cold launch time remain pending;
the native acceptance checkbox and plan-index completion remain open for that acceptance.
The headless screenshot is explicitly not claimed as native-window evidence.

Verified runtime assertions: second SQLite BEGIN EXCLUSIVE is rejected; terminal
reads and mutations share the packaged studio PID; updates are numbered 1…N;
editor typing, flip, dim and stash persist across sidecar relaunch; non-default
selected document survives returning to the root URL; wrong token and foreign
Host/Origin are rejected; studio requests no component remote; Harper worker runs;
bundled pnpm/Node check and build a real remote; its React useState hook works on a
separate host origin and failed remote retains readable fallback; preview subscription
retains its authority. Lifecycle harness also proves short inline-owner wait, stale
metadata, concurrent attachments, external-studio survival, idle exit and SIGKILL
recovery. These are real processes and resources, not stubs.

Evidence under test-results/: plan-11-sea.log, plan-11-runtime-{check,lint,preview}.log,
plan-11-package-final.log, plan-11-smoke-final.log and its printed evidence directory
(proof.json, packaged-studio.png, remote-hooks.png, remote-failed.png, bridge logs,
remote-build.log), plan-11-lifecycle-final.log, plan-11-gui/result.json,
plan-11-final-check.log, plan-11-completion-tests.log, plan-11-web-e2e-final.log,
plan-11-durability.log, plan-11-host-e2e.log and plan-11-codesign.log.

Local build size: 359.35 MiB (approximately 376.81 MB logical file bytes, recorded
exactly per build in smoke proof). Fresh-home sidecar process → SQLite studio
readiness was 1426.88 ms in the latest final smoke; timing starts after archive
extraction and document seeding, with warm filesystem caches. It is not a native
window cold-launch measurement. The latter remains pending the unlocked Mac.

Task 1 commit: efab568. Task 2's following commit contains the verified shell/runtime
and explicitly pending GUI check, as requested. No reproduced unresolved design
contradiction, no hellotimber modifications, no signing credentials or deployment.

Final non-GUI gates passed: check has no warnings/errors (159 files), repeated
formatting is stable; recursive tests are 9/9 successful; web e2e is 5/5;
core durability is 4 files / 22 tests; host tracer assertions 1–6, React identity,
own dependency, refresh/restart/last-good checks all pass. Packaging is 3/3;
smoke is 2/2 tasks successful with the GUI task explicitly skipped (locked).
Final lifecycle includes startupDetach=true. Final smoke's exact app size is
376,808,169 bytes; sidecar readiness is 1426.88 ms under the timing definition above.
The ad-hoc signature verifies with codesign --verify --deep --strict. Pending GUI
acceptance is the only incomplete verification; Plan 11 stays in progress.
