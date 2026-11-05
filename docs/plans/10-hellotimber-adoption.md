# Plan 10 — hellotimber adoption

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 12 (which depends on 09). Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** consume the packaged integration in hellotimber while preserving its routes, frontmatter, figures, summary feed and writing metadata.

**Authorization:** this file only plans changes. Execute this unit in hellotimber's repository under its AGENTS.md/VISION.md/specs and a separately assigned/authorized task there. The current composed design assignment authorizes no hellotimber edits. Do not stage consumer files in composedink.

**Files in hellotimber:** `website/package.json`, root Vite+ fmt configuration, generated dependency lock, `website/vite.config.ts`, `website/src/writing/{posts,bodies}.ts`, affected writing tests, all `website/content/writing/*.mdx` moved to `<slug>/index.mdx`, and locks for composed-managed posts. Read-only references: frontmatter.ts, PostPage.tsx, feed.ts, FIGURES and routes. Add the consumer's numbered plan/index entry under its conventions when executing the authorized adoption.

### Task 1 — Establish regression evidence and install

- [ ] Read current consumer code first; candidate assumptions are not permission to work around drift. Run baseline writing tests/build and capture post slugs, metadata, feed summaries and representative SSR output. Existing figures that import private site modules stay local; moving them is a separate project.
- [ ] Install @composedink/host-tanstack from npm after 12 publishes @composedink/{blocks,host-runtime,host-tanstack}, update package manager lock through vp install. Add remarkComposed after remarkFrontmatter inside writingMdx; retain Shiki and the wrapper excluding query imports. Production option follows actual host build mode. hellotimber uses Nitro SSR (nitro/vite, Vercel output), not prerendering. Add `website/content/writing/*/composed.lock.json` to `fmt.ignorePatterns`: pre-commit runs vp staged → vp check --fix, and vp fmt formats JSON. MDX formatting is allowed (emphasis/bullets/JSX whitespace change) and round-trips through composed import; no whole-file host hash check.

```ts
// posts.ts: metadata only
const FILES = import.meta.glob<FrontmatterModule>("../../content/writing/*/index.mdx", {
  query: "?frontmatter",
  import: "default",
  eager: true,
});
// bodies.ts: compiled body, NO frontmatter query
const MODULES = import.meta.glob<MDXContent>("../../content/writing/*/index.mdx", {
  import: "default",
  eager: true,
});
// slugOfFile: directory name, validated with existing lowercase-slug rule
const slug = file.split("/").at(-2)!;
```

### Task 2 — Migrate content and exercise publication

- [ ] Move all existing posts into slug folders and update tests to folder-shaped keys. Preserve source/frontmatter bytes and relative assets/imports (adjust paths only where the move requires it). Do not hand-edit routeTree.gen.ts or dependency lock.
- [ ] Keep PostPage's `<Body components={FIGURES} />` unchanged. Remark injects its resolver; unknown local figures pass through. Composed sidecars never add frontmatter keys. bodies.ts compiles every MDX including drafts: draft preview locks must compile to fallback with one post-naming export warning and no remote registration. Verify both published and draft filtering, dates, reading minutes, LCD rows, sitemap links and route paths.
- [ ] Import one selected post using `composed new post <slug> --from <index.mdx>` (non-TTY automation adds `--i-am-human`), attach a portable component, preview against the actual blog dev server, publish to https://cdn.composed.ink using 12's author-device scope mapping, then release export with real server URLs in locks. This uses only commands already delivered. Do not push the blog or deploy as an implementation side effect.

**Verification in hellotimber:** `mise exec -- vp install`, `mise exec -- vp check --fix`, `mise exec -- vp run website#test`, `mise exec -- vp run website#build`. Also run the consumer plan's required commands. Compare pre/post metadata/feed summaries; ordinary migrated posts retain SSR semantics. For the composed post, Nitro SSR response (JS off) contains Markdown fallback, JS loads one shared React remote, blocked remote retains fallback, existing FIGURES render normally. Preview editing refreshes the real layout. Add focused writing tests for folder slug and distinct metadata/body globs. Run vp fmt on MDX, import/export twice and verify benign reconciliation/idempotency; lock JSON remains ignored. RSS acceptance is unchanged summary-only output, never body fallback.

**Out of scope:** rewriting the consumer design/router, moving private figures into composed, feed bodies, automatic Git push/deploy, consumer changes during this design-only assignment.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit’s files, commit the completed task, and update this index’s status. Commands are planned implementation gates, not results from this documentation task.
