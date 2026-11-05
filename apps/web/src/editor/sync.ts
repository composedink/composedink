/**
 * Corrected binding for loro-codemirror 0.3.3.
 * Upstream multi-container report: https://github.com/loro-dev/loro-codemirror/pull/27
 * Initialization issue: https://github.com/loro-dev/loro-codemirror/issues/24
 * One subscription handles imports, checkout and UndoManager changes.
 */
import { Annotation, type ChangeSpec, type Extension } from "@codemirror/state";
import { keymap, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { type LoroDoc, type LoroText, UndoManager } from "loro-crdt";

const synced = Annotation.define<boolean>();
export function LoroSyncPlugin(doc: LoroDoc, getText: (doc: LoroDoc) => LoroText): Extension {
  const undo = new UndoManager(doc, {});
  return [
    keymap.of([
      {
        key: "Mod-z",
        run: () => {
          undo.undo();
          return true;
        },
      },
      {
        key: "Mod-Shift-z",
        run: () => {
          undo.redo();
          return true;
        },
      },
    ]),
    ViewPlugin.define((view) => new Binding(view, doc, getText, undo)),
  ];
}
class Binding {
  private unsubscribe: () => void;
  private destroyed = false;
  constructor(
    private view: EditorView,
    private doc: LoroDoc,
    private getText: (doc: LoroDoc) => LoroText,
    private undo: UndoManager,
  ) {
    this.unsubscribe = doc.subscribe((batch) => {
      if (batch.by === "local" && batch.origin !== "undo") return;
      const text = getText(doc);
      if (batch.by === "checkout") {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text.toString() },
          annotations: synced.of(true),
        });
        return;
      }
      const changes: ChangeSpec[] = [];
      for (const { diff, target } of batch.events) {
        if (diff.type !== "text" || target !== text.id) continue;
        let pos = 0;
        for (const delta of diff.diff) {
          if (delta.insert !== undefined) changes.push({ from: pos, insert: delta.insert });
          else if (delta.delete !== undefined) {
            changes.push({ from: pos, to: pos + delta.delete });
            pos += delta.delete;
          } else if (delta.retain !== undefined) pos += delta.retain;
        }
      }
      if (changes.length) view.dispatch({ changes, annotations: synced.of(true) });
    });
    queueMicrotask(() => {
      if (this.destroyed) return;
      const text = getText(doc).toString();
      if (view.state.doc.toString() !== text)
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          annotations: synced.of(true),
        });
    });
  }
  update(update: ViewUpdate) {
    for (const transaction of update.transactions) {
      if (!transaction.docChanged || transaction.annotation(synced)) continue;
      let adjustment = 0;
      const text = this.getText(this.doc);
      transaction.changes.iterChanges((from, to, _fromB, _toB, insert) => {
        if (to !== from) text.delete(from + adjustment, to - from);
        const value = insert.toString();
        if (value) text.insert(from + adjustment, value);
        adjustment += value.length - (to - from);
      });
      this.doc.commit();
    }
  }
  destroy() {
    this.destroyed = true;
    this.unsubscribe();
    this.undo.free();
  }
}
