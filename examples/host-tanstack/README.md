# host-tanstack

TanStack Start on Rsbuild/Rspack. Run `mise exec -- vp run host-tanstack#dev`
from the workspace root; export a post into `content/<slug>/index.mdx` with its sibling lock.
`build` prerenders `/posts/tracer`; `e2e` runs the six-assertion tracer in an isolated copy.

MDX uses `@mdx-js/loader` and `remarkComposed`. The preceding lock loader registers the
sidecar as a dependency so edits recompile fallback Markdown under dev SSR. The host uses
only the MF runtime; component remotes are Rsbuild-built named globals sharing host React.
See [the tracer plan](../../docs/plans/01-tracer-bullet.md) for evidence and contracts.
