# Plan 04 — Alternatives, agent apply and MCP

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 03. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** stale agent edits become alternatives while human text remains authoritative; deleted anchors retain work in stash. Add CLI/MCP from the same implemented operation registry.

**Files:** `packages/core/src/model/{alternatives,apply,selection,stash,normalize}.ts`, `src/ops/{registry,capabilities}.ts`, `tests/{alternatives,apply,capabilities}.test.ts`; `apps/cli/src/{main,mcp}.ts`, `tests/mcp.test.ts`; `apps/web/src/editor/{alternatives,undo}.ts`, `tests/alternatives.spec.ts`. Add catalogued MCP SDK.

### Task 1 — Test model semantics first

- [x] Write failing tests for flips, exactly one missing-text slot, empty inactive string, non-overlap absorption, edge inserts and cross-boundary typing dissolution. Loro mutations run only in core/src/model/ (+ web binding); ops call model; browser types only. Inactive versions preserve dim spans even though dim UI arrives later. Normalization must deterministically stash recoverable snippets when repairing malformed alternatives, never silently discard them.
- [x] Implement `alt.propose/flip/resolve(rest:stash)`, `stash.list`, and session inverse ops. Derive active index. Flip changes live text and two slots in one commit. Absorb intersections and stash absorbed inactive versions. Add gutter dot, label/count, hover arrows, Alt-up/down and Mod-Enter now that the actions exist.

### Task 2 — Implement base-relative apply

```ts
const fork = authorityDoc.forkAt(decodeFrontiers(input.base));
const projection = project(fork, input.view ?? "full");
const hunks = diffWithScratchLoroText(projection.text, input.text);
// Map offsets using the base projection, never current text offsets.
// Direct: edit fork and merge branch history.
// Propose: apply delta in base fork; import its updates into a current-head fork.
// Read the resolved range from that merged fork, never from base text.
```

- [ ] Validate document/base retention, quote uniqueness and zero-based nth; report UnknownBase/QuoteNotFound/AmbiguousQuote before mutation. Expand hunks to sentence or whole list item/heading/code/JSX unit. For proposed frontmatter changes fail atomically with a human-direct instruction; no YAML alternative insertion.
- [ ] Anchor start to first character with side Left and end to last character with side Right; typing at either edge stays outside. Resolve both cursors in current history; empty interval, including both `update` cursors collapsing, detaches to stable-ID stash (`reason:detached`). Otherwise attach to resolved interval with the version read from merged fork. Partial deletions attach with deletion preserved; concurrent human edits inside survive a flip. Retain current words as live version; return `{alternatives,detached,head,mode:propose}`. Never insert at fallback positions.
- [ ] CLI defaults to propose and implements `--propose`, `--direct`, `--request`. Permit direct only if stdin.isTTY or explicit `--i-am-human`; check before reading/mutation. This is adapter capability, not by.kind. Studio direct uses its authenticated human action; MCP schema removes mode and injects propose, rejects unknown mode fields. Attribution remains unprivileged.
- [ ] Add `new post <slug> --from <file>` now: create the empty doc, then import source through doc.apply direct under the same human adapter capability check. A non-TTY caller needs --i-am-human. Do not bypass ops with an internal text setter.
- [ ] Generate MCP names/JSON Schema from registry with capability projection. Expose only implemented operations; no placeholder rewrite/ghost/publish tools. Add request receipts and inverse coverage for every new mutation.

**Verification:** run `mise exec -- vp run @composedink/core#test`, `mise exec -- vp run composed-cli#test`, `mise exec -- vp run composed-web#e2e`. First run a Loro spike covering ¶2 human edit/¶4 proposal, full deletion, select-and-type replacement, first-sentence deletion, concurrent inside-range edit then flip, and typing at both edges. Assert interval attachment/detachment and merged text, including collapsing updated cursors. Spawn real CLI and SDK MCP client against one temp home: read A, human edits paragraph 2 directly, agent proposes paragraph 4 from A. Paragraph 2 survives, paragraph 4 stays visible until flip; deleted paragraph proposal appears only in stash/result. Reusing request returns identical IDs; changed payload fails. MCP cannot pass mode even with by:human. Piped direct without flag fails. Imported batch ordered alts-before-mdx still updates the editor. Reload and undo flip without losing later typing.

**Out of scope:** clean-view projection, dim actions, model provider, comments/sharing, agent authentication against hostile local processes.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

**2026-11-05, stopped at the required initial Loro spike — original character
anchors omit agent replacement text at a changed boundary.** No task is complete;
checkboxes and index status remain unchanged. Read the index, this plan, integrated
design, plans 01–03 implementation logs, editor binding and hellotimber conventions.
`mise exec -- vp install` passed. No application implementation was started.

Reproduction uses installed **loro-crdt 1.17.1**, mise **Node 22.22.3**, deterministic
peers 1 (base), 2 (human) and 3 (agent), real `fork`/`LoroText.update`/history import,
and no mocks. All probe files are inside composedink's gitignored `test-results/`:

- `plan-04-loro-spike.mjs`: runnable eight-case probe with explicit expected/actual
  checks, saving `plan-04-loro-spike.json`; exit 1 means the required merged-range
  contract failed. Run `mise exec -- node test-results/plan-04-loro-spike.mjs`.
- `plan-04-loro-spike.log`, `plan-04-loro-spike-repeat.log` and
  `plan-04-loro-spike-first.json`: two runs with the same results.
- `plan-04-sentence-boundary.json`: independent sentence-sized reproduction,
  excluding paragraph expansion as the cause; its strict equality assertion failed.

The base's paragraph 4 is `Fourth sentence. Another sentence.`. The start cursor is
on `F` with side Left (-1), and the end is on the last character with side Right (1).
The human edits paragraph 2; the agent forks at base and updates `Fourth` to `Agent`.
Importing agent updates into a fork of human head produces exactly the desired
whole merged document, retaining paragraph 2 and containing
`Agent sentence. Another sentence.` in paragraph 4. But resolving the original
start cursor in that merged fork returns `{offset:66,side:-1,update:<cursor>}`:
it points **after `Agent`**. The resolved interval reads
` sentence. Another sentence.`, omitting the replacement. The separate
sentence-sized range similarly reads ` sentence.` instead of `Agent sentence.`.
Offsets account for the end character's side (Right includes that character);
this is not an exclusive-end off-by-one. Checking `update` alone cannot mean detached:
the current human interval is intact and the merged interval is nonempty.

Results per required case:

| Case                                                         | Observed result                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human edits ¶2, agent proposes ¶4                            | Merge retains human ¶2; original current ¶4 is unchanged. Current interval attaches. Extraction from merged fork omits `Agent`: **fails proposal version contract**.                                                                                                 |
| Human deletes full range                                     | Both current cursors have `update` and collapse to offset 54, side Left. Empty interval correctly classifies as detached. No actual stash operation exists yet.                                                                                                      |
| Human select-and-type replacement                            | Both current cursors have `update` and collapse to offset 72, after `Human replacement.`. Correctly classifies as detached rather than attaching to replacement.                                                                                                     |
| Human deletes first sentence                                 | Current interval remains attached to `Another sentence.` with an updated start cursor. Reading through original cursors in merged fork also yields that surviving sentence.                                                                                          |
| Concurrent human insertion inside range, then simulated flip | Human `Human ` insertion survives the branch merge and range replacement; the simulated flip installs ` sentence. Human Another sentence.` rather than `Agent sentence. Human Another sentence.`: **fails**. This is a low-level probe, not a shipped alt.flip test. |
| Typing at both edges                                         | `LEFT ` and ` RIGHT` remain outside the current interval, which reads the original paragraph exactly.                                                                                                                                                                |

Two additional controls pass: replacing the entire proposed paragraph and changing
its last word. The failure specifically reproduces the first-word replacement;
it is not a claim that every boundary replacement has identical cursor behavior.

Plan Task 2 and design “Base-relative apply/import” require first/last-character
Left/Right anchors and proposal versions read from the resolved merged range. Those
original anchors do not delimit all agent-inserted replacement text after a boundary
character is deleted by `update`. The contract needs an explicit rule distinguishing
current-history attachment anchors from delta-mapped proposal extraction boundaries,
including deleted and partially deleted ranges. No alternative anchoring/mapping
protocol was invented here under the stop rule. Restoring proposal text from base or
input would also violate the merge-result requirement and lose concurrent edits.

Workflow-3 CLI/MCP proof, real detached stash/receipts, UI, inverse operations and mixed
alts/mdx editor imports were **not implemented or claimed**. The R2 re-run and all
completion gates (core/CLI/web e2e, recursive tests, check and host regression) were
not run because work stopped before implementation. No completed-task commit, no
push, no hellotimber changes. Only this implementation log is a tracked change.

**Resolution (boss, 2026-11-05).** The extraction rule was wrong, not Loro: live anchors sit on
base characters, and an agent edit that replaces the unit's first word deletes the character the
start anchor is on, so it resolves after the inserted text. Fix: keep live anchors (base fork,
unit's first/last chars, sides Left/Right) for attachment/detachment, and add **extraction
cursors** created in the agent fork after its edit, on the post-edit unit's first/last characters
(empty unit → neighbours, before:Right / after:Left); read the proposal version between the
extraction cursors in the merged fork. Verified with `/tmp/spike2.mjs` (copy it to
`packages/core/tests/` as the regression) on loro-crdt 1.17.1: ¶2/¶4 → "Agent sentence. Another
sentence."; full deletion and select-and-type → detached; first-sentence deletion → attached, merged
"AgentAnother sentence." (human deletion preserved inside the proposal, as designed); inside-edit
then flip → "Agent sentence. Human Another sentence."; edges outside; full replacement; last-word;
agent deletes the whole unit → "" version. Implement Task 1 on this rule; the design's
"Base-relative apply/import" paragraph is updated.

**2026-11-05, Task 1 verified.** Added alternatives model/ops, deterministic repair stash,
intersection absorption, empty inactive versions, dim retention, boundary dissolution,
and operation inverses with restored live cursors. Shipped gutter dots, counts, arrows,
Alt-up/down and Mod-Enter keep-to-stash. R2 re-run passes with alts before mdx.
Evidence: test-results/plan-04-task1-{check,focused,all-tests,web-e2e}.log,
plan-04-alternatives-e2e.log, plan-04-alternatives.json/png. Focused model/undo
11 tests pass; workspace 7/7; check clean; Chromium keyboard, flip, keep/stash,
reload and undo preserving later typing pass. No contradiction.
