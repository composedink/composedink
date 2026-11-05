export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type PropSchema =
  | { type: "string"; enum?: readonly string[]; default?: string; description?: string }
  | {
      type: "number" | "integer";
      minimum?: number;
      maximum?: number;
      default?: number;
      description?: string;
    }
  | { type: "boolean"; default?: boolean; description?: string }
  | { type: "array"; items: PropSchema; maxItems?: number; description?: string }
  | { type: "object"; properties: Record<string, PropSchema>; required?: readonly string[] };
export type PropsSchema = Extract<PropSchema, { type: "object" }>;
type Value<S extends PropSchema> = S extends { type: "string" }
  ? string
  : S extends { type: "number" | "integer" }
    ? number
    : S extends { type: "boolean" }
      ? boolean
      : S extends { type: "array"; items: infer I extends PropSchema }
        ? Value<I>[]
        : S extends PropsSchema
          ? PropsOf<S>
          : never;
type RequiredKeys<S extends PropsSchema> = S extends { required: readonly (infer K)[] } ? K : never;
export type PropsOf<S extends PropsSchema> = {
  [K in keyof S["properties"] as K extends RequiredKeys<S> ? K : never]: Value<S["properties"][K]>;
} & {
  [K in keyof S["properties"] as K extends RequiredKeys<S> ? never : K]?: Value<S["properties"][K]>;
};
export interface PropIssue {
  path: string;
  message: string;
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseSchema(value: unknown): PropSchema {
  if (!object(value)) throw new Error("Invalid schema");
  const allowed: Record<string, string[]> = {
    string: ["enum", "default", "description"],
    number: ["minimum", "maximum", "default", "description"],
    integer: ["minimum", "maximum", "default", "description"],
    boolean: ["default", "description"],
    array: ["items", "maxItems", "description"],
    object: ["properties", "required"],
  };
  if (
    typeof value.type !== "string" ||
    !allowed[value.type] ||
    Object.keys(value).some((k) => k !== "type" && !allowed[String(value.type)].includes(k))
  )
    throw new Error("Invalid schema keys");
  if (value.description !== undefined && typeof value.description !== "string")
    throw new Error("Invalid description");
  const numeric = (key: string) => {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "number" || !Number.isFinite(value[key]))
    )
      throw new Error(`Invalid ${key}`);
  };
  if (value.type === "object") {
    if (!object(value.properties)) throw new Error("Invalid properties");
    for (const s of Object.values(value.properties)) parseSchema(s);
    if (
      value.required !== undefined &&
      (!Array.isArray(value.required) ||
        value.required.some(
          (k) => typeof k !== "string" || !object(value.properties) || !(k in value.properties),
        ))
    )
      throw new Error("Invalid required");
  } else if (value.type === "array") {
    parseSchema(value.items);
    numeric("maxItems");
    if (
      typeof value.maxItems === "number" &&
      (!Number.isInteger(value.maxItems) || value.maxItems < 0)
    )
      throw new Error("Invalid maxItems");
  } else if (value.type === "string") {
    if (
      value.enum !== undefined &&
      (!Array.isArray(value.enum) || value.enum.some((v) => typeof v !== "string"))
    )
      throw new Error("Invalid enum");
    if (value.default !== undefined && typeof value.default !== "string")
      throw new Error("Invalid default");
  } else if (value.type === "boolean") {
    if (value.default !== undefined && typeof value.default !== "boolean")
      throw new Error("Invalid default");
  } else {
    numeric("minimum");
    numeric("maximum");
    numeric("default");
  }
  // Every branch and optional property is validated above.
  return value as PropSchema;
}
export function validateProps(schema: PropsSchema, value: unknown): PropIssue[] {
  const issues: PropIssue[] = [];
  function visit(s: PropSchema, v: unknown, path: string) {
    const fail = (message: string) => issues.push({ path, message });
    switch (s.type) {
      case "object":
        if (!object(v)) {
          fail("Expected object");
          return;
        }
        for (const key of Object.keys(v))
          if (!(key in s.properties)) fail(`Unknown property ${key}`);
        for (const [key, child] of Object.entries(s.properties)) {
          if (v[key] === undefined) {
            if (s.required?.includes(key) && !("default" in child)) fail(`Missing ${key}`);
          } else visit(child, v[key], `${path}.${key}`);
        }
        break;
      case "array":
        if (!Array.isArray(v)) {
          fail("Expected array");
          return;
        }
        if (s.maxItems !== undefined && v.length > s.maxItems) fail("Too many items");
        v.forEach((item, i) => visit(s.items, item, `${path}[${i}]`));
        break;
      case "string":
        if (typeof v !== "string" || (s.enum && !s.enum.includes(v)))
          fail("Expected allowed string");
        break;
      case "boolean":
        if (typeof v !== "boolean") fail("Expected boolean");
        break;
      case "number":
      case "integer":
        if (
          typeof v !== "number" ||
          !Number.isFinite(v) ||
          (s.type === "integer" && !Number.isInteger(v)) ||
          (s.minimum !== undefined && v < s.minimum) ||
          (s.maximum !== undefined && v > s.maximum)
        )
          fail("Expected number in range");
        break;
    }
  }
  visit(schema, value, "$");
  return issues;
}
export function applyDefaults(schema: PropsSchema, value: unknown): Record<string, JsonValue> {
  const issues = validateProps(schema, value);
  if (issues.length) throw new Error(JSON.stringify(issues));
  function defaults(s: PropSchema, v: unknown): JsonValue {
    if (s.type === "object" && object(v)) {
      const result: Record<string, JsonValue> = {};
      for (const [k, child] of Object.entries(s.properties)) {
        if (v[k] !== undefined) result[k] = defaults(child, v[k]);
        else if ("default" in child && child.default !== undefined) result[k] = child.default;
      }
      return result;
    }
    if (s.type === "array" && Array.isArray(v)) return v.map((item) => defaults(s.items, item));
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return v;
    throw new Error("Invalid JSON value");
  }
  const result = defaults(schema, value);
  if (!object(result)) throw new Error("Invalid props");
  return result as Record<string, JsonValue>;
}
export function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",")}}`;
  return JSON.stringify(value);
}
