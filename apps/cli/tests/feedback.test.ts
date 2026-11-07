import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vite-plus/test";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
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

it("CLI and MCP ask the model offline-configured double; answers land as threads and alternatives", async () => {
  const bodies: { messages: { content: string }[] }[] = [];
  const provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));
    const brief = JSON.parse(bodies.at(-1)!.messages[1].content);
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answers: brief.questions.map((q: { id: string }, i: number) => ({
                  question: q.id,
                  text: `Answer ${i + 1}`,
                  notes: i === 0 ? [{ quote: "beta", text: "Name it." }] : [],
                  rewrites: i === 0 ? [{ quote: "Second paragraph.", versions: ["Two."] }] : [],
                })),
              }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const address = provider.address();
  if (!address || typeof address === "string") throw Error("No port");
  const w = await workspace();
  try {
    await writeFile(
      join(w.home, "config.json"),
      JSON.stringify({
        rewrite: {
          endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
          model: "double",
        },
      }),
    );
    const file = join(w.home, "draft.mdx");
    await writeFile(file, "Alpha beta gamma.\n\nSecond paragraph.");
    await w.cli("new", "post", "post", "--from", file, "--i-am-human");
    const ask = [
      "feedback",
      "request",
      "post",
      "--to",
      "model",
      "--question",
      "Is it clear?",
      "--question",
      "What to cut?",
      "--request",
      "ask-1",
    ];
    const result = await w.cli(...ask);
    expect(await w.cli(...ask)).toEqual(result);
    expect(bodies).toHaveLength(1);
    expect(result.state.status).toBe("answered");
    const [first] = result.state.answers;
    expect(first).toMatchObject({ question: `${result.request}.q1`, text: "Answer 1" });
    expect(await w.mcp("feedback_answers", { id: "post", request: result.request })).toEqual({
      request: result.request,
      questions: [
        { id: `${result.request}.q1`, text: "Is it clear?" },
        { id: `${result.request}.q2`, text: "What to cut?" },
      ],
      state: result.state,
    });
    const [thread] = await w.cli("thread", "list", "post");
    expect(thread).toMatchObject({
      thread: first.threads[0],
      question: `${result.request}.q1`,
      messages: [{ by: { kind: "agent", name: "model" }, text: "Name it." }],
    });
    const after = await w.cli("cat", "post", "--json");
    expect(after.text).toBe("Alpha beta gamma.\n\nSecond paragraph.");
    expect(after.alts).toEqual([expect.objectContaining({ id: first.alternatives[0], count: 2 })]);
    const mcp = await w.mcp("feedback_request", { id: "post", to: ["model"] });
    expect(mcp.state.answers).toHaveLength(4);
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[1].messages[1].content).questions).toHaveLength(4);
  } finally {
    provider.closeAllConnections();
    await new Promise<void>((r) => provider.close(() => r()));
    await w.close();
  }
}, 60000);
