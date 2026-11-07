import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const serverEntry = resolve(import.meta.dirname, "../../../../apps/server/src/main.ts");
export const BOOTSTRAP = "core-share-bootstrap";

/** `apps/server` as a real process on a random port with temporary storage. */
export async function spawnServer() {
  const storage = await mkdtemp(join(tmpdir(), "core-share-server-"));
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", serverEntry],
    {
      env: {
        ...process.env,
        COMPOSED_STORAGE: storage,
        COMPOSED_TOKEN: "artifact",
        COMPOSED_BOOTSTRAP_TOKEN: BOOTSTRAP,
        PORT: "0",
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const port = await new Promise<number>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk;
      const match = /"port":(\d+)/.exec(output);
      if (match) resolve(Number(match[1]));
    });
    child.once("exit", (code) => reject(Error(`server exited ${code}`)));
  });
  /** A short-lived connection to `server.db` (WAL; the server keeps its own open). */
  const db = <T>(run: (db: DatabaseSync) => T) => {
    const handle = new DatabaseSync(join(storage, "server.db"));
    try {
      return run(handle);
    } finally {
      handle.close();
    }
  };
  return {
    url: `http://127.0.0.1:${port}`,
    db,
    async close() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
      await rm(storage, { recursive: true, force: true });
    },
  };
}
export type ServerProcess = Awaited<ReturnType<typeof spawnServer>>;
