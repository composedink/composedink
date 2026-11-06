# @composedink/host-tanstack

Use TanStack Start's `@tanstack/react-start/plugin/rsbuild` with Rsbuild/Rspack.
Compile exported MDX with `@mdx-js/loader` and `remarkComposed` from
`@composedink/host-tanstack/remark`. Precede the MDX loader with a loader that calls
`this.addDependency` on the sibling `composed.lock.json`: changing the lock must recompile
the fallback Markdown in both client and SSR environments. The example's
`loaders/composed-lock.cjs` shows the complete adapter. Remotes use Rsbuild's MF plugin
with a named `var` library; host-runtime loads remoteEntry.js as `type: "global"`.

Pass `{ production: true }` to the remark plugin for production preview exports:
they render locked Markdown only and warn with the export command.
The generated MDX imports `ComposedBlock` from the public `./block` entry.
Development loads the remote after hydration, sharing the host React modules.
See the runnable [Start example](../../examples/host-tanstack).
