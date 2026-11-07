import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { composedServer, type ServerOptions } from "../../src/main.ts";

export const BOOTSTRAP = "bootstrap-secret";

/** A composed server on a random port with temporary storage (reusable across restarts). */
export async function startServer(options: Partial<ServerOptions> = {}) {
  const storage = options.storage ?? (await mkdtemp(join(tmpdir(), "composed-server-")));
  const instance = composedServer({ token: "artifact", bootstrap: BOOTSTRAP, ...options, storage });
  instance.server.listen(0, "127.0.0.1");
  await once(instance.server, "listening");
  const address = instance.server.address();
  if (!address || typeof address === "string") throw Error("address");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    ...instance,
    storage,
    url,
    fetch: (path: string, init?: RequestInit) => fetch(url + path, init),
    async stop() {
      instance.close();
    },
    async remove() {
      instance.close();
      await rm(storage, { recursive: true, force: true });
    },
  };
}
export type TestServer = Awaited<ReturnType<typeof startServer>>;
