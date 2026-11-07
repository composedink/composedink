# composed — integrated design

## Outcome and usage

Lachlan writes a hellotimber post on one Mac, keeps competing phrasings in place, previews components in the real blog layout, and exports ordinary MDX. Agents propose; the author chooses. This document specifies intended behavior; the implementation evidence below is still to be collected.

**Workflow 2 — edit prose.** `composed studio` opens the editor at `http://127.0.0.1:4747`. Select a sentence and press `Mod-Shift-R`: three model rewrites become one alternative, labelled `1/4`. Hover arrows or `Alt-↑`/`Alt-↓` cycle versions. `Mod-Enter` keeps the active version and stashes the others; `Mod-Shift-Enter` keeps it and inserts the others dimmed after it. `Mod-.` toggles dim. Stash → Insert restores a leftover at the cursor. Model configuration is optional; CLI proposals work without it.

**Workflow 3 — agent edits safely.**

```sh
composed new post how-i-built --from draft.mdx
composed cat how-i-built --json > /tmp/post.json
jq -r .text /tmp/post.json > /tmp/edited.mdx
# Edit /tmp/edited.mdx, retaining frontmatter.
composed apply how-i-built --base "$(jq -r .base /tmp/post.json)" \
  --propose --request rewrite-001 < /tmp/edited.mdx
composed alt propose how-i-built --base "$(jq -r .base /tmp/post.json)" \
  --quote 'The homepage is a Nokia 3310.' --version 'Meet the homepage: a Nokia 3310.'
```

`cat --json` returns `{doc,slug,base,view,text,dim,alts,blocks}`. Apply reports alternative IDs and detached stash items; visible prose and concurrent human edits survive. `.mcp.json` uses `{ "mcpServers": { "composed": { "command": "composed", "args": ["mcp"] } } }`. MCP exposes `doc_read`, `doc_apply`, etc.; `doc_apply` has no `mode` input. CLI `--direct` requires a TTY on stdin or `--i-am-human`; `by` is attribution, never permission. This is a cooperative adapter capability boundary, not authentication against a malicious local user.

**Workflow 5 — preview in the blog.**

```sh
composed component create lachieh/retry-chart --kind block
composed component edit lachieh/retry-chart ~/blocks/retry-chart
composed component check lachieh/retry-chart
composed deps add how-i-built RetryChart composed:lachieh/retry-chart@dev
composed preview how-i-built --to ~/projects/lachieh/hellotimber/website/content/writing
# In hellotimber, after its separately authorized adoption:
mise exec -- vp run website#dev
# Open /writing/how-i-built; save block.tsx in ~/blocks/retry-chart.
```

Preview exports a folder and a preview lock, serves immutable local remotes on port 4848, and refreshes the lock after a successful rebuild. The blog reloads within the two-second acceptance budget; a failed build keeps the last good artifact and reports diagnostics. MVP previews execute the author's own components in-page; there is no iframe isolation in this slice.

**Workflow 7 — publish.**

```sh
composed component publish lachieh/retry-chart --minor
composed deps pin how-i-built RetryChart 0.2.0
composed export how-i-built --to ~/projects/lachieh/hellotimber/website/content/writing
# In hellotimber:
mise exec -- vp run website#build
```

The publish command prints the actual version (use it in `deps pin`). Export writes `<slug>/index.mdx` and `composed.lock.json`; future exports remember the destination on this device. Git review/publishing remains the blog's responsibility.

**Host integration planned for hellotimber:**

TanStack Start is required. The website build moves to `@tanstack/react-start/plugin/rsbuild` with Rsbuild/Rspack; component remotes use `@module-federation/rsbuild-plugin`. This is a hellotimber-side change requiring its own plan and verification there. Preserve frontmatter-only loading separately from compiled MDX bodies using Rspack contexts and query-specific loaders, replacing Vite's `import.meta.glob`. Compile MDX with `@mdx-js/loader`, retain frontmatter/Shiki processing and query exclusions, and apply `remarkComposed` only to bodies. Register each sibling lock with the loader's `this.addDependency(lockPath)` so lock changes recompile Markdown in dev SSR.

`PostPage`, `<Body components={FIGURES} />`, routes and existing figures stay usable. The plugin injects its own resolver import. No composed metadata enters frontmatter: hellotimber rejects unknown keys. Its RSS feed emits summaries only; acceptance is the SSR response (JS off) containing fallback. The existing consumer uses `nitro/vite` with Vercel output, without prerendering; adoption must verify the equivalent deployment/SSR path under Rsbuild. `bodies.ts` must still compile every MDX, including drafts. The example host retains prerendering for tracer proof.

**Acceptance:** workflows 2, 3, 5 and 7 survive restart and stale agent bases. A failed remote leaves readable fallback. No host build fetches or executes component code. Excluded: sync/ideas, sharing/comments, `component.render`, block children, on-device inference, mobile, listing/discovery, published-site live updates, npm export of authored blocks, federated SSR and Windows/Linux polish.

## Model

Every post/component is a Loro document. `core/src/model/keys.ts` enumerates container names once. “Writer” below means the authoritative policy writer; the editor replica produces only typing history imported unchanged by that authority.

| Doc       | Container  | Type and contents                                                                 | Single authoritative writer                           |
| --------- | ---------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| post      | `meta`     | Map: schema, id, kind:"post", slug, createdAt                                     | authority model/meta via ops                          |
| post      | `mdx`      | Text: full MDX including frontmatter; dim mark (`expand:"none"`)                  | authority model/text; imports editor typing unchanged |
| post      | `alts`     | Map AltId → Map: start/end encoded cursors, versions list of `{text?,dim?,by,at}` | authority model/alternatives                          |
| post      | `stash`    | MovableList: stable id, text, dim spans, by, at, reason `alt\|cut\|detached`      | authority model/stash                                 |
| post      | `deps`     | Map Tag → `{id,version:semver\|"dev"}` intent                                     | authority model/deps                                  |
| component | `meta`     | Map: schema, id, kind:"component", scope, name                                    | authority model/meta                                  |
| component | `files`    | Map relative path → Text, including package.json                                  | authority model/files                                 |
| component | `releases` | Map Version → immutable `{frontiers,sourceHash,artifactHash,at}`                  | authority model/releases via publish op               |

Exactly one alternative version slot has **no `text` property**; that slot is active and reads the live cursor range. An inactive empty string is valid. There is no stored active index. A flip saves the current snippet and marks, installs the chosen snippet and marks, and removes its stored text in one commit. Alternatives cannot partly overlap: a proposal widens over intersections, absorbs them, and stashes their inactive versions. Edge typing stays outside a range; typing across a boundary dissolves it and stashes inactive versions. Normalization validates one empty slot and repairs violations deterministically without discarding snippets.

Dim is only a mark; clean view is derived. `mdx` is the sole frontmatter/body representation. Post `deps` is intent, not the exact lock. Component `package.json.dependencies` belongs to that component; its resolved dependency graph is bundled into its remote. Only React, React DOM and the JSX runtime are shared singletons. Source hashes cover sorted file paths/bytes plus exact dependency resolutions and build settings; dependency changes invalidate the artifact. The export lock pins exact version, sourceHash and absolute entry URL. Post dependency roll-up waits for npm export (P5).

Device paths, scope→server mappings (default `https://cdn.composed.ink`), endpoint configuration and tokens live under `$COMPOSED_HOME`, outside documents. Hosts use locked absolute URLs and do not resolve scopes.

## Interfaces and ownership

### Operations

```ts
export type DocHandle = string;
export type Frontiers = string & { readonly __brand: "Frontiers" };
export type RequestId = string & { readonly __brand: "RequestId" };
export type AltId = string;
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
); // UTF-16 offsets; nth is zero-based
export type Mutation<T> = T & { request?: RequestId };
export interface AltView {
  id: AltId;
  from: number;
  to: number;
  active: number;
  count: number;
  versions?: { text: string; by: Author }[];
}
export interface BlockUse {
  tag: string;
  from: number;
  to: number;
  props: Record<string, JsonValue>;
}
export interface StashItem {
  id: string;
  text: string;
  dim: [number, number][];
  by: Author;
  at: number;
  reason: "alt" | "cut" | "detached";
}
export interface Diagnostic {
  from: number;
  to: number;
  code: string;
  message: string;
}
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
export type ApplyResult =
  | { mode: "direct"; head: Frontiers }
  | { mode: "propose"; head: Frontiers; alternatives: AltId[]; detached: string[] };
export interface Operations {
  "doc.create"(i: Mutation<{ slug: string }>): Promise<{ doc: string }>;
  "doc.list"(i: {}): Promise<{ slug: string; title?: string; doc: string }[]>;
  "doc.read"(i: { doc: DocHandle; view?: View; versions?: boolean }): Promise<DocRead>;
  "doc.import"(
    i: Mutation<{ doc: DocHandle; file: string }>,
  ): Promise<{ head: Frontiers; imported: boolean }>;
  "doc.apply"(
    i: Mutation<{
      doc: DocHandle;
      base: Frontiers;
      view?: View;
      text: string;
      mode: "propose" | "direct";
      by: Author;
    }>,
  ): Promise<ApplyResult>;
  "alt.propose"(
    i: Mutation<{ doc: DocHandle; at: Selection; versions: string[]; by: Author }>,
  ): Promise<{ alt?: AltId; detached: string[] }>;
  "alt.rewrite"(
    i: Mutation<{ doc: DocHandle; at: Selection; instruction?: string; count?: number }>,
  ): Promise<{ alt?: AltId; detached: string[] }>;
  "alt.flip"(
    i: Mutation<{ doc: DocHandle; alt: AltId; to: number | "next" | "prev" }>,
  ): Promise<{ active: number }>;
  "alt.resolve"(
    i: Mutation<{ doc: DocHandle; alt: AltId; rest: "stash" | "ghost" }>,
  ): Promise<void>;
  "ghost.set"(i: Mutation<{ doc: DocHandle; at: Selection; dim: boolean }>): Promise<void>;
  "stash.add"(i: Mutation<{ doc: DocHandle; at: Selection }>): Promise<{ item: string }>;
  "stash.list"(i: { doc: DocHandle }): Promise<StashItem[]>;
  "stash.restore"(i: Mutation<{ doc: DocHandle; item: string; at: Selection }>): Promise<void>;
  lint(i: { doc: DocHandle }): Promise<Diagnostic[]>;
  "blocks.list"(i: { doc: DocHandle }): Promise<BlockUse[]>;
  "deps.add"(
    i: Mutation<{ doc: DocHandle; component: ComponentId; version: Version | "dev"; as?: string }>,
  ): Promise<{ tag: string }>;
  "deps.pin"(i: Mutation<{ doc: DocHandle; tag: string; version: Version | "dev" }>): Promise<void>;
  "component.create"(i: Mutation<{ id: ComponentId; kind: "block" | "inline" }>): Promise<void>;
  "component.read"(i: {
    id: ComponentId;
    path?: string;
  }): Promise<{ base: Frontiers; files: Record<string, string> }>;
  "component.write"(
    i: Mutation<{ id: ComponentId; base: Frontiers; files: Record<string, string> }>,
  ): Promise<{ head: Frontiers }>;
  "component.check"(i: {
    id: ComponentId;
  }): Promise<{ ok: boolean; diagnostics: Diagnostic[]; manifest?: Manifest }>;
  "component.publish"(
    i: Mutation<{ id: ComponentId; bump: "patch" | "minor" | "major" }>,
  ): Promise<{ version: Version; url: string }>;
  export(
    i: Mutation<{ doc: DocHandle; view: View; to?: string; mode?: "release" | "preview" }>,
  ): Promise<ExportResult>;
}
export interface ExportResult {
  directory: string;
  lock: ExportLock;
}
export function openStore(home?: string): Promise<Store>; // private Store implementation
export function bind(store: Store): Operations;
```

`JsonValue` is recursive JSON; `Manifest` is the static block definition without component/fallback functions. `Store` is an opaque node-entry handle. Errors carry `{code,message,fix?}`: UnknownDoc, UnknownBase, QuoteNotFound, AmbiguousQuote, TargetBusy, UnpinnedDependency, BuildFailed, VersionExists, ProviderFailed, RequestConflict, InvalidInvariant, InvalidProps, FallbackFailed, UnauthorizedDirect and RecoveryRequired.

`core/src/ops/registry.ts` defines each implemented op once: name, Zod input, mutation flag, CLI mapping and run. Adapters derive validation and command/tool lists. Capability projections deliberately differ: MCP removes `mode` and injects `propose`; `doc.import` and direct acceptance are human-only adapter capabilities in CLI/studio; MCP excludes import. `composed import` is generated from `doc.import`, reconciling without writing the file. Export CLI defaults `view` to clean; `--include-dim` selects full. No placeholder op appears before its unit ships. Every mutating op accepts `request`; same request plus canonical payload hash returns its stored result, different payload fails. Transport attribution and request itself are excluded from the hash; semantic inputs are included. IDs are workspace-wide. Receipts and per-destination export history are store-local under `$COMPOSED_HOME/state/`, never Loro containers. The receipt stores the result payload and shares a durable transaction envelope with domain updates. `ExportResult.directory` is a return value only.

### Blocks and locks

```ts
export type PropSchema =
  | { type: "string"; enum?: readonly string[]; default?: string; description?: string }
  | {
      type: "number" | "integer";
      minimum?: number;
      maximum?: number;
      default?: number;
      description?: string;
    }
  | { type: "boolean"; default?: boolean; description?: string }
  | { type: "array"; items: PropSchema; maxItems?: number; description?: string }
  | { type: "object"; properties: Record<string, PropSchema>; required?: readonly string[] };
export type PropsSchema = Extract<PropSchema, { type: "object" }>;
export type PropsOf<S extends PropsSchema> = // type-level mapping, not a runtime evaluator
  {
    [K in keyof S["properties"] as K extends RequiredKeys<S> ? K : never]: ValueOf<
      S["properties"][K]
    >;
  } & {
    [K in keyof S["properties"] as K extends RequiredKeys<S> ? never : K]?: ValueOf<
      S["properties"][K]
    >;
  };
export interface BlockDefinition<S extends PropsSchema> {
  readonly kind: "block" | "inline";
  readonly props: S;
  readonly sample: PropsOf<S>;
  readonly editor?: { readonly label?: string };
  readonly component: React.ComponentType<PropsOf<S>>;
  readonly fallback: (props: PropsOf<S>) => string;
}
export function defineBlock<const S extends PropsSchema>(d: BlockDefinition<S>): BlockDefinition<S>;
export function validateProps(schema: PropsSchema, value: unknown): PropIssue[];
export function staticValue(node: EstreeExpression): JsonValue;
export const SHARED_SINGLETONS = ["react", "react-dom", "react/jsx-runtime"] as const;
export interface ExportLock {
  composed: 1;
  mode: "release" | "preview";
  doc: string;
  base: Frontiers;
  view: View;
  sha256: string;
  blocks: Record<string, LockedBlock>;
}
export interface LockedBlock {
  id: ComponentId;
  version: Version;
  kind: "block" | "inline";
  entry: string;
  sourceHash: string;
  props: PropsSchema;
  instances: Record<string, { props: Record<string, JsonValue>; markdown: string }>;
}
export function parseLock(json: unknown): ExportLock;
```

`RequiredKeys` reads the schema's required tuple; `ValueOf` recursively maps the five schema branches. Unknown object properties fail validation. `PropIssue` includes a property path and message. Defaults are applied before canonicalization; sorted JSON keys, finite numbers and UTF-8 SHA-256 identify each instance. Extraction, runtime validation and type mapping handle the same exhaustive schema subset.

```tsx
// block.tsx; props, sample and editor metadata must be literal AST values.
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
// fallback.ts: no imports, re-exports, require or dynamic import; checked at build.
export default ({ attempts, base = 250 }: { attempts: number; base?: number }) =>
  "| Attempt | Delay |\n|---|---|\n" +
  Array.from({ length: attempts }, (_, i) => `| ${i + 1} | ${base * 2 ** i} ms |`).join("\n");
```

At export a Worker evaluates each distinct instance of the author's own `fallback.ts`. Pin an exact Node 22 patch ≥22.8 in mise and require `vm.constants.DONT_CONTEXTIFY` with `codeGeneration:{strings:false,wasm:false}` and `microtaskMode:"afterEvaluate"`. No host object/function bridges; JSON in/out only. Terminate the Worker on timeout. Test process/require/fetch denial, `this.constructor.constructor`, `({}).constructor.constructor`, `Error.prepareStackTrace`, `Function.prototype.constructor`, async infinite loop and sync loop. Ordinary `vm.createContext` is escapable through `this.constructor.constructor("return process")()`; DONT_CONTEXTIFY must make it throw. This contains own fallback code; P3 adds a process/origin boundary for untrusted code. Fallback output is Markdown, parsed with raw HTML/MDX execution disabled.

`remarkComposed` reads only the sibling lock, validates each composed usage via literal JSON props → defaults → canonical hash present in `instances`, and rewrites registered tags to `<ComposedBlock use={descriptor} props={normalizedProps}>…mdast of locked markdown…</ComposedBlock>`. It injects lock and resolver imports. Missing instance/tag for a composed usage fails at file:line with `composed export <doc>`; ordinary unregistered FIGURES pass through. A tag is composed when present in the lock or identified by a composed deps declaration in export validation; a missing lock for a formerly composed tag cannot be inferred from arbitrary JSX alone—see recovery below. It never verifies a whole-file MDX hash. Lock `sha256` records exported bytes only for composed's outside-edit detection; formatter rewrites are imported as benign outside edits on next export/import. No remote fetch or fallback execution occurs during host build. Production preview locks render fallback only, register no remote and emit one build warning per post naming it and `composed export <doc>`.

`host-runtime.blockLoader(shared)` creates one federation instance per page, registers immutable unique `(id,version)` names and loads `name/block`. It imports no React. `ComposedBlock` initially emits span/div fallback identically in SSR/hydration, then mounts the remote after load. Load/render errors preserve fallback, set `data-state="failed"` and warn once. The remote shares only the three listed singletons with `import:false`; other dependencies are bundled.

### Authority, binding and boundaries

The authority lock is held by the kernel, not by file contents. `$COMPOSED_HOME/authority.db` is a lock-only SQLite file (no tables). Acquire: open a connection with `node:sqlite`, run `PRAGMA busy_timeout=0`, then `BEGIN EXCLUSIVE` as the first statement that touches the database, and keep the connection open for the authority's lifetime. The exclusive lock is an OS file lock the kernel releases when the process dies, so there is no stale lock and no recovery protocol. Any other statement before `BEGIN EXCLUSIVE` (a pragma that reads, `CREATE TABLE`) takes a SHARED lock the connection keeps, and two such contenders both get BUSY with nobody owning — plan 02 reproduced it; never do that. On SQLITE_BUSY (errcode 5) the contender **closes its connection first**, then reads `owner.json` `{pid,processStartTime,kind:"studio"|"inline",socket,ready}` (written by the owner after acquiring, temp+rename): present and ready → connect; present and not ready → wait for ready with a timeout; absent (the owner has not written it yet, or died between acquiring and writing) → sleep 10–30 ms with jitter and retry acquisition, bounded (5 s), then fail with a clear error. A stale `owner.json` never grants ownership: acquisition decides. Receipts, export history and intents live in a separate `state.db`, not in the lock file. Only short commands may own inline, only without a studio lock. Long-running `preview`, `component edit` and `studio` require the studio service, auto-started via `composed studio --headless` if absent. Studio waits at most one short inline command. Plan 01 has no election or inline mode: start `composed studio` explicitly; CLI errors with that fix if absent. Plan 02 adds election, inline and stale recovery. The authority alone serializes ops, writes `docs/<docId>/snapshot.loro` and `updates/<n>.loro`, and compacts. All writes use temp+rename and fsync before acknowledgement. Preserve full historical bases in MVP. Studio owns the operations socket, port-4848 artifact server, component-change → rebuild → fallback evaluation → preview-pair re-export subscription, and apps/web serving (Vite dev middleware in development, built assets when packaged). apps/web is an app and may build. Studio never loads remotes in its own origin: live preview uses the blog/example dev server on its own origin. P3 adds sandboxed usercontent for editor previews.

The browser binds its replica to `mdx` using loro-codemirror. Typing updates stream before subsequent ops on the same socket. The authority imports them **unchanged**, then makes a separate normalization commit: it is the only policy writer. It never rewrites replicated history. Persist import plus normalization before broadcasting/acknowledging; reconnect resends unacknowledged update bytes, which Loro imports idempotently. Ops execute on the authority and return to the browser as imports: the binding ignores local events (`sync.ts:42`). Keystroke undo uses the binding undo manager; each op has an inverse op in the authority's session undo stack. Normalization is not an independent user undo item. Undo preserves concurrent edits; detached inverse targets fail visibly rather than restoring at guessed positions.

Before enabling any mixed-container imports, test both binding early returns: non-text event (`sync.ts:65`) and wrong-target text event. If reproduced, maintain the small corrected binding in `apps/web/src/editor/sync.ts` (continue scanning), with regression tests and upstream report; do not add a second syncing listener.

```text
apps/cli ──▶ core/node, blocks, lint, apps/web       apps/web ──▶ core/browser, blocks, lint
apps/server ──▶ blocks                    apps/desktop ──▶ cli sidecar + web assets
core ──▶ blocks, lint                     lint ──▶ blocks
host-tanstack ──▶ host-runtime, blocks     host-runtime ──▶ blocks    blocks ──▶ ∅
```

MVP layout is `packages/{core,blocks,lint,host-runtime,host-tanstack}`, `apps/{cli,web,server,desktop}`, `examples/host-tanstack`. No protocol/preview/ai/editor packages. Core model owns mutation; store imports neither model nor ops and writes only store-local snapshots, updates, receipts, export history and intents; ops composes model/store/export/bundle/rewrite. Explicit package exports expose core `.` (pure reads/types) and `./node`, host `./remark` and `./block`. Root `tests/boundaries.test.ts` checks static/dynamic imports, relative sibling escapes and core layers. Its mutation grep/AST rule permits mutable Loro calls only in core model and the editor binding; scratch projection updates also live in model. Exports reject deep imports. Host code never imports core, storage or authored component implementations.

Tooling is mise + Vite+ for tests (`vite-plus/test` with `vite.config.ts`), lint, formatting and non-MF apps (`apps/web` retains Vite and its Loro optimizeDeps exclusions). TanStack Start is required; all MF hosts and component builds use Rsbuild/Rspack and `@module-federation/rsbuild-plugin`, with `@tanstack/react-start/plugin/rsbuild` on hosts. Lachlan chose this on 2026-11-05: the Vite MF plugin was spiked and worked but is no longer used. `blocks`, `host-runtime`, `host-tanstack` are `vp pack`-published under `@composedink`; React is a peer plus dev dependency. The authority materializes files in `$COMPOSED_HOME/build/<id>/<hash>/`, generates devDependencies for react/react-dom/@rsbuild/core/@rsbuild/plugin-react/@module-federation/rsbuild-plugin at catalog versions and @composedink/blocks as a workspace link (published version in 09/12). Resolve the lock with --lockfile-only, hash files/lock/settings, then install frozen with --ignore-scripts. Rsbuild's programmatic API builds three singleton shares with `import:false` and `requiredVersion:false`. Remotes expose `./block` through a `var` library named from id+version; the runtime-only host registers remoteEntry.js with `type:"global"`. Local bundling location and artifact PUT publication stay unchanged. Server bundling moves to P2 with sync, an explicit grounding deviation.

## Behavior

**Base-relative apply/import:** resolve and validate retained document base; fork at it. Project full/clean view with a UTF-16 source map. On a scratch text use `LoroText.update(input)` and read delta hunks; map them back into the base fork. Clean-view insertions at hidden-span edges land before hidden text. Direct applies branch deltas and merges branch updates into authority history; propose leaves live prose unchanged and expands hunks to sentence/structural MDX units. Two cursor sets do two jobs. **Live anchors** are created in the base fork on the unit's own first character (side Left) and last character (side Right); they decide attachment in the live document, and typing at either edge lands outside. **Extraction cursors** are created in the agent's fork _after_ its delta is applied, on the post-edit unit's first and last characters (an emptied unit anchors to its neighbours: the character before with side Right and the character after with side Left). Import the agent fork's updates into a fork of the current head and read the interval between the extraction cursors from that merged fork: that is the proposal version, never base text. Live anchors cannot do this job — when the agent replaces the unit's first word, the base character the live start anchor sits on is deleted and resolves after the agent's inserted text, dropping it (plan 04 reproduced this). The version is **authorship-filtered**: a character of the merged interval is part of the version only if the agent authored it (its cursor `pos().peer` is the agent fork's peer) or it lies inside the live-anchor interval resolved in the merged fork. Without the filter, concurrent inserts at the unit's edge (the human types `LEFT ` where the agent inserts `Agent`) are ordered by peer ID, and one order swallows the human's edge text into the version, which a flip then duplicates (plan 04 reproduced it). With it, human concurrent edits inside the range survive a flip because they are part of the merged interval, and edge text stays outside regardless of peer order. Resolve both cursors in current history: an empty interval (including both having `update` set and collapsing) detaches to stash with `reason:"detached"`. Otherwise attach the merged version to that interval. Partial deletions attach with deletion preserved; never relocate detached proposals. Normalize once after the transaction. Outside files use **lock.base**, never latest. Proposed frontmatter changes fail before mutation with an instruction to use explicit human direct acceptance; YAML cannot safely contain an alternative chooser spanning its structure.

Export order is: import outside edit → snapshot head → project → validate/resolve/evaluate → write intent → rename MDX → rename lock → complete. A target lease prevents multiple documents exporting to one path. Reconciliation uses human file-acceptance capability and a receipt keyed `(target path, lock.base, sha256 of outside file)`, committed in the same durable transaction as merged import. Repeated import, including after crash, returns that receipt. Store-local per-destination export history records `(mdxHash,lockHash,base,at)`. Before importing, if file hash matches any earlier export rather than current lock, fail with RecoveryRequired naming the versions; never diff it. The intent retains old/new hashes and prepared bytes. On restart finish only a matching pending intent; preserve unexpected edits and report RecoveryRequired. A bare mismatched pair without that intent fails, never guesses a base. Production preview locks render fallback only with one actionable warning and no remote registration. Missing instance, bad literal/schema, invalid clean syntax, fallback timeout or unresolved release pin fails without advancing the previous valid lock. No host build requires the preview server for fallback SSR.

If an entire sidecar is removed, the host cannot distinguish a composed tag from arbitrary local JSX; the resulting unresolved MDX component is an error at render/build. Export recreates the lock; tests must cover missing instance entries and missing sidecars. Do not treat all unknown FIGURES as composed tags.

Compaction installs a full-history snapshot before pruning the update segment it includes; crash recovery replays the remainder. Receipt retries cover lost acknowledgements, including publish/export side effects via durable intents. Corrupt committed bytes are reported and preserved, never silently discarded. Editor unsaved state remains visible until durable acknowledgement.

Verification uses real operations with temporary homes, spawned CLI/MCP clients, fault injection around writes, and Playwright against editor/example. The tracer proves imports, singleton identity, prerender, remote failure and lock invalidation; later plans prove concurrent apply, detached anchors, clean mapping and policy repair.

## Decisions

The final decisions supersede candidate assertions. Rejected alternatives and reasons:

| Rejected                                                               | Reason / accepted choice                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| B per-peer files, fs.watch multiwriter import, any-process compaction  | one elected authority owns history and policy; no racing compaction                                                                    |
| A permanent apps/local daemon and SQLite journal                       | short commands may own inline; long-running commands auto-start studio; full-history Loro files plus intents/receipts provide recovery |
| A canonical rewrite of incoming typing history                         | import bytes unchanged, then explicit normalization commit                                                                             |
| browser ops / second CodeMirror sync listener                          | local events are ignored; authority ops return as imports                                                                              |
| separate frontmatter map/text, AST authority or second Markdown copy   | full source belongs to mdx; host owns frontmatter schema                                                                               |
| frontiers in YAML/comment and composed.json                            | sidecar lock avoids host metadata conflicts and carries exact projection/instances                                                     |
| stored active index, cursor-keyed alternatives                         | one missing-text slot derives activity; random AltId separates identity from anchors                                                   |
| host fetch/import of fallback.mjs, federated SSR                       | export materializes Markdown; host builds have no component execution/network dependency                                               |
| Zod/Valibot component schemas, separate block.json                     | literal typed schema is extractable without running account modules or duplicating metadata                                            |
| A load callback/dependencies inside defineBlock                        | B component signature retained; package.json owns component dependencies                                                               |
| B React-only components / post deps as exact lock / transitive roll-up | bundle own dependencies; export lock resolves intent; roll-up deferred to P5                                                           |
| MVP server bundling                                                    | server lacks synced source until P2; local authority builds                                                                            |
| iframe on every MVP/published block                                    | own authored code already trusted like existing figures; avoid iframe UX/integration cost                                              |
| A blocksFor/post resolver and general host integration                 | B remark injection leaves PostPage and FIGURES intact                                                                                  |
| protocol, preview, ai, editor packages now                             | no second runtime consumer; editor stays in web, rewrite in core                                                                       |
| agent direct flag authorized by by:human                               | capability belongs to adapter; attribution cannot grant permission                                                                     |
| silently reattach deleted proposals / diff against latest              | stash detached work; fork at exported/read base preserves concurrent edits                                                             |
| host-in-ID and global discovery now                                    | device scope map, absolute locked URLs, unchanged composed IDs                                                                         |
| mobile runtime choice now                                              | P4 webview IME/selection/WASM spike decides Tauri mobile versus Expo DOM                                                               |
| RSS fallback bodies                                                    | hellotimber intentionally publishes summaries                                                                                          |

Accepted costs: binding replica, serialized local writes, retained history, two-file export recovery, layout shifts on remote swap, JSON props without children, full-page preview reloads, and HTTPS/immutable-URL trust for ESM (sourceHash is provenance, not browser-enforced remote SRI). MVP remote execution is in-page. P3 introduces sandboxed usercontent for untrusted components in editor/preview/share hosts; published blogs retain in-page remotes by explicit decision.

Resolved: IDs are `composed:<scope>/<name>`; author scope config resolves artifact servers; v1 never uses federated SSR; mobile is P4 pending evidence. **Phase 1.5 (2026-11-06, `writing-process.md`, plans 13–15)** adds document kinds, rulesets, zen mode, edit measurements with a sentence-length sparkline, offline comment threads and directed model feedback. P2 adds sync/accounts/tokens/relay, then shared preview links with named-guest commenting (refused when signed out), ideas, remote MCP and server builds; P3 render sandbox and multi-user live editing; P4 mobile/local inference; P5 listing/npm export and dependency roll-up. No placeholders ship for these.

First unit: [01 tracer bullet](../plans/01-tracer-bullet.md). R1 federation compatibility/React identity, R2 both binding early returns, and R3 injected-lock invalidation are **to be proven by** its evidence. The old async host fallback-import risk is removed. Clean mapping, cursor edges, lint latency and desktop packaging have explicit later checks. No candidate's “proven” phrasing represents an executed experiment.

### Tracer evidence and MVP units

The tracer is one post with `<Hello name="Lachlan" />`, one inline block with a useState counter, and the real TanStack example. It ships doc.create/read, component.create/read/**write**, deps.add(dev), preview export, studio binding and generated CLI. It has no alternatives/dim/stash/lint/model/publish stubs and no iframe. To be proven by the real Playwright/CLI script:

1. Editor typing appears in a separate CLI process and survives authority restart.
2. Export MDX equals the read projection; lock contains the exact dev artifact and canonical instance Markdown.
3. Actual prerendered HTML and a JS-disabled visit contain the strong-text fallback; SSR imports no component code.
4. In the example dev preview, remote loads, two clicks show clicked 2, and host/remote React identities compare strictly equal; no extra React implementation is loaded. Host output excludes the remote implementation sentinel.
5. A blocked remoteEntry leaves fallback, failed state and one warning.
6. component.write changes fallback.ts; the studio subscription rebuilds, evaluates fallbacks and re-exports preview pairs for posts pinned to that component @dev. Write → new dev SSR response takes at most two seconds; no component.edit needed. The tracer copies example content into its temp home and exports there; committed input lives under examples/host-tanstack/fixtures/, never content/tracer/index.mdx.

| Unit | Scope                                                               | Depends on  | Completion evidence                                               |
| ---- | ------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| 01   | explicit studio, preview subscription, minimal editor R2 spike      | —           | six assertions above                                              |
| 02   | election/inline/stale recovery, store durability and local receipts | 01          | owner contention, fault points, old bases survive compaction      |
| 03   | editor transport/undo foundation, repeat R2 gate                    | 02          | ordered imports, reconnect, view equality                         |
| 04   | alternatives + agent apply + MCP, corresponding UI                  | 03          | stale-base human edit survives, detached stash, capability checks |
| 05   | dim/stash/clean mapping, corresponding UI                           | 04          | independent projection oracle and UI round trip                   |
| 06   | lint                                                                | 05          | positioned diagnostics and measured incremental latency           |
| 07   | model rewrites                                                      | 05          | provider double proposes, never overwrites                        |
| 08   | component authoring/live preview                                    | 03,05       | own bundled dependency, checked file sync, last-good preview      |
| 09   | publish/artifact server/release import                              | 02,04,05,08 | immutable retries, offline host build, tarball consumer           |
| 10   | hellotimber adoption (hellotimber plan 33, in that repo)            | 12          | folder globs, real build, no-JS fallback, summary feed unchanged  |
| 11   | desktop                                                             | 03–09       | packaged relaunch/CLI visibility/one authority                    |
| 12   | deploy server + npm integrations, device scope config               | 09          | cdn.composed.ink, npm installs, real locked URLs                  |

Run 12 before hellotimber's plan 33: deploy the container at Lachlan-owned `cdn.composed.ink`, publish `@composedink/{blocks,host-runtime,host-tanstack}` from `vp pack` outputs to Lachlan-created npm org `composedink`, and configure the author device scope → server. DNS/TLS are human tasks in plan 12.

All units require vp check --fix and recursive tests. Their [index](../plans/README.md) names per-unit commands. The editor is deliberately widened across 03/04/05/07 so no completion test invokes a later unit's operation.
