# Plan 05 — Dim, stash and clean-view export

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 04. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** dim text stays recoverable while clean exports and imports preserve hidden text. Finish the writing model and its editor controls.

**Files:** `packages/core/src/model/{projection,marks,stash,apply,alternatives,normalize}.ts`, `src/export.ts`, `tests/{projection,marks,stash,clean-apply}.test.ts`; `apps/web/src/editor/{dim,stash,alternatives,undo}.tsx` and browser tests.

### Task 1 — Implement marks and stash

- [x] Test mark expansion none at each edge, cross-boundary edits, emoji, inactive-version marks and restart. Implement `ghost.set`, `stash.add/restore`, `alt.resolve(rest:ghost)` and inverses through authority. Use stable stash IDs, not mutable list indices.
- [x] Add Mod-. selection toggle, dim decorations, stash panel/Insert and Mod-Shift-Enter. Resolve ghost keeps the current version and inserts inactive versions dimmed after it; original order is retained. Stash cut removes text atomically; restore validates a live insertion anchor, inserts its marks and removes the item atomically. Detached restore targets fail instead of guessing a location.
- [x] Authority normalization dissolves alternatives crossed by typing and preserves inactive snippets/marks in stash. Test a browser keystroke import, separate repair commit and durable acknowledgement; no rewritten replicated history.

### Task 2 — Project and map at the base

```ts
interface Projection {
  text: string /* UTF-16 visible-to-source segments */;
}
// Build from mdx's delta/marks. Full is identity; clean omits dim spans.
// Map each scratch diff hunk against forkAt(base), preserving omitted spans.
```

- [x] Return clean/full reads with frontier plus view. Define insertion at an omitted span edge to land before hidden text. Split deletions across mapped visible segments so a clean deletion cannot delete omitted text. Preserve marks during branch merge.
- [x] Export exactly the projection of mdx including frontmatter, never stash. Export op requires `view: View`; CLI defaults release/preview to clean and `--include-dim` chooses full. This supersedes 01's initial full-only projection. Reject syntactically invalid MDX/frontmatter after omission with offending ranges rather than repairing source. No separate frontmatter schema/map.
- [x] Outside-edit path consumes lock.base, lock.view and the exact projection at that retained base. Before diffing, reject any outside hash matching an earlier destination export rather than current lock with RecoveryRequired naming versions. Commit merged import and receipt `(target path,lock.base,sha256 outside file)` in one durable transaction; repeats return stored payload. Formatter MDX rewrites are benign outside edits and round-trip through import. Build this internal importer now; the public import/release flow arrives in 09. Never compare the edited file only against latest or infer omitted dim as deleted.

**Verification:** run `mise exec -- vp run @composedink/core#test`, `mise exec -- vp run composed-web#e2e`, tracer e2e. Add seeded property tests generating dim ranges and visible edits: hidden substrings/marks survive clean apply and concurrent changes; compare to an independently constructed segment oracle. Include multiple adjacent hidden spans, boundaries, Unicode, complete visible deletion, frontmatter and JSX. Browser cycles an alternative containing dim, keeps ghosts, stashes/restores, reloads and undoes each operation. Assert exported MDX bytes/hash match clean projection; no stash text appears. No later publish command is used.

**Out of scope:** compacting historical bases away, host frontmatter policy, lint/rewrite, sync, public release pins/server.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

2026-11-05 — Task 1 verified. Read the plan/design and Plans 01–04 logs before changes;
installed through mise. Wrote the seeded clean-apply property test first: the existing
identity projection fails (`test-results/plan-05-focused-red.log`). The Loro probe passes:
`expand:"none"` excludes concurrent edge insertions, mark/unmark uses UTF-16 offsets,
emoji and snapshot reload retain marks. Contiguous selections use one mark range so
interior typing inherits dim. Flip tests preserve inactive dim spans. Found and fixed
zero-length clipped marks in the existing snippet helper and surrogate-pair cursor ends.

Implemented authority ghost.set, stable-ID cut/restore, detached-anchor rejection,
empty-document insertion, and ordered ghost resolution. Existing operation inverses
cover these operations. Crossing typing imports unchanged; repair gets a separate commit
and preserves inactive marked snippets. Browser verifies Mod-., Mod-Shift-Enter, marked
flips, ghost resolution, cut/Insert, operation undo for each and reload. Evidence:
plan-05-task1-tests.log, plan-05-dim-e2e.log, plan-05-dim.json/png, and
plan-05-task1-all-tests.log (7/7 tasks). Check passes with no warnings/errors.
No contradiction or stop. Task 2 remains in progress.

2026-11-05 — Task 2 implementation. Clean/full projection is derived from Loro delta
attributes, with UTF-16 visible segments and an explicit hidden-edge insertion bias.
Scratch diff hunks delete only mapped visible segments in forkAt(base); branch updates
merge into current authority history. Proposal extraction retains Plan 04's live-anchor
and authorship rules. Added a regression for inserted emoji: the old filter retained
only its first surrogate; it now filters whole code points and records UTF-16 dim spans.
The prior peer-order cases remain acceptance evidence.

Export requires view; CLI preview defaults clean and --include-dim selects full.
Preview refresh retains the destination's view. Export validates the projected YAML
and MDX, reports omitted source ranges on failure and writes exact projected bytes/hash,
never stash. Flagged the additional YAML parser before adding it using mise/vp; the
lockfile was generated by the package manager. Frontmatter remains part of mdx, with
no schema or separate document container.

The internal importer consumes the verified destination lock.base/view and retained
projection hash; old-MDX/current-lock detection names both versions before diffing.
Merged updates and reconciliation result payloads share the durable transaction envelope.
Repeats after restart return the original result even after subsequent author edits.
Formatter quote changes and concurrent author text survive import. Removed the old
full-only importer; no public import/release/publish command was added.

Property evidence uses seed 505: 150 random documents with an independent per-unit
source oracle, random dims/visible edits, Unicode, adjacent hidden spans, complete
visible deletion, concurrent marked additions, and a marked alternative flip per trial.
Twenty additional seeded real exports retain frontmatter/JSX and compare exact bytes
and hashes to an independent clean oracle. Invalid omission, clean proposal, detached
restore, snapshot restart and marked interior/cross-boundary editing have focused tests.
The durable export property exceeded the default 5s harness once; its allowance is 30s
for the same 20 exports. No assertion or product timing was relaxed.

The expanded browser cycle also types across an alternative boundary, waits for durable
Saved, verifies inactive marked text in stash through the CLI, then reloads. A repeated
cycle found a stale stash row between undo and the debounced inspection; stash now reads
the replica on each import so Insert always carries the current stable ID.

2026-11-05 — Completion gates green:

- `mise exec -- vp check --fix`: no warnings/lint/type errors, 108 files
  (`test-results/plan-05-final-check.log`). Formatting repeated until stable.
- `mise exec -- vp run -r test`: 7/7 tasks; core 21 files / 77 tests
  (`plan-05-completion-tests.log`).
- `mise exec -- vp run @composedink/core#test`: 21 files / 77 tests, 281.93s,
  including 1,000 durable writes (`plan-05-completion-core.log`).
- `mise exec -- vp run composed-web#e2e`: 3/3 suites
  (`plan-05-completion-web-e2e.log`); editor production build passes
  (`plan-05-completion-web-build.log`).
- `mise exec -- vp run host-tanstack#e2e`: assertions 1–6 all true, strict React
  identity true, component refresh 890.94ms (`plan-05-host-e2e.log`, `tracer.json`).

The seeded properties, mark probes, UI cycle and importer cases above pass in the final
77-test core gate and web gate. `test-results/plan-05-evidence.md` maps them to files.
No reproduced contract contradiction and no stop. No hellotimber changes. Task 1 is
`d9f73b9`; the following feat(core) commit completes Task 2. Push to origin main follows
this verified task commit. Public release/import commands remain Plan 09's scope.
