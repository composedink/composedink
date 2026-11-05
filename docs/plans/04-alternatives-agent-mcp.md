# Plan 04 — Alternatives, agent apply and MCP

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 03. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** stale agent edits become alternatives while human text remains authoritative; deleted anchors retain work in stash. Add CLI/MCP from the same implemented operation registry.

**Files:** `packages/core/src/model/{alternatives,apply,selection,stash,normalize}.ts`, `src/ops/{registry,capabilities}.ts`, `tests/{alternatives,apply,capabilities}.test.ts`; `apps/cli/src/{main,mcp}.ts`, `tests/mcp.test.ts`; `apps/web/src/editor/{alternatives,undo}.ts`, `tests/alternatives.spec.ts`. Add catalogued MCP SDK.

### Task 1 — Test model semantics first

- [ ] Write failing tests for flips, exactly one missing-text slot, empty inactive string, non-overlap absorption, edge inserts and cross-boundary typing dissolution. Loro mutations run only in core/src/model/ (+ web binding); ops call model; browser types only. Inactive versions preserve dim spans even though dim UI arrives later. Normalization must deterministically stash recoverable snippets when repairing malformed alternatives, never silently discard them.
- [ ] Implement `alt.propose/flip/resolve(rest:stash)`, `stash.list`, and session inverse ops. Derive active index. Flip changes live text and two slots in one commit. Absorb intersections and stash absorbed inactive versions. Add gutter dot, label/count, hover arrows, Alt-up/down and Mod-Enter now that the actions exist.

### Task 2 — Implement base-relative apply

```ts
const fork = authorityDoc.forkAt(decodeFrontiers(input.base));
const projection = project(fork, input.view ?? 'full');
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
