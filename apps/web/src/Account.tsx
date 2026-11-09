import { useEffect, useRef, useState } from "react";
import type { Session } from "./SessionStatus";
/**
 * The signed-out state, said once, in the header: "Not signed in · Sign in", where Sign in opens
 * the exact command for this device. Signed in, the header says nothing (the status bar has it).
 */
export function SignInState({ session }: { session?: Session }) {
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
  if (!session || session.signedIn) return null;
  return (
    <span className="sign-in" ref={box} data-testid="session">
      Not signed in ·{" "}
      <button
        type="button"
        className="link"
        aria-expanded={open}
        aria-controls="sign-in-help"
        onClick={() => setOpen(!open)}
      >
        Sign in
      </button>
      {open && (
        <span className="popover sign-in-help" id="sign-in-help" role="dialog" aria-label="Sign in">
          {session.server ? (
            <>
              Run this in a terminal on this computer:
              <code>composed login {session.server}</code>
            </>
          ) : (
            <>
              Pair this device from a signed-in one: run <code>composed devices pair</code> there
              and follow what it prints.
            </>
          )}
        </span>
      )}
    </span>
  );
}
