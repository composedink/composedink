import { expect, it } from "vite-plus/test";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { rewriteProvider } from "../src/rewrite.ts";
import { replaceText } from "../src/model/text.ts";

async function fixture() {
  let reply = JSON.stringify([" Version A ", "Version B", "Version C"]);
  let status = 200;
  let gate: Promise<void> = Promise.resolve();
  let started = () => {};
  let calls = 0;
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    calls++;
    expect(req.url).toBe("/v1/chat/completions");
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    started();
    await gate;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  const home = await mkdtemp(join(tmpdir(), "rewrite-"));
  const config = {
    endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
    model: "double",
    timeoutMs: 1000,
  };
  await writeFile(join(home, "config.json"), JSON.stringify({ rewrite: config }));
  const a = await authority(await openStore(home));
  const run = bind(a);
  await run("doc.create", { slug: "post" });
  await a.change("post", (d) => replaceText(d, "Original sentence.\n\nOther paragraph."));
  const input = {
    doc: "post",
    at: { base: a.read("post").base, quote: "Original sentence." },
    request: "rewrite-1",
  };
  return {
    a,
    run,
    input,
    config,
    home,
    requests,
    calls: () => calls,
    reply: (text: string, code = 200) => {
      reply = text;
      status = code;
    },
    slow: () => {
      let release = () => {};
      gate = new Promise<void>((r) => {
        release = r;
      });
      return {
        release,
        started: new Promise<void>((r) => {
          started = r;
        }),
      };
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(home, { recursive: true, force: true });
    },
  };
}
it("requests distinct author-voice versions without trimming source or output", async () => {
  const f = await fixture();
  try {
    expect(await rewriteProvider(f.config, { text: "  Author text\n", count: 3 })).toEqual({
      versions: [" Version A ", "Version B", "Version C"],
    });
    expect(JSON.stringify(f.requests)).toContain("author's voice");
    expect(f.requests).toMatchObject([
      { messages: [{}, { content: JSON.stringify({ text: "  Author text\n" }) }] },
    ]);
  } finally {
    await f.close();
  }
});
it.each(["bad json", "[]", '["one"]', '["a","a","b"]', '["","b","c"]'])(
  "rejects malformed versions %s without mutation and allows retry",
  async (reply) => {
    const f = await fixture();
    try {
      const before = f.a.read("post");
      f.reply(reply);
      await expect(f.run("alt.rewrite", f.input)).rejects.toThrow("ProviderFailed");
      expect(f.a.read("post")).toEqual(before);
      f.reply('["a","b","c"]');
      await expect(f.run("alt.rewrite", f.input)).resolves.toHaveProperty("alt");
    } finally {
      await f.close();
    }
  },
);
it.each([401, 500])("reports actionable HTTP %s failures", async (code) => {
  const f = await fixture();
  try {
    f.reply("private provider error", code);
    await expect(f.run("alt.rewrite", f.input)).rejects.toThrow(/ProviderFailed:.*fix:/);
    expect(f.a.read("post").alts).toEqual([]);
  } finally {
    await f.close();
  }
});
it("bounds count, response bytes and timeout; cancellation discards late output", async () => {
  const f = await fixture();
  try {
    await expect(rewriteProvider(f.config, { text: "text", count: 0 })).rejects.toThrow(
      "ProviderFailed",
    );
    f.reply("x".repeat(1_048_577));
    await expect(f.run("alt.rewrite", f.input)).rejects.toThrow("ProviderFailed");
    const slow = f.slow();
    await expect(
      rewriteProvider({ ...f.config, timeoutMs: 20 }, { text: "text", count: 3 }),
    ).rejects.toThrow("ProviderFailed");
    const controller = new AbortController();
    const pending = f.run("alt.rewrite", f.input, undefined, controller.signal);
    await slow.started;
    controller.abort();
    slow.release();
    await expect(pending).rejects.toThrow("ProviderFailed");
    expect(f.a.read("post").alts).toEqual([]);
  } finally {
    await f.close();
  }
});
it.each([false, true])(
  "releases queue while pending, shares work/replays receipt, detached=%s",
  async (deleted) => {
    const f = await fixture();
    try {
      const slow = f.slow();
      const pending = f.run("alt.rewrite", f.input);
      await slow.started;
      const duplicate = f.run("alt.rewrite", f.input);
      await expect(f.run("alt.rewrite", { ...f.input, count: 2 })).rejects.toThrow(
        "RequestConflict",
      );
      await f.run("doc.apply", {
        doc: "post",
        base: f.a.read("post").base,
        text: deleted ? "\n\nHuman paragraph." : "Original sentence.\n\nHuman paragraph.",
        mode: "direct",
        by: { kind: "human" },
      });
      slow.release();
      const result = await pending;
      expect(await duplicate).toEqual(result);
      expect(await f.run("alt.rewrite", f.input)).toEqual(result);
      const cancelled = new AbortController();
      cancelled.abort();
      expect(await f.run("alt.rewrite", f.input, undefined, cancelled.signal)).toEqual(result);
      expect(f.calls()).toBe(1);
      expect(f.a.read("post").text).toContain("Human paragraph.");
      if (deleted) {
        expect(f.a.read("post").alts).toEqual([]);
        expect(await f.run("stash.list", { doc: "post" })).toHaveLength(3);
      } else {
        expect(f.a.read("post").text).toBe("Original sentence.\n\nHuman paragraph.");
        expect(f.a.read("post").alts[0]).toMatchObject({ active: 0, count: 4 });
        const restarted = bind(await authority(await openStore(f.home)));
        expect(await restarted("alt.rewrite", f.input)).toEqual(result);
      }
    } finally {
      await f.close();
    }
  },
);
