import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: { entry: { index: "src/index.ts" }, dts: true, format: ["esm"] },
  test: { passWithNoTests: true, include: ["tests/**/*.test.ts"] },
});
