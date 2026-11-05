# Plan 07 — Model rewrites as alternatives

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 05. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** Mod-Shift-R proposes model versions through the same authority alternative operation; provider failure cannot overwrite prose.

**Files:** `packages/core/src/rewrite.ts`, `src/ops/registry.ts`, `tests/rewrite.test.ts`; `apps/cli/src/config.ts`; `apps/web/src/editor/rewrite.ts`, browser tests. No ai package.

### Task 1 — Add one provider contract

- [ ] Define request `{text,instruction?,count}` and result `{versions:string[]}` behind a provider function in rewrite.ts. Initial adapter is an OpenAI-compatible `/v1/chat/completions` endpoint. Endpoint/model and token reference belong in device configuration, never Loro/export locks. Avoid logging prompts/tokens by default.
- [ ] Write HTTP-double tests first: valid three versions, malformed/empty response, timeout, cancellation, unauthorized endpoint and provider error. Validate count and response size as resource controls, not arbitrary writing limits. Return ProviderFailed with a concrete configuration fix; source remains unchanged.
- [ ] Implement `alt.rewrite` as a mutating request-receipted operation. Capture base selection and text before provider call, release the authority queue while awaiting HTTP, then re-enter the queue to propose against the captured base. In-flight same request shares work; a lost acknowledgement replays the receipt. Deleted target becomes detached stash, same as agent apply. No provider writes Loro directly.

### Task 2 — Expose the writing action

- [ ] Register real CLI/MCP/socket op now; command `composed alt rewrite <doc> --base <base> --quote <text> --count 3`. Studio Mod-Shift-R gathers selection/base and shows pending/cancel state. Provider output becomes one alternative with original live version plus returned versions, attributed by model name.
- [ ] Route acceptance/cycling through existing alt operations; do not select a generated version automatically. Cancellation ignores late provider output before commit; committed receipt remains authoritative if cancellation races completion.
- [ ] Document endpoint setup and an Ollama-compatible example in core README. Manual Ollama llama3.2 trial is optional external-provider evidence; tests must pass without a model download or cloud credentials.

**Verification:** run `mise exec -- vp run @composedink/core#test`, `mise exec -- vp run composed-cli#test`, `mise exec -- vp run composed-web#e2e`. HTTP double returns three rewrites; visible source is byte-identical, one alternative has four versions. Human changes another paragraph during request; that edit survives. Delete target while waiting; output lands only in detached stash. Repeat request after simulated lost ack and observe same result IDs. Failure/cancel produces no partial alternative. Browser keyboard invocation, flip and keep work through authority imports.

**Out of scope:** WebLLM, Prompt API, llama.cpp/Foundation Models, streaming token edits, autonomous acceptance, a separate ai package. P4 adds on-device providers after a second runtime demonstrates the need.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.
