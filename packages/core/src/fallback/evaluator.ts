import { Worker } from "node:worker_threads";
import { parseAst, transformWithOxc } from "vite";
import { object, type JsonValue } from "@composedink/blocks";
export async function compileFallback(source: string) {
  const transformed = await transformWithOxc(source, "fallback.ts", { lang: "ts" });
  const ast = parseAst(source, { lang: "ts" }, "fallback.ts");
  function scan(node: unknown) {
    if (!object(node)) return;
    if (
      ["ImportDeclaration", "ImportExpression", "ExportAllDeclaration"].includes(
        String(node.type),
      ) ||
      (node.type === "ExportNamedDeclaration" && node.source) ||
      (node.type === "CallExpression" && object(node.callee) && node.callee.name === "require")
    )
      throw Object.assign(new Error("Fallback imports and require are forbidden"), {
        offset: node.start,
      });
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(scan);
      else if (object(value)) scan(value);
    }
  }
  scan(ast);
  if (ast.body.length !== 1 || ast.body[0].type !== "ExportDefaultDeclaration")
    throw new Error("Expected only default fallback function");
  const built = parseAst(transformed.code);
  const declaration = built.body[0];
  if (declaration.type !== "ExportDefaultDeclaration") throw new Error("Expected default export");
  const expression = declaration.declaration;
  if (
    expression.type !== "ArrowFunctionExpression" &&
    expression.type !== "FunctionDeclaration" &&
    expression.type !== "FunctionExpression"
  )
    throw new Error("Expected fallback function");
  return transformed.code.slice(expression.start, expression.end);
}
export async function evaluateFallback(
  code: string,
  props: Record<string, JsonValue>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      workerData: { code, props: JSON.stringify(props) },
      execArgv: ["--experimental-strip-types"],
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("Fallback timeout"));
    }, 1000);
    const finish = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once("message", (message: unknown) => {
      finish();
      if (object(message) && typeof message.value === "string") resolve(message.value);
      else
        reject(
          new Error(
            object(message) && typeof message.error === "string"
              ? message.error
              : "Fallback failed",
          ),
        );
    });
    worker.once("error", (error) => {
      finish();
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish();
        reject(new Error(`Fallback worker exited ${code}`));
      }
    });
  });
}
