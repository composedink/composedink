import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authority, openStore, bind, registry } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
it("registered lint returns positioned diagnostics without advancing the document base", async () => {
  const home = await mkdtemp(join(tmpdir(), "lint-"));
  const a = await authority(await openStore(home));
  const run = bind(a);
  try {
    await run("doc.create", { slug: "post" });
    await a.change("post", (d) => replaceText(d, "😀 This is an test."));
    const before = a.read("post");
    expect(await run("lint", { doc: "post" })).toContainEqual(
      expect.objectContaining({ from: 11, to: 13, replacement: "a" }),
    );
    expect(a.read("post")).toEqual(before);
    await run("component.create", { id: "composed:test/chart", kind: "block" });
    await run("deps.add", {
      doc: "post",
      tag: "Chart",
      component: "composed:test/chart",
      version: "dev",
    });
    await a.change("post", (d) => replaceText(d, "<Chart name={42} />"));
    expect(await run("lint", { doc: "post" })).toContainEqual(
      expect.objectContaining({ from: 0, to: 19, code: "block:props" }),
    );
    expect(registry.find((op) => op.name === "lint")?.mutation).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
