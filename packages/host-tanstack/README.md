# @composedink/host-tanstack

Compile exported MDX with `@mdx-js/rollup` and `remarkComposed` from
`@composedink/host-tanstack/remark`. Add `composedLockReload()` from the same
entry to Vite's plugins so lock-only changes recompile sibling `index.mdx`
in both client and SSR environments.

Pass `{ production: true }` to the remark plugin for production preview exports:
they render locked Markdown only and warn with the export command.
The generated MDX imports `ComposedBlock` from the public `./block` entry.
Development loads the remote after hydration, sharing the host React modules.
See the runnable [Start example](../../examples/host-tanstack).
