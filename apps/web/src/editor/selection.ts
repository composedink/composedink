import { encodeFrontiers } from "loro-crdt";
import type { EditorView } from "@codemirror/view";
import type { EditorTransport } from "./transport";
export async function selection(view: EditorView, transport: EditorTransport) {
  await transport.flush();
  const { from, to } = view.state.selection.main;
  return {
    base: btoa(String.fromCharCode(...encodeFrontiers(transport.doc.frontiers())))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
    view: "full" as const,
    from,
    to,
  };
}
