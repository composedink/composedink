import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createProcessor } from "@mdx-js/mdx";
import { applyDefaults, canonical, jsxProps, object, type ExportLock } from "@composedink/blocks";
import type { Authority } from "./authority.ts";
import { project } from "./model/projection.ts";
import { KEYS } from "./model/keys.ts";
import { readFiles } from "./model/files.ts";
import { bundle, sha256 } from "./bundle.ts";
import { evaluateFallback } from "./fallback/evaluator.ts";
import { importOutside } from "./model/text.ts";
import { fileHash, previewTargets } from "./store/intents.ts";
import { exportHistory } from "./store/export-history.ts";
export async function preview(a: Authority, docId: string, to: string) {
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
      if (!current || history.entries.some((e) => e.mdxHash === current))
        throw new Error("RecoveryRequired: MDX matches an old export or is missing");
      const outside = await readFile(join(target, "index.mdx"), "utf8");
      const key = canonical([target, last.base, current]);
      await a.reconcile(key, docId, (doc) => importOutside(doc, last.base, outside));
    }
  }
  const projected = project(a.get(docId));
  const text = projected.text;
  const lock: ExportLock = {
    composed: 1,
    mode: "preview",
    doc: projected.doc,
    base: projected.base,
    view: "full",
    sha256: sha256(text),
    blocks: {},
  };
  const deps = a.get(docId).getMap(KEYS.deps).toJSON();
  const ast = createProcessor().parse(text);
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
  for (const { doc, to } of await previewTargets(a.store.home)) {
    const deps = a.get(doc).getMap(KEYS.deps).toJSON();
    if (
      Object.values(deps).some(
        (dep) => object(dep) && dep.id === component && dep.version === "dev",
      )
    )
      await preview(a, doc, to);
  }
}
