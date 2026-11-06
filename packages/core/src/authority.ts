import type { Envelope } from "./store/receipts.ts";
import { LoroDoc } from "loro-crdt";
import type { Store } from "./store/store.ts";
import { read, head } from "./model/read.ts";
import { importTyping } from "./model/text.ts";
export async function authority(store: Store) {
  const documents = new Map<string, LoroDoc>();
  for (const { id, bytes } of await store.load()) {
    const doc = new LoroDoc();
    for (const b of bytes) doc.import(b);
    documents.set(id, doc);
  }
  let effects: Envelope["effects"] = [];
  let reconciliations: string[] = [];
  let poisoned = false;
  let staged: Envelope["writes"] | undefined;
  let queue = Promise.resolve();
  return {
    store,
    documents,
    get(id: string) {
      const doc = documents.get(id);
      if (!doc) throw new Error(`UnknownDoc: ${id}`);
      return doc;
    },
    read(id: string) {
      return read(this.get(id));
    },
    async transaction(request: string | undefined, hash: string, run: () => Promise<unknown>) {
      const prior = request ? store.journal.lookup(request, hash) : undefined;
      if (prior) return prior.result;
      const before = new Map(documents);
      staged = [];
      effects = [];
      reconciliations = [];
      let committing = false;
      try {
        const result = await run();
        committing = true;
        await store.journal.commit({
          effects,
          reconciliations,
          request,
          hash,
          result: result ?? null,
          frontiers: Object.fromEntries([...documents].map(([id, doc]) => [id, head(doc)])),
          writes: staged,
          applied: false,
        });
        return result;
      } catch (error) {
        if (committing) poisoned = true;
        documents.clear();
        for (const [id, doc] of before) documents.set(id, doc);
        throw error;
      } finally {
        staged = undefined;
      }
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
    async reconcile(key: string, id: string, run: (doc: LoroDoc) => void) {
      if (store.journal.reconciled(key) || reconciliations.includes(key)) return;
      if (staged) {
        await this.change(id, run);
        reconciliations.push(key);
      } else
        await this.transaction(undefined, "reconcile", async () => {
          await this.change(id, run);
          reconciliations.push(key);
        });
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
      const doc = staged ? this.get(id).fork() : this.get(id);
      if (staged) documents.set(id, doc);
      const from = doc.version();
      const result = run(doc);
      const bytes = doc.export({ mode: "update", from });
      if (staged) staged.push({ id, create: false, bytes: Buffer.from(bytes).toString("base64") });
      else await store.append(id, bytes);
      return result;
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
}
export type Authority = Awaited<ReturnType<typeof authority>>;
