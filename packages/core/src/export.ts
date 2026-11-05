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
import { atomicWrite } from "./store/store.ts";
const sessions = new WeakMap<Authority, Map<string, string>>();
export async function preview(a: Authority, docId: string, to: string) {
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
  const mdxPath = join(directory, "index.mdx");
  const lockPath = join(directory, "composed.lock.json");
  const lockBytes = JSON.stringify(lock, null, 2) + "\n";
  const oldHashes = await Promise.all(
    [mdxPath, lockPath].map(async (path) => {
      try {
        return sha256(await readFile(path));
      } catch (error) {
        if (object(error) && error.code === "ENOENT") return null;
        throw error;
      }
    }),
  );
  const intent = join(a.store.home, `export-${sha256(directory)}.json`);
  await atomicWrite(
    intent,
    JSON.stringify({ target: directory, oldHashes, newHashes: [sha256(text), sha256(lockBytes)] }),
  );
  await atomicWrite(mdxPath, text);
  await atomicWrite(lockPath, lockBytes);
  let pairs = sessions.get(a);
  if (!pairs) {
    pairs = new Map();
    sessions.set(a, pairs);
  }
  pairs.set(docId, to);
  return { directory, lock };
}
export async function refreshPreviews(a: Authority, component: string) {
  for (const [doc, to] of sessions.get(a) ?? []) {
    const deps = a.get(doc).getMap(KEYS.deps).toJSON();
    if (
      Object.values(deps).some(
        (dep) => object(dep) && dep.id === component && dep.version === "dev",
      )
    )
      await preview(a, doc, to);
  }
}
