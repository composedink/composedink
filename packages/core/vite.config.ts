import { defineConfig } from "vite-plus";
export default defineConfig({
  test: { passWithNoTests: true, include: ["tests/**/*.test.{ts,mjs}"] },
});
