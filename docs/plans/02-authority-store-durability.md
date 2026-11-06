# Plan 02 — Authority and store durability

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 01. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** one local owner, durable acknowledgement, retry-safe mutations and full-history compaction. Widen the real tracer store; do not introduce another persistence authority.

**Files:** `packages/core/src/store/{election,store,compact,recovery,receipts,export-history,intents}.ts`, `src/authority.ts`, `src/ops/registry.ts`, `tests/{election,crash,receipts,compaction}.test.ts`; `apps/cli/src/{client,studio}.ts`; `apps/web/src/editor/sync.ts` acknowledgement handling.

### Task 1 — Make election and persistence fault-safe

- [x] Add election/inline mode here, wholly absent from 01. Ownership is a kernel-held lock on the lock-only file `$COMPOSED_HOME/authority.db`: open with `node:sqlite` `DatabaseSync`, `PRAGMA busy_timeout=0`, then `BEGIN EXCLUSIVE` as the **first statement touching the db** (no CREATE TABLE, no locking_mode pragma before it — they retain a SHARED lock and produce double-BUSY with no owner, see stop 2); hold the connection open for the authority's lifetime. On errcode 5: `db.close()` first, then read `owner.json`; present+ready → connect; present+not ready → wait with timeout; absent → retry acquisition with 10–30 ms jitter, bounded 5 s, then a clear error. After acquiring, write `owner.json` `{pid,processStartTime,kind,socket,ready}` by temp+rename. Receipts/export history/intents go in a separate `state.db`. Never steal a live owner (impossible by construction — prove it). Studio takes over after one short inline command finishes. Silence Node's SQLite ExperimentalWarning in the launcher. Tests: two contenders released by a barrier immediately before BEGIN EXCLUSIVE → exactly one owner, the other reaches BUSY and connects (or, if owner.json is not yet written, retries until it is); owner `kill -9` → next contender acquires with no cleanup; crash after acquire before owner.json → next contender acquires (lock released) and ignores the missing/stale file; alive-not-ready wait; shutdown/reconnect; studio takeover. Plan 01's studio-only `workspace.lock` is replaced, not kept alongside.
- [x] Only short commands may own inline when no studio lock exists. Long-running preview/component edit/studio require studio service and auto-start `composed studio --headless` if absent; test preview now and component edit in 08. Studio owns socket, 4848, subscription and web serving.
- [x] Persist snapshot plus numbered `updates/<n>.loro`. Stage bytes in the same directory, fsync file, rename, fsync directory. Serialize all writes and compaction through authority. Store validates length/hash metadata and rejects corrupt committed segments; ignore only uncommitted temp files.
- [x] Compact into a full-history snapshot and atomically publish it before pruning included segments. Preserve base frontiers and forkAt capability. If Loro's selected snapshot API loses required history, retain those segments instead; never substitute a shallow snapshot. Kill at every boundary and reopen.

### Task 2 — Commit receipts and recover side effects

- [x] Add `Mutation<T> = T & {request?:RequestId}` to every registered mutation, including create/component writes/export. IDs are workspace-wide; use an authority index rebuilt from store-local `$COMPOSED_HOME/state/receipts`. Canonical payload hash includes op/name and semantic arguments, excludes request and transport attribution. Same ID/hash returns the original receipt; mismatch is RequestConflict. In-flight duplicates await the same transaction.
- [x] Domain update bytes and store-local receipt/result payload share one durable transaction envelope; record its post-commit frontier for replay. Receipts are never Loro containers. Loro mutation lives only in core/src/model/ (+ web binding); store imports/exports bytes and writes only snapshots, updates, receipts, export history and intents. For creation, persist new document/receipt before publishing slug index. Rebuild derived indices after crash.
- [x] Provide store-local per-destination export history `(mdxHash,lockHash,base,at)` and reconciliation receipts keyed `(target path,lock.base,sha256 outside file)` for 05/09. Do not register future publish/import ops. Persist export intent before external effects; replay only effects matching their intent hashes. For export, retain old/new MDX and lock hashes/prepared bytes. Export orders outside import → snapshot → project → evaluate → intent → MDX rename → lock rename → complete. Kill between renames, recover exact pair; an unexpected outside edit yields RecoveryRequired and preserves all bytes. Acknowledge only after durable result.
- [x] Browser update import and normalization complete before durable ack. Resending identical typing bytes is harmless. Display Unsaved on disconnect/write error and retain bytes for retry. Ops never acknowledge an unpersisted edit.

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

**2026-11-05, stop 2 — SQLITE_BUSY does not establish that an owner exists.**
Task 1 remains incomplete; no checkboxes or index status changed. Read the rewritten
Task 1, design and prior logs; `mise exec -- vp install` passed. Implementation was
attempted test-first, but its real-process race test returned `busy,busy` on one run
and `busy,owner` on a rerun. All unverified source/test changes from this attempt were
removed; only this log and gitignored evidence remain.

Isolated the result without application code: each of two Node processes opens the
same fresh `authority.db`, executes `PRAGMA locking_mode=EXCLUSIVE`, signals an IPC
barrier **immediately before `BEGIN EXCLUSIVE`**, then both are released. Both calls
can throw `ERR_SQLITE_ERROR`, `errcode: 5`, `database is locked`. Neither succeeds.
Both processes remain alive. A third connection then successfully executes the same
PRAGMA/BEGIN sequence, proving no owner holds the lock. The probe closes the failed
connections exactly as the attempted election implementation did. This is a liveness
contradiction, not evidence of two owners or a failure of SQLite mutual exclusion.

Reproduction (exit 0 means the contradictory interleaving was reproduced):
`mise exec -- node --no-warnings=ExperimentalWarning test-results/plan-02-sqlite-barrier-probe.mjs`.
Evidence: `test-results/plan-02-sqlite-barrier-{probe,child}.mjs`,
`test-results/plan-02-sqlite-barrier.{json,log}`. JSON records every barrier PID,
acquisition result and the third-connection verification. Runtime: Node 22.22.3,
darwin arm64. No writable documents are opened. All probe state stays in composedink.

The rewritten plan/design say SQLITE_BUSY means a live owner exists and direct BUSY
contenders to wait for `owner.json` readiness, then connect. This execution has no owner
to publish metadata or serve a socket, so both prescribed contenders only time out.
A fresh home has no metadata; stale metadata would not repair the missing owner.
The SQLite lock can remain the ownership primitive, but the specified contention
behavior needs a resolution that permits progress when BUSY occurs without an owner.
No alternate contention/retry protocol was invented under the plan's stop rule.

Attempted focused tests: initial election test failed (`busy,busy`), rerun passed;
corrupt-segment and historical-frontier tests passed in that provisional run.
Logs: `test-results/plan-02-{red-election,red-store,task1-tests,task1-retry,task1-check}.log`.
The provisional check had zero errors and one test stringification warning; it is not
completion evidence and its source was removed. None of the required durability,
receipt, export-recovery, 1,000-write, browser or full completion gates is claimed.
No task implementation commit, no push, no hellotimber modification. Task 2 was not
started. Resume after resolving this specific BUSY-without-owner execution.

**Resolution of stop 2 (boss, 2026-11-05).** Double-BUSY came from statements before `BEGIN
EXCLUSIVE` (the `locking_mode` pragma and `CREATE TABLE` take a SHARED lock each connection keeps,
so neither can escalate). Probed with a file barrier on Node 22.22.3: with `BEGIN EXCLUSIVE` as the
first statement on a fresh lock-only db, exactly one of two processes acquires and the other stays
BUSY across 50 close-and-retry attempts while the owner lives. Task 1 now states the exact
sequence, the close-before-wait rule, and bounded retry when `owner.json` is absent.

**2026-11-05, Task 1 verified.** Replaced workspace.lock with the exact lock-only SQLite acquisition sequence and close-before-BUSY metadata handling. Short CLI commands own inline; preview starts headless studio. Added checksummed numbered segments, full-history compaction and SIGKILL fault points. Real IPC-barrier contenders elect one owner and one follower; kill/reacquisition and shutdown pass. Compaction preserves an old fork and reopens across prepared/published/pruned boundaries; corrupt snapshots/segments fail visibly. Gates: check clean (62 files), recursive tests 7/7, tracer assertions 1–6 true (refresh 1116.41 ms). Logs: test-results/plan-02-task1-{red,tests,check,all-tests,e2e}.log. No protocol contradiction or stop.

**2026-11-05, Task 2 verified.** Added optional requests to every registered mutation and CLI mapping, canonical semantic hashes, workspace-wide receipt indexing rebuilt from checksummed store-local transaction envelopes, and original-result replay after restart. Each envelope commits update bytes, post-commit frontiers, reconciliation keys, result and prepared export effects together. New documents remain invisible to queued readers until durable publication. Mutable transaction work runs on forks; a durable write failure rolls back the visible head and requires restart before further operations.

Export intents retain old/new pair bytes and hashes; replay validates both files before writing either. Export history and reconciliation receipts remain local, indexed with receipts/intents in the separate state.db. Outside edits reconcile at the last exported base; old-MDX/current-lock pairs fail RecoveryRequired. Preview subscriptions restore from durable targets after restart. Browser typing imports/normalizes before durable acknowledgement; offline/write errors show Unsaved, keep pending bytes, refresh the studio session on reconnect and resend idempotently.

Final evidence (all under gitignored test-results/):

- plan-02-final-check.log: formatting passes; no warnings/lint/type errors in 70 files.
- plan-02-final-tests.log: 7/7 workspace tasks; core 38 tests, blocks 3, boundaries 2, browser binding 1.
- plan-02-durability-final.log: 4 files, 22 tests passed (263.71 s), including two real clients sending 500 writes each to one studio and verifying every acknowledged marker after shutdown/reopen.
- plan-02-final-focused.log: 17 election/crash/compaction/export tests passed against the final export preflight logic.
- plan-02-final-e2e.log: all six tracer assertions true, plus offline and studio-restart pending-typing retries; component write through rebuilt/exported SSR 977.75 ms. Screenshots and HTML refreshed by the tracer.
- plan-02-lock-only.json: second connection errcode 5, zero tables in authority.db, no writable documents opened by contender.
- plan-02-timeout.json: absent metadata retries bounded to 5000 ms with clear error, then acquisition after release.
- plan-02-export-base.json: compact/restart/fork at an actual earlier export lock.base preserves exported text while current head remains newer.
- plan-02-evidence.md maps every election/durability scenario to its test/probe. SIGKILL points cover acquisition before metadata, snapshot preparation/publication/pruning, transaction commit/before-ack and export intent/both renames. Unexpected edits remain untouched.

The first stress runs exceeded their original 120 s harness allowance while still progressing. The final harness allows 600 s for the same 1,000 durable operations (none skipped). Initial tracer offline assertions were corrected to explicitly close on the browser offline event; final offline and restart retries pass. These were implementation/test fixes, not contract contradictions. No new stop, no placeholder operations, no hellotimber modification. Task 1 commit: 7a34f14. Task 2 uses the following feat(core) commit; both carry the required co-author trailer. Push follows the final documentation/check gate.
