import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LoroDoc, encodeFrontiers } from "loro-crdt";
import { afterEach, expect, it } from "vite-plus/test";
import { openDatabase } from "../src/db.ts";
import { MIGRATIONS } from "../src/migrations/index.ts";
import {
  bootstrapDevice,
  deviceJson,
  pushDoc,
  startServer,
  type TestServer,
} from "./support/server.ts";

const servers: TestServer[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.remove();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

const frontiersOf = (doc: LoroDoc) =>
  Buffer.from(encodeFrontiers(doc.frontiers())).toString("base64url");
const questions = [{ id: "r.q1", text: "Does the opening land?" }];
/** The post body (the root boundary test keeps `mdx` mutations inside core/model). */
const prose = (doc: LoroDoc) => doc.getText("mdx");

async function setup() {
  const s = await startServer();
  servers.push(s);
  const token = await bootstrapDevice(s);
  const doc = new LoroDoc();
  doc.getMap("meta").set("slug", "post");
  prose(doc).insert(0, "Hello there.");
  doc.commit();
  expect((await pushDoc(s, token, "post", doc.export({ mode: "update" }))).status).toBe(200);
  return { s, token, doc };
}

it("creates pinned and live links with a token whose hash alone is stored", async () => {
  const { s, token, doc } = await setup();
  const pinned = await deviceJson(s, token, "/sync/links", {
    linkId: "link-pinned",
    docId: "post",
    mode: "pinned",
    frontiers: frontiersOf(doc),
    questions,
    instances: { abc: "**fallback**" },
  });
  expect(pinned.status).toBe(201);
  expect(pinned.body.linkId).toBe("link-pinned");
  expect(pinned.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const live = await deviceJson(s, token, "/sync/links", {
    linkId: "link-live",
    docId: "post",
    mode: "live",
    questions,
    expiresAt: Date.now() + 60_000,
    instances: {},
  });
  expect(live.status).toBe(201);
  expect(live.body.token).not.toBe(pinned.body.token);

  const row = s.db
    .prepare("SELECT token_hash, mode, frontiers, guests_may_comment FROM links WHERE link_id = ?")
    .get("link-pinned") as Record<string, unknown>;
  expect(Buffer.from(row.token_hash as Uint8Array)).toEqual(
    createHash("sha256").update(pinned.body.token).digest(),
  );
  expect(row).toMatchObject({ mode: "pinned", frontiers: frontiersOf(doc), guests_may_comment: 1 });
  const snapshot = s.db
    .prepare("SELECT instances FROM render_snapshots WHERE link_id = ?")
    .get("link-pinned") as { instances: string };
  expect(JSON.parse(snapshot.instances)).toEqual({ abc: "**fallback**" });
});

it("answers 409 for a pinned frontier the replica does not contain", async () => {
  const { s, token } = await setup();
  const elsewhere = new LoroDoc();
  prose(elsewhere).insert(0, "Unsynced.");
  elsewhere.commit();
  const response = await deviceJson(s, token, "/sync/links", {
    linkId: "link-unknown-frontier",
    docId: "post",
    mode: "pinned",
    frontiers: frontiersOf(elsewhere),
    questions,
    instances: {},
  });
  expect(response.status).toBe(409);
  expect(s.db.prepare("SELECT count(*) AS n FROM links").get()).toEqual({ n: 0 });
});

it("answers 404 for an unsynced document or another account's document", async () => {
  const { s, token } = await setup();
  const unknown = await deviceJson(s, token, "/sync/links", {
    linkId: "link-x",
    docId: "never-synced",
    mode: "live",
    questions,
    instances: {},
  });
  expect(unknown.status).toBe(404);

  // A second account exists only in the table today (no multi-account flows).
  const other = "other-token";
  s.db.prepare("INSERT INTO accounts VALUES ('acct-2','other',0)").run();
  s.db
    .prepare(
      "INSERT INTO devices (device_id, account_id, name, token_hash, created_at) VALUES (?,?,?,?,?)",
    )
    .run("dev-2", "acct-2", "Z", createHash("sha256").update(other).digest(), 0);
  const foreign = await deviceJson(s, other, "/sync/links", {
    linkId: "link-y",
    docId: "post",
    mode: "live",
    questions,
    instances: {},
  });
  expect(foreign.status).toBe(404);
  expect((await deviceJson(s, other, "/sync/links?doc=post")).status).toBe(404);
});

it("lists links without tokens or hashes and revokes idempotently", async () => {
  const { s, token, doc } = await setup();
  const created = await deviceJson(s, token, "/sync/links", {
    linkId: "link-1",
    docId: "post",
    mode: "pinned",
    frontiers: frontiersOf(doc),
    questions,
    instances: {},
  });
  const list = await deviceJson(s, token, "/sync/links?doc=post");
  expect(list.status).toBe(200);
  expect(list.body.links).toEqual([
    {
      linkId: "link-1",
      mode: "pinned",
      questions,
      createdAt: expect.any(Number),
      expiresAt: null,
      revokedAt: null,
    },
  ]);
  const raw = JSON.stringify(list.body);
  expect(raw).not.toContain(created.body.token);
  expect(raw).not.toMatch(/token|hash/i);

  const first = await deviceJson(s, token, "/sync/links/link-1/revoke", {});
  expect(first).toMatchObject({ status: 200, body: { linkId: "link-1" } });
  expect(first.body.revokedAt).toEqual(expect.any(Number));
  const second = await deviceJson(s, token, "/sync/links/link-1/revoke", {});
  expect(second.body).toEqual(first.body);
  expect((await deviceJson(s, token, "/sync/links?doc=post")).body.links[0].revokedAt).toBe(
    first.body.revokedAt,
  );
  expect((await deviceJson(s, token, "/sync/links/nope/revoke", {})).status).toBe(404);
});

it("upgrades a version-2 database with migration 003", async () => {
  const storage = await mkdtemp(join(tmpdir(), "composed-links-migration-"));
  homes.push(storage);
  const old = openDatabase(storage, MIGRATIONS.slice(0, 2));
  old.prepare("INSERT INTO accounts VALUES ('acct','owner',0)").run();
  old.close();
  const db = openDatabase(storage);
  expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 });
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
  expect(tables).toEqual(expect.arrayContaining(["links", "render_snapshots"]));
  expect(db.prepare("SELECT count(*) AS n FROM accounts").get()).toEqual({ n: 1 });
  db.close();
  // A pinned link without frontiers violates the CHECK.
  const raw = new DatabaseSync(join(storage, "server.db"));
  expect(() =>
    raw.exec(
      "INSERT INTO links (link_id, account_id, doc_id, token_hash, mode, questions, created_at, created_by_device) VALUES ('l','acct','d',x'00','pinned','[]',0,'dev')",
    ),
  ).toThrow(/CHECK/);
  raw.close();
});
