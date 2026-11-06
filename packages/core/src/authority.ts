import { inverse, applyInverse, type Inverse } from "./model/inverse.ts";
import type { Envelope } from "./store/receipts.ts";
import { LoroDoc, decodeFrontiers } from "loro-crdt";
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
  const undo = new Map<string, Inverse[][]>();
  const listeners = new Set<(id: string, bytes: Uint8Array) => void>();
  let effects: Envelope["effects"] = [];
  let reconciliations: string[] = [];
  let poisoned = false;
  let staged: Envelope["writes"] | undefined;
  let queue = Promise.resolve();
  return {
    store,
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
    read(id: string) {
      return read(this.get(id));
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
