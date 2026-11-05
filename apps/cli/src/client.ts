import { readFile } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
export const composedHome = () =>
  process.env.COMPOSED_HOME ?? join(process.env.HOME ?? ".", ".composed");
export async function connect(home: string) {
  const lock: unknown = JSON.parse(
    await readFile(join(home, "workspace.lock"), "utf8").catch(() => {
      throw new Error("fix: composed studio");
    }),
  );
  if (!lock || typeof lock !== "object" || !("socket" in lock) || typeof lock.socket !== "string")
    throw new Error("fix: composed studio");
  const token = await readFile(join(home, "session.token"), "utf8");
  const url = new URL(lock.socket);
  url.searchParams.set("token", token);
  const socket = new WebSocket(url, { origin: `http://${url.host}` });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", () => reject(new Error("fix: composed studio")));
  });
  return socket;
}
export async function call(home: string, name: string, input: unknown) {
  const socket = await connect(home);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      socket.on("message", (bytes) => {
        const result = JSON.parse(
          (Array.isArray(bytes)
            ? Buffer.concat(bytes)
            : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
          ).toString(),
        );
        if (result.request !== 1) return;
        if (result.error) reject(new Error(result.error));
        else resolve(result.result);
      });
      socket.send(JSON.stringify({ request: 1, name, input }));
    });
  } finally {
    socket.close();
  }
}
