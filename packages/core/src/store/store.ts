import { exportPair } from "./intents.ts";
import { receipts } from "./receipts.ts";
import { basename } from "node:path";
import { fault } from "./compact.ts";
import { mkdir, open, rename, unlink, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, hash } from "node:crypto";
export async function atomicWrite(path: string, bytes: Uint8Array | string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx");
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  fault(`${basename(path)}:prepared`);
  await rename(temporary, path);
  fault(`${basename(path)}:renamed`);
  const directory = await open(join(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export const digest = (bytes: Uint8Array) => hash("sha256", bytes);
async function checkedWrite(path: string, bytes: Uint8Array) {
  const metadata = Buffer.from(
    JSON.stringify({ length: bytes.length, hash: digest(bytes) }) + "\n",
  );
  await atomicWrite(path, Buffer.concat([metadata, bytes]));
}
async function checkedRead(path: string) {
  const envelope = await readFile(path);
  const newline = envelope.indexOf(10);
  try {
    const meta = JSON.parse(envelope.subarray(0, newline).toString());
    const bytes = envelope.subarray(newline + 1);
    if (meta.length !== bytes.length || meta.hash !== digest(bytes)) throw new Error();
    return bytes;
  } catch {
    throw new Error(`RecoveryRequired: corrupt committed segment ${path}`);
  }
}
export async function openStore(home: string) {
  await mkdir(join(home, "docs"), { recursive: true });
  const directory = (id: string) => join(home, "docs", Buffer.from(id).toString("base64url"));
  const store = {
    home,
    async load() {
      const result: Array<{ id: string; bytes: Uint8Array[] }> = [];
      for (const name of await readdir(join(home, "docs"))) {
        const path = join(home, "docs", name);
        const bytes = [await checkedRead(join(path, "snapshot.loro"))];
        const names = await readdir(join(path, "updates"));
        for (const name of names)
          if (!/^\d+\.loro$/.test(name) && !name.endsWith(".tmp"))
            throw new Error(`RecoveryRequired: corrupt committed segment ${name}`);
        for (const update of (await readdir(join(path, "updates")))
          .filter((n) => /^\d+\.loro$/.test(n))
          .sort((a, b) => parseInt(a) - parseInt(b)))
          bytes.push(await checkedRead(join(path, "updates", update)));
        result.push({ id: Buffer.from(name, "base64url").toString(), bytes });
      }
      return result;
    },
    async create(id: string, bytes: Uint8Array) {
      const path = directory(id);
      await mkdir(join(path, "updates"), { recursive: true });
      await checkedWrite(join(path, "snapshot.loro"), bytes);
    },
    async compact(id: string, bytes: Uint8Array) {
      const path = directory(id);
      await checkedWrite(join(path, "snapshot.loro"), bytes);
      fault("compact:published");
      for (const name of await readdir(join(path, "updates")))
        if (/^\d+\.loro$/.test(name)) await unlink(join(path, "updates", name));
      fault("compact:pruned");
      const dir = await open(join(path, "updates"), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    },
    async append(id: string, bytes: Uint8Array) {
      const path = join(directory(id), "updates");
      const numbers = (await readdir(path))
        .filter((n) => /^\d+\.loro$/.test(n))
        .map((n) => parseInt(n));
      await checkedWrite(join(path, `${Math.max(0, ...numbers) + 1}.loro`), bytes);
    },
  };
  const journal = await receipts(home, async (envelope) => {
    for (const write of envelope.writes) {
      const bytes = Buffer.from(write.bytes, "base64");
      if (write.create) await store.create(write.id, bytes);
      else await store.append(write.id, bytes);
    }
    for (const effect of envelope.effects)
      await exportPair(home, effect.target, effect.bytes, effect.base, effect.old);
  });
  return { ...store, journal };
}
export type Store = Awaited<ReturnType<typeof openStore>>;
