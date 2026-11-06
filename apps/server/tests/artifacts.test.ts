import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { expect, it } from "vite-plus/test";
import { artifactServer } from "../src/artifacts.ts";
it("publishes complete immutable releases with authenticated retries and public CORS", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifacts-"));
  const server = artifactServer({ root, token: "secret" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  const base = `http://127.0.0.1:${address.port}/c/test/hello/1.0.0`;
  const put = (path: string, body: string, token = "secret") =>
    fetch(base + "/" + path, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body,
    });
  try {
    const health = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    expect([health.status, await health.text()]).toEqual([200, "ok"]);
    expect((await fetch(`http://127.0.0.1:${address.port}/`)).status).toBe(400);
    expect((await put("remoteEntry.js", "hello", "wrong")).status).toBe(401);
    expect((await put("remoteEntry.js", "hello")).status).toBe(200);
    expect((await fetch(base + "/remoteEntry.js")).status).toBe(404);
    const manifest = JSON.stringify({
      files: {
        "remoteEntry.js": createHash("sha256").update("hello").digest("hex"),
        "chunk.js": createHash("sha256").update("chunk").digest("hex"),
      },
    });
    expect((await put("release.json", manifest)).status).toBe(409);
    expect((await put("chunk.js", "chunk")).status).toBe(200);
    await writeFile(join(root, "staging/test/hello/1.0.0/release.json"), manifest);
    expect((await put("release.json", manifest)).status).toBe(200);
    expect((await put("remoteEntry.js", "hello")).status).toBe(200);
    expect((await put("remoteEntry.js", "different")).status).toBe(409);
    expect((await put("new.js", "new")).status).toBe(409);
    const response = await fetch(base + "/remoteEntry.js");
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(
      (
        await fetch(base + "/%2e%2e%2fescape", {
          method: "PUT",
          headers: { authorization: "Bearer secret" },
          body: "bad",
        })
      ).status,
    ).toBe(400);
    expect((await fetch(base.replace("1.0.0", "dev") + "/x")).status).toBe(400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
