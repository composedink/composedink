import { insertSnippet } from "./marks.ts";
import { interval, anchors } from "./selection.ts";
import { Cursor, type LoroDoc } from "loro-crdt";
import { z } from "zod";
import { select, authorSchema, type selectionSchema } from "./selection.ts";
export const versionSchema = z.object({
  text: z.string().optional(),
  dim: z.array(z.tuple([z.number(), z.number()])).default([]),
  by: authorSchema,
  at: z.number(),
});
export type Version = z.infer<typeof versionSchema>;
export const stashSchema = versionSchema
  .required({ text: true })
  .extend({ id: z.string(), reason: z.enum(["alt", "cut", "detached"]) });
export function stashList(doc: LoroDoc) {
  return doc
    .getMovableList("stash")
    .toArray()
    .map((v) => stashSchema.parse(v));
}
export function stash(
  doc: LoroDoc,
  v: Version,
  reason: "alt" | "detached" | "cut",
  id: string = crypto.randomUUID(),
) {
  if (v.text === undefined) return;
  doc.getMovableList("stash").push({ ...v, text: v.text, id, reason });
  return id;
}
export function snippet(doc: LoroDoc, from: number, to: number) {
  let offset = 0;
  const dim: [number, number][] = [];
  for (const part of doc.getText("mdx").toDelta()) {
    const end = offset + (part.insert?.length ?? 0);
    if (to > from && part.attributes?.dim && end > from && offset < to)
      dim.push([Math.max(offset, from) - from, Math.min(end, to) - from]);
    offset = end;
  }
  return { text: doc.getText("mdx").toString().slice(from, to), dim };
}

export function cut(doc: LoroDoc, at: z.infer<typeof selectionSchema>) {
  const { fork, from, to } = select(doc, at);
  const range = interval(doc, anchors(fork, from, to));
  if (range.to <= range.from) throw Error("DetachedTarget: cut selection removed");
  const item = stash(
    doc,
    { ...snippet(doc, range.from, range.to), by: { kind: "human" }, at: Date.now() },
    "cut",
  )!;
  doc.getText("mdx").delete(range.from, range.to - range.from);
  doc.commit();
  return { item };
}
export function restore(doc: LoroDoc, id: string, at: z.infer<typeof selectionSchema>) {
  const list = stashList(doc),
    index = list.findIndex((v) => v.id === id);
  if (index < 0) throw Error("UnknownStash");
  const { fork, from, to } = select(doc, at);
  if (from !== to) throw Error("InvalidInvariant: restore needs an insertion anchor");
  const text = fork.getText("mdx");
  if (text.length === 0) {
    if (doc.getText("mdx").length !== 0)
      throw Error("DetachedTarget: empty insertion anchor changed");
    insertSnippet(doc, 0, list[index]);
    doc.getMovableList("stash").delete(index, 1);
    doc.commit();
    return;
  }
  const cursor = text.getCursor(
    from < text.length
      ? from
      : from > 1 && /[\uDC00-\uDFFF]/.test(text.toString()[from - 1])
        ? from - 2
        : Math.max(0, from - 1),
    from < text.length ? -1 : 1,
  );
  if (!cursor) throw Error("DetachedTarget: insertion anchor unavailable");
  const p = doc.getCursorPos(Cursor.decode(cursor.encode()));
  if (!p || p.update) throw Error("DetachedTarget: insertion anchor deleted");
  insertSnippet(
    doc,
    p.offset +
      (p.side === 1
        ? String.fromCodePoint(doc.getText("mdx").toString().codePointAt(p.offset) ?? 0).length
        : 0),
    list[index],
  );
  doc.getMovableList("stash").delete(index, 1);
  doc.commit();
}
/** Deletes a stash entry by id; removing an entry that is already gone changes nothing. */
export function removeStash(doc: LoroDoc, id: string) {
  const index = stashList(doc).findIndex((v) => v.id === id);
  if (index < 0) return { item: id, removed: false };
  doc.getMovableList("stash").delete(index, 1);
  doc.commit();
  return { item: id, removed: true };
}
