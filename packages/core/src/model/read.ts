import { encodeFrontiers, type LoroDoc } from "loro-crdt";
import { KEYS } from "./keys.ts";
export const head = (doc: LoroDoc) =>
  Buffer.from(encodeFrontiers(doc.frontiers())).toString("base64url");
export function read(doc: LoroDoc) {
  const meta = doc.getMap(KEYS.meta);
  return {
    doc: String(meta.get("id")),
    slug: typeof meta.get("slug") === "string" ? String(meta.get("slug")) : "",
    base: head(doc),
    view: "full" as const,
    text: doc.getText(KEYS.mdx).toString(),
    dim: [],
    alts: [],
    blocks: [],
  };
}
