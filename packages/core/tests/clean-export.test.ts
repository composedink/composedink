import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authority, openStore, bind } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
import { sha256 } from "../src/bundle.ts";
import { importFile } from "../src/import.ts";
it("exports exact clean bytes/hash without stash, imports formatter edits at lock.base and replays receipts after restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "clean-export-"));
  try {
    const a = await authority(await openStore(home)),
      run = bind(a),
      to = join(home, "content");
    await run("doc.create", { slug: "p" });
    await a.change("p", (d) =>
      replaceText(d, '---\ntitle: Hello\n---\n\nHello SECRET world.\n\n<X value="a" />\n'),
    );
    let state = a.read("p");
    const from = state.text.indexOf("SECRET");
    await run("ghost.set", { doc: "p", at: { base: state.base, from, to: from + 6 }, dim: true });
    state = a.read("p");
    const cutFrom = state.text.indexOf("Hello SECRET");
    // Stash has independent text; it is never exported.
    await a.change("p", (d) => {
      d.getMovableList("stash").push({
        id: "saved",
        text: "STASH ONLY",
        dim: [],
        by: { kind: "human" },
        at: 0,
        reason: "cut",
      });
      d.commit();
    });
    const first = await run("export", { doc: "p", to, view: "clean" });
    const dir = join(to, "p"),
      path = join(dir, "index.mdx");
    const clean = state.text.replace("SECRET", "");
    expect(await readFile(path, "utf8")).toBe(clean);
    expect(first).toMatchObject({ lock: { view: "clean", sha256: sha256(clean) } });
    // Concurrent author append after the export must survive the outside edit.
    await a.change("p", (d) => {
      const t = d.getText("mdx");
      t.insert(t.length, "\nHuman.\n");
      d.commit();
    });
    await writeFile(path, clean.replace("world.", "world!").replace('value="a"', "value='a'"));
    const result = await importFile(a, "p", dir);
    expect(a.read("p").text).toContain("Hello SECRET world!");
    expect(a.read("p").text).toContain("Human.");
    expect(a.read("p").dim).toEqual([[from, from + 6]]);
    const reopened = await authority(await openStore(home));
    await reopened.change("p", (d) => {
      const t = d.getText("mdx");
      t.insert(t.length, " Later.");
      d.commit();
    });
    expect(await importFile(reopened, "p", dir)).toEqual(result);
    await bind(reopened)("export", { doc: "p", to, view: "full" });
    expect(await readFile(path, "utf8")).toContain("SECRET");
    expect(await readFile(path, "utf8")).not.toContain("STASH ONLY");
    await writeFile(path, clean);
    await expect(importFile(reopened, "p", dir)).rejects.toThrow(
      /earlier version.*current lock version/,
    );
    expect(cutFrom).toBeGreaterThan(0);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("rejects invalid MDX and YAML created by omission, leaving source and files untouched", async () => {
  const home = await mkdtemp(join(tmpdir(), "bad-clean-"));
  try {
    const a = await authority(await openStore(home)),
      run = bind(a);
    await run("doc.create", { slug: "p" });
    for (const source of ["<X />", "---\ntitle: [ok]\n---\nText."]) {
      await a.change("p", (d) => replaceText(d, source));
      const f = source.startsWith("<") ? source.indexOf("/>") : source.indexOf("]");
      await run("ghost.set", {
        doc: "p",
        at: { base: a.read("p").base, from: f, to: f + (source.startsWith("<") ? 2 : 1) },
        dim: true,
      });
      await expect(
        run("export", { doc: "p", to: join(home, "out"), view: "clean" }),
      ).rejects.toThrow(/invalid projected.*omitted source ranges/);
      expect(a.read("p").text).toBe(source);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("seeded dimmed prose exports the independent clean oracle with frontmatter and JSX intact", async () => {
  const home = await mkdtemp(join(tmpdir(), "clean-property-"));
  let seed = 505;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  try {
    const a = await authority(await openStore(home)),
      run = bind(a);
    for (let trial = 0; trial < 20; trial++) {
      const doc = `p-${trial}`,
        header = '---\ntitle: "A [title]"\n---\n\n',
        tail = '\n\n<X value="😀" />\n';
      const letters = Array.from({ length: 15 }, () => ({
        text: ["a", "b", "😀", " "][random(4)],
        hidden: random(3) === 0,
      }));
      const body = letters.map((c) => c.text).join("");
      await run("doc.create", { slug: doc });
      await a.change(doc, (d) => replaceText(d, header + body + tail));
      let offset = header.length;
      for (const c of letters) {
        if (c.hidden)
          await run("ghost.set", {
            doc,
            at: { base: a.read(doc).base, from: offset, to: offset + c.text.length },
            dim: true,
          });
        offset += c.text.length;
      }
      const expected =
        header +
        letters
          .filter((c) => !c.hidden)
          .map((c) => c.text)
          .join("") +
        tail;
      const result = await run("export", { doc, to: join(home, "out"), view: "clean" });
      expect(await readFile(join(home, "out", doc, "index.mdx"), "utf8")).toBe(expected);
      expect(result).toMatchObject({ lock: { sha256: sha256(expected), view: "clean" } });
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
