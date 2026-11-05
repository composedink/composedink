import { mkdir, open, rename, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export async function atomicWrite(path: string, bytes: Uint8Array | string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx");
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(join(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function openStore(home: string) {
  await mkdir(join(home, "docs"), { recursive: true });
  const directory = (id: string) => join(home, "docs", Buffer.from(id).toString("base64url"));
  return {
    home,
    async load() {
      const result: Array<{ id: string; bytes: Uint8Array[] }> = [];
      for (const name of await readdir(join(home, "docs"))) {
        const path = join(home, "docs", name);
        const bytes = [await readFile(join(path, "snapshot.loro"))];
        for (const update of (await readdir(join(path, "updates")))
          .filter((n) => /^\d+\.loro$/.test(n))
          .sort((a, b) => parseInt(a) - parseInt(b)))
          bytes.push(await readFile(join(path, "updates", update)));
        result.push({ id: Buffer.from(name, "base64url").toString(), bytes });
      }
      return result;
    },
    async create(id: string, bytes: Uint8Array) {
      const path = directory(id);
      await mkdir(join(path, "updates"), { recursive: true });
      await atomicWrite(join(path, "snapshot.loro"), bytes);
    },
    async append(id: string, bytes: Uint8Array) {
      const path = join(directory(id), "updates");
      const numbers = (await readdir(path))
        .filter((n) => /^\d+\.loro$/.test(n))
        .map((n) => parseInt(n));
      await atomicWrite(join(path, `${Math.max(0, ...numbers) + 1}.loro`), bytes);
    },
  };
}
export type Store = Awaited<ReturnType<typeof openStore>>;
