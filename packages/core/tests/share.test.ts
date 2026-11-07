import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { authority, bind, openStore, syncSlot } from "../src/node.ts";
import { QUESTIONS } from "../src/kinds/builtins.ts";
import { feedbackRequests } from "../src/model/feedback.ts";
import { replaceText } from "../src/model/text.ts";
import { renderSnapshot } from "../src/share.ts";
import { BOOTSTRAP, spawnServer } from "./support/server-process.ts";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run();
});

async function device() {
  const home = await mkdtemp(join(tmpdir(), "core-share-home-"));
  const a = await authority(await openStore(home));
  a.sync = syncSlot(a, home, () => {});
  const run = bind(a);
  cleanup.push(async () => {
    await a.sync?.stop();
    await rm(home, { recursive: true, force: true });
  });
  return { home, a, run };
}
async function signedIn() {
  const server = await spawnServer();
  cleanup.push(() => server.close());
  const d = await device();
  await d.run("session.login", { server: server.url, bootstrap: BOOTSTRAP, deviceName: "A" });
  return { server, ...d };
}
type Share = { link: string; url: string; mode: string; request: string; questions: unknown[] };
const requests = (a: Awaited<ReturnType<typeof device>>["a"], id: string) =>
  feedbackRequests(a.get(id));

it("refuses share.create while signed out with the fix and makes no server call", async () => {
  let calls = 0;
  const counter = createServer((req, res) => {
    calls++;
    res.writeHead(500).end();
  });
  counter.listen(0, "127.0.0.1");
  await once(counter, "listening");
  cleanup.push(() => new Promise((r) => counter.close(r)));
  const address = counter.address();
  if (!address || typeof address === "string") throw Error("address");
  const server = `http://127.0.0.1:${address.port}`;
  const { home, run } = await device();
  await writeFile(join(home, "session.json"), JSON.stringify({ server }));
  await run("doc.create", { slug: "p" });
  await expect(run("share.create", { id: "p" })).rejects.toThrow(
    `SignInRequired: not signed in to a composed server; fix: composed login ${server}`,
  );
  expect(calls).toBe(0);
});

it("takes explicit questions, then the pending request's, else the kind's", async () => {
  const { server, a, run } = await signedIn();
  await run("doc.create", { slug: "p" });
  await a.change("p", (d) => replaceText(d, "Alpha beta gamma.\n"));

  const explicit = (await run("share.create", {
    id: "p",
    mode: "live",
    questions: ["Does it flow?"],
  })) as Share;
  expect(explicit.url).toMatch(new RegExp(`^${server.url}/s/[A-Za-z0-9_-]{43}$`));
  expect(explicit.questions).toEqual([{ id: `${explicit.request}.q1`, text: "Does it flow?" }]);
  expect(requests(a, "p")).toEqual([
    expect.objectContaining({ id: explicit.request, to: [`link:${explicit.link}`] }),
  ]);

  // Without questions, the most recent pending request gains the new link and lends its questions.
  const pending = (await run("share.create", { id: "p" })) as Share;
  expect(pending.request).toBe(explicit.request);
  expect(pending.questions).toEqual(explicit.questions);
  expect(requests(a, "p")).toEqual([
    expect.objectContaining({ to: [`link:${explicit.link}`, `link:${pending.link}`] }),
  ]);

  // No pending request: a new request with the kind's questions.
  await run("doc.create", { slug: "q" });
  const kind = (await run("share.create", { id: "q", mode: "live" })) as Share;
  expect((kind.questions as { text: string }[]).map((q) => q.text)).toEqual(QUESTIONS);

  // The server stored the links with these questions and no tokens.
  const listed = (await run("share.list", { id: "p" })) as {
    links: { linkId: string; url?: string; questions: unknown[] }[];
  };
  expect(listed.links.map((l) => l.linkId)).toEqual(
    expect.arrayContaining([explicit.link, pending.link]),
  );
  expect(listed.links.find((l) => l.linkId === explicit.link)).toMatchObject({
    url: explicit.url,
    questions: explicit.questions,
  });
}, 60_000);

it("records a pinned link's frontiers at the synced head", async () => {
  const { server, a, run } = await signedIn();
  await run("doc.create", { slug: "p" });
  await a.change("p", (d) => replaceText(d, "Pinned text.\n"));
  const pinned = (await run("share.create", { id: "p", questions: ["Q?"] })) as Share;
  expect(pinned.mode).toBe("pinned");
  const stored = server.db(
    (db) =>
      db.prepare("SELECT mode, frontiers FROM links WHERE link_id = ?").get(pinned.link) as {
        mode: string;
        frontiers: string;
      },
  );
  expect(stored).toEqual({ mode: "pinned", frontiers: a.read("p").base });
  // The page renders the pinned text from the server's replica.
  const page = await (await fetch(pinned.url)).text();
  expect(page).toContain("Pinned text.");
}, 60_000);

it("keys the render snapshot by renderKey for every composed usage", async () => {
  const { server, a, run } = await signedIn();
  const id = "composed:lachieh/hello";
  await run("doc.create", { slug: "p" });
  await run("component.create", { id, kind: "inline" });
  await run("deps.add", { doc: "p", tag: "Hello", component: id, version: "dev" });
  await a.change("p", (d) =>
    replaceText(d, 'A <Hello name="Lachlan" /> and <Hello name="Ada" /> and <Mystery />.\n'),
  );
  const key = (canonical: string) => createHash("sha256").update(canonical).digest("hex");
  const { instances } = await a.serialize(() => renderSnapshot(a, "p"));
  expect(Object.keys(instances).sort()).toEqual(
    [
      key('{"props":{"name":"Lachlan"},"tag":"Hello"}'),
      key('{"props":{"name":"Ada"},"tag":"Hello"}'),
    ].sort(),
  );
  expect(instances[key('{"props":{"name":"Lachlan"},"tag":"Hello"}')]).toContain("Lachlan");

  const shared = (await run("share.create", { id: "p", mode: "live", questions: ["Q?"] })) as Share;
  const stored = server.db(
    (db) =>
      db.prepare("SELECT instances FROM render_snapshots WHERE link_id = ?").get(shared.link) as {
        instances: string;
      },
  );
  expect(JSON.parse(stored.instances)).toEqual(instances);
  const page = await (await fetch(shared.url)).text();
  expect(page).toContain("Lachlan");
  expect(page).toContain('data-tag="Mystery"');
  expect(page).not.toContain('data-tag="Hello"');
}, 180_000);
