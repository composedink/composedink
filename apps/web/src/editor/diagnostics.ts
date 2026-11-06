import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { Diagnostic } from "@composedink/lint";
export const setDiagnostics = StateEffect.define<readonly Diagnostic[]>();
export const diagnosticMarks = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const effect of tr.effects)
      if (effect.is(setDiagnostics))
        value = Decoration.set(
          effect.value
            .filter((d) => d.from < d.to && d.from >= 0 && d.to <= tr.newDoc.length)
            .map((d) =>
              Decoration.mark({
                class: "cm-lint",
                attributes: {
                  title: d.message,
                  "data-code": d.code,
                  "data-from": String(d.from),
                  "data-to": String(d.to),
                },
              }).range(d.from, d.to),
            ),
          true,
        );
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
export const diagnosticKey = (d: Diagnostic) => JSON.stringify(d);
