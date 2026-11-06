import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { acquire, authority, openStore, bind } from "@composedink/core/node";
import { spawn } from "node:child_process";
import WebSocket from "ws";
export { composedHome } from "./config.ts";
export async function connect(home: string) {
  const lock: unknown = JSON.parse(
    await readFile(join(home, "owner.json"), "utf8").catch(() => {
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
export async function call(home: string, name: string, input: unknown, studioRequired = false) {
  if (name === "export" || studioRequired) {
    await ensureStudio(home);
  } else {
    const lock = await acquire(home, "inline");
    if (lock.kind === "owner")
      try {
        return await bind(await authority(await openStore(home)))(name, input);
      } finally {
        await lock.close();
      }
  }
  const socket = await connect(home);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      socket.once("close", () =>
        reject(
          new Error("Authority disconnected before acknowledgement; retry with the same request"),
        ),
      );
      socket.once("error", reject);
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

export async function ensureStudio(home: string) {
  try {
    const info = JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
    if (info.kind === "studio" && info.ready) {
      const socket = await connect(home);
      socket.close();
      return;
    }
  } catch {}

  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      new URL("./main.ts", import.meta.url).pathname,
      "studio",
      "--headless",
    ],
    { env: { ...process.env, COMPOSED_HOME: home }, detached: true, stdio: "ignore" },
  );
  child.unref();
  for (let i = 0; i < 250; i++) {
    try {
      const info = JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
      if (info.kind === "studio" && info.ready) {
        const socket = await connect(home);
        socket.close();
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("TargetBusy: studio did not become ready; retry composed studio --headless");
}
