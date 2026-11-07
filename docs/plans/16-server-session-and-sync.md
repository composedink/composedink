# Plan 16 — Server session, device pairing and update relay

> **For agentic workers:** execute only this plan, task-by-task. Tick steps and commit each verified task. If code conflicts with a contract, stop and report; do not improvise.

**Depends on:** 12, 15. Paths are composedink-relative unless explicitly marked otherwise.

**Goal:** an author's devices sign in to their own server and converge every post and component through a store-and-relay of Loro updates. Signed-out is a first-class state with one fix. [Sync and sharing](../design/sync-and-sharing.md) is authoritative; shared links are plan 17.

**Files:** server: `apps/server/{package.json,vite.config.ts,Dockerfile,README.md}`, `apps/server/src/{main,artifacts,http,db,auth,sync,replicas,events}.ts`, `apps/server/src/migrations/{index,001-accounts,002-sync}.ts`, `apps/server/tests/{support/server.ts,migrations,auth,sync,health}.test.ts`; root `.dockerignore`. Core: `packages/core/package.json` (exports), add `packages/core/src/model/index.ts`, `src/{session,sync}.ts`; update `src/model/text.ts`, `src/store/{store,recovery}.ts`, `src/{authority,feedback,node}.ts`, `src/ops/{registry,capabilities}.ts`; add `packages/core/tests/{model-entry,session,sync}.test.ts`. CLI: `apps/cli/src/{main,client,studio}.ts`, add `apps/cli/tests/session.test.ts`. Web: add `apps/web/src/SessionStatus.tsx` and `apps/web/tests/session-status.spec.ts`; update `apps/web/src/{PostEditor.tsx,style.css}`, `src/editor/transport.ts`, `apps/web/package.json` (e2e list). Root: `tests/sync.ts`, `package.json` (`sync-e2e` script), `tests/boundaries.test.ts`, `tests/desktop-smoke.ts`; `deploy/README.md`.

**Names already taken:** `$COMPOSED_HOME/session.token` is the studio socket token and stays unchanged. The server session lives in `session.json` and `session.secret`. `RequestId` stays the mutation receipt id.

### Task 1 — Model subpath, server database and a toolchain-free image

- [x] Add `"./model": "./src/model/index.ts"` to `packages/core/package.json` exports. `src/model/index.ts` re-exports only `keys`, `text` (`isPost`, `importTyping`, `importSynced`), `threads`, `feedback`, `read` (`read`, `head`), `projection` and `selection`. Today `model/` imports `loro-crdt`, `zod` and siblings, except `apply.ts` and `validate.ts`, which import `@mdx-js/mdx` (and `yaml`). Those two, plus `inverse.ts` (authority undo) and `component-template.ts`, stay out of the entry; nothing moves. Write `packages/core/tests/model-entry.test.ts` first: it walks the static import graph from `src/model/index.ts` with the TypeScript AST and asserts that the external specifiers are a subset of `loro-crdt`, `zod` and `node:*`. It must fail if `apply.ts` is added to the entry.
- [x] Add `importSynced(doc, bytes)` to `model/text.ts`. Posts go through `importTyping` (import unchanged, then normalize). Components get a plain `doc.import`, because `normalize` throws on non-posts (decision in this plan).
- [x] Split `artifacts.ts` into `artifactHandler({root, token})`, keeping `artifactServer` as a wrapper so the existing tests still pass. Only `/c/` stays on its serial queue: an SSE stream inside that queue would block every request. `http.ts` splits the raw path on `/` and only then decodes each segment, so a component id `composed%3Ascope%2Fname` stays one segment. It also reads bodies with a byte limit (413 as soon as the limit is exceeded) and writes JSON errors as `{error: "<Code>: message"}`. `main.ts` builds one `node:http` server that dispatches `/healthz`, `/c/`, `/auth/` and `/sync/`.
- [x] `db.ts` opens `$COMPOSED_STORAGE/server.db` with `node:sqlite` `DatabaseSync` and runs `PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000`. Migrations are numbered TypeScript modules exporting SQL strings, so the bundle carries them; no `.sql` files are read at runtime. `migrations/index.ts` lists them in order. At start, inside `BEGIN IMMEDIATE`, every migration above `PRAGMA user_version` runs and sets `user_version`, then the transaction commits; any error rolls back and the process exits non-zero. This plan creates only 001 and 002. Plan 17 adds `003-links` for `links` and `render_snapshots`: the runner makes that one file, and an unused table here would be a placeholder (decision in this plan).

  ```sql
  -- 001-accounts
  CREATE TABLE accounts (account_id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE devices (device_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
    name TEXT NOT NULL, token_hash BLOB NOT NULL UNIQUE, created_at INTEGER NOT NULL,
    last_seen_at INTEGER, revoked_at INTEGER);
  CREATE TABLE pairing_codes (code_hash BLOB PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
    created_by_device TEXT NOT NULL REFERENCES devices, expires_at INTEGER NOT NULL, used_at INTEGER);
  -- 002-sync
  CREATE TABLE docs (doc_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts,
    kind TEXT NOT NULL CHECK (kind IN ('post','component')), snapshot_seq INTEGER NOT NULL DEFAULT 0,
    snapshot BLOB, head_seq INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE updates (doc_id TEXT NOT NULL REFERENCES docs, seq INTEGER NOT NULL,
    from_device TEXT REFERENCES devices, bytes BLOB NOT NULL, vv BLOB NOT NULL, at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, seq));
  ```

  `updates.from_device` is nullable so that plan 17's guest updates need no `ALTER` (decision in this plan). `vv` is `oplogVersion().encode()` of the replica after the row is applied.

- [x] Startup refuses to listen when `accounts` is empty and `COMPOSED_BOOTSTRAP_TOKEN` is unset. The message is `COMPOSED_BOOTSTRAP_TOKEN is required until the first device signs in`. Once an account exists, the variable is ignored. `COMPOSED_TOKEN` stays required for artifact PUT. `/healthz` runs `SELECT count(*) FROM accounts` on the open connection: `200 ok` on success, `503` otherwise.
- [x] Bundle with tsdown through Vite+. In `apps/server/package.json`, `dependencies` is only `{"loro-crdt": "catalog:"}`, which stays external because it loads its WASM from its own directory. `devDependencies` gain `"@composedink/core": "workspace:*"` and `"@composedink/blocks": "workspace:*"`, which are bundled. Add `"bundle": "vp pack"` and keep `start` on the source. `vite.config.ts` gains `pack: { entry: { main: "src/main.ts" }, format: ["esm"], platform: "node", dts: false, deps: { neverBundle: ["loro-crdt"] } }`, which outputs `dist/main.mjs`. In `tests/boundaries.test.ts`, allow `composed-server` → `@composedink/core`, but report any core specifier other than `@composedink/core/model`.
- [x] Rewrite `apps/server/Dockerfile` as three steps. The build stage is `node:22.22.3-bookworm-slim` (glibc for Vite+'s native binaries) and runs `corepack enable && corepack prepare pnpm@12.16.1 --activate`, `COPY . .`, `pnpm install --frozen-lockfile --filter composed-server...`, `pnpm --filter composed-server run bundle` and `pnpm --filter composed-server deploy --prod --legacy /prod`. The runtime stage is `node:22.22.3-alpine` and copies `apps/server/dist`, `/prod/node_modules` and `package.json`, with `CMD ["node","dist/main.mjs"]`; `/data`, `USER node`, the port and the healthcheck stay as today. Add a `.dockerignore` excluding `**/node_modules`, `**/dist`, `.git`, `test-results` and `apps/desktop/src-tauri/{target,runtime}`.
- [x] Tests first in `apps/server/tests/{migrations,health}.test.ts`:
  - a fresh DB reaches `user_version` 2;
  - a rerun is a no-op;
  - a failing third migration in an injected list leaves version 2 and no partial table;
  - startup without the bootstrap token fails;
  - `/healthz` returns 200, and 503 after the connection is closed.

  Run `mise exec -- vp run composed-server#test`, `mise exec -- vp run @composedink/core#test` and `mise exec -- vp run composed-server#bundle`; `grep -c "@rsbuild\|@mdx-js" apps/server/dist/main.mjs` must print `0`.

### Task 2 — Accounts, devices and pairing (`/auth`)

- [x] Tokens are 32 random bytes, base64url, sent as `Authorization: Bearer`. The database stores only `sha256` of each token or pairing code. A device whose `revoked_at` is set gets 401 on every route. `last_seen_at` is written at most once a minute (decision in this plan). Routes:
  - `POST /auth/login` takes `{deviceName: string(1..64), code?: string, bootstrap?: string}`, exactly one of `code` or `bootstrap`, and answers `201 {accountId, deviceId, deviceName, token}`. `bootstrap` works only while `accounts` is empty: it compares with `timingSafeEqual` and creates the account `{name: "owner"}` (decision in this plan). Every other case answers 401.
  - `POST /auth/pair` (device) answers `201 {code, expiresAt}`. The code is 8 Crockford base32 characters shown as `ABCD-EFGH`, normalized to upper case without hyphens before hashing, single use, valid for 10 minutes.
  - `GET /auth/devices` (device) answers `200 {current: deviceId, devices: {deviceId, name, createdAt, lastSeenAt, revokedAt}[]}` for the account.
  - `DELETE /auth/devices/:deviceId` (device, same account; revoking yourself is allowed) answers `200 {deviceId, revokedAt}` and closes that device's event streams.
- [x] Failed logins are limited to 10 a minute per server process, then 429. A guessable 40-bit code needs a limit, and the design names 429 (decision in this plan).
- [x] `apps/server/tests/auth.test.ts` covers:
  - first bootstrap, then a second bootstrap gets 401;
  - pair, then log in, then reuse of the code gets 401;
  - an expired code (the test sets `expires_at` in the past) gets 401;
  - the 11th bad attempt gets 429;
  - the devices list;
  - revoke, then 401 on `/auth/pair` and `/sync/events`;
  - a token from another account cannot revoke.

### Task 3 — Update log, replica, pull and events (`/sync`)

- [ ] `replicas.ts` keeps one `LoroDoc` per synced document in memory, loaded lazily from `docs.snapshot` plus the update rows after `snapshot_seq`. Every route checks that `docs.account_id` matches the device's account; a doc owned by another account answers 404.
- [ ] `POST /sync/docs/:docId/updates` takes an `application/octet-stream` body of at most 8 MiB (413 otherwise) and a `Composed-Since: <base64url VersionVector>` header (empty for a new doc) (decision in this plan). It answers `200 {seq, vv, duplicate}`, where `vv` is base64url. The steps:
  1. If `since` is not covered by the replica's `oplogVersion()` (`compare` is not -1 or 0), answer `409 {vv}`.
  2. Run `decodeImportBlobMeta(bytes, true)`. If it throws, answer 400 and store nothing. If the replica's version already covers `partialEndVersionVector`, answer `{seq: head_seq, vv, duplicate: true}` without storing: this is the dedup by Loro version range.
  3. Otherwise `replica.import(bytes)`. If the import throws, or `status.pending` is non-null, evict the replica (reload it from the DB) and answer 400 or 409.
  4. In one SQLite transaction, insert `updates(seq = head_seq+1, from_device, bytes, vv, at)`, update `head_seq`, and create the `docs` row on the first push, with `kind` from `isPost` in `@composedink/core/model`.
  5. After commit, notify the account's streams.
  6. Every 256 rows, or 4 MiB of rows since the last snapshot, write `snapshot = replica.export({mode:"snapshot"})` and `snapshot_seq = head_seq` in that same transaction. A snapshot over 64 MiB answers 413 for the push that triggered it and stores nothing. Update rows are kept, not pruned (decision in this plan), so each pull can return the row `vv` of the snapshot point.
- [ ] `GET /sync/docs/:docId/updates?since=<seq>` answers `{docId, head, vv, snapshot?: {seq, bytes}, updates: {seq, fromDevice, at, bytes}[]}`, with bytes base64. When `since < snapshot_seq`, it returns the snapshot plus the rows after `snapshot_seq` ("far behind" means behind the snapshot); otherwise it returns the rows after `since`. A page stops after 8 MiB of rows, always including at least one, and the client loops until it reaches `head`. `vv` is the row `vv` of the last seq returned (decision in this plan). An unknown doc answers 404.
- [ ] `GET /sync/events` is `text/event-stream`. The first event is `event: heads` with `data: {"docs":[{"docId","seq"}]}`, which is how a fresh device learns which documents exist without another route. Then each change sends `event: doc` with `data: {"docId","seq"}`, and a `: ping` comment goes out every 25 s (decision in this plan). Revocation ends the stream.
- [ ] Tests first in `apps/server/tests/sync.test.ts`, using two real `LoroDoc` peers against a server on a random port:
  - push, pull and converge;
  - the same bytes twice are stored once and the second answer has `duplicate: true`;
  - a `since` beyond the server answers 409 with `vv`;
  - garbage answers 400 with no row stored;
  - an 8 MiB + 1 body answers 413;
  - a 257th push creates a snapshot, and `since=0` returns the snapshot plus trailing rows;
  - a component id containing `/` round-trips;
  - `heads` comes first and `doc` events follow;
  - a restarted server reloads the replicas.

### Task 4 — Session operations, CLI and MCP

- [ ] `packages/core/src/session.ts` owns three files:
  - `$COMPOSED_HOME/session.json`: `{server, accountId, deviceId, deviceName}` while signed in, and `{server}` after logout or revocation, so that the fix can name the server (decision in this plan).
  - `$COMPOSED_HOME/session.secret`: the token, written with mode `0600`. `atomicWrite` gains an optional `mode` passed to `open(temporary, "wx", mode)`.
  - Sync cursors in `state.db`: `recovery.ts` widens `indexState` kinds with `"sync"` and adds `readState(home, kind, key)`. Rows are key `docId` → `{seq, vv}` and key `""` → `{lastSyncAt}`. Login clears every `sync` row (decision in this plan).

  You are signed in exactly when `session.secret` exists and `session.json` has a `deviceId`. `requireSession(home)` throws `SignInRequired: not signed in to a composed server; fix: composed login <server>`, naming the stored server when known. Exactly one session per home: `session.login` while signed in throws `SignedIn: already signed in to <server>; fix: composed logout`.

- [ ] Register these operations, none of them with mutation receipts. `bind` runs `session.*`, `devices.*` and `sync.now` without `a.serialize`, because they change no document; the sync pulls serialize their own transactions (decision in this plan).

  | Operation        | Input                                                                     | CLI mapping                                                                        | Result                                                      |
  | ---------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
  | `session.login`  | `{server: url, code?, bootstrap?, deviceName?}` (default `os.hostname()`) | `composed login <server> (--code <code> \| --bootstrap <token>) [--name <device>]` |                                                             |
  | `session.logout` | —                                                                         | `composed logout`                                                                  |                                                             |
  | `session.status` | —                                                                         | `composed status`                                                                  | `{signedIn, server?, accountId?, deviceName?, lastSyncAt?}` |
  | `devices.pair`   | —                                                                         | `composed devices pair`                                                            | `{code, expiresAt}`                                         |
  | `devices.list`   | —                                                                         | `composed devices list`                                                            |                                                             |
  | `devices.revoke` | `{device}`                                                                | `composed devices revoke <device>`                                                 |                                                             |
  | `sync.now`       | `{id?}`                                                                   | `composed sync [<id>]`                                                             | `{pushed: string[], pulled: string[], lastSyncAt}`          |

  `devices.*` and `sync.now` call `requireSession` first. Revoking the current device signs out locally at once. Feedback `link:` recipients keep refusing until plan 17, but `feedback.ts` changes their message to the `requireSession` text.

- [ ] `mcpRegistry` excludes `session.login`, `session.logout` and `devices.*` alongside `doc.import`, so MCP gains only `session_status` and `sync_now`. In `client.ts`, `call()` routes `sync.now` through `ensureStudio`, as it does for `export`, because sync runs only inside studio. `sync.now` on an inline authority throws `StudioRequired: sync runs inside composed studio; fix: composed studio`.
- [ ] `apps/cli/tests/session.test.ts` spawns `apps/server/src/main.ts` on a random port with temporary storage, then checks:
  - bootstrap login, then `status`;
  - `session.secret` has mode `0600`;
  - `devices pair` on home A, then `login --code` on home B;
  - `devices list` shows both devices;
  - a second login refuses with the fix;
  - `logout` leaves `{server}`;
  - signed-out `composed sync` exits 1 with `fix: composed login <server>`;
  - signed-out `feedback request p --to link:x` gives the same fix;
  - MCP `tools/list` has `session_status` and `sync_now` and has no `session_login`, `session_logout` or `devices_*`.

  Run `mise exec -- vp run composed-cli#test`.

### Task 5 — Authority sync loop inside studio

- [ ] `packages/core/src/sync.ts` exports `startSync(a, home, onStatus)` → `{now(id?), stop(), status()}`. Studio starts it at startup when signed in and sets `a.sync`, a new optional slot on the authority. `session.login` and `session.logout` start and stop it through `a.sync`. Inline authorities never start it.
- [ ] One cycle at a time; triggers coalesce. The triggers are:
  - an `a.subscribe` change, debounced by 500 ms;
  - a `doc` event;
  - stream (re)connection;
  - a 30-second timer. It always runs, so it is both the poll fallback and the reconnection path. The stream reconnects with backoff from 1 s up to 30 s.

  The stream is read from `fetch` with a hand-written `text/event-stream` parser, adding no dependency (decision in this plan). `sync.now` without a live stream opens `/sync/events`, reads `heads` and closes it.

- [ ] Each cycle, over the union of local documents and server heads:
  - **Pull** while `head > seq`. Inside `a.serialize(() => a.transaction(undefined, "sync-pull", …))`, a new authority method `receive(id, blobs)` skips any blob whose `decodeImportBlobMeta` end version the local oplog already covers. It creates unknown documents with `a.create` and applies the rest through `a.change(id, d => importSynced(d, bytes))`, reading `a.documents` directly so that `meta.deleted` still imports. After commit, store `{seq, vv}` from the response. A crash before that write only re-pulls, and Loro imports idempotently.
  - **Push** when `oplogVersion().compare(vv)` is 1 or undefined. Export `doc.export({mode:"update", from: VersionVector.decode(vv)})` and send it with `Composed-Since: vv`. On 200, store the returned `vv`. On 409, adopt the server's `vv` and retry once.

  These are the author's own and normalization ops: pulled ops are already inside `vv`, so they are never echoed back. Kinds, rulesets, receipts and cursors never sync.

- [ ] Any 401 means: delete `session.secret`, rewrite `session.json` to `{server}`, stop the loop and publish signed-out status. Network errors keep the session and retry on the next trigger. After each completed cycle, write `lastSyncAt`. Studio broadcasts `{session: status}` to every socket on each status change.
- [ ] `packages/core/tests/sync.test.ts` uses two authorities on temporary homes against a spawned server and checks:
  - a post typed on A appears on B, and a component created on B appears on A;
  - a flip on A and concurrent typing on B converge to the same text, alternatives and threads;
  - lost acknowledgement: an HTTP proxy in the test forwards the first push and then destroys the client socket, the retry answers `duplicate: true`, and the server row count grows by exactly 1;
  - a restarted authority resumes from the stored `seq`;
  - revocation leads to 401 and the signed-out files;
  - a server reset (fresh storage, same account) gives 409, then a full re-push.

### Task 6 — Status bar, two-home proof, container and runbook

- [ ] Add `SessionStatus.tsx` to the status bar. Signed out, it shows `Signed out` with the visible fix `composed login <server>`. Signed in, it shows `Signed in as <deviceName>` and `synced <relative time>` (or `not yet synced`). It reads `session.status` on connect and updates on `{session}` frames from `transport.ts`. It stays visible in zen mode, like the save state. The desktop shows the same web assets. `apps/web/tests/session-status.spec.ts` (added to the e2e list) checks the signed-out text on a temporary home. `tests/desktop-smoke.ts` asserts `Signed out` in the packaged studio page.
- [ ] Add `tests/sync.ts` and the root script `"sync-e2e": "node --experimental-strip-types tests/sync.ts"`. The script starts `node apps/server/dist/main.mjs` on a random port with temporary storage, and two studios on homes A and B with distinct `COMPOSED_PORT` and `COMPOSED_ARTIFACT_PORT`. Home A goes through a drop-first-ack proxy. Steps:
  1. A logs in with the bootstrap token; B logs in with A's pairing code.
  2. Playwright types into A's editor while B runs `alt.propose`, `alt.flip` and `thread open` through its CLI.
  3. The same again in reverse: typing on B; flip and thread on A.
  4. After `composed sync` on both homes, `doc read --view full --json`, `thread list` and alternatives are identical. The typed text is present, the flipped version is active, and the thread ranges slice to their quotes.
  5. Lost ack: one stored row and a `duplicate: true` retry.
  6. A's status bar shows `Signed in as A`.
  7. A revokes B. B shows `Signed out`, `composed status` reports `signedIn:false`, there is no `session.secret`, and `composed sync` exits 1 with the fix.

  Evidence goes to `test-results/plan-16-sync-proof.json`.

- [ ] Container proof:
  1. `docker build -f apps/server/Dockerfile -t composed-server:plan16 .`
  2. `docker run --rm --entrypoint sh composed-server:plan16 -c 'ls /app/node_modules; find / -xdev \( -name "@rsbuild" -o -name "@mdx-js" -o -name "vite-plus" \) -print'` lists `loro-crdt` (plus pnpm's `.pnpm`) and finds nothing.
  3. `docker run -d --name composed-plan16 -e COMPOSED_TOKEN=t -e COMPOSED_BOOTSTRAP_TOKEN=b -v composed-plan16-data:/data -p 127.0.0.1::4849 composed-server:plan16`, then `curl -fsS http://$(docker port composed-plan16 4849)/healthz` prints `ok`.
  4. `docker exec composed-plan16 ls -l /data/server.db` shows the DB.
  5. `docker rm -f composed-plan16 && docker volume rm composed-plan16-data`.
- [ ] Update `deploy/README.md` and `apps/server/README.md`: `COMPOSED_BOOTSTRAP_TOKEN` (required until the first login), `server.db` on the same volume, the multi-stage image, the `/auth` and `/sync` routes and limits. Staging and production must have the variable set before their next deploy of `main`, or the container refuses to start. Deploying is a separate authorized action.

**Verification:** the design's Units evidence for plan 16 is: **two homes against one server converge a post (typing, flip, thread) both ways; a revoked device drops to signed-out; signed-out refuses with the fix.** Plan 17 proves the `share.create` refusal, because the index forbids placeholder `share.*` operations here (decision in this plan). This plan proves the same refusal through `sync.now` and a `link:` feedback recipient. Run:

- `mise exec -- vp run composed-server#test`
- `mise exec -- vp run @composedink/core#test`
- `mise exec -- vp run composed-cli#test`
- `mise exec -- vp run composed-web#test`
- `mise exec -- vp run composed-web#e2e`
- `mise exec -- vp run composed-web#build`
- `mise exec -- vp run composed-server#bundle`
- `mise exec -- vp run sync-e2e`
- the Task 6 docker commands
- `mise exec -- vp run composed-desktop#package` then `mise exec -- vp run composed-desktop#smoke`

The evidence must show:

- two-home convergence both ways against a real server process;
- a lost-ack retry stored once;
- revocation leading to 401 and the signed-out files and UI;
- `0600` on the secret;
- a bundle and image with no `@rsbuild`, `@mdx-js` or `vite-plus`;
- `/healthz` answering with the DB present in the container.

**Out of scope:** shared links, `links` and `render_snapshots` (plan 17), `share.*` operations, multiple accounts and their flows, live co-editing cursors, end-to-end encryption, update pruning, deploying staging or production, and syncing kinds, rulesets, receipts or cursors.

**Common completion gate:** `mise exec -- vp check --fix` and `mise exec -- vp run -r test`. Tests import from `vite-plus/test`; use package `vite.config.ts`, never `vitest.config.ts`. Add any named script in this plan before invoking it. Repeat formatting until stable, stage only this unit's files, commit the completed task, and update this index's status. Commands are planned implementation gates, not results from this documentation task.
