import { mkdir, mkdtemp, readFile, writeFile, rename, rm, cp, access } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseAst } from "vite";
import { createRsbuild } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import {
  SHARED_SINGLETONS,
  staticValue,
  parseSchema,
  applyDefaults,
  object,
  canonical,
  type JsonValue,
} from "@composedink/blocks";
import { safePath } from "./model/files.ts";
import { compileFallback } from "./fallback/evaluator.ts";
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export function manifest(source: string) {
  const ast = parseAst(source, { lang: "tsx" }, "block.tsx");
  const statement = ast.body.find((n) => n.type === "ExportDefaultDeclaration");
  if (
    !statement ||
    statement.type !== "ExportDefaultDeclaration" ||
    statement.declaration.type !== "CallExpression" ||
    statement.declaration.callee.type !== "Identifier" ||
    statement.declaration.callee.name !== "defineBlock"
  )
    throw new Error("Expected literal defineBlock default export");
  const argument = statement.declaration.arguments[0];
  if (!argument || argument.type !== "ObjectExpression")
    throw new Error("Expected literal definition");
  const values: Record<string, JsonValue> = {};
  for (const property of argument.properties) {
    if (
      property.type !== "Property" ||
      property.computed ||
      property.method ||
      property.shorthand ||
      property.kind !== "init" ||
      property.key.type !== "Identifier"
    ) {
      if (
        property.type === "Property" &&
        property.shorthand &&
        property.key.type === "Identifier" &&
        ["component", "fallback"].includes(property.key.name)
      )
        continue;
      throw new Error("Expected literal block properties");
    }
    const key = property.key.name;
    if (!["kind", "props", "sample", "editor", "component", "fallback"].includes(key))
      throw new Error(`Unknown manifest key ${key}`);
    if (key === "component" || key === "fallback") continue;
    if (key in values) throw new Error("Duplicate manifest key");
    values[key] = staticValue(property.value);
  }
  if (values.kind !== "inline" && values.kind !== "block") throw new Error("Invalid kind");
  const props = parseSchema(values.props);
  if (props.type !== "object") throw new Error("Expected object props");
  if (
    values.editor !== undefined &&
    (!object(values.editor) ||
      Object.keys(values.editor).some((k) => k !== "label") ||
      (values.editor.label !== undefined && typeof values.editor.label !== "string"))
  )
    throw new Error("Invalid editor metadata");
  const kind: "inline" | "block" = values.kind;
  return { kind, props, sample: applyDefaults(props, values.sample) };
}
export async function command(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${output}`)),
    );
  });
}
export async function bundle(
  home: string,
  id: string,
  files: Record<string, string>,
  artifactOrigin: string,
) {
  const extracted = manifest(files["block.tsx"]);
  const fallback = await compileFallback(files["fallback.ts"]);
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
    const pkg: unknown = JSON.parse(files["package.json"]);
    if (!object(pkg)) throw new Error("Invalid package.json");
    await writeFile(
      join(temporary, "package.json"),
      JSON.stringify({
        ...pkg,
        devDependencies: {
          react: version("react"),
          "react-dom": version("react-dom"),
          "@rsbuild/core": version("@rsbuild/core"),
          "@rsbuild/plugin-react": version("@rsbuild/plugin-react"),
          "@module-federation/rsbuild-plugin": version("@module-federation/rsbuild-plugin"),
          "@composedink/blocks": `link:${blocks}`,
        },
      }),
    );
    logs += await command("pnpm", ["install", "--lockfile-only", "--ignore-scripts"], temporary);
    const lock = await readFile(join(temporary, "pnpm-lock.yaml"), "utf8");
    const settings = {
      exposes: { "./block": "./block.tsx" },
      shared: Object.fromEntries(
        SHARED_SINGLETONS.map((key) => [
          key,
          { singleton: true, import: false as const, requiredVersion: false as const },
        ]),
      ),
      bundler: "rsbuild",
      libraryType: "var",
      manifest: true,
      publicPath: artifactOrigin,
      jsxDevelopment: false,
      nodeEnv: "production",
      entry: "empty",
    };
    const sourceHash = sha256(canonical({ files, lock, settings }));
    const versionString = `0.1.0-dev.${sourceHash}`;
    const name = `composed_${sha256(id + versionString)}`;
    const directory = join(root, sourceHash);
    try {
      await access(directory);
      await rm(temporary, { recursive: true, force: true });
    } catch {
      await rename(temporary, directory);
    }
    const artifact = join(home, "artifacts", name);
    try {
      await access(join(artifact, "remoteEntry.js"));
    } catch {
      logs += await command(
        "pnpm",
        ["install", "--frozen-lockfile", "--ignore-scripts"],
        directory,
      );
      await writeFile(join(directory, ".composed-entry.js"), "export {};\n");
      const builder = await createRsbuild({
        cwd: directory,
        rsbuildConfig: {
          mode: "production",
          source: {
            entry: { index: join(directory, ".composed-entry.js") },
            define: { "process.env.NODE_ENV": JSON.stringify("production") },
          },
          output: {
            distPath: { root: join(directory, "dist") },
            assetPrefix: `${artifactOrigin}/${name}/`,
            minify: false,
          },
          plugins: [
            pluginReact(),
            pluginModuleFederation({
              name,
              library: { type: "var", name },
              dts: false,
              manifest: true,
              filename: "remoteEntry.js",
              exposes: settings.exposes,
              shared: settings.shared,
            }),
          ],
        },
      });
      await builder.build();
      await mkdir(dirname(artifact), { recursive: true });
      await cp(join(directory, "dist"), artifact, { recursive: true });
    }
    return {
      ...extracted,
      id,
      version: versionString,
      name,
      sourceHash,
      entry: `${artifactOrigin}/${name}/remoteEntry.js`,
      fallback,
      logs,
    };
  } catch (error) {
    await mkdir(join(workspace, "test-results"), { recursive: true });
    await writeFile(join(workspace, "test-results", "bundle-failure.log"), logs + String(error));
    throw error;
  }
}
