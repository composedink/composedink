import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vite-plus/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const entry = resolve(import.meta.dirname, "../src/main.ts");
async function workspace() {
  const home = await mkdtemp(join(tmpdir(), "feedback-cli-"));
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ["--experimental-strip-types", entry, ...args],
          {
            env: { ...process.env, COMPOSED_HOME: home },
          },
        )
      ).stdout,
    );
  const client = new Client({ name: "feedback-test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", entry, "mcp"],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        ),
        COMPOSED_HOME: home,
      },
      stderr: "pipe",
    }),
  );
  const mcp = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    const [content] = response.content as { text: string }[];
    if (response.isError) throw Error(content.text);
    return JSON.parse(content.text);
  };
  return {
    home,
    cli,
    mcp,
    close: async () => {
      await client.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

it("CLI and MCP share offline threads on one home with adapter attribution", async () => {
  const w = await workspace();
  try {
    const file = join(w.home, "draft.mdx");
    await writeFile(file, "Alpha beta gamma.\n\nSecond paragraph.");
    await w.cli("new", "post", "post", "--from", file, "--i-am-human");
    const { base } = await w.cli("cat", "post", "--json");
    const { thread } = await w.cli(
      "thread",
      "open",
      "post",
      "--base",
      base,
      "--quote",
      "beta",
      "--text",
      "From the CLI",
      "--request",
      "open-1",
    );
    expect(
      await w.cli(
        "thread",
        "open",
        "post",
        "--base",
        base,
        "--quote",
        "beta",
        "--text",
        "From the CLI",
        "--request",
        "open-1",
      ),
    ).toEqual({ thread });
    expect(await w.mcp("thread_reply", { id: "post", thread, text: "From MCP" })).toEqual({
      thread,
      state: "open",
    });
    expect(await w.cli("thread", "resolve", "post", thread)).toEqual({ thread, state: "resolved" });
    expect(await w.cli("thread", "list", "post", "--state", "open")).toEqual([]);
    const [listed] = await w.mcp("thread_list", { id: "post" });
    expect(listed).toMatchObject({ thread, from: 6, to: 10, state: "resolved" });
    expect(listed.messages.map((m: { by: unknown; text: string }) => [m.by, m.text])).toEqual([
      [{ kind: "agent", name: "cli" }, "From the CLI"],
      [{ kind: "agent", name: "mcp" }, "From MCP"],
    ]);
    await expect(
      w.mcp("thread_open", { id: "post", base, quote: "beta", text: "x", by: { kind: "human" } }),
    ).rejects.toThrow();
    await expect(w.cli("feedback", "request", "post", "--to", "link:abc")).rejects.toThrow(
      "sign in to share",
    );
    expect((await w.cli("cat", "post", "--json")).text).toBe(
      "Alpha beta gamma.\n\nSecond paragraph.",
    );
  } finally {
    await w.close();
  }
}, 60000);
