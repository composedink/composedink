import { LoroDoc, VersionVector } from "loro-crdt";
import { threadViews } from "@composedink/core/model";
import { afterEach, expect, it } from "vite-plus/test";
import {
  bootstrapDevice,
  deviceJson,
  pushDoc,
  startServer,
  type TestServer,
} from "./support/server.ts";

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.remove();
});

/** The post body (the root boundary test keeps `mdx` mutations inside core/model). */
const prose = (doc: LoroDoc) => doc.getText("mdx");

async function setup(body = "The quick fox jumps. A lazy dog sleeps. The quick fox again.\n") {
  const s = await startServer();
  servers.push(s);
  const device = await bootstrapDevice(s);
  const doc = new LoroDoc();
  doc.getMap("meta").set("slug", "post");
  prose(doc).insert(0, body);
  // A request whose question a guest can answer.
  doc.getMap("requests").set("r1", {
    at: 1,
    by: { kind: "human" },
    questions: [{ id: "r1.q1", text: "Is it clear?" }],
    to: ["model"],
    state: { status: "pending" },
  });
  doc.commit();
  let sent = new VersionVector(null);
  const sync = async () => {
    const result = await pushDoc(
      s,
      device,
      "post",
      doc.export({ mode: "update", from: sent }),
      Buffer.from(sent.encode()).toString("base64url"),
    );
    expect(result.status).toBe(200);
    sent = doc.oplogVersion();
  };
  await sync();
  const share = async (linkId: string) => {
    const created = await deviceJson(s, device, "/sync/links", {
      linkId,
      docId: "post",
      mode: "live",
      questions: [],
      instances: {},
    });
    expect(created.status).toBe(201);
    return created.body.token as string;
  };
  const post = async (
    token: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await s.fetch(`/s/${token}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: s.url, ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let json: Record<string, any> | undefined;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, headers: response.headers, json, text };
  };
  return { s, device, doc, sync, share, post };
}

it("requires a name on the first comment, then sets a link-scoped cookie and reuses it", async () => {
  const { s, share, post } = await setup();
  const token = await share("link-a");
  const nameless = await post(token, "/threads", { quote: "lazy dog", text: "Cute." });
  expect(nameless.status).toBe(400);

  const first = await post(token, "/threads", {
    quote: "lazy dog",
    text: "Cute.",
    name: "Ada",
    question: "r1.q1",
  });
  expect(first.status).toBe(201);
  expect(first.json).toMatchObject({
    state: "open",
    messages: [{ by: { kind: "guest", name: "Ada", linkId: "link-a" }, text: "Cute." }],
  });
  const cookie = first.headers.get("set-cookie") ?? "";
  expect(cookie).toBe(
    `composed_guest=Ada; Path=/s/${token}; HttpOnly; SameSite=Strict; Max-Age=31536000`,
  );

  const second = await post(
    token,
    "/threads",
    { quote: "sleeps", text: "Again." },
    { cookie: cookie.split(";")[0] },
  );
  expect(second.status).toBe(201);
  expect(second.json?.messages[0].by).toEqual({ kind: "guest", name: "Ada", linkId: "link-a" });
  expect(second.headers.get("set-cookie")).toBeNull();

  // The page renders the cookie's name for the comment script, and lists both threads.
  const page = await (
    await s.fetch(`/s/${token}`, { headers: { cookie: cookie.split(";")[0] } })
  ).text();
  expect(page).toContain('<body data-guest="Ada">');
  expect(page.match(/class="thread"/g)).toHaveLength(2);
  expect(page).toContain("<blockquote>lazy dog</blockquote>");
});

it("stores a guest comment as a relayed update a peer pulls with the guest author and range", async () => {
  const { s, device, share, post } = await setup();
  const token = await share("link-a");
  const events = await s.fetch("/sync/events", { headers: { authorization: `Bearer ${device}` } });
  const reader = events.body!.getReader();
  const decoder = new TextDecoder();
  let stream = "";
  const until = async (pattern: RegExp) => {
    while (!pattern.test(stream)) stream += decoder.decode((await reader.read()).value);
  };
  await until(/event: heads/);

  const created = await post(token, "/threads", { quote: "lazy dog", text: "Cute.", name: "Ada" });
  expect(created.status).toBe(201);
  await until(/event: doc\ndata: \{"docId":"post","seq":2\}/);
  await reader.cancel();

  const row = s.db
    .prepare("SELECT from_device FROM updates WHERE doc_id = 'post' AND seq = 2")
    .get() as { from_device: string | null };
  expect(row.from_device).toBeNull();

  const pulled = await deviceJson(s, device, "/sync/docs/post/updates?since=0");
  const peer = new LoroDoc();
  for (const u of pulled.body.updates) peer.import(Buffer.from(u.bytes, "base64"));
  const [thread] = threadViews(peer);
  expect(thread).toMatchObject({
    thread: created.json?.thread,
    state: "open",
    messages: [{ by: { kind: "guest", name: "Ada", linkId: "link-a" }, text: "Cute." }],
  });
  expect(prose(peer).toString().slice(thread.from!, thread.to!)).toBe("lazy dog");
});

it("opens a detached thread when the quote no longer exists on the replica", async () => {
  const { doc, sync, share, post } = await setup();
  const token = await share("link-a");
  const text = prose(doc).toString();
  prose(doc).delete(text.indexOf("A lazy dog sleeps. "), "A lazy dog sleeps. ".length);
  doc.commit();
  await sync();
  const created = await post(token, "/threads", { quote: "lazy dog", text: "Gone?", name: "Ada" });
  expect(created.status).toBe(201);
  expect(created.json).toMatchObject({ state: "detached", messages: [{ text: "Gone?" }] });
});

it("answers an ambiguous quote with 409", async () => {
  const { share, post } = await setup();
  const token = await share("link-a");
  const response = await post(token, "/threads", { quote: "quick fox", text: "?", name: "Ada" });
  expect(response.status).toBe(409);
  expect(response.json).toEqual({ error: "AmbiguousQuote: select a longer passage" });
});

it("replies only to threads of the same link", async () => {
  const { share, post } = await setup();
  const a = await share("link-a");
  const b = await share("link-b");
  const thread = (await post(a, "/threads", { quote: "lazy dog", text: "One.", name: "Ada" })).json
    ?.thread as string;
  const reply = await post(a, `/threads/${thread}/replies`, { text: "Two.", name: "Ada" });
  expect(reply.status).toBe(201);
  expect(reply.json?.messages.map((m: { text: string }) => m.text)).toEqual(["One.", "Two."]);
  const foreign = await post(b, `/threads/${thread}/replies`, { text: "Hijack.", name: "Eve" });
  expect(foreign.status).toBe(404);
});

it("refuses a wrong Origin or a non-JSON body with 403 and a revoked link with 404", async () => {
  const { s, device, share, post } = await setup();
  const token = await share("link-a");
  const body = { quote: "lazy dog", text: "x", name: "Ada" };
  expect((await post(token, "/threads", body, { origin: "https://evil.example" })).status).toBe(
    403,
  );
  expect((await post(token, "/threads", body, { "content-type": "text/plain" })).status).toBe(403);
  await deviceJson(s, device, "/sync/links/link-a/revoke", {});
  expect((await post(token, "/threads", body)).status).toBe(404);
});
