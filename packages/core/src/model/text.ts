import { LoroDoc } from "loro-crdt";
import { normalizeAlternatives, dissolveCrossed } from "./normalize.ts";
import { KEYS } from "./keys.ts";
/** Posts carry a slug; components never do. Kind ids are configuration, not a discriminant. */
export const isPost = (doc: LoroDoc) => typeof doc.getMap(KEYS.meta).get("slug") === "string";
export function createPost(
  slug: string,
  init: { kind: string; meta: Record<string, string | number>; text: string } = {
    kind: "post",
    meta: {},
    text: "",
  },
) {
  const doc = new LoroDoc();
  const meta = doc.getMap(KEYS.meta);
  for (const [key, value] of Object.entries({
    ...init.meta,
    schema: 1,
    id: slug,
    kind: init.kind,
    slug,
    createdAt: Date.now(),
  }))
    meta.set(key, value);
  if (init.text) doc.getText(KEYS.mdx).insert(0, init.text);
  doc.commit();
  return doc;
}
/** Changes which kind (and so which rules) a post uses; body and defaults are untouched. */
export function setKind(doc: LoroDoc, kind: string) {
  if (!isPost(doc)) throw new Error("InvalidInvariant: only posts have a kind");
  doc.getMap(KEYS.meta).set("kind", kind);
  doc.commit();
}
/** Copies reading values into meta so an export projection that strips them cannot lose them. */
export function retainMeta(doc: LoroDoc, values: Record<string, string | number>) {
  const meta = doc.getMap(KEYS.meta);
  for (const [key, value] of Object.entries(values))
    if (meta.get(key) !== value) meta.set(key, value);
  doc.commit();
}
export function importTyping(doc: LoroDoc, bytes: Uint8Array) {
  const before = doc.fork();
  doc.import(bytes);
  dissolveCrossed(doc, before);
  normalize(doc);
}
/**
 * Imports updates relayed by the sync server. Posts take the editor-typing path (import unchanged,
 * then normalize); components import plainly, because normalization applies to posts only.
 */
export function importSynced(doc: LoroDoc, bytes: Uint8Array) {
  if (isPost(doc)) importTyping(doc, bytes);
  else doc.import(bytes);
}
export function normalize(doc: LoroDoc) {
  if (!isPost(doc)) throw new Error("InvalidInvariant: typing requires a post");
  for (const value of Object.values(doc.getMap(KEYS.deps).toJSON())) {
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      typeof value.version !== "string" ||
      !/^(dev|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.test(value.version)
    )
      throw new Error("InvalidInvariant: invalid dependency");
  }
  doc.getText(KEYS.mdx);
  normalizeAlternatives(doc);
  doc.commit();
}

export function replaceText(doc: LoroDoc, value: string) {
  doc.getText(KEYS.mdx).update(value);
  doc.commit();
}
