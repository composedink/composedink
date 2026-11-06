# @composedink/lint

Standalone immutable MDX/prose diagnostics, Harper 3 and explicit style heuristics.
Offsets are original UTF-16 units. No Loro dependency or document writes.

```ts
import { createLinter } from "@composedink/lint";
const engine = createLinter(); // retain one per document/worker
const result = await engine.lint({ base: "revision-1", text: "This is an test." });
```

Use `lintWorker(send)` from `@composedink/lint/worker` inside a browser worker;
post `{id, snapshot}` and receive `{id, result}` or `{id, error}`. Node workers
can use the `@composedink/lint/node-worker` entry. Accept results only while both
request ID and base match the current snapshot. Clear feedback on edits.
Harper's inlined binary works offline in Node and Vite; exclude harper.js from
Vite optimizeDeps. The worker retains the dictionary and caches paragraph results
only for the current document. Unchanged paragraphs shift without re-linting.

Style rules are suggestions: sentence >25 words, bullet >30 words, passive
auxiliary/participle heuristic, common adverb list, six simpler-word substitutions,
and bold inside a sentence. Thresholds are exported by src/rules.ts. They are not
claims of exhaustive linguistic analysis. Pass block schemas/props in the snapshot;
validation uses blocks.validateProps. Frontmatter, fenced/indented/inline code,
JSX tags/expressions, URLs and composed fallback comments are masked. Incomplete
expressions/tags are masked to the end while the author types. Dismissal belongs
to the consumer. Suggested replacements must be proposed, never silently applied.
