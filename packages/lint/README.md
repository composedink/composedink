# @composedink/lint

Standalone immutable MDX/prose diagnostics, Harper 3 and explicit style heuristics.
Offsets are original UTF-16 units. No Loro dependency or document writes.

```ts
import { createLinter, DEFAULT_RULES } from "@composedink/lint";
const engine = createLinter(); // retain one per document/worker
const settings = { ...DEFAULT_RULES, reader: "readers", medium: "web", budget: 1200 } as const;
const result = await engine.lint({ base: "revision-1", text: "This is an test.", settings });
```

Use `lintWorker(send)` from `@composedink/lint/worker` inside a browser worker;
post `{id, snapshot}` and receive `{id, result}` or `{id, error}`. Node workers
can use the `@composedink/lint/node-worker` entry. Accept results only while both
request ID and base match the current snapshot. Clear feedback on edits.
Harper's inlined binary works offline in Node and Vite; exclude harper.js from
Vite optimizeDeps. The worker retains the dictionary and caches paragraph results
only for the current document. Unchanged paragraphs shift without re-linting.

Every snapshot carries `settings`: the document's effective rules plus reader, medium
and budget (core's `rules.effective`). Workers never read device files. Diagnostics carry
`code` and `severity` (`error` for `block:props`, `warn` for Harper, style and custom,
`soft` for budget/rhythm; custom rules set their own). Results carry `config`
(`configIdentity(settings)`); reject a result whose config is not current, and the
paragraph cache re-lints when only the rules change.

Every result also carries `sentences`: each prose sentence `{from, to, text, words}` in
source order, from the same pass as the diagnostics (the editor's sparkline reads only these).
One tokenizer in `src/prose.ts` serves rules and measurements: a run of `.`/`!`/`?` (plus
closing quotes/brackets) ends a sentence when whitespace or the block end follows, except a
single full stop after an abbreviation (`Dr.`, `vs.`, …), an initial (`J.`) or a dotted
abbreviation (`e.g.`, `U.S.`); paragraph, list-item and heading ends always end a sentence.
Words are letter/number runs joined by apostrophes, hyphens or digit separators (`3.50`).
Headings are structure, not sentences; sentences without words are dropped. Sentence
measurements are returned even when the rules that read them are disabled.

Public codes run only when their setting is an options object; options override these
defaults by key (`parseRuleset` rejects unknown options and wrong types):

| Code               | Options (defaults)                        | Reports                                                                    |
| ------------------ | ----------------------------------------- | -------------------------------------------------------------------------- |
| `paragraph.length` | `limits: {phone: 3, screen: 5, web: 6}`   | a paragraph with more sentences than the medium's limit, spanning it       |
| `budget` (soft)    | none; reads `settings.budget`             | total sentence words over budget, once at the first prose character        |
| `preamble`         | `phrases` (sorry to bother you, …)        | a paragraph/item opener followed by `?` or ask/request/please              |
| `filler`           | `phrases: very, really, perhaps, sort of` | each phrase anywhere (case-insensitive, whole words)                       |
| `sentence.length`  | `maxWords: 25`                            | each sentence over the limit                                               |
| `harper`           | none                                      | Harper lints as `harper:<LintKind>` with messages and suggestions          |
| `bullets.long`     | `maxSentences: 2`                         | a list item (continuation lines included) over the limit: merge into prose |
| `bold.inline`      | none                                      | `**…**`/`__…__` not at the start of its sentence                           |
| `visuals`          | `maxWords: 400`                           | a heading section over the limit without image, flow block or code         |
| `rhythm` (soft)    | `minSentences: 4`, `toleranceWords: 3`    | each maximal run of consecutive sentences within max−min ≤ 2×tolerance     |

Phrase lists replace the defaults; custom rules add more. Sections run from a heading (any
level) to the next; content before the first heading is a section. Images (markdown or
`<img>`-like tags), flow JSX components and code blocks exempt only their own section; inline
JSX does not. `harper:false` disables Harper; `harper:<LintKind>: false` disables one kind.
Legacy `style:passive`, `style:adverb` (without "really"/"very", which `filler` owns) and
`style:simpler` run unless set to `false`. Custom pattern rules are
`{code, message, severity, replacement?}` with exactly one of `phrases` (literal,
case-insensitive, whole word) or `regex` (Unicode, global, empty matches skipped); matches
touching masked syntax are skipped. `parseRuleset` validates `rules.json`; `mergeRulesets`
merges a resolved chain; `ruleOptions` merges one rule's options over `RULE_DEFAULTS`.

These are suggestions, not claims of exhaustive linguistic analysis. Pass block schemas/props in the snapshot;
validation uses blocks.validateProps. Frontmatter, fenced/indented/inline code,
JSX tags/expressions, URLs and composed fallback comments are masked. Incomplete
expressions/tags are masked to the end while the author types. Dismissal belongs
to the consumer. Suggested replacements must be proposed, never silently applied.
