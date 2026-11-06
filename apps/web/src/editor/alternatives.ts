import { keymap, type EditorView } from "@codemirror/view";
export type Alt = { id: string; from: number; to: number; active: number; count: number };
export function alternativeKeys(
  current: () => Alt[],
  run: (id: string, action: "next" | "prev" | "keep") => void,
) {
  const invoke = (view: EditorView, action: "next" | "prev" | "keep") => {
    const p = view.state.selection.main.head;
    const alt = current().find((a) => p >= a.from && p <= a.to);
    if (!alt) return false;
    run(alt.id, action);
    return true;
  };
  return keymap.of([
    { key: "Alt-ArrowUp", run: (v) => invoke(v, "prev") },
    { key: "Alt-ArrowDown", run: (v) => invoke(v, "next") },
    { key: "Mod-Enter", run: (v) => invoke(v, "keep") },
  ]);
}

import { gutter, GutterMarker } from "@codemirror/view";
class Dot extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.textContent = "●";
    dot.title = "Alternative — Alt ↑ / ↓, Mod Enter to keep";
    return dot;
  }
}
const dot = new Dot();
export function alternativeGutter(current: () => Alt[]) {
  return gutter({
    class: "cm-alternatives",
    lineMarker: (_view, line) =>
      current().some((a) => a.from >= line.from && a.from <= line.to) ? dot : null,
  });
}
