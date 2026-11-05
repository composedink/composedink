# Plan 11 — macOS desktop shell

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 03, 04, 05, 06, 07, 08, 09. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** a distributable Tauri 2 macOS shell uses the existing authority/editor; no second store or editor is created. Full MVP completion also requires the separately authorized consumer unit 10.

**Files:** `apps/desktop/{package.json,README.md,src-tauri/Cargo.toml,src-tauri/tauri.conf.json,src-tauri/src/main.rs,src-tauri/capabilities/default.json}`, sidecar packaging scripts and `tests/desktop-smoke.ts`; necessary CLI studio lifecycle support. Add only Tauri tooling/native dependencies needed for this shell; Node remains mise-managed for development.

### Task 1 — Prove sidecar packaging before shell expansion

- [ ] Spike Node SEA carrying CLI, Rolldown native binding and Loro WASM on a clean macOS launch environment without mise/global Node. Record architecture, bundled resources and launch logs. If SEA cannot load native/WASM assets reliably, bundle an architecture-matched Node binary plus JS/resource directory; do not pretend a development Node path is a distributable runtime.
- [ ] Sidecar uses the same `$COMPOSED_HOME`, election lock and socket. Starting desktop while studio is active connects to it; starting against an inline CLI waits at most one short command, then uses studio service (headless auto-start if absent). Test authority exit while desktop is open, stale lock and explicit recovery, without spawning a second writer.

### Task 2 — Mount the existing studio safely

- [ ] Tauri loads the locally authenticated studio URL from the sidecar handshake and reuses apps/web. Bind loopback only; use an ephemeral token/origin checks, not a hardcoded secret. Keep service token away from remote component code. Only trusted local editor UI can invoke operations.
- [ ] Package web assets and sidecar executable/resources. Configure least necessary Tauri capabilities for launch/open/file selection; do not expose generic shell execution to page JS. Studio never loads component remotes in its own origin. Live previews use the blog/example dev server on its own origin; own components execute in-page there. P3 adds editor-side usercontent sandbox. Document that this shell is not the P3 untrusted-code isolation boundary.
- [ ] Closing the window detaches if other clients need the owner; shut down an owned idle sidecar gracefully after flushing writes. Never kill a studio authority owned by another session. Reopen/relaunch restores selected document from device UI state, not replicated post metadata.
- [ ] Provide macOS dev/package/smoke scripts and document unsigned local build limitations. Signing/notarization uses externally provided credentials only in an authorized release workflow; not needed to claim local packaging evidence.

**Verification:** add `composed-desktop#smoke` and run `mise exec -- vp run composed-desktop#smoke`, plus `mise exec -- vp run composed-web#e2e` and `mise exec -- vp run @composedink/core#durability`. Launch the packaged app, type a unique sentence, flip an alternative, dim and stash, relaunch and verify through a separately spawned `composed cat`. With an existing studio and terminal client, assert one lock owner and one set of numbered updates. Exercise a component remote with hooks and its failed-remote fallback. Run packaging smoke without PATH access to development Node. Preserve process/resource logs and a screenshot as evidence; a window opening alone is insufficient.

**Out of scope:** Windows/Linux polish, App Store, mobile/Expo decision, sync/accounts, code signing infrastructure, untrusted-component sandbox, native model inference.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.
