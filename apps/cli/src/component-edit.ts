import { mkdir, readFile, writeFile, readdir, lstat, rename } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { z } from "zod";
import { call, ensureStudio } from "./client.ts";
const snapshot = z.object({ base: z.string(), files: z.record(z.string(), z.string()) });
const metadata = z.object({
  id: z.string(),
  files: z.record(
    z.string(),
    z.object({ base: z.string(), text: z.string(), conflict: z.boolean().optional() }),
  ),
});
type Call = (name: string, input: unknown) => Promise<unknown>;
export async function componentCheckout(options: {
  id: string;
  directory: string;
  call: Call;
  report: (message: string) => void;
}) {
  const { id, call: run, report } = options;
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw Error("Symlink checkout directory");
  const metaPath = join(directory, ".composed-checkout.json");
  for (const path of [metaPath, metaPath + ".tmp"]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw Error("Symlink checkout metadata");
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
        throw error;
    }
  }
  let state: z.infer<typeof metadata>;
  try {
    state = metadata.parse(JSON.parse(await readFile(metaPath, "utf8")));
    if (state.id !== id) throw Error("Checkout belongs to another component");
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
      throw error;
    state = { id, files: {} };
  }
  async function scan(root = directory, prefix = ""): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".composed") ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      )
        continue;
      const path = join(root, entry.name),
        name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw Error(`Symlink checkout path: ${name}`);
      if (entry.isDirectory()) Object.assign(files, await scan(path, name + "/"));
      else if (entry.isFile()) files[name] = await readFile(path, "utf8");
    }
    return files;
  }
  async function sync() {
    const local = await scan();
    let remote = snapshot.parse(await run("component.read", { id }));
    for (const [path, text] of Object.entries(local)) {
      const prior = state.files[path];
      if (prior?.conflict && text !== remote.files[path]) {
        report(`Conflict: ${path}; local save preserved; reconcile with component read`);
        continue;
      }
      if (prior && text === prior.text) continue;
      if (!prior && remote.files[path] !== undefined && text !== remote.files[path]) {
        report(`Conflict: ${path}; existing local file preserved`);
        continue;
      }
      if (prior && remote.files[path] !== prior.text && remote.files[path] !== text)
        report(`Conflict: ${path}; merging save at recorded base`);
      if (remote.files[path] !== text) {
        const result = await run("component.write", {
          id,
          base: prior?.base ?? remote.base,
          files: { [path]: text },
        });
        if (
          result &&
          typeof result === "object" &&
          "diagnostics" in result &&
          Array.isArray(result.diagnostics) &&
          result.diagnostics.length
        )
          report(JSON.stringify(result.diagnostics));
      }
      // Re-read after the write: concurrent CRDT edits may have merged with this save.
      remote = snapshot.parse(await run("component.read", { id }));
      state.files[path] = { base: remote.base, text: remote.files[path] };
      // Preserve a save that happened while the operation was awaiting acknowledgement.
      if ((await readFile(join(directory, path), "utf8")) === text)
        await writeFile(join(directory, path), remote.files[path]);
      else {
        state.files[path].conflict = true;
        report(`Conflict: ${path}; a newer local save was preserved`);
      }
    }
    remote = snapshot.parse(await run("component.read", { id }));
    for (const [path, text] of Object.entries(remote.files)) {
      if (
        path
          .split("/")
          .some(
            (p) =>
              !p || p === "." || p === ".." || p === "node_modules" || p.startsWith(".composed"),
          ) ||
        path.includes("\\") ||
        path.startsWith("/")
      )
        throw Error("Unsafe checkout path");
      const prior = state.files[path];
      let current: string | undefined;
      try {
        current = await readFile(join(directory, path), "utf8");
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
          throw error;
      }
      if (current !== undefined && current !== text && current !== prior?.text) {
        report(`Conflict: ${path}; local save preserved`);
        continue;
      }
      await mkdir(dirname(join(directory, path)), { recursive: true });
      if (current !== text) await writeFile(join(directory, path), text);
      state.files[path] = { base: remote.base, text };
    }
    await writeFile(metaPath + ".tmp", JSON.stringify(state, null, 2));
    await rename(metaPath + ".tmp", metaPath);
  }
  await sync();
  return { sync };
}
export async function componentEdit(home: string, id: string, directory: string) {
  await ensureStudio(home);
  const checkout = await componentCheckout({
    id,
    directory,
    call: (name, input) => call(home, name, input, true),
    report: (message) => console.error(message),
  });
  console.log(JSON.stringify({ editing: id, directory: resolve(directory) }));
  let stopped = false;
  const close = () => {
    stopped = true;
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  while (!stopped) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      await checkout.sync();
    } catch (error) {
      console.error(String(error));
    }
  }
}
