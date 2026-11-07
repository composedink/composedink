import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind, undoSession, mcpRegistry, humanDirect } from "../src/node.ts";
it("capability projection admits only implemented ops and rejects mode independently of attribution", () => {
  expect(() => humanDirect(false, false)).toThrow("UnauthorizedDirect");
  expect(() => humanDirect(false, true)).not.toThrow();
  expect(() => humanDirect(true, false)).not.toThrow();
  const tool = mcpRegistry.find((t) => t.name === "doc_apply")!;
  expect(() =>
    tool.parse({ doc: "p", base: "base", text: "text", mode: "direct", by: { kind: "human" } }),
  ).toThrow();
  expect(tool.parse({ doc: "p", base: "base", text: "text", by: { kind: "human" } })).toMatchObject(
    { mode: "propose" },
  );
  expect(mcpRegistry.map((t) => t.name)).toEqual(
    expect.arrayContaining(["alt_rewrite", "ghost_set", "stash_restore", "component_publish"]),
  );
  expect(mcpRegistry.map((t) => t.name)).not.toContain("doc_import");
});
it("new mutations have durable receipts and session inverses including detached stash", async () => {
  const home = await mkdtemp(join(tmpdir(), "apply-inverse-"));
  let a = await authority(await openStore(home)),
    run = bind(a);
  const by = { kind: "human" };
  try {
    await run("doc.create", { slug: "p" });
    const empty = a.read("p").base;
    const direct = {
      doc: "p",
      base: empty,
      text: "First.\n\nSecond.",
      mode: "direct",
      by,
      request: "direct",
    };
    const directResult = await run("doc.apply", direct, "s");
    a = await authority(await openStore(home));
    run = bind(a);
    expect(await run("doc.apply", direct)).toEqual(directResult);
    const base = a.read("p").base;
    const proposal = {
      doc: "p",
      base,
      text: "Agent.\n\nSecond.",
      mode: "propose",
      by,
      request: "proposal",
    };
    const result = await run("doc.apply", proposal, "s");
    expect(a.read("p").alts).toHaveLength(1);
    await undoSession(a, "s");
    expect(a.read("p").alts).toEqual([]);
    expect(a.read("p").text).toBe(direct.text);
    expect(await run("doc.apply", proposal)).toEqual(result);
    const selection = {
      doc: "p",
      at: { base, quote: "First." },
      versions: ["Alt."],
      by,
      request: "alt",
    };
    const alt = (await run("alt.propose", selection, "s")) as { alt: string };
    expect(await run("alt.propose", selection)).toEqual(alt);
    await undoSession(a, "s");
    expect(a.read("p").alts).toEqual([]);
    const branch = a.get("p").fork(),
      from = branch.version(),
      target = branch.getText("mdx");
    target.delete(0, 6);
    branch.commit();
    await a.typing("p", branch.export({ mode: "update", from }));
    const detached = await run("alt.propose", { ...selection, request: "detached" }, "s");
    expect(await run("stash.list", { doc: "p" })).toHaveLength(1);
    await undoSession(a, "s");
    expect(await run("stash.list", { doc: "p" })).toEqual([]);
    expect(await run("alt.propose", { ...selection, request: "detached" })).toEqual(detached);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("thread and feedback ops reach MCP; attribution is context, never an input or a capability", async () => {
  const names = mcpRegistry.map((t) => t.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "thread_open",
      "thread_reply",
      "thread_resolve",
      "thread_list",
      "feedback_request",
      "feedback_answers",
    ]),
  );
  expect(names.some((n) => n.startsWith("share"))).toBe(false);
  const open = mcpRegistry.find((t) => t.name === "thread_open")!;
  expect(Object.keys(open.inputSchema.properties)).not.toContain("by");
  expect(() =>
    open.parse({ id: "p", base: "b", quote: "q", text: "t", by: { kind: "human" } }),
  ).toThrow();
  const home = await mkdtemp(join(tmpdir(), "attribution-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    await run("doc.create", { slug: "p" });
    const base = a.read("p").base;
    await run(
      "doc.apply",
      { doc: "p", base, text: "Prose.", mode: "direct", by: { kind: "human" } },
      undefined,
      undefined,
      { kind: "human" },
    );
    const before = a.read("p");
    // Claiming to be human through attribution still yields only a proposal over MCP.
    const apply = mcpRegistry.find((t) => t.name === "doc_apply")!;
    const input = apply.parse({
      doc: "p",
      base: before.base,
      text: "Agent.",
      by: { kind: "human" },
    });
    await run("doc.apply", input, undefined, undefined, { kind: "human" });
    expect(a.read("p").text).toBe("Prose.");
    expect(a.read("p").alts).toHaveLength(1);
    await run(
      "thread.open",
      open.parse({ id: "p", base: before.base, quote: "Prose", text: "Comment only." }),
      undefined,
      undefined,
      { kind: "human" },
    );
    expect(a.read("p").text).toBe("Prose.");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
