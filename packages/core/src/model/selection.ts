import { Cursor, decodeFrontiers, type LoroDoc } from "loro-crdt";
import { z } from "zod";
export const authorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human") }),
  z.object({ kind: z.literal("agent"), name: z.string() }),
  z.object({ kind: z.literal("model"), model: z.string() }),
]);
export const selectionSchema = z.intersection(
  z.object({ base: z.string(), view: z.literal("full").default("full") }),
  z.union([
    z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }),
    z.object({ quote: z.string().min(1), nth: z.number().int().nonnegative().optional() }),
  ]),
);
export type Author = z.infer<typeof authorSchema>;
export function baseFork(doc: LoroDoc, base: string) {
  try {
    return doc.forkAt(decodeFrontiers(Buffer.from(base, "base64url")));
  } catch {
    throw Error("UnknownBase: retained history does not contain this base");
  }
}
export function select(doc: LoroDoc, at: z.infer<typeof selectionSchema>) {
  const fork = baseFork(doc, at.base),
    text = fork.getText("mdx").toString();
  let from: number, to: number;
  if ("quote" in at) {
    const hits: number[] = [];
    let p = 0;
    while ((p = text.indexOf(at.quote, p)) !== -1) {
      hits.push(p);
      p++;
    }
    if (!hits.length || (at.nth !== undefined && at.nth >= hits.length))
      throw Error("QuoteNotFound");
    if (at.nth === undefined && hits.length > 1) throw Error("AmbiguousQuote");
    from = hits[at.nth ?? 0];
    to = from + at.quote.length;
  } else {
    from = at.from;
    to = at.to;
  }
  if (to < from || to > text.length) throw Error("InvalidInvariant: selection bounds");
  return { fork, from, to };
}
export function anchors(doc: LoroDoc, from: number, to: number) {
  const text = doc.getText("mdx");
  const start = text.getCursor(
    from < to ? from : Math.max(0, from - 1),
    from < to ? -1 : from > 0 ? 1 : -1,
  );
  const end = text.getCursor(from < to ? to - 1 : to, from < to ? 1 : -1);
  if (!start || !end) throw Error("InvalidInvariant: cursor unavailable");
  return { start: Array.from(start.encode()), end: Array.from(end.encode()) };
}
export function interval(doc: LoroDoc, a: { start: number[]; end: number[] }) {
  const pos = (bytes: number[]) => {
    const p = doc.getCursorPos(Cursor.decode(Uint8Array.from(bytes)));
    if (!p) throw Error("InvalidInvariant: unresolved cursor");
    return p.offset + (p.side === 1 ? 1 : 0);
  };
  return { from: pos(a.start), to: pos(a.end) };
}
