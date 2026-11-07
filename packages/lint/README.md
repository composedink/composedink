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

Public codes: `paragraph.length`, `budget`, `preamble`, `filler`, `sentence.length`,
`harper`, `bullets.long`, `bold.inline`, `visuals`, `rhythm`; each runs only when its
setting is an options object. `harper:false` disables Harper; `harper:<LintKind>: false`
disables one kind. Legacy `style:passive`, `style:adverb` and `style:simpler` run unless
set to `false`. Custom pattern rules are `{code, message, severity, replacement?}` with
exactly one of `phrases` (literal, case-insensitive, whole word) or `regex` (Unicode,
global, empty matches skipped); matches touching masked syntax are skipped.
`parseRuleset` validates `rules.json`; `mergeRulesets` merges a resolved chain.

Style rules are suggestions: sentence >25 words (`sentence.length`), bullet >30 words
(`bullets.long`), passive auxiliary/participle heuristic, common adverb list, six
simpler-word substitutions, and bold inside a sentence (`bold.inline`). Thresholds are exported by src/rules.ts. They are not
claims of exhaustive linguistic analysis. Pass block schemas/props in the snapshot;
validation uses blocks.validateProps. Frontmatter, fenced/indented/inline code,
JSX tags/expressions, URLs and composed fallback comments are masked. Incomplete
expressions/tags are masked to the end while the author types. Dismissal belongs
to the consumer. Suggested replacements must be proposed, never silently applied.
