import { z } from "zod";
import { registry } from "./registry.ts";
export function humanDirect(stdinTTY: boolean, explicit: boolean) {
  if (!stdinTTY && !explicit)
    throw Error("UnauthorizedDirect: direct acceptance requires a TTY or --i-am-human");
}
export const mcpRegistry = registry
  .filter((op) => op.name !== "doc.import")
  .map((op) => {
    const schema = z.toJSONSchema(op.input);
    // Mutation schemas add request using an intersection; flatten the object projection for tools.
    const parts = "allOf" in schema && Array.isArray(schema.allOf) ? schema.allOf : [schema];
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const part of parts) {
      if ("properties" in part) Object.assign(properties, part.properties);
      if ("required" in part && Array.isArray(part.required)) required.push(...part.required);
    }
    if (op.name === "doc.apply") {
      delete properties.mode;
    }
    const inputSchema = {
      type: "object" as const,
      properties,
      required: required.filter((k) => k !== "mode"),
      additionalProperties: false,
    };
    return {
      name: op.name.replaceAll(".", "_"),
      operation: op.name,
      inputSchema,
      parse(input: unknown) {
        const shape = z.strictObject(
          Object.fromEntries(Object.keys(properties).map((k) => [k, z.unknown().optional()])),
        );
        const value = shape.parse(input);
        return op.input.parse(op.name === "doc.apply" ? { ...value, mode: "propose" } : value);
      },
    };
  });
