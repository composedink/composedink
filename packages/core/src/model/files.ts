import { decodeFrontiers, LoroDoc, LoroText } from "loro-crdt";
import { KEYS } from "./keys.ts";
import { head } from "./read.ts";
export function safePath(path: string) {
  if (
    !path ||
    path.includes("\0") ||
    path
      .split("/")
      .some(
        (p) =>
          p === "node_modules" ||
          p.startsWith(".composed") ||
          p === ".npmrc" ||
          p === "pnpm-workspace.yaml" ||
          p === ".pnpmfile.cjs",
      ) ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("InvalidInvariant: unsafe component path");
  return path;
}
export function createComponent(id: string, files: Record<string, string>) {
  const doc = new LoroDoc();
  const meta = doc.getMap(KEYS.meta);
  for (const [key, value] of Object.entries({ schema: 1, id, kind: "component" }))
    meta.set(key, value);
  const map = doc.getMap(KEYS.files);
  for (const [path, text] of Object.entries(files))
    map.setContainer(safePath(path), new LoroText()).insert(0, text);
  doc.commit();
  return doc;
}
export function readFiles(doc: LoroDoc) {
  const files: Record<string, string> = {};
  for (const [path, value] of doc.getMap(KEYS.files).entries()) {
    if (!(value instanceof LoroText)) throw new Error("InvalidInvariant: expected file text");
    files[path] = value.toString();
  }
  return { base: head(doc), files };
}
export function writeFiles(doc: LoroDoc, base: string, files: Record<string, string>) {
  let fork: LoroDoc;
  try {
    const frontiers = decodeFrontiers(Buffer.from(base, "base64url"));
    fork = doc.forkAt(frontiers);
  } catch {
    throw Error("UnknownBase: retained component history does not contain this base");
  }
  const from = fork.version();
  const map = fork.getMap(KEYS.files);
  for (const [path, text] of Object.entries(files)) {
    safePath(path);
    const existing = map.get(path);
    const target = existing instanceof LoroText ? existing : map.setContainer(path, new LoroText());
    target.update(text);
  }
  fork.commit();
  doc.import(fork.export({ mode: "update", from }));
  return { head: head(doc) };
}
