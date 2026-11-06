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

- [x] Validate document/base retention, quote uniqueness and zero-based nth; report UnknownBase/QuoteNotFound/AmbiguousQuote before mutation. Expand hunks to sentence or whole list item/heading/code/JSX unit. For proposed frontmatter changes fail atomically with a human-direct instruction; no YAML alternative insertion.
- [x] Anchor start to first character with side Left and end to last character with side Right; typing at either edge stays outside. Resolve both cursors in current history; empty interval, including both `update` cursors collapsing, detaches to stable-ID stash (`reason:detached`). Otherwise attach to resolved interval with the version read from merged fork. Partial deletions attach with deletion preserved; concurrent human edits inside survive a flip. Retain current words as live version; return `{alternatives,detached,head,mode:propose}`. Never insert at fallback positions.
- [x] CLI defaults to propose and implements `--propose`, `--direct`, `--request`. Permit direct only if stdin.isTTY or explicit `--i-am-human`; check before reading/mutation. This is adapter capability, not by.kind. Studio direct uses its authenticated human action; MCP schema removes mode and injects propose, rejects unknown mode fields. Attribution remains unprivileged.
- [x] Add `new post <slug> --from <file>` now: create the empty doc, then import source through doc.apply direct under the same human adapter capability check. A non-TTY caller needs --i-am-human. Do not bypass ops with an internal text setter.
- [x] Generate MCP names/JSON Schema from registry with capability projection. Expose only implemented operations; no placeholder rewrite/ghost/publish tools. Add request receipts and inverse coverage for every new mutation.

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

**2026-11-05, stop 2 — extraction cursors include edge typing for the opposite peer order.**
Task 1 landed as `442d592` after its focused model/undo checks (11 tests), R2,
workspace tests (7/7), clean check and real Chromium alternatives UI passed.
Task 2 remains unticked and its implementation is uncommitted. No push.

The boss resolution's nine-case probe passes with base peer 1, human peer 2,
agent peer 3. Changing **only human to peer 3 and agent to peer 2** reproduces
an edge-containment failure twice on loro-crdt 1.17.1 / mise Node 22.22.3.
The human inserts `LEFT ` immediately before the unit and ` RIGHT` immediately
after; the agent updates `Fourth` to `Agent` from the common base.
Live anchors in current history correctly read
`Fourth sentence. Another sentence.` (both edge insertions outside).
Post-edit extraction cursors in merged history instead read
`AgentLEFT  sentence. Another sentence.`. Installing that version duplicates
the human's `LEFT ` inside the alternative while retaining its outside copy.
All other cases in this probe pass, including partial deletion, inside-range
human text, full replacement, last word and empty agent version.

Reproduction (exit 1 is the failing edge assertion):
`mise exec -- node test-results/plan-04-reversed-peer-extraction.mjs`.
Evidence: `plan-04-reversed-peer-extraction.log` and
`plan-04-reversed-peer-extraction-repeat.log`; randomized peer-order probe
`plan-04-randomized-extraction.mjs/log` independently reproduces it.
These files are in gitignored test-results/. The portable original probe was
also copied to packages/core/tests/loro-extraction.test.mjs (uncommitted).
No fallback extraction/filtering algorithm was invented. The contract needs to
say how extraction excludes current-history edge insertions when concurrent
agent replacement and human insertion order differently in merged history.
Fixed numeric peers cannot be assumed in production.

Partial Task 2 implements scratch-Loro hunks, sentence/structural expansion,
base/quote validation, frontmatter rejection, merged proposals, direct history
merge, human CLI checks, new --from via ops, registry-projected stdio MCP and
SDK-client/real-binary tests. Focused deterministic extraction and apply checks
passed; a subsequent random-peer core test also exposed that replacement-stash
text can contain `AgentHuman replacement.` rather than `Agent` (both reflect
the merged extraction interval; detachment is correct). The current test needs
to assert the merged rule, not a peer-order-independent stash literal. This is
separate from the reproduced **edge exclusion contradiction** above.

Workflow-3 evidence: test-results/plan-04-workflow3.json and
plan-04-cli-tests.log (1 real CLI/MCP SDK integration test passed): read base A;
human paragraph 2 direct edit retained; paragraph 4 unchanged on proposal;
one alternative flips to agent text; MCP has no mode and rejects supplied mode
with by:human; piped direct fails; detached result/stash and request replay pass.
This does not establish the failed edge contract. Capability/inverse focused
suite subsequently had 23 passing tests and one over-specific detached-stash
literal assertion failure (plan-04-final-focused.log).

Other gates reached: plan-04-final-check.log clean (96 files);
plan-04-final-web-e2e.log editor + alternatives pass; plan-04-final-web-build.log
production web build passes; plan-04-final-host-e2e.log all tracer assertions
1–6 pass (component refresh 883.97 ms). The final recursive suite was started
before the stop and its result is recorded below when it finishes. No final
all-green claim, no Task 2 completion commit, no push. All changes remain only
inside composedink; hellotimber was not modified.

The edge failure reopens Task 1's first acceptance checkbox despite the earlier
verified-task commit: the current algorithm does not satisfy edge exclusion for
arbitrary Loro peer order. Task 1's operations/UI checkbox records the built slice;
it does not override this stop. A minimized probe also performs the range flip:
`mise exec -- node test-results/plan-04-edge-order.mjs` (exit 1), with
`plan-04-edge-order.json/log` showing expected `LEFT Agent sentence...` versus
actual `LEFT AgentLEFT  sentence...`. The extraction rule requires resolution
before either task can be accepted as fully complete.

Final recursive run completed after the stop: **6/7 workspace tasks successful**
(test-results/plan-04-final-tests.log). Core: **14 files / 61 tests pass**, including
its 1,000-write durability test; blocks and boundaries pass; web binding/transport
passes. CLI/MCP fails only its detached-stash literal assertion: the merged
interval produced `AgentHuman replacem` rather than `Agent` for that peer order.
No assertion was weakened after stopping. The earlier standalone SDK/CLI run
passed; the aggregate run is not green. The final added focused tests report
23 pass / 1 fail as above. The final stop check passes with no warnings/errors
(test-results/plan-04-stop-check.log). Implementation is intentionally retained
uncommitted for resolution and further verification; only Task 1 and this stop
record are committed. Nothing was pushed to origin.

**Resolution 2 (boss, 2026-11-05).** The peer-order case is a tie-break on concurrent inserts at
one position, so the version must not depend on it. Rule: filter the merged interval by
authorship — keep a character only if the agent authored it (`text.getCursor(i, 0).pos().peer`
equals the agent fork's peer) or it lies inside the live-anchor interval resolved in the merged
fork. Verified with `test-results/plan-04-loro-spike-authorship.mjs` on loro-crdt 1.17.1 for
edges, inside-edit, first-sentence deletion and ¶2/¶4 under both peer orders: versions are
identical, and simulated flips give `LEFT Agent sentence. Another sentence. RIGHT` with no
duplication. Add it beside the extraction regression in `packages/core/tests/`; the CLI's
detached-text assertion should compare against this rule's output, not a peer-specific string.

**2026-11-05, Resolution 2 implemented; Plan 04 complete.** Finished inherited Task 2
and reclosed Task 1's edge-exclusion acceptance. Both alternative proposal and base-relative
apply now filter merged extraction characters by agent authorship or membership in the
merged live-anchor interval. The shared helper preserves dim spans through filtering.
Attachment still uses base-character live anchors resolved in current history; collapsed
intervals go only to stable-ID detached stash. No fallback insertion or YAML chooser.

Copied the authorship spike beside the nine-case extraction regression. Its production
propose/flip check fails without the filter (`LEFT AgentLEFT ...`) and passes with it.
Both peer orders give identical versions for edges, inside edits, first-sentence deletion,
and paragraph-2/paragraph-4 concurrency; flips never duplicate edge text. The CLI detached
assertion independently calculates the filtered merged result under both peer orders.

Completed scratch-Loro apply, sentence/structural expansion, atomic base/quote/frontmatter
validation, human-only CLI direct/import capability, propose-only registry-generated MCP,
request replay/conflict coverage and session inverses. Real binary plus SDK client workflow 3
proves human paragraph 2 survives, paragraph 4 remains visible until flip, detached work is
stash-only, replay keeps IDs, changed requests fail, piped direct fails, and MCP rejects
mode even with by:human. Mixed alts-before-mdx imports, reload, keyboard actions and undo
preserving later typing pass the editor regressions.

Final evidence under gitignored test-results/:

- plan-04-authorship-red.log: reproduced edge duplication before filter.
- plan-04-authorship-green.log: 4 files / 14 focused tests pass.
- plan-04-resume-peer-order.log: all eight spike cases pass (four scenarios × both orders).
- plan-04-workflow3.json and plan-04-resume-cli.log: real CLI/MCP SDK workflow passes.
- plan-04-resume-check.log: format, lint and types clean (98 files).
- plan-04-resume-all-tests.log: recursive workspace 7/7; core 16 files / 64 tests.
- plan-04-resume-core.log: standalone required core command passes all 64 tests,
  including the 1,000-write durability scenario.
- plan-04-resume-web-e2e.log: editor and alternatives e2e pass; R2/undo/transport
  tests also pass in the workspace suite. plan-04-resume-web-build.log: production build passes.
- plan-04-resume-host-e2e.log and tracer.json: assertions 1–6 true; component refresh
  829.93 ms. A first run during concurrent durability stress exceeded the unchanged
  2 s bound (2271.67 ms); preserved in plan-04-resume-host-e2e-loaded.log. The isolated
  rerun passes without code or tolerance changes.

No new contradiction or stop. Task 1 remains committed as 442d592; the following feat(core)
commit completes Task 2 and the reopened acceptance. All work stayed inside composedink;
hellotimber was not modified. Push to origin main follows the final documentation check.
