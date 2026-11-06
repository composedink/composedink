import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: { entry: { remark: "src/remark.ts", block: "src/block.tsx" }, dts: true, format: ["esm"] },
  test: { passWithNoTests: true, include: ["tests/**/*.test.ts"] },
});
