# Writing process — design unit (phase 1.5)

Source: Gergely Orosz, "Becoming a better writer" (Pragmatic Engineer, 2022-01-18), and
Lachlan's decisions of 2026-11-06. This unit extends `composed.md`; everything there holds.
Plans 13–15 implement it. Terms: "kind" (a document type), "ruleset" (the checks a document
runs), "thread" (an anchored comment conversation), "request" (a feedback ask).

## What the post says, and what we take from it

The post's process is three stages: **draft** (capture the content), **edit** (make it
readable: one-thought paragraphs sized to the medium, cut what does not earn its place,
shorter sentences, grammar, deliberate bullets and numbering, bold only for key thoughts and
never inside a sentence, visuals, effort scaled to the reader), **feedback** (ask directed
questions, not "thoughts?"; pair-write important docs; accept or reject tool advice on your own
judgement). Around it: collect best-in-class examples and copy their structure; read fiction for
rhythm; commit to weekly pieces that get the whole loop.

Decisions (Lachlan, 2026-11-06):

1. The eight edit techniques are **personal preferences shipped as defaults**: a ruleset, each
   rule off-switchable, with user-added rules. Not product behaviour.
2. "Quiet drafting" is **zen mode**: a status-bar toggle that hides diagnostics and panels. Not a
   document stage. There are no document stages.
3. **Document kind is chosen at creation and customizable**: blog post, weekly update,
   proposal, design doc, user-defined. A kind carries reader, medium, length budget, a body
   template and its ruleset.
4. A **sentence-length sparkline** in the status bar.
5. Feedback is **the model first, then preview links with Google-Docs-style comments**.
   Multi-user live editing is a follow-fast feature after this unit, not part of it.
6. **Comments work everywhere, offline included.** When the device is signed into a server,
   comments reflect shared preview links. **Preview links are impossible from a signed-out
   desktop app.** Sharing is a server feature; commenting is a model feature.

## Model additions

| Doc  | Container  | Type and contents                                                                                                                                                                          | Writer                                |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| post | `meta`     | adds `kind: KindId` (default `post`)                                                                                                                                                       | authority model/meta via `doc.create` |
| post | `threads`  | Map ThreadId → Map: `start`/`end` encoded cursors (sides Left/Right, like alts), `question?: QuestionId`, `state: "open"\|"resolved"\|"detached"`, `messages: MovableList<{by, at, text}>` | authority model/threads               |
| post | `requests` | Map RequestId → `{at, by, questions: {id, text}[], to: ("model"\|"link:"+LinkId)[], state}`                                                                                                | authority model/requests              |

Frontmatter inside `mdx` gains optional keys the kind defaults: `reader` (free text, who this is
for), `medium` (`phone` \| `screen` \| `web`), `budget` (words, integer). They are ordinary
frontmatter: hosts ignore unknown keys they do not validate (hellotimber's validator rejects
unknown keys, so its kind omits them from the exported file via the kind's `export.strip` list;
the values then live only in the Loro doc's `meta`). A kind decides which of these are
frontmatter and which are meta; the rules read the merged view.

Threads use the proposal cursor machinery: a thread whose live anchors resolve to an empty
interval becomes `detached` (kept, listed, not drawn). Thread messages are a `MovableList` so a
reply from a second device or a guest merges without conflict. Resolving is a state change by
op, never deletion. Threads are never exported into MDX; they are not frontmatter.

Kinds and rulesets are **device configuration, not document state**: `$COMPOSED_HOME/kinds/<id>/`
holds `kind.json` (reader/medium/budget defaults, `frontmatter` and `meta` key lists,
`export.strip`), `template.mdx`, and `rules.json`. Built-in kinds ship inside `core` and are
copied into `$COMPOSED_HOME/kinds/` on first use so the user owns them. A document records only
its kind id; if the kind is missing on another device the document still opens with the
built-in `post` kind and a warning, never an error. Kinds are agent-authored like components:
`kind.*` ops read and write them.

## Rulesets

A ruleset is `rules.json`: `{ "extends": "post" | null, "rules": { "<code>": false | { ...options } }, "custom": CustomRule[] }`.
Built-in rule codes (each one maps to a technique in the post; all default on in `post`):

| Code               | Technique                | Check                                                                                                                    |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `paragraph.length` | 1 readable chunks        | sentences per paragraph over the medium's limit (`phone` 3, `screen` 5, `web` 6; options override)                       |
| `budget`           | 2 remove the unnecessary | prose words over `budget`; reported once at the top with the overage                                                     |
| `preamble`         | 2 remove the unnecessary | apologetic or throat-clearing openers before a question or ask (phrase list, extensible)                                 |
| `filler`           | 2 remove the unnecessary | hedges and intensifiers (phrase list, extensible; distinct from Harper's adverb lint)                                    |
| `sentence.length`  | 3 shorter sentences      | words per sentence over a threshold (default 25) — exists today in `lint/rules.ts`; gains options                        |
| `harper`           | 4 grammar                | Harper lints, as today; `rules.json` can disable individual Harper lint kinds                                            |
| `bullets.long`     | 5 bullets and numbering  | list items longer than N sentences (default 2) → "merge into a paragraph"                                                |
| `bold.inline`      | 6 bolding                | `**…**` not at the start of its sentence                                                                                 |
| `visuals`          | 7 visuals                | a heading section over N words (default 400) with no image, block component or code block; one diagnostic per section    |
| `rhythm`           | fiction / rhythm         | runs of 4+ sentences within ±3 words of each other; the sparkline's data source, surfaced as one soft diagnostic per run |

Technique 8 (value the reader's time) is not a rule: it is the kind's defaults and the budget.
`CustomRule` v1 is a pattern rule: `{ code, message, phrases: string[] | regex: string, severity, replacement? }`
checked per paragraph like `filler`. Code rules remain agent work in the lint package.

Diagnostics carry their rule code and severity (`error` for prop-schema failures as today,
`warn` for Harper and custom, `soft` for rhythm and budget). The editor draws `soft` without
underlines (gutter and status only). The model reviewer receives the document's effective
ruleset in its brief so a disabled rule is not nagged about by the model either.

Zen mode: a `web` client preference (per device, `localStorage`), toggled from the status bar
and `⌘⇧.` (`⌘.` stays with dim); hides diagnostics decorations, the alternatives/stash/lint panels and the sparkline;
word count and save state remain. Lint keeps running so turning zen off is instant.

## Sparkline

Status bar shows a sparkline of words-per-sentence across the whole document (one bar per
sentence, prose only, max 120 bars by bucketing). Hover shows the sentence; click opens a list
of sentences sorted by length with jump-to. Data comes from the lint worker's prose pass
(`lint/prose.ts`), so it costs nothing extra.

## Feedback

### Requests

`feedback.request` creates a request: the questions (from the kind's default list, which seeds
Gergely's four: "How easy was it to read, and what one thing would improve it?", "What
resonated, and what was redundant?", "How could the takeaways be clearer?", "Which part was
most confusing?"), plus the recipients. Recipients are `model` and, when signed in, shared
links. A request is a document fact (so a second device sees it) and the questions are the
frame every recipient sees.

**Model recipient** (plan 15): the rewrite provider (plan 07) gains a review mode. The brief
contains the clean text, the kind's reader/medium/budget, the effective ruleset, and the
questions. The model answers each question with a short answer and zero or more anchored notes
(quote-based selection as in `alt.propose`); each note becomes a thread with `question` set and
`by: {kind:"agent", name:"model"}`. Suggested rewrites inside an answer land as alternatives
through the existing proposal path, never as thread text alone. A model answer is a proposal to
read, not an edit.

### Threads everywhere

Threads are local model state: `thread.open`, `thread.reply`, `thread.resolve`, `thread.list`
work offline, from the CLI, MCP and the editor. Agents comment through the same ops with
`by.kind:"agent"`. The editor shows threads in a right-hand column aligned to their anchor,
Google-Docs style; detached threads list at the bottom.

### Shared preview links (server, signed in)

Requires the P2 server session (accounts, device token, update relay). A link is a server object
`{linkId, docId, frontiers: pinned | live, commenter: "named-guest", expiresAt?, revoked}`; the
server renders the clean MDX (dim and stash omitted) to HTML with the request's questions at
the top and a comment column. A guest supplies a display name; the server writes their threads
into the document through the relay as `by: {kind:"guest", name, linkId}`. On the author's
devices the threads arrive like any update, so "comments reflect shared preview links" is the
sync itself, not a feature. `share.*` ops are rejected by the authority when no server session
exists ("sign in to share"); the desktop app shows the share button disabled with that reason
when signed out. Link rendering reuses `host-tanstack`'s fallback path for blocks; no remotes
load on a link page in this unit.

Ordering: comments and model feedback (plans 13–15) need no server. Shared links are the first
P2 deliverable after accounts and relay land, and reuse the thread container unchanged.

## Interfaces

New ops in the registry (CLI / MCP / socket generated as today):

| Op                 | Input                                             | Notes                                                     |
| ------------------ | ------------------------------------------------- | --------------------------------------------------------- |
| `doc.create`       | `+ kind?: KindId`                                 | applies the kind's template and frontmatter defaults      |
| `doc.kind`         | `{id, kind}`                                      | change kind; re-applies nothing, only changes which rules |
| `kind.list`        | —                                                 | built-in and user kinds with origin                       |
| `kind.read`        | `{kind}`                                          | kind.json, template, rules                                |
| `kind.write`       | `{kind, file, text, base}`                        | agent-authored; same base discipline as component files   |
| `rules.effective`  | `{id}`                                            | merged ruleset a document runs                            |
| `lint`             | unchanged; diagnostics gain `code` and `severity` |                                                           |
| `thread.open`      | `{id, base, quote, text, question?}`              | quote-based selection, like `alt.propose`                 |
| `thread.reply`     | `{id, thread, text}`                              |                                                           |
| `thread.resolve`   | `{id, thread}`                                    |                                                           |
| `thread.list`      | `{id, state?}`                                    |                                                           |
| `feedback.request` | `{id, questions?: string[], to: ("model")[]}`     | links join the `to` set in P2                             |
| `feedback.answers` | `{id, request}`                                   | model answers and the threads they created                |

MCP exposes every op; `thread.*` and `feedback.request` are agent-callable. Direct edits stay
human-only as before.

## Decisions

| Decision                                                  | Why                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No document stages                                        | Lachlan: zen mode is a toggle; the only stage-like thing is a request, which is an action               |
| Rules as configuration with user ownership                | the techniques are preferences; copying built-ins into `$COMPOSED_HOME` makes edits durable and visible |
| Kinds are device config, documents carry the id           | a kind travels with the author, not the document; missing kind degrades to `post` with a warning        |
| Threads in the doc, in a Loro container with live anchors | offline comments, agent comments and guest comments merge the same way; detachment is the alt rule      |
| Requests in the doc                                       | the questions frame every recipient and must be visible on every device                                 |
| Model answers become threads plus alternatives            | reading is a thread; changing text is a proposal; the model never gets a third path                     |
| Sharing refuses without a session                         | Lachlan: no links from a signed-out desktop; the authority enforces, the UI explains                    |
| Sparkline from the lint pass                              | no second prose tokenizer                                                                               |
| Pattern rules only for custom rules in v1                 | covers phrase lists and thresholds; code rules are agent work in the lint package                       |

## Units

| Plan | Delivers                                                                               | Depends on | Proven by                                                                                            |
| ---- | -------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| 13   | kinds, rulesets (config, built-ins, custom pattern rules, effective merge), zen mode   | 06, 11     | kind-created doc runs its rules; disabling a rule silences editor and `lint`; zen hides and restores |
| 14   | edit measurements: the rule table above, severities, sparkline                         | 13         | each rule has a positive and negative fixture; sparkline buckets match the prose pass                |
| 15   | threads and feedback: `thread.*`, `feedback.request`, model review mode, editor column | 13, 07     | offline thread survives edits and detaches on deletion; model answers land as threads + alternatives |
| P2   | accounts, device tokens, relay, then shared links with named-guest commenting          | 15         | guest comment appears on a second signed-in device; share refused when signed out                    |
