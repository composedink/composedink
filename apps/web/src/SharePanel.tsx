import { useCallback, useEffect, useState } from "react";
import type { EditorTransport } from "./editor/transport";
import type { Session } from "./SessionStatus";
import { describe, Notice, type NoticeContent } from "./Notice";

/** `share.list` entries: the server's link plus the URL when this device created it. */
interface Link {
  linkId: string;
  mode: "pinned" | "live";
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  url?: string;
}
const EXPIRIES = [
  ["", "No expiry"],
  ["1d", "1 day"],
  ["7d", "7 days"],
  ["30d", "30 days"],
] as const;
const date = (at: number) => new Date(at).toLocaleString();

/**
 * The header's Share button. Sharing needs a server session: signed out, the button is disabled and
 * its tooltip says why; the header's "Sign in" disclosure has the command.
 */
export function ShareButton({
  session,
  open,
  onToggle,
}: {
  session?: Session;
  open: boolean;
  onToggle: () => void;
}) {
  const signedIn = session?.signedIn === true;
  return (
    <button
      className="share-button"
      disabled={!signedIn}
      aria-expanded={signedIn && open}
      title={
        signedIn
          ? "Share a preview link with comments"
          : "Sign in to share: preview links live on your composed server. See Sign in, top right."
      }
      onClick={onToggle}
    >
      Share
    </button>
  );
}

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="share-url">
      <input readOnly aria-label="Link URL" value={url} onFocus={(e) => e.target.select()} />
      <button
        onClick={() =>
          void navigator.clipboard.writeText(url).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** Links of the open document: list, create (pinned by default, live, expiry) and revoke. */
export function SharePanel({ id, transport }: { id: string; transport: EditorTransport | null }) {
  const [notice, setNotice] = useState<NoticeContent>();
  const onError = useCallback((e: unknown) => setNotice(describe(e)), []);
  const [links, setLinks] = useState<Link[]>();
  const [mode, setMode] = useState<"pinned" | "live">("pinned");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string>();
  const refresh = useCallback(async () => {
    if (!transport) return;
    const result = (await transport.operation("share.list", { id })) as { links: Link[] };
    setLinks(result.links);
  }, [id, transport]);
  useEffect(() => {
    refresh().catch(onError);
  }, [refresh, onError]);
  const create = async () => {
    if (!transport) return;
    setBusy(true);
    try {
      const result = (await transport.operation("share.create", {
        id,
        mode,
        ...(expires ? { expiresIn: expires } : {}),
      })) as { url: string };
      setCreated(result.url);
      setNotice(undefined);
      await refresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (link: string) => {
    try {
      await transport?.operation("share.revoke", { link });
      await refresh();
      setNotice(undefined);
    } catch (e) {
      onError(e);
    }
  };
  return (
    <section className="share-panel" aria-label="Share">
      <h2>Share a preview</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          Mode{" "}
          <select
            aria-label="Mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "pinned" | "live")}
          >
            <option value="pinned">Pinned (this version)</option>
            <option value="live">Live (follows edits)</option>
          </select>
        </label>
        <label>
          Expires{" "}
          <select aria-label="Expires" value={expires} onChange={(e) => setExpires(e.target.value)}>
            {EXPIRIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy}>{busy ? "Creating…" : "Create link"}</button>
      </form>
      {notice && <Notice notice={notice} onDismiss={() => setNotice(undefined)} />}
      {created && (
        <p className="share-created">
          New link: <CopyUrl url={created} />
        </p>
      )}
      {links === undefined ? (
        <p>Loading links…</p>
      ) : links.length === 0 ? (
        <p>No links for this post yet.</p>
      ) : (
        <ul className="share-links">
          {links.map((link) => (
            <li
              key={link.linkId}
              data-link={link.linkId}
              className={link.revokedAt === null ? "" : "revoked"}
            >
              <strong>{link.mode}</strong> · link {link.linkId.slice(0, 6)} ·{" "}
              {link.revokedAt !== null
                ? `revoked ${date(link.revokedAt)}`
                : link.expiresAt === null
                  ? "no expiry"
                  : `expires ${date(link.expiresAt)}`}
              {link.url && link.revokedAt === null && <CopyUrl url={link.url} />}
              {link.revokedAt === null && (
                <button onClick={() => void revoke(link.linkId)}>Revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
