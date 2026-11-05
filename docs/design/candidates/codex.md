# composed — independent candidate

## 1. Design package

### Outcome and usage

Lachlan writes locally, keeps competing phrasings beside the words, and publishes ordinary MDX whose interactive figures remain independently deployable packages. His agent proposes; Lachlan chooses. The daily loop requires neither an account nor a model provider.

**Rewrite safely (workflows 2–3).** In the desktop app, select a sentence; Copy agent context includes its document, cursor range and base token. An agent can instead edit the whole body:

```sh
composed new post retries --title "Retries cost time"
composed cat retries --json > /tmp/retries-read.json
jq -r .mdx /tmp/retries-read.json > /tmp/retries.mdx
# Agent edits /tmp/retries.mdx, preserving frontmatter.
composed apply retries --base "$(jq -r .base /tmp/retries-read.json)" \
  --file /tmp/retries.mdx --propose --request rewrite-001
composed mcp  # stdio; exposes the same operation schemas
```

The MCP equivalent is `doc.read({doc:"retries"})`, then `doc.apply({doc:"retries",base,mdx,mode:"propose",request:"rewrite-001"})`. Each changed passage acquires alternatives without changing the visible prose. Hover and ↑/↓, or focus its marker and use Alt+↑/↓, cycles versions. “Keep” removes the chooser while retaining the active words; “Stash other versions” preserves leftovers in the side panel. Select text → Dim makes it readable grey; moving a selection to Stash removes it atomically. Agent tools never expose a force-overwrite switch.

**Build and preview a figure (workflows 4–5).**

```sh
composed component create lachieh/retry-chart --sample '{"attempts":3}'
composed component checkout lachieh/retry-chart --to /tmp/retry-chart
# Edit block.ts and RetryChart.tsx in this working directory.
composed component apply lachieh/retry-chart --from /tmp/retry-chart
composed component check lachieh/retry-chart
composed component render lachieh/retry-chart --props '{"attempts":3}'
composed deps add retries RetryChart composed:lachieh/retry-chart@0.1.0-dev.HASH
composed preview retries --to /path/to/hellotimber/website/content/writing \
  --url http://localhost:3000/writing/retries
```

`apply` prints the actual content-derived version replacing `HASH`. `render` returns structured errors, console messages and a screenshot path. The desktop’s Preview on blog button remembers these two destination values. It opens the real post layout; component edits produce a new development version, refresh the preview dependency lock and push a version event. Production dependencies never move implicitly.

The future consumer installs only `@composedink/host-tanstack`. Its Vite config adds `composed({content:"content/writing"})` before the existing MDX plugin. Its post uses:

```tsx
import { blocksFor } from "@composedink/host-tanstack";
// Existing TanStack PostPage, existing compiled MDX body:
const components = blocksFor(post.slug, FIGURES);
return <Body components={components} />;
```

An explicit resolver is also public: `<Block post="retries" name="RetryChart" props={{attempts:3}} />`. The editor/post contains `<RetryChart attempts={3} />`; export resolves it from the post lock, never from an ambient global registry.

**Publish (workflow 7).**

```sh
composed component publish lachieh/retry-chart --version 0.1.0
composed deps add retries RetryChart composed:lachieh/retry-chart@0.1.0
composed export retries --to /path/to/hellotimber/website/content/writing
mise exec -- vp run website#build  # in the consumer checkout
```

Export writes `retries/index.mdx` and `retries/composed.json`, then atomically exposes the complete folder. The HTML and RSS show the Markdown fallback; browsers replace it with the live figure when ready. A failed remote leaves the fallback readable. Outside edits return through `composed apply retries --file …/index.mdx`: the embedded base token selects the original export projection.

Acceptance: these four daily workflows survive restart and stale agent bases, and work in a production build with networking blocked after HTML delivery. Excluded from MVP: cloud accounts, cross-device sync, reviewer sharing, mobile shells, public registry discovery and built-in AI inference.

### Model

One Loro document per post, idea or component; full operation history is retained in MVP. This is the concrete persisted schema (container notation, not pretend Loro generic APIs):

```ts
// Post/idea roots
meta: LoroMap { schema: 1, id: string, kind: "post" | "idea", slug: string }
frontmatter: LoroText                 // YAML source; title/date/etc live only here
text: LoroText                        // MDX body, including JSX and Markdown syntax
// text mark: "dim" = true; expansion none
alternatives: LoroMap<CursorKey, LoroMap<{
  end: EncodedCursor,
  versions: LoroList<StoredSnippet | null>,
  active: number
}>>
stash: LoroList<{ id: string, snippet: StoredSnippet,
  origin?: CursorRange, reason: "cut" | "alternative" | "detached-proposal" }>
deps: LoroMap<Alias, ResolvedDependency> // direct entries + exact transitive closure
receipts: LoroMap<RequestId, Receipt>    // retry identity, payload hash, result

// Component roots
meta: LoroMap { schema: 1, id: string, kind: "component", scope: string, name: string,
  listed: boolean }
files: LoroMap<Path, LoroText>          // block.ts is the sole manifest source
buildLock: LoroMap<DependencyName, ResolvedDependency> // resolver-owned exact resolutions
releases: LoroMap<Semver, { sourceFrontiers: Base, artifactHash: string }>
receipts: LoroMap<RequestId, Receipt>
```

`CursorKey` is the encoded start cursor, including boundary affinity; `end` completes the range. No persisted numeric offsets. One chooser per nonoverlapping range. `StoredSnippet` contains text plus its Loro mark delta. Exactly one version slot is null, at `active`: its authoritative contents are the live text range. Cycling saves the outgoing slice in its slot, inserts the incoming slice and clears its slot in one transaction. Thus there is no competing active-text copy. Typing inside a chooser edits the active text; crossing chooser boundaries dissolves affected choosers into stash before applying the edit. A deleted anchor leaves a detached proposal requiring explicit relocation, never an automatic insertion elsewhere.

Dim exists only as marks. Stash is independent content, not hidden text in the body. Word counts, reading time, lint, resolved offsets, alternative previews and frontmatter metadata objects are derived. A dependency entry records exact ID, artifact hash, immutable entry URL, props schema and its dependency edges. Direct aliases are distinguished from closure entries by a tagged union. Component dependency requests live only in block.ts; buildLock holds their exact resolutions, with the build rejecting any mismatch. The resolver alone replaces this lock atomically; hashes and edge validation prove the closure. It rejects incompatible singleton requirements and cycles rather than choosing silently.

A component's `block.ts` owns schema, kind, presentation, fallback and direct dependencies. Build metadata is derived at its pinned source frontiers. Development version is `0.1.0-dev.<source-and-lock-hash>`; explicit semver releases bind to immutable artifacts. Listing changes only `meta.listed`; identity never moves.

### Interfaces and ownership

Public core types are opaque branded strings decoded at ingress: `DocId`, `Base`, `CursorRange`, `AltId`, `RequestId`, `ComponentId`, `ArtifactHash`. `Base` encodes document ID, schema, Loro frontiers and, for exports, projection identity. These signatures describe the operations contract; all commands return serializable values and typed errors.

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error:
  { code: "invalid" | "missing-base" | "conflict" | "unavailable";
    message: string; recovery?: string } };
type Read = { mdx: string; base: Base; alternatives: readonly AltView[] };
type Mutation = { doc: DocId; base: Base; request: RequestId };
type ExportBundle = {slug:string; files:Readonly<Record<string,string>>; base:Base};
interface Operations {
  doc: {
    create(x: {kind:"post" | "idea"; slug:string; title:string}): Promise<Result<DocId>>;
    read(x: {doc: DocId}): Promise<Result<Read>>;
    apply(x: Mutation & {mdx: string; mode: "propose" | "import"}):
      Promise<Result<{base: Base; proposals: readonly AltId[]}>>;
    export(x: {doc: DocId; dim: "include" | "omit"}): Promise<Result<ExportBundle>>;
  };
  alt: {
    propose(x: Mutation & {range: CursorRange; versions: readonly string[]}): Promise<Result<AltId>>;
    choose(x: Mutation & {alt: AltId; index: number}): Promise<Result<Base>>;
    keep(x: Mutation & {alt: AltId; leftovers: "discard" | "stash"}): Promise<Result<Base>>;
  };
  ghost(x: Mutation & {range: CursorRange; dim: boolean}): Promise<Result<Base>>;
  stash(x: Mutation & ({action:"cut"; range:CursorRange} |
    {action:"restore"; item:string; at:CursorRange})): Promise<Result<Base>>;
  lint(x: {doc:DocId}): Promise<Result<readonly Diagnostic[]>>;
  comment(x: Mutation & {range:CursorRange; question?:string; body:string}): Promise<Result<string>>;
  deps: { add(x: Mutation & {alias:string; id:ComponentId}): Promise<Result<Base>> };
  blocks: { list(x:{doc:DocId}): Promise<Result<readonly BlockDescriptor[]>> };
  component: {
    create(x:{scope:string; name:string}): Promise<Result<DocId>>;
    read(x:{doc:DocId}): Promise<Result<{files:Record<string,string>; base:Base}>>;
    apply(x:Mutation & {files:Record<string,string>}): Promise<Result<Base>>;
    check(x:{doc:DocId}): Promise<Result<CheckReport>>;
    render(x:{doc:DocId; props:JsonObject}): Promise<Result<RenderReport>>;
    publish(x:Mutation & {version:string}): Promise<Result<ComponentId>>;
  };
}
```

`mode:"import"` is explicit human acceptance of outside edits; CLI defaults to propose and MCP agents cannot request import. Local comments are stored in a separate Loro review doc keyed by post ID, containing cursor-anchored threads and targeted questions. `share` is added with sharing, not a nonfunctional MVP command.

```ts
// @composedink/blocks; schema is JSON Schema, props type inferred from it.
declare function defineBlock<const S extends PropsSchema>(x: {
  kind: "block" | "inline";
  props: S;
  editor: {label:string; sample: Infer<S>};
  dependencies: Readonly<Record<string,string>>;
  fallback: (props: Infer<S>) => string; // Markdown, evaluated only in sandbox
  load: () => Promise<{default: React.ComponentType<Infer<S>>}>;
}): BlockDefinition<S>;

// block.ts
export default defineBlock({
  kind:"block", props:{type:"object", properties:{attempts:{type:"integer", minimum:1}},
    required:["attempts"], additionalProperties:false},
  editor:{label:"Retry chart", sample:{attempts:3}}, dependencies:{},
  fallback: ({attempts}) => `**Retry chart:** ${attempts} attempts.`,
  load: () => import("./RetryChart"),
});

// @composedink/host-runtime: used inside isolated frame, never server-side
declare function loadBlock(lock: LockedBlock): Promise<LoadedBlock>;
// @composedink/host-tanstack and /vite exports
declare function blocksFor(slug:string, existing?:MDXComponents): MDXComponents;
declare function Block(p:{post:string; name:string; props:JsonObject}): React.ReactNode;
declare function composed(p:{content:string}): Plugin;
```

Ownership is explicit:

| Owner | Sole mutable state / supported path |
|---|---|
| `core` session | Authoritative Loro containers; every mutation through operations/transaction executor. No Loro objects escape. |
| `core` resolver | Dependency closure; only `deps.add` or an explicit dependency update changes it. |
| `apps/local` | Single local service, SQLite journal, filesystem exports, build jobs, local authenticated IPC/HTTP and SSE. CLI and Tauri both connect here. |
| `editor` | Selection, panels, disposable optimistic binding replica. `loro-codemirror` writes only this replica; trusted editor updates enter the core executor, which reconciles choosers and acknowledges durable commits. |
| `blocks` | Manifest validation; no document mutation or execution of account code. |
| `lint` | Derived diagnostics in a worker; accepts immutable snapshots, returns base-tagged results. |
| `host-runtime` | Federation instance/cache inside frame; immutable-version registration only. |
| `host-tanstack` | MDX resolver/plugin and parent frame lifecycle; derived fallback and lock artifacts only. |

The local service runs headless for CLI or is started by Tauri; a workspace lock elects one process. The editor replica is a transport/view cache, never another source of truth. One binding path handles typing and undo; no second CodeMirror text-to-core listener. Core owns the normalized transaction and its undo grouping. The binding replica sends proposed Loro updates to that executor; the executor stages and normalizes them before committing, then sends a canonical acknowledgement. No raw update bypasses chooser rules. Binding-update reconciliation is an explicit spike, not assumed library behavior.

Use these six packages and `apps/{local,cli,desktop}` plus `examples/host-tanstack`; no generic preview, protocol or AI package yet. Local owns the sandbox page and preview protocol until another consumer needs them. Core imports blocks' data contracts; editor imports core public contracts; host packages never import core/storage. Each package exposes only explicit `exports`, with no wildcard `src` exports or path aliases. TypeScript resolution rejects unexported package subpaths; a mandatory AST import-boundary test rejects relative sibling imports and forbidden dependency edges, including dynamic imports. `vp check` runs that guard. Only core imports mutable Loro APIs; editor's isolated binding module is the sole build-checked exception for its replica.

One runtime operation schema table generates CLI flags, MCP tools, service validation and documentation. `block.ts` generates props validation, sample forms and host descriptors. The post lock generates resolver names; handwritten duplicate name lists are forbidden. Export fallback instances are derived from `(artifact hash, canonical props hash)`, verified by the host plugin.

### Behavior

Reads return a consistent body/frontmatter snapshot and base. Apply checks the base belongs to this document and is retained. It forks at those frontiers, updates the fork's text using Loro's diff update, and obtains the base-relative changes. Import merges that branch's updates into the current document. Propose instead converts its hunks into cursor-anchored alternatives; it never merges proposed text into the live body. Concurrent text becomes the active version, not something replaced by the old base. Missing/deleted ranges retain detached proposals in stash. Frontmatter edits in propose mode return a conflict before any mutation; metadata editing is explicit in the desktop. Ordinary import handles frontmatter on the base fork too.

The executor serializes editor, CLI and MCP requests, commits Loro changes and request receipt to SQLite before acknowledging, then broadcasts updates. Same request and payload returns its original receipt; changed payload with reused ID fails. Restart replays the journal. Failed saves show “Unsaved” and retain the editor replica for retry. Do not compact away export bases in MVP.

Export captures one revision, omits stash, and by default projects away dim marks using `toDelta`; include-dim exports use `text.toString()`. Its signed/local-authenticated base token travels in an MDX comment. SQLite retains the exact exported projection and source mapping. Outside edits diff against that projection, apply mapped hunks to a fork at export frontiers, then merge; omitted dim text is preserved, not inferred deleted. Edited/absent tokens require explicit base selection, never guessing latest. Syntax-breaking dim omissions fail with the offending range. Folder replacement refuses externally changed output unless imported first; retry reconciles using the export receipt.

Account JS, including `fallback`, runs only on a separate usercontent origin in a sandboxed iframe; build workers compile files without executing their modules or arbitrary install scripts. A constrained isolated render worker evaluates fallback for each literal JSON-props invocation during export. Sanitized Markdown and hashes enter `composed.json`; SSR/RSS consume those values without importing remote JS. MVP composed blocks accept literal JSON props, not arbitrary MDX expressions/children. Trusted pre-existing blog figures keep their existing MDX behavior.

Parent SSR emits fallback, hydration initially emits identical fallback, then mounts the frame. Frame loads MF remote, validates props, renders, sends ready/height messages; parent swaps only on ready. Validate source window, origin and per-frame nonce; accept only bounded resize/status messages. Frames receive no service token or document content. React is singleton within the frame's federation scope, not across the origin boundary. Arbitrary code can still send data to networks; this is isolation, not a confidentiality guarantee.

Development SSE announces new immutable artifacts; the preview lock advances only after a successful check/build, and frame recreation eliminates module cache ambiguity. Production export pins semver artifacts at immutable CDN URLs; local service can upload to a configured static artifact destination without introducing accounts/registry discovery. Failed compilation keeps the last working preview and displays diagnostics.

### Decisions

Choose one authority, source-preserving editing, fallback-only SSR, and immutable component artifacts. Accept the binding replica and per-block iframe cost because they correspond to actual process/trust boundaries. The first verifiable unit is the complete thin tracer below; no broad framework scaffolding precedes it.

## 2. Tracer bullet

Implement one post, one `RetryChart` with a hook-backed button, one numeric prop and one fallback. Real: Loro persistence, CodeMirror binding, component files in their own Loro document, `defineBlock`, actual plugin-built federation artifact, runtime load, isolated usercontent frame, TanStack prerender, export folder and CLI command. Real source+lock hash identifies the dev artifact. The local service builds with Rolldown through the federation Vite plugin; it serves the same immutable assets later uploaded to a CDN. Stubbed only in the example harness: a single supplied workspace/destination and static local artifact origin; no account, resolver network, SSE, lint, alternatives or publishing UI. These absent features have no placeholder product commands.

One script `mise exec -- vp run tracer` creates a temporary workspace, seeds through core, launches the local service/editor fixture and TanStack example, exports and builds, then drives browser assertions. Another `vp run tracer:inspect` leaves the example running for human inspection. Tests must prove:

1. Typing a changed sentence and `attempts={4}` persists to Loro; restart and CLI read return both.
2. Built HTML contains “Retry chart: 4 attempts”; JavaScript disabled retains it. The server's import trace contains no component module.
3. Browser fetches versioned remote assets from the usercontent origin; button increments using React hooks, with no invalid-hook/hydration errors. Instrument identity equality between frame React and remote React.
4. Block remote requests: fallback remains; unblock and retry: figure replaces it. A malicious test component cannot access parent DOM/service credentials.
5. Host bundle contains neither RetryChart implementation nor its unique test string; interactive code arrived through MF.

Human sees editable source on one side, the actual post layout and working button on the other, with useful text before interactivity. Run first on Vite 8 with federation 1.23.x. If host remote loading/prerender fails, record the failure and switch only the example to TanStack's Rsbuild plugin, as grounding permits; do not hide failure behind static imports.

## 3. MVP plan

All units end with `mise exec -- vp check` and focused `vp run <unit>:test`; these are proposed task names. Tests import from `vite-plus/test`. No skipped tests, fake success commands or product TODO branches count as completion.

1. **Tracer** — Scope and proof above. Touch root mise/Vite+ workspace configuration; core, blocks, editor and both host packages' smallest public slices; local/CLI; `examples/host-tanstack`; browser tests. Dependencies: none. Evidence: `vp run tracer` passes every listed assertion, including production output and blocked network. Only needed surfaces exist at this boundary.
2. **Durable single-device editing** — Widen core transactions, local SQLite/IPC and editor binding; add Tauri macOS shell. Depends 1. Cover restart, process election, typing/undo and simultaneous CLI requests. `vp run local:test` kills after commit/before acknowledgement, retries ID and proves one edit. `vp run desktop:smoke` opens saved post after relaunch. Never expose an acknowledged but nondurable edit.
3. **Alternatives, dim, stash** — Core chooser/mark policies and editor decorations/panels. Depends 2. `vp run editing:test` uses selection/shortcuts to cycle word/sentence/paragraph alternatives, keep/stash/restore and undo each atomic action; UTF-16, deleted cursors, boundary edits and marked snippets survive restart. Export include/omit previews demonstrate the difference.
4. **Safe agent and outside-file editing** — Core fork/projection mapping, operations schema; CLI/MCP transports and idempotency. Depends 3. `vp run agent:test` actually calls stdio MCP and CLI against one workspace: agent reads A, human edits B, proposal preserves B; explicit import merges independent changes; old exported file edited after dim omission retains hidden text. Wrong/missing bases and metadata proposals fail visibly without partial writes.
5. **Component authoring and locks** — Core resolver and component operations; blocks schema; local isolated builder/render harness; CLI checkout/check/render/release. Depends 4. `vp run components:test` edits checked-out files, checks bad/good props, renders screenshot, locks transitive deps, rejects cycles/conflicts, publishes immutable semver, and proves repeat release cannot replace bytes. Component checkout uses base-token import, never latest-file overwrite.
6. **Real-blog preview and hot updates** — Local preview export/SSE plus host packages and example using the observed hellotimber layout/glob conventions. Depends 5. `vp run preview:test` changes prose and component code; real TanStack route updates without manual reload, bad build preserves previous version, disconnected SSE reconnects to latest descriptor. No modification to hellotimber during this design task; future consumer integration needs its own assigned plan.
7. **Daily writing feedback** — lint package, worker and editor diagnostics/local review-note UI. Depends 3–6. Harper plus sentence/passive/adverb/simpler-word/bold/bullet rules and schema checks; recurring local review notes can be promoted into explicit editable rules. `vp run lint:test` exercises editor-visible diagnostics and rule promotion, ignores code/JSX syntax, discards stale results and offers changes as alternatives.
8. **Publish and consumer migration** — Complete export, remote artifact upload and host integration; fixture first, separately authorized hellotimber changes second. Depends 6–7. Update both `posts.ts` and `bodies.ts` globs to `*/index.mdx`, fix `slugOfFile`, move all existing posts, preserve FIGURES and frontmatter query exclusion, add per-post composed resolver. `vp run publish:test` proves atomic folder export, no-JS/RSS fallback, immutable production locks and CDN outage behavior. Consumer `mise exec -- vp check --fix`, website tests and `vp run website#build` must pass; writing index/feed/sitemap remain unchanged for migrated posts.

**OUT of MVP:** Phase 2 adds Node/Bun+SQLite self-hosted sync, accounts/device tokens and remote MCP; one writer lease per document, not realtime coediting. Phase 3 adds capability shares, pinned/live frontiers, expiry/password/revoke and cursor comments using the existing review-doc model. Phase 4 evaluates mobile capture, then Tauri mobile. Phase 5 adds registry listing/discovery and cross-server resolution services; third-party npm-compatible distribution is later still. Phase 6 adds the single AI-provider contract with local WebGPU/Prompt API/Tauri inference and OpenAI-compatible endpoints; every provider can only propose. Agents already supply rewriting in MVP. No E2E encryption, plagiarism detection or Windows/Linux polish in v1.

## 4. Decisions, evidence and remaining risks

- **Scope resolution:** choose workspace scope→server configuration; keep settled `composed:user/name@version` IDs. Capture resolved origin/hash in locks so config changes cannot redirect published posts. Host-in-ID rejected as a second identity grammar. MVP supports one configured origin; Phase 5 adds multiple mappings with explicit scope collision errors.
- **SSR:** fallback-only always, even if federated SSR succeeds. Executing account modules server-side violates the trust boundary and makes publication depend on network execution. Export-time sandbox evaluation provides useful deterministic HTML without that dependency. Accept no dynamic server-only component data.
- **Mobile:** retain settled Tauri mobile direction; defer committing to its editing UX until Phase 4 tests selection, keyboard and WASM on iOS/Android. Expo DOM adds another runtime without evidence it fixes those problems. Failure of that spike reopens the choice explicitly.
- **Packages:** reject a general sync protocol, AI abstraction and independent preview package in MVP. Their consumers do not yet exist. Reject AST-as-authority and second Markdown copies; syntax belongs to LoroText. Reject direct server component evaluation and same-origin editor previews.
- **Verified grounding:** read hellotimber's post registry, bodies, PostPage, figure map/StateMachine, existing MDX, Vite config and package/contribution conventions. Its two globs currently assume flat files; folder migration therefore changes both readers and slug parsing, not only export. Existing figure code imports private site modules, so moving those figures into composed would require a separate portability project; MVP leaves them trusted/local.
- **Library evidence:** official [Loro text docs](https://www.loro.dev/docs/tutorial/text) confirm marks, UTF-16 cursors and diff update; [binding source](https://raw.githubusercontent.com/loro-dev/loro-codemirror/main/src/index.ts) exposes custom text-container selection. [Federation Vite docs](https://module-federation.io/integrations/build-tool/vite) document Vite 8 and remote loading. [Runtime docs](https://module-federation.io/guide/runtime/runtime-api) document registration/cache behavior. These establish capabilities, not this stack's successful integration; no runtime spike was run for this design.
- **Risks/spikes:** Unit 1 proves Vite/TanStack/MF and hook singleton behavior. Unit 2 must prove binding replica acknowledgements, chooser reconciliation and undo before editor widening. Unit 4 proves projection-aware base import and deleted-anchor safety with overlapping edits. Unit 5 tests malicious fallback execution, path traversal, build/resource limits and deterministic double-build hashes in isolated workers. Unit 6 tests cross-origin fonts/CSS, keyboard focus, resize and hot reload. Unit 8 tests host CSP/CORS and independent static deployment. An unresolved spike blocks its dependent unit rather than shipping a workaround or widening tolerance.
