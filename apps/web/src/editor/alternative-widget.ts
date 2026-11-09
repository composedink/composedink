import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  showTooltip,
  type Tooltip,
  type TooltipView,
} from "@codemirror/view";
import type { Alt } from "./alternatives";
import { describe } from "../Notice";

export type AltAction = "next" | "prev" | "keep" | "ghost";
/** The newest alternatives from the authority (their ranges at that read). */
export const setAlternatives = StateEffect.define<readonly Alt[]>();
const setHover = StateEffect.define<string | null>();
interface Shown {
  alts: readonly Alt[];
  hover: string | null;
  /** One tooltip object per shown alternative, so focus survives flips inside the widget. */
  tooltip: Tooltip | null;
  id: string | null;
}
const range = Decoration.mark({ class: "cm-alt-range" });
const at = (alts: readonly Alt[], pos: number) => alts.find((a) => pos >= a.from && pos <= a.to);
function svg(path: string) {
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("width", "14");
  icon.setAttribute("height", "14");
  icon.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.75");
  p.setAttribute("stroke-linecap", "round");
  icon.append(p);
  return icon;
}
/**
 * The in-place alternative widget: above the range under the caret (or the pointer), it shows
 * `2 / 3`, previous and next, Keep, and a menu with Keep and ghost the rest. Tab from the editor
 * reaches it; Escape returns to the text. ⌥↑/⌥↓/⌘⏎ keep working in the text.
 */
export function alternativeWidget(run: (alt: string, action: AltAction) => Promise<unknown>) {
  let clearHover: ReturnType<typeof setTimeout> | undefined;
  const field: StateField<Shown> = StateField.define<Shown>({
    create: () => ({ alts: [], hover: null, tooltip: null, id: null }),
    update(value, tr) {
      let { alts, hover } = value;
      if (tr.docChanged)
        alts = alts.map((a) => ({
          ...a,
          from: tr.changes.mapPos(a.from, -1),
          to: tr.changes.mapPos(a.to, 1),
        }));
      for (const e of tr.effects) {
        if (e.is(setAlternatives)) alts = e.value;
        if (e.is(setHover)) hover = e.value;
      }
      const alt = at(alts, tr.state.selection.main.head) ?? alts.find((a) => a.id === hover);
      if (!alt) return { alts, hover, tooltip: null, id: null };
      const tooltip =
        value.id === alt.id && value.tooltip && value.tooltip.pos === alt.from
          ? value.tooltip
          : { pos: alt.from, above: true, strictSide: true, arrow: false, create: view(alt.id) };
      return { alts, hover, tooltip, id: alt.id };
    },
    provide: (f) => [
      showTooltip.from(f, (v) => v.tooltip),
      // The range the widget governs, washed lightly while the widget shows.
      EditorView.decorations.compute([f], (state) => {
        const v = state.field(f);
        const alt = v.alts.find((a) => a.id === v.id);
        return alt && alt.to > alt.from
          ? Decoration.set([range.range(alt.from, alt.to)])
          : Decoration.none;
      }),
    ],
  });
  const current = (state: EditorState, id: string) =>
    state.field(field).alts.find((a) => a.id === id);
  function view(id: string) {
    return (editor: EditorView): TooltipView => {
      const dom = document.createElement("div");
      dom.className = "alt-widget";
      dom.setAttribute("role", "toolbar");
      dom.dataset.alt = id;
      const count = document.createElement("span");
      count.className = "alt-count";
      const button = (label: string, title: string, content: string | SVGElement) => {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.title = title;
        b.append(content);
        return b;
      };
      const prev = button("Previous version", "Previous version (⌥↑)", svg("M4 10l4-4 4 4"));
      const next = button("Next version", "Next version (⌥↓)", svg("M4 6l4 4 4-4"));
      const keep = button("Keep", "Keep this version; the others go to the stash (⌘⏎)", "Keep");
      keep.className = "keep";
      const more = button("More choices", "More choices", svg("M3.5 8h.01M8 8h.01M12.5 8h.01"));
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
      const menu = document.createElement("div");
      menu.className = "alt-menu";
      menu.setAttribute("role", "menu");
      menu.hidden = true;
      const ghost = document.createElement("button");
      ghost.type = "button";
      ghost.setAttribute("role", "menuitem");
      ghost.textContent = "Keep and ghost the rest";
      ghost.title = "Keep this version and leave the others in the text, ghosted (⌘⇧⏎)";
      menu.append(ghost);
      // A failure shows here, beside the control that failed, in the page's notice style.
      const error = document.createElement("div");
      error.className = "notice alt-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
      dom.append(count, prev, next, keep, more, menu, error);
      const render = () => {
        const alt = current(editor.state, id);
        if (!alt) return;
        count.textContent = `${alt.active + 1} / ${alt.count}`;
        dom.setAttribute("aria-label", `Alternative: version ${alt.active + 1} of ${alt.count}`);
      };
      const toggleMenu = (open: boolean) => {
        menu.hidden = !open;
        more.setAttribute("aria-expanded", String(open));
        if (open) ghost.focus();
      };
      const act = (action: AltAction) => {
        error.hidden = true;
        toggleMenu(false);
        void run(id, action).then(
          () => {
            // A kept alternative leaves; the writer goes back to the text.
            if (action === "keep" || action === "ghost") editor.focus();
          },
          (e: unknown) => {
            const notice = describe(e);
            error.replaceChildren();
            for (const [text, className] of [
              [notice.title, "notice-title"],
              [notice.detail, "notice-detail"],
            ] as const)
              if (text) {
                const p = document.createElement("p");
                p.className = className;
                p.textContent = text;
                error.append(p);
              }
            if (notice.code) error.dataset.code = notice.code;
            error.hidden = false;
          },
        );
      };
      prev.addEventListener("click", () => act("prev"));
      next.addEventListener("click", () => act("next"));
      keep.addEventListener("click", () => act("keep"));
      ghost.addEventListener("click", () => act("ghost"));
      more.addEventListener("click", () => toggleMenu(menu.hidden === true));
      // Clicking the widget must not move the editor's caret out of the range.
      dom.addEventListener("mousedown", (e) => {
        if (!(e.target as HTMLElement).closest("button")) e.preventDefault();
      });
      dom.addEventListener("mouseenter", () => clearTimeout(clearHover));
      dom.addEventListener("mouseleave", () => schedule(editor));
      dom.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        if (!menu.hidden) {
          toggleMenu(false);
          more.focus();
        } else editor.focus();
      });
      render();
      return { dom, update: render };
    };
  }
  const schedule = (editor: EditorView) => {
    clearTimeout(clearHover);
    clearHover = setTimeout(() => {
      if (editor.state.field(field).hover !== null) editor.dispatch({ effects: setHover.of(null) });
    }, 500);
  };
  const pointer = EditorView.domEventHandlers({
    mousemove(event, editor) {
      const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
      const alt = pos === null ? undefined : at(editor.state.field(field).alts, pos);
      if (alt) {
        clearTimeout(clearHover);
        if (editor.state.field(field).hover !== alt.id)
          editor.dispatch({ effects: setHover.of(alt.id) });
      } else if (editor.state.field(field).hover !== null) schedule(editor);
      return false;
    },
    mouseleave(_event, editor) {
      if (editor.state.field(field).hover !== null) schedule(editor);
      return false;
    },
  });
  return [field, pointer];
}
