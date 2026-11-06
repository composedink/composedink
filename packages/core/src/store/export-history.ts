import { indexState } from "./recovery.ts";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "node:crypto";
import { z } from "zod";
import { atomicWrite } from "./store.ts";
const schema = z.array(
  z.object({ mdxHash: z.string(), lockHash: z.string(), base: z.string(), at: z.number() }),
);
export async function exportHistory(home: string, target: string) {
  const directory = join(home, "state", "exports");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${hash("sha256", target)}.json`);
  const raw = await readFile(path, "utf8").catch((e) => {
    if (e.code === "ENOENT") return "[]";
    throw e;
  });
  const entries = schema.parse(JSON.parse(raw));
  return {
    entries,
    async record(mdxHash: string, lockHash: string, base: string) {
      entries.push({ mdxHash, lockHash, base, at: Date.now() });
      await atomicWrite(path, JSON.stringify(entries));
      indexState(home, "history", target, JSON.stringify(entries));
    },
  };
}
