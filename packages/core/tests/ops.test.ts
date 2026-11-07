import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openStore, authority, bind } from "../src/node.ts";
import { readFiles } from "../src/model/files.ts";
it("validates the implemented registry and applies component writes at retained bases", async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-ops-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    const id = "composed:lachieh/hello";
    await run("component.create", { id, kind: "inline" });
    const base = readFiles(a.get(id)).base;
    await run("component.write", { id, base, files: { "fallback.ts": "first" } });
    await run("component.write", { id, base, files: { "other.ts": "concurrent" } });
    expect(readFiles(a.get(id)).files).toMatchObject({
      "fallback.ts": "first",
      "other.ts": "concurrent",
    });
    await expect(
      run("component.write", { id, base, files: { "../escape": "x" } }),
    ).rejects.toThrow();
    await expect(run("future.operation", {})).rejects.toThrow("Unknown operation");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("creates from kinds, changes only meta.kind and reads/writes kind files at a base", async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-kind-ops-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    await run("doc.create", { slug: "plain" });
    expect(a.read("plain").text).toContain("reader: blog readers");
    expect(a.get("plain").getMap("meta").get("kind")).toBe("post");
    await run("doc.create", { slug: "weekly", kind: "weekly-update", request: "create-weekly" });
    const body = a.read("weekly").text;
    expect(body).toContain("## Done");
    await expect(run("doc.create", { slug: "bad", kind: "nowhere" })).rejects.toThrow(
      /UnknownKind/,
    );
    await expect(run("doc.create", { slug: "bad", kind: "component" })).rejects.toThrow();
    await run("doc.kind", { id: "weekly", kind: "design-doc" });
    expect(a.read("weekly").text).toBe(body);
    expect(a.get("weekly").getMap("meta").get("kind")).toBe("design-doc");
    await expect(run("doc.kind", { id: "weekly", kind: "nowhere" })).rejects.toThrow(/UnknownKind/);
    expect(await run("kind.list", {})).toContainEqual({ kind: "post", origin: "builtin" });
    const read = (await run("kind.read", { kind: "essay" })) as {
      base: string;
      files: Record<string, string>;
    };
    expect(read.files).toEqual({ "kind.json": "", "template.mdx": "", "rules.json": "" });
    const json = (await run("kind.read", { kind: "post" })) as { files: Record<string, string> };
    const write = (file: string, text: string, base: string, request?: string) =>
      run("kind.write", { kind: "essay", file, text, base, ...(request ? { request } : {}) });
    const first = (await write("kind.json", json.files["kind.json"], read.base, "k1")) as {
      base: string;
    };
    expect(await write("kind.json", json.files["kind.json"], read.base, "k1")).toEqual(first);
    await expect(write("rules.json", "{}", read.base)).rejects.toThrow(/UnknownBase/);
    await expect(write("other.json", "{}", first.base)).rejects.toThrow();
    await expect(run("doc.create", { slug: "early", kind: "essay" })).rejects.toThrow(
      /missing file/,
    );
    const second = (await write("template.mdx", "# Essay\n", first.base)) as { base: string };
    await write(
      "rules.json",
      JSON.stringify({ extends: "post", rules: {}, custom: [] }),
      second.base,
    );
    await run("doc.create", { slug: "essay-1", kind: "essay" });
    expect(await run("rules.effective", { id: "essay-1" })).toMatchObject({
      reader: "blog readers",
      medium: "web",
      budget: 1200,
      custom: [],
      warnings: [],
    });
    await expect(run("rules.effective", { id: "composed:lachieh/hello" })).rejects.toThrow();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
