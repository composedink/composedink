# composed

A local-first, agent-first writing tool for building ideas into blog posts. Alternatives at the
word, sentence and paragraph level (flip through them in place), dimmed text, a stash, on-device
grammar and style checks, and MDX components that are packages from day one, delivered to the
published blog through Module Federation at runtime.

- Site: `composed.ink` · npm scope `@composedink` · GitHub `composedink` · CLI `composed`
- Component IDs: `composed:<scope>/<name>@<version>`

## Status

Design and planning. Nothing is implemented yet.

- `docs/design/grounding.md` — what was decided before design began
- `docs/design/composed.md` — the design package
- `docs/design/arena-decision.md` — how the design was chosen and reviewed
- `docs/plans/README.md` — the implementation plan index; plan 01 is the tracer bullet

## Toolchain

Tooling is managed by [mise](https://mise.jdx.dev) via `.config/mise.toml` (Node 22 + the
Vite+ CLI `vp`). Never install tools globally.
