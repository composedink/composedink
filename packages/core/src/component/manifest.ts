import { parseAst } from "vite";
import {
  staticValue,
  parseSchema,
  applyDefaults,
  object,
  type JsonValue,
} from "@composedink/blocks";
export function manifest(source: string) {
  const ast = parseAst(source, { lang: "tsx" }, "block.tsx");
  const statement = ast.body.find((n) => n.type === "ExportDefaultDeclaration");
  if (
    !statement ||
    statement.type !== "ExportDefaultDeclaration" ||
    statement.declaration.type !== "CallExpression" ||
    statement.declaration.callee.type !== "Identifier" ||
    statement.declaration.callee.name !== "defineBlock"
  )
    throw new Error("Expected literal defineBlock default export");
  const argument = statement.declaration.arguments[0];
  if (!argument || argument.type !== "ObjectExpression")
    throw new Error("Expected literal definition");
  const values: Record<string, JsonValue> = {};
  const offsets: Record<string, number> = {};
  for (const property of argument.properties) {
    if (
      property.type !== "Property" ||
      property.computed ||
      property.method ||
      property.shorthand ||
      property.kind !== "init" ||
      property.key.type !== "Identifier"
    ) {
      if (
        property.type === "Property" &&
        property.shorthand &&
        property.key.type === "Identifier" &&
        ["component", "fallback"].includes(property.key.name)
      )
        continue;
      throw new Error("Expected literal block properties");
    }
    const key = property.key.name;
    if (!["kind", "props", "sample", "editor", "component", "fallback"].includes(key))
      throw new Error(`Unknown manifest key ${key}`);
    if (key === "component" || key === "fallback") continue;
    if (key in values) throw new Error("Duplicate manifest key");
    offsets[key] = property.value.start;
    try {
      values[key] = staticValue(property.value);
    } catch (error) {
      throw Object.assign(new Error(String(error)), { offset: property.value.start });
    }
  }
  if (values.kind !== "inline" && values.kind !== "block") throw new Error("Invalid kind");
  let props;
  try {
    props = parseSchema(values.props);
  } catch (error) {
    throw Object.assign(new Error(String(error)), { offset: offsets.props });
  }
  if (props.type !== "object") throw new Error("Expected object props");
  if (
    values.editor !== undefined &&
    (!object(values.editor) ||
      Object.keys(values.editor).some((k) => k !== "label") ||
      (values.editor.label !== undefined && typeof values.editor.label !== "string"))
  )
    throw new Error("Invalid editor metadata");
  const kind: "inline" | "block" = values.kind;
  let sample;
  try {
    sample = applyDefaults(props, values.sample);
  } catch (error) {
    throw Object.assign(new Error(String(error)), { offset: offsets.sample });
  }
  return {
    kind,
    props,
    sample,
    ...(values.editor === undefined ? {} : { editor: values.editor }),
  };
}
