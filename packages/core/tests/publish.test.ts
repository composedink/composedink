import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { expect, it } from "vite-plus/test";
import { authority, openStore, bind } from "../src/node.ts";
import { configureScope } from "../src/config.ts";
it("retries a lost publish response with identical bytes/version and releases only pinned dependencies", async () => {
  const home = await mkdtemp(join(tmpdir(), "publish-"));
  let lose = true;
  const puts: Array<{ url: string; bytes: Buffer }> = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    puts.push({ url: req.url!, bytes: Buffer.concat(chunks) });
    if (lose) {
      lose = false;
      req.socket.destroy();
    } else res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  process.env.PLAN09_TOKEN = "secret";
  try {
    await configureScope(home, "test", `http://127.0.0.1:${address.port}`, "PLAN09_TOKEN");
    let a = await authority(await openStore(home));
    let run = bind(a);
    const id = "composed:test/hello";
    await run("component.create", { id, kind: "inline" });
    await run("doc.create", { slug: "post" });
    await run("doc.apply", {
      doc: "post",
      base: a.read("post").base,
      text: '<Hello name="World" />',
      mode: "direct",
      by: { kind: "human" },
    });
    await run("deps.add", { doc: "post", tag: "Hello", component: id, version: "dev" });
    await expect(
      run("export", { doc: "post", view: "clean", to: join(home, "release"), mode: "release" }),
    ).rejects.toThrow("UnpinnedDependency");
    await expect(
      run("component.publish", { id, bump: "minor", request: "publish" }),
    ).rejects.toThrow();
    const first = puts[0];
    a = await authority(await openStore(home));
    run = bind(a);
    const result = await run("component.publish", { id, bump: "minor", request: "publish" });
    expect(result).toMatchObject({ version: "0.1.0" });
    expect(puts[1]).toEqual(first);
    expect(await run("component.publish", { id, bump: "minor", request: "publish" })).toEqual(
      result,
    );
    await run("deps.pin", { doc: "post", tag: "Hello", version: "0.1.0" });
    await run("export", { doc: "post", view: "clean", to: join(home, "release"), mode: "release" });
    const path = join(home, "release/post/index.mdx");
    const lock = JSON.parse(await readFile(join(home, "release/post/composed.lock.json"), "utf8"));
    expect(lock.mode).toBe("release");
    expect(lock.blocks.Hello.entry).toContain("/c/test/hello/0.1.0/remoteEntry.js");
    expect(JSON.stringify(lock)).not.toContain("secret");
    await writeFile(path, 'Outside edit\n\n<Hello name="World" />');
    const imported = await run("doc.import", { doc: "post", file: path });
    expect(imported).toMatchObject({ imported: true });
    expect(await run("doc.import", { doc: "post", file: path })).toEqual(imported);
    await run("export", { doc: "post", view: "clean", to: join(home, "release"), mode: "release" });
    expect(a.read("post").text).toContain("Outside edit");
  } finally {
    delete process.env.PLAN09_TOKEN;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
