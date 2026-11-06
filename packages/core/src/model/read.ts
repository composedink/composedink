import { projection, type View } from "./projection.ts";
import { snippet } from "./stash.ts";
import { encodeFrontiers, type LoroDoc } from "loro-crdt";
import { altViews } from "./alternatives.ts";
import { KEYS } from "./keys.ts";
export const head = (doc: LoroDoc) =>
  Buffer.from(encodeFrontiers(doc.frontiers())).toString("base64url");
export function read(doc: LoroDoc, view: View = "full") {
  const meta = doc.getMap(KEYS.meta);
  return {
    doc: String(meta.get("id")),
    slug: typeof meta.get("slug") === "string" ? String(meta.get("slug")) : "",
    base: head(doc),
    view,
    text: projection(doc, view).text,
    dim: view === "full" ? snippet(doc, 0, doc.getText(KEYS.mdx).length).dim : [],
    alts: altViews(doc).map((a) => {
      if (view === "full") return a;
      const visible = (offset: number) =>
        projection(doc, view).segments.reduce(
          (n, s) => n + Math.max(0, Math.min(offset - s.source, s.to - s.from)),
          0,
        );
      return { ...a, from: visible(a.from), to: visible(a.to) };
    }),
    blocks: [],
  };
}
