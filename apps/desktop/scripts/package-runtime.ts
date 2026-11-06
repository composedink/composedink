import { cp, mkdir, readdir, readlink, realpath, symlink, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
export const root = resolve(import.meta.dirname, "../../..");
export const runtime = join(root, "apps/desktop/src-tauri/runtime");
await rm(runtime, { recursive: true, force: true });
await mkdir(join(runtime, "bin"), { recursive: true });
const copied = new Set<string>();
async function copyPackage(source: string): Promise<void> {
  source = await realpath(source);
  if (copied.has(source)) return;
  copied.add(source);
  if (!source.startsWith(root + sep)) throw Error(`Dependency outside repository: ${source}`);
  const dest = join(runtime, relative(root, source));
  await cp(source, dest, {
    recursive: true,
    filter: (path) =>
      !["node_modules", "tests", ".vite", "dist"].includes(relative(source, path).split(sep)[0]),
  });
  // Third-party distributions often put their executable code in dist.
  if (source.includes("/node_modules/"))
    await cp(source, dest, {
      recursive: true,
      filter: (path) => !relative(source, path).split(sep).includes("node_modules"),
    });
  async function links(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, e.name);
      if (e.isSymbolicLink()) {
        const target = await realpath(path);
        await copyPackage(target);
        const destination = join(runtime, relative(root, path));
        await mkdir(dirname(destination), { recursive: true });
        await symlink(await readlink(path), destination);
      } else if (e.isDirectory() && e.name.startsWith("@")) await links(path);
    }
  }
  // pnpm keeps dependencies next to each store package, rather than inside it.
  await links(
    source.includes("/.pnpm/")
      ? dirname(source).endsWith("node_modules")
        ? dirname(source)
        : resolve(source, "../..")
      : join(source, "node_modules"),
  );
}
await copyPackage(join(root, "apps/cli"));
await cp(join(root, "apps/web/dist"), join(runtime, "apps/web/dist"), { recursive: true });
await cp(join(root, "pnpm-workspace.yaml"), join(runtime, "pnpm-workspace.yaml"));
const node = spawnSync("mise", ["where", "node"], { encoding: "utf8" });
if (node.status !== 0) throw Error(node.stderr);
await cp(join(node.stdout.trim(), "bin/node"), join(runtime, "bin/node"));
const pnpm = spawnSync("mise", ["where", "pnpm"], { encoding: "utf8" });
if (pnpm.status !== 0) throw Error(pnpm.stderr);
await cp(pnpm.stdout.trim(), join(runtime, "pnpm"), { recursive: true, dereference: true });
await symlink("../pnpm/pnpm", join(runtime, "bin/pnpm"));
await writeFile(
  join(runtime, "bin/composed"),
  '#!/bin/sh\nCOMPOSED_RUNTIME="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexport PATH="$COMPOSED_RUNTIME/bin:/usr/bin:/bin"\nexport NODE_ENV=production\nexec "$COMPOSED_RUNTIME/bin/node" --experimental-strip-types --no-warnings=ExperimentalWarning "$COMPOSED_RUNTIME/apps/cli/src/main.ts" "$@"\n',
  { mode: 0o755 },
);
console.log(JSON.stringify({ runtime, architecture: process.arch, packages: copied.size }));

const archive = join(root, "apps/desktop/src-tauri/runtime.tar.gz");
const tar = spawnSync("/usr/bin/tar", ["-czf", archive, "-C", runtime, "."], {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
if (tar.status !== 0) throw Error(String(tar.stderr));
await writeFile(
  join(root, "apps/desktop/src-tauri/runtime-id"),
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex"),
);
