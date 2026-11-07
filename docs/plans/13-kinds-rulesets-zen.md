# Plan 13 — Document kinds, rulesets and zen mode

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 06, 11. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** create documents from user-owned kinds, run their effective rules in CLI and editor, and draft quietly without stopping lint. [Writing process](../design/writing-process.md) is authoritative over the base design for this unit.

**Files:** add `packages/core/src/kinds.ts`, `src/kinds/builtins.ts`, `tests/kinds.test.ts`, `tests/rulesets.test.ts`; update `packages/core/src/{config,index,node,authority,export,import,inspect}.ts`, `src/model/{text,read,inverse}.ts`, `src/ops/{registry,lint}.ts`, `tests/{ops,lint,export}.test.ts`; add `packages/lint/src/ruleset.ts`, `tests/{ruleset,custom}.test.ts`; update `packages/lint/src/{index,rules,worker}.ts`; update `apps/cli/src/{main,studio,mcp}.ts`, `apps/cli/tests/mcp.test.ts`; add `apps/cli/tests/kinds.test.ts`, `apps/web/src/editor/zen.ts`, `apps/web/tests/kinds-zen.spec.ts`; update `apps/web/src/{PostEditor.tsx,style.css}`, `src/editor/{dim,lint,diagnostics}.ts`, `apps/web/tests/dim.spec.ts`, `apps/web/package.json`, core/lint READMEs. Existing status, alternatives, stash and feedback panels live in `PostEditor.tsx`.

### Task 1 — Define and persist kind configuration

- [x] Write temporary-home tests first for first use, subsequent user edits, missing kind fallback, invalid paths, stale writes and inherited rules. Run `mise exec -- vp run @composedink/core#test`.
- [x] Define `KindId` as a safe lowercase slug, excluding reserved `component` (decision in this plan). Store only the kind id and kind-selected meta defaults in the document, never templates or rulesets. Kinds live at `$COMPOSED_HOME/kinds/<id>/{kind.json,template.mdx,rules.json}`. Validate JSON and path boundaries before atomic file writes; use the existing store atomic-write utility and device config ownership.
- [x] Use this concrete kind shape (decision in this plan): `{reader:string,medium:"phone"|"screen"|"web",budget:number,frontmatter:string[],meta:string[],export:{strip:string[]},questions:string[]}`; budget is a positive integer. Restrict placement lists to reader/medium/budget, with each assigned once. Seed questions with the four exact questions in the design. Template is ordinary MDX including ordinary frontmatter, with no interpolation language (decision in this plan).
- [x] Ship `post`, `weekly-update`, `proposal`, `design-doc` and `hellotimber` in `src/kinds/builtins.ts`; copy each built-in's three files on first use without overwriting user files. Default values and template prose are editable seed content (decision in this plan): post reader="blog readers", medium="web", budget=1200; weekly-update="teammates"/"screen"/500; proposal="decision makers"/"screen"/1500; design-doc="implementers"/"screen"/2000; hellotimber uses post values. Keep templates to a title and relevant section headings. All derive rules from post except post, whose extends is null.
- [x] For hellotimber put reader/medium/budget only in meta, frontmatter list empty, `export.strip:["reader","medium","budget"]`. Other seeds put these three in frontmatter. Merge the reading view as kind defaults, then meta, then explicit frontmatter (decision in this plan). Never duplicate frontmatter as a general model map. Strip configured keys from the export projection before validation/hash/write; retain values in meta on creation/import so stripping cannot lose them. Preserve source MDX and host frontmatter fields. Test export/reimport, clean/full exports and unchanged unrelated YAML keys.
- [x] On absent kind resolve to built-in post plus a visible warning in CLI/editor, retaining the recorded id. Distinguish missing from malformed configuration: invalid JSON/extends fails with an actionable file path (decision in this plan). Add typing/restart/preview tests for custom kinds: existing `model/text.ts` and `apps/cli/src/studio.ts` compare meta.kind to post. Use the existing slug-bearing post shape to distinguish posts from components rather than enumerating kind ids (decision in this plan); migrate every affected check without adding a container.

### Task 2 — Resolve rulesets and run custom pattern rules

- [x] Define the design shape `Ruleset={extends:KindId|null,rules:Record<string,false|Record<string,unknown>>,custom:CustomRule[]}`. CustomRule is `{code,message,severity:"error"|"warn"|"soft",replacement?}` intersected with exactly one of `{phrases:string[]}` or `{regex:string}`. Reject invalid regexes and collisions with built-in/Harper codes. Keep code execution out of config.
- [x] Resolve extends recursively by kind id, reject cycles/missing parents, merge parent then child rule codes, replace each overridden option object, and replace custom entries by code (decision in this plan). `false` disables any inherited/custom rule, `{}` enables with defaults. Effective output is `{rules,custom}` with no extends. Preserve explicit disabled entries for the model brief. Test multi-level merge, false-to-enabled, cycles, custom replacement and stale config caches.
- [x] Use public codes `paragraph.length`, `budget`, `preamble`, `filler`, `sentence.length`, `harper`, `bullets.long`, `bold.inline`, `visuals`, `rhythm`. Ship all enabled in post; plan 14 implements the remaining measurements. Migrate existing sentence/bold/bullet implementations to these codes; retain existing passive/adverb/simpler checks as individually switchable legacy codes, not duplicate measurements (decision in this plan).
- [x] Add `Diagnostic.severity` alongside the existing code and ranges: block:props is error, Harper/style/custom default warn, budget/rhythm soft. Custom severity overrides its default. Keep per-kind Harper codes `harper:<lint_kind>` as emitted today; false disables one kind, `harper:false` disables all. Test individual and global disables with a real Harper fixture.
- [x] Evaluate phrase/regex rules against `prose.ts` masked paragraphs with original UTF-16 ranges and optional replacement. Phrases are literal case-insensitive whole-word matches; regex uses Unicode/global flags and skips empty matches (decision in this plan). Positive/negative fixtures cover syntax masking and emoji. Add effective rules and reader/medium/budget to immutable LintSnapshot; workers must not read device files. Include configuration identity in caching and stale-result checks so a rules-only change re-lints unchanged paragraphs. Run `mise exec -- vp run @composedink/lint#test` and core tests.

### Task 3 — Expose kind and rules operations

- [x] Register only real operations: `doc.create` adds `kind?:KindId` default post; `doc.kind({id,kind})`; `kind.list({})`; `kind.read({kind})`; `kind.write({kind,file,text,base})`; `rules.effective({id})`. New doc-facing inputs use the design's id; existing doc.create/lint inputs retain their existing names. doc.kind changes only meta.kind and the selected rules, never body/defaults. Creation applies template/defaults once.
- [x] Return list entries `{kind,origin:"builtin"|"user"}`, read `{kind,base,files:{"kind.json":string,"template.mdx":string,"rules.json":string}}`, write `{base}` and effective `{rules,custom,reader,medium,budget,warnings:string[]}` (decision in this plan). Base is a hash of all three file bytes, not Loro frontiers; unknown/stale base rejects before writing (decision in this plan). Preserve component write's requirement to supply a read base; device files have no retained Loro history to merge. Missing user kind reads as three empty files with a hash so kind.write can create it file-by-file; validate complete configuration before use (decision in this plan). File enum permits exactly the three names. Device writes use request receipts and retry-safe atomic replacement.
- [x] Add CLI mappings in `apps/cli/src/main.ts`: `composed new post <slug> --kind <kind>`, `composed doc kind <id> <kind>`, `composed kind list`, `composed kind read <kind>`, `composed kind write <kind> --file <file> --base <base>` (stdin text), `composed rules effective <id>`. Keep --from behavior and human capability checks. MCP derives the matching tools from the registry; test real CLI/MCP parity and receipt replay with `mise exec -- vp run composed-cli#test`.
- [x] Feed identical effective snapshots to node lint and browser lint. Load config through authority operations, refresh on inspection after kind/config writes, and reject old worker replies even at unchanged document frontiers. Test a kind-created document runs its custom rule and disabling that code silences both `composed lint` and the editor. No new lint settings container or operation.

### Task 4 — Add zen preference and browser proof

- [x] Add per-device localStorage boolean `composed.zen` default false, status-bar toggle and `Mod-Shift-.` binding. `Mod-.` stays with dim in `editor/dim.ts` (boss decision: dim is the frequent Write_On action, zen is rare); do not move or remove the dim binding, and assert in `tests/dim.spec.ts` that both shortcuts coexist.
- [x] Keep word count and save state visible in the status bar; hide diagnostic decorations/gutter, alternatives/stash/lint panels and the plan-14 sparkline in zen. Keep the worker alive and accepting newest results while hidden. Hide the plan-15 comment column through this same preference when it arrives. Turning zen off restores current results and panel contents without editing source or document state.
- [x] Add `tests/kinds-zen.spec.ts` to the existing web e2e script. Browser proof covers template/defaults, warning on missing kind, effective-rule disable, zen toggle/key/reload, ongoing lint while zen is on and restored latest feedback. Verify soft diagnostics never produce underlines. Run `mise exec -- vp run composed-web#test`, `mise exec -- vp run composed-web#e2e`, `mise exec -- vp run composed-web#build`.

**Verification:** design Units evidence: **kind-created doc runs its rules; disabling a rule silences editor and lint; zen hides and restores**. Run `mise exec -- vp run @composedink/core#test`, `mise exec -- vp run @composedink/lint#test`, `mise exec -- vp run composed-cli#test`, `mise exec -- vp run composed-web#test`, `mise exec -- vp run composed-web#e2e`, `mise exec -- vp run composed-web#build`. Tests cover missing-kind post fallback/warning, inherited/custom rules, individual Harper switches, config-only invalidation, safe writes, hellotimber export stripping with meta retention and the shortcut conflict. No plan-14 measurement is required for this plan's completion.

**Out of scope:** document stages, config sync, code plugins, new measurement algorithms (14), feedback/model review (15), sharing/server sessions, redesigning the desktop shell.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit's files, commit the completed task, and update this index's status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

### 2026-11-06 — implemented (Claude Opus 5.5 implementer; boss verified and committed)

Built per task: (1) `packages/core/src/kinds.ts` + `kinds/builtins.ts` — kinds under
`$COMPOSED_HOME/kinds/<id>/{kind.json,template.mdx,rules.json}`, built-ins `post`,
`weekly-update`, `proposal`, `design-doc`, `hellotimber` copied on first use, missing kind →
`post` + warning, reader/medium/budget placement with `export.strip` kept in meta on export;
(2) `packages/lint/src/ruleset.ts` — `extends` merge, per-code disable including
`harper:<kind>` and `harper:false`, custom phrase/regex rules, `Diagnostic.severity`, effective
rules carried inside `LintSnapshot` (workers read no device files); (3) ops `doc.create.kind`,
`doc.kind`, `kind.list/read/write` (file-hash base), `rules.effective`, CLI `composed kind …`,
`composed doc kind`, `composed rules effective`, MCP parity; (4) `apps/web/src/editor/zen.ts` —
`composed.zen` localStorage preference, status-bar toggle, `Mod-Shift-.` (dim keeps `Mod-.`),
hides decorations/panels while lint keeps running; `tests/kinds-zen.spec.ts` in the e2e script.

Stops: the implementer twice ended its turn with background test runs still going and nothing
committed; the boss ran the gates. A first `vp run -r test` run in parallel with the host tracer
showed 3 failing core test files and a tracer crash; both were port/home contention — alone,
all pass. Do not run the recursive tests and the tracer concurrently.

Verification (boss, 2026-11-06): `vp check --fix` clean (171 files), `vp run -r test` 9/9
(core 29 files / 109 tests), `composed-web#e2e` 6/6 ("Kinds, effective rules, soft notes, zen
toggle/key/reload and missing kind PASS"), `composed-web#build` ok, `host-tanstack#e2e` all
checks true. Diff: 31 files changed, 712 insertions, 201 deletions, 11 new files.

### 2026-11-06 — implementer notes: decisions, discrepancies, evidence

Order: the core kinds module and the lint ruleset parser were written before the Task 1
tests, which were then added and passed on first run; Task 1–3 code was developed together
because `kinds.ts` depends on the lint ruleset parser. The boss's commits split it by
package (3373d18 core, 730a853 lint, 7dc0f2c cli, ff3de11 web). As a result the core commit
includes the registry ops and `ops/lint.ts`, and the lint and core commits depend on each other.

Discrepancies and resolutions (none blocked a step):

1. Retry-safe kind writes needed the receipt journal, and `store/receipts.ts` and
   `store/store.ts` were not in the plan's file list. The envelope gained `devices: {path,text}[]`;
   `authority.deviceWrite` stages within the transaction, and the store writes them atomically
   when it applies or replays. Same request + payload replays the receipt; a stale `base` fails
   UnknownBase before staging.
2. The slug-bearing post check broke `tests/loro-authorship.test.mjs`, whose fixture had only
   `meta.kind`. The fixture now also sets `slug`, the real post shape.
3. `export.strip` entries are restricted to reader/medium/budget. A free key list would let
   meta retention overwrite `id`/`slug`/`kind`. The design describes the list as host-key
   stripping for these three.
4. Import of a stripped export recomputes the strip with the kind's _current_ list and rebases
   the outside edit onto the full source (`restoreStripped`), so removed lines stay in place and
   values are also copied to meta. If the strip list changes between export and import, import
   fails RecoveryRequired; the list is not recorded in the lock (a public blocks type) or the
   export history.
5. `doc.create`/`doc.kind` reject a kind that does not exist on the device (UnknownKind). The
   post fallback applies to documents whose recorded kind is absent, e.g. created elsewhere.
6. Public codes run only when their setting is an options object; legacy `style:*` codes run
   unless `false`. A `rules` key that is neither built-in, Harper nor a defined custom code fails
   InvalidKind (catches typos), so disabling a custom rule keeps its definition.
7. Behaviour change: `composed new post <slug>` without `--kind` now applies the post template
   and reader/medium/budget frontmatter, not an empty document. `--from` still replaces it.
   Existing specs and the tracer pass unchanged.
8. There was no status bar or word count. A footer status bar now holds word count, the save
   state (`role=status`, moved from the header), kind id, missing-kind warning, soft-note count
   and the Zen toggle. Zen hides the writing-feedback, alternatives and stash panels,
   underlines and soft gutter notes; preview, block usages and deps stay.
9. Editor refresh after `kind.write`: studio broadcasts `{config:true}` and the transport
   re-inspects; `doc.kind` arrives as document bytes. Edits made directly to files on disk reach
   the editor at its next inspection (any document change).
10. CLI warning: `composed lint` prints `warning: …` to stderr; `rules effective` returns
    `warnings` in JSON.
11. The hellotimber template has `title`, `summary` and `draft: true` but no `date`: there is no
    interpolation language, and hellotimber requires a real date the author must set.
12. The plan listed `model/read.ts`, `editor/dim.ts`, `apps/cli/src/mcp.ts`, `lint/src/worker.ts`,
    `index.ts`, `node.ts`, `inspect.ts`, `tests/export.test.ts`. None needed changes: MCP derives
    from the registry, the worker passes the snapshot through, and export strip/reimport tests are
    in `tests/kinds.test.ts`. Also touched beyond the list: `editor/transport.ts`,
    `tests/lint-benchmark.ts` and the lint `tests/settings.ts` fixture (snapshots now require
    `settings`).
13. One `vp run -r test` run timed out three `tests/crash.test.ts` cases at the 5 s default under
    load average ~5 (including `compact:pruned`, which never touches kinds). Alone, each takes about
    1 s and all 9 pass; the next full run passed. No timeout was changed.

Not done: no plan-14 measurement (codes are accepted and enabled but `paragraph.length`,
`budget`, `preamble`, `filler`, `visuals` and `rhythm` emit nothing yet); the sparkline and comment
column do not exist yet, so their zen hiding is not exercised.

Commands (composedink root, logs in gitignored `test-results/`):

- `mise exec -- vp check --fix`, then `vp fmt` and `vp check`: "All 233 files are correctly
  formatted"; "Found no warnings, lint errors, or type errors in 171 files".
- `mise exec -- vp run -r test`: "vp run: 9/9 successful" (core 29 files / 109 tests; lint
  4/10; cli 4/6; web 3/3) — plan-13-final-tests.log.
- `mise exec -- vp run @composedink/core#test` 29/109, `@composedink/lint#test` 4/10,
  `composed-cli#test` 4/6, `composed-web#test` 3/3, all EXIT 0.
- `mise exec -- vp run composed-web#e2e`: EXIT 0; editor, alternatives, dim (with the
  Mod-./Mod-Shift-. coexistence assertion), lint, rewrite and "Kinds, effective rules, soft
  notes, zen toggle/key/reload and missing kind PASS" — plan-13-web-e2e.log, plan-13-web.json,
  plan-13-kinds-zen.png.
- `mise exec -- vp run composed-web#build`: EXIT 0, "✓ built in 1.03s" (existing large-chunk
  advisory).
- `mise exec -- vp run host-tanstack#e2e`: EXIT 0, `{"1":true,…,"6":true,"6-ms":910.4,…}`, run
  after the recursive tests (not concurrently).
