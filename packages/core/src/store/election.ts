import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { atomicWrite } from "./store.ts";
const ownerSchema = z.object({
  pid: z.number(),
  processStartTime: z.number(),
  kind: z.enum(["inline", "studio"]),
  socket: z.string(),
  ready: z.boolean(),
});
export async function acquire(
  home: string,
  kind: "inline" | "studio",
  beforeBegin?: () => Promise<void>,
) {
  await mkdir(home, { recursive: true });
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const db = new DatabaseSync(join(home, "authority.db"));
    try {
      db.exec("PRAGMA busy_timeout=0");
      await beforeBegin?.();
      beforeBegin = undefined;
      db.exec("BEGIN EXCLUSIVE");
    } catch (error) {
      db.close();
      if (!error || typeof error !== "object" || !("errcode" in error) || error.errcode !== 5)
        throw error;
      const raw = await readFile(join(home, "owner.json"), "utf8").catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      const owner = raw === null ? null : ownerSchema.parse(JSON.parse(raw));
      if (owner?.ready && (kind === "inline" || owner.kind === "studio"))
        return { kind: "connect" as const, owner };
      await delay(10 + Math.random() * 20);
      continue;
    }
    const info = {
      pid: process.pid,
      processStartTime: Date.now() - process.uptime() * 1000,
      kind,
      socket: `ws://127.0.0.1:${process.env.COMPOSED_PORT ?? 4747}`,
      ready: false,
    };
    try {
      await atomicWrite(join(home, "owner.json"), JSON.stringify(info));
    } catch (error) {
      db.close();
      throw error;
    }
    return {
      kind: "owner" as const,
      async ready() {
        await atomicWrite(join(home, "owner.json"), JSON.stringify({ ...info, ready: true }));
      },
      async close() {
        await unlink(join(home, "owner.json")).catch((e) => {
          if (e.code !== "ENOENT") throw e;
        });
        db.close();
      },
    };
  }
  throw new Error(
    "Authority acquisition timed out after 5 s: owner is not ready or lock contention persists",
  );
}
