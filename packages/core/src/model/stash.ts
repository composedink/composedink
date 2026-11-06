import { type LoroDoc } from "loro-crdt";
import { z } from "zod";
import { authorSchema } from "./selection.ts";
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
  reason: "alt" | "detached",
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
    if (part.attributes?.dim && end > from && offset < to)
      dim.push([Math.max(offset, from) - from, Math.min(end, to) - from]);
    offset = end;
  }
  return { text: doc.getText("mdx").toString().slice(from, to), dim };
}
