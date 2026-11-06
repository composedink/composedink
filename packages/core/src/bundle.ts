import { createRsbuild, type Rspack } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginModuleFederation } from "@module-federation/rsbuild-plugin";
import { manifest } from "./component/manifest.ts";
export { manifest } from "./component/manifest.ts";
export { command } from "./component/command.ts";
import { SHARED_SINGLETONS } from "@composedink/blocks";
import { materialize } from "./component/workspace.ts";
import { checkComponent } from "./component/check.ts";
import { mkdir, writeFile, cp, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { compileFallback } from "./fallback/evaluator.ts";
export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export async function bundle(
  home: string,
  id: string,
  files: Record<string, string>,
  artifactOrigin: string,
) {
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
  const { directory, sourceHash, logs } = await materialize(home, id, files, settings);
  const checked = await checkComponent(home, id, files, directory);
  if (!checked.ok) throw Error(`BuildFailed: ${JSON.stringify(checked.diagnostics)}`);
  const extracted = manifest(files["block.tsx"]);
  const fallback = await compileFallback(files["fallback.ts"]);

  const versionString = `0.1.0-dev.${sourceHash}`;
  const name = `composed_${sha256(id + versionString)}`;
  const artifact = join(home, "artifacts", name);
  try {
    await access(join(artifact, "remoteEntry.js"));
  } catch {
    await writeFile(join(directory, ".composed-entry.js"), "export {};\n");
    let buildDiagnostics = "";
    const builder = await createRsbuild({
      cwd: directory,
      rsbuildConfig: {
        mode: "production",
        tools: {
          rspack(config) {
            config.plugins ??= [];
            config.plugins.push({
              apply(compiler: Rspack.Compiler) {
                compiler.hooks.done.tap("composed-diagnostics", (stats) => {
                  if (stats.hasErrors())
                    buildDiagnostics = stats.toString({
                      all: false,
                      errors: true,
                      errorDetails: true,
                    });
                });
              },
            });
          },
        },
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
    try {
      await builder.build();
    } catch (error) {
      throw Error(`BuildFailed: ${buildDiagnostics || String(error)}`);
    }
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
}
