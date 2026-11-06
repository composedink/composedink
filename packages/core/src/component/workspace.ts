import { mkdir, mkdtemp, readFile, writeFile, rename, rm, access, lstat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { canonical, object, type JsonValue } from "@composedink/blocks";
import { command } from "./command.ts";
import { safePath } from "../model/files.ts";
export function packageDefinition(files: Record<string, string>) {
  for (const path of Object.keys(files)) safePath(path);
  const pkg: unknown = JSON.parse(files["package.json"]);
  if (!object(pkg)) throw Error("Invalid package.json");
  if (pkg.scripts !== undefined) {
    if (
      !object(pkg.scripts) ||
      Object.values(pkg.scripts).some((value) => typeof value !== "string")
    )
      throw Error("Invalid package scripts");
    const scripts = pkg.scripts;
    if (
      [
        "preinstall",
        "install",
        "postinstall",
        "prepare",
        "preprepare",
        "postprepare",
        "prepublish",
      ].some((name) => name in scripts)
    )
      throw Error("Install scripts are forbidden");
  }
  for (const field of ["dependencies", "devDependencies"]) {
    if (pkg[field] === undefined) continue;
    if (!object(pkg[field])) throw Error(`Invalid ${field}`);
    for (const [name, version] of Object.entries(pkg[field])) {
      if (
        !/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
        typeof version !== "string" ||
        /^(?:file:|link:|workspace:|git|https?:|\/|\.)/.test(version)
      )
        throw Error("Dependencies must be npm registry versions");
    }
  }
  if (pkg.pnpm || pkg.workspaces) throw Error("Package install configuration is forbidden");
  return pkg;
}
export async function materialize(
  home: string,
  id: string,
  files: Record<string, string>,
  settings: JsonValue,
) {
  packageDefinition(files);
  const blocks = dirname(fileURLToPath(import.meta.resolve("@composedink/blocks/package.json")));
  const workspace = resolve(blocks, "../..");
  const catalog = await readFile(join(workspace, "pnpm-workspace.yaml"), "utf8");
  const version = (name: string) => {
    const match = catalog.match(new RegExp(`  "${name}": "([^" ]+)"`));
    if (!match) throw new Error(`Missing catalog ${name}`);
    return match[1];
  };
  const root = join(home, "build", Buffer.from(id).toString("base64url"));
  await mkdir(root, { recursive: true });
  const temporary = await mkdtemp(join(root, "prepare-"));
  let logs = "";
  try {
    for (const [path, source] of Object.entries(files)) {
      safePath(path);
      await mkdir(dirname(join(temporary, path)), { recursive: true });
      await writeFile(join(temporary, path), source);
    }
    const pkg = packageDefinition(files);
    await writeFile(
      join(temporary, "package.json"),
      JSON.stringify({
        ...pkg,
        devDependencies: {
          ...(object(pkg.devDependencies) ? pkg.devDependencies : {}),
          typescript: version("typescript"),
          "@types/react": version("@types/react"),
          "@types/react-dom": version("@types/react-dom"),
          react: version("react"),
          "react-dom": version("react-dom"),
          "@rsbuild/core": version("@rsbuild/core"),
          "@rsbuild/plugin-react": version("@rsbuild/plugin-react"),
          "@module-federation/rsbuild-plugin": version("@module-federation/rsbuild-plugin"),
          "@composedink/blocks": `link:${blocks}`,
        },
      }),
    );
    const resolution = join(
      root,
      "resolution-" +
        createHash("sha256")
          .update(await readFile(join(temporary, "package.json")))
          .digest("hex") +
        ".yaml",
    );
    try {
      if (files["pnpm-lock.yaml"] !== undefined)
        await writeFile(join(temporary, "pnpm-lock.yaml"), files["pnpm-lock.yaml"]);
      else await writeFile(join(temporary, "pnpm-lock.yaml"), await readFile(resolution));
    } catch {
      logs += await command("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], temporary);
      await writeFile(resolution, await readFile(join(temporary, "pnpm-lock.yaml")));
    }
    const lock = await readFile(join(temporary, "pnpm-lock.yaml"), "utf8");
    const sourceHash = createHash("sha256")
      .update(canonical({ files, lock, settings }))
      .digest("hex");
    const directory = join(root, sourceHash);
    try {
      await access(directory);
      await rm(temporary, { recursive: true, force: true });
    } catch {
      await rename(temporary, directory);
    }
    for (const path of ["", ...Object.keys(files)]) {
      let current = directory;
      if ((await lstat(current)).isSymbolicLink()) throw Error("Symlink build directory");
      for (const part of path.split("/").filter(Boolean)) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw Error("Symlink component path");
      }
    }
    logs += await command("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], directory);
    return { directory, sourceHash, logs };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
