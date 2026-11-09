import { Annotation, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { frontmatterBlock, frontmatterProblem } from "@composedink/core";
/**
 * The settings block folds to one marker reading "settings": the caret skips it, typing cannot land
 * inside it, and a click unfolds it for direct editing. It folds again when the caret leaves a block
 * that parses. Edits from the settings strip carry `settingsEdit` and always pass.
 */
export const settingsEdit = Annotation.define<boolean>();
export const setFolded = StateEffect.define<boolean>();
/** The folded span: the block without its final newline, so the body keeps its own line. */
function span(state: EditorState) {
  const text = state.doc.toString();
  const block = frontmatterBlock(text);
  if (!block) return undefined;
  return { from: 0, to: text[block.to - 1] === "\n" ? block.to - 1 : block.to, block };
}
class Marker extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-settings-fold";
    button.textContent = "settings";
    button.title = "The post's settings block. Click to show and edit it as text.";
    button.setAttribute("aria-label", "Show the settings block");
    // Out of the tab order: Tab from the text goes on to the alternative widget and the page.
    // From the keyboard, Enter on the marker's line unfolds it (and the settings strip edits it).
    button.tabIndex = -1;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      unfold(view);
    });
    button.addEventListener("click", (event) => event.preventDefault());
    return button;
  }
  ignoreEvent() {
    return true;
  }
}
const marker = Decoration.replace({ widget: new Marker() });
const line = Decoration.line({ class: "cm-frontmatter" });
interface Fold {
  folded: boolean;
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
}
function build(state: EditorState, folded: boolean): Fold {
  const s = span(state);
  if (!s) return { folded, decorations: Decoration.none, atomic: RangeSet.empty };
  if (folded) {
    const set = Decoration.set([marker.range(s.from, s.to)]);
    return { folded, decorations: set, atomic: set };
  }
  const lines = [];
  for (let pos = 0; pos <= s.to;) {
    const l = state.doc.lineAt(pos);
    lines.push(line.range(l.from));
    pos = l.to + 1;
  }
  return { folded, decorations: Decoration.set(lines), atomic: RangeSet.empty };
}
const fold = StateField.define<Fold>({
  create: (state) => build(state, true),
  update(value, tr) {
    let folded = value.folded;
    for (const e of tr.effects) if (e.is(setFolded)) folded = e.value;
    if (!folded && tr.selection && !tr.effects.some((e) => e.is(setFolded))) {
      // Leaving the block folds it again, unless it does not parse (the notice offers Unfold).
      const before = span(tr.startState);
      const after = span(tr.state);
      const was = tr.startState.selection.main.head;
      const now = tr.state.selection.main.head;
      if (before && after && was <= before.to && now > after.to && parses(tr.state)) folded = true;
    }
    return tr.docChanged || folded !== value.folded ? build(tr.state, folded) : value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
  ],
});
const parses = (state: EditorState) => !frontmatterProblem(state.doc.toString());
/**
 * Typing, pasting, dropping and deleting never change a folded block, unless they replace all of it
 * (select all, then type). CodeMirror reads input as a minimal DOM diff, labels plain Backspace as
 * typed input, and under scripted input the select-all can reach the diff before the selection
 * does. So the change itself decides: a deletion that contains the whole closing fence can only
 * come from a selection holding the block. Everything else that touches the block is refused.
 */
const guard = EditorState.changeFilter.of((tr) => {
  if (tr.annotation(settingsEdit) || !tr.startState.field(fold).folded) return true;
  if (!tr.isUserEvent("input") && !tr.isUserEvent("delete")) return true;
  const s = span(tr.startState);
  if (!s) return true;
  const { from, to } = tr.startState.selection.main;
  if (from === 0 && to >= s.to) return true;
  const fence = { from: s.block.close, to: s.block.close + 3 };
  let allowed = true;
  tr.changes.iterChangedRanges((a, b) => {
    const touches = (a < s.to + 1 && b > 0) || (a === 0 && b === 0);
    if (touches && !(a <= fence.from && b >= fence.to)) allowed = false;
  });
  return allowed;
});
/**
 * Backspace right after the folded block, or Delete right before or after it, does nothing; Enter
 * on the marker's line unfolds it.
 */
const keys = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      const s = view.state.field(fold).folded && span(view.state);
      const { empty, head } = view.state.selection.main;
      if (!s || !empty || (head !== 0 && head !== s.to)) return false;
      unfold(view);
      return true;
    },
  },
  {
    key: "Backspace",
    run: (view) => {
      const s = view.state.field(fold).folded && span(view.state);
      const { empty, head } = view.state.selection.main;
      return !!s && empty && head > 0 && head <= s.to + 1;
    },
  },
  {
    key: "Delete",
    run: (view) => {
      const s = view.state.field(fold).folded && span(view.state);
      const { empty, head } = view.state.selection.main;
      return !!s && empty && (head === 0 || head === s.to);
    },
  },
]);
export function unfold(view: EditorView) {
  const s = span(view.state);
  view.dispatch({
    effects: setFolded.of(false),
    // The caret goes to the end of the last setting, inside the block, so it stays open.
    selection: s ? { anchor: Math.max(s.block.yamlFrom, s.block.close - 1) } : undefined,
    scrollIntoView: true,
  });
  view.focus();
}
export const isFolded = (view: EditorView) => view.state.field(fold).folded;
export const frontmatterFold = [fold, guard, keys];
