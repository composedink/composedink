# Plan 03 — Editor binding and operation transport

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 02. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** a reliable source editor whose typing and imported authority operations agree, before alternatives are introduced. Plan 01 already gates the minimal binding on R2; repeat that spike first against the now-durable transport.

**Files:** `apps/web/src/editor/{sync,editor,selection,undo,transport}.ts`, `src/{main,PostEditor}.tsx`, `tests/{binding,undo}.test.ts`, `tests/editor.spec.ts`; `apps/cli/src/studio.ts`; `packages/core/src/authority.ts` inverse-transaction support.

### Task 1 — Gate all later mixed imports

- [x] Run non-text-before-mdx and wrong-target-text-before-mdx regressions before other editor work. The installed binding must continue scanning both cases. Keep the corrected small sync plugin only if necessary, with provenance and upstream issue; preserve the binding's keystroke undo manager and single synchronization path.
- [x] Test UTF-16, emoji, IME/composition, selections across Markdown syntax, reconnect and out-of-order/double acknowledgements. Never rewrite imported keystroke history. Authority normalization is the only policy writer and broadcasts any repair as a separate commit.
- [x] Define socket ordering: flush pending keystroke updates before capturing Selection.base and submitting an op; authority processes frames in order. Reconnect exchanges frontiers and resends only retained updates. Unknown base fails visibly rather than applying against latest.

### Task 2 — Build editor foundation using existing operations

- [x] Add Markdown/MDX syntax styling, selection context and source/preview split. Render existing block usages as non-executing chips showing tag/version/props validation; author remotes appear only on the blog/example dev server's own origin, never studio's origin. Source/preview split links to that surface; P3 adds usercontent for editor-side previews. Props validation reads the same schema contract as export.
- [x] Expose only shipped create/read/component write/deps/preview actions. Create extension points for decorations/panels without nonfunctional alternative or dim buttons. Plans 04/05 add those actions when their ops exist; plan 07 adds rewrite UI.
- [x] Implement session operation undo records on the authority: each op commit has an inverse action using semantic IDs/cursors, not a whole-document reset. Record direct user ops separately from normalization. Keystrokes undo via the binding manager; operation undo invokes the authority inverse. After an op, the binding must not claim its import as a local keystroke undo group. Remote/agent ops are not automatically added to the human's undo stack.
- [x] Test normalization import does not become a separate user undo item. For initial supported actions, undo restores only that action. Extend inverse coverage with each later mutation; fail when a target is detached, never guess a new location.

**Verification:** add `composed-web#e2e` using Playwright. Run `mise exec -- vp run composed-web#test`, `mise exec -- vp run composed-web#e2e`, and tracer e2e. Tests type prose, persist/reload, change dependency through CLI, observe imported state, undo local typing without undoing authority changes, disconnect/type/reconnect, and verify durable acknowledgement. Archive the R2 event-order cases with view/text equality. All actions exercised exist by this plan.

**Out of scope:** alternative shortcuts, dim/stash panels, rewrite UI, lint, sandboxed usercontent, mobile. This earlier editor unit intentionally avoids later commands; later plans widen its behavior.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

**2026-11-05, Task 1 verified.** Repeated R2 first against installed Loro/binding:
both event-order cases pass; the corrected single-subscription plugin remains required
(provenance and upstream references retained). Added retained-update transport, durable
flush before operations/selection capture, exact-sequence acknowledgement retirement,
frontier exchange, authority update broadcasts after journal commit, and per-socket frame
ordering through operation completion. Reconnect imports authority history and resends only
retained original typing bytes. Unknown component bases fail UnknownBase without mutation.

Evidence under test-results/: plan-03-r2-before.log, r2.json (ordered events and view/text
equality), plan-03-task1-test.log (R2, Unicode/syntax selection, imported-edit undo isolation,
duplicate/reordered acknowledgements), plan-03-base-test.log (malformed and unknown retained
bases), plan-03-task1-e2e.log / plan-03-editor.json (ordered create/read frames, persist/reload,
real Chromium IME, local keystroke undo, offline typing/reconnect/durable read),
plan-03-task1-check.log (no lint/type warnings/errors), plan-03-task1-all-tests.log (7/7 tasks),
plan-03-task1-tracer.log (six tracer assertions true, refresh 1133.65 ms).
No policy rewrite of imported typing; no later-plan operation; no stop.

**2026-11-05, Task 2 verified.** Added the Markdown/MDX source pane, UTF-16 selection
context, source/preview split with a link to the blog's own origin, non-executing block chips,
and a shipped-operation JSON action panel with results/errors. Chips use the same literal
manifest, JSX props and defaults/schema validator as export. CodeMirror decorations and React
panels have extension points; no alternatives/dim/stash/rewrite controls or placeholder ops.
Added @codemirror/language as a direct catalog dependency for syntax highlighting (previously
transitive), flagged during implementation; lockfile updated only through vp install.

Authority session undo records carry inverse CRDT update bytes built at the exact operation
frontiers, container identities and changed-field guards. They do not reset a document.
Creation undo tombstones its stable ID; subsequent edits make that target busy. File and
dependency inverses preserve other fields and later same-file typing, and fail visibly for
replaced/deleted targets or a new file edited by another writer. Component inverses refresh
registered previews through the existing export transaction path. Direct studio mutations
enter the human stack; CLI/agent operations and normalization imports do not. The browser
session ID retains operation history across reconnects. Keystrokes continue to use only the
binding UndoManager. Read/export delivery without a document commit adds no document inverse;
undo does not retract external exported files. Pending bytes and undo history are in memory,
so closing/reloading an unsaved tab is outside reconnect retention.

Final evidence (gitignored test-results/):

- plan-03-final-check.log: format passes, no lint/type warnings/errors (82 files).
- plan-03-final-tests.log: 7/7 workspace tasks, including existing 1,000-write durability,
  boundary, receipts, election, compaction and export regressions.
- plan-03-final-web-test.log: 2 files / 2 tests; R2 event order/equality, Unicode/syntax
  selection/imported-edit undo and exact acknowledgement retention.
- plan-03-final-e2e.log, plan-03-editor.json/png: actual studio; ordered frames, persistence,
  Chromium IME, imported CLI deps, typing undo, offline typing/durable reconnect, operation
  undo across reconnect, remote ops excluded, valid/invalid props and zero remoteEntry loads.
- plan-03-undo-focused.log: 2 files / 8 tests; action-specific inverse, normalization/typing
  isolation, same-file concurrent edits, changed/deleted targets, unknown bases.
- plan-03-final-focused.log: 5 files / 11 tests, including store/ops/export after final changes.
- plan-03-final-tracer.log: all six tracer assertions true; preview refresh 845.67 ms.
- plan-03-final-web-build.log: production Vite build passes; large-bundle advisory retained.
- plan-03-evidence.md maps scenarios to files; r2.json preserves both ordered event batches.

No contradiction or stop. No hellotimber modification. Task 1 commit: 0c646f1; Task 2 is the
following feat(web) commit, with the requested co-author trailer. Push follows final checks.
