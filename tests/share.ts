// Plan 17 proof: a pinned link shows old text while a live link shows new; a named guest's comment
// on a link arrives as a thread on a second signed-in home; link pages run one script and load no
// remotes; 60 guest requests a minute; revoked, expired and unknown tokens share one 404; a
// signed-out home cannot share.
import { chromium, expect } from "@playwright/test";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const entry = join(root, "apps/cli/src/main.ts");
const BOOTSTRAP = "share-e2e-bootstrap";
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
const storage = await mkdtemp(join(tmpdir(), "share-e2e-server-"));
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
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  await rm(storage, { recursive: true, force: true });
});
await new Promise<void>((resolve, reject) => {
  server.stdout!.on("data", (b: Buffer) => b.toString().includes('"ready"') && resolve());
  server.once("exit", (code) => reject(Error(`server exited ${code}`)));
});
const serverUrl = `http://127.0.0.1:${serverPort}`;
const serverDb = <T>(run: (db: DatabaseSync) => T) => {
  const db = new DatabaseSync(join(storage, "server.db"));
  try {
    return run(db);
  } finally {
    db.close();
  }
};

async function home(label: string) {
  const path = await mkdtemp(join(tmpdir(), `share-e2e-${label}-`));
  const env = {
    ...process.env,
    COMPOSED_HOME: path,
    COMPOSED_PORT: String(await freePort()),
    COMPOSED_ARTIFACT_PORT: String(await freePort()),
  };
  const args = (rest: string[]) => ["--experimental-strip-types", "--no-warnings", entry, ...rest];
  const run = (...rest: string[]) => promisify(execFile)(process.execPath, args(rest), { env });
  const studio: ChildProcess = spawn(process.execPath, args(["studio", "--headless"]), {
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  studio.stdout!.on("data", (b) => (output += String(b)));
  studio.stderr!.on("data", (b) => (output += String(b)));
  cleanup.push(async () => {
    if (studio.pid && studio.exitCode === null) {
      process.kill(-studio.pid, "SIGTERM");
      await once(studio, "exit");
    }
    await mkdir(join(root, "test-results"), { recursive: true });
    await writeFile(join(root, `test-results/plan-17-share-studio-${label}.log`), output);
    await rm(path, { recursive: true, force: true });
  });
  await expect.poll(() => output, { timeout: 60_000 }).toContain('"ready":true');
  return {
    path,
    origin: `http://127.0.0.1:${env.COMPOSED_PORT}`,
    cli: async (...rest: string[]) => JSON.parse((await run(...rest)).stdout),
    /** Runs a command with `input` on stdin. */
    piped: (input: string, ...rest: string[]) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, args(rest), { env });
        let out = "",
          err = "";
        child.stdout.on("data", (b) => (out += String(b)));
        child.stderr.on("data", (b) => (err += String(b)));
        child.once("exit", (code) => (code === 0 ? resolve(out) : reject(Error(err))));
        child.stdin.end(input);
      }),
    fails: async (...rest: string[]) => {
      try {
        await run(...rest);
      } catch (error) {
        const failure = error as { code: number; stderr: string };
        return { code: failure.code, stderr: failure.stderr };
      }
      throw Error(`expected ${rest.join(" ")} to fail`);
    },
  };
}
const page = async (url: string) => {
  const response = await fetch(url);
  return { status: response.status, headers: response.headers, html: await response.text() };
};

const browser = await chromium.launch({ channel: "chromium" });
cleanup.push(() => browser.close());
try {
  const A = await home("a");
  const B = await home("b");
  const C = await home("c");
  assert.equal(
    (await A.cli("login", serverUrl, "--bootstrap", BOOTSTRAP, "--name", "A")).signedIn,
    true,
  );
  const { code } = await A.cli("devices", "pair");
  assert.equal((await B.cli("login", serverUrl, "--code", code, "--name", "B")).signedIn, true);

  // 1. A writes a post with a dev inline block usage and an unregistered tag.
  const OLD = "The old sentence stays pinned.";
  const NEW = "The new sentence is live.";
  const PHRASE = "comment on this phrase";
  const source = `---\ntitle: Shared draft\n---\n\n${OLD}\n\nA greeting: <Hello name="Ada" />.\n\n<Mystery level={2} />\n\nGuests may ${PHRASE} here.\n`;
  await A.cli("new", "post", "post");
  const created = await A.cli("cat", "post", "--json");
  await A.piped(source, "apply", "post", "--base", created.base, "--direct", "--i-am-human");
  await A.cli("component", "create", "lachieh/hello", "--kind", "inline");
  await A.cli("deps", "add", "post", "Hello", "composed:lachieh/hello@dev");

  // 2. A pinned link P and a live link L that expires in 7 days.
  const P = await A.cli("share", "post");
  const L = await A.cli("share", "post", "--live", "--expires", "7d");
  assert.equal(P.mode, "pinned");
  assert.equal(L.mode, "live");
  assert.ok(L.expiresAt > Date.now() + 6 * 86_400_000);
  for (const link of [P, L]) assert.match(link.url, new RegExp(`^${serverUrl}/s/[\\w-]{43}$`));
  proof.links = { pinned: { link: P.link, questions: P.questions }, live: { link: L.link } };

  // 3. A edits the text directly and syncs: P keeps the old sentence, L shows the new one.
  const edited = await A.cli("cat", "post", "--json");
  await A.piped(
    edited.text.replace(OLD, NEW),
    "apply",
    "post",
    "--base",
    edited.base,
    "--direct",
    "--i-am-human",
  );
  await A.cli("sync");
  const pinned = await page(P.url);
  const live = await page(L.url);
  assert.ok(pinned.html.includes(OLD) && !pinned.html.includes(NEW), "pinned shows old text");
  assert.ok(live.html.includes(NEW) && !live.html.includes(OLD), "live shows new text");
  for (const view of [pinned, live]) {
    assert.ok(view.html.includes("Hello, <strong>Ada</strong>."), "block fallback Markdown");
    assert.ok(view.html.includes('data-tag="Mystery"'), "placeholder for the unregistered tag");
    assert.ok(!view.html.includes('data-tag="Hello"'));
    assert.ok(view.html.includes("<title>Shared draft</title>"));
  }
  proof.pinnedVersusLive = {
    pinned: { old: true, new: false },
    live: { old: false, new: true },
    fallback: "Hello, <strong>Ada</strong>.",
    placeholder: "Mystery",
  };

  // 4. A Playwright guest on L enters a name, selects a phrase and comments.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const requests: string[] = [];
  guestPage.on("request", (r) => requests.push(r.url()));
  guestPage.on("pageerror", (e) => console.error("GUEST PAGE", e));
  await guestPage.goto(L.url);
  const form = guestPage.locator("#comment");
  await form.getByRole("textbox", { name: "Your name" }).fill("Ada Guest");
  await form.locator("textarea").fill("This phrase is lovely.");
  await guestPage.evaluate((needle) => {
    const walker = document.createTreeWalker(document.querySelector("article")!, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const i = node.textContent!.indexOf(needle);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + needle.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw Error(`not rendered: ${needle}`);
  }, PHRASE);
  await expect(guestPage.locator("#quote")).toHaveText(PHRASE);
  await form.getByRole("button", { name: "Comment" }).click();
  await expect(guestPage.locator("#status")).toHaveText("Comment sent.");
  const sentAt = Date.now();

  // Within 10 s, B lists the thread with the guest author and a range slicing to the quote.
  let thread: { thread: string; from: number; to: number; messages: { by: unknown }[] } | undefined;
  await expect
    .poll(
      async () => {
        const threads = (await B.cli("thread", "list", "post")) as NonNullable<typeof thread>[];
        thread = threads.find((t) => JSON.stringify(t.messages[0]?.by).includes("guest"));
        return thread !== undefined;
      },
      { timeout: 10_000, intervals: [250] },
    )
    .toBe(true);
  const arrivedMs = Date.now() - sentAt;
  assert.deepEqual(thread!.messages[0].by, { kind: "guest", name: "Ada Guest", linkId: L.link });
  const bText = (await B.cli("cat", "post", "--view", "full", "--json")).text as string;
  assert.equal(bText.slice(thread!.from, thread!.to), PHRASE);
  // B's comment column shows the name and the link tag.
  const pageB = await browser.newPage();
  pageB.on("pageerror", (e) => console.error("PAGE B", e));
  await pageB.goto(`${B.origin}/?doc=post`);
  await expect(pageB.getByRole("status")).toHaveText("Saved", { timeout: 30_000 });
  const tag = `guest · link ${(L.link as string).slice(0, 6)}`;
  await expect(
    pageB.locator(`.thread[data-thread="${thread!.thread}"] .message`).first(),
  ).toHaveText(`Ada Guest ${tag} This phrase is lovely.`, { timeout: 15_000 });
  await pageB.screenshot({ path: join(root, "test-results/plan-17-share-b-column.png") });
  proof.guestThread = {
    by: thread!.messages[0].by,
    quote: bText.slice(thread!.from, thread!.to),
    arrivedOnBWithinMs: arrivedMs,
    columnLabel: await pageB
      .locator(`.thread[data-thread="${thread!.thread}"] .message`)
      .first()
      .textContent(),
  };

  // 5. B replies; reloading L shows the reply.
  await B.cli("thread", "reply", "post", thread!.thread, "--text", "Thanks, Ada.");
  await B.cli("sync");
  await guestPage.reload();
  const section = guestPage.locator(`#threads [data-thread="${thread!.thread}"]`);
  await expect(section.locator("li")).toHaveText([
    "Ada Guest This phrase is lovely.",
    "Author Thanks, Ada.",
  ]);
  await expect(guestPage.locator("body")).toHaveAttribute("data-guest", "Ada Guest");
  await guestPage.screenshot({ path: join(root, "test-results/plan-17-share-guest.png") });
  proof.reply = { shownOnReload: true };

  // 6. No request leaves the server's origin; no remoteEntry; one script whose hash is in the CSP.
  const outside = requests.filter((url) => new URL(url).origin !== serverUrl);
  assert.deepEqual(outside, []);
  const fresh = await page(L.url);
  const scripts = [...fresh.html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(fresh.html.match(/<script/g)!.length, 1);
  assert.ok(!fresh.html.includes("remoteEntry"));
  const hash = createHash("sha256").update(scripts[0][1]).digest("base64");
  const csp = fresh.headers.get("content-security-policy")!;
  assert.ok(csp.includes(`script-src 'sha256-${hash}'`));
  proof.page = {
    requests: requests.length,
    outsideOrigin: outside,
    scripts: scripts.length,
    remoteEntry: false,
    csp,
  };

  // 7. A fresh link answers its 61st request in a minute with 429.
  const F = await A.cli("share", "post", "--live");
  const statuses: number[] = [];
  for (let i = 0; i < 61; i++) statuses.push((await fetch(F.url)).status);
  assert.deepEqual(statuses.slice(0, 60), Array(60).fill(200));
  assert.equal(statuses[60], 429);
  proof.rateLimit = { first60: 200, request61: statuses[60] };

  // 8. Revoked, expired and unknown tokens: one identical 404.
  const revoked = await A.cli("share", "revoke", P.link);
  assert.equal(revoked.link, P.link);
  assert.equal(typeof revoked.revokedAt, "number");
  const E = await A.cli("share", "post", "--live", "--expires", "1h");
  serverDb((db) =>
    db.prepare("UPDATE links SET expires_at = ? WHERE link_id = ?").run(Date.now() - 1, E.link),
  );
  const gone = await Promise.all(
    [P.url, E.url, `${serverUrl}/s/${"z".repeat(43)}`].map((url) => page(url)),
  );
  assert.deepEqual(
    gone.map((g) => g.status),
    [404, 404, 404],
  );
  assert.equal(new Set(gone.map((g) => g.html)).size, 1);
  const listed = await A.cli("share", "list", "post");
  proof.notFound = {
    statuses: gone.map((g) => g.status),
    identicalBodies: true,
    body: gone[0].html,
    list: listed.links.map((l: { linkId: string; mode: string; revokedAt: number | null }) => ({
      linkId: l.linkId,
      mode: l.mode,
      revoked: l.revokedAt !== null,
    })),
  };

  // 9. Home C is signed out: share refuses with the fix; its page disables Share with the fix.
  await C.cli("new", "post", "post");
  const refused = await C.fails("share", "post");
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /fix: composed login/);
  const pageC = await browser.newPage();
  await pageC.goto(`${C.origin}/?doc=post`);
  await expect(pageC.getByRole("status")).toHaveText("Saved", { timeout: 30_000 });
  await expect(pageC.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  // Plan 18: the reason is the button's tooltip; the header's Sign in has the command.
  await expect(pageC.getByRole("button", { name: "Share", exact: true })).toHaveAttribute(
    "title",
    /^Sign in to share/,
  );
  await pageC.getByRole("button", { name: "Sign in" }).click();
  await expect(pageC.getByRole("dialog", { name: "Sign in" })).toBeVisible();
  await pageC.screenshot({ path: join(root, "test-results/plan-17-share-c-signed-out.png") });
  proof.signedOut = {
    exitCode: refused.code,
    stderr: refused.stderr.trim(),
    shareDisabled: true,
    fix: await pageC.getByRole("dialog", { name: "Sign in" }).textContent(),
  };

  await writeFile(
    join(root, "test-results/plan-17-share-proof.json"),
    JSON.stringify(proof, null, 2),
  );
  console.log(
    "Share: pinned old vs live new, guest comment → thread on B, reply shown, one script and no remote, 429, identical 404s, signed-out refusal PASS",
  );
} finally {
  for (const run of cleanup.reverse()) await run();
}
