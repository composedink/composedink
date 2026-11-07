import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { VersionVector, decodeImportBlobMeta } from "loro-crdt";
import { isPost } from "@composedink/core/model";
import { transaction } from "./db.ts";
import { HttpError, query, readBody, sendJson } from "./http.ts";
import type { Auth, Device } from "./auth.ts";
import type { EventHub } from "./events.ts";
import type { Replicas } from "./replicas.ts";
import type { Links } from "./links.ts";

const MiB = 1024 * 1024;
export const LIMITS = {
  update: 8 * MiB,
  snapshot: 64 * MiB,
  page: 8 * MiB,
  snapshotRows: 256,
  snapshotBytes: 4 * MiB,
};
interface DocRow {
  doc_id: string;
  account_id: string;
  kind: "post" | "component";
  snapshot_seq: number;
  snapshot: Uint8Array | null;
  head_seq: number;
}
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
/** `a` is covered by `b`: everything in `a` is already in `b`. */
const covered = (a: VersionVector, b: VersionVector) => {
  const order = a.compare(b);
  return order === -1 || order === 0;
};
const EMPTY = encode(new VersionVector(null).encode());

/**
 * `/sync`: per-document update log, pulls, the change stream and link management, all scoped to the
 * device's account.
 */
export function sync(
  db: DatabaseSync,
  auth: Auth,
  events: EventHub,
  replica: Replicas,
  links: Links,
) {
  const docRow = (docId: string, device: Device) => {
    const row = db.prepare("SELECT * FROM docs WHERE doc_id = ?").get(docId) as DocRow | undefined;
    // A document of another account does not exist for this device.
    if (row && row.account_id !== device.accountId)
      throw new HttpError(404, "UnknownDoc", `no document ${docId}`);
    return row;
  };
  const rowVv = (docId: string, seq: number) => {
    if (seq <= 0) return EMPTY;
    const row = db
      .prepare("SELECT vv FROM updates WHERE doc_id = ? AND seq = ?")
      .get(docId, seq) as { vv: Uint8Array } | undefined;
    return row ? encode(row.vv) : EMPTY;
  };

  function heads(accountId: string) {
    return (
      db
        .prepare("SELECT doc_id, head_seq FROM docs WHERE account_id = ? ORDER BY doc_id")
        .all(accountId) as { doc_id: string; head_seq: number }[]
    ).map((r) => ({ docId: r.doc_id, seq: r.head_seq }));
  }

  async function push(device: Device, docId: string, req: IncomingMessage) {
    const header = req.headers["composed-since"];
    let since: VersionVector;
    try {
      since =
        typeof header === "string" && header
          ? VersionVector.decode(Buffer.from(header, "base64url"))
          : new VersionVector(null);
    } catch {
      throw new HttpError(400, "BadRequest", "Composed-Since is not a version vector");
    }
    docRow(docId, device);
    const bytes = await readBody(req, LIMITS.update);
    // Everything below is synchronous, so pushes to one document cannot interleave.
    const row = docRow(docId, device);
    const doc = replica.get(docId);
    const vv = () => encode(doc.oplogVersion().encode());
    if (!covered(since, doc.oplogVersion()))
      throw new HttpError(409, "Conflict", "Composed-Since is ahead of the server", { vv: vv() });
    let end: VersionVector;
    try {
      end = decodeImportBlobMeta(bytes, true).partialEndVersionVector;
    } catch {
      throw new HttpError(400, "BadRequest", "body is not a Loro update");
    }
    // Dedup by Loro version range: a retry after a lost acknowledgement stores nothing.
    if (covered(end, doc.oplogVersion()))
      return { seq: row?.head_seq ?? 0, vv: vv(), duplicate: true };
    try {
      const status = doc.import(bytes);
      if (status.pending) {
        replica.evict(docId);
        throw new HttpError(409, "Conflict", "update depends on changes the server lacks", {
          vv: encode(replica.get(docId).oplogVersion().encode()),
        });
      }
    } catch (error) {
      replica.evict(docId);
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "BadRequest", "update does not import");
    }
    return { ...append(docId, device.accountId, device.deviceId, bytes, row), duplicate: false };
  }

  /**
   * Stores an update the replica already contains: one transaction for the row (`head_seq + 1`), the
   * `docs` row on a first push, and a snapshot every 256 rows or 4 MiB; then notifies the account's
   * streams. Device pushes and guest comments (`fromDevice` null) both land here. Any failure evicts
   * the replica so it reloads from what was stored.
   */
  function append(
    docId: string,
    accountId: string,
    fromDevice: string | null,
    bytes: Uint8Array,
    row = db.prepare("SELECT * FROM docs WHERE doc_id = ?").get(docId) as DocRow | undefined,
  ) {
    const doc = replica.get(docId);
    const after = doc.oplogVersion().encode();
    const seq = (row?.head_seq ?? 0) + 1;
    try {
      transaction(db, () => {
        if (!row)
          db.prepare("INSERT INTO docs (doc_id, account_id, kind) VALUES (?,?,?)").run(
            docId,
            accountId,
            isPost(doc) ? "post" : "component",
          );
        db.prepare(
          "INSERT INTO updates (doc_id, seq, from_device, bytes, vv, at) VALUES (?,?,?,?,?,?)",
        ).run(docId, seq, fromDevice, bytes, after, Date.now());
        const snapshotSeq = row?.snapshot_seq ?? 0;
        const { size } = db
          .prepare(
            "SELECT coalesce(sum(length(bytes)), 0) AS size FROM updates WHERE doc_id = ? AND seq > ?",
          )
          .get(docId, snapshotSeq) as { size: number };
        if (seq - snapshotSeq >= LIMITS.snapshotRows || size >= LIMITS.snapshotBytes) {
          const snapshot = doc.export({ mode: "snapshot" });
          if (snapshot.length > LIMITS.snapshot)
            throw new HttpError(413, "TooLarge", `snapshot exceeds ${LIMITS.snapshot} bytes`);
          db.prepare("UPDATE docs SET snapshot = ?, snapshot_seq = ? WHERE doc_id = ?").run(
            snapshot,
            seq,
            docId,
          );
        }
        db.prepare("UPDATE docs SET head_seq = ? WHERE doc_id = ?").run(seq, docId);
      });
    } catch (error) {
      replica.evict(docId);
      throw error;
    }
    events.publish(accountId, { docId, seq });
    return { seq, vv: encode(after) };
  }

  function pull(device: Device, docId: string, req: IncomingMessage) {
    const row = docRow(docId, device);
    if (!row) throw new HttpError(404, "UnknownDoc", `no document ${docId}`);
    const raw = query(req.url).get("since") ?? "0";
    if (!/^\d+$/.test(raw)) throw new HttpError(400, "BadRequest", "since is a sequence number");
    const since = Number(raw);
    // Far behind means behind the snapshot: send it plus the rows after it.
    const snapshot =
      since < row.snapshot_seq && row.snapshot
        ? { seq: row.snapshot_seq, bytes: Buffer.from(row.snapshot).toString("base64") }
        : undefined;
    const from = snapshot ? row.snapshot_seq : since;
    const updates: { seq: number; fromDevice: string | null; at: number; bytes: string }[] = [];
    let size = 0;
    for (const r of db
      .prepare(
        "SELECT seq, from_device, at, bytes FROM updates WHERE doc_id = ? AND seq > ? ORDER BY seq",
      )
      .iterate(docId, from) as Iterable<{
      seq: number;
      from_device: string | null;
      at: number;
      bytes: Uint8Array;
    }>) {
      if (updates.length && size + r.bytes.length > LIMITS.page) break;
      size += r.bytes.length;
      updates.push({
        seq: r.seq,
        fromDevice: r.from_device,
        at: r.at,
        bytes: Buffer.from(r.bytes).toString("base64"),
      });
    }
    const last = updates.at(-1)?.seq ?? Math.min(from, row.head_seq);
    return { docId, head: row.head_seq, vv: rowVv(docId, last), snapshot, updates };
  }

  async function handle(req: IncomingMessage, res: ServerResponse, parts: string[]) {
    const device = auth.authenticate(req);
    if (parts[2] === "links") return links.handle(req, res, parts, device);
    if (req.method === "GET" && parts[2] === "events" && parts.length === 3)
      return events.open(device, res, heads(device.accountId));
    if (parts[2] === "docs" && parts[3] && parts[4] === "updates" && parts.length === 5) {
      if (req.method === "POST") return sendJson(res, 200, await push(device, parts[3], req));
      if (req.method === "GET") return sendJson(res, 200, pull(device, parts[3], req));
    }
    throw new HttpError(404, "NotFound", "no such route");
  }
  return { handle, append };
}
export type Append = ReturnType<typeof sync>["append"];
