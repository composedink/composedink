import { useState, type ReactNode } from "react";
import type { Diagnostic } from "@composedink/lint";

/** What each rule is about, in the writer's words; the instance message says the specific. */
const RULES: Record<string, string> = {
  "paragraph.length": "Long paragraphs",
  budget: "Over the word budget",
  preamble: "Preamble before the ask",
  filler: "Hedges and intensifiers",
  "sentence.length": "Long sentences",
  "bullets.long": "Long list items",
  "bold.inline": "Bold mid-sentence",
  visuals: "Sections without a visual",
  rhythm: "Same-length sentences",
  "style:passive": "Passive voice",
  "style:adverb": "Adverbs",
  "style:simpler": "Simpler words",
  "block:props": "Component settings",
};
const SEVERITY: Record<Diagnostic["severity"], string> = {
  error: "Error",
  warn: "Note",
  soft: "Quiet",
};
const RANK: Record<Diagnostic["severity"], number> = { error: 0, warn: 1, soft: 2 };
export function ruleLabel(code: string, first?: Diagnostic) {
  if (RULES[code]) return RULES[code];
  if (code.startsWith("harper:")) {
    const kind = code.slice("harper:".length);
    if (kind === "Miscellaneous") return "Grammar";
    const words = kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return words[0].toUpperCase() + words.slice(1);
  }
  return first?.message ?? code;
}
interface Group {
  code: string;
  severity: Diagnostic["severity"];
  items: Diagnostic[];
}
/** One group per rule, strongest severity first, then by first position in the text. */
export function groupDiagnostics(diagnostics: readonly Diagnostic[]): Group[] {
  const groups = new Map<string, Group>();
  for (const d of diagnostics) {
    const group = groups.get(d.code) ?? { code: d.code, severity: d.severity, items: [] };
    group.items.push(d);
    if (RANK[d.severity] < RANK[group.severity]) group.severity = d.severity;
    groups.set(d.code, group);
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.from - b.from || a.to - b.to);
  return [...groups.values()].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.items[0].from - b.items[0].from,
  );
}
const quote = (text: string, d: Diagnostic) => {
  const raw = text.slice(d.from, d.to).replace(/\s+/g, " ").trim();
  return raw.length > 64 ? raw.slice(0, 61).trimEnd() + "…" : raw;
};
/**
 * Writing feedback grouped by rule: one row per rule with its name, a count and Dismiss all; a row
 * opens to its instances, and an instance jumps to its text.
 */
export function FeedbackList({
  diagnostics,
  text,
  checking,
  notices,
  onJump,
  onDismiss,
  onPropose,
}: {
  diagnostics: readonly Diagnostic[];
  text: string;
  /** No lint result yet for this draft: say so instead of claiming there is nothing to note. */
  checking: boolean;
  notices?: ReactNode;
  onJump: (d: Diagnostic) => void;
  onDismiss: (items: Diagnostic[]) => void;
  onPropose: (d: Diagnostic) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groups = groupDiagnostics(diagnostics);
  const toggle = (code: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  return (
    <section className="feedback-list" aria-label="Writing feedback">
      <p className="sr-only" aria-live="polite">
        {groups.length
          ? `${diagnostics.length} notes in ${groups.length} ${groups.length === 1 ? "rule" : "rules"}`
          : "No notes"}
      </p>
      {notices}
      {groups.length === 0 && !notices && (
        <p className="muted empty-note">
          {checking ? "Reading the draft…" : "Nothing to note in this draft."}
        </p>
      )}
      {groups.map((g) => {
        const expanded = open.has(g.code);
        const label = ruleLabel(g.code, g.items[0]);
        return (
          <article
            className="rule-group"
            key={g.code}
            data-rule={g.code}
            data-severity={g.severity}
          >
            <div className="rule-row">
              <button
                type="button"
                className="rule-toggle"
                aria-expanded={expanded}
                aria-controls={`rule-${g.code}`}
                onClick={() => toggle(g.code)}
              >
                <span className="severity">{SEVERITY[g.severity]}</span>
                <span className="rule-name">{label}</span>
                <span className="rule-count">{g.items.length}</span>
              </button>
              <button
                type="button"
                className="quiet dismiss-all"
                aria-label={`Dismiss all: ${label}`}
                onClick={() => onDismiss(g.items)}
              >
                Dismiss all
              </button>
            </div>
            <ol className="instances" id={`rule-${g.code}`} hidden={!expanded}>
              {g.items.map((d, i) => (
                <li
                  className="diagnostic"
                  key={`${d.from}:${d.to}:${i}`}
                  data-code={d.code}
                  data-severity={d.severity}
                  data-from={d.from}
                  data-to={d.to}
                >
                  <button type="button" className="instance" onClick={() => onJump(d)}>
                    {quote(text, d) && <q>{quote(text, d)}</q>}
                    <span className="message">{d.message}</span>
                  </button>
                  <span className="instance-actions">
                    {d.replacement !== undefined && (
                      <button type="button" onClick={() => onPropose(d)}>
                        Propose “{d.replacement}”
                      </button>
                    )}
                    <button type="button" className="quiet" onClick={() => onDismiss([d])}>
                      Dismiss
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </article>
        );
      })}
    </section>
  );
}
