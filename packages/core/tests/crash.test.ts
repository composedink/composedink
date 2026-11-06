import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
