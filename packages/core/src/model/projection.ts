import type { LoroDoc } from "loro-crdt";
import { encodeFrontiers } from "loro-crdt";
export type View = "full" | "clean";
export function projection(doc: LoroDoc, view: View = "full") {
  let source = 0,
    visible = 0,
    text = "";
  const segments: { from: number; to: number; source: number }[] = [];
  const edges = new Map<number, number>();
  for (const part of doc.getText("mdx").toDelta()) {
    const value = part.insert ?? "";
    if (view === "clean" && part.attributes?.dim) {
      if (!edges.has(visible)) edges.set(visible, source);
    } else if (value.length) {
      segments.push({ from: visible, to: visible + value.length, source });
      text += value;
      visible += value.length;
    }
    source += value.length;
  }
  const offset = (p: number) => {
    if (p < 0 || p > text.length) throw Error("InvalidInvariant: projection offset");
    const edge = edges.get(p);
    if (edge !== undefined) return edge;
    const segment = segments.find((s) => p >= s.from && p <= s.to);
    return segment ? segment.source + p - segment.from : source;
  };
  const ranges = (from: number, to: number) =>
    segments.flatMap((s) => {
      const f = Math.max(from, s.from),
        t = Math.min(to, s.to);
      return t > f ? [{ from: s.source + f - s.from, to: s.source + t - s.from }] : [];
    });
  return { text, segments, offset, ranges };
}
export function project(doc: LoroDoc, view: View = "full") {
  const p = projection(doc, view),
    meta = doc.getMap("meta");
  return {
    doc: String(meta.get("id")),
    slug: typeof meta.get("slug") === "string" ? String(meta.get("slug")) : "",
    base: Buffer.from(encodeFrontiers(doc.frontiers())).toString("base64url"),
    view,
    ...p,
  };
}
