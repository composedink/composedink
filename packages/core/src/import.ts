import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonical, parseLock } from "@composedink/blocks";
import type { Authority } from "./authority.ts";
import { sha256 } from "./bundle.ts";
import { exportHistory } from "./store/export-history.ts";
import { projection } from "./model/projection.ts";
import { baseFork } from "./model/selection.ts";
import { apply } from "./model/apply.ts";
import { retainMeta } from "./model/text.ts";
import {
  exportStrip,
  frontmatterValues,
  readingValues,
  removeRanges,
  restoreStripped,
  stripRanges,
} from "./kinds.ts";
export async function importFile(a: Authority, docId: string, directory: string) {
  const target = await realpath(resolve(directory)),
    path = join(target, "index.mdx");

  const [outside, lockBytes] = await Promise.all([
    readFile(path, "utf8"),
    readFile(join(target, "composed.lock.json"), "utf8"),
  ]);
  const lock = parseLock(JSON.parse(lockBytes));
  if (lock.doc !== docId) throw Error("RecoveryRequired: lock belongs to another document");
  const history = await exportHistory(a.store.home, target),
    last = history.entries.at(-1);
  if (!last || sha256(lockBytes) !== last.lockHash)
    throw Error("RecoveryRequired: export lock changed or history missing");
  const outsideHash = sha256(outside);
  if (outsideHash !== lock.sha256) {
    const earlier = history.entries.find((e) => e.mdxHash === outsideHash);
    if (earlier)
      throw Error(
        `RecoveryRequired: outside MDX matches earlier version ${earlier.base}; current lock version ${lock.base}`,
      );
  }
  const base = baseFork(a.get(docId), lock.base);
  const strip = await exportStrip(a.store.home, a.get(docId));
  const full = projection(base, lock.view).text;
  const stripped = stripRanges(full, strip);
  if (sha256(removeRanges(full, stripped)) !== lock.sha256)
    throw Error("RecoveryRequired: lock does not match retained base projection");
  // The outside file lacks stripped keys; rebase its edit so the source keeps them.
  const text = restoreStripped(full, stripped, outside);
  const key = canonical([target, lock.base, outsideHash]);
  return a.reconcile(key, docId, (doc) => {
    retainMeta(doc, readingValues(frontmatterValues(text), strip));
    const result = apply(doc, {
      base: lock.base,
      view: lock.view,
      text,
      mode: "direct",
      by: { kind: "human" },
    });
    return { head: result.head, imported: outsideHash !== lock.sha256 };
  });
}
