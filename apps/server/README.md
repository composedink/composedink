# composed server

One process serves the artifact routes (`/c/`), device accounts (`/auth/`), the update relay
(`/sync/`) and shared preview links (`/s/`), with `server.db` (SQLite) next to the artifacts in
`$COMPOSED_STORAGE`.

```sh
COMPOSED_TOKEN=... COMPOSED_BOOTSTRAP_TOKEN=... COMPOSED_STORAGE=./data mise exec -- vp run composed-server#start
```

| Variable                   | Purpose                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `COMPOSED_STORAGE`         | artifacts and `server.db` (default `/data`); a writable volume owned by UID 1000                         |
| `COMPOSED_TOKEN`           | bearer for artifact `PUT`; required                                                                      |
| `COMPOSED_BOOTSTRAP_TOKEN` | signs in the first device; required while no account exists (the server refuses to start), then ignored  |
| `PORT`, `HOST`             | listen address (default `4849` on `0.0.0.0`); the server prints `{"ready":true,"port":…}` once listening |

Build from the repository root: `docker build -f apps/server/Dockerfile .`. The image is
multi-stage: a Debian build stage installs the workspace, bundles `src/main.ts` with tsdown
(`vp run composed-server#bundle` → `dist/main.mjs`, bundling `@composedink/core/model` and the
remark/rehype renderer for link pages) and deploys
production dependencies; the Alpine runtime stage holds only `dist/`, `node_modules/loro-crdt`
(external, because it loads its WASM from its own directory) and `package.json`. It contains no
build toolchain (`@rsbuild`, `@mdx-js`, `vite-plus`).

`GET /healthz` answers `200 ok` after `SELECT count(*) FROM accounts` on the open database,
`503` otherwise. Migrations are numbered TypeScript modules (`src/migrations/`), applied above
`PRAGMA user_version` in one `BEGIN IMMEDIATE` transaction at start; a failure rolls back and the
process exits non-zero.

## Artifacts (`/c/`)

Authenticated PUT `/c/<scope>/<name>/<version>/<file>` stages immutable files.
Finally PUT `release.json` containing `{ "files": { "remoteEntry.js": "<sha256>", ... } }`.
Only a complete hash-verified set becomes public, via atomic directory rename. Same bytes
return 200, conflicting bytes or an incomplete commit return 409. A committed version
cannot gain files. GET is public with CORS and immutable caching. Keep the bearer token in the
environment, never in documents or locks. This app does not bundle components, deploy itself,
or publish npm packages.

## Server session and sync

Device tokens and pairing codes are random; the database stores only their SHA-256. Tokens are
sent as `Authorization: Bearer <token>`. A revoked device gets 401 on every route. Errors are JSON
`{"error":"<Code>: message"}`.

| Route                            | Auth           | Answer                                                                                                       |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /auth/login`               | code/bootstrap | `{deviceName, code?, bootstrap?}` (exactly one) → `201 {accountId, deviceId, deviceName, token}`             |
| `POST /auth/pair`                | device         | `201 {code: "ABCD-EFGH", expiresAt}`: 8 Crockford base32 characters, single use, 10 minutes                  |
| `GET /auth/devices`              | device         | `{current, devices: {deviceId, name, createdAt, lastSeenAt, revokedAt}[]}` for the account                   |
| `DELETE /auth/devices/:deviceId` | device         | `{deviceId, revokedAt}`; ends that device's event streams; another account's device is 404                   |
| `POST /sync/docs/:docId/updates` | device         | Loro update bytes, `Composed-Since: <base64url vv>` → `{seq, vv, duplicate}`; 409 `{vv}` when since is ahead |
| `GET /sync/docs/:docId/updates`  | device         | `?since=<seq>` → `{docId, head, vv, snapshot?: {seq, bytes}, updates: {seq, fromDevice, at, bytes}[]}`       |
| `GET /sync/events`               | device         | `text/event-stream`: `heads` (`{docs:[{docId,seq}]}`) first, then `doc` (`{docId,seq}`), `: ping` every 25 s |

`bootstrap` works only while no account exists and creates the account `owner`. Path segments are
decoded after splitting, so a component id travels as one segment (`composed%3Ascope%2Fname`).

The server keeps one Loro replica per document and imports every push before acknowledging it:
a blob that does not import is 400 and never stored; a push whose Loro version range the replica
already covers answers `duplicate: true` without storing (a retry after a lost acknowledgement).
Every 256 rows or 4 MiB of rows since the last snapshot, the push also writes a snapshot; a pull
behind the snapshot gets the snapshot plus the rows after it. Rows are kept, not pruned.

Limits: 8 MiB per update body (413), 64 MiB per snapshot (413 for the push that would create
it, storing nothing), 8 MiB of rows per pull page (at least one row; clients loop to `head`),
10 failed sign-ins per minute per process (429), 64 KiB JSON bodies. `last_seen_at` is written
at most once a minute.

Clients: `composed login <server> (--code <code> | --bootstrap <token>) [--name <device>]`,
`composed logout`, `composed status`, `composed devices pair|list|revoke <device>` and
`composed sync [<id>]`. Studio runs the sync loop; see `docs/design/sync-and-sharing.md`.

## Shared links

A link shows one post to named guests without a device. Management lives under `/sync`
(device-authenticated); the page and guest comments under `/s/<token>` authenticate by the link
token alone. Link tokens are 32 random bytes (base64url); the database stores only their SHA-256,
so a lost URL cannot be recovered, only replaced.

| Route                                     | Auth   | Answer                                                                                                                   |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /sync/links`                        | device | `{linkId, docId, mode, frontiers?, questions, expiresAt?, instances}` (64 MiB) → `201 {linkId, token}`                   |
| `GET /sync/links?doc=<docId>`             | device | `{links: {linkId, mode, questions, createdAt, expiresAt, revokedAt}[]}`, never tokens                                    |
| `POST /sync/links/:linkId/revoke`         | device | `{linkId, revokedAt}`; idempotent                                                                                        |
| `GET /s/<token>`                          | link   | the page: clean projection of the pinned frontiers or the live replica, the questions, guest threads, one comment script |
| `POST /s/<token>/threads`                 | link   | `{quote: 1..2000, text: 1..4000, question?, name?}` → `201 {thread, state, messages}`; `409` for an ambiguous quote      |
| `POST /s/<token>/threads/:thread/replies` | link   | `{text, name?}` → `201 {thread, state, messages}`; only threads started from this link (others 404)                      |

- **Create** needs a document the account already synced (404 otherwise) and, for a pinned link,
  frontiers the replica contains (409 otherwise; the authority syncs first). `instances` is the
  render snapshot `{[renderKey]: markdown}` stored with the link; a live link keeps it.
- **Render**: `remark-parse` + `remark-frontmatter` + `remark-mdx`, as MDX hosts parse. Frontmatter,
  ESM and expressions are dropped; each JSX element renders its snapshot fallback when
  `renderKey(tag, literal props)` matches, else a `<figure class="block" data-tag>` placeholder
  (`<span>` inside a paragraph) with the props summary. `remark-rehype` without
  `allowDangerousHtml`, so raw HTML is text. No component code runs and no remote loads. Text that
  does not parse as MDX renders preformatted. The questions are those of the newest feedback
  request addressed to `link:<linkId>`, else the link's own. The aside lists only threads whose
  first message came from this link; author and model notes stay private.
- **Guests**: the first comment carries `name` (1–60 characters); the answer sets
  `composed_guest=<name>; Path=/s/<token>; HttpOnly; SameSite=Strict; Max-Age=31536000` (plus
  `Secure` when the request arrived over HTTPS, `X-Forwarded-Proto: https`). Every guest `POST`
  needs `Content-Type: application/json` and an `Origin` whose host equals `Host` (403 otherwise).
  The comment applies `openThread`/`replyThread` to the live replica with
  `by: {kind: "guest", name, linkId}` (a pinned link comments on the live text; a quote no longer
  there opens detached) and stores the update through the relay's append path with no device, so
  signed-in devices receive it as sync.
- **Limits**: 60 requests a minute per link token for the page and guest posts together, counted
  by the token's SHA-256 before lookup (429 with `Retry-After`); 64 KiB guest bodies.
- **Not found**: unknown, revoked and expired tokens (and a deleted post) answer one byte-identical
  404 page that never says why.
- **Headers** on every page: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline';
  script-src 'sha256-<hash of the one inline script>'; connect-src 'self'; img-src 'self' data:;
  form-action 'none'; base-uri 'none'; frame-ancestors 'none'`, `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`.

A link URL is `<server>/s/<token>`, where `<server>` is the origin the creating device logged in
with (`session.json`). Log devices in with the public HTTPS origin, not an internal address, or the
URLs they hand out will not open for guests.

Clients: `composed share <id> [--live] [--expires 7d] [--question <text> ...]`,
`composed share list <id>`, `composed share revoke <link>`, and `feedback request <id> --to
link:<linkId>` to reframe a link's questions.
