import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { Cursor, LoroMap, type LoroDoc } from "loro-crdt";

export type Author =
  | { kind: "human" }
  | { kind: "agent"; name: string }
  | { kind: "model"; model: string }
  | { kind: "guest"; name: string; linkId: string };
export type Thread = {
  thread: string;
  /** Newest local anchor positions; null when detached (stored, or locally collapsed). */
  from: number | null;
  to: number | null;
  question?: string;
  state: "open" | "resolved" | "detached";
  messages: { by: Author; at: number; text: string }[];
};
export type Answer = {
  question: string;
  text: string;
  threads: string[];
  alternatives: string[];
  detached: string[];
};
export type FeedbackRequest = {
  request: string;
  at: number;
  /** `"model"` and `"link:<linkId>"` recipients; link requests stay pending for guests. */
  to: string[];
  questions: { id: string; text: string }[];
  state:
    | { status: "pending" }
    | { status: "answered"; answers: Answer[] }
    | { status: "failed"; message: string };
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
/** Resolves a stored cursor on this replica, so anchors follow typing before it is acknowledged. */
function position(doc: LoroDoc, bytes: unknown, end: boolean) {
  if (!Array.isArray(bytes)) return null;
  try {
    const p = doc.getCursorPos(Cursor.decode(Uint8Array.from(bytes)));
    if (!p) return null;
    const text = doc.getText("mdx").toString();
    return (
      p.offset +
      (end && p.side === 1 ? String.fromCodePoint(text.codePointAt(p.offset) ?? 0).length : 0)
    );
  } catch {
    return null;
  }
}
/** Threads read from the replicated `threads` container; no extra syncing listener. */
export function readThreads(doc: LoroDoc): Thread[] {
  const threads: Thread[] = [];
  for (const [thread, value] of doc.getMap("threads").entries()) {
    const t = value instanceof LoroMap ? value.toJSON() : value;
    if (!record(t) || !Array.isArray(t.messages)) continue;
    const stored = t.state === "resolved" || t.state === "detached" ? t.state : "open";
    const from = stored === "detached" ? null : position(doc, t.start, false);
    const to = stored === "detached" ? null : position(doc, t.end, true);
    const live = from !== null && to !== null && to > from;
    threads.push({
      thread,
      from: live ? from : null,
      to: live ? to : null,
      ...(typeof t.question === "string" ? { question: t.question } : {}),
      state: live ? stored : "detached",
      messages: t.messages.filter(
        (m): m is Thread["messages"][number] =>
          record(m) && typeof m.text === "string" && typeof m.at === "number" && record(m.by),
      ),
    });
  }
  return threads.sort(
    (a, b) =>
      (a.from ?? Infinity) - (b.from ?? Infinity) ||
      (a.to ?? Infinity) - (b.to ?? Infinity) ||
      a.thread.localeCompare(b.thread),
  );
}
export function readRequests(doc: LoroDoc): FeedbackRequest[] {
  return Object.entries(doc.getMap("requests").toJSON())
    .filter(([, r]) => record(r) && Array.isArray(r.questions) && record(r.state))
    .map(([request, r]) => ({ request, ...(r as Omit<FeedbackRequest, "request">) }))
    .sort((a, b) => b.at - a.at);
}
export const authorName = (by: Author) =>
  by.kind === "human"
    ? "You"
    : by.kind === "guest"
      ? by.name
      : by.kind === "model"
        ? by.model
        : by.name === "model"
          ? "Model"
          : `Agent (${by.name})`;
/** A guest's provenance next to their name: `guest · link <first 6 chars of linkId>`. */
export const authorTag = (by: Author) =>
  by.kind === "guest" ? `guest · link ${by.linkId.slice(0, 6)}` : undefined;
/**
 * Collision stacking: cards keep document order and sit at their anchor unless the card above
 * would overlap, in which case they move just below it.
 */
export function stack(items: { id: string; anchor: number; height: number }[], gap = 8) {
  const tops = new Map<string, number>();
  let floor = -Infinity;
  for (const item of items) {
    const top = Math.max(item.anchor, floor);
    tops.set(item.id, top);
    floor = top + item.height + gap;
  }
  return tops;
}
/** Viewport-relative top of a document position, also for lines outside the rendered viewport. */
export function anchorTop(view: EditorView, pos: number) {
  const at = Math.min(pos, view.state.doc.length);
  return view.coordsAtPos(at, 1)?.top ?? view.documentTop + view.lineBlockAt(at).top;
}
/** Highlights shown threads' ranges; detached threads have none. */
export function threadHighlights(current: () => { shown: Thread[]; active: string | null }) {
  const build = (view: EditorView) => {
    const builder = new RangeSetBuilder<Decoration>();
    const { shown, active } = current();
    const length = view.state.doc.length;
    for (const t of [...shown].sort((a, b) => (a.from ?? 0) - (b.from ?? 0))) {
      if (t.from === null || t.to === null || t.to > length) continue;
      builder.add(
        t.from,
        t.to,
        Decoration.mark({
          class: t.thread === active ? "cm-thread cm-thread-active" : "cm-thread",
          attributes: { "data-thread": t.thread },
        }),
      );
    }
    return builder.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        this.decorations = build(update.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
