import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vite-plus/test";
import { authority, openStore } from "../src/node.ts";
import { createPost, replaceText } from "../src/model/text.ts";
for (const point of [
  "snapshot.loro:prepared",
  "snapshot.loro:renamed",
  "compact:published",
  "compact:pruned",
])
  it(`reopens after kill at ${point}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "crash-"));
    try {
      const a = await authority(await openStore(home));
      await a.create("p", createPost("p"));
      await a.change("p", (d) => replaceText(d, "durable"));
      const child = spawnSync(
        "mise",
        [
          "exec",
          "--",
          "node",
          "--experimental-strip-types",
          new URL("./support/compact-crash.ts", import.meta.url).pathname,
          home,
        ],
        { env: { ...process.env, COMPOSED_FAULT: point } },
      );
      expect(child.signal).toBe("SIGKILL");
      expect((await authority(await openStore(home))).read("p").text).toBe("durable");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

import { readFile, writeFile } from "node:fs/promises";
import { bind } from "../src/node.ts";
for (const point of ["export:intent", "export:rename-0", "export:rename-1"])
  it(`recovers exact export pair after ${point}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "export-crash-"));
    const target = join(home, "outside");
    try {
      const a = await authority(await openStore(home));
      await bind(a)("doc.create", { slug: "post" });
      await a.change("post", (d) => replaceText(d, "prepared text"));
      const child = spawnSync(
        "mise",
        [
          "exec",
          "--",
          "node",
          "--experimental-strip-types",
          new URL("./support/export-crash.ts", import.meta.url).pathname,
          home,
          target,
        ],
        { env: { ...process.env, COMPOSED_FAULT: point } },
      );
      expect(child.signal).toBe("SIGKILL");
      const b = await authority(await openStore(home));
      await bind(b)("export", { view: "clean", doc: "post", to: target, request: "export-retry" });
      expect(await readFile(join(target, "post", "index.mdx"), "utf8")).toBe("prepared text");
      const lock = JSON.parse(await readFile(join(target, "post", "composed.lock.json"), "utf8"));
      expect(lock.base).toBe(b.read("post").base);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
it("preserves an unexpected outside edit during recovery", async () => {
  const home = await mkdtemp(join(tmpdir(), "outside-crash-"));
  const target = join(home, "outside");
  try {
    const a = await authority(await openStore(home));
    await bind(a)("doc.create", { slug: "post" });
    await a.change("post", (d) => replaceText(d, "prepared"));
    const child = spawnSync(
      "mise",
      [
        "exec",
        "--",
        "node",
        "--experimental-strip-types",
        new URL("./support/export-crash.ts", import.meta.url).pathname,
        home,
        target,
      ],
      { env: { ...process.env, COMPOSED_FAULT: "export:rename-0" } },
    );
    expect(child.signal).toBe("SIGKILL");
    const path = join(target, "post", "index.mdx");
    await writeFile(path, "outside edit");
    await expect(openStore(home)).rejects.toThrow("RecoveryRequired");
    expect(await readFile(path, "utf8")).toBe("outside edit");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("does not acknowledge typing when a durable write fails and preserves the old in-memory head", async () => {
  const home = await mkdtemp(join(tmpdir(), "write-error-"));
  try {
    const a = await authority(await openStore(home));
    await bind(a)("doc.create", { slug: "p" });
    const before = a.read("p").base;
    const editor = a.get("p").fork();
    const from = editor.version();
    replaceText(editor, "unacknowledged");
    const updates = join(home, "docs", "cA", "updates");
    await rm(updates, { recursive: true });
    await writeFile(updates, "blocked");
    await expect(
      a.serialize(() => a.typing("p", editor.export({ mode: "update", from }))),
    ).rejects.toThrow();
    expect(a.read("p").base).toBe(before);
    await expect(bind(a)("doc.read", { doc: "p" })).rejects.toThrow("RecoveryRequired");
    await rm(updates);
    await mkdir(updates);
    const recovered = await authority(await openStore(home));
    expect(recovered.read("p").text).toBe("unacknowledged");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
