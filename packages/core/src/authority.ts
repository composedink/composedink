import { targetLease } from "./store/target-lease.ts";
import { inverse, applyInverse, type Inverse } from "./model/inverse.ts";
import type { Envelope } from "./store/receipts.ts";
import { LoroDoc, decodeFrontiers, decodeImportBlobMeta } from "loro-crdt";
import type { Store } from "./store/store.ts";
import { read, head } from "./model/read.ts";
import { importSynced, importTyping, isPost } from "./model/text.ts";
import { normalizeThreads } from "./model/threads.ts";
import { failOrphaned, pendingRequests } from "./model/feedback.ts";
/** Sync results: document ids pushed and pulled in one cycle. */
export interface SyncResult {
  pushed: string[];
  pulled: string[];
  lastSyncAt: number;
}
/**
 * The studio's sync loop. Only studio sets it; inline authorities never sync. `start` begins the
 * loop when the home is signed in; `session.login` and `session.logout` go through it.
 */
export interface SyncSlot {
  start(): Promise<void>;
  /** Stops the loop; resolves once its in-flight cycle has settled. */
  stop(): Promise<void>;
  now(id?: string): Promise<SyncResult>;
}
export async function authority(store: Store) {
  const documents = new Map<string, LoroDoc>();
  for (const { id, bytes } of await store.load()) {
    const doc = new LoroDoc();
    for (const b of bytes) doc.import(b);
    documents.set(id, doc);
  }
  const undo = new Map<string, Inverse[][]>();
  const listeners = new Set<(id: string, bytes: Uint8Array) => void>();
  let effects: Envelope["effects"] = [];
  let devices: Envelope["devices"] = [];
  let reconciliations: string[] = [];
  let reconciliationResults: Record<string, unknown> = {};
  let poisoned = false;
  const claimedTargets = new Set<string>();
  let finalizers: Array<() => void> = [];
  let staged: Envelope["writes"] | undefined;
  let queue = Promise.resolve();
  /** Runs `run` on `current` (a fork while staged) and records the resulting update. */
  const modify = async <T>(id: string, current: LoroDoc, run: (doc: LoroDoc) => T) => {
    const doc = staged ? current.fork() : current;
    if (staged) documents.set(id, doc);
    const from = doc.version();
    const result = run(doc);
    // Threads normalize in their own commit after any text change: imported typing stays unchanged.
    if (isPost(doc)) normalizeThreads(doc);
    const bytes = doc.export({ mode: "update", from });
    if (staged) staged.push({ id, create: false, bytes: Buffer.from(bytes).toString("base64") });
    else await store.append(id, bytes);
    return result;
  };
  /** The local oplog already contains everything in this blob. */
  const covered = (doc: LoroDoc, blob: Uint8Array) => {
    const order = decodeImportBlobMeta(blob, true).partialEndVersionVector.compare(
      doc.oplogVersion(),
    );
    return order === -1 || order === 0;
  };
  const self = {
    store,
    sync: undefined as SyncSlot | undefined,
    claimTarget(target: string) {
      if (!claimedTargets.has(target)) {
        const release = targetLease(target);
        this.afterTransaction(() => {
          claimedTargets.delete(target);
          release();
        });
        claimedTargets.add(target);
      }
    },
    afterTransaction(run: () => void) {
      if (!staged) throw Error("Export requires transaction");
      finalizers.push(run);
    },
    subscribe(listener: (id: string, bytes: Uint8Array) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    documents,
    get(id: string) {
      const doc = documents.get(id);
      if (!doc || doc.getMap("meta").get("deleted")) throw new Error(`UnknownDoc: ${id}`);
      return doc;
    },
    synchronize(id: string, base?: string) {
      const doc = this.get(id);
      if (base) {
        try {
          const from = doc.frontiersToVV(decodeFrontiers(Buffer.from(base, "base64")));
          return doc.export({ mode: "update", from });
        } catch {
          // Offline local frontiers may not exist here until retained typing is resent.
        }
      }
      return doc.export({ mode: "snapshot" });
    },
    read(id: string, view: import("./model/projection.ts").View = "full") {
      return read(this.get(id), view);
    },
    async sessionOperation(session: string, run: () => Promise<unknown>) {
      const before = new Map(documents);
      const result = await run();
      const actions = [...documents]
        .filter(([id, doc]) => doc !== before.get(id))
        .map(([id, doc]) => inverse(id, before.get(id), doc));
      if (actions.length) undo.set(session, [...(undo.get(session) ?? []), actions]);
      return result;
    },
    async undo(session: string, after?: (ids: string[]) => Promise<void>) {
      const stack = undo.get(session);
      const actions = stack?.at(-1);
      if (!actions) throw Error("NothingToUndo");
      await this.transaction(undefined, "session-undo", async () => {
        for (const action of actions)
          await this.change(action.id, (doc) => applyInverse(doc, action));
        await after?.(actions.map((action) => action.id));
      });
      stack!.pop();
      return { remaining: stack!.length };
    },
    async transaction(request: string | undefined, hash: string, run: () => Promise<unknown>) {
      const prior = request ? store.journal.lookup(request, hash) : undefined;
      if (prior) return prior.result;
      const before = new Map(documents);
      staged = [];
      finalizers = [];
      effects = [];
      devices = [];
      reconciliations = [];
      reconciliationResults = {};
      let committing = false;
      try {
        const result = await run();
        committing = true;
        await store.journal.commit({
          effects,
          devices,
          reconciliations,
          reconciliationResults,
          request,
          hash,
          result: result ?? null,
          frontiers: Object.fromEntries([...documents].map(([id, doc]) => [id, head(doc)])),
          writes: staged,
          applied: false,
        });
        for (const [id, doc] of documents) {
          if (!listeners.size || doc === before.get(id)) continue;
          const bytes = doc.export({ mode: "update", from: before.get(id)?.version() });
          for (const listener of listeners) listener(id, bytes);
        }
        return result;
      } catch (error) {
        if (committing) poisoned = true;
        documents.clear();
        for (const [id, doc] of before) documents.set(id, doc);
        throw error;
      } finally {
        staged = undefined;
        for (const finish of finalizers) finish();
        finalizers = [];
      }
    },
    /** Stages a device configuration file; written with the transaction's durable receipt. */
    deviceWrite(path: string, text: string) {
      if (!staged) throw Error("Device writes require a transaction");
      devices.push({ path, text });
    },
    async exportPair(
      target: string,
      bytes: [string, string],
      base: string,
      old: [string | null, string | null],
    ) {
      if (staged) effects.push({ target, bytes, base, old });
      else
        await this.transaction(undefined, "export", async () => {
          effects.push({ target, bytes, base, old });
        });
    },
    async reconcile(key: string, id: string, run: (doc: LoroDoc) => unknown): Promise<unknown> {
      if (store.journal.reconciled(key)) return store.journal.reconciliation(key);
      if (reconciliations.includes(key)) return reconciliationResults[key];
      const execute = async () => {
        const result = await this.change(id, run);
        reconciliations.push(key);
        reconciliationResults[key] = result;
        return result;
      };
      return staged ? execute() : this.transaction(undefined, "reconcile", execute);
    },
    async create(id: string, doc: LoroDoc) {
      if (documents.has(id)) throw new Error(`InvalidInvariant: duplicate ${id}`);
      const bytes = doc.export({ mode: "snapshot" });
      if (staged) staged.push({ id, create: true, bytes: Buffer.from(bytes).toString("base64") });
      else await store.create(id, bytes);
      documents.set(id, doc);
      return { doc: id };
    },
    async change<T>(id: string, run: (doc: LoroDoc) => T) {
      return modify(id, this.get(id), run);
    },
    /**
     * Imports blobs relayed by the sync server (inside a `sync-pull` transaction). Blobs the local
     * oplog already covers are skipped; an unknown document is created from the first blob. Deleted
     * documents still import, so `meta.deleted` and later edits converge. Returns whether anything
     * was imported.
     */
    async receive(id: string, blobs: Uint8Array[]) {
      let imported = false;
      let rest = blobs;
      if (!documents.has(id)) {
        if (!rest.length) return false;
        const created = new LoroDoc();
        created.import(rest[0]);
        await this.create(id, created);
        imported = true;
        rest = rest.slice(1);
      }
      const fresh = rest.filter((blob) => !covered(documents.get(id)!, blob));
      if (!fresh.length) return imported;
      await modify(id, documents.get(id)!, (doc) => {
        for (const blob of fresh) if (!covered(doc, blob)) importSynced(doc, blob);
      });
      return true;
    },
    async compact(id: string) {
      await this.serialize(() => store.compact(id, this.get(id).export({ mode: "snapshot" })));
    },
    async typing(id: string, bytes: Uint8Array) {
      await this.transaction(undefined, "typing", async () => {
        await this.change(id, (doc) => importTyping(doc, bytes));
      });
      return { head: head(this.get(id)) };
    },
    serialize<T>(run: () => Promise<T>): Promise<T> {
      const result = queue.then(() => {
        if (poisoned)
          throw new Error("RecoveryRequired: durable transaction failed; restart authority");
        return run();
      });
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
  // Only the lock holder answers feedback, so a pending request at startup has no one working
  // on it: fail it with a retry instruction rather than calling the provider again.
  const orphaned = [...documents]
    .filter(([, doc]) => isPost(doc) && pendingRequests(doc).length)
    .map(([id]) => id);
  if (orphaned.length)
    await self.transaction(undefined, "feedback-orphaned", async () => {
      for (const id of orphaned) await self.change(id, failOrphaned);
    });
  return self;
}
export type Authority = Awaited<ReturnType<typeof authority>>;
