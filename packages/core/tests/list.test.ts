import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { bodyWords } from "../src/index.ts";
import { replaceText } from "../src/model/text.ts";

async function home<T>(run: (h: string) => Promise<T>) {
  const h = await mkdtemp(join(tmpdir(), "list-"));
  try {
    return await run(h);
  } finally {
    await rm(h, { recursive: true, force: true });
  }
}
const pause = () => new Promise((r) => setTimeout(r, 15));
it("an empty home lists no documents", () =>
  home(async (h) => {
    const run = bind(await authority(await openStore(h)));
    expect(await run("doc.list", {})).toEqual({ docs: [] });
  }));
it("lists posts newest first with title, kind, prose words and update time; components are not posts", () =>
  home(async (h) => {
    const a = await authority(await openStore(h));
    const run = bind(a);
    await run("doc.create", { slug: "first" });
    await a.change("first", (d) => replaceText(d, "---\ntitle: The First\n---\n\nOne two three."));
    await pause();
    await run("doc.create", { slug: "second", kind: "weekly-update" });
    await pause();
    await run("doc.create", { slug: "third" });
    await run("component.create", { id: "composed:me/thing", kind: "block" });
    await pause();
    // Editing the first post moves it to the top.
    await a.change("first", (d) =>
      replaceText(d, "---\ntitle: The First\n---\n\n# Heading\n\nOne two three. Four five."),
    );
    const { docs } = (await run("doc.list", {})) as {
      docs: { id: string; title: string; kind: string; words: number; updatedAt: number }[];
    };
    expect(docs.map((d) => d.id)).toEqual(["first", "third", "second"]);
    expect(docs[0]).toEqual({
      id: "first",
      title: "The First",
      kind: "post",
      words: 5,
      updatedAt: expect.any(Number),
    });
    expect(docs[2]).toMatchObject({ id: "second", kind: "weekly-update" });
    // A kind's template supplies the title until the writer changes it.
    expect(docs[1].title).toBe("Untitled");
    expect(docs[2].title).toBe("Weekly update");
    expect(docs[0].updatedAt).toBeGreaterThanOrEqual(docs[1].updatedAt);
    expect(docs[1].updatedAt).toBeGreaterThanOrEqual(docs[2].updatedAt);
    // The same count the editor's status bar shows.
    expect(docs[0].words).toBe(bodyWords(a.read("first").text));
    // A restart reads the same list from disk.
    expect(await bind(await authority(await openStore(h)))("doc.list", {})).toEqual({ docs });
  }));
it("a post without a frontmatter title is titled by its slug", () =>
  home(async (h) => {
    const a = await authority(await openStore(h));
    const run = bind(a);
    await run("doc.create", { slug: "bare" });
    await a.change("bare", (d) => replaceText(d, "No frontmatter at all."));
    expect(await run("doc.list", {})).toMatchObject({ docs: [{ id: "bare", title: "bare" }] });
  }));
it("a post whose frontmatter is broken still lists, titled by its slug, with body words", () =>
  home(async (h) => {
    const a = await authority(await openStore(h));
    const run = bind(a);
    await run("doc.create", { slug: "broken" });
    await a.change("broken", (d) =>
      replaceText(d, "---\ntitle: [Unclosed\nmedium: web# Why\n---\n\nStill four words here."),
    );
    expect(await run("doc.list", {})).toEqual({
      docs: [
        { id: "broken", title: "broken", kind: "post", words: 4, updatedAt: expect.any(Number) },
      ],
    });
  }));
