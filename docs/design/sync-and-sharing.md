# Sync and sharing — design unit (P2)

Delivers the server session that `writing-process.md` deferred: accounts, device tokens, a
store-and-relay of Loro updates between an author's devices, and then shared preview links
where named guests comment. Plans 16 and 17 implement it. Everything in `composed.md` and
`writing-process.md` holds; this unit adds to the server and to the authority.

Decisions already made (Lachlan): comments work everywhere offline; signed in, comments
reflect shared preview links; preview links are impossible from a signed-out desktop app;
multi-user live editing is follow-fast, not here; the server is self-hostable and may read
documents (no end-to-end encryption in v1).

## Shape

One server (`apps/server`), one container, one SQLite file next to the artifact volume. It
keeps the artifact routes unchanged (`/c/...`) and adds three route families:

| Family  | Purpose                                                | Auth                      |
| ------- | ------------------------------------------------------ | ------------------------- |
| `/auth` | pair a device to an account, list and revoke devices   | bootstrap or device token |
| `/sync` | push and pull Loro updates per document; change events | device token              |
| `/s`    | shared preview link pages and guest comments           | link capability token     |

The server holds a Loro replica of every synced document, built from the relayed updates, so
it can render link pages and apply guest comments with the same model code the authority
uses (`@composedink/core/model`, a new subpath export with no build-tool dependencies).

Trust: the server is the author's own. Device tokens and link tokens are random 32-byte
values; the database stores only their SHA-256. There is no password login and no email: a
device is paired with a one-time pairing code shown by an already signed-in device or by the
server's bootstrap token on first run.

## Accounts and devices

- **Account**: `{accountId, name, createdAt}`. The first account is created at bootstrap with
  `COMPOSED_BOOTSTRAP_TOKEN` (env; the server refuses to start without it until one account
  exists, then ignores it). Further accounts are out of scope for this unit; the table exists
  so links and documents are owned by an account, not by the server.
- **Device**: `{deviceId, accountId, name, tokenHash, createdAt, lastSeenAt, revokedAt?}`.
  `composed login <server-url> --code <pairing-code>` (or `--bootstrap <token>` once) names
  the device, receives a device token, and writes `$COMPOSED_HOME/session.json`
  `{server, accountId, deviceId, deviceName}` plus the token in `$COMPOSED_HOME/session.secret`
  (mode 0600). Exactly one server session per home in this unit.
- **Pairing**: `composed devices pair` on a signed-in device asks the server for a one-time
  code (10 minutes, single use); `composed devices list` and `composed devices revoke <id>`.
  A revoked token fails every route with 401 and the authority drops to signed-out.
- **Signed-out** is a first-class state: all local features work; `share.*` and sync refuse
  with `fix: composed login <server>`; the desktop status bar shows "Signed out" with the
  same fix.

## Sync (store-and-relay)

The authority remains the only local writer. Sync is a loop the authority runs when signed
in: it pushes its own new updates and imports others' updates through the same import path
that editor typing uses (import unchanged, then normalize). Loro's CRDT merge handles
concurrent edits; the existing normalization repairs alternatives/threads invariants after
every import, so a flip on one device and typing on another converge the same way they do
for editor and agent today.

- **Server log**: per document, an append-only table of update blobs
  `{docId, seq, fromDevice, bytes, vv (Loro version vector after apply), at}`, plus a periodic
  snapshot `{docId, seq, snapshot}` so a fresh device does not replay history. The server
  applies every pushed update to its replica before acknowledging; a blob that fails to import
  is rejected (400) and never stored.
- **Push**: `POST /sync/docs/:docId/updates` with `{since: vv}` and the update bytes exported by
  `doc.export({mode:"update", from: lastAckedVv})`. Idempotent: the server deduplicates by the
  update's Loro version range; re-sending after a lost ack is safe.
- **Pull**: `GET /sync/docs/:docId/updates?since=<seq>` returns blobs after `seq` (or a snapshot
  plus trailing updates when `since` is far behind). The authority imports them under its queue
  and records `seq` in `state.db`.
- **Events**: `GET /sync/events` is a server-sent-events stream (`docId`, `seq`) so devices
  pull promptly; a 30-second poll is the fallback and the reconnection path.
- **Which documents**: every post and component in the home syncs; `meta.deleted` propagates
  like any other change. Kinds and rulesets are device config and do not sync (unchanged).
- **Cursors and receipts** are local (`state.db`) and never relayed.
- **Conflict with inline authority**: sync runs only inside `composed studio` (headless or
  desktop). Inline short commands never sync; they write locally and the next studio run
  pushes.

What this is not: not a live co-editing session (a second author's typing arrives as merged
updates, not as a cursor), not a backup format (snapshots are server state; `composed export`
stays the portable form), not encrypted.

## Shared preview links

A link is a server object owned by the account:
`{linkId, docId, tokenHash, mode: "pinned" | "live", frontiers?: (pinned), questions: {id,text}[],
guestsMayComment: boolean, expiresAt?, revokedAt?, createdAt, createdByDevice}`.

- **Create**: `share.create {id, mode, questions?, expiresIn?}` (op → CLI `composed share
  <id> [--live] [--expires 7d]`, MCP, studio Share button). The authority refuses without a
  session. It first syncs the document (so the server replica is current), then, for a pinned
  link, records the current frontiers. The op returns the URL `https://<server>/s/<token>`.
  Questions default to the document's open feedback request if one exists, else the kind's.
- **Render**: `GET /s/<token>` renders the clean projection (dim and stash omitted, as the
  design says) of the pinned frontiers or the live replica to HTML on the server: Markdown via
  the same remark pipeline hosts use, headings and lists styled plainly, the questions at the
  top. Block components render as a labelled placeholder showing the block tag and its props
  summary; the author's fallback Markdown is used instead when the authority uploaded a
  **render snapshot** at share time (`share.create` runs the preview projection, evaluates
  fallbacks as export does, and posts `{instances: {hash: markdown}}` with the link). Live
  links re-render prose on every view and keep the last snapshot's fallbacks. No remote
  loads; no scripts other than the comment UI.
- **Comment**: the page asks a guest for a display name once (cookie scoped to the link),
  then `POST /s/<token>/threads {quote, text, question?}` and `/threads/:thread/replies`.
  The server resolves the quote against its replica exactly as `thread.open` does, applies the
  model op with `by: {kind:"guest", name, linkId}`, appends the resulting update to the
  document's relay log, and returns the thread. The author's devices receive it as sync. A
  pinned link still comments against the live replica, anchored by quote; if the quote no
  longer exists the thread is created detached, which is the existing rule.
- **Revoke / list**: `share.list {id}`, `share.revoke {link}`. Revoked or expired tokens return
  404 pages, never a reason. Links are not listed in documents; they are account state.
- **Studio**: the Share panel lists links for the open document, creates and revokes them, and
  shows guest threads with the guest's name and link in the comment column (plan 15's column,
  guests just have a different `by`).

## Server changes

- Dependencies: `loro-crdt`, `node:sqlite` (already required ≥22.8 for `vm` constants), the
  `@composedink/core/model` subpath, remark for rendering. The image must contain no build
  toolchain: bundle `apps/server` with tsdown into `dist/` with `loro-crdt` external, and
  install production dependencies only.
- Schema (`$COMPOSED_STORAGE/server.db`): `accounts`, `devices`, `pairing_codes`, `docs`
  `{docId, accountId, kind, snapshotSeq, snapshot BLOB, headSeq}`, `updates`, `links`,
  `render_snapshots`. Migrations are numbered files applied at start inside a transaction.
- Limits: 8 MiB per update blob, 64 MiB per snapshot, 60 requests/minute per link token for
  guests, 10-minute pairing codes. Oversize or over-rate answers 413/429.
- `/healthz` additionally checks that the database opens.

## Interfaces

| Op               | Input                                      | Notes                                                       |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `session.login`  | `{server, code?, bootstrap?, deviceName?}` | CLI only (`composed login`); never MCP                      |
| `session.logout` | —                                          | deletes the local session; server token stays until revoked |
| `session.status` | —                                          | `{signedIn, server?, accountId?, deviceName?, lastSyncAt?}` |
| `devices.pair`   | —                                          | returns a pairing code                                      |
| `devices.list`   | —                                          |                                                             |
| `devices.revoke` | `{device}`                                 |                                                             |
| `sync.now`       | `{id?}`                                    | one push/pull cycle; studio runs it continuously            |
| `share.create`   | `{id, mode, questions?, expiresIn?}`       | refuses without session: `fix: composed login <server>`     |
| `share.list`     | `{id}`                                     |                                                             |
| `share.revoke`   | `{link}`                                   |                                                             |

`feedback.request.to` accepts `"link:<linkId>"` now; the request's questions become the
link's questions when the link is created from the request.

MCP exposes `session.status`, `sync.now` and `share.*`; it never exposes `session.login` or
`devices.*` (pairing is a human act on a device).

## Decisions

| Decision                                                      | Why                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| One server, one container, one SQLite file                    | self-hosted single-author tool; the artifact server is already deployed there       |
| Pairing codes, no passwords or email                          | nothing to leak or reset; the first device uses the bootstrap token once            |
| Server keeps a Loro replica                                   | needed to render live links and to apply guest comments with the same model code    |
| Sync only inside studio                                       | one loop, one writer; inline commands stay simple and offline                       |
| Updates relayed as Loro update blobs, deduplicated by version | retries after lost acks are safe; no custom diff format                             |
| Guest comments are ordinary threads with a guest author       | plan 15's column and ops need no change; devices learn of them by sync              |
| Block fallbacks on link pages come from a render snapshot     | the server never executes component code; the authority already evaluates fallbacks |
| Revoked and expired links are 404                             | no information about what existed                                                   |
| No multi-account flows                                        | table exists for ownership; flows are follow-fast with multi-user editing           |

## Units

| Plan | Delivers                                                                                                                                                  | Depends on | Proven by                                                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16   | server accounts/devices/pairing, update log and snapshots, SSE; `composed login/logout/devices`; authority sync loop; signed-out refusals; desktop status | 12, 15     | two homes against one server converge a post (typing, flip, thread) both ways; revoked device drops to signed-out; signed-out `share.create` refuses with the fix                                        |
| 17   | links: create/list/revoke, render page with questions and fallbacks, named-guest comments, studio Share panel                                             | 16         | guest comment on a link appears as a thread on a second signed-in device; pinned link shows old text while live shows new; revoked link is 404; signed-out desktop shows the disabled Share with the fix |
