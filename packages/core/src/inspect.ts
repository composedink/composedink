import { validateProjection } from "./model/validate.ts";
import { applyDefaults, jsxProps, object } from "@composedink/blocks";
import type { Authority } from "./authority.ts";
import { manifest } from "./bundle.ts";
import { readFiles } from "./model/files.ts";
export function inspect(
  a: Authority,
  id: string,
  view: import("./model/projection.ts").View = "full",
) {
  const result = a.read(id, view);
  const deps = a.get(id).getMap("deps").toJSON();
  const blocks: Array<{
    tag: string;
    version: string;
    props: unknown;
    validation: string;
    from: number;
    to: number;
  }> = [];
  let diagnostic = "";
  function walk(node: unknown) {
    if (!object(node)) return;
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      typeof node.name === "string"
    ) {
      const dep = deps[node.name];
      if (object(dep) && typeof dep.id === "string") {
        let validation = "Valid props";
        let props: unknown;
        try {
          const schema = manifest(readFiles(a.get(dep.id)).files["block.tsx"]).props;
          props = applyDefaults(schema, jsxProps(node.attributes));
        } catch (error) {
          validation = String(error);
        }
        const position = object(node.position) ? node.position : {};
        const start = object(position.start) ? position.start : {};
        const end = object(position.end) ? position.end : {};
        blocks.push({
          tag: node.name,
          version: String(dep.version),
          props,
          validation,
          from: typeof start.offset === "number" ? start.offset : 0,
          to: typeof end.offset === "number" ? end.offset : 0,
        });
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }
  try {
    walk(validateProjection(result.text, []));
  } catch (error) {
    diagnostic = String(error);
  }
  return { ...result, deps, blocks, diagnostic };
}
