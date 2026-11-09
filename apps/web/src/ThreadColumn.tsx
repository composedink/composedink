import { useLayoutEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import type { Alt } from "./editor/alternatives";
import { selectionNow } from "./editor/selection";
import {
  anchorTop,
  authorName,
  authorTag,
  stack,
  type FeedbackRequest,
  type Thread,
} from "./editor/threads";
import type { EditorTransport } from "./editor/transport";
import { describe, Notice, type NoticeContent } from "./Notice";

export type ThreadFilter = "open" | "resolved" | "all";
export const shownThreads = (threads: Thread[], filter: ThreadFilter) =>
  threads.filter((t) => t.state !== "detached" && (filter === "all" || t.state === filter));
type Common = {
  id: string;
  view: EditorView | null;
  transport: EditorTransport | null;
};
/** A control's own failure, shown beside it until dismissed or the next success. */
function useNotice() {
  const [notice, setNotice] = useState<NoticeContent>();
  const shown = notice && <Notice notice={notice} onDismiss={() => setNotice(undefined)} />;
  return { shown, fail: (e: unknown) => setNotice(describe(e)), clear: () => setNotice(undefined) };
}

/** Selection comments: quote and base are captured on click, before typing is flushed. */
export function CommentComposer({
  id,
  view,
  transport,
  hasSelection,
  onOpened,
}: Common & { hasSelection: boolean; onOpened: (thread: string) => void }) {
  const [draft, setDraft] = useState<{ base: string; quote: string }>();
  const [text, setText] = useState("");
  const { shown, fail, clear } = useNotice();
  return (
    <div className="comment-composer">
      <button
        disabled={!hasSelection}
        title={hasSelection ? "Comment on the selected text" : "Select text to comment on it"}
        onClick={() => {
          if (!view || !transport) return;
          const at = selectionNow(view, transport.doc);
          if (at.from === at.to) return;
          setDraft({ base: at.base, quote: view.state.sliceDoc(at.from, at.to) });
          setText("");
        }}
      >
        Comment
      </button>
      {draft && (
        <form
          aria-label="New comment"
          onSubmit={(event) => {
            event.preventDefault();
            if (!transport || !text.trim()) return;
            void transport
              .operation("thread.open", {
                id,
                base: draft.base,
                quote: draft.quote,
                text,
                request: crypto.randomUUID(),
              })
              .then((result) => {
                setDraft(undefined);
                clear();
                if (result && typeof result === "object" && "thread" in result)
                  onOpened(String(result.thread));
              })
              .catch(fail);
          }}
        >
          <blockquote>{draft.quote}</blockquote>
          <textarea
            aria-label="Comment text"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
          <button>Post comment</button>
          <button type="button" onClick={() => setDraft(undefined)}>
            Discard
          </button>
        </form>
      )}
      {shown}
    </div>
  );
}

function ThreadCard({
  id,
  thread,
  transport,
  active,
  question,
  quote,
  onActivate,
  onGo,
  style,
  measure,
}: Omit<Common, "view"> & {
  thread: Thread;
  active: boolean;
  question?: string;
  quote: string;
  onActivate: () => void;
  onGo?: () => void;
  style?: React.CSSProperties;
  measure?: (element: HTMLElement | null) => void;
}) {
  const [reply, setReply] = useState("");
  const { shown, fail, clear } = useNotice();
  return (
    <article
      ref={measure}
      className={active ? "thread active" : "thread"}
      data-thread={thread.thread}
      data-state={thread.state}
      style={style}
      onClick={onActivate}
    >
      {question && <p className="thread-question">Q: {question}</p>}
      {quote && <blockquote>{quote}</blockquote>}
      {thread.messages.map((m, i) => {
        const tag = authorTag(m.by);
        return (
          <p className="message" key={i}>
            <strong>{authorName(m.by)}</strong>
            {tag && <span className="author-tag"> {tag}</span>} {m.text}
          </p>
        );
      })}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!transport || !reply.trim()) return;
          void transport
            .operation("thread.reply", { id, thread: thread.thread, text: reply })
            .then(() => {
              setReply("");
              clear();
            })
            .catch(fail);
        }}
      >
        <input
          aria-label="Reply"
          value={reply}
          placeholder="Reply"
          onChange={(e) => setReply(e.target.value)}
        />
      </form>
      <div className="thread-actions">
        {onGo && (
          <button type="button" onClick={onGo}>
            Go to text
          </button>
        )}
        {thread.state === "open" && (
          <button
            type="button"
            onClick={() =>
              void transport
                ?.operation("thread.resolve", { id, thread: thread.thread })
                .then(clear, fail)
            }
          >
            Resolve
          </button>
        )}
      </div>
      {shown}
    </article>
  );
}

/**
 * Right-hand comments aligned to live anchors (CodeMirror measurement), stacked on collision;
 * detached threads list at the bottom with no source highlight.
 */
export function ThreadColumn({
  id,
  view,
  transport,
  threads,
  requests,
  filter,
  onFilter,
  active,
  onActive,
}: Common & {
  threads: Thread[];
  requests: FeedbackRequest[];
  filter: ThreadFilter;
  onFilter: (filter: ThreadFilter) => void;
  active: string | null;
  onActive: (thread: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [tops, setTops] = useState<Record<string, number>>({});
  const [height, setHeight] = useState(0);
  const shown = shownThreads(threads, filter);
  const detached = threads.filter((t) => t.state === "detached");
  const questions = new Map(requests.flatMap((r) => r.questions.map((q) => [q.id, q.text])));
  // Runs after every render: PostEditor re-renders on edits, scrolling, wrapping and resize.
  useLayoutEffect(() => {
    if (!view || !box.current) return;
    const origin = box.current.getBoundingClientRect().top;
    const items = shown
      .map((t) => ({
        id: t.thread,
        anchor: anchorTop(view, t.from!) - origin,
        height: cards.current.get(t.thread)?.offsetHeight ?? 0,
      }))
      .sort((a, b) => a.anchor - b.anchor);
    const next = Object.fromEntries(stack(items));
    const bottom = Math.max(
      view.dom.getBoundingClientRect().height,
      ...items.map((i) => next[i.id] + i.height),
    );
    if (JSON.stringify(next) !== JSON.stringify(tops)) setTops(next);
    if (bottom !== height) setHeight(bottom);
  });
  const go = (t: Thread) => {
    if (!view || t.from === null) return;
    onActive(t.thread);
    view.dispatch({
      selection: { anchor: t.from, head: t.to ?? t.from },
      effects: EditorView.scrollIntoView(t.from, { y: "center" }),
    });
    view.focus();
  };
  const card = (t: Thread, anchored: boolean) => (
    <ThreadCard
      key={t.thread}
      id={id}
      thread={t}
      transport={transport}
      active={active === t.thread}
      question={t.question ? (questions.get(t.question) ?? t.question) : undefined}
      quote={
        anchored && view && t.from !== null && t.to !== null
          ? view.state.sliceDoc(t.from, Math.min(t.to, t.from + 120))
          : ""
      }
      onActivate={() => onActive(t.thread)}
      onGo={anchored ? () => go(t) : undefined}
      style={anchored ? { top: tops[t.thread] ?? 0 } : undefined}
      measure={
        anchored
          ? (element) => {
              if (element) cards.current.set(t.thread, element);
              else cards.current.delete(t.thread);
            }
          : undefined
      }
    />
  );
  return (
    <aside className="thread-column" aria-label="Comments">
      <div className="thread-anchored" ref={box} style={{ height }}>
        {shown.map((t) => card(t, true))}
      </div>
      <label className="thread-filter">
        Show{" "}
        <select
          aria-label="Comment filter"
          value={filter}
          onChange={(e) => onFilter(e.target.value as ThreadFilter)}
        >
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
      </label>
      {detached.length > 0 && (
        <section aria-label="Detached comments" className="thread-detached">
          <h3>Detached</h3>
          <p>The text these comments were on was deleted.</p>
          {detached.map((t) => card(t, false))}
        </section>
      )}
    </aside>
  );
}

/** Directed questions to the model; answers group by question, linking notes and rewrites. */
export function FeedbackPanel({
  id,
  view,
  transport,
  kind,
  requests,
  threads,
  alts,
  onThread,
}: Common & {
  kind: string;
  requests: FeedbackRequest[];
  threads: Thread[];
  alts: Alt[];
  onThread: (thread: string) => void;
}) {
  const [questions, setQuestions] = useState<string[]>();
  const [asking, setAsking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const { shown, fail, clear } = useNotice();
  const start = () =>
    void transport
      ?.operation("kind.read", { kind })
      .then((result) => {
        const files =
          result && typeof result === "object" && "files" in result
            ? (result.files as Record<string, string>)
            : {};
        const seeded: unknown = JSON.parse(files["kind.json"] ?? "{}").questions;
        setQuestions(Array.isArray(seeded) ? seeded.map(String) : [""]);
        clear();
      })
      .catch(fail);
  const ask = (event: React.FormEvent) => {
    event.preventDefault();
    if (!transport || !questions || abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setAsking(true);
    clear();
    void transport
      .operation(
        "feedback.request",
        {
          id,
          to: ["model"],
          questions: questions.filter((q) => q.trim()),
          request: crypto.randomUUID(),
        },
        controller.signal,
      )
      .then(() => setQuestions(undefined))
      // The form stays open with the failure under it; a cancelled request says so.
      .catch(fail)
      .finally(() => {
        abort.current = null;
        setAsking(false);
      });
  };
  const showAlt = (alt: Alt) => {
    if (!view) return;
    view.dispatch({
      selection: { anchor: alt.from },
      effects: EditorView.scrollIntoView(alt.from, { y: "center" }),
    });
    view.focus();
  };
  return (
    <section className="feedback-panel" aria-label="Model feedback">
      {!questions && (
        <button onClick={start} disabled={asking}>
          Ask the model
        </button>
      )}
      {questions && (
        <form aria-label="Feedback questions" onSubmit={ask}>
          {questions.map((q, i) => (
            <div className="question-field" key={i}>
              <textarea
                aria-label={`Question ${i + 1}`}
                value={q}
                onChange={(e) =>
                  setQuestions(questions.map((v, j) => (j === i ? e.target.value : v)))
                }
              />
              <button
                type="button"
                aria-label={`Remove question ${i + 1}`}
                onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setQuestions([...questions, ""])}>
            Add question
          </button>
          <button disabled={asking || !questions.some((q) => q.trim())}>Ask</button>
          <button type="button" disabled={asking} onClick={() => setQuestions(undefined)}>
            Close
          </button>
        </form>
      )}
      {shown}
      {requests.map((r) => (
        <article className="request" key={r.request} data-status={r.state.status}>
          {r.state.status === "pending" && !r.to.includes("model") && (
            <p>
              Waiting for guests on{" "}
              {r.to.map((to) => `link ${to.slice("link:".length, "link:".length + 6)}`).join(", ")}
            </p>
          )}
          {r.state.status === "pending" && r.to.includes("model") && (
            <p>
              Waiting for the model…{" "}
              {asking && (
                <button type="button" onClick={() => abort.current?.abort()}>
                  Cancel request
                </button>
              )}
            </p>
          )}
          {r.state.status === "failed" && <Notice notice={describe(r.state.message)} />}
          {r.state.status === "answered" &&
            r.questions.map((q) => {
              const answer =
                r.state.status === "answered"
                  ? r.state.answers.find((a) => a.question === q.id)
                  : undefined;
              return (
                <section className="answer" key={q.id} data-question={q.id}>
                  <h4>{q.text}</h4>
                  <p>{answer?.text}</p>
                  {answer?.threads.map((t) => (
                    <button key={t} className="answer-note" onClick={() => onThread(t)}>
                      Note: {threads.find((x) => x.thread === t)?.messages[0]?.text ?? t}
                    </button>
                  ))}
                  {answer?.alternatives.map((a) => {
                    const alt = alts.find((x) => x.id === a);
                    return alt ? (
                      <button key={a} className="answer-rewrite" onClick={() => showAlt(alt)}>
                        Show suggested rewrite ({alt.count - 1})
                      </button>
                    ) : (
                      <span key={a} className="answer-rewrite">
                        Suggested rewrite settled
                      </span>
                    );
                  })}
                  {!!answer?.detached.length && (
                    <span>
                      {answer.detached.length} suggested rewrite(s) stashed: their text was deleted.
                    </span>
                  )}
                </section>
              );
            })}
        </article>
      ))}
    </section>
  );
}
