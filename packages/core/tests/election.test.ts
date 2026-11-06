import { fork } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { acquire } from "../src/store/election.ts";
function child(home: string) {
  const c = fork(new URL("./support/contender.ts", import.meta.url), [home], {
    execPath: process.env.MISE_NODE ?? "node",
    execArgv: ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"],
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const messages: unknown[] = [];
  const waiters: Array<(v: unknown) => void> = [];
  c.on("message", (m) => {
    const w = waiters.shift();
    if (w) w(m);
    else messages.push(m);
  });
  return {
    c,
    next: () =>
      messages.length
        ? Promise.resolve(messages.shift())
        : new Promise<unknown>((r) => waiters.push(r)),
  };
}
it("barrier contenders elect exactly one owner; BUSY waits then connects; SIGKILL releases ownership", async () => {
  const home = await mkdtemp(join(tmpdir(), "election-"));
  const a = child(home),
    b = child(home);
  try {
    expect(await a.next()).toEqual({ barrier: true });
    expect(await b.next()).toEqual({ barrier: true });
    a.c.send("go");
    b.c.send("go");
    const results = [a.next(), b.next()];
    const winner = await Promise.race([
      results[0].then((v) => ({ v, owner: a, other: b })),
      results[1].then((v) => ({ v, owner: b, other: a })),
    ]);
    expect(winner.v).toEqual({ kind: "owner" });
    let followed = false;
    void results[winner.owner === a ? 1 : 0].then(() => {
      followed = true;
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(followed).toBe(false);
    winner.owner.c.send("ready");
    expect(await winner.owner.next()).toEqual({ ready: true });
    expect(await results[winner.owner === a ? 1 : 0]).toEqual({ kind: "connect" });
    const follower = await acquire(home, "inline");
    expect(follower.kind).toBe("connect");
    winner.owner.c.kill("SIGKILL");
    await new Promise((r) => winner.owner.c.once("exit", r));
    const next = await acquire(home, "studio");
    expect(next.kind).toBe("owner");
    if (next.kind === "owner") await next.close();
  } finally {
    a.c.kill("SIGKILL");
    b.c.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  }
}, 15000);
it("crash before metadata and clean shutdown both permit acquisition", async () => {
  const home = await mkdtemp(join(tmpdir(), "election-"));
  const c = child(home);
  try {
    await c.next();
    c.c.send("go");
    expect(await c.next()).toEqual({ kind: "owner" });
    c.c.kill("SIGKILL");
    await new Promise((r) => c.c.once("exit", r));
    const lock = await acquire(home, "inline");
    expect(lock.kind).toBe("owner");
    if (lock.kind === "owner") await lock.close();
    const studio = await acquire(home, "studio");
    expect(studio.kind).toBe("owner");
    if (studio.kind === "owner") await studio.close();
  } finally {
    c.c.kill();
    await rm(home, { recursive: true, force: true });
  }
});

import { spawnSync } from "node:child_process";
it("recovers a kill after lock acquisition but before owner.json", async () => {
  const home = await mkdtemp(join(tmpdir(), "no-owner-"));
  try {
    const child = spawnSync(
      "mise",
      [
        "exec",
        "--",
        "node",
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import {acquire} from ${JSON.stringify(new URL("../src/store/election.ts", import.meta.url).href)};await acquire(${JSON.stringify(home)},'inline');`,
      ],
      { env: { ...process.env, COMPOSED_FAULT: "election:acquired" } },
    );
    expect(child.signal).toBe("SIGKILL");
    const next = await acquire(home, "studio");
    expect(next.kind).toBe("owner");
    if (next.kind === "owner") await next.close();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("studio waits for an inline command and takes over only after it closes", async () => {
  const home = await mkdtemp(join(tmpdir(), "takeover-"));
  try {
    const inline = await acquire(home, "inline");
    expect(inline.kind).toBe("owner");
    let finished = false;
    const pending = acquire(home, "studio").then((value) => {
      finished = true;
      return value;
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(finished).toBe(false);
    if (inline.kind === "owner") await inline.close();
    const service = await pending;
    expect(service.kind).toBe("owner");
    if (service.kind === "owner") await service.close();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("short CLI commands own inline and preview automatically starts studio", async () => {
  const home = await mkdtemp(join(tmpdir(), "autostart-"));
  const port = 28000 + Math.floor(Math.random() * 10000);
  const env = {
    ...process.env,
    COMPOSED_HOME: home,
    COMPOSED_PORT: String(port),
    COMPOSED_ARTIFACT_PORT: String(port + 1),
  };
  const args = [
    "exec",
    "--",
    "node",
    "--experimental-strip-types",
    "--no-warnings=ExperimentalWarning",
    new URL("../../../apps/cli/src/main.ts", import.meta.url).pathname,
  ];
  let pid: number | undefined;
  try {
    expect(spawnSync("mise", [...args, "new", "post", "p"], { env }).status).toBe(0);
    const result = spawnSync("mise", [...args, "preview", "p", "--to", join(home, "outside")], {
      env,
    });
    expect(result.status, result.stderr.toString()).toBe(0);
    const info = JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
    pid = info.pid;
    expect(info.kind).toBe("studio");
    expect(info.ready).toBe(true);
  } finally {
    if (pid) process.kill(pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    await rm(home, { recursive: true, force: true });
  }
}, 15000);
