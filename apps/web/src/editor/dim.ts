import { Decoration, EditorView, keymap, ViewPlugin } from "@codemirror/view";
import type { LoroDoc } from "loro-crdt";
export function dimControls(doc: LoroDoc, toggle: (view: EditorView) => void) {
  return [
    keymap.of([
      {
        key: "Mod-.",
        run: (view) => {
          toggle(view);
          return true;
        },
      },
    ]),
    ViewPlugin.define(
      () => ({
        decorations: build(),
        update() {
          this.decorations = build();
        },
      }),
      { decorations: (v) => v.decorations },
    ),
  ];
  function build() {
    let offset = 0;
    const ranges = [];
    for (const part of doc.getText("mdx").toDelta()) {
      const end = offset + (part.insert?.length ?? 0);
      if (part.attributes?.dim && end > offset)
        ranges.push(Decoration.mark({ class: "cm-dim" }).range(offset, end));
      offset = end;
    }
    return Decoration.set(ranges);
  }
}
