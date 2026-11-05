# composed — design grounding

This is the shared grounding for the design arena and the plan. It records what has been
decided in conversation (2026-11-05) and what remains open. Candidates design within it.

## Identity

- Name: **composed**. Domain `composed.ink`. npm scope `@composedink`. GitHub org `composedink`.
  CLI `composed`. Component ID prefix `composed:`.
- Owner: Lachlan Heywood (GitHub `lachieh`). First consumer: his portfolio/blog **hellotimber**
  (TanStack Start on Vite 8, MDX posts in `website/content/writing/`, figure components in
  `website/src/writing/figures/`). hellotimber is a *consumer only*; it never hosts composed
  code, and composed never imports from it.

## What it is

A local-first, agent-first writing tool for building ideas into blog posts, with the editing
model of Jason Fried's Write_On and the editing discipline of Gergely Orosz's "Becoming a better
writer" (chunk, cut, shorten, check grammar, bullets, bold sparingly, visuals, reader's time
first; get targeted feedback and record it; imitate good writing).

### Core editing model (Write_On)

- **Alternatives**, not version control: a word, sentence or paragraph can hold several
  versions; the writer flips through them *in place* (hover + ↑/↓ or a shortcut).
- **Ghost/dim**: text you might cut stays readable but dimmed. Export may include or omit it.
- **Stash**: leftovers kept beside the document.
- AI never overwrites; every AI (or agent) rewrite lands as an alternative to flip to.

### Settled technical decisions

| Area | Decision |
|---|---|
| Language/toolchain | TypeScript monorepo on Vite+ (`vp`: Vite 8/Rolldown, Vitest 4, Oxlint, Oxfmt), tooling via mise. Rust only where native code is required (Tauri plugins, local model). |
| Document store | **Loro** CRDT (`loro-crdt`) is the source of truth. The MDX *source text* (syntax included) is a `LoroText`. Dimmed text = Loro marks on ranges. Alternatives = a map keyed by stable cursors holding versions + active index (active version lives in the text). Stash = separate container. Each post, idea and component is its own Loro doc. |
| Markdown export/import | Export = `text.to_string()` (+ frontmatter). Import of outside edits = diff against the *base version the file was exported at* (`fork_at(frontiers)` → `LoroText.update` → merge), never against latest. Base frontiers travel with the exported file. |
| Editor | CodeMirror 6 + `loro-codemirror`; live Markdown/MDX styling; decorations for dim, lint underlines, alternative markers; block widgets for MDX components. |
| Grammar/style | Harper (`harper.js`, WASM, on-device) + rule-based checks (Hemingway-style: long sentences, passive, adverbs, simpler words; bold mid-sentence; long bullets; MDX prop schema checks). Review notes that recur are promoted into rules. |
| AI | One provider interface: on-device (WebLLM/WebGPU; Chrome Prompt API when present; Tauri plugin for llama.cpp / Apple Foundation Models) and OpenAI-compatible endpoint (Ollama or cloud). Instant rule layer needs no model. |
| Agent-first | A typed **operations layer** in core (`doc.read` → MDX + frontiers; `doc.apply` with base frontiers; `alt.propose`, `ghost`, `stash`, `lint`, `comment`, `deps.add`, `blocks.list`, `share`, `component.*`). CLI (`composed …`), stdio MCP (`composed mcp`) and remote MCP on the server are thin layers over the same operations. Default agent edit mode is *propose* (lands as alternatives). |
| Shells | Tauri 2 desktop first (macOS); web app for editor + preview/comment pages; Tauri mobile later. |
| Sync server | Self-hostable single binary/container (Node/Bun + loro-crdt + SQLite; Postgres optional). Accounts; device tokens; store-and-relay of Loro updates; the base-version diff import path; preview links (capability token, pinned frontiers or live, optional expiry/password/revoke) rendering MDX to HTML with dim/stash omitted by default; reviewer comments anchored by cursors in a separate container/doc, carrying the author's targeted questions. Server may read documents (no E2E encryption in v1). |
| Components | Every component is a package from day one: `composed:<user>/<name>@<version>`, its own Loro doc (files, `defineBlock` manifest with props schema, kind block/inline, editor presentation, `fallback` Markdown, own dependencies). Unlisted until "promoted" (listed); no move on promote. Dev builds get `0.1.0-dev.<hash>`; semver publish is explicit. Post dependencies = direct deps + roll-up of component deps, locked per document. |
| Delivery | **Module Federation 2** (`@module-federation/runtime`, `@module-federation/vite`) at runtime in production — no vendoring. Versioned immutable URLs behind a CDN. `react` shared singleton. Server bundles each component version (Rolldown), keyed by source+lock hash. `defineBlock.fallback` is the SSR/prerender output; the remote swaps in client-side (also covers RSS, no-JS and a failed remote). Live update: server pushes "new version", host re-registers the remote. |
| Host integration | `@composedink/host-runtime` (framework-agnostic remote loading) and `@composedink/host-tanstack` (plugin + `<Block>` resolver + fallback SSR). hellotimber adds one dependency and a few lines; posts move to `<slug>/index.mdx` folders. `examples/host-tanstack` is the MF spike and later the integration package's fixture. |
| Toolchain fallback | Spike MF on Vite 8 + `@module-federation/vite` (1.23.x declares Vite ^8). If the host can't load a remote or prerender, switch the example to TanStack Start's Rsbuild plugin (`@tanstack/react-start/plugin/rsbuild`, present in 1.169). Rolldown 1.3 has **no** built-in MF plugin. |
| Security | Account components are code: render them in a sandboxed iframe on a separate `usercontent` origin; never in the editor's or server's own context. |

### Proposed workspace layout (candidates may restructure with justification)

```
packages/
  core/          document model, package map, base-version apply, operations layer
  blocks/        defineBlock, manifest schema, resolver → import map, built-in std blocks
  editor/        CodeMirror 6 + loro-codemirror + widgets + alternatives UI
  preview/       preview-host protocol + generic host
  lint/          harper.js + rules + block prop checks
  protocol/      sync, auth, share-link, registry types
  ai/            provider interface
  host-runtime/  remote loading on @module-federation/runtime
  host-tanstack/ TanStack Start integration
apps/
  cli/  desktop/  web/  server/
examples/
  host-tanstack/
```

## Consumer workflows (the plan must make these direct)

1. **Capture an idea on the phone, grow it on the laptop.** `composed new idea "…"` or the
   mobile app; it syncs; on the laptop it becomes a post with a manifest.
2. **Edit prose with alternatives.** Select a sentence, ask for rewrites (local model or
   agent), flip through them in place, keep one, ghost the rest or stash them.
3. **Agent edits safely.** An agent runs `composed cat post` (gets MDX + frontiers), edits,
   `composed apply post --base <frontiers> --propose`; its changes appear as alternatives,
   never overwrite concurrent edits.
4. **Agent builds a component.** `component.create` → edit files → `component.check`
   (typecheck + props schema) → `component.render` (sandboxed render with sample props;
   returns errors, console, screenshot) → used in the post as `<RetryChart … />`.
5. **Preview on the real blog.** The post renders through the host integration in
   hellotimber's dev server with the real layout; editing component code hot-updates the
   open preview.
6. **Share for feedback.** `composed share post --pin` → link with targeted questions;
   reviewers comment on selected text; comments appear beside the right words in the editor.
7. **Publish.** `composed export post --to …/website/content/writing/`; the published blog
   loads components at runtime via MF with SSR fallbacks.

## MVP definition (to be refined by the plan)

The smallest end-to-end product Lachlan would use daily for his own blog: workflows 2, 3, 5
and 7 on a single device, with 1 (sync) and 6 (sharing) following. The plan must express a
**tracer bullet** — the thinnest slice touching every layer (document → editor → block →
host → published post) — before widening any layer.

## Excluded from v1

End-to-end encryption; real-time multi-writer co-editing (single writer, many devices);
plagiarism/AI-text detection; Windows/Linux desktop polish; npm-registry-compatible publishing
of components to third-party blogs (a later addition).

## Open decisions

- Scope-to-server resolution for `composed:` IDs across self-hosted servers (host in the ID,
  or scope→registry config).
- Whether federated SSR is used when the spike proves it, or fallback-only SSR always.
- Mobile shell: Tauri mobile vs Expo with DOM components.
