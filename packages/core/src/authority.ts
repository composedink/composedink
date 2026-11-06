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
    async create(id: string, doc: LoroDoc) {
      if (documents.has(id)) throw new Error(`InvalidInvariant: duplicate ${id}`);
      await store.create(id, doc.export({ mode: "snapshot" }));
      documents.set(id, doc);
      return { doc: id };
    },
    async change<T>(id: string, run: (doc: LoroDoc) => T) {
      const doc = this.get(id);
      const from = doc.version();
      const result = run(doc);
      await store.append(id, doc.export({ mode: "update", from }));
      return result;
    },
    async compact(id: string) {
      await this.serialize(() => store.compact(id, this.get(id).export({ mode: "snapshot" })));
    },
    async typing(id: string, bytes: Uint8Array) {
      await this.change(id, (doc) => importTyping(doc, bytes));
      return { head: head(this.get(id)) };
    },
    serialize<T>(run: () => Promise<T>): Promise<T> {
      const result = queue.then(run);
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
}
export type Authority = Awaited<ReturnType<typeof authority>>;
