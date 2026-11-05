import { expect, it } from "vite-plus/test";
import { applyDefaults, validateProps, staticValue, parseSchema, canonical } from "../src/index.ts";
it("applies defaults and rejects unknown and invalid props", () => {
  const schema = {
    type: "object",
    properties: { n: { type: "integer", minimum: 1, default: 2 }, name: { type: "string" } },
    required: ["name"],
  } as const;
  expect(applyDefaults(schema, { name: "Lachlan" })).toEqual({ n: 2, name: "Lachlan" });
  expect(validateProps(schema, { name: "x", extra: true })).not.toEqual([]);
  expect(validateProps(schema, { name: "x", n: 1.5 })).not.toEqual([]);
  expect(() => parseSchema({ type: "number", minimum: Infinity })).toThrow();
  expect(canonical({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
});
it("rejects calls, spreads, expressions and nonfinite numbers", () => {
  for (const node of [
    { type: "CallExpression" },
    { type: "Literal", value: Infinity },
    { type: "ObjectExpression", properties: [{ type: "SpreadElement" }] },
  ])
    expect(() => staticValue(node)).toThrow();
});
