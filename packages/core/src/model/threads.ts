import { LoroMap, LoroMovableList, type LoroDoc } from "loro-crdt";
import { z } from "zod";
import { KEYS } from "./keys.ts";
import { anchors, authorSchema, interval, select, type selectionSchema } from "./selection.ts";

/** Guests are a data variant for P2 shared links; no adapter grants a guest write today. */
export const threadAuthorSchema = z.discriminatedUnion("kind", [
  ...authorSchema.options,
  z.object({ kind: z.literal("guest"), name: z.string().min(1), linkId: z.string().min(1) }),
]);
export type ThreadAuthor = z.infer<typeof threadAuthorSchema>;
export const threadState = z.enum(["open", "resolved", "detached"]);
export type ThreadState = z.infer<typeof threadState>;
const messageSchema = z.object({ by: threadAuthorSchema, at: z.number(), text: z.string() });
export type ThreadMessage = z.infer<typeof messageSchema>;
const storedSchema = z.object({
  start: z.array(z.number()),
  end: z.array(z.number()),
  question: z.string().optional(),
  state: threadState,
  messages: z.array(messageSchema),
});
export interface ThreadView {
  thread: string;
  /** Live source offsets (full view); null once detached. */
  from: number | null;
  to: number | null;
  question?: string;
  state: ThreadState;
  messages: ThreadMessage[];
}
const threadMap = (doc: LoroDoc, id: string) => {
  const value = doc.getMap(KEYS.threads).get(id);
  if (!(value instanceof LoroMap)) throw Error(`UnknownThread: ${id}`);
  return value;
};
/** The live interval, or null when it is empty, reversed or unresolvable. */
function live(doc: LoroDoc, a: { start: number[]; end: number[] }) {
  try {
    const r = interval(doc, a);
    return r.to > r.from ? r : null;
  } catch {
    return null;
  }
}
/**
 * Opens a thread on a unique quote of a retained base. Cursors sit on the quote's first and
 * last characters (sides Left/Right), so edge typing stays outside; they resolve in current
 * history, and a quote deleted since the base opens detached rather than relocating.
 */
export function openThread(
  doc: LoroDoc,
  at: z.input<typeof selectionSchema>,
  first: { text: string; by: ThreadAuthor; question?: string; at?: number },
  id: string = crypto.randomUUID(),
) {
  if (!("quote" in at) || !at.quote) throw Error("InvalidInvariant: a thread needs a quote");
  const { fork, from, to } = select(doc, { view: "full", ...at });
  const cursors = anchors(fork, from, to);
  if (doc.getMap(KEYS.threads).get(id) !== undefined)
    throw Error(`InvalidInvariant: duplicate thread ${id}`);
  const thread = doc.getMap(KEYS.threads).setContainer(id, new LoroMap());
  thread.set("start", cursors.start);
  thread.set("end", cursors.end);
  if (first.question !== undefined) thread.set("question", first.question);
  thread.set("state", live(doc, cursors) ? "open" : "detached");
  thread
    .setContainer("messages", new LoroMovableList())
    .push({ by: first.by, at: first.at ?? Date.now(), text: first.text });
  doc.commit();
  return id;
}
/** Appends to the nested MovableList so replies from several devices merge; state is unchanged. */
export function replyThread(doc: LoroDoc, id: string, message: { by: ThreadAuthor; text: string }) {
  const thread = threadMap(doc, id);
  const messages = thread.get("messages");
  if (!(messages instanceof LoroMovableList))
    throw Error(`InvalidInvariant: thread ${id} has no messages`);
  messages.push({ by: message.by, at: Date.now(), text: message.text });
  doc.commit();
  return threadState.parse(thread.get("state"));
}
/** A state change, never deletion. Detachment is terminal, so a detached thread stays detached. */
export function resolveThread(doc: LoroDoc, id: string) {
  const thread = threadMap(doc, id);
  const state = threadState.parse(thread.get("state"));
  if (state === "detached")
    throw Error(`InvalidInvariant: thread ${id} is detached; detachment is terminal`);
  if (state !== "resolved") {
    thread.set("state", "resolved");
    doc.commit();
  }
  return "resolved" as const;
}
export function threadViews(doc: LoroDoc, state?: ThreadState): ThreadView[] {
  const views = doc
    .getMap(KEYS.threads)
    .entries()
    .map(([thread, value]): ThreadView => {
      const t = storedSchema.parse(value instanceof LoroMap ? value.toJSON() : value);
      const r = t.state === "detached" ? null : live(doc, t);
      return {
        thread,
        from: r?.from ?? null,
        to: r?.to ?? null,
        ...(t.question !== undefined ? { question: t.question } : {}),
        state: t.state,
        messages: t.messages,
      };
    })
    .filter((t) => !state || t.state === state);
  return views.sort(
    (a, b) =>
      (a.from ?? Infinity) - (b.from ?? Infinity) ||
      (a.to ?? Infinity) - (b.to ?? Infinity) ||
      a.thread.localeCompare(b.thread),
  );
}
/**
 * Authority normalization: an open or resolved thread whose anchors resolve to an empty or
 * reversed interval becomes detached, keeping its question and messages. Never relocates.
 */
export function normalizeThreads(doc: LoroDoc) {
  let changed = false;
  for (const [, value] of doc.getMap(KEYS.threads).entries()) {
    if (!(value instanceof LoroMap)) continue;
    const start = value.get("start"),
      end = value.get("end");
    if (value.get("state") === "detached") continue;
    if (Array.isArray(start) && Array.isArray(end) && live(doc, { start, end })) continue;
    value.set("state", "detached");
    changed = true;
  }
  if (changed) doc.commit();
}
