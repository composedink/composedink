import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocSummary } from "@composedink/core";
import { SignInState } from "./Account";
import { kindName, NewPost } from "./NewPost";
import { describe, Notice, type NoticeContent } from "./Notice";
import type { Session } from "./SessionStatus";
import { StudioClient } from "./studio";
import { ago } from "./time";

/** Home: every post, newest first, and the way to start a new one. */
export function Home({ missing }: { missing?: string }) {
  const [session, setSession] = useState<Session>();
  const client = useMemo(() => new StudioClient(setSession), []);
  const [docs, setDocs] = useState<DocSummary[]>();
  const [notice, setNotice] = useState<NoticeContent | undefined>(
    missing === undefined ? undefined : describe(`UnknownDoc: ${missing}`),
  );
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback(
    () =>
      client.operation("doc.list", {}).then(
        (result) => {
          setDocs((result as { docs: DocSummary[] }).docs);
          setNow(Date.now());
        },
        (e) => setNotice(describe(e)),
      ),
    [client],
  );
  useEffect(() => {
    void refresh();
    // The socket has no document events for Home: re-list whenever the writer comes back.
    const again = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
      clearInterval(timer);
      client.destroy();
    };
  }, [client, refresh]);
  const taken = useMemo(() => new Set(docs?.map((d) => d.id)), [docs]);
  const start = () => setCreating(true);
  return (
    <main className="home">
      <header className="app-header">
        <span className="wordmark">composed</span>
        <SignInState session={session} />
      </header>
      {notice && (
        <Notice className="page-notice" notice={notice} onDismiss={() => setNotice(undefined)} />
      )}
      <div className="home-head">
        <h1>Posts</h1>
        {!!docs?.length && (
          <button className="primary" onClick={start}>
            New post
          </button>
        )}
      </div>
      {docs === undefined && !notice && <p className="muted">Loading your posts…</p>}
      {docs?.length === 0 && (
        <section className="empty" aria-label="No posts yet">
          <h2>Start your first post</h2>
          <p>
            Pick a kind (a blog post, a weekly update, a proposal) and composed sets up who it is
            for, how long it should be and a starting outline.
          </p>
          <button className="primary" onClick={start}>
            New post
          </button>
        </section>
      )}
      {!!docs?.length && (
        <ol className="post-list" aria-label="Posts">
          {docs.map((d) => (
            <li key={d.id} data-doc={d.id}>
              <a href={`?doc=${encodeURIComponent(d.id)}`}>
                <span className="post-title">{d.title}</span>
                <span className="post-facts">
                  <span>{kindName(d.kind)}</span>
                  <span>
                    {d.words} {d.words === 1 ? "word" : "words"}
                  </span>
                  <span>
                    edited{" "}
                    <time dateTime={new Date(d.updatedAt).toISOString()}>
                      {ago(d.updatedAt, Math.max(now, d.updatedAt))}
                    </time>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
      {creating && (
        <NewPost
          client={client}
          taken={taken}
          onCancel={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
    </main>
  );
}
