# composed: design package and plan (candidate: claude)

## 1. Design package

### 1.1 Outcome and usage

**Goal.** Lachlan writes a hellotimber post in composed, on one Mac. He rewrites sentences in place (by hand, with a local model or with an agent), dims what he might cut and stashes leftovers. He previews the post on hellotimber's own dev server, components included, and publishes it with one export. Agents get the same powers through a CLI and MCP and can never overwrite his text.

**Workflow 2: alternatives in the editor** (`composed studio` serves the editor at `http://127.0.0.1:4747`)

1. Select a sentence and press `Mod-Shift-R` ("Rewrite"). Three rewrites from the configured model arrive as one alternative. A gutter dot and a hairline underline mark the range, labelled `1/4`.
2. With the cursor in the range, `Alt-↑`/`Alt-↓` flips through the versions in place (hovering shows the same arrows).
3. `Mod-Enter` keeps the current version and stashes the rest. `Mod-Shift-Enter` keeps it and leaves the rest in the text, dimmed after it. `Mod-.` dims or undims any selection. The stash panel lists leftovers, and `Insert` puts one back at the cursor.

**Workflow 3: an agent edits safely** (CLI; MCP exposes the same operations as `doc_read`, `doc_apply`, …)

```sh
$ composed cat how-i-built --json
{"doc":"how-i-built","base":"AQKrB3…","view":"full","text":"---\ntitle: How I built…",
 "dim":[[4120,4188]],"alts":[{"id":"a7","from":311,"to":402,"active":0,"count":3}],
 "blocks":[{"tag":"RetryChart","from":5230,"to":5268,"props":{"attempts":6}}]}
$ composed apply how-i-built --base AQKrB3… < edited.mdx            # --propose is the default
proposed 3 alternatives: a9 (¶4), a10 (¶7), a11 (¶12); your concurrent edits since AQKrB3… kept
$ composed alt propose how-i-built --base AQKrB3… \
    --quote "The homepage of this site is a Nokia 3310." \
    --version "This site's homepage is a working Nokia 3310." --version "Meet the homepage: a Nokia 3310."
alternative a12: 3 versions, active 1 (original)
```

`.mcp.json`: `{ "mcpServers": { "composed": { "command": "composed", "args": ["mcp"] } } }`.

**Workflow 5: preview on the real blog**

```sh
$ composed preview how-i-built --to ~/projects/lachieh/hellotimber/website/content/writing
how-i-built → …/content/writing/how-i-built/index.mdx (preview lock)
dev blocks on http://127.0.0.1:4848 · RetryChart → composed:lachieh/retry-chart@0.2.0-dev.3f9a1c2e
$ composed component edit lachieh/retry-chart ~/blocks/retry-chart   # two-way file sync
# hellotimber: vp run website#dev → http://localhost:3000/writing/how-i-built
```

Typing in the studio or saving `~/blocks/retry-chart/block.tsx` rewrites the preview export, and Vite reloads the page within about a second.

**Workflow 7: publish**

```sh
$ composed component publish lachieh/retry-chart --minor
published composed:lachieh/retry-chart@0.2.0 → https://cdn.composed.ink/c/lachieh/retry-chart/0.2.0/
$ composed deps pin how-i-built RetryChart 0.2.0
$ composed export how-i-built          # target remembered on this device
wrote how-i-built/index.mdx + composed.lock.json (release, 1 block, dim omitted)
$ git -C ~/projects/lachieh/hellotimber commit -am "post: how I built" && git push
```

**Host code in hellotimber** (the whole integration):

```ts
// website/vite.config.ts
import { remarkComposed } from "@composedink/host-tanstack/remark";
const plugin = mdx({
  remarkPlugins: [remarkFrontmatter, remarkComposed],
  rehypePlugins: [/* shiki */],
});

// website/src/writing/posts.ts and bodies.ts: posts become folders
const FILES = import.meta.glob("../../content/writing/*/index.mdx", {
  query: "?frontmatter",
  import: "default",
  eager: true,
});
// slugOfFile: `…/writing/how-i-built/index.mdx` → `how-i-built`
```

The MDX source stays `<RetryChart attempts={6} base={250} />`. `PostPage`, `FIGURES` and routes don't change.

**Acceptance.** Workflows 2, 3, 5 and 7 run end to end on one device. Concurrent human edits survive every agent apply. A published post renders the fallback without JS and in RSS, and swaps to the federated component in a browser. A failed remote leaves the fallback in place.

**Excluded from MVP.** Sync and ideas (workflow 1), sharing and comments (workflow 6), `component.render` with screenshots (the rest of workflow 4), npm dependencies in components other than React, block children, on-device AI providers, mobile, registry listing, live push to published sites, and federated SSR.

### 1.2 Model

**Documents.** Every post and component is its own Loro doc. The container keys are listed once, in `core/src/model/keys.ts`.

| Doc       | Container  | Type                | Content                                                                               | Writer                               |
| --------- | ---------- | ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| post      | `meta`     | Map                 | `kind:"post"`, `slug`, `createdAt`                                                    | `doc.create`, `doc.rename`           |
| post      | `mdx`      | Text                | full MDX source, frontmatter included; mark `dim:true` (`expand:"none"`)              | keystrokes (editor) and `core/model` |
| post      | `alts`     | Map `AltId → Map`   | `start`, `end`: encoded `Cursor` bytes; `versions`: List of `{ text?, dim?, by, at }` | `core/model/alternatives`            |
| post      | `stash`    | MovableList         | `{ text, dim, by, at, reason: "alt" \| "cut" }`                                       | `core/model/stash`                   |
| post      | `deps`     | Map `Tag → Pin`     | `"composed:lachieh/retry-chart@0.2.0"` or `…@dev`                                     | `core/model/deps`                    |
| component | `meta`     | Map                 | `kind:"component"`, `scope`, `name`                                                   | `component.create`                   |
| component | `files`    | Map `path → Text`   | `block.tsx`, `fallback.ts`, other relative modules                                    | `core/model/files`                   |
| component | `releases` | Map `Version → Map` | `{ frontiers, sourceHash, fallbackIntegrity, at }`, immutable once written            | `component.publish`                  |

**Invariants and the facts they protect**

- _Text._ `mdx` is the only copy of the post's text. The active version of an alternative is the text between its cursors, so a stored version slot holds `text` only while it is inactive. The active index is the one slot without `text`. It is derived, never stored, so it can't disagree with the text. A flip writes the text range and two slots in one commit.
- _Alternatives_ never partly overlap. A proposal that intersects an existing alternative widens to cover it and absorbs it, and the absorbed alternative's inactive versions move to the stash. Nothing is lost and nothing nests. Inactive versions carry their dim spans, so flipping keeps the marks.
- _Dim_ is only a mark. `view: "clean"` (dim omitted) is a projection computed from the marks, never stored.
- _Frontmatter_ lives in `mdx`. composed doesn't own the host's frontmatter schema (hellotimber's parser rejects unknown keys), so the host's parser is its only validator. This deviates from "export = `to_string()` + frontmatter": export is exactly the projection of `mdx`.
- _Dependencies._ `deps` holds direct pins and _is_ the lock. A dev pin resolves at export to `<next>-dev.<sourceHash[0..8]>`. `sourceHash` (sha256 of the sorted files) and the dev version are derived. Released versions exist only in `releases`. The artifact server is a cache addressed by `(id, version)`, and the integrity hash shows whether it agrees.
- _Manifest_ (`kind`, props schema, editor label, sample) is derived from the literal fields of the `defineBlock` call by AST extraction (Rolldown `parseAst`). It is never stored and never produced by running code.
- _Device-local state_ (export targets, registry URLs, model endpoint, publish token) lives in `$COMPOSED_HOME/config.json`, never in a doc: absolute paths and secrets are per device.

**Store.** `$COMPOSED_HOME/docs/<docId>/snapshot.loro` plus `updates/<peer>-<counter>.loro`. Every process has a random peer ID and writes only its own update files (temp file, then rename). Compaction writes a new snapshot by rename, then deletes only the update files it read. Any process may compact, so no daemon owns the store. Processes never share a mutable file; each one imports new update files (`fs.watch`), and Loro's idempotent import makes them converge.

### 1.3 Interfaces and ownership

**Core operations** (`@composedink/core/node`). This is the only mutation path outside the editor's keystrokes.

```ts
export type DocHandle = string; // slug or id; the store resolves it
export type Frontiers = string & { readonly __brand: "Frontiers" }; // base64url(encodeFrontiers)
export type ComponentId = `composed:${string}/${string}`;
export type Version =
  | `${number}.${number}.${number}`
  | `${number}.${number}.${number}-dev.${string}`;
export type View = "full" | "clean";
export type Author =
  | { kind: "human" }
  | { kind: "agent"; name: string }
  | { kind: "model"; model: string };
export type Selection = { base: Frontiers; view: View } & (
  | { from: number; to: number }
  | { quote: string; nth?: number }
); // the editor uses offsets, agents use quotes

export interface DocRead {
  doc: string;
  slug: string;
  base: Frontiers;
  view: View;
  text: string;
  dim: [number, number][];
  alts: AltView[];
  blocks: BlockUse[];
}
export interface AltView {
  id: AltId;
  from: number;
  to: number;
  active: number;
  count: number;
  versions?: { text: string; by: Author }[];
} // only with { versions: true }
export type ApplyResult =
  | { mode: "direct"; head: Frontiers }
  | { mode: "propose"; head: Frontiers; alternatives: AltId[] };

export interface Operations {
  "doc.create"(i: { slug: string }): Promise<{ doc: string }>;
  "doc.list"(i: {}): Promise<{ slug: string; title?: string; doc: string }[]>;
  "doc.read"(i: { doc: DocHandle; view?: View; versions?: boolean }): Promise<DocRead>;
  "doc.apply"(i: {
    doc: DocHandle;
    base: Frontiers;
    view?: View;
    text: string;
    mode?: "propose" | "direct";
    by: Author;
  }): Promise<ApplyResult>;
  "alt.propose"(i: {
    doc: DocHandle;
    at: Selection;
    versions: string[];
    by: Author;
  }): Promise<{ alt: AltId }>;
  "alt.rewrite"(i: {
    doc: DocHandle;
    at: Selection;
    instruction?: string;
    count?: number;
  }): Promise<{ alt: AltId }>;
  "alt.flip"(i: {
    doc: DocHandle;
    alt: AltId;
    to: number | "next" | "prev";
  }): Promise<{ active: number }>;
  "alt.resolve"(i: { doc: DocHandle; alt: AltId; rest: "stash" | "ghost" }): Promise<void>;
  "ghost.set"(i: { doc: DocHandle; at: Selection; dim: boolean }): Promise<void>;
  "stash.add"(i: { doc: DocHandle; at: Selection }): Promise<{ item: number }>; // cut to stash
  "stash.list"(i: { doc: DocHandle }): Promise<StashItem[]>;
  "stash.restore"(i: { doc: DocHandle; item: number; at: Selection }): Promise<void>;
  lint(i: { doc: DocHandle }): Promise<Diagnostic[]>;
  "blocks.list"(i: { doc: DocHandle }): Promise<BlockUse[]>;
  "deps.add"(i: {
    doc: DocHandle;
    component: ComponentId;
    version: Version | "dev";
    as?: string;
  }): Promise<{ tag: string }>;
  "deps.pin"(i: { doc: DocHandle; tag: string; version: Version | "dev" }): Promise<void>;
  "component.create"(i: { id: ComponentId; kind: "block" | "inline" }): Promise<void>;
  "component.read"(i: {
    id: ComponentId;
    path?: string;
  }): Promise<{ base: Frontiers; files: Record<string, string> }>;
  "component.write"(i: {
    id: ComponentId;
    base: Frontiers;
    files: Record<string, string>;
  }): Promise<{ head: Frontiers }>;
  "component.check"(i: {
    id: ComponentId;
  }): Promise<{ ok: boolean; diagnostics: Diagnostic[]; manifest?: Manifest }>;
  "component.publish"(i: {
    id: ComponentId;
    bump: "patch" | "minor" | "major";
  }): Promise<{ version: Version; url: string }>;
  export(i: { doc: DocHandle; to?: string; mode?: "release" | "preview" }): Promise<ExportResult>;
}
export function openStore(home?: string): Promise<Store>;
export function bind(store: Store): Operations; // every adapter calls this
export type ComposedError = {
  code:
    | "UnknownDoc"
    | "UnknownBase"
    | "QuoteNotFound"
    | "AmbiguousQuote"
    | "TargetBusy"
    | "UnpinnedDependency"
    | "BuildFailed"
    | "VersionExists"
    | "ProviderFailed";
  message: string;
  fix?: string;
}; // `fix` is the exact command to run
```

Each operation is defined once in `core/src/ops/registry.ts` as `{ name, input: zod schema, cli?: { command, positional }, run }`. The CLI commands, the MCP tools (`doc.read` → `doc_read`, JSON Schema from `z.toJSONSchema`) and the studio's WebSocket op routing are generated from that registry. Adding an operation in one place exposes it everywhere, and none of those surfaces can list an operation that doesn't exist.

**Browser entry** (`@composedink/core`). Read-only and pure: `KEYS`, `readAlts(doc)`, `readDim(text)`, `blockUses(text)`, the `Frontiers` codec and the types above. The editor reads the model through it and mutates only by typing or by calling an operation.

**Blocks** (`@composedink/blocks`). Pure, with React types as a peer.

```ts
export type PropSchema =
  | { type: "string"; enum?: readonly string[]; default?: string; description?: string }
  | { type: "number" | "integer"; minimum?: number; maximum?: number; default?: number; description?: string }
  | { type: "boolean"; default?: boolean; description?: string }
  | { type: "array"; items: PropSchema; maxItems?: number; description?: string }
  | { type: "object"; properties: Record<string, PropSchema>; required?: readonly string[] };
export type PropsSchema = Extract<PropSchema, { type: "object" }>;
export type PropsOf<S extends PropsSchema> = /* required keys mapped, the rest optional */;

export interface BlockDefinition<S extends PropsSchema> {
  readonly kind: "block" | "inline";
  readonly props: S;                               // must be a literal: the build reads it from the AST
  readonly sample: PropsOf<S>;
  readonly editor?: { readonly label?: string };
  readonly component: React.ComponentType<PropsOf<S>>;
  readonly fallback: (props: PropsOf<S>) => string;   // Markdown; must be the default export of ./fallback.ts
}
export function defineBlock<const S extends PropsSchema>(def: BlockDefinition<S>): BlockDefinition<S>;
export function validateProps(schema: PropsSchema, value: unknown): PropIssue[];
export function staticValue(node: EstreeExpression): JsonValue;      // literals only; anything else throws with the position
export const SHARED_SINGLETONS = ["react", "react-dom", "react/jsx-runtime"] as const;
export interface ExportLock { composed: 1; mode: "release" | "preview"; doc: string; base: string;
  view: View; sha256: string; blocks: Record<string, LockedBlock> }
export interface LockedBlock { id: ComponentId; version: string; kind: "block" | "inline"; entry: string;
  fallback: { url: string; integrity: `sha384-${string}` }; props: PropsSchema }
export function parseLock(json: unknown): ExportLock;
```

`validateProps`, `PropsOf` and the manifest extractor each switch exhaustively over `PropSchema` (`satisfies never`), so a new keyword fails the build until all three handle it. A component package:

```tsx
// block.tsx
import { defineBlock } from "@composedink/blocks";
import fallback from "./fallback";
import { RetryChart } from "./RetryChart";
export default defineBlock({
  kind: "block",
  props: {
    type: "object",
    properties: {
      attempts: { type: "integer", minimum: 1, maximum: 12 },
      base: { type: "number", default: 250 },
    },
    required: ["attempts"],
  },
  sample: { attempts: 6 },
  component: RetryChart,
  fallback,
});
// fallback.ts: no imports allowed (the build fails if its module graph has any)
export default ({ attempts, base = 250 }: { attempts: number; base?: number }) =>
  `| Attempt | Delay |\n|---|---|\n` +
  Array.from({ length: attempts }, (_, i) => `| ${i + 1} | ${base * 2 ** i} ms |`).join("\n");
```

**Host runtime** (`@composedink/host-runtime`). Module Federation mechanics, no React import:

```ts
export type SharedLibs = Record<(typeof SHARED_SINGLETONS)[number], unknown>; // the type forces every singleton
export function blockLoader(shared: SharedLibs): {
  load(block: LockedBlock): Promise<BlockDefinition<PropsSchema>>;
};
```

It wraps one `createInstance({ name: "composed_host", remotes: [], shared })` per page. `load` calls `registerRemotes([{ name: remoteName(id, version), entry, type: "module" }])` once per name, then `loadRemote(\`${name}/block\`)`. Every version has a unique remote name, so re-registering never needs `force`.

**Host integration** (`@composedink/host-tanstack`). This package doesn't import `@tanstack/*`; TanStack Start is the fixture it's tested against.

- `./remark`, `remarkComposed` (Node). For an MDX file with a sibling `composed.lock.json`, it parses the lock. Each JSX element whose tag is in `lock.blocks` gets its props evaluated with `staticValue` and validated against the locked schema, with errors at `file:line`. The plugin fetches `fallback.url` (cached under `node_modules/.cache/composed/<integrity>.mjs`), checks the integrity and imports the module from a `data:` URL. It parses the returned Markdown into mdast children and rewrites the element to `<_ComposedBlock use={_lock.blocks.RetryChart} props={{…}}>…fallback…</_ComposedBlock>`. It also injects `import _lock from "./composed.lock.json"` and the `_ComposedBlock` import. That injected import puts the lock into Vite's module graph, so a lock change reloads the post. The plugin throws if `mode === "preview"` in a production build. Tags not in the lock pass through, so `FIGURES` keep working.
- `./block`, `ComposedBlock` (isomorphic React). Its first render (SSR and hydration alike) is `<div|span data-composed={id} data-state="fallback">{children}</div|span>`. After mount it calls `load` and renders the remote's `component` with `data-state="remote"`. A load error or render error (caught by an error boundary) keeps the fallback, sets `data-state="failed"` and logs one `console.warn` naming the id and version.

**State writers and the one path per task**

| State                                     | Only writer                                                                            | Path                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `mdx` keystrokes                          | the editor replica, through the loro-codemirror sync plugin                            | typing                                              |
| every other post/component change         | `core/src/model/*`, called only by `ops`                                               | `bind(store)[op]` via CLI, MCP or the studio socket |
| update files                              | the owning process (by peer)                                                           | `store.commit`                                      |
| target `index.mdx` + `composed.lock.json` | the `export` op, holding `$COMPOSED_HOME/targets/<docId>.pid` (`TargetBusy` otherwise) | `composed export` / `composed preview`              |
| component working directory               | the human or agent editing it; the reverse direction only through `component edit`     | `component.write`                                   |
| server artifacts                          | `PUT` from `component.publish`; same bytes → 200, different bytes → 409                | publish                                             |
| device config                             | `composed config`                                                                      | CLI                                                 |

Importing outside edits isn't a separate path. Before writing, `export` compares the target file with the lock. If the file is neither the projection at `lock.base` nor the current projection, it first runs `doc.apply({ base: lock.base, view: lock.view, text: file, mode: "direct", by: human })`. `composed import <doc>` is that same step without the write.

**Boundaries and enforcement**

```
apps/cli ─▶ core, blocks, lint          apps/web ─▶ core (browser entry), lint, blocks
apps/server ─▶ blocks                   apps/desktop ─▶ bundles apps/cli (sidecar) + apps/web
core ─▶ blocks, lint                    lint ─▶ blocks
host-tanstack ─▶ host-runtime, blocks   host-runtime ─▶ blocks          blocks ─▶ ∅
```

Inside core, `model` imports only loro-crdt, blocks and lint; `store` imports neither `model` nor `ops`; `ops` composes `model`, `store`, `export`, `bundle` and `rewrite`. Each package's `exports` lists only its public entries (`core`: `.` and `./node`; `host-tanstack`: `./remark` and `./block`), so a deep import fails resolution (`ERR_PACKAGE_PATH_NOT_EXPORTED` / a Vite resolve error). A root `tests/boundaries.test.ts` checks every import specifier against the arrows above and against the layer rules inside core. It also checks that `LoroText` mutation calls on `mdx` (`insert|delete|update|mark|unmark`) appear only in `core/src/model/` and `apps/web/src/editor/sync.ts`.

**External dependencies.** `loro-crdt` 1.17, `loro-codemirror` 0.3.3 and `@codemirror/*` (editor), `harper.js` 3 (lint), `vite` 8 + `@module-federation/vite` 1.23 (component bundling, in core/bundle), `@module-federation/runtime` 2.9 (host-runtime), `@mdx-js/mdx`/`remark-mdx` (block parsing, remark plugin), `zod` 4 + `@modelcontextprotocol/sdk` (operations, MCP), `ws` (studio socket). Packages consumed outside the repo (`blocks`, `host-runtime`, `host-tanstack`) are built with `vp pack` and published to npm under `@composedink`. The rest stay TypeScript-source workspace packages.

### 1.4 Behavior

**Editor ↔ store.** The browser holds an _editor replica_ bound to `mdx` with loro-codemirror. One WebSocket per doc to `composed studio` carries binary updates in both directions plus `{op, input}` calls. Updates from a keystroke are sent before any later op on the same socket, so an op's `Selection.base` (the editor's frontiers) is always known to the studio when the op arrives. The studio runs the op on its own replica, persists it and broadcasts the update. The editor applies it as an import. (loro-codemirror ignores `by: "local"` events, so ops can't run on the editor replica.)

**apply.**

1. Resolve `base`. A frontier unknown to the doc is an `UnknownBase` error.
2. `fork = doc.forkAt(base)`.
3. Project the fork in `view`. Diff the projection against the input text with a scratch `LoroText.update` and read the deltas.
4. Map projection offsets to text offsets. Dimmed spans omitted from the clean view are skipped, and an insert at an omitted span's edge lands before it.
5. _direct_: apply the deltas to the fork, then `doc.import(fork.export({ mode: "update", from: doc.oplogVersion() }))`. Concurrent edits made since `base` merge in by CRDT.
6. _propose_: the text isn't touched. Each hunk widens to its unit (sentence inside a paragraph; whole list item, heading, code block or JSX element otherwise, from the MDX parse), and its anchors come from `fork.getText("mdx").getCursor(…)`. Cursor IDs are valid in the main doc, so a proposal lands on the right words even after concurrent edits. Then `alt.propose`.

**Failure and recovery.** Every write is one Loro commit in one update file, so a crash loses at most the in-flight op, and temp files without a rename are ignored. Export writes `index.mdx`, then the lock. A crash in between leaves a file equal to the current projection, which is treated as a no-op rather than an outside edit, so changes are never applied twice. On the host: a failed remote keeps the fallback; an integrity mismatch, a non-literal prop, an invalid prop or a preview lock in production fails the build with the file and line; a missing preview server fails the dev SSR with `run composed preview <doc>`. A component build failure leaves the last good dev build in the lock and reports `BuildFailed` with Vite's diagnostics.

**Verification at the consumer boundary.** Core tests call `bind(store)[op]` against a temp `$COMPOSED_HOME`, the same entry the CLI, MCP and socket use. CLI and MCP tests spawn the real binary (MCP through the SDK client). Editor tests use Playwright against `composed studio`. Host tests use Playwright against the prerendered `examples/host-tanstack`, with JS on, with JS off and with the remote blocked.

## 2. Tracer bullet

**Slice.** One post doc whose `mdx` holds `<Hello name="Lachlan" />`, typed in the browser editor. One inline component, `composed:lachieh/hello`, from the `component.create` template: props `{ name: string }`, fallback `Hello, **${name}**.`, and a component with a `useState` click counter. `composed preview` builds it and serves it. The post is exported into `examples/host-tanstack/content/tracer/index.mdx`, compiled by `remarkComposed` and prerendered by TanStack Start (`tanstackStart({ prerender: { enabled: true } })`). In the browser the fallback swaps to the remote.

**Real:** the Loro doc and the per-peer update-file store with `fs.watch` import; `doc.create`, `doc.read`, `deps.add` (dev pins) and `export` (preview mode) through the operations registry and the generated CLI; the studio WebSocket and loro-codemirror editor replica; the `defineBlock` types, AST manifest extraction and the Vite + `@module-federation/vite` dev build (`exposes: { "./block": "./block.tsx" }`, singletons `import: false`) plus the separate `fallback.mjs`; host-runtime's `createInstance` sharing the host's React; `remarkComposed`; `ComposedBlock`; prerender.

**Absent (not faked):** alternatives, dim, stash, lint, AI, editor styling and widgets, `component.check`, publish, the server, release mode with its production guard, outside-edit import and compaction. No stub function ships. Each of these arrives later as a working unit.

**Evidence** (`vp run host-tanstack#e2e`, Playwright, temp `$COMPOSED_HOME`):

1. Type `<Hello name="Lachlan" />` into the studio editor. `composed cat tracer` in a separate process prints it: editor → Loro → store → another process.
2. `content/tracer/index.mdx` equals `composed cat tracer` byte for byte. `composed.lock.json` has `blocks.Hello` with a `0.1.0-dev.*` version.
3. After `vp run host-tanstack#build`, the prerendered `posts/tracer/index.html`, fetched with no JS, contains `<span data-composed="composed:lachieh/hello" data-state="fallback">Hello, <strong>Lachlan</strong>.</span>`.
4. With JS on, `[data-state="remote"]` appears, and clicking it twice shows `clicked 2`. Hooks work only with one shared React, so this proves the singleton share.
5. With `**/remoteEntry.js` routed to 404, the page shows the fallback, `data-state="failed"` and one warning.
6. In `vp dev`, editing the component's `fallback.ts` through `composed component write` changes the SSR response within 2 s with no restart. This proves the injected-lock invalidation.

A human sees a post reading "Hello, **Lachlan**." that becomes a clickable counter.

## 3. MVP plan

Each unit ends with `mise exec -- vp check --fix` and `vp run -r test` green, plus the unit's own evidence. No unit leaves an unimplemented command or operation: the CLI and MCP list only what the registry implements.

| #   | Unit                               | Scope and files                                                                                                                                                                                                                                                                                                                                    | Depends on          | Completion evidence                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Tracer bullet                      | §2. Creates `packages/{core,blocks,host-runtime,host-tanstack}`, `apps/{cli,web}`, `examples/host-tanstack`, the root `tests/boundaries.test.ts` and the mise/Vite+ workspace                                                                                                                                                                      | none                | §2 evidence 1–6; the boundary test fails on a fixture deep import                                                                                                                                                                                                                                                                              |
| U2  | Store durability                   | compaction, crash-safe writes, `UnknownBase`, peer uniqueness (`core/src/store`)                                                                                                                                                                                                                                                                   | U1                  | two spawned processes write 500 ops each concurrently → both sets present and replicas equal; `kill -9` mid-write → the store opens with every committed op                                                                                                                                                                                    |
| U3  | Alternatives + agent apply         | `core/src/model/{alternatives,apply}.ts`, `alt.propose/flip/resolve(rest:"stash")`, `doc.apply` direct/propose, `stash.list`, generated CLI + `composed mcp`                                                                                                                                                                                       | U2                  | workflow 3 test: read base, another process edits ¶2, `apply --propose` editing ¶4 → ¶2 edit kept, ¶4 unchanged, one alternative whose flip yields the agent's text; quote selection errors (`QuoteNotFound`, `AmbiguousQuote`); MCP client lists `doc_read` and a call round-trips; absorb rule moves the inner versions to the stash         |
| U4  | Dim, stash, clean view             | `ghost.set`, `stash.add/restore`, `alt.resolve(rest:"ghost")`, projection mapping in apply and export                                                                                                                                                                                                                                              | U3                  | property test: random dims + random edits applied through `view:"clean"` never alter dimmed text; a flip preserves dim spans; export in the clean view omits dim                                                                                                                                                                               |
| U5  | Editor                             | `apps/web/src/editor/`: Markdown/MDX styling, alternative markers and `Alt-↑/↓`, keep keys, dim decorations, stash panel, block chips (tag, version, prop errors); ops over the socket                                                                                                                                                             | U4                  | Playwright: select, propose (via CLI), flip with keys, reload → state persisted; an import batch mixing `alts` and `mdx` changes leaves the view equal to `mdx` (R2)                                                                                                                                                                           |
| U6  | Lint                               | `packages/lint`: harper.js on prose ranges, rules (long sentence, passive, adverbs, simpler words, mid-sentence bold, long bullets, block props via `validateProps`); editor underlines; `composed lint`                                                                                                                                           | U5                  | fixture post → expected diagnostics with positions; editor shows underlines; 5,000-word incremental lint under 50 ms in Chrome (R5)                                                                                                                                                                                                            |
| U7  | Model rewrites                     | `core/src/rewrite.ts` (OpenAI-compatible `/v1/chat/completions`, endpoint in device config), `alt.rewrite`, `Mod-Shift-R`                                                                                                                                                                                                                          | U5                  | tests against an in-process HTTP double return three versions as one alternative; `ProviderFailed` leaves the text unchanged; manual check with Ollama `llama3.2`                                                                                                                                                                              |
| U8  | Component authoring + live preview | `component.read/write/check` (tsc against materialized files, manifest extraction, `fallback.ts` import rule), `composed component edit` (two-way sync with per-file base), dev rebuild on doc change in `composed preview`                                                                                                                        | U1                  | saving `block.tsx` in the synced directory reloads the example host page with the change in ≤2 s; a non-literal `props` → `component.check` reports it at line and column; a type error is reported, and the last good build stays served                                                                                                      |
| U9  | Publish                            | `apps/server` (artifact `PUT`/`GET`, immutable cache and CORS headers, token from env, filesystem storage, container image); `component.publish`, `deps.pin`; release export (`UnpinnedDependency`), outside-edit import, `TargetBusy`; production guard in `remarkComposed`; `vp pack` + npm publish of `blocks`, `host-runtime`, `host-tanstack` | U4, U8              | e2e against a local server: publish → republishing the same bytes returns 200, different bytes 409; release export → production build of the example host contains the fallback and loads the remote from the server URL; hand-edit `index.mdx`, then `composed export` → the edit is in the doc and the file; a preview lock fails `vp build` |
| U10 | hellotimber adoption               | in hellotimber: add `@composedink/host-tanstack`, `remarkComposed`, folder posts; `composed new --from website/content/writing/how-i-built-a-nokia-3310.mdx`                                                                                                                                                                                       | U9                  | `vp run website#build` + `vp run website#test` green; the post page's SSR HTML matches its pre-migration output                                                                                                                                                                                                                                |
| U11 | Desktop shell                      | `apps/desktop` (Tauri 2, macOS): the window loads the studio served by the bundled `composed` sidecar                                                                                                                                                                                                                                              | U5 (spike R8 first) | the app launches, an edit persists, `composed cat` in a terminal sees it                                                                                                                                                                                                                                                                       |

**Later phases (out of MVP)**

- **P2, sync and ideas:** the `protocol` package, server accounts, device tokens and update relay, server-side bundling (the same `core/bundle` function), live "new version" push with host re-registration, `composed new idea` and mobile capture via the web app.
- **P3, sharing:** preview links, the comments doc, the `preview` package, the `usercontent` origin, and `component.render` in that sandbox (completes workflow 4).
- **P4, mobile and on-device AI:** the mobile shell, WebLLM, the Chrome Prompt API, and Tauri llama.cpp / Apple Foundation Models behind the `alt.rewrite` provider (moved into a `packages/ai` once a second runtime needs it).
- **P5, registry:** promotion and listing, component-to-component and npm dependencies with the post roll-up, and npm-compatible publishing.

## 4. Decisions

**Alternatives considered and rejected**

- _Running operations in the browser on the editor replica._ loro-codemirror's sync plugin returns early on `by: "local"` events (`sync.ts`), so op writes would never reach the view. A second replica per process fixes this and gives every surface one operation path.
- _A store daemon with RPC as the single writer._ Per-peer update files plus CRDT merge remove the shared mutable file instead of serializing access to it. There is no IPC protocol to build and no daemon lifecycle to manage.
- _Base frontiers in frontmatter._ hellotimber's `parseFrontmatter` throws on unknown keys, and the frontiers are composed's bookkeeping, not the post's metadata. A sidecar `composed.lock.json` carries them along with the resolved blocks.
- _Frontmatter in a separate map._ That would be a second representation, and composed would have to own the host's schema.
- _composed precomputing fallbacks at export._ composed would have to run account code outside a sandbox and key fallbacks to element instances. Instead, the host, which already chose to trust the component, runs a React-free `fallback.mjs` at compile time. In the MVP composed never executes component code: bundling, tsc and manifest extraction don't run it.
- _A zod or valibot props schema._ Getting JSON Schema out of it requires running the component's code. A literal JSON Schema subset typed by `PropsOf` is extractable from the AST. A separate `block.json` was also rejected, because it would duplicate the TypeScript types.
- _Server-side bundling in the MVP._ The server would need the component doc, which needs sync. The client bundles with the same function, and published versions are immutable either way.
- _Keying `alts` by encoded start cursor._ An alternative needs two anchors, and a random `AltId` keeps identity separate from how anchors are encoded. Non-overlap is enforced by the model instead of by map keys. This is a small deviation from "map keyed by stable cursors".

**Accepted tradeoffs.** Browsers can't verify the integrity of a remote's ESM `import()`; trust rests on HTTPS and immutable versioned URLs, and only `fallback.mjs` is integrity-checked, at build time. Swapping the fallback for the remote can shift layout. Blocks take JSON props, not children. A component change in preview reloads the whole page rather than updating in place. Components can depend only on React. `host-tanstack` contains nothing TanStack-specific; the name is kept per grounding and reflects the fixture it's tested against.

**Open decisions resolved**

- _Scope-to-server resolution:_ the author side maps scope to registry in device config (default `https://cdn.composed.ink`). The lock stores absolute URLs, so hosts never resolve scopes, and IDs stay `composed:<scope>/<name>` even if a self-hoster moves servers. A global namespace across servers waits for the registry phase (P5), the first time two servers' listings meet.
- _Federated SSR:_ not used; v1 always uses fallback-only SSR. The fallback has to exist anyway for RSS, no-JS and failed remotes. Federated SSR would add a Node share scope, hydration of remote markup and a network dependency at request time. Revisit if a real block's layout shift is visible on hellotimber.
- _Mobile shell (Tauri mobile vs Expo DOM components):_ deferred to P4. It hinges on CodeMirror IME and selection behaviour in each webview, which only a spike on a device answers. The leaning is Tauri mobile, which reuses the Rust plugins and the desktop sidecar model.

**Risks and the spikes that de-risk them**

- **R1:** a runtime-only MF host (no Vite plugin) providing React to a `@module-federation/vite` remote with `import: false`. _Proven by tracer evidence 4._ If it fails, add `@module-federation/vite` to the example host with `hostInitInjectLocation: "entry"`; if that fails too, use TanStack Start's Rsbuild plugin, per grounding.
- **R2:** loro-codemirror 0.3.3 `return`s from its import handler on the first non-text event (`sync.ts`, `if (diff.type !== "text") return;`), so a batch carrying `alts` changes can drop text changes from the view. _Spike at the start of U5_ (the evidence listed there). If it reproduces, fix it upstream (change to `continue`) and keep `apps/web/src/editor/sync.ts` as a ~100-line own plugin until the fix is released.
- **R3:** Vite invalidating the MDX module through the injected lock import in TanStack Start's SSR environment. _Proven by tracer evidence 6._ The fallback is a small Vite plugin that invalidates the sibling `index.mdx` on a lock change.
- **R4:** an async fetch plus `data:` import inside a remark transform under `@mdx-js/rollup`. _Proven by tracer evidence 3._
- **R5:** harper.js latency on long posts. _Benchmark in U6_; lint only changed paragraphs.
- **R6:** offset mapping for the clean projection. _Property test in U4._
- **R7:** cursor edge semantics (inserts at an alternative's edges must land outside it). _Unit test in U3_ rather than an assumed `Side` flag.
- **R8:** a Tauri sidecar carrying Node, Rolldown's native binding and the Loro wasm. _Spike before U11_: package `composed` as a Node SEA; if that fails, ship a Node binary plus the JS directory.

**First verifiable unit:** U1, the tracer bullet.
