import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connect, ensureStudio } from "./client.ts";
import { setTimeout as delay } from "node:timers/promises";
export async function desktop(home: string) {
  process.env.COMPOSED_DESKTOP_OWNER = "1";
  let detached = false;
  let socket: Awaited<ReturnType<typeof connect>> | undefined;
  process.stdin.resume();
  process.stdin.once("end", () => {
    detached = true;
    socket?.close();
  });
  while (!detached) {
    try {
      await ensureStudio(home);
      socket = await connect(home);
      const info = JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
      const url = new URL(info.socket);
      url.protocol = "http:";
      console.log(JSON.stringify({ url: url.origin, pid: info.pid }));
      await new Promise<void>((resolve) => socket!.once("close", () => resolve()));
    } catch (error) {
      console.error(String(error));
    }
    if (!detached) await delay(100);
  }
}
