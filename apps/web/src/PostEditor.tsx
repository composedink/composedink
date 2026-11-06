import { lintFeedback, lintBase } from "./editor/lint";
import type { Diagnostic, LintSnapshot } from "@composedink/lint";
import { parseSchema } from "@composedink/blocks";
import { dimControls } from "./editor/dim";
import { selection as captureSelection } from "./editor/selection";
import { alternativeKeys, alternativeGutter, type Alt } from "./editor/alternatives";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorView } from "@codemirror/view";
import { LoroDoc } from "loro-crdt";
import { sourceEditor } from "./editor/editor";
import { EditorTransport } from "./editor/transport";

type Inspection = {
  deps: unknown;
  blocks: { tag: string; version: string; props: unknown; validation: string }[];
  diagnostic: string;
};
export function PostEditor({ panels }: { panels?: ReactNode }) {
  const parent = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const diagnosticBase = useRef("");
  const feedback = useRef<ReturnType<typeof lintFeedback> | null>(null);
  const [stash, setStash] = useState<{ id: string; text: string }[]>([]);
  const transport = useRef<EditorTransport | null>(null);
  const [alts, setAlts] = useState<Alt[]>([]);
  const liveAlts = useRef<Alt[]>([]);
  const [status, setStatus] = useState("Connecting");
  const [context, setContext] = useState("No selection");
  const [inspection, setInspection] = useState<Inspection>();
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>();
  const [preview, setPreview] = useState("");
  const id = new URLSearchParams(location.search).get("doc") ?? "tracer";
  useEffect(() => {
    const doc = new LoroDoc();
    doc.configTextStyle({ dim: { expand: "none" } });
    const lint = lintFeedback(
      doc,
      (items, base) => {
        setDiagnostics(items);
        diagnosticBase.current = base;
      },
      setError,
    );
    feedback.current = lint;
    let view: EditorView | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const connection = new EditorTransport(doc, id, setStatus, () => {
      if (!view && parent.current)
        view = sourceEditor(parent.current, doc, [
          lint.extension,
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
              .catch((e) => setError(String(e)));
          }),
          alternativeGutter(() => liveAlts.current),
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
                .catch((e) => setError(String(e)));
            },
          ),
          EditorView.updateListener.of((update) => {
            const { from, to } = update.state.selection.main;
            setContext(
              from === to
                ? `Cursor ${from}`
                : `${to - from} UTF-16 units selected: ${update.state.sliceDoc(from, to)}`,
            );
          }),
        ]);
      setStash(
        doc
          .getMovableList("stash")
          .toArray()
          .filter(
            (v): v is { id: string; text: string } =>
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
          .catch((e) => setError(String(e)));
      }, 150);
    });
    transport.current = connection;
    return () => {
      clearTimeout(timer);
      connection.destroy();
      lint.destroy();
      view?.destroy();
      transport.current = null;
      feedback.current = null;
    };
  }, [id]);
  async function action(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = fields.get("operation");
    const raw = fields.get("input");
    if (typeof name !== "string" || typeof raw !== "string") return;
    try {
      const input: unknown = JSON.parse(raw);
      setResult(await transport.current?.operation(name, input));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <main>
      <header>
        <h1>composed · {id}</h1>
        <p role="status">{status}</p>
        <button
          onClick={() =>
            void transport.current
              ?.undoOperation()
              .then(() => setError(""))
              .catch((e) => setError(String(e)))
          }
        >
          Undo operation
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="split">
        <section aria-label="Source">
          <h2>Source</h2>
          <div ref={parent} />
          <p>{context}</p>
        </section>
        <aside aria-label="Preview">
          <h2>Preview</h2>
          <p>Open the post on your blog’s dev server to see its components.</p>
          <label>
            Blog preview URL{" "}
            <input type="url" value={preview} onChange={(e) => setPreview(e.target.value)} />
          </label>
          {/^https?:\/\//.test(preview) && (
            <p>
              <a href={preview} target="_blank" rel="noreferrer">
                Open blog preview
              </a>
            </p>
          )}
          <h3>Writing feedback</h3>
          <section aria-label="Writing feedback">
            {diagnostics.map((d, i) => (
              <article
                className="diagnostic"
                key={`${d.code}:${d.from}:${i}`}
                data-code={d.code}
                data-from={d.from}
                data-to={d.to}
              >
                <p>{d.message}</p>
                <button onClick={() => feedback.current?.dismiss(d)}>Dismiss</button>
                {d.replacement !== undefined && (
                  <button
                    onClick={() => {
                      const c = transport.current;
                      const base = diagnosticBase.current;
                      if (c && base === lintBase(c.doc))
                        void c
                          .flush()
                          .then(() => {
                            if (base !== lintBase(c.doc)) return;
                            return c.operation("alt.propose", {
                              doc: id,
                              at: {
                                base,
                                view: "full",
                                from: d.from,
                                to: d.to,
                              },
                              versions: [d.replacement],
                              by: { kind: "human" },
                            });
                          })
                          .catch((e) => setError(String(e)));
                    }}
                  >
                    Propose “{d.replacement}”
                  </button>
                )}
              </article>
            ))}
          </section>
          <h3>Alternatives</h3>
          {alts.map((alt) => (
            <article className="alternative" key={alt.id}>
              <span>
                ● Alternative {alt.active + 1}/{alt.count}
              </span>
              {(["prev", "next", "keep", "ghost"] as const).map((action) => (
                <button
                  key={action}
                  onClick={() =>
                    void transport.current
                      ?.operation(
                        action === "keep" || action === "ghost" ? "alt.resolve" : "alt.flip",
                        action === "keep" || action === "ghost"
                          ? { doc: id, alt: alt.id, rest: action === "ghost" ? "ghost" : "stash" }
                          : { doc: id, alt: alt.id, to: action },
                      )
                      .catch((e) => setError(String(e)))
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
          <h3>Stash</h3>
          <button
            onClick={() => {
              const v = editorView.current,
                c = transport.current;
              if (v && c)
                void captureSelection(v, c)
                  .then((at) => c.operation("stash.add", { doc: id, at }))
                  .catch((e) => setError(String(e)));
            }}
          >
            Stash selection
          </button>
          {stash.map((item) => (
            <article className="stash-item" key={item.id}>
              <pre>{item.text}</pre>
              <button
                onClick={() => {
                  const v = editorView.current,
                    c = transport.current;
                  if (v && c)
                    void captureSelection(v, c)
                      .then((at) =>
                        c.operation("stash.restore", {
                          doc: id,
                          item: item.id,
                          at: { ...at, to: at.from },
                        }),
                      )
                      .catch((e) => setError(String(e)));
                }}
              >
                Insert
              </button>
            </article>
          ))}
          <h3>Block usages</h3>
          {inspection?.blocks.map((block, i) => (
            <article className="chip" key={i}>
              <strong>
                &lt;{block.tag} /&gt; @{block.version}
              </strong>
              <pre>{JSON.stringify(block.props, null, 2)}</pre>
              <p>{block.validation}</p>
            </article>
          ))}
          <p>{inspection?.diagnostic}</p>
          <h3>Dependencies</h3>
          <pre data-testid="deps">{JSON.stringify(inspection?.deps, null, 2)}</pre>
          {panels}
        </aside>
      </div>
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
        {result !== undefined && (
          <pre aria-label="Action result">{JSON.stringify(result, null, 2)}</pre>
        )}
      </details>
    </main>
  );
}
