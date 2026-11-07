import { encodeFrontiers, type LoroDoc } from "loro-crdt";
import type { EditorView } from "@codemirror/view";
import type { EditorTransport } from "./transport";
/** The selection against this replica's current frontiers, captured before any flush. */
export function selectionNow(view: EditorView, doc: LoroDoc) {
  const { from, to } = view.state.selection.main;
  return {
    base: btoa(String.fromCharCode(...encodeFrontiers(doc.frontiers())))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
    view: "full" as const,
    from,
    to,
  };
}
export async function selection(view: EditorView, transport: EditorTransport) {
  await transport.flush();
  return selectionNow(view, transport.doc);
}
