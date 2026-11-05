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
    "@module-federation/vite": ^1.23.0
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
- [ ] `core/src/model/keys.ts` is the only list of container names: post `meta`, `mdx`, `deps`;
      component `meta`, `files`. Frontmatter lives inside `mdx`. `doc.read` returns base64url
      `encodeFrontiers`, the text, and empty `dim`/`alts`/`blocks` arrays where nothing exists
      (real absence, not fake ops).
- [x] **Store.** `$COMPOSED_HOME/docs/<docId>/snapshot.loro` plus `updates/<n>.loro`, written only
      by the studio authority with temp file → `fsync` → rename before any acknowledgement. No
      `fs.watch`, no per-peer files, no compaction yet.
- [ ] **`composed studio`** is the authority in this plan. It serves: the editor UI (Vite dev
      middleware for `apps/web` in development; built assets when packaged), the operations
      WebSocket on `127.0.0.1:4747`, the immutable artifact server on `127.0.0.1:4848` with CORS,
      and the preview subscription (next task). It writes `workspace.lock` with
      `{pid, processStartTime, kind: "studio", socket, ready}` via temp file + `link()` so a crash
      can't leave an empty lock. Every other CLI command connects to the socket; if no studio is
      running it exits with `fix: composed studio`. **No election, inline owner or stale-lock
      recovery ships here** (plan 02).
- [ ] **Operations registry.** `core/src/ops/registry.ts` defines each op once: name, Zod input,
      mutation flag, CLI mapping, run. The CLI command list and socket validation are generated
      from it; it lists only the ops in this plan's scope. The authority runs ops on one
      serialized queue. Socket frames: `{doc, bytes, seq}` for binding updates; `{request, name,
      input}` for ops; acknowledgements carry the durable head. Loopback sessions carry an
      ephemeral token issued at page load and an `Origin` check; the token never reaches
      component code.
- [ ] **Typing path.** The editor streams binding updates unchanged; the authority imports them
      unchanged, then runs the normalization hook (only `mdx`/`deps` invariants exist yet — do not
      invent alternative handling), persists, then broadcasts and acknowledges. A disconnected
      editor keeps unacknowledged updates and replays them; Loro's import is idempotent.
- [ ] `component.write --base <frontiers> --file <relative path>` reads stdin, applies to a fork at
      `base`, merges through the model. Reject absolute paths, `..` and symlink escapes.
      `new post <slug>` creates an empty document; the tracer types the frontmatter and body in
      the editor. `new --from <file>` arrives with `doc.apply` in plan 04.
- [ ] **Preview subscription (minimal).** When a component document changes, the studio rebuilds
      it (Task 3), evaluates fallbacks, and regenerates the preview pair of every post pinned to
      that component `@dev` and previously exported in this session. Plan 08 adds last-good
      retention and two-way file sync. The studio never loads remotes in its own origin; the live
      preview is the example/blog dev server on its own origin (P3 adds the usercontent sandbox).

## Task 3 — Blocks, the build, and export with locked fallbacks

**Files:** `packages/blocks/src/{index,schema,static-value,lock}.ts`, `tests/{schema,lock}.test.ts`;
`packages/core/src/{bundle,export}.ts`, `src/model/{projection,component-template}.ts`,
`src/fallback/{worker,evaluator}.ts`, `tests/{bundle,fallback,export}.test.ts`.

- [ ] Implement the design's `defineBlock`, `PropSchema`/`PropsSchema`, `PropsOf`,
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

- [ ] **Build.** The authority materializes `$COMPOSED_HOME/build/<id>/<sourceHash>/` with the
      component files and a generated `package.json` whose devDependencies are `react` and
      `react-dom` at the catalog versions and `@composedink/blocks` as `link:<path>` to the
      workspace package (the path comes from the authority's own install location; plan 09/12
      switch this to the published npm version). Resolve the lock first with
      `pnpm install --lockfile-only --ignore-scripts`, include the generated `pnpm-lock.yaml` in
      the build inputs (so `sourceHash` covers exact resolutions), then install with
      `pnpm install --frozen-lockfile --ignore-scripts`, and build with Vite's programmatic API
      plus `@module-federation/vite`: `exposes: { "./block": "./block.tsx" }`, remote name
      derived from `(id, version)`, shared `react`, `react-dom`, `react/jsx-runtime` as singletons
      with `import: false`; every other dependency is bundled. Version is `0.1.0-dev.<hash>` where
      the hash covers sorted file bytes, the exact dependency resolutions and the build settings.
      Note `@module-federation/vite` 1.23's caveat that named imports of `import:false` shares
      need the share present in the host scope — the host supplies all three (Task 4).
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
`examples/host-tanstack/{package.json,vite.config.ts,src/router.tsx,src/routes/__root.tsx,src/routes/posts.$slug.tsx,fixtures/tracer.mdx}`.

- [ ] `blockLoader(shared)` creates one `createInstance({ name: "composed_host", remotes: [],
      shared })` per page, `registerRemotes` once per `(id, version)` name, then
      `loadRemote(\`${name}/block\`)`. The host passes the three real module objects; the runtime
      imports no React.
- [ ] `ComposedBlock` renders `<span|div data-composed={id} data-state="fallback">{children}</…>`
      identically on the server and at hydration, loads the remote after mount, and renders it with
      `data-state="remote"`. A load or render error (error boundary) keeps the fallback, sets
      `data-state="failed"` and logs one `console.warn` naming id and version.
- [ ] `remarkComposed` reads the sibling `composed.lock.json` only. For each JSX element whose
      tag is in `lock.blocks`: evaluate props with `staticValue`, apply defaults, hash, and require
      the hash in `instances`; otherwise fail at `file:line` with `composed export <doc>`. It
      **never** verifies a whole-file MDX hash (hellotimber's formatter rewrites MDX on commit).
      It parses the instance Markdown to mdast with raw HTML/MDX disabled, rewrites the element to
      `<ComposedBlock use={_lock.blocks.Tag} props={…}>…</ComposedBlock>`, and injects
      `import _lock from "./composed.lock.json"` and the `ComposedBlock` import. Tags not in the
      lock pass through untouched. In a production build a `mode: "preview"` lock renders the
      fallback only (no remote registration) and emits one build warning naming the post and the
      fix command — it never fails the build.
- [ ] The injected lock import must put the lock into Vite's module graph so a lock change
      invalidates the MDX module (R3). If it doesn't under TanStack Start's SSR environment, add a
      small Vite plugin that invalidates the sibling `index.mdx` on a lock change, with a
      regression test.
- [ ] The example registers `/posts/$slug`, compiles folder MDX with `@mdx-js/rollup` +
      `remarkComposed`, and enables prerendering of `/posts/tracer` using the installed TanStack
      Start API (verify the option name against the installed version rather than assuming). The
      committed `fixtures/tracer.mdx` is a template only: the tracer copies the example into the
      temp home and exports into that copy; `content/tracer/index.mdx` is never committed.
      Scripts: `dev`, `build`, `test`, `e2e` (runs the root tracer).

## Task 5 — Collect executable evidence

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

## Toolchain fallback

If the runtime-only host cannot load the remote or share React (R1): keep the logs and version
matrix; add `@module-federation/vite` to the example host with `hostInitInjectLocation: "entry"`
and all three shares, and rerun the same evidence. If remote loading or prerendering still fails
on Vite 8: verify `@tanstack/react-start/plugin/rsbuild` exists in the installed version, switch
**only the example host's** `dev`/`build` to Rsbuild with catalogued dependencies (remotes stay
Vite-built, `vp check`/tests unchanged), and rerun. Rolldown has no built-in Module Federation
plugin; do not assume one. Never replace federation with a static import. If that also fails,
stop and report R1 with logs — it blocks completion.

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
