import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { Diagnostic } from "@composedink/lint";
export const setDiagnostics = StateEffect.define<readonly Diagnostic[]>();
const inRange = (d: Diagnostic, length: number) => d.from < d.to && d.from >= 0 && d.to <= length;
const RANK = { error: 0, warn: 1, soft: 2 } as const;
/**
 * Underlines for error and warn diagnostics; soft ones never underline. Diagnostics on one range
 * draw one underline in the stronger severity, with every message in its title and every code in
 * `data-code` (space-separated).
 */
export function underlines(diagnostics: readonly Diagnostic[], length: number) {
  const ranges = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    if (d.severity === "soft" || !inRange(d, length)) continue;
    const key = `${d.from}:${d.to}`;
    ranges.set(key, [...(ranges.get(key) ?? []), d]);
  }
  return [...ranges.values()].map((same) => {
    const strongest = same.reduce((a, b) => (RANK[b.severity] < RANK[a.severity] ? b : a));
    return {
      from: strongest.from,
      to: strongest.to,
      severity: strongest.severity,
      codes: [...new Set(same.map((d) => d.code))],
      messages: [...new Set(same.map((d) => d.message))],
    };
  });
}
export const diagnosticMarks = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const effect of tr.effects)
      if (effect.is(setDiagnostics))
        value = Decoration.set(
          underlines(effect.value, tr.newDoc.length).map((u) =>
            Decoration.mark({
              class: `cm-lint cm-lint-${u.severity}`,
              attributes: {
                title: u.messages.join("\n"),
                "data-code": u.codes.join(" "),
                "data-severity": u.severity,
                "data-from": String(u.from),
                "data-to": String(u.to),
              },
            }).range(u.from, u.to),
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
    marker.setAttribute("aria-label", this.messages);
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
