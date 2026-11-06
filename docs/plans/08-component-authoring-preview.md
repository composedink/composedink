# Plan 08 — Component authoring and live preview

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 03, 05. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** author a real component package, validate it, and see good builds refresh the real example host while failures preserve the last good preview. Widen existing component.read/write; never duplicate them.

**Build contract:** TanStack Start is required. MF hosts use `@tanstack/react-start/plugin/rsbuild`;
component builds use Rsbuild/Rspack + `@module-federation/rsbuild-plugin`, named `var` remotes
loaded as `type: "global"`. Materialization includes the catalogued Rsbuild/React/MF build tools;
sourceHash covers files, generated lock and settings. MDX loaders register sibling locks through
`this.addDependency` for dev SSR invalidation. Vite+ remains tests/lint/format and non-MF apps.

**Files:** `packages/core/src/{bundle,export}.ts`, `src/model/files.ts`, `src/component/{check,workspace,preview}.ts`, tests; `apps/cli/src/component-edit.ts`; `packages/blocks/src/{schema,static-value}.ts`; example authoring e2e. Add TypeScript/materialization dependencies explicitly through catalog.

### Task 1 — Validate/materialize packages

- [ ] Extend component files to arbitrary safe relative modules, package.json dependencies and exact resolver lock. Reject path traversal, symlink escapes and install scripts. Own dependencies are bundled; only react/react-dom/react/jsx-runtime are shared singleton/import:false. Do not roll dependencies up into post deps.
- [ ] Implement component.check: materialize through the authority at `$COMPOSED_HOME/build/<id>/<hash>/` with generated catalog-version react/react-dom/@rsbuild/core/@rsbuild/plugin-react/@module-federation/rsbuild-plugin devDependencies plus @composedink/blocks link, resolve/freeze exact dependencies and pnpm install frozen with --ignore-scripts, typecheck, extract defineBlock literal props/sample/editor/kind, validate schema/sample, and check fallback.ts has no imports/require/dynamic imports. Return positioned diagnostics and manifest; do not import block.tsx to inspect metadata. Ensure defaults are applied before instance hashing.
- [ ] Build twice from the same files/resolutions/settings and assert same sourceHash and equivalent immutable artifacts; changed dependencies alter the hash. Check bad props and non-literal schema fail at file:line. Constrained fallback tests from 01 continue to pass.

### Task 2 — Add file editing and sustained preview

- [ ] `composed component edit <id> <directory>` requires studio, auto-starting `composed studio --headless` if absent; never own inline. It checks out files plus per-file base metadata and watches local saves. Import saved changes through component.write at the recorded base, never overwrite latest. Authority imports trigger a reverse checkout update only when the local file still equals its prior checked-out hash; preserve unresolved local changes and report a conflict. Own write events must not loop.
- [ ] Extend 01's studio-owned component-change/rebuild/evaluate/re-export subscription with file sync and last-good retention. `composed preview` requires studio (auto-start headless), never inline. Studio subscribes to post/component changes and regenerates preview MDX/lock only after build, prop validation and fallback evaluation succeed. Code, fallback and dependency changes produce new immutable dev versions; no mutable overwrite of a loaded remote name.
- [ ] Lock import invalidates the example MDX module; reload the page rather than trying in-place module replacement. Failed check/build/evaluation keeps last good pair and displays diagnostics in CLI/studio. Prose-only changes also re-export. Studio owns port 4848 and subscription lifetime; a detached CLI does not stop the service. Studio never loads remotes in its origin; use the blog/example dev origin (P3 adds editor usercontent). No fs.watch-based multiwriter store.

**Verification:** run `mise exec -- vp run @composedink/core#test`, `mise exec -- vp run host-tanstack#e2e`, `mise exec -- vp run composed-cli#test`. Start component edit with no studio and assert headless auto-start/one service owner; start host dev server: save block.tsx, fallback.ts and a package dependency; host updates within two seconds after a successful save/build in the small fixture. Include a tiny npm dependency with a unique sentinel to prove it is in the remote, not host. Nonliteral props/type error retains old lock/working remote; fix then observes new version. Concurrent file save/authority edit merges at checkout base without data loss. Kill/restart preview and retain last good export.

**Out of scope:** component.render screenshots, untrusted components/iframe protocol, server bundling, published-site push, registry discovery, release upload.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.
