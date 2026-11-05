import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import { remarkComposed, composedLockReload } from "@composedink/host-tanstack/remark";
export default defineConfig(({ command }) => ({
  plugins: [
    composedLockReload(),
    {
      ...mdx({ remarkPlugins: [[remarkComposed, { production: command === "build" }]] }),
      enforce: "pre",
    },
    tanstackStart({
      prerender: {
        enabled: true,
        crawlLinks: false,
        filter: (page) => page.path === "/posts/tracer",
      },
      pages: [{ path: "/posts/tracer", prerender: { enabled: true } }],
    }),
    react(),
    {
      name: "composed-module-trace",
      generateBundle(_, bundle) {
        this.emitFile({
          type: "asset",
          fileName: "module-trace.json",
          source: JSON.stringify(
            Object.values(bundle).flatMap((item) =>
              item.type === "chunk" ? Object.keys(item.modules) : [],
            ),
            null,
            2,
          ),
        });
      },
    },
  ],
  optimizeDeps: { exclude: ["loro-crdt", "loro-codemirror"] },
  test: { include: ["tests/**/*.test.ts"], passWithNoTests: true },
}));
