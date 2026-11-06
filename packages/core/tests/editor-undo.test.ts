import { expect, it } from "vite-plus/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority } from "../src/authority";
import { openStore } from "../src/store/store";
import { bind } from "../src/ops/registry";
import { replaceText } from "../src/model/text";
import { readFiles } from "../src/model/files";
it("undoes only a human dependency operation, preserving typing and remote dependencies", async () => {
  const a = await authority(await openStore(await mkdtemp(join(tmpdir(), "editor-undo-"))));
  const run = bind(a);
  await run("doc.create", { slug: "post" });
  await run(
    "deps.add",
    { doc: "post", tag: "Card", component: "composed:a/one", version: "dev" },
    "human",
  );
  await run("deps.add", { doc: "post", tag: "Other", component: "composed:a/two", version: "dev" });
  const replica = a.get("post").fork();
  const from = replica.version();
  replaceText(replica, "concurrent 😀");
  await a.typing("post", replica.export({ mode: "update", from }));
  await a.serialize(() => a.undo("human"));
  expect(a.get("post").getMap("deps").toJSON()).toEqual({
    Other: { id: "composed:a/two", version: "dev" },
  });
  expect(a.read("post").text).toBe("concurrent 😀");
  await expect(a.undo("human")).rejects.toThrow("NothingToUndo");
});
it("component inverse preserves edits made after the operation", async () => {
  const a = await authority(await openStore(await mkdtemp(join(tmpdir(), "editor-files-"))));
  const run = bind(a);
  await run("component.create", { id: "composed:a/block", kind: "block" });
  const before = readFiles(a.get("composed:a/block"));
  await run(
    "component.write",
    { id: "composed:a/block", base: before.base, files: { "note.txt": "human" } },
    "human",
  );
  await run("component.write", {
    id: "composed:a/block",
    base: readFiles(a.get("composed:a/block")).base,
    files: { "other.txt": "agent" },
  });
  await a.undo("human");
  const after = readFiles(a.get("composed:a/block")).files;
  expect(after["note.txt"]).toBeUndefined();
  expect(after["other.txt"]).toBe("agent");
});
it("fails a detached creation inverse instead of selecting another document", async () => {
  const a = await authority(await openStore(await mkdtemp(join(tmpdir(), "editor-create-"))));
  await bind(a)("doc.create", { slug: "post" }, "human");
  await a.undo("human");
  expect(() => a.read("post")).toThrow("UnknownDoc");
});
it("fails when the dependency target was replaced, and preserves the replacement", async () => {
  const a = await authority(await openStore(await mkdtemp(join(tmpdir(), "editor-detached-"))));
  const run = bind(a);
  await run("doc.create", { slug: "post" });
  await run(
    "deps.add",
    { doc: "post", tag: "Card", component: "composed:a/one", version: "dev" },
    "human",
  );
  await run("deps.add", { doc: "post", tag: "Card", component: "composed:a/two", version: "dev" });
  await expect(a.undo("human")).rejects.toThrow("DetachedTarget");
  expect(a.get("post").getMap("deps").toJSON()).toEqual({
    Card: { id: "composed:a/two", version: "dev" },
  });
});
it("undoes component text using CRDT identities while retaining subsequent text in the same file", async () => {
  const a = await authority(await openStore(await mkdtemp(join(tmpdir(), "editor-text-"))));
  const run = bind(a);
  const id = "composed:a/block";
  await run("component.create", { id, kind: "block" });
  await run("component.write", {
    id,
    base: readFiles(a.get(id)).base,
    files: { "note.txt": "base" },
  });
  await run(
    "component.write",
    { id, base: readFiles(a.get(id)).base, files: { "note.txt": "base human" } },
    "human",
  );
  await run("component.write", {
    id,
    base: readFiles(a.get(id)).base,
    files: { "note.txt": "base human agent" },
  });
  await a.undo("human");
  expect(readFiles(a.get(id)).files["note.txt"]).toBe("base agent");
});
it("refuses to remove a newly created file that another writer has edited", async () => {
  const a = await authority(await openStore(await mkdtemp(join(tmpdir(), "editor-file-busy-"))));
  const run = bind(a);
  const id = "composed:a/block";
  await run("component.create", { id, kind: "block" });
  await run(
    "component.write",
    { id, base: readFiles(a.get(id)).base, files: { "note.txt": "human" } },
    "human",
  );
  await run("component.write", {
    id,
    base: readFiles(a.get(id)).base,
    files: { "note.txt": "human agent" },
  });
  await expect(a.undo("human")).rejects.toThrow("DetachedTarget");
  expect(readFiles(a.get(id)).files["note.txt"]).toBe("human agent");
});
it("fails a text inverse whose file container has been detached", async () => {
  const a = await authority(
    await openStore(await mkdtemp(join(tmpdir(), "editor-file-detached-"))),
  );
  const run = bind(a);
  const id = "composed:a/block";
  await run("component.create", { id, kind: "block" });
  await run("component.write", {
    id,
    base: readFiles(a.get(id)).base,
    files: { "note.txt": "base" },
  });
  await run(
    "component.write",
    { id, base: readFiles(a.get(id)).base, files: { "note.txt": "base human" } },
    "human",
  );
  await a.change(id, (doc) => {
    const map = doc.getMap("files");
    map.delete("note.txt");
    doc.commit();
  });
  await expect(a.undo("human")).rejects.toThrow("DetachedTarget");
  expect(readFiles(a.get(id)).files["note.txt"]).toBeUndefined();
});
