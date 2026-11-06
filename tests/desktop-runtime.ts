import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
const { WebSocket } = createRequire(new URL("../apps/cli/package.json", import.meta.url))(
  "ws",
) as typeof import("ws");
const root = resolve(import.meta.dirname, "..");
const home = join(root, "test-results/plan-11-lifecycle-" + Date.now());
await mkdir(home, { recursive: true });
const cli = join(root, "apps/desktop/src-tauri/runtime/bin/composed");
const env = {
  HOME: process.env.HOME,
  PATH: "/usr/bin:/bin",
  COMPOSED_HOME: home,
  COMPOSED_PORT: "4791",
  COMPOSED_ARTIFACT_PORT: "4891",
};
const run = async (...args: string[]) => (await promisify(execFile)(cli, args, { env })).stdout;
const owner = async (): Promise<{ pid: number; socket: string; kind: string; ready: boolean }> =>
  JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check().catch(() => false)) return;
    await delay(50);
  }
  throw Error("Lifecycle wait timed out");
}
function bridge() {
  const child = spawn(cli, ["desktop"], { env, stdio: ["pipe", "pipe", "pipe"] });
  let log = "";
  child.stderr.on("data", (b) => (log += b));
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise<void>((r, reject) => {
    lines.once("line", () => r());
    child.once("exit", (code) => reject(Error(`Bridge exited ${code}: ${log}`)));
  });
  return { child, ready };
}
await run("new", "post", "tracer");
// A real short inline owner finishes before the desktop studio takes over.
const inline = spawn(
  resolve(cli, "../node"),
  [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    `import { acquire } from ${JSON.stringify(new URL("../apps/desktop/src-tauri/runtime/packages/core/src/store/election.ts", import.meta.url).href)}; const lock = await acquire(process.env.COMPOSED_HOME, 'inline'); console.log('acquired'); await new Promise(r=>setTimeout(r,300)); if(lock.kind === 'owner') await lock.close();`,
  ],
  { env, stdio: ["ignore", "pipe", "inherit"] },
);
await new Promise<void>((r) => inline.stdout.once("data", () => r()));
const waiting = bridge();
await waiting.ready;
assert.equal((await owner()).kind, "studio");
waiting.child.stdin.end();
await waitFor(async () => !(await owner().catch(() => null)));
// Stale metadata must not confer ownership; SQLite decides.
await writeFile(
  join(home, "owner.json"),
  JSON.stringify({
    pid: 99999999,
    processStartTime: 0,
    kind: "studio",
    socket: "ws://127.0.0.1:4791",
    ready: true,
  }),
);
const a = bridge();
await a.ready;
const first = await owner();
assert.equal(first.kind, "studio");
const b = bridge();
await b.ready;
assert.equal((await owner()).pid, first.pid);
assert.equal(JSON.parse(await run("cat", "tracer", "--json")).doc, "tracer");
const token = await readFile(join(home, "session.token"), "utf8");
const peer = new WebSocket(first.socket + "/?token=" + token, { origin: "http://127.0.0.1:4791" });
await new Promise<void>((r, reject) => {
  peer.once("open", r);
  peer.once("error", reject);
});
a.child.stdin.end();
b.child.stdin.end();
await delay(2500);
assert.equal((await owner()).pid, first.pid); // terminal client keeps managed authority alive
peer.close();
await waitFor(async () => !(await owner().catch(() => null)));
const c = bridge();
await c.ready;
const second = await owner();
assert.notEqual(second.pid, first.pid);
process.kill(second.pid, "SIGKILL");
await waitFor(async () => {
  const x = await owner();
  return x.pid !== second.pid && x.ready;
});
assert.equal(JSON.parse(await run("cat", "tracer", "--json")).doc, "tracer");
c.child.stdin.end();
await waitFor(async () => !(await owner().catch(() => null)));
// An externally started studio must survive desktop detach.
const service = spawn(cli, ["studio", "--headless"], { env, stdio: "ignore" });
await waitFor(async () => (await owner()).ready);
const external = await owner();
const d = bridge();
await d.ready;
d.child.stdin.end();
await delay(2500);
assert.equal((await owner()).pid, external.pid);
service.kill("SIGTERM");
await waitFor(async () => !(await owner().catch(() => null)));
console.log(
  JSON.stringify({
    home,
    cleanPath: env.PATH,
    inlineWait: true,
    staleRecovery: true,
    twoAttachmentsOneOwner: true,
    terminalKeepsOwner: true,
    authorityExitRecovery: true,
    externalOwnerSurvives: true,
    idleShutdown: true,
  }),
);
