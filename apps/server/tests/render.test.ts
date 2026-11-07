import { createHash } from "node:crypto";
import { LoroDoc, VersionVector, encodeFrontiers } from "loro-crdt";
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
const frontiersOf = (doc: LoroDoc) =>
  Buffer.from(encodeFrontiers(doc.frontiers())).toString("base64url");
/** An independent oracle for the render key: SHA-256 of the canonical `{props, tag}` JSON. */
const keyOf = (canonicalJson: string) => createHash("sha256").update(canonicalJson).digest("hex");

async function setup(body: string, configure?: (doc: LoroDoc) => void) {
  const s = await startServer();
  servers.push(s);
  const token = await bootstrapDevice(s);
  const doc = new LoroDoc();
  doc.getMap("meta").set("slug", "my-post");
  doc.getMap("meta").set("id", "my-post");
  prose(doc).insert(0, body);
  configure?.(doc);
  doc.commit();
  expect((await pushDoc(s, token, "my-post", doc.export({ mode: "update" }))).status).toBe(200);
  let sent = new VersionVector(null);
  const sync = async () => {
    const result = await pushDoc(
      s,
      token,
      "my-post",
      doc.export({ mode: "update", from: sent }),
      Buffer.from(sent.encode()).toString("base64url"),
    );
    expect(result.status).toBe(200);
    sent = doc.oplogVersion();
  };
  sent = doc.oplogVersion();
  const share = async (
    linkId: string,
    mode: "pinned" | "live",
    extra: { instances?: Record<string, string>; expiresAt?: number } = {},
  ) => {
    const created = await deviceJson(s, token, "/sync/links", {
      linkId,
      docId: "my-post",
      mode,
      ...(mode === "pinned" ? { frontiers: frontiersOf(doc) } : {}),
      questions: [{ id: "q1", text: "Is the <b>ending</b> clear?" }],
      instances: extra.instances ?? {},
      ...(extra.expiresAt ? { expiresAt: extra.expiresAt } : {}),
    });
    expect(created.status).toBe(201);
    return created.body.token as string;
  };
  const page = async (token: string) => {
    const response = await s.fetch(`/s/${token}`);
    return { status: response.status, headers: response.headers, html: await response.text() };
  };
  return { s, token, doc, sync, share, page };
}

it("omits dim text and renders the questions, title and prose", async () => {
  const { share, page } = await setup(
    "---\ntitle: A shared draft\n---\n\nKeep this. Hide this. End.\n",
    (doc) => {
      doc.configTextStyle({ dim: { expand: "none" } });
      const text = prose(doc).toString();
      const start = text.indexOf("Hide this. ");
      prose(doc).mark({ start, end: start + "Hide this. ".length }, "dim", true);
    },
  );
  const { status, html } = await page(await share("l1", "live"));
  expect(status).toBe(200);
  expect(html).toContain("<title>A shared draft</title>");
  expect(html).toContain("Keep this. End.");
  expect(html).not.toContain("Hide this");
  expect(html).not.toContain("title: A shared draft");
  // Questions are text, never markup.
  expect(html).toContain("ending");
  expect(html).not.toContain("<b>ending");
});

it("renders a snapshot instance as Markdown and an unknown tag as a placeholder", async () => {
  const { share, page } = await setup(
    'Intro.\n\n<Callout tone="warn" />\n\n<Mystery size={3} />\n\nOutro {1 + 1}.\n',
  );
  const instances = {
    [keyOf('{"props":{"tone":"warn"},"tag":"Callout"}')]: "**Careful** with <b>this</b>.",
  };
  const { html } = await page(await share("l1", "live", { instances }));
  expect(html).toContain("<strong>Careful</strong>");
  // Raw HTML in a fallback is text.
  expect(html).toContain("&#x3C;b>this&#x3C;/b>");
  expect(html).toMatch(/<figure class="block" data-tag="Mystery">/);
  expect(html).toMatch(/size\W{0,12}3/);
  expect(html).not.toContain("1 + 1");
  expect(html).not.toContain('data-tag="Callout"');
});

it("escapes raw HTML in the source", async () => {
  const { share, page } = await setup(
    'Before.\n\n<script>alert("owned")</script>\n\nA <img src="x" onerror="alert(1)" /> inline.\n',
  );
  const { html } = await page(await share("l1", "live"));
  expect(html.match(/<script/g)).toHaveLength(1);
  expect(html).not.toContain('alert("owned")</script>');
  expect(html).not.toMatch(/<img/);
  expect(html).toContain('data-tag="script"');
  expect(html).toContain('data-tag="img"');
});

it("shows a pinned link's frontiers after a newer push while a live link shows the new text", async () => {
  const { doc, sync, share, page } = await setup("The old sentence.\n");
  const pinned = await share("pinned", "pinned");
  const live = await share("live", "live");
  prose(doc).delete(0, prose(doc).length);
  prose(doc).insert(0, "The new sentence.\n");
  doc.commit();
  await sync();
  const old = await page(pinned);
  expect(old.html).toContain("The old sentence.");
  expect(old.html).not.toContain("The new sentence.");
  const fresh = await page(live);
  expect(fresh.html).toContain("The new sentence.");
  expect(fresh.html).not.toContain("The old sentence.");
});

it("serves one script whose hash is in the CSP, no remotes, and private headers", async () => {
  const { share, page } = await setup("Hello.\n");
  const { headers, html } = await page(await share("l1", "live"));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(html.match(/<script/g)).toHaveLength(1);
  const hash = createHash("sha256").update(scripts[0][1]).digest("base64");
  const csp = headers.get("content-security-policy") ?? "";
  expect(csp).toBe(
    `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
  );
  expect(html).not.toContain("remoteEntry");
  expect(html).not.toMatch(/https?:\/\//);
  expect(headers.get("cache-control")).toBe("no-store");
  expect(headers.get("referrer-policy")).toBe("no-referrer");
  expect(headers.get("x-robots-tag")).toBe("noindex");
  expect(headers.get("x-content-type-options")).toBe("nosniff");
  expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
});

it("answers the 61st request to a link in a minute with 429 and Retry-After", async () => {
  const { s, share } = await setup("Hello.\n");
  const token = await share("l1", "live");
  for (let i = 0; i < 60; i++) expect((await s.fetch(`/s/${token}`)).status).toBe(200);
  const limited = await s.fetch(`/s/${token}`);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  // Unknown tokens are counted too, before lookup.
  const probe = "x".repeat(43);
  for (let i = 0; i < 60; i++) expect((await s.fetch(`/s/${probe}`)).status).toBe(404);
  expect((await s.fetch(`/s/${probe}`)).status).toBe(429);
});

it("answers revoked, expired and unknown tokens with one identical 404", async () => {
  const { s, token, share, page } = await setup("Hello.\n");
  const revoked = await share("revoked", "live");
  await deviceJson(s, token, "/sync/links/revoked/revoke", {});
  const expired = await share("expired", "live", { expiresAt: Date.now() + 60_000 });
  s.db.prepare("UPDATE links SET expires_at = ? WHERE link_id = 'expired'").run(Date.now() - 1);
  const answers = await Promise.all([revoked, expired, "y".repeat(43)].map(page));
  for (const answer of answers) expect(answer.status).toBe(404);
  expect(new Set(answers.map((a) => a.html)).size).toBe(1);
  expect(answers[0].html).not.toMatch(/revoked|expired|unknown/i);
});
