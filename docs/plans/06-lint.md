# Plan 06 — On-device lint and style feedback

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 05. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** actionable, positioned prose/style diagnostics without changing live text or blocking typing.

**Files:** `packages/lint/{package.json,tsconfig.json,vite.config.ts,README.md,src/index.ts,src/prose.ts,src/rules.ts,src/worker.ts,tests/lint.test.ts}`; `packages/core/src/ops/registry.ts`; `apps/web/src/editor/{lint,diagnostics}.ts`; browser tests and lint timing fixture. Add catalogued harper.js 3, declaring only required dependencies.

### Task 1 — Build the pure diagnostic contract

- [x] Add package source export and allowed dependency lint→blocks; core/web/CLI may consume lint. Extend boundary guard without opening arbitrary imports. Use immutable text/base snapshots; lint never imports mutable Loro APIs.
- [x] Write expected-position fixtures for grammar, long sentences, passive voice, adverbs, simpler words, mid-sentence bold, long bullets and invalid block props. Derive prose spans from Markdown/MDX syntax: skip frontmatter, code, JSX syntax/prop expressions, URLs and fallback-generated content. Preserve original UTF-16 offsets.
- [x] Run Harper in a worker, cache the instance/dictionary, and lint changed paragraphs. Rules return `{from,to,code,message}` with optional proposed replacement; schema checks use blocks.validateProps, not a second schema evaluator. Keep rule thresholds explicit and testable.
- [x] Implement registered read-only `lint`; generated CLI exposes `composed lint <doc>` and MCP lists it. Do not advertise comment/review-note operations from later sharing work.

### Task 2 — Render safe feedback

- [x] Add editor underlines and diagnostic panel. Tag work/results with base frontiers; discard stale results or map only with a proven mapping. Cancellation must keep the newest result authoritative.
- [x] Suggested corrections use alt.propose, never automatic replacement. Diagnostic dismissal is editor-local; do not persist derived lint results into Loro. Persist explicit editable rule settings in device config when needed; automatic promotion of reviewer notes waits for sharing.

**Verification:** run `mise exec -- vp run @composedink/lint#test`, `mise exec -- vp run composed-web#e2e`, and `mise exec -- vp run @composedink/core#test`. Browser types a fixture and sees expected underline ranges; proposing a fix leaves source unchanged until flip; stale worker reply cannot overwrite a newer result. Benchmark warm incremental lint on a 5,000-word fixture in Chrome, targeting under 50 ms for changed-paragraph work. Report machine, cold WASM initialization separately, timed span, changed words and repeated samples. This is an evidence target, not a made-up guarantee: if it fails, reduce unnecessary rescans and report actual results; do not hide initialization or stale-work failures. No CPU timing assertion belongs in ordinary unit tests.

**Out of scope:** AI grammar service, automatic rewriting, plagiarism detection, persisted comments, cross-device rule sync, mobile.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.

## Implementation log

2026-11-05 — Harper probe, before implementation. Installed catalogued harper.js 3.0.0
using mise/vp. LocalLinter + binaryInlined loads offline in Node 22.22.3 and Vite dev
(Chromium, optimizeDeps.exclude harper.js). No file-URL fetch shim is needed.
`lint`, `span`, `message`, `suggestions` expose positioned results; `😀 This is an test.`
returns `an` at UTF-16 [11,13), not code-point offsets. Cache the instance/dictionary.
Node cold setup 935.65ms; full 5,000-word lint 229.43ms. Chromium cold setup 825.60ms;
full lint 177.20ms. Evidence: test-results/plan-06-harper-{node.log,browser.json},
probe runner retained there. These are initial probes, not incremental acceptance.

Task 1 verified. Source-export lint package depends only on blocks and harper.js;
immutable snapshots, worker-held dictionary/cache, syntax masking with UTF-16 offsets,
eight positioned diagnostic families and validateProps. Registered read-only lint is
exposed in CLI and MCP. Core worker never imports Loro in the lint package. Exact
fixture regressions include emoji, nested JSX, code links, incomplete fences,
fallback comments, shifted cached paragraphs and invalid props.

Gates: plan-06-task1-check.log (120 files, zero warnings/errors), lint-tests.log
(3 tests), core-focused.log (read-only + real block props), boundaries.log (2 tests),
cli-tests.log (real binary and MCP), task1-all-tests.log (8/8 workspace tasks).
The initial fixture failed before implementation (plan-06-red.log). Worker benchmark
is tests/lint-benchmark.ts with packages/lint/tests/long-post.ts; 5,000 words,
200 distinct paragraphs, 26 changed words per warm sample. Apple M1 arm64,
Chromium 156.0.8078.4; 20 samples re-lint exactly one paragraph, engine 1.4–7.1ms,
round trip 1.6–7.4ms; cold worker/module/WASM/dictionary plus first lint 3268.60ms.
Initial isolated WASM initialization is recorded separately above. Raw samples,
machine, timing span and cold result: test-results/plan-06-latency.json.
No contradiction or stop. Task 2 remains pending.

2026-11-06 — Task 2 verified. Added CodeMirror positioned underlines, writing
feedback panel, editor-local dismissal (reload restores feedback), worker lifetime
cleanup and frontier/request cancellation. Every source edit clears decorations;
only the current request at the exact current Loro base can render. Suggestions
flush pending typing and recheck the captured base before alt.propose; source is
unchanged until an explicit flip. Block inspection supplies immutable schemas/props
at its read base; the worker uses validateProps and ignores stale inspection data.
No derived diagnostics enter Loro. No editable settings or reviewer-note promotion
were needed. Added variable-length inline code delimiter regression during final
syntax review.

Final gates (test-results/):

- plan-06-final-check.log: format, lint and types pass, 125 files, zero warnings/errors.
- plan-06-final-tests.log: 8/8 workspace tasks; core 22 files / 78 tests including
  the 1,000-write durability scenario. Required separate core command also passed:
  plan-06-core-lint.log (78 tests); final lint-operation focused test passes.
- plan-06-final-lint.log: 2 files / 3 tests; plan-06-final-web-unit.log: 3 files / 3 tests.
- plan-06-final-web-e2e.log: 4/4 suites. Browser verifies UTF-16 ranges, underlines,
  proposal/no replacement, flip, local dismissal and restoration on reload,
  deliberately delayed stale worker work, newest reply and invalid block props.
- plan-06-final-host-e2e.log: all six tracer assertions true, shared React identity
  true, refresh 1095.821ms. Production editor build and packaged worker path pass
  (plan-06-web-build.log, plan-06-packaged-lint.log). Harper's inlined binary emits
  a separate 27.36MB worker; the build retains its large-chunk advisory.
- Final benchmark after syntax changes: Apple M1, darwin arm64 25.3.0, Chromium
  156.0.8078.4. 5,000 words / 200 distinct paragraphs; 26-word changed paragraph;
  20 warm samples each re-lint one paragraph. Engine 1.7–10.1ms, median 1.95ms;
  worker round trip 1.8–10.2ms, median 2.25ms. Cold first worker request 3371ms
  includes module loading, WASM/dictionary initialization and first full lint.
  Isolated setup timings remain in the initial probe above. The measured span
  includes source masking/cache lookup, changed rules/Harper, result assembly and
  message delivery; editor debounce (120ms) is outside compute timing. Raw samples
  and machine details: plan-06-latency.json; runner tests/lint-benchmark.ts.

Evidence index: test-results/plan-06-evidence.md; browser accounting/screenshot:
plan-06-web.json, plan-06-lint.png. Task 1 commit is 124d9e1; the following
feat(web) commit completes Task 2. No contradiction or stop. No hellotimber changes.
Push to origin main follows this verified task commit.
