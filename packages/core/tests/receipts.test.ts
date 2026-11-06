import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { authority, openStore, bind } from "../src/node.ts";
it("workspace requests replay original results across restart, concurrent duplicates and semantic conflicts", async () => {
  const home = await mkdtemp(join(tmpdir(), "receipts-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    const input = { slug: "post", request: "once" };
    const results = await Promise.all([run("doc.create", input), run("doc.create", input)]);
    expect(results[0]).toEqual(results[1]);
    const b = await authority(await openStore(home));
    expect(await bind(b)("doc.create", input)).toEqual(results[0]);
    await expect(bind(b)("doc.create", { ...input, slug: "other" })).rejects.toThrow(
      "RequestConflict",
    );
    expect(b.documents.size).toBe(1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

import { spawnSync } from "node:child_process";
for (const point of ["transaction:committed", "transaction:before-ack"])
  it(`replays one creation after kill at ${point}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "lost-ack-"));
    try {
      const child = spawnSync(
        "mise",
        [
          "exec",
          "--",
          "node",
          "--experimental-strip-types",
          new URL("./support/receipt-crash.ts", import.meta.url).pathname,
          home,
        ],
        { env: { ...process.env, COMPOSED_FAULT: point } },
      );
      expect(child.signal).toBe("SIGKILL");
      const a = await authority(await openStore(home));
      const before = a.read("post").base;
      expect(await bind(a)("doc.create", { slug: "post", request: "lost-ack" })).toEqual({
        doc: "post",
      });
      expect(a.read("post").base).toBe(before);
      expect(a.documents.size).toBe(1);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFiles } from "../src/model/files.ts";
it("two clients send 500 component writes each to one studio and every acknowledged file survives restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "flood-"));
  const cli = new URL("../../../apps/cli/src/main.ts", import.meta.url).pathname;
  const port = 17000 + Math.floor(Math.random() * 10000);
  const env = {
    ...process.env,
    COMPOSED_HOME: home,
    COMPOSED_PORT: String(port),
    COMPOSED_ARTIFACT_PORT: String(port + 1),
  };
  const studio = spawn(
    "mise",
    [
      "exec",
      "--",
      "node",
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      cli,
      "studio",
      "--headless",
    ],
    { env, stdio: "ignore" },
  );
  try {
    for (let n = 0; n < 250; n++) {
      try {
        if (JSON.parse(await readFile(join(home, "owner.json"), "utf8")).ready) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 20));
    }
    const create = spawnSync(
      "mise",
      [
        "exec",
        "--",
        "node",
        "--experimental-strip-types",
        "--no-warnings=ExperimentalWarning",
        cli,
        "component",
        "create",
        "test/flood",
        "--kind",
        "block",
      ],
      { env },
    );
    expect(create.status).toBe(0);
    async function flood(label: string) {
      return new Promise<void>((resolve, reject) => {
        const child = spawn(
          "mise",
          [
            "exec",
            "--",
            "node",
            "--experimental-strip-types",
            "--no-warnings=ExperimentalWarning",
            new URL("../../../apps/cli/tests/support/flood.ts", import.meta.url).pathname,
            home,
            label,
          ],
          { env, stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "";
        child.stdout.on("data", (c) => (output += c));
        child.stderr.on("data", (c) => (output += c));
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(output))));
      });
    }
    await Promise.all([flood("a"), flood("b")]);
    const info = JSON.parse(await readFile(join(home, "owner.json"), "utf8"));
    expect(info.kind).toBe("studio");
    studio.kill("SIGTERM");
    await new Promise((r) => studio.once("exit", r));
    const a = await authority(await openStore(home));
    const files = readFiles(a.get("composed:test/flood")).files;
    for (const label of ["a", "b"])
      expect(files[`${label}.txt`]).toBe(
        Array.from({ length: 500 }, (_, n) => `${label}:${n}\n`).join(""),
      );
  } finally {
    studio.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  }
}, 600000);

import { writeFile } from "node:fs/promises";
import { replaceText } from "../src/model/text.ts";
it("reconciles outside text at the retained export base and rejects an old-MDX/current-lock pair", async () => {
  const home = await mkdtemp(join(tmpdir(), "history-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    await run("doc.create", { slug: "p" });
    await a.change("p", (d) => replaceText(d, "one"));
    const to = join(home, "content");
    await run("export", { view: "clean", doc: "p", to });
    const path = join(to, "p", "index.mdx");
    await writeFile(path, "outside");
    await run("export", { view: "clean", doc: "p", to });
    expect(a.read("p").text).toBe("outside");
    const base = a.read("p").base;
    await run("export", { view: "clean", doc: "p", to });
    expect(a.read("p").base).toBe(base);
    await a.change("p", (d) => replaceText(d, "three"));
    await run("export", { view: "clean", doc: "p", to });
    await writeFile(path, "one");
    await expect(run("export", { view: "clean", doc: "p", to })).rejects.toThrow(
      "RecoveryRequired",
    );
    expect(await readFile(path, "utf8")).toBe("one");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it("component retries return the original frontier after later edits and hash nested file contents", async () => {
  const home = await mkdtemp(join(tmpdir(), "original-head-"));
  try {
    const a = await authority(await openStore(home));
    const run = bind(a);
    const id = "composed:test/retry";
    await run("component.create", { id, kind: "block", request: "create-component" });
    const { base } = readFiles(a.get(id));
    const input = { id, base, files: { by: "first", "a.txt": "A" }, request: "write-once" };
    const result = await run("component.write", input);
    await run("component.write", {
      id,
      base: readFiles(a.get(id)).base,
      files: { "a.txt": "later" },
    });
    const b = await authority(await openStore(home));
    expect(
      await bind(b)("component.write", { ...input, files: { "a.txt": "A", by: "first" } }),
    ).toEqual(result);
    await expect(
      bind(b)("component.write", { ...input, files: { ...input.files, by: "different" } }),
    ).rejects.toThrow("RequestConflict");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
