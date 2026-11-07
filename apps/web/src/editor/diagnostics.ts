import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { Diagnostic } from "@composedink/lint";
export const setDiagnostics = StateEffect.define<readonly Diagnostic[]>();
const inRange = (d: Diagnostic, length: number) => d.from < d.to && d.from >= 0 && d.to <= length;
/** Underlines for error and warn diagnostics; soft ones never underline. */
export const diagnosticMarks = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const effect of tr.effects)
      if (effect.is(setDiagnostics))
        value = Decoration.set(
          effect.value
            .filter((d) => d.severity !== "soft" && inRange(d, tr.newDoc.length))
            .map((d) =>
              Decoration.mark({
                class: "cm-lint",
                attributes: {
                  title: d.message,
                  "data-code": d.code,
                  "data-severity": d.severity,
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
class SoftMarker extends GutterMarker {
  constructor(readonly messages: string) {
    super();
  }
  eq(other: SoftMarker) {
    return other.messages === this.messages;
  }
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-soft-marker";
    marker.title = this.messages;
    marker.textContent = "◦";
    return marker;
  }
}
/** Soft diagnostics (budget, rhythm, soft custom rules) appear only as gutter notes. */
const softNotes = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    if (tr.docChanged) value = RangeSet.empty;
    for (const effect of tr.effects)
      if (effect.is(setDiagnostics)) {
        const lines = new Map<number, string[]>();
        for (const d of effect.value)
          if (d.severity === "soft" && inRange(d, tr.newDoc.length)) {
            const from = tr.newDoc.lineAt(d.from).from;
            lines.set(from, [...(lines.get(from) ?? []), d.message]);
          }
        value = RangeSet.of(
          [...lines]
            .sort(([a], [b]) => a - b)
            .map(([from, messages]) => new SoftMarker(messages.join("\n")).range(from)),
        );
      }
    return value;
  },
});
export const diagnosticGutter = [
  softNotes,
  gutter({ class: "cm-soft-gutter", markers: (view) => view.state.field(softNotes) }),
];
export const diagnosticKey = (d: Diagnostic) => JSON.stringify(d);
