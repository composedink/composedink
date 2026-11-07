# Implementation Plans

Each plan is self-contained: an implementation agent needs this index, its assigned plan,
and the repository's operating instructions. [The design](../design/composed.md) explains
the contracts and decisions; plan 01 contains the complete first slice.

> **For agentic workers:** work on exactly your assigned plan, task-by-task (one task =
> one assignment). Tick checkboxes and commit each verified task. Do not start another
> plan to fill a gap. If a plan contradicts code or a contract, stop and report the
> discrepancy; do not improvise. No placeholder operation or future command counts as
> completion. CLI/MCP lists contain only implemented operations.

| #   | Plan                                                                                          | Builds                                                                                                  | Depends on     | Status                                                 |
| --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------ |
| 01  | [Tracer bullet](./01-tracer-bullet.md)                                                        | source workspace, explicit studio/web serving + preview subscription, real MF remote, lock-only example | —              | done 2026-11-05                                        |
| 02  | [Authority and store durability](./02-authority-store-durability.md)                          | election/inline/stale recovery, local receipts/history, full-history compaction                         | 01             | done 2026-11-05                                        |
| 03  | [Editor](./03-editor.md)                                                                      | R2 gate, reliable binding/transport, source UI, undo foundation                                         | 02             | done 2026-11-05                                        |
| 04  | [Alternatives, agent apply and MCP](./04-alternatives-agent-mcp.md)                           | alternatives UI/ops, base apply, detached stash, capability adapters                                    | 03             | done 2026-11-05                                        |
| 05  | [Dim, stash and clean view](./05-dim-stash-clean-view.md)                                     | marks/projection mapping, complete writing UI                                                           | 04             | done 2026-11-05                                        |
| 06  | [Lint](./06-lint.md)                                                                          | Harper/style rules, worker, underlines                                                                  | 05             | done 2026-11-06                                        |
| 07  | [Model rewrites](./07-model-rewrites.md)                                                      | OpenAI-compatible provider and proposed rewrites                                                        | 05             | done 2026-11-06                                        |
| 08  | [Component authoring and preview](./08-component-authoring-preview.md)                        | checks, own npm dependencies, file sync, sustained live preview                                         | 03, 05         | done 2026-11-06                                        |
| 09  | [Publish and artifact server](./09-publish-artifact-server.md)                                | immutable PUT/GET, release locks, outside import, npm tarballs                                          | 02, 04, 05, 08 | done 2026-11-06                                        |
| 10  | hellotimber adoption — moved to hellotimber `docs/plans/33-composed-adoption.md` (2026-11-06) | consumer-side; `examples/host-tanstack` is the integration test here                                    | 12             | lives in hellotimber                                   |
| 11  | [Desktop shell](./11-desktop-shell.md)                                                        | packaged macOS Tauri app/sidecar                                                                        | 03–09          | done 2026-11-06                                        |
| 12  | [Deploy](./12-deploy.md)                                                                      | cdn.composed.ink container, npm integrations, author scope config                                       | 09             | done 2026-11-06 (staging, npm 0.1.0, cdn.composed.ink) |
| 13  | [Kinds, rulesets and zen](./13-kinds-rulesets-zen.md)                                         | user-owned kinds/rulesets, custom patterns, effective rules, quiet drafting                             | 06, 11         | done 2026-11-06                                        |
| 14  | [Edit measurements](./14-edit-measurements.md)                                                | configurable prose rule table, severities, sentence-length sparkline                                    | 13             | done 2026-11-06                                        |
| 15  | [Threads and feedback](./15-threads-and-feedback.md)                                          | offline anchored comments, directed model review, comment column                                        | 13, 07         | in progress                                            |

Dependency order is `01 → 02 → 03 → 04 → 05`, then `06/07/08`, then `09 → 12 → 10`.
Plan 11 follows the completed writing/component units through 09. The default execution
order is 01–09, 12, 10, 11; 11 can follow 09 independently. The 06/07/08 branches are not automatically parallel-safe: they share
registry, editor and dependency files; coordinate ownership if explicitly assigned in
parallel. No delegation is implied by this index.

Plan 03 is earlier than Candidate B's editor unit: the minimal R2 binding spike already
runs at the start of editor work in 01, then is repeated in 03 **before** 04 sends mixed
alts/mdx imports. Alternative and dim controls arrive with 04/05, so no editor completion
test invokes a later command. Plan 01 explicitly includes component.write for its sixth
tracer assertion. Plan 01 ships the preview-pair rebuild subscription without election. Plan 02 adds
inline/election/stale recovery. Production preview locks always render fallback only
and warn once per post; 09 adds release-lock production evidence, retaining a preview
fixture that proves no remote registration.

## Verification commands

Run all commands from composedink's root unless a plan says otherwise. Install using
`mise install` and `mise exec -- vp install`. Tests import from `vite-plus/test`; test
configuration belongs in `vite.config.ts`. Never install tools globally, edit generated
lockfiles by hand, or add internal library build scripts. apps/web may build for studio packaging on Vite, retaining Loro optimizeDeps exclusions.
TanStack Start is required. All MF hosts/remotes use Rsbuild/Rspack; hosts use Start's
Rsbuild plugin and remotes use `@module-federation/rsbuild-plugin` (named var/global entries).
The hellotimber website migration is hellotimber's plan 33, in that repo; `examples/host-tanstack` is this repo's integration test of the published packages.
The Vite MF spike worked but is no longer used (Lachlan, 2026-11-05). Internal consumption is from
TS source; only blocks/host-runtime/host-tanstack get public `vp pack` outputs.

Every unit runs `mise exec -- vp check --fix` and `mise exec -- vp run -r test`, plus its
row below. These are commands implementers create/execute, **not evidence already run**.
Root boundary tests are included in the common test gate.

| Plan | Additional commands                                                                                                                                                                                                                                            | Completion evidence                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 01   | `mise exec -- vp run host-tanstack#build`; `mise exec -- vp run host-tanstack#e2e`                                                                                                                                                                             | all six tracer assertions, strict React identity, R2 cases, no-JS/blocked remote, component.write → rebuild/re-export → SSR ≤2 seconds |
| 02   | `mise exec -- vp run @composedink/core#durability`; tracer e2e                                                                                                                                                                                                 | barrier contenders → one SQLite owner, kill -9 takeover, crash-before-owner.json, starting wait, durable receipts/old bases            |
| 03   | `mise exec -- vp run composed-web#test`; `mise exec -- vp run composed-web#e2e`; tracer e2e                                                                                                                                                                    | binding equality, ordered socket ops, reconnect and separate keystroke/operation undo                                                  |
| 04   | `mise exec -- vp run @composedink/core#test`; `mise exec -- vp run composed-cli#test`; web e2e                                                                                                                                                                 | Loro ¶2/¶4, deletion/replacement/partial deletion, edge sides, inside-range edit survives flip; MCP capability                         |
| 05   | core tests, web e2e, tracer e2e using the same commands above                                                                                                                                                                                                  | independent clean-map oracle, hidden text retained, mark/flip/stash/undo UI                                                            |
| 06   | `mise exec -- vp run @composedink/lint#test`; core tests; web e2e                                                                                                                                                                                              | positioned diagnostics, stale replies discarded, measured changed-paragraph latency                                                    |
| 07   | core/CLI tests; web e2e                                                                                                                                                                                                                                        | HTTP-double rewrites, pending concurrent edits, failure/cancel/retry behavior                                                          |
| 08   | core/CLI tests; tracer e2e                                                                                                                                                                                                                                     | real file sync, bundled own dependency, ≤2-second small-fixture refresh, last-good retention                                           |
| 09   | `mise exec -- vp run composed-server#test`; core tests; tracer e2e; `mise exec -- vp pack` in each public package                                                                                                                                              | immutable retry/409, release offline build, preview fallback/warning, idempotent outside import, old-MDX/current-lock rejection        |
| 11   | `mise exec -- vp run composed-desktop#smoke`; web e2e; core durability                                                                                                                                                                                         | packaged app persists across relaunch, CLI sees edits, one authority without development Node                                          |
| 12   | server/core tests; tracer build/e2e; `mise exec -- vp pack` per public package; deployment/npm smoke in plan                                                                                                                                                   | HTTPS immutable URLs, npm-installed host, author scope → real server; human DNS/TLS confirmed                                          |
| 13   | `mise exec -- vp run @composedink/core#test`; `mise exec -- vp run @composedink/lint#test`; `mise exec -- vp run composed-cli#test`; `mise exec -- vp run composed-web#test`; `mise exec -- vp run composed-web#e2e`; `mise exec -- vp run composed-web#build` | kind-created doc runs its rules; disabling a rule silences editor and lint; zen hides and restores                                     |
| 14   | `mise exec -- vp run @composedink/lint#test`; `mise exec -- vp run @composedink/core#test`; `mise exec -- vp run composed-web#test`; `mise exec -- vp run composed-web#e2e`; `mise exec -- vp run composed-web#build`                                          | every rule has positive/negative MDX-aware fixtures; sparkline buckets match the prose pass                                            |
| 15   | `mise exec -- vp run @composedink/core#test`; `mise exec -- vp run composed-cli#test`; `mise exec -- vp run composed-web#test`; `mise exec -- vp run composed-web#e2e`; `mise exec -- vp run composed-web#build`                                               | offline threads survive edits/detach on deletion; model answers become threads and alternatives                                        |

**Update Status** (`not started → in progress → done`) only as verified work lands.
Commit messages name the changed package/behavior; stage only assigned files. A design
or plan document being written does not mark its implementation done.

**Consumer authorization:** hellotimber adoption is hellotimber's plan 33, executed there under
its own conventions when Lachlan is ready. Nothing in this repo changes consumer code.

**Phase 1.5 (writing process):** `docs/design/writing-process.md`, plans 13–15 (kinds and rulesets, edit measurements, threads and feedback). Shared preview links follow in P2 after accounts.

**Later phases:** P2 sync/accounts/device tokens/ideas/remote MCP/server bundling;
P3 sharing/comments/component.render and sandboxed usercontent in editor/preview/share
hosts; P4 mobile after a webview spike plus on-device AI; P5 listing/npm export of
components and dependency roll-up. Published blogs retain in-page remotes. None is an
MVP placeholder command.
