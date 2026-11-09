import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import { LoroSyncPlugin } from "./sync";
import type { LoroDoc } from "loro-crdt";
/**
 * Prose, not code: headings carry weight and size, emphasis is italic, Markdown marks recede, and
 * only code is monospace. Colours come from the page's palette variables.
 */
const prose = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.45em", lineHeight: "1.3" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.25em", lineHeight: "1.35" },
  { tag: t.heading3, fontWeight: "650", fontSize: "1.1em" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "650" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--green-ink)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.82em" },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: "var(--muted)" },
  { tag: t.quote, color: "var(--muted)" },
  { tag: [t.angleBracket, t.tagName, t.attributeName], color: "var(--muted)" },
]);
const theme = EditorView.theme({
  "&": { color: "var(--ink)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { justifyContent: "center", fontFamily: "var(--prose)" },
  ".cm-content": {
    flex: "0 1 70ch",
    maxWidth: "70ch",
    minWidth: "0",
    padding: "0.5rem 0 30vh",
    fontFamily: "var(--prose)",
    fontSize: "19px",
    lineHeight: "1.65",
    caretColor: "var(--green-ink)",
    fontVariationSettings: '"opsz" 19',
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor, .cm-dropCursor": { borderLeft: "2px solid var(--green-ink)" },
  ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
    { backgroundColor: "var(--selection)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--muted)" },
});
export function sourceEditor(parent: HTMLElement, doc: LoroDoc, extensions: Extension[] = []) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: doc.getText("mdx").toString(),
      extensions: [
        markdown(),
        syntaxHighlighting(prose),
        theme,
        drawSelection(),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Post text", spellcheck: "true" }),
        LoroSyncPlugin(doc, (d) => d.getText("mdx")),
        ...extensions,
      ],
    }),
  });
}
