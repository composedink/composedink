// Plan 16 proof: two homes against one real server process converge a post (typing, flip, thread)
// both ways; a lost acknowledgement is stored once; a revoked device drops to signed out.
import { chromium, expect, type Page } from "@playwright/test";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer, request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const entry = join(root, "apps/cli/src/main.ts");
const BOOTSTRAP = "sync-e2e-bootstrap";
const proof: Record<string, unknown> = {};
const cleanup: (() => Promise<void> | void)[] = [];

async function freePort() {
  const server = createNetServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}

// The server runs from its bundle, as in the container.
const bundled = spawnSync("mise", ["exec", "--", "vp", "run", "composed-server#bundle"], {
  cwd: root,
  stdio: "inherit",
});
assert.equal(bundled.status, 0, "server bundle");
const storage = await mkdtemp(join(tmpdir(), "sync-e2e-server-"));
const serverPort = await freePort();
const server = spawn(process.execPath, [join(root, "apps/server/dist/main.mjs")], {
  env: {
    ...process.env,
    COMPOSED_STORAGE: storage,
    COMPOSED_TOKEN: "artifact",
    COMPOSED_BOOTSTRAP_TOKEN: BOOTSTRAP,
    PORT: String(serverPort),
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "inherit"],
});
cleanup.push(async () => {
  server.kill("SIGTERM");
  await rm(storage, { recursive: true, force: true });
});
await new Promise<void>((resolve, reject) => {
  server.stdout!.on("data", (b: Buffer) => b.toString().includes('"ready"') && resolve());
  server.once("exit", (code) => reject(Error(`server exited ${code}`)));
});
const serverUrl = `http://127.0.0.1:${serverPort}`;
const rows = (docId: string) => {
  const db = new DatabaseSync(join(storage, "server.db"), { readOnly: true });
  try {
    return (
      db.prepare("SELECT count(*) AS n FROM updates WHERE doc_id = ?").get(docId) as { n: number }
    ).n;
  } finally {
    db.close();
  }
};

// Home A reaches the server through a proxy that can lose one push acknowledgement.
const pushes: { doc: string; status: number; body: string; dropped: boolean }[] = [];
let dropFor: string | undefined;
const proxy = createHttpServer((req, res) => {
  const upstream = request(
    serverUrl + req.url,
    { method: req.method, headers: req.headers },
    (response) => {
      const match = /^\/sync\/docs\/([^/]+)\/updates$/.exec(req.url ?? "");
      if (req.method !== "POST" || !match) {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
        response.on("close", () => res.destroy());
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (c: Buffer) => chunks.push(c));
      response.on("end", () => {
        const doc = decodeURIComponent(match[1]);
        const body = Buffer.concat(chunks).toString();
        const dropped = dropFor === doc;
        pushes.push({ doc, status: response.statusCode!, body, dropped });
        if (dropped) {
          dropFor = undefined;
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
proxy.listen(0, "127.0.0.1");
await once(proxy, "listening");
const proxyAddress = proxy.address();
if (!proxyAddress || typeof proxyAddress === "string") throw Error("proxy");
const proxyUrl = `http://127.0.0.1:${proxyAddress.port}`;
cleanup.push(() => {
  proxy.closeAllConnections();
  proxy.close();
});

async function home(label: string) {
  const path = await mkdtemp(join(tmpdir(), `sync-e2e-${label}-`));
  const env = {
    ...process.env,
    COMPOSED_HOME: path,
    COMPOSED_PORT: String(await freePort()),
    COMPOSED_ARTIFACT_PORT: String(await freePort()),
  };
  const run = (...args: string[]) =>
    promisify(execFile)(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", entry, ...args],
      {
        env,
      },
    );
  const studio: ChildProcess = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", entry, "studio", "--headless"],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  studio.stdout!.on("data", (b) => (output += String(b)));
  studio.stderr!.on("data", (b) => (output += String(b)));
  cleanup.push(async () => {
    if (studio.pid && studio.exitCode === null) {
      process.kill(-studio.pid, "SIGTERM");
      await once(studio, "exit");
    }
    await mkdir(join(root, "test-results"), { recursive: true });
    await writeFile(join(root, `test-results/plan-16-sync-studio-${label}.log`), output);
    await rm(path, { recursive: true, force: true });
  });
  await expect.poll(() => output, { timeout: 60_000 }).toContain('"ready":true');
  return {
    path,
    origin: `http://127.0.0.1:${env.COMPOSED_PORT}`,
    cli: async (...args: string[]) => JSON.parse((await run(...args)).stdout),
    fails: async (...args: string[]) => {
      try {
        await run(...args);
      } catch (error) {
        const failure = error as { code: number; stderr: string };
        return { code: failure.code, stderr: failure.stderr };
      }
      throw Error(`expected ${args.join(" ")} to fail`);
    },
  };
}
type Home = Awaited<ReturnType<typeof home>>;

/** Comparable state of a post on a home: full text, alternatives and threads. */
async function state(h: Home, doc: string) {
  const read = await h.cli("cat", doc, "--view", "full", "--json");
  return {
    text: read.text as string,
    alts: read.alts,
    threads: await h.cli("thread", "list", doc),
  };
}
async function settle(...homes: Home[]) {
  for (let round = 0; round < 3; round++) for (const h of homes) await h.cli("sync");
}
async function typeAtEnd(page: Page, text: string) {
  await page.locator(".cm-content .cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 30_000 });
}
/** B (or A) proposes, flips and opens a thread through its CLI. */
async function operate(
  h: Home,
  doc: string,
  target: string,
  version: string,
  quote: string,
  note: string,
) {
  const { base } = await h.cli("cat", doc, "--json");
  const { alt } = await h.cli(
    "alt",
    "propose",
    doc,
    "--base",
    base,
    "--quote",
    target,
    "--version",
    version,
  );
  await h.cli("alt", "flip", doc, alt, "--to", "1");
  const after = (await h.cli("cat", doc, "--json")).base;
  const { thread } = await h.cli(
    "thread",
    "open",
    doc,
    "--base",
    after,
    "--quote",
    quote,
    "--text",
    note,
  );
  return { alt, thread };
}
function sliceThreads(s: Awaited<ReturnType<typeof state>>) {
  return (
    s.threads as { from: number | null; to: number | null; messages: { text: string }[] }[]
  ).map((t) => ({
    note: t.messages[0].text,
    quote: t.from === null ? null : s.text.slice(t.from, t.to!),
  }));
}

const browser = await chromium.launch({ channel: "chromium" });
cleanup.push(() => browser.close());
try {
  const A = await home("a");
  const B = await home("b");

  // 1. A signs in with the bootstrap token (through the proxy); B with A's pairing code.
  assert.equal(
    (await A.cli("login", proxyUrl, "--bootstrap", BOOTSTRAP, "--name", "A")).signedIn,
    true,
  );
  const { code } = await A.cli("devices", "pair");
  assert.equal((await B.cli("login", serverUrl, "--code", code, "--name", "B")).signedIn, true);
  proof.login = { a: await A.cli("status"), b: await B.cli("status") };

  // 5 (armed first). The first push of a new post loses its acknowledgement.
  dropFor = "lost";
  await A.cli("new", "post", "lost");
  await A.cli("sync");
  await expect.poll(() => pushes.filter((p) => p.doc === "lost").length).toBeGreaterThanOrEqual(2);
  const lost = pushes.filter((p) => p.doc === "lost");
  assert.deepEqual(
    lost.map((p) => [p.dropped, JSON.parse(p.body).duplicate]),
    [
      [true, false],
      [false, true],
    ],
  );
  assert.equal(rows("lost"), 1);
  proof.lostAck = {
    pushes: lost.map((p) => ({ dropped: p.dropped, ...JSON.parse(p.body) })),
    rows: 1,
  };

  // A creates the post and both editors open it.
  await A.cli("new", "post", "shared");
  await settle(A, B);
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  for (const [page, h] of [
    [pageA, A],
    [pageB, B],
  ] as const) {
    page.on("pageerror", (e) => console.error("PAGE", e));
    await page.goto(`${h.origin}/?doc=shared`);
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 30_000 });
  }
  await pageA
    .locator(".cm-content")
    .fill(
      "---\ntitle: Shared\n---\n\nFirst paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.\n\nLast line.",
    );
  await expect(pageA.getByRole("status")).toHaveText("Saved", { timeout: 30_000 });
  await settle(A, B);
  assert.match((await state(B, "shared")).text, /Third paragraph here\./);

  // 2. Playwright types into A's editor while B proposes, flips and opens a thread.
  const [, fromB] = await Promise.all([
    typeAtEnd(pageA, " Typed on A."),
    operate(
      B,
      "shared",
      "Second paragraph here.",
      "Flipped by B.",
      "First paragraph",
      "Note from B",
    ),
  ]);
  await settle(A, B);

  // 3. The reverse: typing on B while A proposes, flips and opens a thread.
  const [, fromA] = await Promise.all([
    typeAtEnd(pageB, " Typed on B."),
    operate(A, "shared", "Third paragraph here.", "Flipped by A.", "Typed on A", "Note from A"),
  ]);
  await settle(A, B);

  // 4. Identical on both homes; typed text, flipped versions and thread quotes present.
  const a = await state(A, "shared");
  const b = await state(B, "shared");
  assert.deepEqual(b, a);
  for (const text of ["Typed on A.", "Typed on B.", "Flipped by B.", "Flipped by A."])
    assert.ok(a.text.includes(text), `missing ${text}`);
  assert.ok(
    !a.text.includes("Second paragraph here.") && !a.text.includes("Third paragraph here."),
  );
  assert.deepEqual(sliceThreads(a), [
    { note: "Note from B", quote: "First paragraph" },
    { note: "Note from A", quote: "Typed on A" },
  ]);
  proof.convergence = {
    text: a.text,
    alternatives: a.alts,
    threads: sliceThreads(a),
    operations: { fromA, fromB },
    // Discrepancy 1 (plan log): a synced flip dissolves the alternative into the stash on the
    // receiving device; both homes agree, without it.
    alternativeSurvivesFlip: (a.alts as unknown[]).length > 0,
  };

  // 6. A's status bar names its device.
  // Plan 18: the status bar says "Synced …"; the device and server are its tooltip.
  await expect(pageA.getByTestId("session")).toHaveAttribute("title", /^Signed in as A on /);
  await expect(pageA.getByTestId("session")).toContainText("Synced");
  proof.statusBarA = await pageA.getByTestId("session").textContent();

  // 7. A revokes B: B drops to signed out everywhere.
  const bSession = JSON.parse(await readFile(join(B.path, "session.json"), "utf8"));
  await A.cli("devices", "revoke", bSession.deviceId);
  await expect(pageB.getByTestId("session")).toHaveText("Not signed in · Sign in", {
    timeout: 45_000,
  });
  assert.deepEqual(await B.cli("status"), { signedIn: false, server: serverUrl });
  await assert.rejects(stat(join(B.path, "session.secret")));
  const refused = await B.fails("sync");
  assert.equal(refused.code, 1);
  assert.match(
    refused.stderr,
    new RegExp(`fix: composed login ${serverUrl.replaceAll(".", "\\.")}`),
  );
  proof.revocation = {
    statusBarB: await pageB.getByTestId("session").textContent(),
    status: await B.cli("status"),
    secret: "absent",
    sync: refused.stderr.trim(),
  };
  await pageA.screenshot({ path: join(root, "test-results/plan-16-sync-a.png") });
  await pageB.screenshot({ path: join(root, "test-results/plan-16-sync-b.png") });
  await writeFile(
    join(root, "test-results/plan-16-sync-proof.json"),
    JSON.stringify(proof, null, 2),
  );
  console.log(
    "Sync: two homes converge typing/flip/thread both ways, lost ack stored once, revoked device signed out PASS",
  );
} finally {
  for (const run of cleanup.reverse()) await run();
}
