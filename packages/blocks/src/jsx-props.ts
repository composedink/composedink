import { object, type JsonValue } from "./schema.ts";
import { staticValue } from "./static-value.ts";
export function jsxProps(attributes: unknown): Record<string, JsonValue> {
  if (!Array.isArray(attributes)) throw new Error("Expected JSX attributes");
  const result: Record<string, JsonValue> = {};
  for (const attribute of attributes) {
    if (
      !object(attribute) ||
      attribute.type !== "mdxJsxAttribute" ||
      typeof attribute.name !== "string" ||
      attribute.name in result
    )
      throw new Error("Expected literal JSX props");
    const value = attribute.value;
    if (value === null) {
      result[attribute.name] = true;
      continue;
    }
    if (typeof value === "string") {
      result[attribute.name] = value;
      continue;
    }
    if (
      !object(value) ||
      !object(value.data) ||
      !object(value.data.estree) ||
      !Array.isArray(value.data.estree.body) ||
      !object(value.data.estree.body[0])
    )
      throw new Error("Expected literal JSX value");
    result[attribute.name] = staticValue(value.data.estree.body[0].expression);
  }
  return result;
}
