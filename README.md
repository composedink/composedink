# composed

A local-first, agent-first writing tool for building ideas into blog posts. Alternatives at the
word, sentence and paragraph level (flip through them in place), dimmed text, a stash, on-device
grammar and style checks, and MDX components that are packages from day one, delivered to the
published blog through Module Federation at runtime.

- Site: `composed.ink` · npm scope `@composedink` · GitHub `composedink` · CLI `composed`
- Component IDs: `composed:<scope>/<name>@<version>`

## Status

MVP complete (2026-11-06): studio and editor, alternatives/dim/stash, Harper lint, model
rewrites, component authoring with live preview, immutable artifact server, release locks,
macOS desktop app, and deployment. `@composedink/{blocks,host-runtime,host-tanstack}@0.1.0` are
on npm; the artifact server runs at `https://cdn.composed.ink` (staging:
`https://composedink-staging.devbox.party`). Phase 1.5 (writing process, plans 13–15) complete 2026-11-06: document kinds and rulesets, zen mode, edit measurements with a sentence-length sparkline, anchored comment threads and directed model feedback. Next: P2 server session, then shared preview links with guest comments.

- `docs/design/grounding.md` — what was decided before design began
- `docs/design/composed.md` — the design package
- `docs/design/writing-process.md` — phase 1.5: kinds, rulesets, measurements, feedback
- `docs/design/arena-decision.md` — how the design was chosen and reviewed
- `docs/plans/README.md` — the implementation plan index with per-plan status
- `deploy/README.md` — deployment runbook

## Layout

```
packages/core          model, ops registry, authority, publish, bundle
packages/lint          Harper + style rules in a worker
packages/blocks        defineBlock, props schema          (published)
packages/host-runtime  Module Federation remote loading   (published)
packages/host-tanstack remarkComposed + ComposedBlock     (published)
apps/cli               `composed` CLI and `composed mcp`
apps/web               studio editor (Vite)
apps/server            artifact server container
apps/desktop           Tauri shell with bundled sidecar
examples/host-tanstack TanStack Start host on Rsbuild: the integration test
```

## Toolchain

Tooling is managed by [mise](https://mise.jdx.dev) via `.config/mise.toml` (Node 22 + the
Vite+ CLI `vp`). Never install tools globally.
