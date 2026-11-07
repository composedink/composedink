import { LoroDoc } from "loro-crdt";
import type { DatabaseSync } from "node:sqlite";

/**
 * One in-memory Loro replica per synced document, loaded lazily from `docs.snapshot` plus the
 * update rows after `snapshot_seq`. A failed import evicts the replica so it reloads from the DB.
 */
export function replicas(db: DatabaseSync) {
  const loaded = new Map<string, LoroDoc>();
  return {
    get(docId: string) {
      let doc = loaded.get(docId);
      if (doc) return doc;
      doc = new LoroDoc();
      const row = db
        .prepare("SELECT snapshot, snapshot_seq FROM docs WHERE doc_id = ?")
        .get(docId) as { snapshot: Uint8Array | null; snapshot_seq: number } | undefined;
      if (row?.snapshot) doc.import(row.snapshot);
      const rows = db
        .prepare("SELECT bytes FROM updates WHERE doc_id = ? AND seq > ? ORDER BY seq")
        .all(docId, row?.snapshot_seq ?? 0) as { bytes: Uint8Array }[];
      if (rows.length) doc.importBatch(rows.map((r) => r.bytes));
      loaded.set(docId, doc);
      return doc;
    },
    evict(docId: string) {
      loaded.delete(docId);
    },
  };
}
export type Replicas = ReturnType<typeof replicas>;
