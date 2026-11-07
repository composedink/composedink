import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import ts from "typescript";
import { expect, it } from "vite-plus/test";

const root = resolve(import.meta.dirname, "..");
const owners = new Map([
  ["packages/lint", "@composedink/lint"],
  ["packages/blocks", "@composedink/blocks"],
  ["packages/core", "@composedink/core"],
  ["packages/host-runtime", "@composedink/host-runtime"],
  ["packages/host-tanstack", "@composedink/host-tanstack"],
  ["apps/cli", "composed-cli"],
  ["apps/server", "composed-server"],
  ["apps/web", "composed-web"],
  ["examples/host-tanstack", "host-tanstack"],
]);
const allowed = new Map([
  ["@composedink/lint", ["@composedink/blocks"]],
  ["@composedink/blocks", []],
  ["composed-server", ["@composedink/blocks", "@composedink/core"]],
  ["@composedink/core", ["@composedink/blocks", "@composedink/lint"]],
  ["@composedink/host-runtime", ["@composedink/blocks"]],
  ["@composedink/host-tanstack", ["@composedink/blocks", "@composedink/host-runtime"]],
  [
    "composed-cli",
    ["@composedink/core", "@composedink/blocks", "composed-web", "@composedink/lint"],
  ],
  ["composed-web", ["@composedink/core", "@composedink/blocks", "@composedink/lint"]],
  ["host-tanstack", ["@composedink/host-tanstack", "@composedink/blocks"]],
]);

async function* files(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".vite", "test-results"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.[cm]?tsx?$/.test(path)) yield path;
  }
}

async function violations(path: string, source: string, ownerDirectory: string) {
  const owner = owners.get(ownerDirectory);
  const issues: string[] = [];
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const ownerRoot = resolve(root, ownerDirectory);
  const mutable =
    path.startsWith(resolve(root, "packages/core/src/model") + sep) ||
    path === resolve(root, "apps/web/src/editor/sync.ts");
  function specifier(value: string) {
    if (value.startsWith(".")) {
      const target = relative(ownerRoot, resolve(dirname(path), value));
      if (target === ".." || target.startsWith(`..${sep}`))
        issues.push(`relative escape: ${value}`);
    }
    const target = [...owners.values()].find(
      (name) => value === name || value.startsWith(`${name}/`),
    );
    if (!target) return;
    if (target !== owner && !allowed.get(owner ?? "")?.includes(target))
      issues.push(`forbidden edge: ${value}`);
    if (value.includes("/src/")) issues.push(`deep source import: ${value}`);
    if (owner === "composed-web" && value === "@composedink/core/node")
      issues.push(`browser node import: ${value}`);
    // The server image carries no build toolchain: only the model entry of core.
    if (
      owner === "composed-server" &&
      target === "@composedink/core" &&
      value !== "@composedink/core/model"
    )
      issues.push(`server core import other than @composedink/core/model: ${value}`);
  }
  function walk(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifier(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        specifier(node.arguments[0].text);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        /^(insert|delete|update|mark|unmark|applyDelta)$/.test(node.expression.name.text)
      ) {
        const receiver = node.expression.expression.getText(ast);
        if (!mutable && /\b(mdx|files)\b/.test(receiver))
          issues.push(`document mutation outside model: ${receiver}`);
        if (path.includes(`${sep}core${sep}src${sep}store${sep}`)) issues.push("store mutation");
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  return issues;
}

it("rejects relative sibling escapes and deep imports in the forbidden fixture", async () => {
  const path = resolve(root, "packages/blocks/src/forbidden.ts");
  const source = await readFile(resolve(root, "tests/fixtures/forbidden-import.ts.txt"), "utf8");
  expect(await violations(path, source, "packages/blocks")).toEqual(
    expect.arrayContaining([
      expect.stringContaining("relative escape"),
      expect.stringContaining("deep source import"),
      expect.stringContaining("forbidden edge"),
    ]),
  );
});

it("keeps every workspace source within its package boundaries", async () => {
  const issues: string[] = [];
  for (const directory of owners.keys()) {
    for await (const path of files(resolve(root, directory))) {
      for (const issue of await violations(path, await readFile(path, "utf8"), directory))
        issues.push(`${relative(root, path)}: ${issue}`);
    }
  }
  expect(issues).toEqual([]);
});
