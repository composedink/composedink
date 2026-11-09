import type { ReactNode } from "react";
/** What a failure means to the writer: a plain sentence, the recovery, and the code for tests. */
export interface NoticeContent {
  readonly code?: string;
  readonly title: string;
  /** The recovery, shown as a second line. */
  readonly detail?: string;
  readonly help?: ReactNode;
}
const sentence = (text: string) => {
  const trimmed = text.trim().replace(/\.$/, "");
  return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1) + "." : "Something went wrong.";
};
function ModelHelp() {
  return (
    <details className="notice-help">
      <summary>How to set one up</summary>
      <p>
        Add a <code>rewrite</code> section to <code>~/.composed/config.json</code> with the two keys{" "}
        <code>endpoint</code> (an OpenAI-compatible chat completions URL) and <code>model</code>,
        then ask again:
      </p>
      <pre>{`{ "rewrite": { "endpoint": "https://…/v1/chat/completions", "model": "…" } }`}</pre>
    </details>
  );
}
/**
 * One failure, said once. `Error:` prefixes and the `Code:` prefix never reach the writer; the
 * `fix:` clause becomes the second line. Known codes get writer copy.
 */
export function describe(error: unknown): NoticeContent {
  let raw = error instanceof Error ? error.message : String(error);
  raw = raw.replace(/^(?:Error:\s*)+/, "");
  const coded = raw.match(/^([A-Z][A-Za-z]+): ([\s\S]*)$/);
  const code = coded?.[1];
  const [reason, fix] = (coded ? coded[2] : raw).split(/;\s*fix:\s*/);
  const recovery = fix ? `To fix it: ${fix.trim()}` : undefined;
  switch (code) {
    case "ProviderFailed":
      if (/no writing model is set up|missing or invalid provider/.test(reason))
        return {
          code,
          title: "No writing model is set up on this device yet.",
          help: <ModelHelp />,
        };
      if (reason.startsWith("cancelled"))
        return {
          code,
          title: "The request was cancelled.",
          detail: "Ask again when you are ready.",
        };
      return {
        code,
        title: `The writing model did not answer: ${reason.trim()}.`,
        detail: recovery,
      };
    case "UnknownDoc":
      return {
        code,
        title: `There is no post called “${reason.trim()}”.`,
        detail: "Pick one from the list or start a new post.",
      };
    case "Unauthorized":
    case "SignInRequired":
      return {
        code,
        title: "This device was signed out. Sign in again to sync.",
        detail: "Use Sign in at the top of the page for the command.",
      };
    case "NothingToUndo":
      return { code, title: "There is nothing to undo.", detail: "Only your own operations undo." };
    case undefined:
      if (raw.startsWith("Disconnected"))
        return {
          code: "Disconnected",
          title: "Lost the connection to composed before it replied.",
          detail: "Your text is kept; try again once the status bar says Saved.",
        };
  }
  return { code, title: sentence(reason), detail: recovery };
}
/** A failure beside the control that failed (or once in the header for page-wide operations). */
export function Notice({
  notice,
  onDismiss,
  actions,
  className,
}: {
  notice: NoticeContent;
  onDismiss?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className ? `notice ${className}` : "notice"}
      role="alert"
      data-code={notice.code}
    >
      <p className="notice-title">{notice.title}</p>
      {notice.detail && <p className="notice-detail">{notice.detail}</p>}
      {notice.help}
      {(actions || onDismiss) && (
        <div className="notice-actions">
          {actions}
          {onDismiss && (
            <button type="button" className="quiet" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
