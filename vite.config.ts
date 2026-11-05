import { defineConfig } from "vite-plus";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
  // TanStack regenerates route trees in its own style on every build; never format them.
  fmt: { ignorePatterns: ["**/routeTree.gen.ts"] },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
