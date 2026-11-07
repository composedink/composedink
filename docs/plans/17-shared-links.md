# Plan 17 — Shared preview links with named-guest comments

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 16. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** a signed-in author shares a pinned or live preview of a post. Named guests comment on it from a server-rendered page, and their comments arrive on every signed-in device as ordinary threads. A signed-out device cannot share. [Sync and sharing](../design/sync-and-sharing.md) is authoritative.

**Files:**

- Server: add `apps/server/src/{links,render,link-page,guest,rate}.ts`, `apps/server/src/migrations/003-links.ts`, and `apps/server/tests/{links,render,guest}.test.ts`; update `apps/server/src/{main,sync}.ts`, `migrations/index.ts`, `apps/server/package.json` and `README.md`.
- Core: add `packages/core/src/share.ts`, `src/model/render-key.ts` and `tests/share.test.ts`; update `src/model/{index,threads,feedback}.ts`, `src/{export,feedback,authority}.ts`, `src/store/recovery.ts`, `src/ops/{registry,capabilities}.ts`, and `tests/{threads,feedback,export}.test.ts`.
- CLI: update `apps/cli/src/{main,client}.ts` and `apps/cli/tests/session.test.ts`.
- Web: add `apps/web/src/SharePanel.tsx` and `apps/web/tests/share.spec.ts`; update `apps/web/src/{PostEditor.tsx,ThreadColumn.tsx,style.css}`, `src/editor/threads.ts` and `apps/web/package.json`.
- Root: add `tests/share.ts`; update `package.json` (`share-e2e`), `tests/desktop-smoke.ts`, `pnpm-workspace.yaml` (catalog) and `deploy/README.md`.

### Task 1 — Link records and management routes

- [ ] Add `003-links` to the plan-16 migration runner:

  ```sql
  CREATE TABLE links (link_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
    doc_id TEXT NOT NULL REFERENCES docs, token_hash BLOB NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK (mode IN ('pinned','live')), frontiers TEXT, questions TEXT NOT NULL,
    guests_may_comment INTEGER NOT NULL DEFAULT 1, expires_at INTEGER, revoked_at INTEGER,
    created_at INTEGER NOT NULL, created_by_device TEXT NOT NULL REFERENCES devices,
    CHECK ((mode = 'pinned') = (frontiers IS NOT NULL)));
  CREATE TABLE render_snapshots (link_id TEXT PRIMARY KEY REFERENCES links,
    instances TEXT NOT NULL, at INTEGER NOT NULL);
  ```

  `questions` is JSON `{id,text}[]`. `instances` is JSON `{[renderKey]: markdown}`, with one snapshot per link. A live link keeps the snapshot from its creation (decision in this plan).

- [ ] The design names no management routes. They live under `/sync`, which is already device-authenticated, so `/s` keeps only link-token authentication (decision in this plan):
  - `POST /sync/links` takes `{linkId, docId, mode, frontiers?, questions, expiresAt?, instances}` (64 MiB limit) and answers `201 {linkId, token}`.
    - The doc must be the account's and already synced; otherwise 404.
    - For a pinned link, `replica.forkAt(decodeFrontiers(frontiers))` must succeed; otherwise 409 (the authority syncs first).
    - The token is 32 random bytes and only its SHA-256 is stored.
    - `guests_may_comment` is always 1, because `share.create` has no input for it (decision in this plan).
  - `GET /sync/links?doc=<docId>` answers `{links: {linkId, mode, questions, createdAt, expiresAt, revokedAt}[]}`, never tokens.
  - `POST /sync/links/:linkId/revoke` answers `{linkId, revokedAt}` and is idempotent.
- [ ] Tests first in `apps/server/tests/links.test.ts`: create pinned and live links, an unknown frontier gets 409, another account's doc gets 404, the list never contains tokens or hashes, revoke twice gives the same `revokedAt`, and migration 003 upgrades a version-2 database.

### Task 2 — Render the link page

- [ ] Add `GET /s/<token>`. A revoked, expired or unknown token gets one byte-identical 404 page with no reason. The text comes from the live replica, or from `forkAt(frontiers)` for a pinned link, through `projection(doc, "clean")` from `@composedink/core/model`, so dim and stash are omitted.
- [ ] `render.ts` follows the host pipeline: `unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx)`, the parse that `@mdx-js` hosts run.
  - Drop the frontmatter, ESM and expression nodes.
  - For each JSX element, look up `renderKey(tag, attributes)` in the link's snapshot. If found, substitute `fromMarkdown(markdown)` children, as `remarkComposed` does with lock instances. Otherwise render `<figure class="block" data-tag>` with the tag and a props summary (`jsxProps`, 200 characters at most).
  - Finish with `remarkRehype` without `allowDangerousHtml`, then `rehypeStringify`.
  - The title is the frontmatter `title`, else the slug.

  Add the catalog entries and `apps/server` devDependencies (bundled) `unified`, `remark-parse`, `remark-frontmatter`, `remark-rehype` and `rehype-stringify`; `remark-mdx` and `mdast-util-from-markdown` are already in the catalog. These are new dependencies under the design's "remark for rendering".

- [ ] Add `model/render-key.ts`, exported from `@composedink/core/model`: `renderKey(tag, attributes) = sha256(canonical({tag, props: jsxProps(attributes)}))` over literal props before defaults. The server never sees prop schemas, so the authority and the server hash the same input with `@composedink/blocks` (decision in this plan). `model-entry.test.ts` now also allows `@composedink/blocks`.
- [ ] `link-page.ts` renders `<header>`, then the questions as an ordered list, then `<main><article>` with the content and `<aside>` with comments, then one inline comment script held as a constant. Headers:
  - `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-<hash>'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`, with the hash computed once at startup;
  - `Cache-Control: no-store`;
  - `Referrer-Policy: no-referrer`;
  - `X-Robots-Tag: noindex`;
  - `X-Content-Type-Options: nosniff`.

  No remote loads; remote images are blocked by the CSP. The questions are those of the most recent request in the live replica whose `to` contains `link:<linkId>`, else the link's stored questions. This way a later `feedback.request --to link:<id>` reframes the page with no extra route (decision in this plan). The aside lists only threads whose first message has `by.linkId === linkId`, with every reply. Author notes and model notes stay private (decision in this plan).

- [ ] `rate.ts` allows 60 requests a minute per link token, keyed by the token's SHA-256 and counted before lookup so that probing costs the same. It covers `GET` and the guest `POST`s. Over the limit it answers 429 with `Retry-After`.
- [ ] Tests first in `apps/server/tests/render.test.ts`:
  - dim text is absent;
  - a snapshot instance renders as Markdown and an unknown tag renders as a placeholder;
  - raw HTML in the source is escaped;
  - a pinned link shows text from its frontiers after a newer push, while a live link shows the newer text;
  - the HTML has exactly one `<script>`, its hash matches the CSP, and it contains no `remoteEntry`;
  - the 61st request in a minute gets 429;
  - revoked, expired and unknown tokens get identical 404 bodies.

### Task 3 — Named-guest comments on the server replica

- [ ] Guest name: if the `composed_guest` cookie is absent, the first comment body must carry `name` (1–60 characters). The response sets `composed_guest=<encoded>; Path=/s/<token>; HttpOnly; SameSite=Strict; Max-Age=31536000`, plus `Secure` behind HTTPS. Sending the name with the first comment avoids a separate name route (decision in this plan). Every guest `POST` requires `Content-Type: application/json` and an `Origin` whose host equals `Host`, otherwise 403 (decision in this plan).
- [ ] `POST /s/<token>/threads` takes `{quote: 1..2000, text: 1..4000, question?, name?}`.
  1. Check the question with `hasQuestion`.
  2. Run `openThread(replica, {base: head(replica), quote, view: "clean"}, {text, by: {kind:"guest", name, linkId}, question}, randomUUID(), {detachedIfMissing: true})`. A pinned link still comments against the live replica.
  3. Answer `201 {thread, state, messages}`.

  `POST /s/<token>/threads/:thread/replies` takes `{text, name?}` and calls `replyThread` with the guest author. It accepts only threads from this link; any other thread gets 404. `AmbiguousQuote` gets `409 {error: "AmbiguousQuote: select a longer passage"}`.

- [ ] `model/threads.ts`: the option `detachedIfMissing` turns `QuoteNotFound` into a thread stored with `start: []`, `end: []` and `state: "detached"`. That is the existing never-relocate rule for a quote that no longer exists. Readers already skip resolving detached threads. Without the option, behaviour is unchanged; `tests/threads.test.ts` gains this case.
- [ ] Each guest write runs `export({mode:"update", from: before})` and adds the update through plan 16's append path: one transaction, `from_device NULL`, `head_seq+1`, and a stream notification. Devices receive it as ordinary sync. The comment script keeps a selection inside one text node, because rendered text then matches the source (decision in this plan). It reads the cookie state from a `data-guest` attribute that the server renders, and it re-renders the aside from the JSON response.
- [ ] `apps/server/tests/guest.test.ts`:
  - a comment without a name gets 400 and with a name gets 201 plus a cookie;
  - a second comment uses the cookie;
  - a peer that pulls receives a thread with the guest `by` and its quote range;
  - a quote deleted on the replica gives a detached thread;
  - an ambiguous quote gets 409;
  - a reply to another link's thread gets 404;
  - a wrong Origin gets 403;
  - a revoked link's POST gets 404.

### Task 4 — Share operations in the authority

- [ ] Extract `evaluateUses(a, docId, ast, mode)` from `export.ts` `preview()` without changing behaviour; the export tests stay green. `share.ts` `renderSnapshot(a, id)` projects clean, applies the kind's `export.strip`, runs `validateProjection`, and evaluates every composed usage as preview export does (dev builds, published releases, `evaluateFallback` in the worker). It returns `{instances: {[renderKey(tag, attributes)]: markdown}}`.
- [ ] Register three operations. They are not receipt mutations: `share.create` commits its document change in its own transaction, and a lost answer is retried by creating another link, since tokens are never recoverable (decision in this plan). Register `share.list` and `share.revoke` before `share.create`, because CLI matching takes the first prefix match on `["share"]`.

  | Operation      | Input                                                                                    | CLI mapping                                                           | Result                                                         |
  | -------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
  | `share.create` | `{id, mode: "pinned"\|"live" = "pinned", questions?: string[], expiresIn?: /^\d+[hd]$/}` | `composed share <id> [--live] [--expires 7d] [--question <text> ...]` | `{link, url, mode, expiresAt?, request, questions}`            |
  | `share.list`   | `{id}`                                                                                   | `composed share list <id>`                                            | the server list plus the URL when this device created the link |
  | `share.revoke` | `{link}`                                                                                 | `composed share revoke <link>`                                        | `{link, revokedAt}`                                            |

  `share.create` runs these steps:
  1. `requireSession` (signed out: `SignInRequired: …; fix: composed login <server>`).
  2. `a.sync.now({id})`, which needs studio; `client.ts` routes `share.create` through `ensureStudio`.
  3. Generate the link id.
  4. Choose the questions in one transaction (decision in this plan):
     - explicit `questions` create a new request with `to: ["link:<link>"]`;
     - otherwise the most recent `pending` request gains the recipient through a new `addRecipient` in `model/feedback.ts`, and its questions are used;
     - otherwise a new request uses the kind's questions.
  5. For a pinned link, capture `head` as its frontiers.
  6. Build `renderSnapshot`.
  7. `a.sync.now({id})` again, so the request reaches the replica.
  8. `POST /sync/links`.
  9. Record `{url, doc}` in `state.db` under kind `"link"`.

  The URL is `<session.server>/s/<token>`.

- [ ] `feedback.request` accepts `to: ("model" | "link:<id>")[]`. Link recipients need a session and must appear as active in `GET /sync/links?doc=<id>`, else `UnknownLink: <id>`. A request without `model` stores `pending` and returns without calling the provider. `failOrphaned` now fails only pending requests whose `to` contains `model`, so link requests survive a restart (decision in this plan). `mcpRegistry` exposes `share_create`, `share_list` and `share_revoke`.
- [ ] `packages/core/tests/share.test.ts` and `feedback.test.ts` run against a spawned server:
  - signed out, `share.create` refuses with the fix and makes no server call;
  - the default questions come from a pending request, else from the kind;
  - explicit questions create a new request;
  - `renderSnapshot` keys equal the `renderKey` of every usage in the parsed clean projection;
  - a pinned link's frontiers equal the synced head;
  - a link-only request survives a restart while still pending;
  - `UnknownLink` for a revoked link.

  `apps/cli/tests/session.test.ts` gains: `composed share`, `share list`, `share revoke`, the signed-out `composed share p` exiting 1 with the fix, and the `share_*` tools in MCP `tools/list`.

### Task 5 — Studio Share panel and guest attribution

- [ ] `SharePanel.tsx` opens from a `Share` toolbar button. Signed out, the button is `disabled` and the panel says `Sign in to share — fix: composed login <server>`, using plan 16's `{session}` state. Signed in, the panel:
  - lists `share.list` for the open document (mode, expiry, revoked, URL if known, copy);
  - creates links (pinned by default, live, expiry none/1d/7d/30d) and shows the new URL;
  - revokes links.

  The panel hides in zen mode.

- [ ] `ThreadColumn.tsx` and `editor/threads.ts` show guest messages as `<name>` with a `guest · link <first 6 chars of linkId>` tag, and keep the existing column, filter and detached group.
- [ ] `apps/web/tests/share.spec.ts` (added to the e2e list) checks the disabled button and the fix on a signed-out temporary home, and a guest-authored thread label. `tests/desktop-smoke.ts` asserts that `Share` is disabled with the fix in the packaged signed-out page. Run `mise exec -- vp run composed-web#test`, `mise exec -- vp run composed-web#e2e` and `mise exec -- vp run composed-web#build`.

### Task 6 — End-to-end proof and runbook

- [ ] Add `tests/share.ts` and the root script `"share-e2e": "node --experimental-strip-types tests/share.ts"`. It starts `apps/server/dist/main.mjs` on a random port with temporary storage, plus studios on home A (bootstrap) and home B (paired); home C is signed out.
  1. A writes a post with a dev inline block usage and an unregistered tag.
  2. A runs `composed share post`, giving pinned URL P, and `composed share post --live --expires 7d`, giving live URL L.
  3. A edits the text directly and syncs. P shows the old sentence and not the new one; L shows the new one. Both render the block's fallback Markdown and a placeholder for the unregistered tag.
  4. A Playwright guest on L enters a name, selects a phrase and comments. Within 10 s, `composed thread list post` on B shows `by: {kind:"guest", name, linkId}` with the range slicing to the quote, and B's comment column shows the name and link tag.
  5. B replies; reloading L shows the reply.
  6. The page triggers no request outside its origin (Playwright request log), contains no `remoteEntry`, and has one `<script>` whose hash is in the CSP.
  7. 61 requests to a fresh link in a minute end with a 429.
  8. `composed share revoke` on P gives 404. An expired link (the test sets `expires_at` in the past in `server.db`) and an unknown token give the same 404 body.
  9. On home C, `composed share post` exits 1 with `fix: composed login`, and its studio page shows the Share button disabled with the fix.

  Evidence goes to `test-results/plan-17-share-proof.json`.

- [ ] Update `apps/server/README.md` and `deploy/README.md` with the `/s` and `/sync/links` routes, the guest limits, the CSP, and the fact that link URLs use the server origin the device logged in with. Rebuild and rerun plan 16's docker proof: the image still contains no `@rsbuild`, `@mdx-js` or `vite-plus`.

**Verification:** the design's Units evidence for plan 17 is: **a guest comment on a link appears as a thread on a second signed-in device; a pinned link shows old text while a live link shows new; a revoked link is 404; a signed-out desktop shows the disabled Share with the fix.** Run:

- `mise exec -- vp run composed-server#test`
- `mise exec -- vp run @composedink/core#test`
- `mise exec -- vp run composed-cli#test`
- `mise exec -- vp run composed-web#test`
- `mise exec -- vp run composed-web#e2e`
- `mise exec -- vp run composed-web#build`
- `mise exec -- vp run composed-server#bundle`
- `mise exec -- vp run share-e2e`
- `mise exec -- vp run sync-e2e` (regression)
- plan 16's docker commands
- `mise exec -- vp run composed-desktop#package` then `mise exec -- vp run composed-desktop#smoke`

The evidence must also show:

- the 429 after 60 requests a minute;
- one script and no remote on the link page;
- identical 404s for revoked, expired and unknown tokens;
- a refused `share.create` while signed out.

**Out of scope:** guests editing text, guest accounts, link analytics, multiple accounts, live co-editing, executing components or loading remotes on link pages, sandboxed usercontent (P3), email or notifications, editing link questions after creation other than through a `link:` feedback request, and deploying the server.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit's files, commit the completed task, and update this index's status. Commands are planned implementation gates, not results from this documentation task.
