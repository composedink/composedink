import { useEffect, useRef, useState } from "react";
const KEYS: [keys: string[], action: string][] = [
  [["⌘", "."], "Ghost the selection (dim it; clean exports leave it out)"],
  [["⌥", "↑"], "Previous version of the alternative under the caret"],
  [["⌥", "↓"], "Next version of the alternative under the caret"],
  [["⌘", "⏎"], "Keep this version; the others go to the stash"],
  [["⌘", "⇧", "⏎"], "Keep this version and ghost the others after it"],
  [["⌘", "⇧", "R"], "Ask the writing model for rewrites of the selection"],
  [["⌘", "⇧", "."], "Zen: hide feedback and panels while you draft"],
  [["⌘", "Z"], "Undo typing (⇧ to redo)"],
];
/** The keyboard paths, listed where the writer can find them. */
export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !box.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className="shortcuts" ref={box}>
      <button
        type="button"
        className="quiet"
        aria-expanded={open}
        aria-controls="shortcut-list"
        onClick={() => setOpen(!open)}
      >
        Shortcuts
      </button>
      {open && (
        <div
          className="popover shortcuts-panel"
          id="shortcut-list"
          role="dialog"
          aria-label="Keyboard shortcuts"
        >
          <dl>
            {KEYS.map(([keys, action]) => (
              <div key={action}>
                <dt>
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
          <p>
            <strong>Undo operation</strong> (top right) undoes your last flip, keep, ghost, stash or
            comment. Typing has its own undo, ⌘Z.
          </p>
        </div>
      )}
    </span>
  );
}
