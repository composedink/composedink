import { mkdtemp, rm, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vite-plus/test";
import { authority, openStore, bind } from "../src/node.ts";
import { targetLease } from "../src/store/target-lease.ts";
it("blocks busy canonical destinations and prevents another document claiming an exported folder", async () => {
  const home = await mkdtemp(join(tmpdir(), "target-"));
  try {
    const a = await authority(await openStore(home)),
      run = bind(a);
    await run("doc.create", { slug: "post" });
    const to = join(home, "content");
    await mkdir(join(to, "post"), { recursive: true });
    await symlink(to, join(home, "alias"), "dir");
    const release = targetLease(join(to, "post"));
    await expect(
      run("export", { doc: "post", view: "clean", to: join(home, "alias") }),
    ).rejects.toThrow("TargetBusy");
    release();
    await run("export", { doc: "post", view: "clean", to });
    await run("doc.create", { slug: "other-post" });
    await symlink(join(to, "post"), join(to, "other-post"), "dir");
    await expect(run("export", { doc: "other-post", view: "clean", to })).rejects.toThrow(
      "TargetBusy",
    );

    const b = await authority(await openStore(join(home, "other")));
    await bind(b)("doc.create", { slug: "post" });
    // A matching document handle in another home still cannot bypass the live kernel lease.
    const unlock = targetLease(join(to, "post"));
    await expect(bind(b)("export", { doc: "post", view: "clean", to })).rejects.toThrow(
      "TargetBusy",
    );
    unlock();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
