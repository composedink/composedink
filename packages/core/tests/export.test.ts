import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
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
    const result = await run("export", { doc: "tracer", to: join(home, "content") });
    expect(result).toMatchObject({
      lock: { mode: "preview", blocks: { Hello: { instances: expect.any(Object) } } },
    });
    expect(await readFile(join(home, "content/tracer/index.mdx"), "utf8")).toBe(
      a.read("tracer").text,
    );
    const before = await run("component.read", { id });
    if (!before || typeof before !== "object" || !("base" in before))
      throw new Error("Missing base");
    await run("component.write", {
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
