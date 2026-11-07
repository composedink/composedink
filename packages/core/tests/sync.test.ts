import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer as createHttpServer, request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { LoroDoc } from "loro-crdt";
import { afterEach, expect, it } from "vite-plus/test";
import { authority, bind, openStore, syncSlot } from "../src/node.ts";
import type { SessionStatus } from "../src/session.ts";

const serverEntry = resolve(import.meta.dirname, "../../../apps/server/src/main.ts");
const BOOTSTRAP = "core-sync-bootstrap";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run();
});

async function freePort() {
  const server = createNetServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}

/** `apps/server` as a real process on a fixed port, restartable on the same storage. */
async function spawnServer() {
  const storage = await mkdtemp(join(tmpdir(), "core-sync-server-"));
  const port = await freePort();
  let child: ChildProcess | undefined;
  const start = async () => {
    child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", serverEntry], {
      env: {
        ...process.env,
        COMPOSED_STORAGE: storage,
        COMPOSED_TOKEN: "artifact",
        COMPOSED_BOOTSTRAP_TOKEN: BOOTSTRAP,
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve, reject) => {
      child!.stdout!.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes('"ready"')) resolve();
      });
      child!.once("exit", (code) => reject(Error(`server exited ${code}`)));
    });
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await once(child, "exit");
  };
  await start();
  cleanup.push(async () => {
    await stop();
    await rm(storage, { recursive: true, force: true });
  });
  const db = <T>(run: (db: DatabaseSync) => T) => {
    const handle = new DatabaseSync(join(storage, "server.db"));
    try {
      return run(handle);
    } finally {
      handle.close();
    }
  };
  return {
    url: `http://127.0.0.1:${port}`,
    start,
    stop,
    db,
    rows: (docId: string) =>
      db(
        (d) =>
          (
            d.prepare("SELECT count(*) AS n FROM updates WHERE doc_id = ?").get(docId) as {
              n: number;
            }
          ).n,
      ),
  };
}

/** Forwards to the server, logging pushes and pulls; `dropNextPush` loses one acknowledgement. */
async function spawnProxy(target: string) {
  const log: { method: string; path: string; status: number; body?: string }[] = [];
  const state = { dropNextPush: false, streams: 0 };
  const server = createHttpServer((req, res) => {
    const upstream = request(
      target + req.url,
      { method: req.method, headers: req.headers },
      (response) => {
        const push = req.method === "POST" && req.url!.startsWith("/sync/docs/");
        const pull = req.method === "GET" && req.url!.startsWith("/sync/docs/");
        if (!push && !pull) {
          if (req.url === "/sync/events" && response.statusCode === 200) state.streams++;
          res.writeHead(response.statusCode!, response.headers);
          response.pipe(res);
          // A dying server ends the client's stream too.
          response.on("close", () => res.destroy());
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          log.push({ method: req.method!, path: req.url!, status: response.statusCode!, body });
          if (push && state.dropNextPush) {
            // The server stored the update; the client never hears so.
            state.dropNextPush = false;
            req.socket.destroy();
            return;
          }
          res.writeHead(response.statusCode!, response.headers);
          res.end(body);
        });
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  return { url: `http://127.0.0.1:${address.port}`, log, state };
}

async function device(home?: string) {
  const path = home ?? (await mkdtemp(join(tmpdir(), "core-sync-home-")));
  const a = await authority(await openStore(path));
  const statuses: SessionStatus[] = [];
  a.sync = syncSlot(a, path, (s) => statuses.push(s));
  const run = bind(a);
  const sync = () => a.sync!.now();
  const stop = () => a.sync!.stop();
  cleanup.push(async () => {
    await stop();
    if (!home) await rm(path, { recursive: true, force: true });
  });
  return { home: path, a, run, sync, stop, statuses };
}
type Device = Awaited<ReturnType<typeof device>>;

async function world() {
  const server = await spawnServer();
  const proxy = await spawnProxy(server.url);
  const A = await device();
  const B = await device();
  await A.run("session.login", { server: proxy.url, bootstrap: BOOTSTRAP, deviceName: "A" });
  const { code } = (await A.run("devices.pair", {})) as { code: string };
  await B.run("session.login", { server: server.url, code, deviceName: "B" });
  return { server, proxy, A, B };
}

/** Editor typing: a replica of the document, a local insert, the update through `a.typing`. */
async function type(d: Device, id: string, text: string, at?: number) {
  const replica = new LoroDoc();
  replica.import(d.a.synchronize(id));
  const from = replica.oplogVersion();
  const t = replica.getText("mdx");
  t.insert(at ?? t.length, text);
  replica.commit();
  await d.a.serialize(() => d.a.typing(id, replica.export({ mode: "update", from })));
}
async function state(d: Device, id: string) {
  const read = (await d.run("doc.read", { doc: id, view: "full" })) as {
    text: string;
    alts: unknown[];
  };
  return { text: read.text, alts: read.alts, threads: await d.run("thread.list", { id }) };
}
const base = (d: Device, id: string) => d.a.read(id).base;
/** Both directions until neither side has anything left to move. */
async function converge(...devices: Device[]) {
  for (let round = 0; round < 3; round++) for (const d of devices) await d.sync();
}

it("relays a post typed on A to B and a component created on B to A", async () => {
  const { A, B } = await world();
  await A.run("doc.create", { slug: "p" });
  await type(A, "p", "Typed on A.");
  // The background loops also run (stream events, debounced changes); cycles coalesce, so assert
  // on state rather than on which cycle moved what.
  await A.sync();
  await B.sync();
  expect(B.a.read("p").text).toBe(A.a.read("p").text);
  expect(B.a.read("p").text).toMatch(/\nTyped on A\.$/);

  await B.run("component.create", { id: "composed:t/widget", kind: "inline" });
  await converge(B, A);
  const files = (r: unknown) => (r as { files: Record<string, string> }).files;
  expect(files(await A.run("component.read", { id: "composed:t/widget" }))).toEqual(
    files(await B.run("component.read", { id: "composed:t/widget" })),
  );
  expect(A.statuses.at(-1)).toMatchObject({ signedIn: true, deviceName: "A" });
  expect(typeof A.statuses.at(-1)!.lastSyncAt).toBe("number");
}, 60_000);

it("converges a flip on A with concurrent typing on B: text, alternatives and threads", async () => {
  const { A, B } = await world();
  await A.run("doc.create", { slug: "p" });
  await type(A, "p", "Alpha beta gamma.\n\nSecond paragraph.");
  const { alt } = (await A.run("alt.propose", {
    doc: "p",
    at: { base: base(A, "p"), quote: "beta" },
    versions: ["BETA"],
    by: { kind: "agent", name: "cli" },
  })) as { alt: string };
  await A.run("thread.open", { id: "p", base: base(A, "p"), quote: "gamma", text: "why gamma?" });
  await converge(A, B);
  expect(await state(B, "p")).toEqual(await state(A, "p"));

  await A.run("alt.flip", { doc: "p", alt, to: "next" });
  await type(B, "p", " Typed on B.");
  await converge(A, B);
  const a = await state(A, "p");
  expect(await state(B, "p")).toEqual(a);
  expect(a.text).toMatch(/\nAlpha BETA gamma\.\n\nSecond paragraph\. Typed on B\.$/);
  expect(a.threads).toMatchObject([{ state: "open", messages: [{ text: "why gamma?" }] }]);
  const [thread] = a.threads as { from: number; to: number }[];
  expect(a.text.slice(thread.from, thread.to)).toBe("gamma");
}, 60_000);

it("stores a push once when its acknowledgement is lost, and resumes after a restart", async () => {
  const { server, proxy, A, B } = await world();
  await A.run("doc.create", { slug: "lost" });
  await type(A, "lost", "Once.");
  proxy.state.dropNextPush = true;
  await A.sync();
  const pushes = proxy.log.filter((l) => l.method === "POST" && l.path.includes("/lost/"));
  expect(pushes.map((p) => JSON.parse(p.body!).duplicate)).toEqual([false, true]);
  expect(server.rows("lost")).toBe(1);

  // A restarted authority keeps its cursor: it pulls only what came after.
  await converge(A, B);
  const before = server.db(
    (d) =>
      d.prepare("SELECT head_seq FROM docs WHERE doc_id = 'lost'").get() as { head_seq: number },
  ).head_seq;
  await A.stop();
  const restarted = await device(A.home);
  await restarted.a.sync!.start();
  // Only A goes through the proxy. The log is cleared before B's change so that the pull counts
  // whether the restarted loop's `doc` event or the explicit sync performs it.
  proxy.log.length = 0;
  await type(B, "lost", " Twice.");
  await B.sync();
  await restarted.sync();
  const pulls = proxy.log.filter((l) => l.method === "GET" && l.path.includes("/lost/"));
  expect(pulls.map((p) => p.path)).toEqual([`/sync/docs/lost/updates?since=${before}`]);
  expect(restarted.a.read("lost").text).toMatch(/\nOnce\. Twice\.$/);
}, 60_000);

it("drops a revoked device to signed out with the session files", async () => {
  const { server, A, B } = await world();
  const { deviceId } = JSON.parse(await readFile(join(B.home, "session.json"), "utf8"));
  await A.run("devices.revoke", { device: deviceId });
  await expect(B.sync()).rejects.toThrow(
    `SignInRequired: not signed in to a composed server; fix: composed login ${server.url}`,
  );
  await expect(stat(join(B.home, "session.secret"))).rejects.toThrow();
  expect(JSON.parse(await readFile(join(B.home, "session.json"), "utf8"))).toEqual({
    server: server.url,
  });
  expect(await B.run("session.status", {})).toEqual({ signedIn: false, server: server.url });
  await expect.poll(() => B.statuses.at(-1)?.signedIn).toBe(false);
  await expect(B.run("sync.now", {})).rejects.toThrow("fix: composed login");
}, 60_000);

it("re-pushes everything after the server loses its sync storage", async () => {
  const { server, proxy, A } = await world();
  await A.run("doc.create", { slug: "p" });
  await type(A, "p", "Survives a reset.");
  await A.sync();
  expect(server.rows("p")).toBe(1);
  await server.stop();
  server.db((d) => d.exec("DELETE FROM updates; DELETE FROM docs;"));
  const streams = proxy.state.streams;
  proxy.log.length = 0;
  await server.start();
  // A's live stream reconnects (backoff from 1 s) and reads the server's empty heads; the cycle
  // it triggers may already push, so the log is cleared before the restart.
  await expect.poll(() => proxy.state.streams, { timeout: 10_000 }).toBeGreaterThan(streams);
  await A.sync();
  const pushes = proxy.log.filter((l) => l.method === "POST" && l.path.includes("/p/"));
  expect(pushes.map((p) => p.status)).toEqual([409, 200]);
  expect(server.rows("p")).toBe(1);
  const fresh = await device();
  const { code } = (await A.run("devices.pair", {})) as { code: string };
  await fresh.run("session.login", { server: server.url, code, deviceName: "C" });
  await fresh.sync();
  expect(fresh.a.read("p").text).toMatch(/\nSurvives a reset\.$/);
}, 60_000);

// A remote flip rewrites the alt entry in the same import; dissolveCrossed keeps it.
it("keeps the alternative after a synced flip", async () => {
  const { A, B } = await world();
  await A.run("doc.create", { slug: "p" });
  await type(A, "p", "Alpha beta gamma.");
  const { alt } = (await A.run("alt.propose", {
    doc: "p",
    at: { base: base(A, "p"), quote: "beta" },
    versions: ["BETA"],
    by: { kind: "agent", name: "cli" },
  })) as { alt: string };
  await converge(A, B);
  await A.run("alt.flip", { doc: "p", alt, to: "next" });
  await converge(A, B);
  expect((await state(B, "p")).alts).toMatchObject([{ id: alt, active: 1, count: 2 }]);
}, 60_000);
