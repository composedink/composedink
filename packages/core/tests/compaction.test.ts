import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFrontiers } from "loro-crdt";
import { expect, it } from "vite-plus/test";
import { openStore, authority } from "../src/node.ts";
import { createPost, replaceText } from "../src/model/text.ts";
it("compaction retains old bases and rejects corrupt committed bytes", async () => {
  const home = await mkdtemp(join(tmpdir(), "compact-"));
  try {
    const a = await authority(await openStore(home));
    await a.create("p", createPost("p"));
    await a.change("p", (d) => replaceText(d, "old"));
    const base = a.read("p").base;
    await a.change("p", (d) => replaceText(d, "new"));
    await a.compact("p");
    const b = await authority(await openStore(home));
    expect(b.read("p").text).toBe("new");
    expect(
      b
        .get("p")
        .forkAt(decodeFrontiers(Buffer.from(base, "base64url")))
        .getText("mdx")
        .toString(),
    ).toBe("old");
    const snapshot = join(home, "docs", Buffer.from("p").toString("base64url"), "snapshot.loro");
    const bytes = await readFile(snapshot);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(snapshot, bytes);
    await expect(openStore(home).then(authority)).rejects.toThrow("corrupt");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("validates update length and ignores only temp files", async () => {
  const home = await mkdtemp(join(tmpdir(), "segments-"));
  try {
    const a = await authority(await openStore(home));
    await a.create("p", createPost("p"));
    await a.change("p", (d) => replaceText(d, "saved"));
    const dir = join(home, "docs", "cA", "updates");
    await writeFile(join(dir, "uncommitted.tmp"), "junk");
    expect((await authority(await openStore(home))).read("p").text).toBe("saved");
    const file = (await readdir(dir)).find((n) => n.endsWith(".loro"))!;
    await writeFile(join(dir, file), "truncated");
    await expect(openStore(home).then(authority)).rejects.toThrow("corrupt");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
