import { indexState } from "./recovery.ts";
import { exportHistory } from "./export-history.ts";
import { dirname } from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { hash } from "node:crypto";
import { atomicWrite } from "./store.ts";
import { fault } from "./compact.ts";
const schema = z.object({
  target: z.string(),
  old: z.array(z.string().nullable()).length(2),
  bytes: z.tuple([z.string(), z.string()]),
  base: z.string(),
  complete: z.boolean(),
});
export async function fileHash(path: string) {
  try {
    return hash("sha256", await readFile(path));
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return null;
    throw e;
  }
}
export async function finishIntent(path: string) {
  const intent = schema.parse(JSON.parse(await readFile(path, "utf8")));
  if (intent.complete) return;
  const paths = [join(intent.target, "index.mdx"), join(intent.target, "composed.lock.json")];
  const hashes = intent.bytes.map((b) => hash("sha256", b));
  for (let i = 0; i < 2; i++) {
    const current = await fileHash(paths[i]);
    if (current !== intent.old[i] && current !== hashes[i])
      throw new Error(
        `RecoveryRequired: unexpected outside edit at ${paths[i]}; prepared bytes retained in ${path}`,
      );
  }
  for (let i = 0; i < 2; i++) {
    await atomicWrite(paths[i], intent.bytes[i]);
    fault(`export:rename-${i}`);
  }

  await (
    await exportHistory(dirname(dirname(dirname(path))), intent.target)
  ).record(hashes[0], hashes[1], intent.base);
  intent.complete = true;
  await atomicWrite(path, JSON.stringify(intent));
  indexState(dirname(dirname(dirname(path))), "intent", intent.target, JSON.stringify(intent));
}
export async function exportPair(
  home: string,
  target: string,
  bytes: [string, string],
  base: string,
  old: [string | null, string | null],
) {
  const directory = join(home, "state", "intents");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${hash("sha256", target)}.json`);
  try {
    await finishIntent(path);
  } catch (e) {
    if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e;
  }
  await atomicWrite(path, JSON.stringify({ target, old, bytes, base, complete: false }));
  indexState(home, "intent", target, JSON.stringify({ target, old, bytes, base, complete: false }));
  fault("export:intent");
  await finishIntent(path);
}

export async function previewTargets(home: string) {
  const directory = join(home, "state", "intents");
  await mkdir(directory, { recursive: true });
  const targets: Array<{ doc: string; to: string }> = [];
  for (const name of (await readdir(directory)).filter((n) => n.endsWith(".json"))) {
    const intent = schema.parse(JSON.parse(await readFile(join(directory, name), "utf8")));
    if (intent.complete) {
      const lock = z
        .object({ doc: z.string(), mode: z.string() })
        .parse(JSON.parse(intent.bytes[1]));
      if (lock.mode === "preview") targets.push({ doc: lock.doc, to: dirname(intent.target) });
    }
  }
  return targets;
}
