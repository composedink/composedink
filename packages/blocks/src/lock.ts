import { object, parseSchema, applyDefaults, type JsonValue, type PropsSchema } from "./schema.ts";
export interface LockedBlock {
  id: string;
  version: string;
  kind: "inline" | "block";
  entry: string;
  sourceHash: string;
  props: PropsSchema;
  instances: Record<string, { props: Record<string, JsonValue>; markdown: string }>;
}
export interface ExportLock {
  composed: 1;
  mode: "preview" | "release";
  doc: string;
  base: string;
  view: "full" | "clean";
  sha256: string;
  blocks: Record<string, LockedBlock>;
}
export function parseLock(value: unknown): ExportLock {
  if (
    !object(value) ||
    value.composed !== 1 ||
    !["preview", "release"].includes(String(value.mode)) ||
    !["full", "clean"].includes(String(value.view)) ||
    typeof value.doc !== "string" ||
    typeof value.base !== "string" ||
    typeof value.sha256 !== "string" ||
    !object(value.blocks)
  )
    throw new Error("Invalid composed lock");
  for (const block of Object.values(value.blocks)) {
    if (
      !object(block) ||
      typeof block.id !== "string" ||
      typeof block.version !== "string" ||
      typeof block.entry !== "string" ||
      typeof block.sourceHash !== "string" ||
      !["inline", "block"].includes(String(block.kind)) ||
      !object(block.instances)
    )
      throw new Error("Invalid locked block");
    const schema = parseSchema(block.props);
    if (schema.type !== "object") throw new Error("Expected object props");
    const url = new URL(block.entry);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid entry URL");
    for (const instance of Object.values(block.instances)) {
      if (!object(instance) || typeof instance.markdown !== "string")
        throw new Error("Invalid instance");
      applyDefaults(schema, instance.props);
    }
  }
  return value as unknown as ExportLock;
}
