import { LoroList, LoroMap, type LoroDoc } from "loro-crdt";
import { z } from "zod";
import { anchors, interval, select, type Author, selectionSchema } from "./selection.ts";
import { stash, snippet, versionSchema, type Version } from "./stash.ts";
export const altSchema = z.object({
  start: z.array(z.number()),
  end: z.array(z.number()),
  versions: z.array(versionSchema),
});
export function alternatives(doc: LoroDoc) {
  return doc
    .getMap("alts")
    .entries()
    .map(([id, value]) => ({
      id,
      ...altSchema.parse(value instanceof LoroMap ? value.toJSON() : value),
    }));
}
export function altViews(doc: LoroDoc) {
  return alternatives(doc).map((a) => ({
    id: a.id,
    ...interval(doc, a),
    active: a.versions.findIndex((v) => v.text === undefined),
    count: a.versions.length,
    versions: a.versions.map((v) => ({
      ...v,
      ...(v.text === undefined ? snippet(doc, interval(doc, a).from, interval(doc, a).to) : {}),
    })),
  }));
}
function write(doc: LoroDoc, id: string, from: number, to: number, versions: Version[]) {
  const a = doc.getMap("alts").setContainer(id, new LoroMap());
  const cursors = anchors(doc, from, to);
  a.set("start", cursors.start);
  a.set("end", cursors.end);
  const list = a.setContainer("versions", new LoroList());
  for (const v of versions) list.push(v);
}
export function attach(doc: LoroDoc, from: number, to: number, versions: Version[], by: Author) {
  const original = { from, to };
  let changed = true;
  const absorbed = new Set<string>();
  while (changed) {
    changed = false;
    for (const a of alternatives(doc)) {
      const r = interval(doc, a);
      if (!absorbed.has(a.id) && from < r.to && to > r.from) {
        absorbed.add(a.id);
        from = Math.min(from, r.from);
        to = Math.max(to, r.to);
        changed = true;
      }
    }
  }
  const source = doc.getText("mdx").toString();
  versions = versions.map((v) => ({
    ...v,
    text: source.slice(from, original.from) + (v.text ?? "") + source.slice(original.to, to),
    dim: v.dim.map(([f, t]) => [f + original.from - from, t + original.from - from]),
  }));
  for (const a of alternatives(doc))
    if (absorbed.has(a.id)) {
      for (const v of a.versions) stash(doc, v, "alt");
      doc.getMap("alts").delete(a.id);
    }
  const id = crypto.randomUUID();
  write(doc, id, from, to, [{ by, at: Date.now(), dim: [] }, ...versions]);
  doc.commit();
  return id;
}
export function propose(
  doc: LoroDoc,
  at: z.infer<typeof selectionSchema>,
  texts: string[],
  by: Author,
) {
  const { fork, from, to } = select(doc, at);
  const live = interval(doc, anchors(fork, from, to));
  const versions = texts.map((text) => {
    const agent = fork.fork();
    const target = agent.getText("mdx");
    target.update(target.toString().slice(0, from) + text + target.toString().slice(to));
    agent.commit();
    const extraction = anchors(agent, from, from + text.length);
    const merged = doc.fork();
    merged.import(agent.export({ mode: "update", from: fork.version() }));
    const r = interval(merged, extraction);
    return { ...snippet(merged, r.from, Math.max(r.from, r.to)), by, at: Date.now() };
  });
  if (live.to <= live.from) {
    const detached = versions.map((v) => stash(doc, v, "detached")!);
    doc.commit();
    return { detached };
  }
  return { alt: attach(doc, live.from, live.to, versions, by), detached: [] };
}
export function flip(doc: LoroDoc, id: string, to: number | "next" | "prev") {
  const a = alternatives(doc).find((a) => a.id === id);
  if (!a) throw Error("UnknownAlt");
  const r = interval(doc, a);
  const active = a.versions.findIndex((v) => v.text === undefined);
  const index =
    typeof to === "number"
      ? to
      : (active + (to === "next" ? 1 : a.versions.length - 1)) % a.versions.length;
  const chosen = a.versions[index];
  if (!chosen) throw Error("InvalidInvariant: version index");
  if (index === active) return { active };
  a.versions[active] = { ...a.versions[active], ...snippet(doc, r.from, r.to) };
  const text = doc.getText("mdx");
  text.delete(r.from, Math.max(0, r.to - r.from));
  if (chosen.text) text.insert(r.from, chosen.text);
  for (const [f, t] of chosen.dim) text.mark({ start: r.from + f, end: r.from + t }, "dim", true);
  const { text: _text, ...slot } = chosen;
  a.versions[index] = slot;
  write(doc, id, r.from, r.from + (chosen.text?.length ?? 0), a.versions);
  doc.commit();
  return { active: index };
}
export function resolve(doc: LoroDoc, id: string) {
  const a = alternatives(doc).find((a) => a.id === id);
  if (!a) throw Error("UnknownAlt");
  for (const v of a.versions) stash(doc, v, "alt");
  doc.getMap("alts").delete(id);
  doc.commit();
}
