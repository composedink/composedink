import { LoroMap, type LoroDoc } from "loro-crdt";
import { alternatives, altSchema } from "./alternatives.ts";
import { interval, authorSchema } from "./selection.ts";
import { stash, versionSchema } from "./stash.ts";
export function normalizeAlternatives(doc: LoroDoc) {
  for (const [id, value] of doc.getMap("alts").entries()) {
    try {
      const a = altSchema.parse(value instanceof LoroMap ? value.toJSON() : value);
      interval(doc, a);
      if (a.versions.filter((v) => v.text === undefined).length === 1) continue;
    } catch {}
    const raw = value instanceof LoroMap ? value.toJSON() : value;
    if (raw && typeof raw === "object" && "versions" in raw && Array.isArray(raw.versions))
      for (const [i, v] of raw.versions.entries()) {
        const parsed = versionSchema.safeParse(v);
        if (parsed.success) stash(doc, parsed.data, "alt", `repair:${id}:${i}`);
        else if (v && typeof v === "object" && "text" in v && typeof v.text === "string") {
          const author = "by" in v ? authorSchema.safeParse(v.by) : undefined;
          stash(
            doc,
            { text: v.text, dim: [], by: author?.success ? author.data : { kind: "human" }, at: 0 },
            "alt",
            `repair:${id}:${i}`,
          );
        }
      }
    doc.getMap("alts").delete(id);
  }
  doc.commit();
}
export function dissolveCrossed(doc: LoroDoc, before: LoroDoc) {
  const changes = doc.diff(before.frontiers(), doc.frontiers());
  const diff = changes.find(([id]) => id === before.getText("mdx").id)?.[1];
  if (diff?.type !== "text") return;
  let pos = 0;
  const edits: { from: number; to: number }[] = [];
  for (const d of diff.diff) {
    if (d.retain) pos += d.retain;
    else if (d.delete) {
      edits.push({ from: pos, to: pos + d.delete });
      pos += d.delete;
    }
  }
  for (const a of alternatives(before)) {
    const r = interval(before, a);
    if (
      edits.some(
        (e) =>
          (e.from < r.from && e.to > r.from) ||
          (e.from < r.to && e.to > r.to) ||
          (e.from <= r.from && e.to >= r.to),
      )
    ) {
      for (const v of a.versions) stash(doc, v, "alt");
      doc.getMap("alts").delete(a.id);
    }
  }
}
