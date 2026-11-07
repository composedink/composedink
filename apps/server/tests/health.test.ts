import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vite-plus/test";
import { composedServer } from "../src/main.ts";
import { startServer } from "./support/server.ts";

const without = (env: NodeJS.ProcessEnv, key: string) => {
  const { [key]: _, ...rest } = env;
  return rest;
};

it("refuses to start without a bootstrap token while no account exists", async () => {
  const storage = await mkdtemp(join(tmpdir(), "composed-health-"));
  try {
    expect(() => composedServer({ storage, token: "t" })).toThrow(
      "COMPOSED_BOOTSTRAP_TOKEN is required until the first device signs in",
    );
    const run = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "../src/main.ts")],
      {
        // The ambient environment may carry a real bootstrap token (mise loads `.env`).
        env: {
          ...without(process.env, "COMPOSED_BOOTSTRAP_TOKEN"),
          COMPOSED_STORAGE: storage,
          COMPOSED_TOKEN: "t",
          PORT: "0",
        },
        timeout: 20_000,
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr.toString()).toContain("COMPOSED_BOOTSTRAP_TOKEN is required");
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
});

it("answers /healthz from the open database and 503 once it is closed", async () => {
  const server = await startServer();
  try {
    const ok = await server.fetch("/healthz");
    expect([ok.status, await ok.text()]).toEqual([200, "ok"]);
    server.db.close();
    expect((await server.fetch("/healthz")).status).toBe(503);
  } finally {
    await server.remove();
  }
});

it("still serves the artifact routes", async () => {
  const server = await startServer();
  try {
    expect((await server.fetch("/c/test/hello/1.0.0/remoteEntry.js")).status).toBe(404);
    const put = await server.fetch("/c/test/hello/1.0.0/remoteEntry.js", {
      method: "PUT",
      headers: { authorization: "Bearer artifact" },
      body: "x",
    });
    expect(put.status).toBe(200);
  } finally {
    await server.remove();
  }
});
