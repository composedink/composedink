import { authority, openStore } from "@composedink/core/node";
import { expect, it } from "vite-plus/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "../../.."),
  binary = join(root, "apps/cli/bin/composed");
it("real binary + MCP SDK enforce propose capability and complete workflow 3", async () => {
  const home = await mkdtemp(join(tmpdir(), "mcp-")),
    env = { ...process.env, COMPOSED_HOME: home };
  const cli = (args: string[], input?: string) =>
    execFileSync("mise", ["exec", "--", binary, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
  const original =
    "First paragraph.\n\nHuman paragraph.\n\nThird paragraph.\n\nFourth sentence. Another sentence.\n\nLast paragraph.";
  const transport = new StdioClientTransport({
    command: "mise",
    args: ["exec", "--", binary, "mcp"],
    cwd: root,
    env: Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    stderr: "pipe",
  });
  const client = new Client({ name: "plan-04", version: "1" });
  try {
    const file = join(home, "draft.mdx");
    await writeFile(file, original);
    expect(() => cli(["new", "post", "forbidden", "--from", file])).toThrow();
    cli(["new", "post", "post", "--from", file, "--i-am-human"]);
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name)).toContain("doc_apply");
    expect(tools.map((t) => t.name)).toContain("lint");
    expect(tools.map((t) => t.name)).toContain("alt_rewrite");
    for (const name of ["doc_kind", "kind_list", "kind_read", "kind_write", "rules_effective"])
      expect(tools.map((t) => t.name)).toContain(name);
    expect(tools.find((t) => t.name === "doc_create")?.inputSchema.properties).toHaveProperty(
      "kind",
    );
    const lintFile = join(home, "lint.mdx");
    await writeFile(lintFile, "😀 This is an test.");
    cli(["new", "post", "lint-post", "--from", lintFile, "--i-am-human"]);
    expect(JSON.parse(cli(["lint", "lint-post"]))).toContainEqual(
      expect.objectContaining({ from: 11, to: 13, replacement: "a" }),
    );
    const lintBase = JSON.parse(cli(["cat", "lint-post", "--json"])).base;
    const lintReply = await client.callTool({ name: "lint", arguments: { doc: "lint-post" } });
    expect(lintReply.isError).not.toBe(true);
    expect(JSON.parse(cli(["cat", "lint-post", "--json"])).base).toBe(lintBase);
    const tool = tools.find((t) => t.name === "doc_apply")!;
    expect(tool.inputSchema.properties).not.toHaveProperty("mode");
    const read = () => JSON.parse(cli(["cat", "post", "--json"]));
    const base = read().base;
    const baseDoc = (await authority(await openStore(home))).get("post").fork();
    const human = original.replace("Human paragraph.", "Human edited paragraph.");
    expect(() => cli(["apply", "post", "--base", base, "--direct"], human)).toThrow(
      /UnauthorizedDirect/,
    );
    cli(["apply", "post", "--base", base, "--direct", "--i-am-human"], human);
    const input = {
      doc: "post",
      base,
      text: original.replace("Fourth", "Agent"),
      by: { kind: "human" },
      request: "agent-proposal",
    };
    const denied = await client.callTool({
      name: "doc_apply",
      arguments: { ...input, mode: "direct" },
    });
    expect(denied.isError).toBe(true);
    expect(read().text).toBe(human);
    const response = await client.callTool({ name: "doc_apply", arguments: input });
    expect(response.isError).not.toBe(true);
    function payload(r: typeof response) {
      if (!Array.isArray(r.content)) throw Error("content");
      const item = r.content[0];
      if (!item || typeof item !== "object" || !("text" in item) || typeof item.text !== "string")
        throw Error("text");
      return JSON.parse(item.text);
    }
    const proposed = payload(response);
    expect(proposed.alternatives).toHaveLength(1);
    expect(read().text).toBe(human);
    expect(payload(await client.callTool({ name: "doc_apply", arguments: input }))).toEqual(
      proposed,
    );
    expect(
      (await client.callTool({ name: "doc_apply", arguments: { ...input, text: "different" } }))
        .isError,
    ).toBe(true);
    await client.callTool({
      name: "alt_flip",
      arguments: { doc: "post", alt: proposed.alternatives[0], to: 1 },
    });
    expect(read().text).toBe(human.replace("Fourth", "Agent"));
    // Remove all original paragraph-4 identities, then propose against the original base.
    const current = read();
    cli(
      ["apply", "post", "--base", current.base, "--direct", "--i-am-human"],
      human.replace("Fourth sentence. Another sentence.", "Human replacement."),
    );
    const currentDoc = (await authority(await openStore(home))).get("post");
    const quote = "Fourth sentence.";
    const from = original.indexOf(quote),
      to = from + quote.length;
    const liveStart = baseDoc.getText("mdx").getCursor(from, -1)!;
    const liveEnd = baseDoc.getText("mdx").getCursor(to - 1, 1)!;
    const expectedVersions = (["2", "18446744073709551614"] as const).map((peer) => {
      const agent = baseDoc.fork();
      agent.setPeerId(peer);
      const target = agent.getText("mdx");
      target.update(input.text);
      agent.commit();
      const start = agent.getText("mdx").getCursor(from, -1)!;
      const end = agent.getText("mdx").getCursor(from + quote.length - 2, 1)!;
      const merged = currentDoc.fork();
      merged.import(agent.export({ mode: "update", from: baseDoc.version() }));
      const position = (cursor: typeof start) => {
        const p = merged.getCursorPos(cursor)!;
        return p.offset + (p.side === 1 ? 1 : 0);
      };
      const left = position(liveStart),
        right = position(liveEnd);
      const source = merged.getText("mdx").toString();
      let version = "";
      for (let i = position(start); i < position(end); i++) {
        if (merged.getText("mdx").getCursor(i, 0)!.pos()!.peer === peer || (i >= left && i < right))
          version += source[i];
      }
      return version;
    });
    expect(expectedVersions[0]).toBe(expectedVersions[1]);
    const detached = payload(
      await client.callTool({ name: "doc_apply", arguments: { ...input, request: "detached" } }),
    );
    expect(detached.alternatives).toEqual([]);
    expect(detached.detached).toHaveLength(1);
    const stash = payload(
      await client.callTool({ name: "stash_list", arguments: { doc: "post" } }),
    );
    expect(stash).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: detached.detached[0],
          reason: "detached",
          text: expectedVersions[0],
        }),
      ]),
    );
    await writeFile(
      join(root, "test-results/plan-04-workflow3.json"),
      JSON.stringify(
        {
          base,
          human,
          proposed,
          detached,
          stash,
          expectedDetachedVersion: expectedVersions[0],
          mcpModeRejected: true,
          pipedDirectRejected: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
    await rm(home, { recursive: true, force: true });
  }
}, 60000);
