import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LoroSyncPlugin } from "../src/editor/sync";
import { LoroDoc } from "loro-crdt";

export async function runSpike(kind: "map" | "text") {
  const authority = new LoroDoc();
  authority.setPeerId("1");
  // Create and populate the other container BEFORE mdx so its event precedes mdx's in a batch.
  const other = kind === "map" ? authority.getMap("aaa") : authority.getText("aaa");
  if ("set" in other) other.set("seed", "value");
  else other.insert(0, "seed");
  authority.commit();
  const text = authority.getText("mdx");
  text.insert(0, "before");
  authority.commit();
  const replica = new LoroDoc();
  replica.import(authority.export({ mode: "snapshot" }));
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: replica.getText("mdx").toString(),
      extensions: [LoroSyncPlugin(replica, (doc) => doc.getText("mdx"))],
    }),
  });
  await Promise.resolve();
  const batches: string[][] = [];
  replica.subscribe((batch) =>
    batches.push(batch.events.map((event) => `${event.diff.type}:${event.target}`)),
  );
  const base = authority.version();
  if ("set" in other) other.set("key", "value");
  else other.insert(0, "other");
  text.insert(6, " after");
  authority.commit();
  replica.import(authority.export({ mode: "update", from: base }));
  const result = {
    kind,
    batches,
    editor: view.state.doc.toString(),
    loro: replica.getText("mdx").toString(),
  };
  view.destroy();
  return result;
}

export async function runEditing() {
  const doc = new LoroDoc();
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      extensions: [LoroSyncPlugin(doc, (d) => d.getText("mdx"))],
    }),
  });
  await Promise.resolve();
  view.dispatch({
    changes: { from: 0, insert: "😀 **bold** 日本語" },
    selection: { anchor: 3, head: 11 },
  });
  const selected = view.state.sliceDoc(
    view.state.selection.main.from,
    view.state.selection.main.to,
  );
  const authority = doc.fork();
  authority.getMap("deps").set("Card", { id: "composed:test/block", version: "dev" });
  const remoteText = authority.getText("mdx");
  remoteText.insert(remoteText.length, " remote");
  authority.commit();
  doc.import(authority.export({ mode: "update", from: doc.version() }));
  const beforeUndo = view.state.doc.toString();
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      metaKey: /Mac/.test(navigator.platform),
      ctrlKey: !/Mac/.test(navigator.platform),
      bubbles: true,
    }),
  );
  const result = {
    selected,
    beforeUndo,
    afterUndo: view.state.doc.toString(),
    loro: doc.getText("mdx").toString(),
    deps: doc.getMap("deps").toJSON(),
  };
  view.destroy();
  return result;
}
