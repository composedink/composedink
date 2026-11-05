import { object, type JsonValue } from "./schema.ts";
export function staticValue(node: unknown): JsonValue {
  if (!object(node)) throw new Error("Expected literal AST");
  switch (node.type) {
    case "Literal":
      if (
        node.value === null ||
        typeof node.value === "string" ||
        typeof node.value === "boolean" ||
        (typeof node.value === "number" && Number.isFinite(node.value))
      )
        return node.value;
      break;
    case "UnaryExpression":
      if (
        node.operator === "-" &&
        object(node.argument) &&
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number" &&
        Number.isFinite(node.argument.value)
      )
        return -node.argument.value;
      break;
    case "ArrayExpression":
      if (Array.isArray(node.elements)) return node.elements.map(staticValue);
      break;
    case "ObjectExpression": {
      const result: Record<string, JsonValue> = {};
      if (!Array.isArray(node.properties)) break;
      for (const prop of node.properties) {
        if (
          !object(prop) ||
          prop.type !== "Property" ||
          prop.computed ||
          prop.method ||
          prop.shorthand ||
          prop.kind !== "init" ||
          !object(prop.key)
        )
          throw new Error("Expected literal property");
        const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value;
        if (typeof key !== "string" || key === "__proto__" || key in result)
          throw new Error("Invalid literal key");
        result[key] = staticValue(prop.value);
      }
      return result;
    }
  }
  throw new Error("Expressions are forbidden; expected finite JSON literal");
}
