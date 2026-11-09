import { rewriteKeys, rewriteSelection } from "./editor/rewrite";
import { lintFeedback, lintBase, type Measured } from "./editor/lint";
import type { Diagnostic, LintSettings, LintSnapshot } from "@composedink/lint";
import { SentenceSparkline } from "./SentenceSparkline";
import { FeedbackList } from "./FeedbackList";
import { ago } from "./time";
import { parseSchema } from "@composedink/blocks";
import { dimControls } from "./editor/dim";
import { readZen, writeZen, zenKeys } from "./editor/zen";
import { frontmatterFold, settingsEdit, unfold } from "./editor/frontmatter";
import { undoTyping, redoTyping } from "./editor/sync";
import { SettingsStrip, type Field, type KindFields } from "./Settings";
import { describe, Notice, type NoticeContent } from "./Notice";
import { SignInState } from "./Account";
import { Shortcuts } from "./Shortcuts";
import { kindName } from "./NewPost";
import { selection as captureSelection } from "./editor/selection";
import { alternativeKeys, alternativeGutter, type Alt } from "./editor/alternatives";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorView } from "@codemirror/view";
import { LoroDoc } from "loro-crdt";
import {
  bodyWords,
  frontmatterBlock,
  frontmatterProblem,
  frontmatterValues,
  setFrontmatterField,
} from "@composedink/core";
import { sourceEditor } from "./editor/editor";
import { EditorTransport, type SaveState } from "./editor/transport";
import { SessionStatus, type Session } from "./SessionStatus";
import { ShareButton, SharePanel } from "./SharePanel";
import {
  readRequests,
  readThreads,
  threadHighlights,
  type FeedbackRequest,
  type Thread,
} from "./editor/threads";
import {
  CommentComposer,
  FeedbackPanel,
  ThreadColumn,
  ThreadFilterSelect,
  shownThreads,
  type ThreadFilter,
} from "./ThreadColumn";

const REASON: Record<string, string> = {
  cut: "Cut",
  alt: "Not kept",
  detached: "Its text was deleted",
};
type Slot = "page" | "rewrite" | "alternative" | "stash" | "feedback" | "action";
type Inspection = {
  deps: unknown;
  blocks: { tag: string; version: string; props: unknown; validation: string }[];
  diagnostic: string;
};
export function PostEditor({ id, panels }: { id: string; panels?: ReactNode }) {
  const [rewriting, setRewriting] = useState(false);
  const rewriteAbort = useRef<AbortController | null>(null);
  const parent = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const diagnosticBase = useRef("");
  const [measured, setMeasured] = useState<Measured & { current: boolean }>();
  const feedback = useRef<ReturnType<typeof lintFeedback> | null>(null);
  const [stash, setStash] = useState<{ id: string; text: string; reason?: string; at?: number }[]>(
    [],
  );
  const [composing, setComposing] = useState(false);
  const transport = useRef<EditorTransport | null>(null);
  const [alts, setAlts] = useState<Alt[]>([]);
  const liveAlts = useRef<Alt[]>([]);
  const [status, setStatus] = useState<SaveState>("Connecting");
  const [session, setSession] = useState<Session>();
  const [sharing, setSharing] = useState(false);
  const [inspection, setInspection] = useState<Inspection>();
  const [previewDiagnostics, setPreviewDiagnostics] = useState<unknown>();
  // One failure, once, beside the control that failed; `page` is for operations with no control.
  const [notices, setNotices] = useState<Partial<Record<Slot, NoticeContent>>>({});
  const fail = (slot: Slot) => (error: unknown) =>
    setNotices((n) => {
      const next = describe(error);
      return n[slot]?.title === next.title && n[slot]?.detail === next.detail
        ? n
        : { ...n, [slot]: next };
    });
  const clear = (slot: Slot) => () =>
    setNotices((n) => {
      if (!n[slot]) return n;
      const { [slot]: _, ...rest } = n;
      return rest;
    });
  const notice = (slot: Slot, className?: string) =>
    notices[slot] && (
      <Notice className={className} notice={notices[slot]} onDismiss={clear(slot)} />
    );
  const [result, setResult] = useState<unknown>();
  const [preview, setPreview] = useState("");
  const [zen, setZen] = useState(readZen);
  const zenNow = useRef(zen);
  const [source, setSource] = useState("");
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [kindFields, setKindFields] = useState<KindFields>();
  const [reading, setReading] = useState<Partial<Record<Field, string | number>>>({});
  const [kind, setKind] = useState<{ kind: string; warnings: string[] }>();
  const [threads, setThreads] = useState<Thread[]>([]);
  const liveThreads = useRef<Thread[]>([]);
  const [requests, setRequests] = useState<FeedbackRequest[]>([]);
  const [filter, setFilter] = useState<ThreadFilter>("open");
  const filterNow = useRef(filter);
  const [active, setActive] = useState<string | null>(null);
  const activeNow = useRef(active);
  // Bumped on edits, scrolling, wrapping and resize so the comment column re-measures.
  const [, setLayout] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const toggleZen = () => {
    zenNow.current = !zenNow.current;
    writeZen(zenNow.current);
    setZen(zenNow.current);
  };
  useEffect(() => {
    feedback.current?.setZen(zen);
  }, [zen]);
  // Highlights follow the filter, the active thread and zen; the column hides in zen while
  // threads and reviews keep syncing underneath.
  useEffect(() => {
    filterNow.current = filter;
    activeNow.current = active;
    editorView.current?.dispatch({});
  }, [filter, active, zen]);
  useEffect(() => {
    if (!active) return;
    document
      .querySelector(`.thread[data-thread="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // Written, never read at startup: the desktop smoke reads the last-opened slug from here.
  useEffect(() => localStorage.setItem("composed.selectedDocument", id), [id]);
  const [title, setTitle] = useState(id);
  useEffect(() => {
    const doc = new LoroDoc();
    doc.configTextStyle({ dim: { expand: "none" } });
    const lint = lintFeedback(
      doc,
      (items, base, sentences) => {
        setDiagnostics(items);
        diagnosticBase.current = base;
        setMeasured(sentences && { ...sentences, current: sentences.base === base });
      },
      fail("page"),
    );
    feedback.current = lint;
    lint.setZen(zenNow.current);
    let view: EditorView | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const refreshThreads = () => {
      liveThreads.current = readThreads(doc);
      setThreads(liveThreads.current);
      setRequests(readRequests(doc));
    };
    const relayout = () => setLayout((n) => n + 1);
    window.addEventListener("resize", relayout);
    const connection = new EditorTransport(
      doc,
      id,
      setStatus,
      () => {
        const opening = !view;
        if (!view && parent.current)
          view = sourceEditor(parent.current, doc, [
            lint.extension,
            frontmatterFold,
            zenKeys(toggleZen),
            rewriteKeys((v) => {
              if (rewriteAbort.current) return;
              const controller = new AbortController();
              rewriteAbort.current = controller;
              setRewriting(true);
              clear("rewrite")();
              const at = rewriteSelection(v, doc);
              void connection
                .operation(
                  "alt.rewrite",
                  { doc: id, at, count: 3, request: crypto.randomUUID() },
                  controller.signal,
                )
                .then(clear("rewrite"), (e) => {
                  if (!controller.signal.aborted) fail("rewrite")(e);
                })
                .finally(() => {
                  rewriteAbort.current = null;
                  setRewriting(false);
                });
            }),
            dimControls(doc, (v) => {
              void captureSelection(v, connection)
                .then((at) =>
                  connection.operation("ghost.set", {
                    doc: id,
                    at,
                    dim: !(() => {
                      let offset = 0,
                        marked = 0;
                      for (const p of doc.getText("mdx").toDelta()) {
                        const end = offset + (p.insert?.length ?? 0);
                        if (p.attributes?.dim)
                          marked += Math.max(0, Math.min(end, at.to) - Math.max(offset, at.from));
                        offset = end;
                      }
                      return marked === at.to - at.from;
                    })(),
                  }),
                )
                .catch(fail("page"));
            }),
            alternativeGutter(() => liveAlts.current),
            threadHighlights(() => ({
              shown: zenNow.current ? [] : shownThreads(liveThreads.current, filterNow.current),
              active: activeNow.current,
            })),
            EditorView.domEventHandlers({
              click: (event) => {
                const id = (event.target as HTMLElement)
                  .closest("[data-thread]")
                  ?.getAttribute("data-thread");
                if (id) setActive(id);
                return false;
              },
              scroll: relayout,
            }),
            alternativeKeys(
              () => liveAlts.current,
              (alt, action) => {
                void connection
                  .operation(
                    action === "keep" || action === "ghost" ? "alt.resolve" : "alt.flip",
                    action === "keep" || action === "ghost"
                      ? { doc: id, alt, rest: action === "ghost" ? "ghost" : "stash" }
                      : { doc: id, alt, to: action },
                  )
                  .then(clear("alternative"), fail("alternative"));
              },
            ),
            EditorView.updateListener.of((update) => {
              // Anchors resolve on this replica, so comments follow typing before acknowledgement.
              if (update.docChanged) refreshThreads();
              if (update.docChanged || update.geometryChanged || update.viewportChanged) relayout();
              const { from, to } = update.state.selection.main;
              setHasSelection(from !== to);
              // The editor's own selection (UTF-16 offsets), for specs that wait on it.
              parent.current?.setAttribute("data-selection", `${from}-${to}`);
            }),
          ]);
        refreshThreads();
        relayout();
        const source = doc.getText("mdx").toString();
        setSource(source);
        setMeta(doc.getMap("meta").toJSON() as Record<string, unknown>);
        const front = frontmatterValues(source).title;
        setTitle(typeof front === "string" && front.trim() ? front.trim() : id);
        if (opening && view) {
          // The writer lands in the body, after the settings block and its blank line.
          const end = frontmatterBlock(source)?.to ?? 0;
          const anchor = Math.min(source.length, source[end] === "\n" ? end + 1 : end);
          view.dispatch({ selection: { anchor }, scrollIntoView: true });
          view.focus();
        }
        setStash(
          doc
            .getMovableList("stash")
            .toArray()
            .filter(
              (v): v is { id: string; text: string; reason?: string; at?: number } =>
                !!v &&
                typeof v === "object" &&
                "id" in v &&
                "text" in v &&
                typeof v.id === "string" &&
                typeof v.text === "string",
            ),
        );
        editorView.current = view ?? null;
        clearTimeout(timer);
        timer = setTimeout(() => {
          // Effective rules come from the authority on every inspection, so kind and rule
          // changes reach the worker inside its immutable snapshot.
          void connection
            .operation("rules.effective", { id })
            .then((result) => {
              if (!result || typeof result !== "object" || !("rules" in result)) return;
              const { warnings, ...settings } = result as LintSettings & { warnings: string[] };
              lint.setSettings(settings);
              const recorded = doc.getMap("meta").get("kind");
              const kindId = typeof recorded === "string" ? recorded : "post";
              setKind({ kind: kindId, warnings });
              setReading({
                reader: settings.reader,
                medium: settings.medium,
                budget: settings.budget,
              });
              void connection.operation("kind.read", { kind: kindId }).then(
                (read) => {
                  const files = (read as { files?: Record<string, string> }).files ?? {};
                  try {
                    const config = JSON.parse(files["kind.json"] ?? "{}");
                    setKindFields({
                      kind: kindId,
                      frontmatter: Array.isArray(config.frontmatter) ? config.frontmatter : [],
                      meta: Array.isArray(config.meta) ? config.meta : [],
                    });
                  } catch {
                    setKindFields({ kind: kindId, frontmatter: [], meta: [] });
                  }
                },
                // A kind missing on this device lints as post; the strip then edits frontmatter.
                () => setKindFields({ kind: kindId, frontmatter: [], meta: [] }),
              );
            })
            .catch(fail("page"));
          void connection
            .operation("doc.read", { doc: id })
            .then((result) => {
              if (
                !result ||
                typeof result !== "object" ||
                !("blocks" in result) ||
                !("deps" in result) ||
                !("diagnostic" in result) ||
                !Array.isArray(result.blocks) ||
                typeof result.diagnostic !== "string"
              )
                return;
              if ("alts" in result && Array.isArray(result.alts)) {
                const valid = result.alts.filter(
                  (a): a is Alt =>
                    !!a &&
                    typeof a === "object" &&
                    typeof a.id === "string" &&
                    typeof a.from === "number" &&
                    typeof a.to === "number" &&
                    typeof a.active === "number" &&
                    typeof a.count === "number",
                );
                liveAlts.current = valid;
                setAlts(valid);
                view?.dispatch({});
              }
              const lintBlocks: NonNullable<LintSnapshot["blocks"]>[number][] = [];
              const blocks: Inspection["blocks"] = [];
              for (const block of result.blocks) {
                if (
                  !block ||
                  typeof block !== "object" ||
                  typeof block.tag !== "string" ||
                  typeof block.version !== "string" ||
                  typeof block.validation !== "string"
                )
                  return;
                if (
                  "schema" in block &&
                  typeof block.from === "number" &&
                  typeof block.to === "number"
                ) {
                  const schema = parseSchema(block.schema);
                  if (schema.type === "object")
                    lintBlocks.push({ from: block.from, to: block.to, props: block.props, schema });
                }
                blocks.push({
                  tag: block.tag,
                  version: block.version,
                  props: block.props,
                  validation: block.validation,
                });
              }
              if ("base" in result && typeof result.base === "string")
                lint.setBlocks(result.base, lintBlocks);
              setInspection({ blocks, deps: result.deps, diagnostic: result.diagnostic });
            })
            .catch(fail("page"));
        }, 150);
      },
      {
        session: (value) => setSession(value as Session),
        error: fail("page"),
        preview: setPreviewDiagnostics,
      },
    );
    transport.current = connection;
    return () => {
      window.removeEventListener("resize", relayout);
      clearTimeout(timer);
      rewriteAbort.current?.abort();
      connection.destroy();
      lint.destroy();
      view?.destroy();
      transport.current = null;
      feedback.current = null;
    };
  }, [id]);
  const rhythm = diagnostics.filter((d) => d.code === "rhythm").length;
  // Counts and the settings notice read the live text: the body counts whether or not the block parses.
  const words = bodyWords(source);
  const budget = typeof reading.budget === "number" ? reading.budget : undefined;
  const over = budget ? words - budget : 0;
  const problem = frontmatterProblem(source);
  // The comment column takes space only once there is something to show in it.
  const showComments = !zen && (threads.length > 0 || composing);
  const editSetting = (field: Field, value: string | number) => {
    const v = editorView.current;
    if (!v) return;
    v.dispatch({
      changes: setFrontmatterField(v.state.doc.toString(), field, value),
      annotations: settingsEdit.of(true),
      userEvent: "input.settings",
    });
  };
  // Offsets are only valid at the base they were measured at; never select unrelated prose.
  const jump = (sentence: { from: number; to: number }, base: string) => {
    const v = editorView.current,
      c = transport.current;
    if (!v || !c || lintBase(c.doc) !== base || sentence.to > v.state.doc.length) return;
    v.dispatch({
      selection: { anchor: sentence.from, head: sentence.to },
      effects: EditorView.scrollIntoView(sentence.from, { y: "center" }),
    });
    v.focus();
  };
  const propose = (d: Diagnostic) => {
    const c = transport.current;
    const base = diagnosticBase.current;
    if (!c || d.replacement === undefined || base !== lintBase(c.doc)) return;
    void c
      .flush()
      .then(() => {
        if (base !== lintBase(c.doc)) return;
        return c.operation("alt.propose", {
          doc: id,
          at: { base, view: "full", from: d.from, to: d.to },
          versions: [d.replacement],
          by: { kind: "human" },
        });
      })
      .then(clear("feedback"), fail("feedback"));
  };
  const stashOp = (
    name: string,
    input: (at: Awaited<ReturnType<typeof captureSelection>>) => object,
  ) => {
    const v = editorView.current,
      c = transport.current;
    if (v && c)
      void captureSelection(v, c)
        .then((at) => c.operation(name, input(at)))
        .then(clear("stash"), fail("stash"));
  };
  async function action(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = fields.get("operation");
    const raw = fields.get("input");
    if (typeof name !== "string" || typeof raw !== "string") return;
    try {
      const input: unknown = JSON.parse(raw);
      setResult(await transport.current?.operation(name, input));
      clear("action")();
    } catch (e) {
      fail("action")(e);
    }
  }
  const previewUrl = preview.trim();
  const previewHint =
    previewUrl && !/^https?:\/\//.test(previewUrl)
      ? `Start the address with http:// or https://, for example http://${previewUrl.replace(/^\/+/, "")}`
      : undefined;
  return (
    <main className={zen ? "editor zen" : "editor"}>
      <header className="editor-header">
        <a className="back" href="/">
          <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.75" />
          </svg>
          All posts
        </a>
        <h1 title={id}>{title}</h1>
        <div className="header-actions">
          <button
            onClick={() =>
              void transport.current?.undoOperation().then(clear("page"), fail("page"))
            }
          >
            Undo operation
          </button>
          <ShareButton
            session={session}
            open={sharing}
            onToggle={() => setSharing((open) => !open)}
          />
          <SignInState session={session} />
        </div>
      </header>
      {notice("page", "page-notice")}
      {!zen && (
        <SettingsStrip
          text={source}
          kind={kindFields}
          meta={meta}
          defaults={reading}
          blocked={problem && "Fix the settings block first: its text cannot be read."}
          onEdit={editSetting}
          onUndo={(redo) => {
            const doc = transport.current?.doc;
            if (doc) void (redo ? redoTyping(doc) : undoTyping(doc));
          }}
        />
      )}
      {sharing && session?.signedIn && !zen && <SharePanel id={id} transport={transport.current} />}
      <div className="workspace">
        <section className="writing" aria-label="Writing">
          <div className={showComments ? "source-row with-comments" : "source-row"}>
            <div className="editor-column">
              <div className="writing-tools" hidden={zen}>
                <CommentComposer
                  id={id}
                  view={editorView.current}
                  transport={transport.current}
                  hasSelection={hasSelection}
                  onOpened={setActive}
                  onDraft={setComposing}
                />
                <FeedbackPanel
                  id={id}
                  view={editorView.current}
                  transport={transport.current}
                  kind={kind?.kind ?? "post"}
                  requests={requests}
                  threads={threads}
                  alts={alts}
                  onThread={(thread) => {
                    const target = threads.find((t) => t.thread === thread);
                    if (target?.state === "resolved" && filter === "open") setFilter("all");
                    setActive(thread);
                  }}
                />
                {threads.length > 0 && <ThreadFilterSelect filter={filter} onFilter={setFilter} />}
              </div>
              {rewriting && (
                <p className="working">
                  Rewriting selection…{" "}
                  <button onClick={() => rewriteAbort.current?.abort()}>Cancel rewrite</button>
                </p>
              )}
              {notice("rewrite")}
              <div className="source-editor" ref={parent} />
            </div>
            {showComments && (
              <ThreadColumn
                id={id}
                view={editorView.current}
                transport={transport.current}
                threads={threads}
                requests={requests}
                filter={filter}
                active={active}
                onActive={setActive}
              />
            )}
          </div>
        </section>
        {!zen && (
          <aside className="aids" aria-label="Writing aids">
            <h2>Writing feedback</h2>
            <FeedbackList
              diagnostics={diagnostics}
              text={source}
              checking={!measured?.current}
              notices={
                (problem || notices.feedback) && (
                  <>
                    {problem && (
                      <Notice
                        className="settings-problem"
                        notice={{
                          code: "SettingsMalformed",
                          title: `The post's settings block is malformed (line ${problem.line}): ${problem.message}`,
                          detail:
                            "Words, rhythm and feedback still read the body; the settings are ignored until the block is fixed.",
                        }}
                        actions={
                          <button
                            type="button"
                            onClick={() => editorView.current && unfold(editorView.current)}
                          >
                            Unfold
                          </button>
                        }
                      />
                    )}
                    {notice("feedback")}
                  </>
                )
              }
              onJump={(d) => jump(d, diagnosticBase.current)}
              onDismiss={(items) => feedback.current?.dismiss(items)}
              onPropose={propose}
            />
            {alts.length > 0 && (
              <>
                <h2>Alternatives</h2>
                {alts.map((alt) => (
                  <article className="alternative" key={alt.id}>
                    <span>
                      Alternative {alt.active + 1}/{alt.count}
                    </span>
                    {(["prev", "next", "keep", "ghost"] as const).map((action) => (
                      <button
                        key={action}
                        onClick={() =>
                          void transport.current
                            ?.operation(
                              action === "keep" || action === "ghost" ? "alt.resolve" : "alt.flip",
                              action === "keep" || action === "ghost"
                                ? {
                                    doc: id,
                                    alt: alt.id,
                                    rest: action === "ghost" ? "ghost" : "stash",
                                  }
                                : { doc: id, alt: alt.id, to: action },
                            )
                            .then(clear("alternative"), fail("alternative"))
                        }
                      >
                        {action === "keep"
                          ? "Keep"
                          : action === "ghost"
                            ? "Keep and ghost the rest"
                            : action === "prev"
                              ? "↑"
                              : "↓"}
                      </button>
                    ))}
                  </article>
                ))}
                {notice("alternative")}
              </>
            )}
            <h2>Stash</h2>
            <section className="stash" aria-label="Stash">
              <button
                disabled={!hasSelection}
                title={
                  hasSelection
                    ? "Cut the selection into the stash"
                    : "Select text to cut it into the stash"
                }
                onClick={() => stashOp("stash.add", (at) => ({ doc: id, at }))}
              >
                Stash selection
              </button>
              {notice("stash")}
              {stash.length === 0 ? (
                <p className="muted empty-note">
                  Cut text and the versions you do not keep land here, to bring back later.
                </p>
              ) : (
                <ul className="stash-list">
                  {stash.map((item) => (
                    <li className="stash-item" key={item.id}>
                      <p className="stash-text">{item.text}</p>
                      <p className="stash-meta">
                        {(item.reason && REASON[item.reason]) || "Stashed"}{" "}
                        {item.at ? ago(item.at, Date.now()) : ""}
                      </p>
                      <span className="stash-actions">
                        <button
                          title="Insert at the caret"
                          onClick={() =>
                            stashOp("stash.restore", (at) => ({
                              doc: id,
                              item: item.id,
                              at: { ...at, to: at.from },
                            }))
                          }
                        >
                          Insert
                        </button>
                        <button
                          className="quiet"
                          onClick={() =>
                            void transport.current
                              ?.operation("stash.remove", { doc: id, item: item.id })
                              .then(clear("stash"), fail("stash"))
                          }
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <details className="components">
              <summary>Blog preview and components</summary>
              <p>See this post, components and all, on your blog’s dev server.</p>
              <label className="field">
                <span className="field-label">Preview address</span>
                <input
                  type="url"
                  inputMode="url"
                  value={preview}
                  placeholder={`http://localhost:3000/posts/${id}`}
                  aria-invalid={!!previewHint}
                  aria-describedby="preview-hint"
                  onChange={(e) => setPreview(e.target.value)}
                />
                {previewHint && (
                  <span className="field-hint" id="preview-hint">
                    {previewHint}
                  </span>
                )}
              </label>
              {/^https?:\/\//.test(previewUrl) && (
                <p>
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    Open the blog preview
                  </a>
                </p>
              )}
              {Array.isArray(previewDiagnostics) && previewDiagnostics.length > 0 && (
                <div className="preview-diagnostics">
                  <p>The last component rebuild reported:</p>
                  <ul>
                    {previewDiagnostics.map((d: unknown, i) => (
                      <li key={i}>
                        {d && typeof d === "object" && "message" in d
                          ? String(d.message)
                          : JSON.stringify(d)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <h3>Components in this post</h3>
              {inspection?.blocks.length ? (
                inspection.blocks.map((block, i) => (
                  <article className="chip" key={i}>
                    <strong>
                      &lt;{block.tag} /&gt; @{block.version}
                    </strong>
                    <pre>{JSON.stringify(block.props, null, 2)}</pre>
                    <p>{block.validation}</p>
                  </article>
                ))
              ) : (
                <p className="muted">No components used yet.</p>
              )}
              <h3>Dependencies</h3>
              <pre data-testid="deps">{JSON.stringify(inspection?.deps, null, 2)}</pre>
              {panels}
            </details>
          </aside>
        )}
      </div>
      <footer className="statusbar" aria-label="Status bar">
        <span
          data-testid="word-count"
          className={over > 0 ? "words over" : "words"}
          title={over > 0 ? `${over} words over the ${budget}-word budget` : undefined}
        >
          {budget ? `${words} / ${budget} words` : `${words} words`}
        </span>
        <p role="status">{status}</p>
        <SessionStatus session={session} />
        {!zen && kind && <span data-testid="kind">Kind: {kindName(kind.kind)}</span>}
        {!zen &&
          kind?.warnings.map((warning) => (
            <span className="warning" data-testid="kind-warning" key={warning} title={warning}>
              {warning}
            </span>
          ))}
        {!zen && rhythm > 0 && (
          <span data-testid="soft-count">
            {rhythm} {rhythm === 1 ? "rhythm note" : "rhythm notes"}
          </span>
        )}
        {!zen && measured && (
          <SentenceSparkline
            sentences={measured.sentences}
            current={measured.current}
            onJump={(sentence) => jump(sentence, measured.base)}
          />
        )}
        {!zen && <Shortcuts />}
        <button className="zen-toggle" aria-pressed={zen} onClick={toggleZen} title="Zen (⌘⇧.)">
          Zen
        </button>
      </footer>
      <details>
        <summary>Workspace actions</summary>
        <p>Keystrokes: ⌘Z / Ctrl+Z. Operation undo uses the separate button above.</p>
        <form onSubmit={(event) => void action(event)}>
          <label>
            Action{" "}
            <select name="operation" aria-label="Action">
              {[
                ["doc.create", "Create post"],
                ["doc.read", "Read post"],
                ["doc.apply", "Apply text"],
                ["alt.propose", "Propose alternative"],
                ["alt.flip", "Flip alternative"],
                ["alt.resolve", "Keep alternative"],
                ["stash.list", "List stash"],
                ["component.create", "Create component"],
                ["component.read", "Read component"],
                ["component.write", "Write component files"],
                ["deps.add", "Add dependency"],
                ["export", "Export preview"],
              ].map(([name, label]) => (
                <option key={name} value={name}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Input (JSON){" "}
            <textarea name="input" defaultValue={JSON.stringify({ slug: "new-post" })} />
          </label>
          <button>Run action</button>
        </form>
        {notice("action")}
        {result !== undefined && (
          <pre aria-label="Action result">{JSON.stringify(result, null, 2)}</pre>
        )}
      </details>
    </main>
  );
}
