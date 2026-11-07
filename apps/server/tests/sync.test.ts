import { LoroDoc, VersionVector } from "loro-crdt";
import { afterEach, expect, it } from "vite-plus/test";
import { BOOTSTRAP, startServer, type TestServer } from "./support/server.ts";

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.remove();
});
async function setup() {
  const s = await startServer();
  servers.push(s);
  const login = async (body: Record<string, string>) =>
    (
      await s.fetch("/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json();
  const a = await login({ deviceName: "A", bootstrap: BOOTSTRAP });
  const { code } = await (
    await s.fetch("/auth/pair", { method: "POST", headers: { authorization: `Bearer ${a.token}` } })
  ).json();
  const b = await login({ deviceName: "B", code });
  return { s, a: client(s, a.token), b: client(s, b.token) };
}
const path = (docId: string) => `/sync/docs/${encodeURIComponent(docId)}/updates`;
function client(s: TestServer, token: string) {
  const auth = { authorization: `Bearer ${token}` };
  return {
    token,
    async push(docId: string, bytes: Uint8Array, since = "") {
      const response = await s.fetch(path(docId), {
        method: "POST",
        headers: { ...auth, "content-type": "application/octet-stream", "composed-since": since },
        body: Buffer.from(bytes),
      });
      return { status: response.status, body: await response.json() };
    },
    async pull(docId: string, since = 0) {
      const response = await s.fetch(`${path(docId)}?since=${since}`, { headers: auth });
      return { status: response.status, body: await response.json() };
    },
    events: () => s.fetch("/sync/events", { headers: auth }),
  };
}
const post = (slug: string, body: string) => {
  const doc = new LoroDoc();
  doc.getMap("meta").set("slug", slug);
  prose(doc).insert(0, body);
  doc.commit();
  return doc;
};
/** The post body (the root boundary test keeps `mdx` mutations inside core/model). */
const prose = (doc: LoroDoc) => doc.getText("mdx");
const vvOf = (doc: LoroDoc) => Buffer.from(doc.oplogVersion().encode()).toString("base64url");
const rows = (s: TestServer, docId: string) =>
  (s.db.prepare("SELECT count(*) AS n FROM updates WHERE doc_id = ?").get(docId) as { n: number })
    .n;
/** Imports a pull (snapshot first, then updates) into `doc`. */
const apply = (
  doc: LoroDoc,
  pulled: { snapshot?: { bytes: string }; updates: { bytes: string }[] },
) => {
  if (pulled.snapshot) doc.import(Buffer.from(pulled.snapshot.bytes, "base64"));
  for (const u of pulled.updates) doc.import(Buffer.from(u.bytes, "base64"));
};

it("pushes, pulls and converges two peers", async () => {
  const { s, a, b } = await setup();
  const docA = post("hello", "Hello");
  const first = await a.push("hello", docA.export({ mode: "update" }));
  expect(first).toMatchObject({ status: 200, body: { seq: 1, duplicate: false } });
  expect(first.body.vv).toBe(vvOf(docA));

  const docB = new LoroDoc();
  const pulled = await b.pull("hello");
  expect(pulled.body).toMatchObject({ docId: "hello", head: 1, vv: vvOf(docA) });
  expect(pulled.body.updates[0]).toMatchObject({ seq: 1 });
  apply(docB, pulled.body);
  const since = vvOf(docB);
  prose(docB).insert(5, " world");
  docB.commit();
  const fromB = await b.push(
    "hello",
    docB.export({ mode: "update", from: VersionVector.decode(Buffer.from(since, "base64url")) }),
    since,
  );
  expect(fromB.body.seq).toBe(2);
  apply(docA, (await a.pull("hello", 1)).body);
  expect(docA.getText("mdx").toString()).toBe("Hello world");
  expect(docA.getText("mdx").toString()).toBe(docB.getText("mdx").toString());
  expect(s.db.prepare("SELECT kind FROM docs WHERE doc_id = 'hello'").get()).toEqual({
    kind: "post",
  });
});

it("stores the same bytes once and answers the retry as a duplicate", async () => {
  const { s, a } = await setup();
  const bytes = post("p", "x").export({ mode: "update" });
  expect((await a.push("p", bytes)).body.duplicate).toBe(false);
  const retry = await a.push("p", bytes);
  expect(retry).toMatchObject({ status: 200, body: { seq: 1, duplicate: true } });
  expect(rows(s, "p")).toBe(1);
});

it("answers 409 with the server vv when since is beyond the server", async () => {
  const { a } = await setup();
  const doc = post("p", "x");
  await a.push("p", doc.export({ mode: "update" }));
  const ahead = doc.fork();
  prose(ahead).insert(0, "more ");
  ahead.commit();
  const conflict = await a.push("p", ahead.export({ mode: "update" }), vvOf(ahead));
  expect(conflict.status).toBe(409);
  expect(conflict.body.vv).toBe(vvOf(doc));
  expect(conflict.body.error).toMatch(/^Conflict: /);
});

it("rejects garbage with 400 and stores nothing", async () => {
  const { s, a } = await setup();
  const result = await a.push("p", new Uint8Array([1, 2, 3, 4]));
  expect(result.status).toBe(400);
  expect(rows(s, "p")).toBe(0);
  expect(s.db.prepare("SELECT count(*) AS n FROM docs").get()).toEqual({ n: 0 });
});

it("answers 413 for an update over 8 MiB", async () => {
  const { s, a } = await setup();
  const result = await a.push("p", new Uint8Array(8 * 1024 * 1024 + 1));
  expect(result.status).toBe(413);
  expect(rows(s, "p")).toBe(0);
});

it("snapshots at the 256th row and serves snapshot plus trailing rows from since=0", async () => {
  const { s, a } = await setup();
  const doc = post("long", "");
  let since = "";
  for (let i = 0; i < 257; i++) {
    const from = since ? VersionVector.decode(Buffer.from(since, "base64url")) : undefined;
    prose(doc).insert(doc.getText("mdx").length, `${i % 10}`);
    doc.commit();
    const pushed = await a.push("long", doc.export({ mode: "update", from }), since);
    expect(pushed.body.seq).toBe(i + 1);
    since = pushed.body.vv;
  }
  expect(s.db.prepare("SELECT snapshot_seq, head_seq FROM docs").get()).toEqual({
    snapshot_seq: 256,
    head_seq: 257,
  });
  expect(rows(s, "long")).toBe(257);
  const pulled = (await a.pull("long", 0)).body;
  expect(pulled.snapshot.seq).toBe(256);
  expect(pulled.updates.map((u: { seq: number }) => u.seq)).toEqual([257]);
  expect(pulled.vv).toBe(vvOf(doc));
  const fresh = new LoroDoc();
  apply(fresh, pulled);
  expect(fresh.getText("mdx").toString()).toBe(doc.getText("mdx").toString());
  // At or past the snapshot point: plain rows.
  expect((await a.pull("long", 300)).body.updates).toEqual([]);
  const near = (await a.pull("long", 256)).body;
  expect(near.snapshot).toBeUndefined();
  expect(near.updates.map((u: { seq: number }) => u.seq)).toEqual([257]);
  expect((await a.pull("long", 255)).body.snapshot.seq).toBe(256);
});

it("round-trips a component id containing a slash", async () => {
  const { s, a, b } = await setup();
  const id = "composed:scope/name";
  const doc = new LoroDoc();
  doc.getMap("meta").set("kind", "component");
  doc.getMap("files").set("index.tsx", "x");
  doc.commit();
  expect((await a.push(id, doc.export({ mode: "update" }))).status).toBe(200);
  const pulled = await b.pull(id);
  expect(pulled.body.docId).toBe(id);
  expect(s.db.prepare("SELECT doc_id, kind FROM docs").get()).toEqual({
    doc_id: id,
    kind: "component",
  });
  expect((await b.pull("composed:scope")).status).toBe(404);
});

it("sends heads first and doc events after", async () => {
  const { a, b } = await setup();
  await a.push("one", post("one", "1").export({ mode: "update" }));
  const response = await b.events();
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
  let text = "";
  const until = async (pattern: RegExp) => {
    while (!pattern.test(text)) text += new TextDecoder().decode((await reader.read()).value);
  };
  await until(/event: heads\n/);
  expect(text).toBe('event: heads\ndata: {"docs":[{"docId":"one","seq":1}]}\n\n');
  await a.push("two", post("two", "2").export({ mode: "update" }));
  await until(/event: doc\n/);
  expect(text.slice(text.indexOf("event: doc"))).toBe(
    'event: doc\ndata: {"docId":"two","seq":1}\n\n',
  );
  await reader.cancel();
});

it("keeps documents of one account from another", async () => {
  const { s, a } = await setup();
  await a.push("mine", post("mine", "m").export({ mode: "update" }));
  s.db.prepare("INSERT INTO accounts VALUES ('other', 'other', 0)").run();
  const { createHash } = await import("node:crypto");
  s.db
    .prepare(
      "INSERT INTO devices (device_id, account_id, name, token_hash, created_at) VALUES (?,?,?,?,?)",
    )
    .run("x", "other", "X", createHash("sha256").update("other-token").digest(), 0);
  const other = client(s, "other-token");
  expect((await other.pull("mine")).status).toBe(404);
  expect((await other.push("mine", post("mine", "z").export({ mode: "update" }))).status).toBe(404);
});

it("reloads replicas after a restart", async () => {
  const { s, a } = await setup();
  const doc = post("p", "before");
  const first = await a.push("p", doc.export({ mode: "update" }));
  await s.stop();
  const restarted = await startServer({ storage: s.storage });
  servers.push(restarted);
  const again = client(restarted, a.token);
  // The reloaded replica still knows seq 1: same bytes are a duplicate, a since at its vv is fine.
  expect((await again.push("p", doc.export({ mode: "update" }))).body).toMatchObject({
    seq: 1,
    duplicate: true,
    vv: first.body.vv,
  });
  const since = vvOf(doc);
  prose(doc).insert(0, "after ");
  doc.commit();
  const next = await again.push(
    "p",
    doc.export({ mode: "update", from: VersionVector.decode(Buffer.from(since, "base64url")) }),
    since,
  );
  expect(next.body).toMatchObject({ seq: 2, duplicate: false });
});
