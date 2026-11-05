import { LoroDoc } from "loro-crdt";
import { KEYS } from "./keys.ts";
export function createPost(slug: string) {
  const doc = new LoroDoc();
  const meta = doc.getMap(KEYS.meta);
  for (const [key, value] of Object.entries({
    schema: 1,
    id: slug,
    kind: "post",
    slug,
    createdAt: Date.now(),
  }))
    meta.set(key, value);
  doc.commit();
  return doc;
}
export function importTyping(doc: LoroDoc, bytes: Uint8Array) {
  doc.import(bytes);
  normalize(doc);
}
export function normalize(doc: LoroDoc) {
  if (doc.getMap(KEYS.meta).get("kind") !== "post")
    throw new Error("InvalidInvariant: typing requires a post");
  for (const value of Object.values(doc.getMap(KEYS.deps).toJSON())) {
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== "dev")
      throw new Error("InvalidInvariant: invalid dev dependency");
  }
  doc.getText(KEYS.mdx);
  doc.commit();
}

export function replaceText(doc: LoroDoc, value: string) {
  doc.getText(KEYS.mdx).update(value);
  doc.commit();
}
