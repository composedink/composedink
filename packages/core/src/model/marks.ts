import { Cursor, type LoroDoc } from "loro-crdt";
import { select, type selectionSchema } from "./selection.ts";
import type { z } from "zod";
export function configureMarks(doc: LoroDoc) {
  doc.configTextStyle({ dim: { expand: "none" } });
}
export function ghost(doc: LoroDoc, at: z.infer<typeof selectionSchema>, dim: boolean) {
  const { fork, from, to } = select(doc, at);
  const target = doc.getText("mdx");
  configureMarks(doc);
  const ranges: { start: number; end: number }[] = [];
  for (let i = from; i < to;) {
    const cursor = fork.getText("mdx").getCursor(i, 0);
    const width = String.fromCodePoint(fork.getText("mdx").toString().codePointAt(i)!).length;
    i += width;
    if (!cursor) continue;
    const p = doc.getCursorPos(Cursor.decode(cursor.encode()));
    if (!p || p.update) continue;
    const range = { start: p.offset, end: p.offset + width };
    const last = ranges.at(-1);
    if (last && last.end === range.start) last.end = range.end;
    else ranges.push(range);
  }
  for (const range of ranges) {
    if (dim) target.mark(range, "dim", true);
    else target.unmark(range, "dim");
  }
  doc.commit();
}
export function insertSnippet(
  doc: LoroDoc,
  at: number,
  value: { text: string; dim: [number, number][] },
) {
  configureMarks(doc);
  if (!value.text) return;
  const text = doc.getText("mdx");
  text.insert(at, value.text);
  text.unmark({ start: at, end: at + value.text.length }, "dim");
  for (const [f, t] of value.dim) text.mark({ start: at + f, end: at + t }, "dim", true);
}
