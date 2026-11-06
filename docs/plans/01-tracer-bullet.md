# Plan 01 — Tracer bullet

> **For agentic workers:** work on exactly this plan, task by task. Tick each step and commit
> each verified task. If this plan contradicts the design or a library's real behaviour, stop
> and report the discrepancy; do not improvise. All paths are relative to the composedink root.
> Do not modify hellotimber.

**Goal.** The thinnest slice that touches every layer: a Loro document holding MDX, typed in the
CodeMirror editor served by `composed studio`; one inline component built as the package
`composed:lachieh/hello`; a preview export with the fallback Markdown locked beside the MDX;
a TanStack Start example that prerenders the fallback and swaps in the federated remote in the
browser. Nothing in this plan is proven until the evidence script in Task 5 passes.

**Scope.** Operations `doc.create`, `doc.read`, `component.create`, `component.read`,
`component.write`, `deps.add` (dev pins) and `export` (preview mode); the CLI commands generated
from them (`new`, `cat`, `component create|read|write`, `deps add`, `preview`) plus
`composed studio`. **Not in this plan:** inline authority, lock election and stale recovery
(plan 02); alternatives, `doc.apply`, `doc.import`, MCP (04); dim and stash (05); lint (06);
model rewrites (07); file sync and last-good retention (08); publish, release locks and the
artifact server (09); desktop (11). None of these may appear as a placeholder command or op.

## Task 1 — Scaffold the workspace

**Files:** `.config/mise.toml`, `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`,
`vite.config.ts`, the generated `pnpm-lock.yaml`; a `package.json`, `tsconfig.json`,
`vite.config.ts` and `README.md` for each package and app below; `tests/boundaries.test.ts`.

- [x] `.config/mise.toml` pins an exact Node 22 patch **≥ 22.8** (required by
      `vm.constants.DONT_CONTEXTIFY`, Task 3) and the Vite+ CLI. Never install tools globally.

  ```toml
  [tools]
  node = "22.x.y" # exact patch ≥ 22.8
  pnpm = "11"
  "npm:vite-plus" = "latest"
  
  [env]
  _.path = ["node_modules/.bin"]
  ```

- [x] `pnpm-workspace.yaml` declares the members and a catalog. The versions below are inputs to
      verify, not proven compatible; `vp install` resolves them and the generated lock is
      committed. Add every external dependency a package uses to the catalog and reference it
      with `catalog:`.

  ```yaml
  packages: [packages/*, apps/*, examples/*]
  catalog:
    typescript: ^5.9.0
    vite-plus: "1.5.0" # pin the pair together
    vite: "npm:@voidzero-dev/vite-plus-core@1.5.0" # Vite+ requires `vite` to be its core build
    loro-crdt: ^1.17.0
    loro-codemirror: 0.3.3
    "@module-federation/rsbuild-plugin": ~2.9.0
    "@rsbuild/core": ^2.3.1
    "@rsbuild/plugin-react": ^2.1.0
    "@mdx-js/loader": ^3.0.0
    "@module-federation/runtime": ^2.9.0
    react: ^19.0.0
    react-dom: ^19.0.0
    zod: ^4.0.0
    # resolve and add: @codemirror/{state,view,commands,lang-markdown}, @mdx-js/mdx, remark-mdx,
    # unist-util-visit, mdast-util-from-markdown, ws, @types/{react,react-dom,node,ws},
    # @tanstack/{react-start,react-router,router-plugin}, @vitejs/plugin-react, @playwright/test
    overrides:
    vite: "catalog:"
  peerDependencyRules:
    allowAny: [vite]
    allowedVersions: { vite: "*" }
  ```

- [x] Root `package.json` is private, `"type": "module"`, scripts
      `"test": "vp test run"`, `"tracer": "node --experimental-strip-types tests/tracer.ts"`,
      `"tracer:inspect": "node --experimental-strip-types tests/tracer.ts --inspect-hosts"`.
      Root `vite.config.ts` test block includes `tests/**/*.test.ts` only; `tests/tracer.ts` is
      a script, not a test module.
- [x] Root `tsconfig.json`: `target ES2022`, `module ESNext`, `moduleResolution Bundler`,
      `strict`, `noEmit`, `allowImportingTsExtensions`, `skipLibCheck`; includes root `tests`
      only. Each package's `tsconfig.json` extends it with
      `"include": ["src", "tests", "vite.config.ts"]` (adjusted to what the package has); React
      packages add `"jsx": "react-jsx"` and `lib: ["ES2022", "DOM", "DOM.Iterable"]`; Node
      packages add `"types": ["node"]`. Never alias sibling source paths.
- [x] Every library package has this shape (name, exports and deps substituted). No `build`
      script, no `main`/`types`; React is a peer **and** dev dependency where used. Public
      packaging with `vp pack` arrives in plan 09.

  ```json
  {
    "name": "@composedink/blocks",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": { ".": "./src/index.ts", "./package.json": "./package.json" },
    "scripts": { "test": "vp test run" },
    "devDependencies": { "typescript": "catalog:", "vite-plus": "catalog:" }
  }
  ```

| Directory / name                                        | Public entries                                                                            | Internal deps                   | Minimal contract in this plan                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` · `@composedink/core`                   | `.` → `src/index.ts` (pure reads/types); `./node` → `src/node.ts`                         | blocks                          | `openStore`, `bind`, authority lifecycle, the ops above                                                                                |
| `packages/blocks` · `@composedink/blocks`               | `.` → `src/index.ts`                                                                      | —                               | `defineBlock`, `PropsSchema`, `PropsOf`, `validateProps`, `staticValue`, `SHARED_SINGLETONS`, `ExportLock`, `LockedBlock`, `parseLock` |
| `packages/host-runtime` · `@composedink/host-runtime`   | `.` → `src/index.ts`                                                                      | blocks                          | `blockLoader(shared).load(lockedBlock)`                                                                                                |
| `packages/host-tanstack` · `@composedink/host-tanstack` | `./remark` → `src/remark.ts`; `./block` → `src/block.tsx`                                 | blocks, host-runtime            | `remarkComposed`, `ComposedBlock`                                                                                                      |
| `apps/cli` · `composed-cli`                             | `bin.composed` → an executable launcher that runs Node with TS stripping on `src/main.ts` | core/node, blocks, web (assets) | `composed studio`, generated commands                                                                                                  |
| `apps/web` · `composed-web`                             | app (may build)                                                                           | core (browser entry), blocks    | the editor page binding `mdx`                                                                                                          |
| `examples/host-tanstack` · `host-tanstack`              | app                                                                                       | host-tanstack, blocks           | the real TanStack Start host                                                                                                           |

- [x] `tests/boundaries.test.ts` walks every `import`/`export … from`/`import()` specifier and
      asserts: only the edges in the table (plus `core → blocks`, `host-tanstack → host-runtime`,
      `cli → web`); no relative path escapes a package; no deep import of another package's
      `src` (exports maps reject them too); mutating Loro calls on `mdx`/`files`
      (`insert|delete|update|mark|unmark|applyDelta`) appear only under `packages/core/src/model/`
      and `apps/web/src/editor/sync.ts`; `packages/core/src/store/` persists files and never
      mutates documents. Include a fixture `tests/fixtures/forbidden-import.ts.txt` and prove the
      test fails on it.

## Task 2 — Prove the binding, then the studio authority

**Files:** `packages/core/src/{index,node,authority}.ts`, `src/model/{keys,text,files,deps,read}.ts`,
`src/store/store.ts`, `src/ops/registry.ts`, `tests/{store,ops}.test.ts`;
`apps/cli/src/{main,client,studio}.ts`; `apps/web/{index.html,src/main.tsx,src/editor/sync.ts}`,
`apps/web/tests/binding.test.ts`.

- [x] **Binding spike first (R2).** With `loro-codemirror` 0.3.3, import into the editor's doc
      (a) a batch containing a non-text container event before the `mdx` text event and (b) a text
      event for a different container before `mdx`. After each, assert the CodeMirror state equals
      `doc.getText("mdx").toString()`. The upstream plugin ignores `by: "local"` events
      (`sync.ts` ~42) and returns on the first non-text diff (~65) and on a wrong-target text diff.
      If either case desynchronises, keep one corrected plugin in `apps/web/src/editor/sync.ts`
      that _continues_ scanning the batch, keeps the undo manager and the single text sync path,
      and record the version plus an upstream issue link. Never add a second sync listener.
      Vite must not pre-bundle Loro: set `optimizeDeps: { exclude: ["loro-crdt", "loro-codemirror"] }`
      wherever Vite serves it (the probe's dev server and the studio's `apps/web` middleware);
      pre-bundling breaks the WASM import with `Cannot read properties of undefined (reading 'memory')`.
- [x] `core/src/model/keys.ts` is the only list of container names: post `meta`, `mdx`, `deps`;
      component `meta`, `files`. Frontmatter lives inside `mdx`. `doc.read` returns base64url
      `encodeFrontiers`, the text, and empty `dim`/`alts`/`blocks` arrays where nothing exists
      (real absence, not fake ops).
- [x] **Store.** `$COMPOSED_HOME/docs/<docId>/snapshot.loro` plus `updates/<n>.loro`, written only
      by the studio authority with temp file → `fsync` → rename before any acknowledgement. No
      `fs.watch`, no per-peer files, no compaction yet.
- [x] **`composed studio`** is the authority in this plan. It serves: the editor UI (Vite dev
      middleware for `apps/web` in development; built assets when packaged), the operations
      WebSocket on `127.0.0.1:4747`, the immutable artifact server on `127.0.0.1:4848` with CORS,
      and the preview subscription (next task). It writes `workspace.lock` with
      `{pid, processStartTime, kind: "studio", socket, ready}` via temp file + `link()` so a crash
      can't leave an empty lock. Every other CLI command connects to the socket; if no studio is
      running it exits with `fix: composed studio`. **No election, inline owner or stale-lock
      recovery ships here** (plan 02).
- [x] **Operations registry.** `core/src/ops/registry.ts` defines each op once: name, Zod input,
      mutation flag, CLI mapping, run. The CLI command list and socket validation are generated
      from it; it lists only the ops in this plan's scope. The authority runs ops on one
      serialized queue. Socket frames: `{doc, bytes, seq}` for binding updates; `{request, name,
      input}` for ops; acknowledgements carry the durable head. Loopback sessions carry an
      ephemeral token issued at page load and an `Origin` check; the token never reaches
      component code.
- [x] **Typing path.** The editor streams binding updates unchanged; the authority imports them
      unchanged, then runs the normalization hook (only `mdx`/`deps` invariants exist yet — do not
      invent alternative handling), persists, then broadcasts and acknowledges. A disconnected
      editor keeps unacknowledged updates and replays them; Loro's import is idempotent.
- [x] `component.write --base <frontiers> --file <relative path>` reads stdin, applies to a fork at
      `base`, merges through the model. Reject absolute paths, `..` and symlink escapes.
      `new post <slug>` creates an empty document; the tracer types the frontmatter and body in
      the editor. `new --from <file>` arrives with `doc.apply` in plan 04.
- [x] **Preview subscription (minimal).** When a component document changes, the studio rebuilds
      it (Task 3), evaluates fallbacks, and regenerates the preview pair of every post pinned to
      that component `@dev` and previously exported in this session. Plan 08 adds last-good
      retention and two-way file sync. The studio never loads remotes in its own origin; the live
      preview is the example/blog dev server on its own origin (P3 adds the usercontent sandbox).

## Task 3 — Blocks, the build, and export with locked fallbacks

**Files:** `packages/blocks/src/{index,schema,static-value,lock}.ts`, `tests/{schema,lock}.test.ts`;
`packages/core/src/{bundle,export}.ts`, `src/model/{projection,component-template}.ts`,
`src/fallback/{worker,evaluator}.ts`, `tests/{bundle,fallback,export}.test.ts`.

- [x] Implement the design's `defineBlock`, `PropSchema`/`PropsSchema`, `PropsOf`,
      `validateProps`, `staticValue`, `SHARED_SINGLETONS`, `ExportLock`, `LockedBlock`,
      `parseLock`. Manifest data (`kind`, `props`, `sample`, `editor`) is extracted from the
      literal AST of `block.tsx` (Rolldown `parseAst`); block.tsx is never executed. Reject
      expressions, unknown keys and non-finite numbers.
- [x] `component.create` writes the template files into the component's `files` map, including
      `package.json`. For the tracer the template is `composed:lachieh/hello`:

  ```tsx
  // block.tsx
  import * as React from "react";
  import { defineBlock } from "@composedink/blocks";
  import fallback from "./fallback";
  function Hello({ name }: { name: string }) {
    const [n, setN] = React.useState(0);
    return (
      <button onClick={() => setN(n + 1)}>
        Hello {name}; clicked {n}
      </button>
    );
  }
  export default defineBlock({
    kind: "inline",
    props: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    sample: { name: "Lachlan" },
    component: Hello,
    fallback,
  });
  // fallback.ts — no imports, require or dynamic import (build-checked)
  export default ({ name }: { name: string }) => `Hello, **${name}**.`;
  ```

- [x] **Build.** The authority materializes `$COMPOSED_HOME/build/<id>/<sourceHash>/` with the
      component files and a generated `package.json` whose devDependencies are `react`,
      `react-dom`, `@rsbuild/core`, `@rsbuild/plugin-react` and `@module-federation/rsbuild-plugin` at the catalog versions and `@composedink/blocks` as `link:<path>` to the
      workspace package (the path comes from the authority's own install location; plan 09/12
      switch this to the published npm version). Resolve the lock first with
      `pnpm install --lockfile-only --ignore-scripts`, include the generated `pnpm-lock.yaml` in
      the build inputs (so `sourceHash` covers exact resolutions), then install with
      `pnpm install --frozen-lockfile --ignore-scripts`, and build with Rsbuild's `createRsbuild` programmatic API
      plus `@module-federation/rsbuild-plugin`: `exposes: { "./block": "./block.tsx" }`, remote name
      derived from `(id, version)`, shared `react`, `react-dom`, `react/jsx-runtime` as singletons
      with `import: false`, `requiredVersion: false`; every other dependency is bundled.
      Emit a `var` library named after the remote, and register remoteEntry.js with `type: "global"` in host-runtime. Version is `0.1.0-dev.<hash>` where
      the hash covers sorted file bytes, the exact dependency resolutions and the build settings.
      The host supplies all three singleton modules (Task 4); remote builds include no React implementation.
- [x] **Fallback evaluator.** `fallback.ts` is rejected if its module graph has any import,
      `require` or dynamic import. Evaluation runs in a `node:worker_threads` Worker that creates
      a `vm` context with `vm.constants.DONT_CONTEXTIFY`, `codeGeneration: { strings: false,
      wasm: false }`, `microtaskMode: "afterEvaluate"`, no host objects or functions bridged in,
      props passed as a JSON string and reconstructed inside the context, 1 s timeout (the Worker
      is terminated), 256 KiB output cap. Tests must prove these are denied: `process`,
      `require`, `fetch`, `this.constructor.constructor("return process")()`,
      `({}).constructor.constructor(...)`, `Error.prepareStackTrace`,
      `Function.prototype.constructor`, a sync infinite loop, an async infinite loop. (A plain
      `vm.createContext` is escapable through the constructor chain; `DONT_CONTEXTIFY` makes it
      throw.) This contains the author's own code; P3 adds a process/origin boundary for
      untrusted code. An escape blocks completion.
- [x] **Preview export.** Validate each block usage's literal JSX props, apply schema defaults,
      hash the canonical sorted JSON, evaluate the fallback per distinct instance and write
      `instances[<hash>] = { props, markdown }`. Lock fields: `composed: 1`, `mode: "preview"`,
      `doc`, `base`, `view: "full"`, `sha256` of the exact UTF-8 MDX (used only by composed to
      detect outside edits — never by the host), and per block `id`, exact `version`, `kind`,
      absolute `entry` URL on port 4848, `sourceHash`, `props` schema, `instances`. Write an export
      intent `{target, oldHashes, newHashes}` before renaming `index.mdx` then
      `composed.lock.json`. Outside-edit import and recovery arrive in plans 04 and 09.

## Task 4 — Host runtime, remark plugin and the example

**Files:** `packages/host-runtime/src/index.ts`, `packages/host-tanstack/src/remark.ts`,
`packages/host-tanstack/src/block.tsx`, tests beside each;
`examples/host-tanstack/{package.json,rsbuild.config.ts,src/router.tsx,src/routes/__root.tsx,src/routes/posts.$slug.tsx,fixtures/tracer.mdx}`.

- [x] `blockLoader(shared)` creates one `createInstance({ name: "composed_host", remotes: [],
      shared })` per page, `registerRemotes` once per `(id, version)` name, then
      `loadRemote(\`${name}/block\`)`. The host passes the three real module objects; the runtime
      imports no React.
- [x] `ComposedBlock` renders `<span|div data-composed={id} data-state="fallback">{children}</…>`
      identically on the server and at hydration, loads the remote after mount, and renders it with
      `data-state="remote"`. A load or render error (error boundary) keeps the fallback, sets
      `data-state="failed"` and logs one `console.warn` naming id and version.
- [x] `remarkComposed` reads the sibling `composed.lock.json` only. For each JSX element whose
      tag is in `lock.blocks`: evaluate props with `staticValue`, apply defaults, hash, and require
      the hash in `instances`; otherwise fail at `file:line` with `composed export <doc>`. It
      **never** verifies a whole-file MDX hash (hellotimber's formatter rewrites MDX on commit).
      It parses the instance Markdown to mdast with raw HTML/MDX disabled, rewrites the element to
      `<ComposedBlock use={_lock.blocks.Tag} props={…}>…</ComposedBlock>`, and injects
      `import _lock from "./composed.lock.json"` and the `ComposedBlock` import. Tags not in the
      lock pass through untouched. In a production build a `mode: "preview"` lock renders the
      fallback only (no remote registration) and emits one build warning naming the post and the
      fix command — it never fails the build.
- [x] Register the sibling lock as an MDX loader dependency using `this.addDependency(lockPath)`
      before `@mdx-js/loader`; the injected JSON import alone does not recompile Markdown literals.
      Verify a lock-only change invalidates the MDX module under Rsbuild dev SSR (R3).
- [x] The example registers `/posts/$slug`, compiles folder MDX with `@mdx-js/loader` +
      `remarkComposed`, and enables prerendering of `/posts/tracer` using the installed TanStack
      Start API (verify the option name against the installed version rather than assuming). The
      committed `fixtures/tracer.mdx` is a template only: the tracer copies the example into the
      temp home and exports into that copy; `content/tracer/index.mdx` is never committed.
      Scripts: `dev: rsbuild dev --host 127.0.0.1`, `build: rsbuild build`, `e2e` (runs the root tracer).
      With no unit tests, omit the example test script/config; recursive workspace tests skip it.
      Use `@tanstack/react-start/plugin/rsbuild` and `pluginReact`, plus `import.meta.webpackContext`
      for eager MDX discovery. Track an empty content directory marker so unexported builds resolve.
      Filter prerender to `/posts/tracer`: Start otherwise adds a root page returning 404.

## Task 5 — Collect executable evidence

- [x] All six assertions, production/module/asset evidence, screenshots and final gates pass.

**Files:** `tests/tracer.ts` (orchestrator), `examples/host-tanstack/tests/tracer.spec.ts`
(Playwright), test-only React identity instrumentation in the example and the template.

```ts
// tests/tracer.ts — outline; implement helpers, no shell sleeps.
const home = await mkdtemp(join(tmpdir(), "composed-tracer-"));
const example = await copyExample(home); // temp copy of examples/host-tanstack
const studio = await spawnReady("studio", { home, ports: await freePorts(2) });
await cli(["new", "post", "tracer"], { home });
await cli(["component", "create", "lachieh/hello", "--kind", "inline"], { home });
await cli(["deps", "add", "tracer", "Hello", "composed:lachieh/hello@dev"], { home });
// Playwright types the source in the studio editor; `composed preview tracer --to <example>/content`;
// build + serve the example; run the assertions with JS on, JS off, and remote requests blocked.
```

The harness owns child processes, the temp home, random free ports and teardown in `finally`;
`--inspect-hosts` leaves the studio and example running for a human. It spawns the real CLI
through `process.execPath` with TS stripping. To be proven by `mise exec -- vp run host-tanstack#e2e`:

1. Typing `<Hello name="Lachlan" />` in the studio editor is visible to `composed cat tracer` in a
   separate process, and still after the studio is restarted.
2. The exported `index.mdx` equals `cat` byte for byte; the lock has `blocks.Hello` with a real
   `0.1.0-dev.*` version, the schema, and one instance whose markdown is `Hello, **Lachlan**.`.
3. After `vp run host-tanstack#build`, the prerendered `/posts/tracer` HTML — fetched with JS off —
   contains `<span data-composed="composed:lachieh/hello" data-state="fallback">Hello,
   <strong>Lachlan</strong>.</span>`, and the server's module trace imported no component or
   fallback code.
4. With JS on, `[data-state="remote"]` appears and two clicks show `clicked 2`. The test-only
   remote exports its React identity and the host sets `window.__composedReactIdentity`; assert
   strict equality, and that the loaded assets contain no second React implementation and the
   host bundle contains no `Hello` implementation sentinel.
5. With `**/remoteEntry.js` routed to 404, the fallback remains, `data-state="failed"` is set, and
   exactly one warning is logged.
6. Piping a changed `fallback.ts` through `composed component write` makes the studio rebuild and
   re-export; the example dev server's SSR response for `/posts/tracer` changes within 2 s with no
   restart.

Run, in order: `mise install`, `mise exec -- vp install`, `mise exec -- vp check --fix`,
`mise exec -- vp run -r test`, `mise exec -- vp run host-tanstack#build`,
`mise exec -- vp run host-tanstack#e2e`. Keep the assertion output, the resolved version matrix
and screenshots as test artifacts.

## Toolchain decision

TanStack Start is required. All MF hosts and remotes use Rsbuild/Rspack; remotes use
`@module-federation/rsbuild-plugin`. Vite+ remains for tests/lint/format and non-MF apps.
The Vite MF spike worked but is no longer used (Lachlan, 2026-11-05). If the selected
libraries contradict these contracts, record logs and stop; do not revert to Vite MF.

## Out of scope

No iframe isolation (every component is the author's own). No hellotimber edits or deployment.
No command, op or service placeholder for a later plan.

## Implementation log

**2026-11-05, stop 1 (resolved).** Task 1 scaffold committed as `c27e543`. The Task 2 browser
spike failed before its assertions with `Cannot read properties of undefined (reading 'memory')`
— Vite's dependency pre-bundling of `loro-crdt` (stack inside `node_modules/.vite/deps/`), not
Loro itself. Resolution: `optimizeDeps.exclude` (now in Task 2). Task 3's build recipe asked for
`--frozen-lockfile` with no lockfile source and no resolution for `@composedink/blocks`.
Resolution: `--lockfile-only` first, lock in the build inputs, `link:` to the workspace package
until plans 09/12 (now in Task 3).

**R2 reproduced.** With the other container's event ordered before `mdx` in one import batch
(the fixture creates and writes that container first), `loro-codemirror` 0.3.3 leaves the editor
at `before` while Loro holds `before after`, for both a map event and a text event on another
container (`test-results/r2.json`). The corrected sync plugin in `apps/web/src/editor/sync.ts`
is therefore required, with this probe as its regression test.

**2026-11-05, stop 2 (toolchain discrepancy).** The corrected single-subscription R2 binding
is in `apps/web/src/editor/sync.ts`, with an UndoManager and upstream references
https://github.com/loro-dev/loro-codemirror/pull/27 and
https://github.com/loro-dev/loro-codemirror/issues/24. Both mixed-container Chromium cases
pass (`mise exec -- vp run composed-web#test`, 1 test passed; `test-results/r2.json`). The
binding-only `vp check --fix` passes without warnings (`test-results/r2-check.log`).

Tasks 2–4 have partial, uncommitted implementations; none is marked complete. Store restart,
component base writes, real federation bundle/export and evaluator escape tests run. The final
`mise exec -- vp run -r test` reports 8/8 workspace tasks successful (core 16 tests, blocks 2,
web 1, root boundaries 2); packages without tests still use the scaffold's passWithNoTests.
This is not tracer acceptance. Full `vp check --fix` fails on the unfinished host types,
including its not-yet-generated route tree and Vite plugin type incompatibility; see
`test-results/check.log`. Evaluator tests exposed Oxc removing unused imports before validation;
the implementation now checks the original source AST before using transformed code.

Stopping command: `mise exec -- vp run host-tanstack#build`.
Output: `Invalid vite task command: vp with args ["build"]` and
`Expected @voidzero-dev/vite-plus-core@1.5.0, but found vite@8.3.5 ... Run vp migrate to align
the Vite alias, then run vp install.` Full output: `test-results/toolchain-build.log`.
The installed independent Vite dependency in the Task 1 catalog contradicts Vite+'s build
requirement. No dependency migration was attempted because the plan permits fallback only
for R1 remote-loading/prerender failures. Resolve the catalog/Vite+ alias contract in the plan
before resuming. `mise exec -- vp env doctor` also rejects the workspace-local CLI with
`The env command is only available in the global vp CLI` (`test-results/env-doctor.log`).
Versions: Node 22.22.3, Vite+ 1.5.0, Vite 8.3.5, Rolldown 1.2.16,
@module-federation/vite 1.23.9, @tanstack/react-start 1.169.4, loro-crdt 1.17.1,
loro-codemirror 0.3.3. Setup `mise install` and `mise exec -- vp install` succeeded.
No six-assertion tracer evidence has been collected; R1 and R3 remain untested.
`host-tanstack#e2e` has not run: the tracer is not implemented. The template/build and
export subscription currently have focused test evidence, but CLI/browser/restart/security
integration and the packaged asset path remain to be completed/verified. No hellotimber file
was changed. Only the verified R2 slice and this log are committed; partial source stays in
the working tree for the next run.

**2026-11-05, stop 2 (resolved).** `vp run host-tanstack#build` rejected an independent
`vite@8.3.5`: Vite+ requires `vite` to resolve to `@voidzero-dev/vite-plus-core` at the same
version as `vite-plus`. Resolution (hellotimber's pattern, now in Task 1): catalog
`vite: npm:@voidzero-dev/vite-plus-core@1.5.0`, `vite-plus: 1.5.0`, `overrides.vite: catalog:`,
`peerDependencyRules.allowAny: [vite]`. After `vp install` the example builds and `vp run -r test`
is 8/8. `vp env doctor` is global-CLI only; ignore it in this workspace.

**2026-11-05, stop 3 (R1, after both permitted fallbacks).** Resumed the inherited source;
fixed its host TypeScript errors, the mismatch in remote-name hashing (`id + version` in the
builder versus `id + "@" + version` in the loader), and studio's rejection of `/?doc=tracer`.
Added the packaged studio asset path and a real `tests/tracer.ts` harness. The harness creates
an isolated example and home, types into CodeMirror, invokes the CLI in separate processes,
restarts studio, exports, builds/prerenders, and drives Chromium. No hellotimber files changed.

Command: `mise exec -- node --experimental-strip-types tests/tracer.ts` (three host variants).
Runtime-only Vite host: build/prerender succeeded; fallback SSR and remote interaction worked,
but `window.__composedReactIdentity === window.__composedRemoteReactIdentity` returned `false`.
The remote gets test-only React identity instrumentation through `component.write`; the copied
host router gets the host identity instrumentation. Two clicks reached `clicked 2` before the
identity assertion. Log: `test-results/r1-runtime-only.log`.

First permitted fallback: example host `@module-federation/vite`, three singleton shares,
`hostInitInjectLocation: "entry"`. Prerender failed: `ERR_MODULE_NOT_FOUND` for
`dist/server/server.js`; federation emitted `dist/server/assets/server-<hash>.js` instead.
Log: `test-results/tracer-host-plugin.log`.

Verified installed `@tanstack/react-start@1.169.4` exports `./plugin/rsbuild`; applied the
second permitted fallback **only to the example host** using `@rsbuild/core@2.3.1`,
`@rsbuild/plugin-react` and `@mdx-js/loader`. Remotes remain Vite-built. The installed Start
prerender API accepts `prerender.filter`; filtering to `/posts/tracer` prevents its generated
root page from failing with 404. Rsbuild builds and prerenders one page successfully, serves
fallback SSR, loads the remote and reaches `clicked 2`, but the strict React identity assertion
still returns `false`. Stopped as required by Toolchain fallback; no further workaround was
attempted. Log: `test-results/tracer-rsbuild.log`. The example remains on this last attempted
fallback, with its Vite config retained for tests only.

Evidence so far: assertions **1 and 2 pass** (typing → separate CLI → studio restart; exact MDX
and real version/schema/instance). Assertion 3 has dev SSR fallback and successful production
prerender evidence, but lacks the complete no-component-import trace/production fetch check.
Assertion 4's interaction subcheck passes; its strict React identity subcheck **fails**.
Assertions 5 and 6 were not reached; **R3 is untested**. Chromium's screenshot calls timed out
waiting for capture even though DOM assertions and forced pointer clicks worked; no screenshot
is claimed. The harness currently bounds those attempts and logs their failures. Task 5 remains
incomplete; the spec helper, full bundle/trace checks, screenshot evidence and final assertion
accounting still need finishing after R1 is resolved. Tasks 2–4 also remain uncommitted and
unticked pending complete acceptance. No completed-task implementation commit is claimed.

The harness runs with mise's Node 22.22.3. Vite+'s task/child runtime independently selected
Node 26.12.0 in some logs despite the mise pin; the example e2e script now explicitly invokes
`mise exec -- node` to retain Node 22 for the authority/evaluator. Version matrix:
`test-results/versions.json` (regenerated after Rsbuild installation).

Final gates for stop 3: `mise exec -- vp check --fix` passes (53 files, no warnings/errors);
`mise exec -- vp run -r test` passes (8/8 workspace tasks); `mise exec -- vp run
host-tanstack#build` passes and prerenders one page. The requested `mise exec -- vp run
host-tanstack#e2e` was also attempted after those gates, but Chromium closed during the initial
studio navigation (`page.goto: Target page, context or browser has been closed`), before its
assertions. This final runner failure is separate from the reproducible direct tracer R1
failure documented above. Logs: `test-results/stop3-{check,tests,build,e2e}.log`.
`test-results/assertions.json` preserves cross-run assertion accounting; do not mistake the
last attempt's empty `tracer.json` for the earlier successful assertion evidence.
Checked individual store/template/evaluator/export steps have focused tests; their enclosing
tasks remain incomplete and have no implementation commit. All inherited and new partial
implementation remains in the working tree for the next run.

**2026-11-05, stop 3 resolved.** The failed R1 assertion compared module namespace
objects; federation re-exports the host module, so namespaces differ while its functions
are shared. The corrected test compares `useState` and `createElement`. The example is
back on runtime-only Vite + TanStack Start with Rollup MDX and `import.meta.glob`;
neither host federation nor Rsbuild is required.

**Task 2 verified.** Completed the inherited authority, durable store, scoped operation
registry, CLI, authenticated editor stream and preview subscription. Restart persistence
and independent CLI reads pass tracer assertion 1; exact export passes assertion 2.
Store/ops/export and R2 binding regressions pass in the workspace suite.

**Task 3 verified.** Completed block schemas/static props/locks, literal manifest
extraction, frozen-lock federation builds, worker/VM fallback evaluation and preview
export refresh. The remote build now explicitly uses production JSX and an empty
bootstrap entry: inheriting studio's development environment had bundled an unshared
`react/jsx-dev-runtime` (and the direct block entry also emitted React). The build
regression runs under development NODE_ENV and rejects any bundled React implementation.
Workspace tests pass, including evaluator escape/resource denial cases, locked export
refresh and lock validation. Tracer assertions 2–4 confirm real artifacts and fallback HTML.

**Task 4 verified.** The runtime-only Vite/Start example prerenders /posts/tracer.
The loader shares host React functions; hydration swaps the fallback for the real
interactive remote, and blocked remote loading preserves fallback with one warning.
A lock-only change reproduced stale compiled Markdown despite the injected import.
The allowed `composedLockReload()` Vite plugin now invalidates sibling MDX in each
environment. The tracer's lock-only SSR regression failed before this plugin and
passes with it (`test-results/lock-only-ssr.html`); no server restart is needed.
Production module membership is recorded in `server-module-trace.json`.

**Task 5 verified (2026-11-05).** All six assertions pass in the same successful
`mise exec -- vp run host-tanstack#e2e` run. Final output:
`{"1":true,"2":true,"3":true,"4":true,"5":true,"6":true,"6-ms":595.5895830000009}`
(additional interaction/identity/dev SSR subchecks also pass).
Evidence accounting is `test-results/assertions.json`, with durable-read/export fixtures,
production prerender HTML, server module membership, loaded asset membership, warning
accounting and the updated/lock-only SSR HTML. Screenshots:
`production-fallback.png`, `fallback.png`, `remote.png`, `failed.png`.
Resolved versions: `test-results/versions.json`.

The first-navigation browser closure was not a page/context lifetime error:
`test-results/browser-debug.log` records headless shell GPU subprocesses failing to find
`icudtl.dat`, followed by SIGTRAP. A forced Playwright browser reinstall did not repair
that headless-shell failure. The full Chromium channel passes navigation and screenshot
capture (`browser-smoke.png`); the harness explicitly selects that channel. Screenshots
use `page.screenshot` with a 10 s timeout and preserve failure text if capture fails.
The harness owns process groups and terminates descendants before removing its temp home;
asset listeners stop before teardown to avoid reads against closed contexts.

Final gates: `vp check --fix` passes without lint/type warnings or errors; `vp run -r test`
passes 8/8 tasks (core 16, blocks 3, boundaries 2, browser binding 1);
`vp run host-tanstack#build` passes and prerenders one page; `vp run host-tanstack#e2e`
exits 0 with assertions 1–6 passing. Logs: `test-results/resume-{check,tests,build,e2e}.log`.
R1 and R3 are resolved. No remaining stop. No hellotimber files changed.

**2026-11-05, toolchain decision.** Lachlan requires TanStack Start and Rsbuild/Rspack for
all MF builds (example, future hellotimber host and component remotes). The working Vite MF
spike is retired. Vite+ remains tests/lint/format and non-MF apps; apps/web retains its Loro
optimizeDeps exclusions. No hellotimber file changed. hellotimber's plan 33 records its separately verified
website build/deployment migration to `@tanstack/react-start/plugin/rsbuild`.

The example uses Start's Rsbuild plugin, pluginReact, `@mdx-js/loader` + remarkComposed and
`import.meta.webpackContext`. `prerender.filter` restricts generation to `/posts/tracer` because
Start otherwise generates a root page returning 404 (the stop 3 workaround). A tracked empty
content directory allows builds before any post export. The example has no unit tests, so its
Vite config/test script are removed and recursive testing skips it (7 tasks instead of 8).
Rspack compilation membership emits `module-trace.json` for the existing no-component-code proof.

Remote builds use `createRsbuild` and `@module-federation/rsbuild-plugin`. The emitted container
is a named **var/global** library (`library: { type: "var", name }`), with remoteEntry.js at
the artifact root; host-runtime registers it with **type: "global"**. Browser interaction and
shared React useState/createElement identity prove compatibility with the runtime-only host.
All three singleton shares use the plugin's supported `import: false`, `requiredVersion: false`.
The materialized devDependencies include React, React DOM, Rsbuild core, React plugin, MF Rsbuild
plugin and the blocks link. Lock-only resolution → hashed files/lock/settings → frozen install
is preserved. The remote regression scans every emitted JS file and passes even with the
studio's development NODE_ENV; no React implementation is bundled.

R3 uses `loaders/composed-lock.cjs` before the MDX loader (loaders execute right-to-left):
`this.addDependency` registers the sibling lock as a compilation input. A lock edit therefore
re-runs remarkComposed, replacing the fallback Markdown literals in client and dev SSR output.
The obsolete Vite invalidation plugin is removed. The tracer separately changes only the lock
and observes the new SSR text without restart.

Rerun gates all pass: `mise exec -- vp check --fix` (55 files, no warnings/errors),
`mise exec -- vp run -r test` (7/7 tasks), `mise exec -- vp run host-tanstack#build`
(one prerendered page), and `mise exec -- vp run host-tanstack#e2e` (all six assertions).
Final tracer output: assertions 1–6 true; component write → rebuilt/exported SSR **829.58 ms**;
lock-only invalidation also passes its 2 s deadline. Evidence: `test-results/assertions.json`,
`tracer.json`, `versions.json`, `server-module-trace.json`, `loaded-assets.json`,
`updated-ssr.html`, `lock-only-ssr.html`, and `production-fallback.png`, `fallback.png`,
`remote.png`, `failed.png`. Gate logs: `test-results/migration-{check,tests,build,e2e}.log`.
Resolved versions: Rsbuild 2.3.1, Rspack 2.3.1, React plugin 2.1.1, MF Rsbuild plugin 2.9.3,
TanStack Start 1.169.4, React/React DOM 19.3.1; tracer Node 22.22.3. Evidence stays gitignored.
No remaining library contradiction or stop; the old stop/resolution logs above are historical.
