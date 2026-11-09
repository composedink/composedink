import { useState, type KeyboardEvent } from "react";
import { frontmatterValues } from "@composedink/core";

export type Field = "title" | "reader" | "medium" | "budget";
/**
 * The title, drawn as the post's heading at the top of the writing area. Typing into it writes the
 * settings block's `title` through the editor (undoable with ⌘Z). The kind's reading fields live in
 * the folded settings block itself; unfold it to edit them.
 */
export function TitleField({
  text,
  blocked,
  onEdit,
  onUndo,
}: {
  text: string;
  /** Why the title cannot be written now (a malformed block), or undefined. */
  blocked?: string;
  onEdit: (field: Field, value: string | number) => void;
  onUndo: (redo: boolean) => void;
}) {
  const stored = frontmatterValues(text).title;
  const shown = typeof stored === "string" || typeof stored === "number" ? String(stored) : "";
  const [draft, setDraft] = useState<string>();
  return (
    <div className="post-title">
      <textarea
        aria-label="Title"
        rows={1}
        placeholder="Untitled"
        spellCheck={false}
        value={draft ?? shown}
        disabled={!!blocked}
        title={blocked}
        onFocus={() => setDraft(shown)}
        onBlur={() => setDraft(undefined)}
        onKeyDown={(event: KeyboardEvent) => {
          // One line: Enter moves on to the text instead of breaking the title.
          if (event.key === "Enter") {
            event.preventDefault();
            (document.querySelector(".cm-content") as HTMLElement | null)?.focus();
            return;
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            onUndo(event.shiftKey);
            setDraft(undefined);
          }
        }}
        onChange={(e) => {
          const value = e.target.value.replace(/[\r\n]+/g, " ");
          setDraft(value);
          onEdit("title", value);
        }}
      />
    </div>
  );
}
