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
