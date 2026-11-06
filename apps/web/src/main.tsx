import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { LoroDoc } from "loro-crdt";
import { EditorTransport } from "./editor/transport";
import { LoroSyncPlugin } from "./editor/sync";
function Studio() {
  const parent = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connecting");
  useEffect(() => {
    const doc = new LoroDoc();
    let view: EditorView | undefined;
    const id = new URLSearchParams(location.search).get("doc") ?? "tracer";
    const transport = new EditorTransport(doc, id, setStatus, () => {
      if (!view && parent.current)
        view = new EditorView({
          parent: parent.current,
          state: EditorState.create({
            doc: doc.getText("mdx").toString(),
            extensions: [markdown(), LoroSyncPlugin(doc, (d) => d.getText("mdx"))],
          }),
        });
    });
    return () => {
      transport.destroy();
      view?.destroy();
    };
  }, []);
  return (
    <main>
      <h1>composed</h1>
      <p role="status">{status}</p>
      <div ref={parent} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Studio />);
