import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "./http.ts";
import type { Auth } from "./auth.ts";
import type { EventHub } from "./events.ts";

/** `/sync`: per-document update log, pulls and the change stream, all scoped to the device's account. */
export function sync(db: DatabaseSync, auth: Auth, events: EventHub) {
  function heads(accountId: string) {
    return (
      db
        .prepare("SELECT doc_id, head_seq FROM docs WHERE account_id = ? ORDER BY doc_id")
        .all(accountId) as { doc_id: string; head_seq: number }[]
    ).map((r) => ({ docId: r.doc_id, seq: r.head_seq }));
  }
  async function handle(req: IncomingMessage, res: ServerResponse, parts: string[]) {
    const device = auth.authenticate(req);
    if (req.method === "GET" && parts[2] === "events" && parts.length === 3)
      return events.open(device, res, heads(device.accountId));
    throw new HttpError(404, "NotFound", "no such route");
  }
  return { handle };
}
