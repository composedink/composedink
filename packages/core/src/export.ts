import { importFile } from "./import.ts";
import { validateProjection } from "./model/validate.ts";
import { snippet } from "./model/stash.ts";
import type { View } from "./model/projection.ts";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applyDefaults, canonical, jsxProps, object, type ExportLock } from "@composedink/blocks";
import type { Authority } from "./authority.ts";
import { project } from "./model/projection.ts";
import { KEYS } from "./model/keys.ts";
import { readFiles } from "./model/files.ts";
import { bundle, sha256 } from "./bundle.ts";
import { evaluateFallback } from "./fallback/evaluator.ts";
import { fileHash, previewTargets } from "./store/intents.ts";
import { exportHistory } from "./store/export-history.ts";
export async function preview(a: Authority, docId: string, to: string, view: View = "clean") {
  const target = resolve(to, a.read(docId).slug);
  const old: [string | null, string | null] = [
    await fileHash(join(target, "index.mdx")),
    await fileHash(join(target, "composed.lock.json")),
  ];
  const history = await exportHistory(a.store.home, target);
  if (
    !history.entries.length &&
    ((await fileHash(join(target, "index.mdx"))) ||
      (await fileHash(join(target, "composed.lock.json"))))
  )
    throw new Error("RecoveryRequired: existing export pair has no local history");
  if (history.entries.length) {
    const current = await fileHash(join(target, "index.mdx"));
    const lockHash = await fileHash(join(target, "composed.lock.json"));
    const last = history.entries.at(-1)!;
    if (lockHash !== last.lockHash)
      throw new Error("RecoveryRequired: export lock changed; preserve bytes");
    if (current !== last.mdxHash) {
      if (!current) throw Error("RecoveryRequired: outside MDX missing");
      await importFile(a, docId, target);
    }
  }
  const projected = project(a.get(docId), view);
  const text = projected.text;
  const ast = validateProjection(
    text,
    snippet(a.get(docId), 0, a.get(docId).getText("mdx").length).dim,
  );
  const lock: ExportLock = {
    composed: 1,
    mode: "preview",
    doc: projected.doc,
    base: projected.base,
    view,
    sha256: sha256(text),
    blocks: {},
  };
  const deps = a.get(docId).getMap(KEYS.deps).toJSON();
  const uses: Array<{ tag: string; node: Record<string, unknown> }> = [];
  function walk(node: unknown) {
    if (!object(node)) return;
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      typeof node.name === "string" &&
      node.name in deps
    )
      uses.push({ tag: node.name, node });
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  walk(ast);
  for (const { tag, node } of uses) {
    const dep = deps[tag];
    if (!object(dep) || typeof dep.id !== "string" || dep.version !== "dev")
      throw new Error("UnpinnedDependency");
    if (Array.isArray(node.children) && node.children.length)
      throw new Error("Block children are not supported");
    const built = await bundle(
      a.store.home,
      dep.id,
      readFiles(a.get(dep.id)).files,
      process.env.COMPOSED_ARTIFACT_ORIGIN ??
        `http://127.0.0.1:${process.env.COMPOSED_ARTIFACT_PORT ?? 4848}`,
    );
    const props = applyDefaults(built.props, jsxProps(node.attributes));
    const hash = sha256(canonical(props));
    const descriptor = (lock.blocks[tag] ??= {
      id: dep.id,
      version: built.version,
      kind: built.kind,
      entry: built.entry,
      sourceHash: built.sourceHash,
      props: built.props,
      instances: {},
    });
    if (!descriptor.instances[hash])
      descriptor.instances[hash] = {
        props,
        markdown: await evaluateFallback(built.fallback, props),
      };
  }
  const directory = resolve(to, projected.slug);
  await mkdir(directory, { recursive: true });
  const lockBytes = JSON.stringify(lock, null, 2) + "\n";
  await a.exportPair(directory, [text, lockBytes], projected.base, old);
  return { directory, lock };
}
export async function refreshPreviews(a: Authority, component: string) {
  const diagnostics: Array<{ code: "BuildFailed"; doc: string; message: string }> = [];
  for (const { doc, to } of await previewTargets(a.store.home)) {
    const deps = a.get(doc).getMap(KEYS.deps).toJSON();
    if (
      doc === component ||
      Object.values(deps).some(
        (dep) => object(dep) && dep.id === component && dep.version === "dev",
      )
    ) {
      const lock = JSON.parse(
        await readFile(resolve(to, a.read(doc).slug, "composed.lock.json"), "utf8"),
      );
      try {
        await preview(a, doc, to, lock.view === "full" ? "full" : "clean");
      } catch (error) {
        diagnostics.push({ code: "BuildFailed", doc, message: String(error) });
      }
    }
  }
  return diagnostics;
}
