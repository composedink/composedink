# Plan 02 — Authority and store durability

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 01. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** one local owner, durable acknowledgement, retry-safe mutations and full-history compaction. Widen the real tracer store; do not introduce another persistence authority.

**Files:** `packages/core/src/store/{election,store,compact,recovery,receipts,export-history,intents}.ts`, `src/authority.ts`, `src/ops/registry.ts`, `tests/{election,crash,receipts,compaction}.test.ts`; `apps/cli/src/{client,studio}.ts`; `apps/web/src/editor/sync.ts` acknowledgement handling.

### Task 1 — Make election and persistence fault-safe

- [ ] Add election/inline mode here, wholly absent from 01. Ownership is a kernel-held lock: open `$COMPOSED_HOME/authority.db` with `node:sqlite` (`DatabaseSync`; `PRAGMA locking_mode=EXCLUSIVE`; `BEGIN EXCLUSIVE`) and keep the connection open for the authority's lifetime; SQLITE_BUSY means a live owner exists; death releases the lock. No `workspace.lock`, no `link()`, no rename recovery, no PID liveness checks. After acquiring, write `owner.json` `{pid,processStartTime,kind,socket,ready}` by temp+rename; contenders on BUSY read it, wait while `ready` is false (timeout), then connect; ready+socket refused errors. Never steal a live owner (impossible by construction — prove it). Studio takes over after one short inline command finishes. Suppress Node's SQLite ExperimentalWarning in the CLI. Tests: two contenders racing acquisition (barrier before BEGIN EXCLUSIVE) → exactly one owner and the other connects; owner `kill -9` → next contender acquires with no cleanup; crash after acquire before `owner.json` → the lock is gone, stale/missing owner.json is ignored by the next owner; alive-not-ready wait; shutdown/reconnect; studio takeover. Plan 01's studio-only `workspace.lock` is replaced, not kept alongside.
- [ ] Only short commands may own inline when no studio lock exists. Long-running preview/component edit/studio require studio service and auto-start `composed studio --headless` if absent; test preview now and component edit in 08. Studio owns socket, 4848, subscription and web serving.
- [ ] Persist snapshot plus numbered `updates/<n>.loro`. Stage bytes in the same directory, fsync file, rename, fsync directory. Serialize all writes and compaction through authority. Store validates length/hash metadata and rejects corrupt committed segments; ignore only uncommitted temp files.
- [ ] Compact into a full-history snapshot and atomically publish it before pruning included segments. Preserve base frontiers and forkAt capability. If Loro's selected snapshot API loses required history, retain those segments instead; never substitute a shallow snapshot. Kill at every boundary and reopen.

### Task 2 — Commit receipts and recover side effects

- [ ] Add `Mutation<T> = T & {request?:RequestId}` to every registered mutation, including create/component writes/export. IDs are workspace-wide; use an authority index rebuilt from store-local `$COMPOSED_HOME/state/receipts`. Canonical payload hash includes op/name and semantic arguments, excludes request and transport attribution. Same ID/hash returns the original receipt; mismatch is RequestConflict. In-flight duplicates await the same transaction.
- [ ] Domain update bytes and store-local receipt/result payload share one durable transaction envelope; record its post-commit frontier for replay. Receipts are never Loro containers. Loro mutation lives only in core/src/model/ (+ web binding); store imports/exports bytes and writes only snapshots, updates, receipts, export history and intents. For creation, persist new document/receipt before publishing slug index. Rebuild derived indices after crash.
- [ ] Provide store-local per-destination export history `(mdxHash,lockHash,base,at)` and reconciliation receipts keyed `(target path,lock.base,sha256 outside file)` for 05/09. Do not register future publish/import ops. Persist export intent before external effects; replay only effects matching their intent hashes. For export, retain old/new MDX and lock hashes/prepared bytes. Export orders outside import → snapshot → project → evaluate → intent → MDX rename → lock rename → complete. Kill between renames, recover exact pair; an unexpected outside edit yields RecoveryRequired and preserves all bytes. Acknowledge only after durable result.
- [ ] Browser update import and normalization complete before durable ack. Resending identical typing bytes is harmless. Display Unsaved on disconnect/write error and retain bytes for retry. Ops never acknowledge an unpersisted edit.

**Verification:** register `@composedink/core#durability` as `vp test run tests/election.test.ts tests/crash.test.ts tests/receipts.test.ts tests/compaction.test.ts`. Run `mise exec -- vp run @composedink/core#durability` and tracer e2e. Spawn two clients sending 500 component writes each to the same owner: all acknowledged operations survive, only one process opens writable docs. Kill after commit/before ack; retry the same request and observe one mutation/result. Compact, restart, and fork at an old export base. Archive fault-point results. Never test two independent disk writers as a desired success condition.

**Out of scope:** alternative semantics, MCP, sync, SQLite, server bundling, deletion of retained history.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

**2026-11-05, stop 1 — stale-recovery protocol conflicts with live-owner safety.**
No task is complete; checkboxes and the plan index status remain unchanged. No production
source was modified. Setup `mise exec -- vp install` succeeded (exit 0;
`test-results/plan-02-install.log`).

Before implementing Task 1, exercised its prescribed recovery sequence with two actual
Node child processes and an injected IPC barrier immediately before `rename()`. Both
contenders read the same lock belonging to an exited process and verify `ESRCH`. Release
A: rename the stale lock, delete only after success, then acquire using temp-file +
`link()`. Keep A alive. Release B: its delayed pathname `rename()` **succeeds on A's
replacement live lock**, then B deletes the renamed lock and acquires with `link()`.
Both processes report acquisition and remain alive. This probe deliberately opens no
writable documents; two independent writers are not being accepted as a success case.

Command: `mise exec -- node test-results/plan-02-stale-rename-probe.mjs` (exit 0 means
that the assertions reproduced the unsafe interleaving, not that election passed).
Output, archived in `test-results/plan-02-stale-rename.{json,log}`:

```json
{
  "bothContendersAcquired": true,
  "liveOwnerRenamedAndDeletedByDelayedContender": true,
  "renameFailureObserved": false
}
```

The JSON includes both barrier observations, dead PID, both contender PIDs, the exact
contents each contender renamed, and the final lock. Reproduction script is retained
under `test-results/`; all probe state was created there, within composedink.
Runtime: mise Node **22.22.3**, libuv **1.51.0**, **darwin arm64**. The relevant library
is Node's built-in `node:fs/promises.rename`, with actual filesystem operations, no mock.

Task 1 and the design's “Authority, binding and boundaries” require “never steal a live
owner”, but successful pathname rename does not establish that the moved lock is the
dead-owner lock previously observed. Retrying only on rename failure does not cover
this interleaving. An additional ownership check immediately before rename would still
leave a check-to-rename race. The election contract needs an explicit protocol that
prevents delayed recoverers from moving a replacement live lock before implementation
can proceed; no extra recovery mechanism was invented here.

Stopped per the plan's contradiction rule. The remaining election/crash/receipt/
compaction scenarios, common gates, durability script and tracer e2e were not run or
claimed. No task implementation commit was made, and nothing was pushed.

**Resolution (boss, 2026-11-05).** The pathname protocol is withdrawn. Ownership moves to a
kernel-held SQLite exclusive lock (`node:sqlite`, available unflagged on Node 22.13+): probed on
Node 22.22.3 — a second process gets `database is locked` while the owner lives and acquires
immediately after the owner is `kill -9`'d. There is no stale state to recover, so the race
cannot exist. Design updated ("Authority, binding and boundaries"); Task 1 rewritten above.
