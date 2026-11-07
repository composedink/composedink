import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vite-plus/test";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const entry = resolve(import.meta.dirname, "../src/main.ts");
const serverEntry = resolve(import.meta.dirname, "../../server/src/main.ts");
const BOOTSTRAP = "cli-bootstrap";

async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}

/** `apps/server` as a real process on a random port with temporary storage. */
async function spawnServer() {
  const storage = await mkdtemp(join(tmpdir(), "session-server-"));
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", serverEntry],
    {
      env: {
        ...process.env,
        COMPOSED_STORAGE: storage,
        COMPOSED_TOKEN: "artifact",
        COMPOSED_BOOTSTRAP_TOKEN: BOOTSTRAP,
        PORT: "0",
        HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const port = await new Promise<number>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      const match = /"port":(\d+)/.exec(output);
      if (match) resolve(Number(match[1]));
    });
    child.once("exit", (code) => reject(Error(`server exited ${code}`)));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      child.kill("SIGTERM");
      await rm(storage, { recursive: true, force: true });
    },
  };
}

async function home() {
  const path = await mkdtemp(join(tmpdir(), "session-home-"));
  const env = {
    ...process.env,
    COMPOSED_HOME: path,
    COMPOSED_PORT: String(await freePort()),
    COMPOSED_ARTIFACT_PORT: String(await freePort()),
  };
  const run = (...args: string[]) =>
    promisify(execFile)(process.execPath, ["--experimental-strip-types", entry, ...args], { env });
  return {
    path,
    env,
    cli: async (...args: string[]) => JSON.parse((await run(...args)).stdout),
    /** Runs a command expected to fail and returns its exit code and stderr. */
    fails: async (...args: string[]) => {
      try {
        await run(...args);
      } catch (error) {
        const failure = error as { code: number; stderr: string };
        return { code: failure.code, stderr: failure.stderr };
      }
      throw Error(`expected ${args.join(" ")} to fail`);
    },
    async close() {
      const owner = await readFile(join(path, "owner.json"), "utf8").catch(() => undefined);
      const pid = owner ? (JSON.parse(owner) as { pid?: number }).pid : undefined;
      if (pid && pid !== process.pid)
        try {
          process.kill(pid, "SIGTERM");
          await new Promise((r) => setTimeout(r, 300));
        } catch {}
      await rm(path, { recursive: true, force: true });
    },
  };
}

it("signs homes in and out, pairs devices and refuses signed-out sync with the fix", async () => {
  const server = await spawnServer();
  const a = await home();
  const b = await home();
  const children: ChildProcess[] = [];
  try {
    expect(await a.cli("status")).toEqual({ signedIn: false });
    const login = await a.cli("login", server.url, "--bootstrap", BOOTSTRAP, "--name", "A");
    expect(login).toMatchObject({ signedIn: true, server: server.url, deviceName: "A" });
    expect(await a.cli("status")).toEqual({
      signedIn: true,
      server: server.url,
      accountId: login.accountId,
      deviceName: "A",
    });
    expect((await stat(join(a.path, "session.secret"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(a.path, "session.json"), "utf8"))).toMatchObject({
      server: server.url,
      deviceName: "A",
    });

    const { code } = await a.cli("devices", "pair");
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await b.cli("login", server.url, "--code", code, "--name", "B")).toMatchObject({
      signedIn: true,
      accountId: login.accountId,
      deviceName: "B",
    });
    const list = await a.cli("devices", "list");
    expect(list.devices.map((d: { name: string }) => d.name)).toEqual(["A", "B"]);

    const again = await a.fails("login", server.url, "--bootstrap", BOOTSTRAP);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain(
      `SignedIn: already signed in to ${server.url}; fix: composed logout`,
    );

    expect(await b.cli("logout")).toEqual({ signedIn: false, server: server.url });
    expect(JSON.parse(await readFile(join(b.path, "session.json"), "utf8"))).toEqual({
      server: server.url,
    });
    await expect(stat(join(b.path, "session.secret"))).rejects.toThrow();

    const fix = `fix: composed login ${server.url}`;
    const sync = await b.fails("sync");
    expect(sync.code).toBe(1);
    expect(sync.stderr).toContain(`SignInRequired: not signed in to a composed server; ${fix}`);

    await b.cli("new", "post", "p");
    const feedback = await b.fails("feedback", "request", "p", "--to", "link:x");
    expect(feedback.code).toBe(1);
    expect(feedback.stderr).toContain(fix);
    const share = await b.fails("share", "p");
    expect(share.code).toBe(1);
    expect(share.stderr).toContain(`SignInRequired: not signed in to a composed server; ${fix}`);

    // Signed in: share starts studio (it syncs first), then list and revoke.
    await a.cli("new", "post", "s");
    const pinned = await a.cli("share", "s", "--question", "Is the opening clear?");
    expect(pinned).toMatchObject({
      mode: "pinned",
      questions: [{ text: "Is the opening clear?" }],
      url: expect.stringMatching(new RegExp(`^${server.url}/s/[A-Za-z0-9_-]{43}$`)),
    });
    const live = await a.cli("share", "s", "--live", "--expires", "7d");
    expect(live.mode).toBe("live");
    expect(live.expiresAt).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await fetch(live.url)).status).toBe(200);
    const listed = await a.cli("share", "list", "s");
    expect(listed.links).toEqual([
      expect.objectContaining({ linkId: pinned.link, mode: "pinned", url: pinned.url }),
      expect.objectContaining({ linkId: live.link, mode: "live", url: live.url }),
    ]);
    const revoked = await a.cli("share", "revoke", pinned.link);
    expect(revoked).toEqual({ link: pinned.link, revokedAt: expect.any(Number) });
    expect((await fetch(pinned.url)).status).toBe(404);

    const client = new Client({ name: "session-test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-strip-types", entry, "mcp"],
      env: Object.fromEntries(
        Object.entries(a.env).filter((e): e is [string, string] => typeof e[1] === "string"),
      ),
      stderr: "pipe",
    });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "session_status",
          "sync_now",
          "share_create",
          "share_list",
          "share_revoke",
        ]),
      );
      expect(names.filter((n) => /^(session_login|session_logout|devices_)/.test(n))).toEqual([]);
      const status = await client.callTool({ name: "session_status", arguments: {} });
      expect(JSON.parse((status.content as { text: string }[])[0].text)).toMatchObject({
        signedIn: true,
        deviceName: "A",
      });
    } finally {
      await client.close();
    }
  } finally {
    for (const child of children) child.kill();
    await a.close();
    await b.close();
    await server.close();
  }
}, 120_000);
