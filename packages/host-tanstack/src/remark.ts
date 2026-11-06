import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { parseLock, jsxProps, applyDefaults, canonical, object } from "@composedink/blocks";
import { fromMarkdown } from "mdast-util-from-markdown";
const warnings = new Set<string>();
export function remarkComposed(options: { production?: boolean } = {}) {
  return async (tree: unknown, file: { path: string }) => {
    const path = join(dirname(file.path), "composed.lock.json");
    let json: unknown;
    try {
      json = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (object(error) && error.code === "ENOENT") return;
      throw error;
    }
    const lock = parseLock(json);
    let used = false;
    const expression = (value: string) => ({
      type: "mdxJsxAttributeValueExpression",
      value,
      data: { estree: undefined },
    });
    // MDX requires ESTree for synthesized expressions; literal ESTree is constructed below.
    const literal = (value: unknown): unknown =>
      Array.isArray(value)
        ? { type: "ArrayExpression", elements: value.map(literal) }
        : object(value)
          ? {
              type: "ObjectExpression",
              properties: Object.entries(value).map(([key, v]) => ({
                type: "Property",
                key: { type: "Literal", value: key },
                value: literal(v),
                kind: "init",
                method: false,
                shorthand: false,
                computed: false,
              })),
            }
          : { type: "Literal", value };
    const attribute = (name: string, value: unknown) => ({
      type: "mdxJsxAttribute",
      name,
      value: {
        ...expression(JSON.stringify(value)),
        data: {
          estree: {
            type: "Program",
            sourceType: "module",
            body: [{ type: "ExpressionStatement", expression: literal(value) }],
          },
        },
      },
    });
    function walk(node: unknown) {
      if (!object(node)) return;
      if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        typeof node.name === "string" &&
        lock.blocks[node.name]
      ) {
        const tag = node.name;
        const block = lock.blocks[tag];
        let props;
        try {
          props = applyDefaults(block.props, jsxProps(node.attributes));
        } catch (error) {
          throw new Error(
            `${file.path}:${object(node.position) && object(node.position.start) ? String(node.position.start.line) : 1}: ${String(error)}; composed export ${lock.doc}`,
          );
        }
        const hash = createHash("sha256").update(canonical(props)).digest("hex");
        const instance = block.instances[hash];
        if (!instance)
          throw new Error(`${file.path}: composed export ${lock.doc}: missing instance ${tag}`);
        const fallback = fromMarkdown(instance.markdown);
        function clean(n: unknown) {
          if (!object(n)) return;
          if (n.type === "html") {
            n.type = "text";
            n.value = String(n.value);
          }
          if (Array.isArray(n.children)) n.children.forEach(clean);
        }
        clean(fallback);
        node.name = "ComposedBlock";
        node.attributes = [
          attribute("use", block),
          attribute("props", props),
          attribute("production", Boolean(options.production && lock.mode === "preview")),
        ];
        node.children =
          block.kind === "inline" &&
          fallback.children.length === 1 &&
          fallback.children[0].type === "paragraph"
            ? fallback.children[0].children
            : fallback.children;
        used = true;
        return;
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    }
    walk(tree);
    if (!used || !object(tree) || !Array.isArray(tree.children)) return;
    // Retain the lock import in generated JS so the bundler tracks the sibling dependency.
    const sources = [
      ['import _lock from "./composed.lock.json";', "_lock", "./composed.lock.json"],
      [
        'import { ComposedBlock } from "@composedink/host-tanstack/block";',
        "ComposedBlock",
        "@composedink/host-tanstack/block",
      ],
    ] as const;
    for (const [value, local, source] of sources)
      tree.children.unshift({
        type: "mdxjsEsm",
        value,
        data: {
          estree: {
            type: "Program",
            sourceType: "module",
            body: [
              {
                type: "ImportDeclaration",
                specifiers: [
                  {
                    type: local === "_lock" ? "ImportDefaultSpecifier" : "ImportSpecifier",
                    local: { type: "Identifier", name: local },
                    ...(local === "_lock" ? {} : { imported: { type: "Identifier", name: local } }),
                  },
                ],
                source: { type: "Literal", value: source },
              },
            ],
          },
        },
      });
    // Replace inline descriptor literals with member expressions rooted at the imported lock.
    function link(n: unknown) {
      if (!object(n)) return;
      if (n.name === "ComposedBlock" && Array.isArray(n.attributes)) {
        const use = n.attributes.find((a) => object(a) && a.name === "use");
        if (
          object(use) &&
          object(use.value) &&
          object(use.value.data) &&
          object(use.value.data.estree) &&
          Array.isArray(use.value.data.estree.body)
        ) {
          const statement = use.value.data.estree.body[0];
          if (object(statement)) {
            const descriptor = lock.blocks;
            const serialized = use.value.value;
            const tag = Object.keys(descriptor).find(
              (t) => JSON.stringify(descriptor[t]) === serialized,
            );
            if (tag)
              statement.expression = {
                type: "MemberExpression",
                computed: true,
                optional: false,
                object: {
                  type: "MemberExpression",
                  computed: false,
                  optional: false,
                  object: { type: "Identifier", name: "_lock" },
                  property: { type: "Identifier", name: "blocks" },
                },
                property: { type: "Literal", value: tag },
              };
          }
        }
      }
      if (Array.isArray(n.children)) n.children.forEach(link);
    }
    link(tree);
    if (options.production && lock.mode === "preview" && !warnings.has(file.path)) {
      warnings.add(file.path);
      console.warn(`${file.path}: preview lock renders fallback only; composed export ${lock.doc}`);
    }
  };
}
