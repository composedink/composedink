import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vite-plus/test";

const model = resolve(import.meta.dirname, "../src/model");
/** `@composedink/blocks` (render keys: `jsxProps`, `canonical`) has no runtime dependencies. */
const allowed = (specifier: string) =>
  specifier === "loro-crdt" ||
  specifier === "zod" ||
  specifier === "@composedink/blocks" ||
  specifier.startsWith("node:");

/** External specifiers reachable through runtime (non type-only) imports from `entry`. */
function externals(entry: string) {
  const seen = new Set<string>();
  const found = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
    for (const node of source.statements) {
      let specifier: string | undefined;
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        if (node.importClause?.isTypeOnly) continue;
        specifier = node.moduleSpecifier.text;
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        if (node.isTypeOnly) continue;
        specifier = node.moduleSpecifier.text;
      }
      if (specifier === undefined) continue;
      if (specifier.startsWith(".")) visit(resolve(dirname(path), specifier));
      else found.add(specifier);
    }
  };
  visit(entry);
  return [...found].sort();
}

it("keeps @composedink/core/model free of build tools", () => {
  const found = externals(resolve(model, "index.ts"));
  expect(found).toContain("loro-crdt");
  expect(found.filter((s) => !allowed(s))).toEqual([]);
});

it("would reject the entry if apply.ts (MDX compiler) were added to it", () => {
  expect(externals(resolve(model, "apply.ts")).filter((s) => !allowed(s))).toContain("@mdx-js/mdx");
});
