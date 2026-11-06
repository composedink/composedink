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
    let view: EditorView | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const connection = new EditorTransport(doc, id, setStatus, () => {
      if (!view && parent.current)
        view = sourceEditor(parent.current, doc, [
          alternativeGutter(() => liveAlts.current),
          alternativeKeys(
            () => liveAlts.current,
            (alt, action) => {
              void connection
                .operation(
                  action === "keep" ? "alt.resolve" : "alt.flip",
                  action === "keep"
                    ? { doc: id, alt, rest: "stash" }
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
              blocks.push({
                tag: block.tag,
                version: block.version,
                props: block.props,
                validation: block.validation,
              });
            }
            setInspection({ blocks, deps: result.deps, diagnostic: result.diagnostic });
          })
          .catch((e) => setError(String(e)));
      }, 150);
    });
    transport.current = connection;
    return () => {
      clearTimeout(timer);
      connection.destroy();
      view?.destroy();
      transport.current = null;
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
          <h3>Alternatives</h3>
          {alts.map((alt) => (
            <article className="alternative" key={alt.id}>
              <span>
                ● Alternative {alt.active + 1}/{alt.count}
              </span>
              {(["prev", "next", "keep"] as const).map((action) => (
                <button
                  key={action}
                  onClick={() =>
                    void transport.current
                      ?.operation(
                        action === "keep" ? "alt.resolve" : "alt.flip",
                        action === "keep"
                          ? { doc: id, alt: alt.id, rest: "stash" }
                          : { doc: id, alt: alt.id, to: action },
                      )
                      .catch((e) => setError(String(e)))
                  }
                >
                  {action === "keep" ? "Keep" : action === "prev" ? "↑" : "↓"}
                </button>
              ))}
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
