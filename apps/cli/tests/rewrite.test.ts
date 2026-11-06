import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vite-plus/test";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
it("real CLI rewrite uses the HTTP provider and replays its receipt", async () => {
  let calls = 0;
  const provider = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    calls++;
    res.end(JSON.stringify({ choices: [{ message: { content: '["one","two","three"]' } }] }));
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const address = provider.address();
  if (!address || typeof address === "string") throw Error("No port");
  const home = await mkdtemp(join(tmpdir(), "rewrite-cli-"));
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          ["--experimental-strip-types", resolve(import.meta.dirname, "../src/main.ts"), ...args],
          { env: { ...process.env, COMPOSED_HOME: home } },
        )
      ).stdout,
    );
  try {
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        rewrite: {
          endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
          model: "double",
        },
      }),
    );
    const file = join(home, "draft.mdx");
    await writeFile(file, "Original sentence.");
    await cli("new", "post", "post", "--from", file, "--i-am-human");
    const before = await cli("cat", "post", "--json");
    const args = [
      "alt",
      "rewrite",
      "post",
      "--base",
      before.base,
      "--quote",
      "Original sentence.",
      "--count",
      "3",
      "--request",
      "cli-rewrite",
    ];
    const result = await cli(...args);
    expect(await cli(...args)).toEqual(result);
    expect(calls).toBe(1);
    const after = await cli("cat", "post", "--json");
    expect(after.text).toBe(before.text);
    expect(after.alts[0]).toMatchObject({ active: 0, count: 4 });
    const client = new Client({ name: "rewrite-test", version: "1" });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            "--experimental-strip-types",
            resolve(import.meta.dirname, "../src/main.ts"),
            "mcp",
          ],
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
      const response = await client.callTool({
        name: "alt_rewrite",
        arguments: {
          doc: "post",
          at: { base: before.base, quote: "Original sentence." },
          count: 3,
          request: "cli-rewrite",
        },
      });
      expect(response.isError).not.toBe(true);
      expect(calls).toBe(1);
    } finally {
      await client.close();
    }
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((r) => provider.close(() => r()));
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
