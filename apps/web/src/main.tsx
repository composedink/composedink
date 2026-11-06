import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { LoroDoc } from "loro-crdt";
import { LoroSyncPlugin } from "./editor/sync";
declare global {
  interface Window {
    __composedSession: { token: string; origin: string };
  }
}
function Studio() {
  const parent = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connecting");
  useEffect(() => {
    const doc = new LoroDoc();
    const id = new URLSearchParams(location.search).get("doc") ?? "tracer";
    let view: EditorView | undefined;
    let stopped = false;
    let seq = 0;
    const pending = new Map<number, string>();
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = doc.subscribeLocalUpdates((bytes) => {
      const frame = JSON.stringify({
        doc: id,
        bytes: btoa(String.fromCharCode(...bytes)),
        seq: ++seq,
      });
      pending.set(seq, frame);
      setStatus(socket.readyState === WebSocket.OPEN ? "Saving" : "Unsaved — disconnected");
      if (socket.readyState === WebSocket.OPEN) socket.send(frame);
    });
    function connect() {
      const session = window.__composedSession;
      socket = new WebSocket(`${session.origin.replace("http:", "ws:")}/?token=${session.token}`);
      socket.onopen = () => {
        socket.send(JSON.stringify({ subscribe: id }));
        for (const frame of pending.values()) socket.send(frame);
      };
      socket.onmessage = (event) => {
        const frame = JSON.parse(event.data);
        if (frame.error) {
          setStatus(`Unsaved — ${frame.error}`);
          socket.close();
          return;
        }
        const bytes = frame.snapshot ?? frame.bytes;
        if (bytes) doc.import(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
        if (frame.snapshot && !view && parent.current)
          view = new EditorView({
            parent: parent.current,
            state: EditorState.create({
              doc: doc.getText("mdx").toString(),
              extensions: [markdown(), LoroSyncPlugin(doc, (d) => d.getText("mdx"))],
            }),
          });
        if (frame.seq) pending.delete(frame.seq);
        setStatus(pending.size ? "Saving" : "Saved");
      };
      socket.onclose = () => {
        if (!stopped) {
          setStatus("Unsaved — disconnected");
          timer = setTimeout(() => {
            void fetch("/session")
              .then((r) => r.json())
              .then((session) => {
                window.__composedSession = session;
                if (!stopped) connect();
              })
              .catch(() => {
                if (!stopped) connect();
              });
          }, 200);
        }
      };
    }
    const offline = () => socket.close();
    window.addEventListener("offline", offline);
    connect();
    return () => {
      window.removeEventListener("offline", offline);
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
      socket.close();
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
