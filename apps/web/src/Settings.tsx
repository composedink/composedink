import { useState, type KeyboardEvent } from "react";
import { frontmatterValues } from "@composedink/core";
import { kindName } from "./NewPost";

export type Field = "title" | "reader" | "medium" | "budget";
/** The kind's split of reading fields between the settings block and document meta. */
export interface KindFields {
  kind: string;
  frontmatter: readonly string[];
  meta: readonly string[];
}
const MEDIA = [
  ["phone", "Phone"],
  ["screen", "Screen"],
  ["web", "Web"],
] as const;
/**
 * The post's settings, read from the live document. `show: "title"` is the title alone, drawn as
 * the post's heading at the top of the writing area; `show: "reading"` is the kind's reading fields
 * (reader, medium, budget) for the aids column. Editing a field types into the settings block
 * through the editor (undoable with ⌘Z); a field the kind keeps in document meta is read-only,
 * because no operation writes meta yet.
 */
export function SettingsStrip({
  show,
  text,
  kind,
  meta,
  defaults,
  blocked,
  onEdit,
  onUndo,
}: {
  show: "title" | "reading";
  text: string;
  kind?: KindFields;
  meta: Record<string, unknown>;
  defaults: Partial<Record<Field, string | number>>;
  /** Why fields cannot be written now (a malformed block), or undefined. */
  blocked?: string;
  onEdit: (field: Field, value: string | number) => void;
  onUndo: (redo: boolean) => void;
}) {
  const values = frontmatterValues(text);
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const inMeta = (f: Field) => f !== "title" && !!kind?.meta.includes(f);
  const shown = (f: Field) => {
    const v = inMeta(f) ? meta[f] : values[f];
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  };
  const metaReason = (f: Field) =>
    `The ${kindName(kind?.kind ?? "post")} kind keeps ${f} out of the exported file, so it is stored with the document. Nothing edits it here yet; change the kind's defaults with composed kind write.`;
  const undoKeys = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      onUndo(event.shiftKey);
      setDraft({});
    }
  };
  const bind = (f: Field) => ({
    value: draft[f] ?? shown(f),
    disabled: !!blocked && !inMeta(f),
    readOnly: inMeta(f),
    title: inMeta(f) ? metaReason(f) : blocked,
    onFocus: () => setDraft((d) => ({ ...d, [f]: shown(f) })),
    onBlur: () =>
      setDraft((d) => {
        const { [f]: _, ...rest } = d;
        return rest;
      }),
    onKeyDown: undoKeys,
  });
  if (show === "title")
    return (
      <div className="post-title">
        <textarea
          {...bind("title")}
          aria-label="Title"
          rows={1}
          placeholder="Untitled"
          spellCheck={false}
          onKeyDown={(event) => {
            // One line: Enter moves on to the text instead of breaking the title.
            if (event.key === "Enter") {
              event.preventDefault();
              (document.querySelector(".cm-content") as HTMLElement | null)?.focus();
              return;
            }
            undoKeys(event);
          }}
          onChange={(e) => {
            const value = e.target.value.replace(/[\r\n]+/g, " ");
            setDraft((d) => ({ ...d, title: value }));
            onEdit("title", value);
          }}
        />
      </div>
    );
  return (
    <section className="settings-strip" aria-label="Post settings">
      <label className="setting setting-reader">
        <span>Reader</span>
        <input
          {...bind("reader")}
          placeholder={String(defaults.reader ?? "who is this for?")}
          onChange={(e) => {
            setDraft((d) => ({ ...d, reader: e.target.value }));
            if (e.target.value.trim()) onEdit("reader", e.target.value);
          }}
        />
      </label>
      <label className="setting setting-medium">
        <span>Medium</span>
        {inMeta("medium") ? (
          <input {...bind("medium")} />
        ) : (
          <select
            value={shown("medium") || String(defaults.medium ?? "")}
            disabled={!!blocked}
            title={blocked}
            onKeyDown={undoKeys}
            onChange={(e) => onEdit("medium", e.target.value)}
          >
            {!shown("medium") && !defaults.medium && <option value="">Choose</option>}
            {MEDIA.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="setting setting-budget">
        <span>Budget</span>
        <input
          {...bind("budget")}
          type="number"
          inputMode="numeric"
          min={1}
          step={50}
          placeholder={String(defaults.budget ?? "")}
          aria-describedby="budget-unit"
          onChange={(e) => {
            setDraft((d) => ({ ...d, budget: e.target.value }));
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n > 0) onEdit("budget", n);
          }}
        />
        <span className="unit" id="budget-unit">
          words
        </span>
      </label>
    </section>
  );
}
