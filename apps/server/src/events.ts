import type { ServerResponse } from "node:http";

const PING_MS = 25_000;
interface Stream {
  deviceId: string;
  res: ServerResponse;
}

/** `text/event-stream` connections per account: `heads` first, then `doc` per change. */
export function eventHub() {
  const accounts = new Map<string, Set<Stream>>();
  const write = (stream: Stream, event: string, data: unknown) =>
    stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return {
    open(
      device: { deviceId: string; accountId: string },
      res: ServerResponse,
      heads: { docId: string; seq: number }[],
    ) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const stream = { deviceId: device.deviceId, res };
      let set = accounts.get(device.accountId);
      if (!set) accounts.set(device.accountId, (set = new Set()));
      set.add(stream);
      write(stream, "heads", { docs: heads });
      const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
      res.on("close", () => {
        clearInterval(ping);
        set.delete(stream);
      });
    },
    publish(accountId: string, data: { docId: string; seq: number }) {
      for (const stream of accounts.get(accountId) ?? []) write(stream, "doc", data);
    },
    /** Revocation ends the device's streams. */
    closeDevice(deviceId: string) {
      for (const set of accounts.values())
        for (const stream of set) if (stream.deviceId === deviceId) stream.res.end();
    },
    closeAll() {
      for (const set of accounts.values()) for (const stream of set) stream.res.end();
    },
  };
}
export type EventHub = ReturnType<typeof eventHub>;
