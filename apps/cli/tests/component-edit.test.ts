import { expect, it } from "vite-plus/test";
import { mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componentCheckout } from "../src/component-edit.ts";
import { authority, bind, openStore } from "@composedink/core/node";
it("imports saves at each file's base, reverses authority edits, preserves conflicts and rejects symlinks", async () => {
  const home = await mkdtemp(join(tmpdir(), "checkout-"));
  try {
    const run = bind(await authority(await openStore(home)));
    const id = "composed:test/edit";
    await run("component.create", { id, kind: "inline" });
    const directory = join(home, "checkout");
    const conflicts: string[] = [];
    let writes = 0;
    const checkout = await componentCheckout({
      id,
      directory,
      call: (name, input) => {
        if (name === "component.write") writes++;
        return run(name, input);
      },
      report: (m) => conflicts.push(m),
    });
    const original = await readFile(join(directory, "fallback.ts"), "utf8");
    await writeFile(join(directory, "fallback.ts"), original + "\n// local\n");
    await checkout.sync();
    expect(await run("component.read", { id })).toMatchObject({
      files: { "fallback.ts": original + "\n// local\n" },
    });
    await checkout.sync();
    expect(writes).toBe(1);
    const before = await run("component.read", { id });
    if (!before || typeof before !== "object" || !("base" in before)) throw Error("Missing base");
    await run("component.write", {
      id,
      base: before.base,
      files: { "nested/value.ts": "export const n = 1;" },
    });
    await checkout.sync();
    expect(await readFile(join(directory, "nested/value.ts"), "utf8")).toBe("export const n = 1;");
    await writeFile(join(directory, "fallback.ts"), "LOCAL\n" + original + "\n// local\n");
    await run("component.write", {
      id,
      base: before.base,
      files: { "fallback.ts": original + "\n// authority\n" },
    });
    await checkout.sync();
    expect(conflicts.join("\n")).toContain("fallback.ts");
    expect(await readFile(join(directory, "fallback.ts"), "utf8")).toContain("LOCAL");
    await checkout.sync();
    const after = await run("component.read", { id });
    expect(JSON.stringify(after)).toContain("authority");
    expect(after).toMatchObject({ files: { "fallback.ts": expect.stringContaining("LOCAL") } });
    await rm(join(directory, "nested/value.ts"));
    await symlink(join(directory, "fallback.ts"), join(directory, "nested/value.ts"));
    await expect(checkout.sync()).rejects.toThrow(/symlink/i);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

import { spawn } from "node:child_process";
import { createServer } from "node:net";
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No port");
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}
it("component edit starts headless studio and detaching the editor leaves its single owner alive", async () => {
  const home = await mkdtemp(join(tmpdir(), "edit-service-"));
  const cli = new URL("../src/main.ts", import.meta.url).pathname;
  const env = {
    ...process.env,
    COMPOSED_HOME: home,
    COMPOSED_PORT: String(await freePort()),
    COMPOSED_ARTIFACT_PORT: String(await freePort()),
  };
  let ownerPid: number | undefined;
  function launch(args: string[]) {
    const child = spawn(
      "mise",
      ["exec", "--", "node", "--experimental-strip-types", cli, ...args],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    return {
      child,
      output: () => output,
      done: new Promise<number | null>((r) => child.once("exit", r)),
    };
  }
  const create = launch(["component", "create", "test/edit", "--kind", "inline"]);
  expect(await create.done).toBe(0);
  const first = launch(["component", "edit", "test/edit", join(home, "first")]);
  let second: ReturnType<typeof launch> | undefined;
  try {
    await expect.poll(() => first.output(), { timeout: 30000 }).toContain('"editing"');
    const owner = JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
    ownerPid = owner.pid;
    expect(owner.kind).toBe("studio");
    second = launch(["component", "edit", "test/edit", join(home, "second")]);
    await expect.poll(() => second!.output(), { timeout: 30000 }).toContain('"editing"');
    expect(JSON.parse(await readFile(join(home, "owner.json"), "utf8")).pid).toBe(ownerPid);
    first.child.kill("SIGTERM");
    await first.done;
    expect(() => process.kill(ownerPid!, 0)).not.toThrow();
    await writeFile(join(home, "second", "extra.ts"), "export const n = 8;");
    await expect
      .poll(
        async () => {
          const read = launch(["component", "read", "test/edit"]);
          await read.done;
          return read.output();
        },
        { timeout: 10000 },
      )
      .toContain("export const n = 8;");
  } finally {
    first.child.kill("SIGTERM");
    second?.child.kill("SIGTERM");
    if (second) await second.done;
    if (ownerPid) process.kill(ownerPid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 200));
    await rm(home, { recursive: true, force: true });
  }
}, 60000);

it("preserves a newer editor save made while a write is awaiting acknowledgement", async () => {
  const home = await mkdtemp(join(tmpdir(), "checkout-race-"));
  try {
    const run = bind(await authority(await openStore(home))),
      id = "composed:test/race",
      directory = join(home, "files");
    await run("component.create", { id, kind: "inline" });
    let inject = false;
    const reports: string[] = [];
    const checkout = await componentCheckout({
      id,
      directory,
      report: (m) => reports.push(m),
      call: async (name, input) => {
        const result = await run(name, input);
        if (inject && name === "component.write") {
          inject = false;
          await writeFile(join(directory, "fallback.ts"), "NEWER LOCAL SAVE");
        }
        return result;
      },
    });
    await writeFile(join(directory, "fallback.ts"), 'export default ()=>"first save";');
    inject = true;
    await checkout.sync();
    await checkout.sync();
    expect(await readFile(join(directory, "fallback.ts"), "utf8")).toBe("NEWER LOCAL SAVE");
    expect(reports.join("\n")).toContain("Conflict");
    expect(await run("component.read", { id })).toMatchObject({
      files: { "fallback.ts": 'export default ()=>"first save";' },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
