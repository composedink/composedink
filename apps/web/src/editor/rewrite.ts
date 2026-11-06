import { encodeFrontiers, type LoroDoc } from "loro-crdt";
import { keymap, type EditorView } from "@codemirror/view";
export function rewriteKeys(run: (view: EditorView) => void) {
  return keymap.of([
    {
      key: "Mod-Shift-r",
      run: (view) => {
        if (view.state.selection.main.empty) return false;
        run(view);
        return true;
      },
    },
  ]);
}

export function rewriteSelection(view: EditorView, doc: LoroDoc) {
  const { from, to } = view.state.selection.main;
  return {
    base: btoa(String.fromCharCode(...encodeFrontiers(doc.frontiers()))),
    view: "full" as const,
    from,
    to,
  };
}
