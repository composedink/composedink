import { keymap, type EditorView } from "@codemirror/view";
export type Alt = { id: string; from: number; to: number; active: number; count: number };
export function alternativeKeys(
  current: () => Alt[],
  run: (id: string, action: "next" | "prev" | "keep" | "ghost") => void,
) {
  const invoke = (view: EditorView, action: "next" | "prev" | "keep" | "ghost") => {
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
    { key: "Mod-Shift-Enter", run: (v) => invoke(v, "ghost") },
  ]);
}

import { gutter, GutterMarker } from "@codemirror/view";
import { setAlternatives } from "./alternative-widget";
class Dot extends GutterMarker {
  toDOM() {
    const dot = document.createElement("span");
    dot.className = "cm-alt-dot";
    dot.title = "Alternative versions here: ⌥↑ / ⌥↓ to flip, ⌘⏎ to keep";
    return dot;
  }
}
const dot = new Dot();
export function alternativeGutter(current: () => Alt[]) {
  return gutter({
    class: "cm-alternatives",
    // Proposals arrive without a text change: redraw when the alternatives themselves change.
    lineMarkerChange: (update) =>
      update.transactions.some((tr) => tr.effects.some((e) => e.is(setAlternatives))),
    lineMarker: (_view, line) =>
      current().some((a) => a.from >= line.from && a.from <= line.to) ? dot : null,
  });
}
