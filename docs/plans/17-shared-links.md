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

- [x] Add `003-links` to the plan-16 migration runner:

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

- [x] The design names no management routes. They live under `/sync`, which is already device-authenticated, so `/s` keeps only link-token authentication (decision in this plan):
  - `POST /sync/links` takes `{linkId, docId, mode, frontiers?, questions, expiresAt?, instances}` (64 MiB limit) and answers `201 {linkId, token}`.
    - The doc must be the account's and already synced; otherwise 404.
    - For a pinned link, `replica.forkAt(decodeFrontiers(frontiers))` must succeed; otherwise 409 (the authority syncs first).
    - The token is 32 random bytes and only its SHA-256 is stored.
    - `guests_may_comment` is always 1, because `share.create` has no input for it (decision in this plan).
  - `GET /sync/links?doc=<docId>` answers `{links: {linkId, mode, questions, createdAt, expiresAt, revokedAt}[]}`, never tokens.
  - `POST /sync/links/:linkId/revoke` answers `{linkId, revokedAt}` and is idempotent.
- [x] Tests first in `apps/server/tests/links.test.ts`: create pinned and live links, an unknown frontier gets 409, another account's doc gets 404, the list never contains tokens or hashes, revoke twice gives the same `revokedAt`, and migration 003 upgrades a version-2 database.

### Task 2 — Render the link page

- [x] Add `GET /s/<token>`. A revoked, expired or unknown token gets one byte-identical 404 page with no reason. The text comes from the live replica, or from `forkAt(frontiers)` for a pinned link, through `projection(doc, "clean")` from `@composedink/core/model`, so dim and stash are omitted.
- [x] `render.ts` follows the host pipeline: `unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx)`, the parse that `@mdx-js` hosts run.
  - Drop the frontmatter, ESM and expression nodes.
  - For each JSX element, look up `renderKey(tag, attributes)` in the link's snapshot. If found, substitute `fromMarkdown(markdown)` children, as `remarkComposed` does with lock instances. Otherwise render `<figure class="block" data-tag>` with the tag and a props summary (`jsxProps`, 200 characters at most).
  - Finish with `remarkRehype` without `allowDangerousHtml`, then `rehypeStringify`.
  - The title is the frontmatter `title`, else the slug.

  Add the catalog entries and `apps/server` devDependencies (bundled) `unified`, `remark-parse`, `remark-frontmatter`, `remark-rehype` and `rehype-stringify`; `remark-mdx` and `mdast-util-from-markdown` are already in the catalog. These are new dependencies under the design's "remark for rendering".

- [x] Add `model/render-key.ts`, exported from `@composedink/core/model`: `renderKey(tag, attributes) = sha256(canonical({tag, props: jsxProps(attributes)}))` over literal props before defaults. The server never sees prop schemas, so the authority and the server hash the same input with `@composedink/blocks` (decision in this plan). `model-entry.test.ts` now also allows `@composedink/blocks`.
- [x] `link-page.ts` renders `<header>`, then the questions as an ordered list, then `<main><article>` with the content and `<aside>` with comments, then one inline comment script held as a constant. Headers:
  - `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-<hash>'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`, with the hash computed once at startup;
  - `Cache-Control: no-store`;
  - `Referrer-Policy: no-referrer`;
  - `X-Robots-Tag: noindex`;
  - `X-Content-Type-Options: nosniff`.

  No remote loads; remote images are blocked by the CSP. The questions are those of the most recent request in the live replica whose `to` contains `link:<linkId>`, else the link's stored questions. This way a later `feedback.request --to link:<id>` reframes the page with no extra route (decision in this plan). The aside lists only threads whose first message has `by.linkId === linkId`, with every reply. Author notes and model notes stay private (decision in this plan).

- [x] `rate.ts` allows 60 requests a minute per link token, keyed by the token's SHA-256 and counted before lookup so that probing costs the same. It covers `GET` and the guest `POST`s. Over the limit it answers 429 with `Retry-After`.
- [x] Tests first in `apps/server/tests/render.test.ts`:
  - dim text is absent;
  - a snapshot instance renders as Markdown and an unknown tag renders as a placeholder;
  - raw HTML in the source is escaped;
  - a pinned link shows text from its frontiers after a newer push, while a live link shows the newer text;
  - the HTML has exactly one `<script>`, its hash matches the CSP, and it contains no `remoteEntry`;
  - the 61st request in a minute gets 429;
  - revoked, expired and unknown tokens get identical 404 bodies.

### Task 3 — Named-guest comments on the server replica

- [x] Guest name: if the `composed_guest` cookie is absent, the first comment body must carry `name` (1–60 characters). The response sets `composed_guest=<encoded>; Path=/s/<token>; HttpOnly; SameSite=Strict; Max-Age=31536000`, plus `Secure` behind HTTPS. Sending the name with the first comment avoids a separate name route (decision in this plan). Every guest `POST` requires `Content-Type: application/json` and an `Origin` whose host equals `Host`, otherwise 403 (decision in this plan).
- [x] `POST /s/<token>/threads` takes `{quote: 1..2000, text: 1..4000, question?, name?}`.
  1. Check the question with `hasQuestion`.
  2. Run `openThread(replica, {base: head(replica), quote, view: "clean"}, {text, by: {kind:"guest", name, linkId}, question}, randomUUID(), {detachedIfMissing: true})`. A pinned link still comments against the live replica.
  3. Answer `201 {thread, state, messages}`.

  `POST /s/<token>/threads/:thread/replies` takes `{text, name?}` and calls `replyThread` with the guest author. It accepts only threads from this link; any other thread gets 404. `AmbiguousQuote` gets `409 {error: "AmbiguousQuote: select a longer passage"}`.

- [x] `model/threads.ts`: the option `detachedIfMissing` turns `QuoteNotFound` into a thread stored with `start: []`, `end: []` and `state: "detached"`. That is the existing never-relocate rule for a quote that no longer exists. Readers already skip resolving detached threads. Without the option, behaviour is unchanged; `tests/threads.test.ts` gains this case.
- [x] Each guest write runs `export({mode:"update", from: before})` and adds the update through plan 16's append path: one transaction, `from_device NULL`, `head_seq+1`, and a stream notification. Devices receive it as ordinary sync. The comment script keeps a selection inside one text node, because rendered text then matches the source (decision in this plan). It reads the cookie state from a `data-guest` attribute that the server renders, and it re-renders the aside from the JSON response.
- [x] `apps/server/tests/guest.test.ts`:
  - a comment without a name gets 400 and with a name gets 201 plus a cookie;
  - a second comment uses the cookie;
  - a peer that pulls receives a thread with the guest `by` and its quote range;
  - a quote deleted on the replica gives a detached thread;
  - an ambiguous quote gets 409;
  - a reply to another link's thread gets 404;
  - a wrong Origin gets 403;
  - a revoked link's POST gets 404.

### Task 4 — Share operations in the authority

- [x] Extract `evaluateUses(a, docId, ast, mode)` from `export.ts` `preview()` without changing behaviour; the export tests stay green. `share.ts` `renderSnapshot(a, id)` projects clean, applies the kind's `export.strip`, runs `validateProjection`, and evaluates every composed usage as preview export does (dev builds, published releases, `evaluateFallback` in the worker). It returns `{instances: {[renderKey(tag, attributes)]: markdown}}`.
- [x] Register three operations. They are not receipt mutations: `share.create` commits its document change in its own transaction, and a lost answer is retried by creating another link, since tokens are never recoverable (decision in this plan). Register `share.list` and `share.revoke` before `share.create`, because CLI matching takes the first prefix match on `["share"]`.

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

- [x] `feedback.request` accepts `to: ("model" | "link:<id>")[]`. Link recipients need a session and must appear as active in `GET /sync/links?doc=<id>`, else `UnknownLink: <id>`. A request without `model` stores `pending` and returns without calling the provider. `failOrphaned` now fails only pending requests whose `to` contains `model`, so link requests survive a restart (decision in this plan). `mcpRegistry` exposes `share_create`, `share_list` and `share_revoke`.
- [x] `packages/core/tests/share.test.ts` and `feedback.test.ts` run against a spawned server:
  - signed out, `share.create` refuses with the fix and makes no server call;
  - the default questions come from a pending request, else from the kind;
  - explicit questions create a new request;
  - `renderSnapshot` keys equal the `renderKey` of every usage in the parsed clean projection;
  - a pinned link's frontiers equal the synced head;
  - a link-only request survives a restart while still pending;
  - `UnknownLink` for a revoked link.

  `apps/cli/tests/session.test.ts` gains: `composed share`, `share list`, `share revoke`, the signed-out `composed share p` exiting 1 with the fix, and the `share_*` tools in MCP `tools/list`.

### Task 5 — Studio Share panel and guest attribution

- [x] `SharePanel.tsx` opens from a `Share` toolbar button. Signed out, the button is `disabled` and the panel says `Sign in to share — fix: composed login <server>`, using plan 16's `{session}` state. Signed in, the panel:
  - lists `share.list` for the open document (mode, expiry, revoked, URL if known, copy);
  - creates links (pinned by default, live, expiry none/1d/7d/30d) and shows the new URL;
  - revokes links.

  The panel hides in zen mode.

- [x] `ThreadColumn.tsx` and `editor/threads.ts` show guest messages as `<name>` with a `guest · link <first 6 chars of linkId>` tag, and keep the existing column, filter and detached group.
- [x] `apps/web/tests/share.spec.ts` (added to the e2e list) checks the disabled button and the fix on a signed-out temporary home, and a guest-authored thread label. `tests/desktop-smoke.ts` asserts that `Share` is disabled with the fix in the packaged signed-out page. Run `mise exec -- vp run composed-web#test`, `mise exec -- vp run composed-web#e2e` and `mise exec -- vp run composed-web#build`.

### Task 6 — End-to-end proof and runbook

- [x] Add `tests/share.ts` and the root script `"share-e2e": "node --experimental-strip-types tests/share.ts"`. It starts `apps/server/dist/main.mjs` on a random port with temporary storage, plus studios on home A (bootstrap) and home B (paired); home C is signed out.
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

- [x] Update `apps/server/README.md` and `deploy/README.md` with the `/s` and `/sync/links` routes, the guest limits, the CSP, and the fact that link URLs use the server origin the device logged in with. Rebuild and rerun plan 16's docker proof: the image still contains no `@rsbuild`, `@mdx-js` or `vite-plus`.

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

## Implementation log

### 2026-11-07 — Task 1: link records and management routes (`844857d`)

- Plan 16's `migrations.test.ts` pinned `user_version` 2 and five tables; it now expects
  `MIGRATIONS.length` and the seven tables. The new `links.test.ts` covers the 2 → 3 upgrade.
- `linkId` is 1–64 URL-safe characters, and a duplicate gets 409. `GET /sync/links` for a document
  this account never synced answers `{links: []}`; another account's document answers 404.
  Missing `expiresAt`/`revokedAt` are `null`, as in `/auth/devices`.
- There are no multi-account flows, so the "another account's doc" test inserts the second account
  and device directly in `server.db`. Shared test helpers (`bootstrapDevice`, `deviceJson`,
  `pushDoc`) went into `apps/server/tests/support/server.ts`.

### 2026-11-07 — Task 2: render the link page (`63a06f0`)

- **Title**: a top-level plain or quoted `title:` scalar is read with a regular expression. The
  plan's dependency list has no YAML parser, and `yaml` stays out of the server bundle. A
  multi-line YAML title falls back to the slug.
- **Inline placeholders**: a JSX element inside a paragraph (`mdxJsxTextElement`) renders
  `<span class="block" data-tag>`, not `<figure>`. HTML does not allow a figure inside `<p>`: the
  browser would split the paragraph and the text node a guest selects. Flow elements render
  `<figure>` as planned. The props summary is the `jsxProps` JSON (200 characters, then `…`), or
  `(expression props)` when the props are not literal.
- **Unparseable text**: live text that does not parse as MDX (an edit in progress) renders as
  preformatted text instead of a 500.
- **Deleted posts**: a link to a post with `meta.deleted` on the live replica gets the same 404.
- **Comment script**: written in this task, because the page and its CSP hash need it. It posts to
  the Task 3 routes. The page's style sheet is inline (`style-src 'unsafe-inline'`), and a later
  CSS-only fix (Task 6) left the script hash unchanged.
- **Bundle**: `dist/main.mjs` grew from 206 kB to 1.23 MB (unified, micromark, mdast/hast). The
  `grep` gate first printed 1. The match was my own doc comment in `render.ts` naming `@mdx-js`;
  after rewording it the gate prints 0. No `@mdx-js` package is bundled (`remark-mdx` is a separate
  package).

### 2026-11-07 — Task 3: named-guest comments (`4b79b86`)

- **Check order**: rate limit, then link lookup (any unusable token gets the one HTML 404), then
  route, then JSON and `Origin` (403), then body. A revoked link's POST gets the HTML 404 page; a
  reply to another link's thread gets a JSON 404.
- **Replies** answer `201 {thread, state, messages}`, the same shape as new threads, so the
  script re-renders either one the same way.
- **Cookie**: the cookie's name wins over a body `name`. `Set-Cookie` is sent only after the write
  lands. An unknown question id gets `400 UnknownQuestion`.
- **Append path**: plan 16's append path is now `append()` in `sync.ts`. Device pushes and guest
  writes (`from_device NULL`) share the transaction, the snapshot rule and the stream
  notification.

### 2026-11-07 — Task 4: share operations (`1eeee39`)

- **Queue**: `share.*` join `bind`'s unqueued set, like `sync.now`. `share.create` calls
  `a.sync.now`, and sync serializes its own pulls, so running inside the queue would deadlock.
  Steps 4–6 (the request transaction, the head capture and the render snapshot) run in one
  `a.serialize`, so the frontiers and the snapshot describe the same state.
- **Order of checks**: `requireSession` comes first, so a signed-out home refuses before any server
  call. An authority without `a.sync` throws `StudioRequired`, and `client.ts` routes
  `share.create` through `ensureStudio`.
- **No questions**: requests need at least one question. When there are no explicit questions, no
  pending request and the kind has none, `share.create` refuses with feedback's message
  (`InvalidInvariant: kind has no feedback questions; fix: pass --question …`). "The most recent
  pending request" includes a pending model request.
- **Unknown links**: the message is `UnknownLink: <id>; fix: composed share list <doc>`. The check
  runs in `createFeedback`, inside the receipt transaction, so it holds the authority queue for one
  `GET /sync/links`.
- **MCP**: `capabilities.test.ts` (plan 15) asserted that no `share*` tool reaches MCP. It now
  requires exactly `share_create`, `share_list` and `share_revoke`, and still excludes
  `session_login`, `session_logout` and `devices_*`.
- **Test support**: `packages/core/tests/support/server-process.ts` spawns the server for the share
  and feedback tests. Plan 16's `sync.test.ts` keeps its own helper. `export.test.ts` checks that
  `evaluateUses` returns exactly the lock's `blocks`.

### 2026-11-07 — Task 5: Share panel and guest attribution (`4f1adaf`)

- **Placement**: the `Share` button sits in the page header next to "Undo operation", with the
  signed-out fix beside it. The panel renders below the header. The status bar is unchanged, so its
  no-wrap rule still holds. In zen the panel and the fix text hide; the button stays.
- **Feedback panel**: the guest screenshot showed "Waiting for the model…" on the link-only request
  that `share.create` makes. A pending request without `model` now reads `Waiting for guests on
  link <6 chars>`, and the web `FeedbackRequest` type gains `to`. `share.spec.ts` asserts this.
- **Test setup**: `apps/web` may not import `@composedink/core/node` (boundary test), so the
  guest-label half of `share.spec.ts` spawns the real server, signs a home in, shares, posts a
  guest comment over HTTP and waits for sync. `tests/threads.test.ts` gains an `authorTag` case.
- The third box was ticked after `composed-desktop#smoke` ran in the final gate
  (`signedOutShareDisabled: true`).

### 2026-11-07 — Task 6: end-to-end proof and runbook

- **Page fix**: the first `share-e2e` screenshot showed the guest form overflowing the aside's
  20rem column (the question `<select>` takes its longest option's width). Form controls are now
  `width: 100%` with `min-width: 0`. CSS only; the script hash is unchanged.
- **Runbook**: the docker commands in `deploy/README.md` are retagged `plan17`. The rollback note
  now says migration 003 only adds tables, and an older image leaves a newer `user_version` alone.
  The deploy notes add that the proxy must pass `Host` through (for the guest `Origin` check) and
  that devices must log in with the public origin, because link URLs use it.

### 2026-11-07 — final gate (all in the foreground, sequentially, on the final tree)

- `vp check --fix`: pass, 228 files, no warnings.
- `vp run -r test`: 9/9 successful (core 34 files / 160 tests, lint 149, server 8 / 40, web 5 /
  11, cli 6 / 9, root 2 / 3).
- `vp run composed-server#test`: 8 files, 40 passed.
- `vp run @composedink/core#test`: **first run failed** 1 of 160, then a rerun passed 160/160. The
  failure was plan 16's `sync.test.ts` "stores a push once when its acknowledgement is lost, and
  resumes after a restart": `expected [] to deeply equal ['/sync/docs/lost/updates?since=1']`.
  The likely cause is a race in that test. `restarted.a.sync!.start()` starts the background loop,
  which can pull B's update on its `doc` event before the test clears `proxy.log`, leaving the
  explicit `restarted.sync()` nothing to pull. Plan 17 does not change `sync.ts` or `session.ts`.
  In isolation the file passed 5 of 5 runs. The earlier `vp run -r test` and the Task 4 core runs
  passed. Not fixed here (it is plan 16's test); it is a follow-up.
- `vp run composed-cli#test`: 6 files, 9 passed. `vp run composed-web#test`: 5 files, 11 passed.
- `vp run composed-web#e2e`: all 10 specs pass, including both `share.spec.ts` lines ("disabled with
  the fix on a signed-out home, hidden fix in zen" and "guest thread labelled by name and link;
  panel lists the link"). Screenshots: `test-results/plan-17-share-signed-out.png`,
  `plan-17-share-guest-thread.png`.
- `vp run composed-web#build`: built.
- `vp run composed-server#bundle`: `dist/main.mjs` 1.23 MB; `grep -c "@rsbuild\|@mdx-js"` → `0`.
- `vp run share-e2e`: PASS ("pinned old vs live new, guest comment → thread on B, reply shown, one
  script and no remote, 429, identical 404s, signed-out refusal"). Evidence:
  `test-results/plan-17-share-proof.json`:
  - pinned shows old and not new, live shows new and not old; both render
    `Hello, <strong>Ada</strong>.` and a `Mystery` placeholder;
  - the guest thread is `by: {kind:"guest", name:"Ada Guest", linkId}` with quote
    `comment on this phrase`, on B after 710 ms, and B's column reads
    `Ada Guest guest · link b350bf This phrase is lovely.`;
  - the reply shows after a reload;
  - 3 page requests, `outsideOrigin: []`, 1 script, no `remoteEntry`, and the CSP contains the
    script's hash;
  - requests 1–60 → 200, request 61 → 429;
  - revoked, expired and unknown tokens → `[404, 404, 404]` with identical bodies;
  - on signed-out home C, `share` exits 1 with
    `SignInRequired: …; fix: composed login <server>`, and the page has a disabled Share with the
    fix.

  Screenshots: `plan-17-share-guest.png`, `plan-17-share-b-column.png`,
  `plan-17-share-c-signed-out.png`.

- `vp run sync-e2e` (regression): PASS; both alternatives present with the flipped version active
  (`test-results/plan-16-sync-proof.json`).
- **Docker** (`deploy/README.md` "Verify the image locally", tag `composed-server:plan17`): the
  image built. `ls -a /app/node_modules` lists `.`, `..`, `.modules.yaml`, `.pnpm`, `loro-crdt`,
  and the `find` for `@rsbuild`, `@mdx-js` and `vite-plus` prints nothing. `/healthz` → `ok`,
  `/data/server.db` is present (`-rw-r--r-- node node`), and an unknown `/s/<token>` → 404 in the
  container. The container and volume were removed.
- `vp run composed-desktop#package`: 3/3 successful (`Composed.app`, unsigned for notarization as
  before). `vp run composed-desktop#smoke`: 2/2 successful with `signedOutStatus: true`,
  `signedOutShareDisabled: true`, `studioLoadsNoRemotes: true` and persistence across relaunch
  (`test-results/plan-11-smoke-1794071112540`). Its `desktop-gui.ts` step reported
  `skipped: gui session locked` (the screen was locked); that check predates plan 17.

Notes: studio pages log a Vite HMR `WebSocket closed without opened` page error in Playwright. It
also appears in plan 16's `sync-e2e`, so it is not new. Nothing was left running: no
`studio --headless`, server or desktop processes from this checkout, and no containers.

Follow-up: the core `sync.test.ts` lost-ack and restart race above (plan 16's test).

### 2026-11-07 — boss verification (independent rerun on the final tree, foreground, sequential)

- The core flake above was a race in plan 16's lost-ack restart case: the restarted loop's `doc`
  event could pull before the proxy log was cleared. The log is now cleared before B's change
  (`830b52f`); `tests/sync.test.ts` passed 3 of 3 consecutive runs.
- `vp check --fix`: pass, 228 files. `vp run -r test`: 9/9 (core 34 files / 160, lint 149,
  server 40, web 11, cli 9, root 3).
- `vp run composed-server#bundle`: 1.23 MB, `grep -c "@rsbuild\|@mdx-js"` → 0.
- `vp run share-e2e`: PASS (`test-results/plan-17-share-proof.json`: pinned old/not new, live
  new/not old, fallback and placeholder rendered, guest thread on B in 707 ms with name and quote,
  3 same-origin requests, 1 script, no remoteEntry, 61st request 429, identical 404s, signed-out
  exit 1 with the fix and the disabled Share button).
- `vp run sync-e2e`: PASS, both alternatives `active: 1, count: 2`.
- `vp run composed-web#e2e`: 10/10 specs PASS. `vp run composed-web#build`: built.
- Docker `composed-server:plan17`: `/app/node_modules` holds only `loro-crdt` and `.pnpm`; the
  `find` prints nothing; `/healthz` → `ok`; `/s/nope` → 404; `/data/server.db` present.
- `vp run host-tanstack#e2e`: all assertions true (`6-ms` 881, `code-save-ms` 846).
- `vp run composed-desktop#package` then `#smoke`: `signedOutStatus`, `signedOutShareDisabled`,
  `persistenceAcrossSidecarRelaunch` all true (`test-results/plan-11-smoke-1794072040303`); the
  GUI typing check was skipped because the screen was locked (predates plan 17).
