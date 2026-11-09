import { ViewPlugin, type EditorView } from "@codemirror/view";
import { encodeFrontiers, type LoroDoc } from "loro-crdt";
import {
  configIdentity,
  type Diagnostic,
  type LintSettings,
  type LintSnapshot,
  type Sentence,
} from "@composedink/lint";
import type { LintReply, LintRequest } from "@composedink/lint/worker";
import { diagnosticGutter, diagnosticKey, diagnosticMarks, setDiagnostics } from "./diagnostics";
export function lintBase(doc: LoroDoc) {
  return btoa(String.fromCharCode(...encodeFrontiers(doc.frontiers())))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export class LatestLint {
  private id = 0;
  invalidate() {
    return ++this.id;
  }
  request(snapshot: LintSnapshot): LintRequest {
    return { id: this.invalidate(), snapshot };
  }
  current(id: number) {
    return id === this.id;
  }
  /** A reply counts only for the newest request, the current base and the current rules. */
  accept(reply: LintReply, base: string, config: string) {
    return reply.id === this.id &&
      "result" in reply &&
      reply.result.base === base &&
      reply.result.config === config
      ? reply.result
      : undefined;
  }
}
/** The sentences of the newest accepted result and the document base they were measured at. */
export interface Measured {
  readonly base: string;
  readonly sentences: readonly Sentence[];
}
export function lintFeedback(
  doc: LoroDoc,
  show: (diagnostics: Diagnostic[], base: string, measured: Measured | undefined) => void,
  fail: (message: string) => void,
) {
  const worker = new Worker(new URL("./lint-worker.ts", import.meta.url), { type: "module" });
  const latest = new LatestLint();
  const dismissed = new Set<string>();
  let view: EditorView | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let current: Diagnostic[] = [];
  // Kept across edits so the sparkline stays drawn; consumers compare its base before jumping.
  let measured: Measured | undefined;
  let blocks: LintSnapshot["blocks"] = [];
  let blocksBase = "";
  // Effective rules come from the authority (rules.effective); lint waits until they arrive.
  let settings: LintSettings | undefined;
  // Zen hides decorations only; requests and newest results continue so leaving zen is instant.
  let zen = false;
  const render = () => {
    const visible = current.filter((d) => !dismissed.has(diagnosticKey(d)));
    view?.dispatch({ effects: setDiagnostics.of(zen ? [] : visible) });
    show(visible, lintBase(doc), measured);
  };
  const schedule = () => {
    latest.invalidate();
    current = [];
    clearTimeout(timer);
    queueMicrotask(() => {
      if (stopped) return;
      render();
      timer = setTimeout(() => {
        if (stopped || !settings) return;
        const base = lintBase(doc);
        worker.postMessage(
          latest.request({
            base,
            text: doc.getText("mdx").toString(),
            blocks: base === blocksBase ? blocks : [],
            settings,
          }),
        );
      }, 120);
    });
  };
  worker.onmessage = (event: MessageEvent<LintReply>) => {
    if (stopped || !latest.current(event.data.id)) return;
    const result = settings && latest.accept(event.data, lintBase(doc), configIdentity(settings));
    if (result) {
      current = result.diagnostics;
      measured = { base: result.base, sentences: result.sentences };
      render();
    } else if ("error" in event.data) fail(event.data.error);
  };
  worker.onerror = (event) => fail(event.message);
  const destroy = () => {
    stopped = true;
    clearTimeout(timer);
    worker.terminate();
  };
  return {
    destroy,
    extension: [
      diagnosticMarks,
      diagnosticGutter,
      ViewPlugin.define((v) => {
        view = v;
        const unsubscribe = doc.subscribe(schedule);
        schedule();
        return {
          update(u) {
            if (u.docChanged) schedule();
          },
          destroy() {
            unsubscribe();
            destroy();
          },
        };
      }),
    ],
    dismiss(items: readonly Diagnostic[]) {
      for (const d of items) dismissed.add(diagnosticKey(d));
      render();
    },
    setZen(on: boolean) {
      zen = on;
      render();
    },
    setSettings(value: LintSettings) {
      if (settings && configIdentity(settings) === configIdentity(value)) return;
      settings = value;
      schedule();
    },
    setBlocks(base: string, value: LintSnapshot["blocks"]) {
      if (base !== lintBase(doc)) return;
      blocksBase = base;
      blocks = value;
      schedule();
    },
  };
}
