import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
import { openThread } from "../src/model/threads.ts";
it("exports exact MDX and schema-validated locked Markdown, then refreshes on component.write", async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-export-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    const id = "composed:lachieh/hello";
    await run("doc.create", { slug: "tracer" });
    await run("component.create", { id, kind: "inline" });
    await run("deps.add", { doc: "tracer", tag: "Hello", component: id, version: "dev" });
    await a.change("tracer", (doc) => replaceText(doc, 'A <Hello name="Lachlan" />.'));
    const result = await run("export", { view: "clean", doc: "tracer", to: join(home, "content") });
    expect(result).toMatchObject({
      lock: { mode: "preview", blocks: { Hello: { instances: expect.any(Object) } } },
    });
    expect(await readFile(join(home, "content/tracer/index.mdx"), "utf8")).toBe(
      a.read("tracer").text,
    );
    const restarted = await authority(await openStore(home));
    const resumed = bind(restarted);
    const before = await resumed("component.read", { id });
    if (!before || typeof before !== "object" || !("base" in before))
      throw new Error("Missing base");
    await resumed("component.write", {
      id,
      base: before.base,
      files: { "fallback.ts": "export default ({name}: {name:string}) => `Updated **${name}**.`;" },
    });
    expect(await readFile(join(home, "content/tracer/composed.lock.json"), "utf8")).toContain(
      "Updated **Lachlan**.",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
it("exported MDX carries no thread or request data", async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-export-threads-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    await run("doc.create", { slug: "talk" });
    const source = "---\ntitle: T\n---\n\nAlpha beta gamma.\n";
    await a.change("talk", (doc) => replaceText(doc, source));
    await a.change("talk", (doc) =>
      openThread(
        doc,
        { base: a.read("talk").base, quote: "beta" },
        { text: "zebra-comment-xyzzy", by: { kind: "human" } },
      ),
    );
    await run("export", { view: "full", doc: "talk", to: join(home, "content") });
    const mdx = await readFile(join(home, "content/talk/index.mdx"), "utf8");
    expect(mdx).toBe(source);
    const lock = await readFile(join(home, "content/talk/composed.lock.json"), "utf8");
    expect(mdx + lock).not.toContain("zebra-comment-xyzzy");
    expect(mdx + lock).not.toMatch(/threads|requests/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 60000);
