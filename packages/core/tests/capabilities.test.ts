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
  expect(mcpRegistry.map((t) => t.name)).not.toEqual(
    expect.arrayContaining(["alt_rewrite", "ghost_set", "stash_restore", "component_publish"]),
  );
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
