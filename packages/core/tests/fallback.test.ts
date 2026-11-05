import { expect, it } from "vite-plus/test";
import { compileFallback, evaluateFallback } from "../src/fallback/evaluator.ts";
it("evaluates fallback with JSON props and no imports", async () => {
  const code = await compileFallback(
    "export default ({ name }: {name:string}) => `Hello, **${name}**.`;",
  );
  expect(await evaluateFallback(code, { name: "Lachlan" })).toBe("Hello, **Lachlan**.");
  for (const source of [
    'import x from "x";export default ()=>"x"',
    'export default ()=>require("fs")',
    'export default ()=>import("fs")',
  ])
    await expect(compileFallback(source)).rejects.toThrow();
});
it.each([
  "process.exit()",
  'require("fs")',
  'fetch("http://localhost")',
  'this.constructor.constructor("return process")()',
  '({}).constructor.constructor("return process")()',
  'Error.prepareStackTrace = (_, stack) => stack[0].getThis().process; Error().stack.constructor.constructor("return process")()',
  'Function.prototype.constructor("return process")()',
  "while(true) {}",
  'Promise.resolve().then(()=>{while(true){}}); return "done"',
  'return "x".repeat(256*1024+1)',
])(
  "denies escape or resource abuse: %s",
  async (attack) => {
    await expect(
      compileFallback(`export default function() { ${attack} }`).then((code) =>
        evaluateFallback(code, {}),
      ),
    ).rejects.toThrow();
  },
  5000,
);
