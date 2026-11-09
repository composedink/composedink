import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind, undoSession } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
it("cuts and restores marked text by stable ID, rejects deleted anchors and undoes operations", async () => {
  const home = await mkdtemp(join(tmpdir(), "dim-"));
  try {
    const a = await authority(await openStore(home)),
      run = bind(a);
    await run("doc.create", { slug: "p" });
    await a.change("p", (d) => replaceText(d, "One 😀 two."));
    const at = (from: number, to: number) => ({ base: a.read("p").base, from, to });
    await run("ghost.set", { doc: "p", at: at(4, 6), dim: true }, "s");
    expect(a.read("p").dim).toEqual([[4, 6]]);
    const cut = await run("stash.add", { doc: "p", at: at(4, 6) }, "s");
    expect(cut).toMatchObject({ item: expect.any(String) });
    const items = await run("stash.list", { doc: "p" });
    if (!Array.isArray(items)) throw Error("items");
    expect(items[0]).toMatchObject({ text: "😀", dim: [[0, 2]] });
    const target = at(0, 0);
    await run("stash.restore", { doc: "p", item: items[0].id, at: target }, "s");
    expect(a.read("p").text).toBe("😀One  two.");
    expect(a.read("p").dim).toEqual([[0, 2]]);
    await undoSession(a, "s");
    expect(await run("stash.list", { doc: "p" })).toHaveLength(1);
    await a.change("p", (d) => {
      container(d).delete(0, 1);
      d.commit();
    });
    await expect(run("stash.restore", { doc: "p", item: items[0].id, at: target })).rejects.toThrow(
      "DetachedTarget",
    );
    const reopened = await authority(await openStore(home));
    expect(await bind(reopened)("stash.list", { doc: "p" })).toMatchObject([
      { id: items[0].id, dim: [[0, 2]] },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("removes a stash entry by id, idempotently, and operation undo restores it", async () => {
  const home = await mkdtemp(join(tmpdir(), "stash-remove-"));
  try {
    const a = await authority(await openStore(home)),
      run = bind(a);
    await run("doc.create", { slug: "p" });
    await a.change("p", (d) => replaceText(d, "Keep this. Cut this."));
    const base = a.read("p").base;
    const { item } = (await run("stash.add", { doc: "p", at: { base, quote: " Cut this." } })) as {
      item: string;
    };
    expect(await run("stash.list", { doc: "p" })).toHaveLength(1);
    expect(await run("stash.remove", { doc: "p", item }, "s")).toEqual({ item, removed: true });
    expect(await run("stash.list", { doc: "p" })).toEqual([]);
    const head = a.read("p").base;
    expect(await run("stash.remove", { doc: "p", item }, "s")).toEqual({ item, removed: false });
    expect(a.read("p").base).toBe(head);
    await undoSession(a, "s");
    expect(await run("stash.list", { doc: "p" })).toMatchObject([{ id: item, text: " Cut this." }]);
    // The undo stack held one step: a second undo has nothing left from this session.
    await expect(undoSession(a, "s")).rejects.toThrow("NothingToUndo");
    expect(a.read("p").text).toBe("Keep this.");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

function container(d: import("loro-crdt").LoroDoc) {
  return d.getText("mdx");
}
