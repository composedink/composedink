import { defineConfig, type Rspack } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/rsbuild";
import { remarkComposed } from "@composedink/host-tanstack/remark";
import { fileURLToPath } from "node:url";
export default defineConfig(({ command }) => ({
  plugins: [
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
        filter: (page) => page.path === "/posts/tracer",
      },
      pages: [{ path: "/posts/tracer", prerender: { enabled: true } }],
    }),
    pluginReact(),
  ],
  tools: {
    rspack(config, { appendPlugins, rspack }) {
      config.module ??= {};
      config.module.rules ??= [];
      config.module.rules.push({
        test: /\.mdx$/,
        use: [
          {
            loader: "@mdx-js/loader",
            options: { remarkPlugins: [[remarkComposed, { production: command === "build" }]] },
          },
          { loader: fileURLToPath(new URL("./loaders/composed-lock.cjs", import.meta.url)) },
        ],
      });
      appendPlugins({
        apply(compiler: Rspack.Compiler) {
          compiler.hooks.thisCompilation.tap("composed-module-trace", (compilation) => {
            compilation.hooks.processAssets.tap(
              {
                name: "composed-module-trace",
                stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
              },
              () =>
                compilation.emitAsset(
                  "module-trace.json",
                  new rspack.sources.RawSource(
                    JSON.stringify(
                      [...compilation.modules].map((module) => module.identifier()),
                      null,
                      2,
                    ),
                  ),
                ),
            );
          });
        },
      });
    },
  },
}));
