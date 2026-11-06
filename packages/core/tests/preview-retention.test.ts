import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, bind, openStore } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
it("keeps the exact good pair on check or evaluation failure and recovers with a new immutable version", async () => {
  const home = await mkdtemp(join(tmpdir(), "preview-retention-"));
  try {
    const a = await authority(await openStore(home)),
      run = bind(a),
      id = "composed:test/retention";
    await run("doc.create", { slug: "post" });
    await run("component.create", { id, kind: "inline" });
    await run("deps.add", { doc: "post", tag: "Hello", component: id, version: "dev" });
    await a.change("post", (d) => replaceText(d, '<Hello name="Lachlan" />'));
    await run("export", { doc: "post", to: join(home, "content"), view: "clean" });
    const path = join(home, "content/post/composed.lock.json"),
      before = await readFile(path, "utf8");
    const component = await run("component.read", { id });
    if (
      !component ||
      typeof component !== "object" ||
      !("base" in component) ||
      !("files" in component)
    )
      throw Error("Missing component");
    for (const fallback of [
      "export default () => 3;",
      'export default () => { throw Error("evaluation failed"); };',
    ]) {
      const revision = await run("component.read", { id });
      if (!revision || typeof revision !== "object" || !("base" in revision))
        throw Error("Missing revision");
      const result = await run("component.write", {
        id,
        base: revision.base,
        files: { "fallback.ts": fallback },
      });
      expect(result).toMatchObject({ diagnostics: [{ code: "BuildFailed" }] });
      if (fallback.includes("evaluation failed"))
        expect(result).toMatchObject({
          diagnostics: [{ message: expect.stringContaining("Fallback failed") }],
        });
      expect(await readFile(path, "utf8")).toBe(before);
    }
    const initialFiles = component.files;
    if (
      !initialFiles ||
      typeof initialFiles !== "object" ||
      !("block.tsx" in initialFiles) ||
      typeof initialFiles["block.tsx"] !== "string"
    )
      throw Error("Missing files");
    const revision = await run("component.read", { id });
    if (!revision || typeof revision !== "object" || !("base" in revision))
      throw Error("Missing revision");
    const buildFailure = await run("component.write", {
      id,
      base: revision.base,
      files: {
        "fallback.ts": "export default ({name}:{name:string})=>name;",
        "block.tsx": 'import "./missing.css";\n' + initialFiles["block.tsx"],
      },
    });
    expect(buildFailure).toMatchObject({
      diagnostics: [{ code: "BuildFailed", message: expect.stringContaining("missing.css") }],
    });
    expect(await readFile(path, "utf8")).toBe(before);
    const restarted = await authority(await openStore(home)),
      resume = bind(restarted);
    expect(await readFile(path, "utf8")).toBe(before);
    const current = await resume("component.read", { id });
    if (!current || typeof current !== "object" || !("base" in current))
      throw Error("Missing base");
    await resume("component.write", {
      id,
      base: current.base,
      files: {
        "block.tsx": initialFiles["block.tsx"],
        "fallback.ts": "export default ({name}:{name:string}) => `Recovered **${name}**.`;",
      },
    });
    expect(await readFile(path, "utf8")).toContain("Recovered");
    expect(JSON.parse(await readFile(path, "utf8")).blocks.Hello.version).not.toBe(
      JSON.parse(before).blocks.Hello.version,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
