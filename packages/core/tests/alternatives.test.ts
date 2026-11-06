import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind, undoSession } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
it("flips empty versions, resolves to stash, and undoes without losing later typing", async () => {
  const home = await mkdtemp(join(tmpdir(), "alts-"));
  const a = await authority(await openStore(home));
  const run = bind(a);
  try {
    await run("doc.create", { slug: "post" });
    await a.change("post", (d) => replaceText(d, "First sentence. Another sentence."));
    const base = a.read("post").base;
    const result = (await run("alt.propose", {
      doc: "post",
      at: { base, view: "full", from: 0, to: 15 },
      versions: ["", "Replacement."],
      by: { kind: "agent", name: "test" },
    })) as { alt: string };
    expect(a.read("post").text).toBe("First sentence. Another sentence.");
    expect(a.read("post").alts[0]).toMatchObject({ active: 0, count: 3 });
    await run("alt.flip", { doc: "post", alt: result.alt, to: 1 }, "human");
    expect(a.read("post").text).toBe(" Another sentence.");
    await run("alt.flip", { doc: "post", alt: result.alt, to: 2 }, "human");
    expect(a.read("post").text).toBe("Replacement. Another sentence.");
    await run("alt.resolve", { doc: "post", alt: result.alt, rest: "stash" }, "human");
    expect(a.read("post").alts).toEqual([]);
    expect(await run("stash.list", { doc: "post" })).toMatchObject([
      { text: "First sentence." },
      { text: "" },
    ]);
    await undoSession(a, "human");
    expect(a.read("post").alts).toHaveLength(1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("absorbs intersections, preserves dim spans and dissolves only boundary crossing typing", async () => {
  const home = await mkdtemp(join(tmpdir(), "alt-repair-"));
  const a = await authority(await openStore(home));
  const run = bind(a);
  try {
    await run("doc.create", { slug: "p" });
    await a.change("p", (d) => {
      d.configTextStyle({ dim: { expand: "none" } });
      replaceText(d, "One two three four.");
      const text = d.getText("mdx");
      text.mark({ start: 4, end: 7 }, "dim", true);
      d.commit();
    });
    const propose = async (from: number, to: number, versions: string[]) =>
      (await run("alt.propose", {
        doc: "p",
        at: { base: a.read("p").base, from, to },
        versions,
        by: { kind: "human" },
      })) as { alt: string };
    const first = await propose(4, 7, ["TWO"]);
    await run("alt.flip", { doc: "p", alt: first.alt, to: 1 });
    await run("alt.flip", { doc: "p", alt: first.alt, to: 0 });
    expect(a.read("p").alts[0].versions[0].dim).toEqual([[0, 3]]);
    await propose(6, 13, ["replacement"]);
    expect(a.read("p").alts).toHaveLength(1);
    expect(await run("stash.list", { doc: "p" })).toMatchObject([{ text: "TWO" }]);
    const replica = a.get("p").fork();
    const base = replica.version();
    const edgeText = replica.getText("mdx");
    edgeText.insert(4, "EDGE");
    replica.commit();
    await a.typing("p", replica.export({ mode: "update", from: base }));
    expect(a.read("p").alts).toHaveLength(1);
    expect(a.read("p").alts[0].from).toBe(8);
    const next = a.get("p").fork(),
      v = next.version();
    const crossText = next.getText("mdx");
    crossText.delete(7, 3);
    next.commit();
    await a.typing("p", next.export({ mode: "update", from: v }));
    expect(a.read("p").alts).toHaveLength(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("repairs malformed slots into deterministic recoverable stash entries", async () => {
  const home = await mkdtemp(join(tmpdir(), "alt-normalize-"));
  const a = await authority(await openStore(home));
  const run = bind(a);
  try {
    await run("doc.create", { slug: "p" });
    await a.change("p", (d) => replaceText(d, "Words."));
    const result = (await run("alt.propose", {
      doc: "p",
      at: { base: a.read("p").base, from: 0, to: 6 },
      versions: ["saved"],
      by: { kind: "human" },
    })) as { alt: string };
    const branch = a.get("p").fork(),
      from = branch.version();
    const map = branch.getMap("alts");
    const raw = map.toJSON()[result.alt];
    if (!raw || typeof raw !== "object" || !("versions" in raw) || !Array.isArray(raw.versions))
      throw Error("fixture");
    map.set(result.alt, { ...raw, versions: raw.versions.slice(1) });
    branch.commit();
    await a.typing("p", branch.export({ mode: "update", from }));
    expect(a.read("p").alts).toEqual([]);
    expect(await run("stash.list", { doc: "p" })).toMatchObject([
      { id: `repair:${result.alt}:0`, text: "saved" },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("undo flip restores valid live anchors before a second flip", async () => {
  const home = await mkdtemp(join(tmpdir(), "alt-inverse-"));
  const a = await authority(await openStore(home)),
    run = bind(a);
  try {
    await run("doc.create", { slug: "p" });
    await a.change("p", (d) => replaceText(d, "First sentence. Another sentence."));
    const r = (await run("alt.propose", {
      doc: "p",
      at: { base: a.read("p").base, from: 0, to: 15 },
      versions: ["Agent sentence."],
      by: { kind: "human" },
    })) as { alt: string };
    await run("alt.flip", { doc: "p", alt: r.alt, to: 1 }, "s");
    await undoSession(a, "s");
    expect(a.read("p").alts[0]).toMatchObject({ from: 0, to: 15 });
    await run("alt.flip", { doc: "p", alt: r.alt, to: 1 });
    await run("alt.resolve", { doc: "p", alt: r.alt, rest: "stash" });
    expect(await run("stash.list", { doc: "p" })).toMatchObject([{ text: "First sentence." }]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
