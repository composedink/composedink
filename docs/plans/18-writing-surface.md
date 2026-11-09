# Plan 18 — The writing surface

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 13, 14, 15, 17. Paths are composedink-relative.

**Goal:** a writer opens the app, starts a post of a chosen kind, drafts at full width in a prose typeface, edits with the measurements grouped and legible, flips alternatives in place, and meets one plain error at a time. Source: the Impeccable critique of 2026-11-09 (`apps/web/.impeccable/critique/2026-11-09T19-28-31Z__src-posteditor-tsx.md`, score 16/40). Every priority issue, the P2 copy issue and the minor observations in that report are in scope. [Writing process](../design/writing-process.md) and [composed](../design/composed.md) stay authoritative; this plan changes no model container except the stash removal op.

The Tauri app renders `apps/web`; nothing in `apps/desktop` changes except the smoke test if its selectors move.

**Files:**

- Core: update `packages/core/src/ops/{registry,capabilities}.ts`, `src/feedback.ts`, `src/model/stash.ts`, `src/store/store.ts` (list), `src/index.ts`; add tests in `packages/core/tests/{list,stash,feedback}.test.ts`.
- Lint: update `packages/lint/src/{prose,ruleset}.ts` and tests.
- CLI: update `apps/cli/src/main.ts` (`list`, `stash remove`) and `apps/cli/tests`.
- Web: add `apps/web/src/{Home,NewPost,Settings,Notice,Shortcuts}.tsx` (names indicative), `src/editor/{frontmatter,alternative-widget}.ts`; update `PostEditor.tsx`, `ThreadColumn.tsx`, `SessionStatus.tsx`, `SharePanel.tsx`, `style.css`, `main.tsx`, `apps/web/package.json`, `pnpm-workspace.yaml` (catalog: the prose font package); update every `apps/web/tests/*.spec.ts` that the new surface moves; add `apps/web/tests/{home,settings,alternatives-inplace,errors}.spec.ts` (or fold into existing specs).
- Root: `tests/desktop-smoke.ts` and `tests/desktop-gui.ts` if selectors move; `apps/desktop-rune/README.md` (the `doc.list` note); `docs/plans/README.md`.

### Task 1 — Core: list documents, remove stash items, fail before persisting an undeliverable request

- [ ] `doc.list` (read-only, no input): `{docs: {id, title, kind, words, updatedAt}[]}` sorted by `updatedAt` descending. `title` is the frontmatter `title` else the slug; `kind` from `meta` else `post`; `words` counts prose with frontmatter excluded (reuse one word-count function, exported from core so the web status bar and the list agree); `updatedAt` is the store's latest update time for the doc. Registered as read-only like `doc.read`, exposed to CLI as `composed list` (table; `--json`) and to MCP. Tests: empty home; three docs in order; a doc with broken frontmatter still lists with its slug as title.
- [ ] `stash.remove {doc, item}`: deletes the stash entry by id; idempotent; on the operation-undo stack like `stash.restore`. CLI `composed stash remove <doc> <item>`. Tests: remove, remove again, undo restores.
- [ ] `feedback.request` validates the provider configuration (the same check `alt.rewrite` performs) **before** writing the request container; with no provider it throws `ProviderFailed: no writing model is set up on this device; fix: add rewrite.endpoint and rewrite.model to $COMPOSED_HOME/config.json` and the document is unchanged. When every recipient delivery fails after the request was written (transport or provider error), the request is removed in the same commit that records nothing else, so a failed request never greets another device. The error still reaches the caller. Tests: no provider → doc unchanged; provider 500 → doc unchanged, error thrown; success path unchanged.
- [ ] Lint: the prose pass masks a closed frontmatter block entirely, YAML-valid or not (Harper never lints `---`); a block that is opened but never closed is prose. `filler` default phrases become `very, really, quite, just, basically, actually, perhaps, maybe, sort of, kind of, a bit, I think, I guess, in my opinion`, matched case-insensitively at word boundaries. Tests: `I think maybe` yields two filler diagnostics; `**very**` yields one `filler` and one `bold.inline` on the same range (both are correct; the editor merges underlines in Task 5); broken frontmatter yields sentences from the body.

### Task 2 — Web: home, new post, no fallback slug

- [ ] Delete the `"tracer"` fallback. The URL decides: no `doc` parameter shows **Home**; `?doc=<slug>` opens a document; an unknown slug shows Home with one notice ("There is no post called `<slug>`"). `localStorage` `composed.selectedDocument` is no longer read at startup; it is kept only so the desktop smoke can read the last-opened slug (confirm the smoke's use before removing it entirely).
- [ ] Home lists `doc.list` as rows (title, kind, words, last edited as relative time), newest first, with a **New post** button and the session state. Rows are links to `?doc=<slug>`. Empty state: a short invitation to start the first post, not a blank page. Home subscribes to the studio's doc events if the transport exposes them; otherwise it re-lists on focus and after creation.
- [ ] New post: a title field and a kind chooser built from `kind.list` and `kind.read`: one row per kind showing its name, reader, medium and budget, and the template's first heading lines; `post` is preselected. The slug derives from the title (lowercase, hyphens, deduplicated against the list with `-2`, `-3`); the writer sees the slug and can edit it. Submit calls `doc.create {slug, kind}` and navigates into the editor with the caret after the frontmatter. Escape or Cancel returns to Home. Keyboard: the title field is focused on open; Enter submits; the kind list is arrow-navigable with visible focus.
- [ ] The editor header gains **All posts** (back to Home) left of the title; the title shows the document's frontmatter title (live), with the slug as `title` attribute; it never wraps mid-word.
- [ ] e2e: cold open shows Home with the empty invitation; New post → weekly-update → navigates, template present, kind in the status bar; unknown slug shows the notice; Home lists the two posts newest first.

### Task 3 — Web: frontmatter as settings, body counts regardless

- [ ] A **Settings strip** above the editor shows the kind's reading fields (title, reader, medium as a select, budget as a number) read from the live document. Editing a field writes the corresponding frontmatter line through the CodeMirror binding (so it is ordinary typing through Loro, undoable with ⌘Z); adding a missing key appends it to the block; `kinds.ts` already exposes the key-range helper. Fields the kind keeps in `meta` are written with `doc.kind`-style ops only if such an op exists; otherwise they are read-only in the strip with the reason as a tooltip (confirm which ops exist before deciding; do not invent one).
- [ ] The YAML block is folded in the editor by default (a one-line fold marker reading `settings`); clicking it unfolds for direct editing. Typing into the folded marker is impossible; the caret skips over it.
- [ ] A malformed block produces exactly one notice at the top of the Writing feedback list: "The post's settings block is malformed (line N): <yaml message>", with an **Unfold** action. `doc.read`'s `diagnostic` string is no longer rendered under Block usages.
- [ ] Word count, sparkline and lint come from the body whether or not the block parses (Task 1's lint change plus the shared word-count function).
- [ ] e2e: change the budget in the strip → frontmatter line changes and ⌘Z reverts it; break the YAML by unfolding and typing → one notice, word count unchanged, sparkline still populated; fix it → notice gone.

### Task 4 — Web: one error at a time, writer copy, status bar

- [ ] One `Notice` component replaces the header `[role=alert]`, the purple `.request .failure` and any error text in the status bar. A notice is rendered next to the control that failed (Ask, Comment, Share, Stash, the alternative widget, the strip); operations with no control (undo, inspection) use a single header notice. Messages are shown once; the `Error: Error:` prefixes are gone (`String(e)` is never shown raw; strip `^Error: ` and the `code: ` prefix, keep the `fix:` clause as a second line). Known codes map to writer copy: `ProviderFailed` → "No writing model is set up on this device yet." with a **How to set one up** disclosure that names `~/.composed/config.json` and the two keys; `UnknownDoc` → the Home notice from Task 2; `Unauthorized` → "This device was signed out. Sign in again to sync."
- [ ] The transport's status callback reports only connection and save state (`Connecting`, `Saving`, `Saved`, `Offline`); operation failures never reach it. Check `editor/transport.ts` for the path that produced `Unsaved — Error: …` and route it to a notice.
- [ ] Signed-out state appears once: in the header, as "Not signed in · Sign in" where **Sign in** opens a small disclosure with the exact command for this device (`composed login <server>` only when a server is known; otherwise "Pair this device from a signed-in one: `composed devices pair`"). The status bar shows the session only when signed in ("Synced just now").
- [ ] Status bar order and copy: `175 / 1200 words` when the kind has a budget (plain `175 words` otherwise; over budget turns the figure to the warning colour), save state, `Kind: Post`, `5 rhythm notes` (or none), sparkline, **Shortcuts**, **Zen**. The `Cursor N` / `N UTF-16 units selected` line is removed. **Shortcuts** opens a popover listing ⌘. dim, ⌥↑/⌥↓ flip, ⌘⏎ keep, ⌘⇧R rewrite, ⌘⇧. zen, ⌘Z undo typing, and the Undo operation button.
- [ ] Share: the disabled button's reason is a tooltip and the header's sign-in disclosure; no second red line.
- [ ] e2e: Ask with no provider → one notice under the Ask form with the writer copy, status bar still `Saved`, reload shows no persisted request; signed-out header text once, status bar without a session item.

### Task 5 — Web: layout, typography, feedback grouping

- [ ] Prose typeface: add `@fontsource-variable/source-serif-4` (OFL) to the catalog and import it in `main.tsx`; the editor content uses it at 19px / 1.65 with a measure of 70ch (max-width on `.cm-content`, centred in its column); UI chrome stays system-ui. Line numbers are off. Headings in the source get weight, not just a mark colour. Theme the caret, selection, focus ring and underline offset from the palette.
- [ ] The comment column is `display: none` until a thread is shown or a composer is open; the editor takes the width. The `Show [Open]` filter appears only when there is at least one thread.
- [ ] The aside keeps **Writing feedback**, **Stash** and (when any) **Alternatives count**; **Preview**, **Block usages** and **Dependencies** move into one collapsed disclosure titled **Blog preview and components** at the bottom of the aside. Zen hides the whole aside and the Settings strip; the status bar keeps words, save state and Zen.
- [ ] Writing feedback groups diagnostics by rule: one row per rule with its message template, a count and a **Dismiss all**; a row expands to its instances (click one to jump). Severity is shown by the label colour and a 1px border, not a 3px side rule; the same applies to `.alternative`, `.thread`, `.request` and `.share-panel` (detector rule `side-tab`, five findings in `style.css`). Two diagnostics on one range draw one underline (the stronger severity).
- [ ] Breakpoint: the split folds to one column below 1000px; the header never wraps **Undo operation** or **Share** onto two lines (wrap the whole action group instead). Check 900, 1250 and 1440 wide with the critique's prose (`/tmp/critique-a` screenshots show the before).
- [ ] Preview URL: `inputmode="url"`, placeholder `http://localhost:3000/posts/<slug>`, and a hint when the value lacks a scheme. The intro sentence is rewritten so it does not leave one word on the last line.
- [ ] Stash entries show the text in the prose face, a **Remove** (Task 1 op) and **Insert**; no monospace `pre`.
- [ ] e2e: comment column absent with no threads and present after one; feedback rows grouped with counts; zen hides the aside; detector `impeccable detect --json apps/web/src` reports 0 `side-tab` findings (run it from `apps/web`; record the output in the log).

### Task 6 — Web: alternatives in place

- [ ] When the caret is inside an alternative range (or the pointer hovers it), a small widget appears above the range: `2 / 3`, `↑`, `↓`, **Keep**, and a **…** menu with **Keep and ghost the rest**. The widget is keyboard reachable (Tab from the editor when visible) and the existing ⌥↑/⌥↓/⌘⏎ keep working. The gutter dot stays as the at-a-glance marker.
- [ ] The aside's Alternatives list is removed; the aside shows "3 alternatives" with a **Next** action that moves the caret to the next range (so Alex can walk them).
- [ ] e2e: propose via CLI, caret into the range → widget visible with `1 / 3`; click ↓ → text changes and `2 / 3`; Keep → widget gone, stash has two items; keyboard path still passes `alternatives.spec.ts`.

### Task 7 — Workspace actions, docs, gates

- [ ] The JSON console becomes **Developer actions**, collapsed, last in the page, hidden in zen, with the keystroke sentence removed (Shortcuts owns it). Tests that drive it keep working.
- [ ] `apps/desktop-rune/README.md`: the "no listing operation" sentence now points at `doc.list`. Core README: `composed list`, `composed stash remove`, and the feedback-request behaviour.
- [ ] Gates, in this order, foreground and sequential: `mise exec -- vp check --fix`; `mise exec -- vp run -r test`; `mise exec -- vp run composed-web#e2e`; `mise exec -- vp run composed-web#build`; `mise exec -- vp run host-tanstack#e2e`; `mise exec -- vp run composed-desktop#smoke` (the runtime part must pass; the GUI part may report `skipped: gui session locked`). Never run `vp run -r test` at the same time as an e2e.
- [ ] Impeccable detector from `apps/web`: `.../impeccable detect --json src` exits 0.
- [ ] `docs/plans/README.md`: add row 18 (`in progress` → `done` with the date) and the gate row.

### Decisions

| Decision | Why |
| --- | --- |
| Home is a view of the same page, chosen by the URL | the desktop shell navigates only inside the handshake origin; one bundle, no router dependency |
| Settings strip writes frontmatter through the editor binding | one write path (typing through Loro) keeps undo, sync and the kind's frontmatter/meta split intact |
| An undeliverable feedback request is not a document fact | a request that reached nobody has nothing another device should see; the error belongs to the caller |
| Prose face is self-hosted Source Serif 4 variable | offline desktop app; OFL; one file; UI chrome stays system-ui so controls still read native |
| Alternatives flip in place with a widget, the aside keeps a count | the design doc's "in place" promise; the aside list was a debug view |
| Side-tab borders replaced by label colour and 1px borders | detector rule `side-tab`; severity stays visible through the label |

### Implementation log

(append per task: what shipped, evidence, deviations)
