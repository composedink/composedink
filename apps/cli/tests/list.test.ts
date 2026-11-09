import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const entry = resolve(import.meta.dirname, "../src/main.ts");
it("composed list, composed stash remove, and a model request with no model set up", async () => {
  const home = await mkdtemp(join(tmpdir(), "list-cli-"));
  const env = { ...process.env, COMPOSED_HOME: home };
  const raw = (args: string[]) =>
    spawnSync(process.execPath, ["--experimental-strip-types", entry, ...args], {
      env,
      encoding: "utf8",
    });
  const ok = (args: string[]) => {
    const r = raw(args);
    if (r.status !== 0) throw Error(r.stderr);
    return r.stdout;
  };
  const json = (args: string[]) => JSON.parse(ok(args));
  const client = new Client({ name: "plan-18", version: "1" });
  try {
    expect(ok(["list"])).toBe("No posts yet. Start one with: composed new post <slug>\n");
    expect(json(["list", "--json"])).toEqual({ docs: [] });
    ok(["new", "post", "older"]);
    await new Promise((r) => setTimeout(r, 20));
    ok(["new", "post", "newer", "--kind", "weekly-update"]);
    const listed = json(["list", "--json"]);
    expect(listed.docs.map((d: { id: string }) => d.id)).toEqual(["newer", "older"]);
    const table = ok(["list"]).split("\n");
    expect(table[0]).toMatch(/^SLUG\s+TITLE\s+KIND\s+WORDS\s+UPDATED$/);
    expect(table[1]).toMatch(
      /^newer\s+Weekly update\s+weekly-update\s+0\s+\d{4}-\d\d-\d\d \d\d:\d\d$/,
    );
    expect(table[2]).toMatch(/^older\s+Untitled\s+post\s+0\s/);

    // Cut the template's title into the stash, then remove it.
    const { base, text } = json(["cat", "older", "--json"]) as { base: string; text: string };
    const start = text.indexOf("Untitled");
    const { item } = json([
      "stash",
      "add",
      "older",
      "--base",
      base,
      "--from",
      String(start),
      "--to",
      String(start + "Untitled".length),
    ]);
    expect(json(["stash", "list", "older"])).toHaveLength(1);
    expect(json(["stash", "remove", "older", item])).toEqual({ item, removed: true });
    expect(json(["stash", "remove", "older", item])).toEqual({ item, removed: false });
    expect(json(["stash", "list", "older"])).toEqual([]);

    const before = json(["cat", "older", "--json"]).base;
    const refused = raw(["feedback", "request", "older", "--to", "model"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr.trim().split("\n").at(-1)).toBe(
      "ProviderFailed: no writing model is set up on this device; fix: add rewrite.endpoint and rewrite.model to $COMPOSED_HOME/config.json",
    );
    expect(json(["cat", "older", "--json"]).base).toBe(before);

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--experimental-strip-types", entry, "mcp"],
        env: Object.fromEntries(
          Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"),
        ),
        stderr: "pipe",
      }),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["doc_list", "stash_remove"]));
    const reply = await client.callTool({ name: "doc_list", arguments: {} });
    const [content] = reply.content as { text: string }[];
    // The stash edits made "older" the most recently updated post.
    expect(JSON.parse(content.text).docs.map((d: { id: string }) => d.id)).toEqual([
      "older",
      "newer",
    ]);
  } finally {
    await client.close();
    await rm(home, { recursive: true, force: true });
  }
}, 60000);
