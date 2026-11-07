import { Worker } from "node:worker_threads";
import { jsxProps, object } from "@composedink/blocks";
import type { LintSnapshot } from "@composedink/lint";
import type { LintReply } from "@composedink/lint/worker";
import type { Authority } from "../authority.ts";
import { validateProjection } from "../model/validate.ts";
import { manifest } from "../bundle.ts";
import { readFiles } from "../model/files.ts";
import { documentSettings } from "../kinds.ts";
/** The document's effective rules and reading values exactly as rules.effective reports them. */
export async function lintSettings(a: Authority, id: string) {
  const { warnings, ...settings } = await documentSettings(a.store.home, a.get(id));
  return { settings, warnings };
}
export async function lintSnapshot(a: Authority, id: string): Promise<LintSnapshot> {
  const { text, base } = a.read(id);
  const deps = a.get(id).getMap("deps").toJSON();
  const blocks: NonNullable<LintSnapshot["blocks"]>[number][] = [];
  function walk(node: unknown) {
    if (!object(node)) return;
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      typeof node.name === "string"
    ) {
      const dep = deps[node.name];
      if (
        object(dep) &&
        typeof dep.id === "string" &&
        object(node.position) &&
        object(node.position.start) &&
        object(node.position.end) &&
        typeof node.position.start.offset === "number" &&
        typeof node.position.end.offset === "number"
      ) {
        blocks.push({
          from: node.position.start.offset,
          to: node.position.end.offset,
          props: jsxProps(node.attributes),
          schema: manifest(readFiles(a.get(dep.id)).files["block.tsx"]).props,
        });
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  walk(validateProjection(text, []));
  return { base, text, blocks, settings: (await lintSettings(a, id)).settings };
}
let worker: Worker | undefined;
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: LintReply) => void; reject: (error: Error) => void }
>();
export async function lint(a: Authority, id: string) {
  const snapshot = await lintSnapshot(a, id);
  if (!worker) {
    worker = new Worker(new URL(import.meta.resolve("@composedink/lint/node-worker")));
    worker.on("message", (reply: LintReply) => {
      pending.get(reply.id)?.resolve(reply);
      pending.delete(reply.id);
      if (!pending.size) worker?.unref();
    });
    worker.on("error", (error) => {
      for (const p of pending.values()) p.reject(error);
      pending.clear();
      worker = undefined;
    });
  }
  worker.ref();
  const request = ++sequence;
  const reply = await new Promise<LintReply>((resolve, reject) => {
    pending.set(request, { resolve, reject });
    worker!.postMessage({ id: request, snapshot });
  });
  if ("error" in reply) throw Error(reply.error);
  return reply.result.diagnostics;
}
