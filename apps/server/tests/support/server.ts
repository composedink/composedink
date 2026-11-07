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

/** Bootstraps the account and returns the first device's token. */
export async function bootstrapDevice(s: TestServer, deviceName = "A") {
  const response = await s.fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceName, bootstrap: BOOTSTRAP }),
  });
  return ((await response.json()) as { token: string; deviceId: string; accountId: string }).token;
}

/** A device-authenticated JSON request. */
export async function deviceJson(s: TestServer, token: string, path: string, body?: unknown) {
  const response = await s.fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

/** Pushes an update for `docId` from the device, starting at `since` (base64url vv). */
export async function pushDoc(
  s: TestServer,
  token: string,
  docId: string,
  bytes: Uint8Array,
  since = "",
) {
  const response = await s.fetch(`/sync/docs/${encodeURIComponent(docId)}/updates`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "composed-since": since,
    },
    body: Buffer.from(bytes),
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}
