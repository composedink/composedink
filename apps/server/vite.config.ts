import { defineConfig } from "vite-plus";
export default defineConfig({
  test: { passWithNoTests: true, include: ["tests/**/*.test.ts"] },
  // The image runs dist/main.mjs: core/model and blocks are bundled; loro-crdt stays external
  // because it loads its WASM from its own directory.
  pack: {
    entry: { main: "src/main.ts" },
    format: ["esm"],
    platform: "node",
    dts: false,
    deps: { neverBundle: ["loro-crdt"] },
  },
});
