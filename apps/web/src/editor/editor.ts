import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { LoroSyncPlugin } from "./sync";
import type { LoroDoc } from "loro-crdt";
export function sourceEditor(parent: HTMLElement, doc: LoroDoc, extensions: Extension[] = []) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: doc.getText("mdx").toString(),
      extensions: [
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        EditorView.lineWrapping,
        LoroSyncPlugin(doc, (d) => d.getText("mdx")),
        ...extensions,
      ],
    }),
  });
}
