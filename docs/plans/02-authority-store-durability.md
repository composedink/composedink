# Plan 02 — Authority and store durability

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 01. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** one local owner, durable acknowledgement, retry-safe mutations and full-history compaction. Widen the real tracer store; do not introduce another persistence authority.

**Files:** `packages/core/src/store/{election,store,compact,recovery,receipts,export-history,intents}.ts`, `src/authority.ts`, `src/ops/registry.ts`, `tests/{election,crash,receipts,compaction}.test.ts`; `apps/cli/src/{client,studio}.ts`; `apps/web/src/editor/sync.ts` acknowledgement handling.

### Task 1 — Make election and persistence fault-safe

- [ ] Add election/inline mode here, wholly absent from 01. Lock contents are `{pid,processStartTime,kind:"studio"|"inline",socket,ready}`. Write a temp file then `link()` to workspace.lock; never wx+write. Dead-owner recovery renames to `workspace.lock.stale.<pid>.<rand>`; only rename success permits deleting it. Failed rename means another contender recovered: retry acquisition. Alive/not-ready waits with timeout; alive/ready/socket refused errors. Never steal a live owner. Use processStartTime to detect PID reuse. Test two contenders racing stale recovery with an injected barrier at rename, creator crash after link/before ready, alive-not-ready wait, rename-failure retry, shutdown/reconnect and studio takeover after one short inline command.
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
