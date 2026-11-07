import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vite-plus/test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const entry = resolve(import.meta.dirname, "../src/main.ts");
it("CLI and MCP create from kinds, write kind files at a base and run effective rules", async () => {
  const home = await mkdtemp(join(tmpdir(), "kinds-cli-"));
  const env = { ...process.env, COMPOSED_HOME: home };
  const raw = (args: string[], input?: string) => {
    const r = spawnSync(process.execPath, ["--experimental-strip-types", entry, ...args], {
      env,
      input,
      encoding: "utf8",
    });
    if (r.status !== 0) throw Error(r.stderr);
    return r;
  };
  const cli = (args: string[], input?: string) => JSON.parse(raw(args, input).stdout);
  const client = new Client({ name: "plan-13", version: "1" });
  try {
    expect(cli(["kind", "list"])).toEqual(
      expect.arrayContaining([
        { kind: "post", origin: "builtin" },
        { kind: "hellotimber", origin: "builtin" },
      ]),
    );
    const post = cli(["kind", "read", "post"]);
    const initial = cli(["kind", "read", "memo"]).base;
    let base = initial;
    const write = (file: string, text: string, at: string, ...extra: string[]) =>
      cli(["kind", "write", "memo", "--file", file, "--base", at, ...extra], text);
    const created = write("kind.json", post.files["kind.json"], initial, "--request", "memo-kind");
    base = created.base;
    const custom = [
      { code: "jargon", message: "Plain words.", severity: "warn", phrases: ["synergy"] },
    ];
    expect(() => write("rules.json", "{}", "stale")).toThrow(/UnknownBase/);
    base = write("template.mdx", "Synergy first.\n", base).base;
    const rules = (r: Record<string, false | object>) =>
      JSON.stringify({ extends: "post", rules: r, custom });
    base = write("rules.json", rules({}), base).base;
    cli(["new", "post", "m", "--kind", "memo"]);
    const text = cli(["cat", "m", "--json"]).text;
    expect(text).toMatch(/^---\nreader: blog readers\n[\s\S]*---\n\nSynergy first\.\n$/);
    expect(cli(["lint", "m"])).toContainEqual(
      expect.objectContaining({ code: "jargon", severity: "warn" }),
    );
    const effective = cli(["rules", "effective", "m"]);
    expect(effective).toMatchObject({ reader: "blog readers", warnings: [] });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", entry, "mcp"],
      env: Object.fromEntries(
        Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"),
      ),
      stderr: "pipe",
    });
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["doc_kind", "kind_list", "kind_read", "kind_write", "rules_effective"])
      expect(names).toContain(name);
    const text0 = async (name: string, args: Record<string, unknown>) => {
      const reply = await client.callTool({ name, arguments: args });
      if (reply.isError || !Array.isArray(reply.content)) throw Error(JSON.stringify(reply));
      const [item] = reply.content;
      return JSON.parse(
        item && typeof item === "object" && "text" in item ? String(item.text) : "",
      );
    };
    expect(await text0("rules_effective", { id: "m" })).toEqual(effective);
    expect(await text0("kind_read", { kind: "memo" })).toEqual(cli(["kind", "read", "memo"]));
    // Receipt replay: same request and payload returns the stored result without rewriting.
    expect(write("kind.json", post.files["kind.json"], initial, "--request", "memo-kind")).toEqual(
      created,
    );
    expect(() => write("kind.json", "{}", initial, "--request", "memo-kind")).toThrow(
      /RequestConflict/,
    );
    write("rules.json", rules({ jargon: false }), cli(["kind", "read", "memo"]).base);
    expect(cli(["lint", "m"]).map((d: { code: string }) => d.code)).not.toContain("jargon");
    cli(["doc", "kind", "m", "weekly-update"]);
    expect(cli(["cat", "m", "--json"]).text).toBe(text);
    expect(() => cli(["doc", "kind", "m", "nowhere"])).toThrow(/UnknownKind/);
    // A kind this device lacks: post rules, a visible warning and the recorded id.
    cli(["doc", "kind", "m", "memo"]);
    await rm(join(home, "kinds", "memo"), { recursive: true });
    const lint = raw(["lint", "m"]);
    expect(lint.stderr).toContain('warning: Kind "memo" is not configured on this device');
    expect(JSON.parse(lint.stdout).map((d: { code: string }) => d.code)).not.toContain("jargon");
    expect(cli(["rules", "effective", "m"]).warnings).toHaveLength(1);
  } finally {
    await client.close();
    await rm(home, { recursive: true, force: true });
  }
}, 60000);
