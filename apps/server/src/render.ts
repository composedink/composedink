import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { fromMarkdown } from "mdast-util-from-markdown";
import { jsxProps } from "@composedink/blocks";
import { renderKey } from "@composedink/core/model";

const SUMMARY_MAX = 200;
type Node = { type: string; children?: Node[]; value?: string; [key: string]: unknown };

/** The parse that MDX hosts run: Markdown, YAML frontmatter and MDX syntax. */
const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx);
/** No `allowDangerousHtml`: raw HTML nodes are dropped, never passed through. */
const printer = unified().use(remarkRehype).use(rehypeStringify);

/** A top-level plain or quoted `title:` scalar in the YAML frontmatter. */
function frontmatterTitle(yaml: string) {
  const match = /^title:[ \t]*(.*?)[ \t]*$/m.exec(yaml);
  if (!match) return undefined;
  const value = match[1];
  const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
  const title = quoted ? quoted[1] : value.replace(/[ \t]+#.*$/, "");
  return title || undefined;
}

function summary(attributes: unknown) {
  let text: string;
  try {
    text = JSON.stringify(jsxProps(attributes));
  } catch {
    text = "(expression props)";
  }
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
}

/** Fallback Markdown as mdast; raw HTML in it becomes text, as `remarkComposed` does. */
function fallback(markdown: string) {
  const tree = fromMarkdown(markdown) as unknown as Node;
  const clean = (node: Node) => {
    if (node.type === "html") node.type = "text";
    node.children?.forEach(clean);
  };
  clean(tree);
  return tree.children ?? [];
}

/** A labelled placeholder: `<figure class="block" data-tag>` (`<span>` inside a paragraph). */
function placeholder(tag: string, attributes: unknown, inline: boolean): Node {
  const element = (tagName: string, value: string) => ({
    type: "element",
    tagName,
    properties: {},
    children: [{ type: "text", value }],
  });
  return {
    type: inline ? "emphasis" : "paragraph",
    children: [],
    data: {
      hName: inline ? "span" : "figure",
      hProperties: { className: ["block"], dataTag: tag },
      hChildren: [
        element("strong", `<${tag}>`),
        { type: "text", value: " " },
        element("code", summary(attributes)),
      ],
    },
  };
}

/** Rewrites children in place: frontmatter, ESM and expressions leave; JSX becomes fallback or placeholder. */
function transform(node: Node, instances: Record<string, string>, found: { title?: string }) {
  if (!node.children) return;
  node.children = node.children.flatMap((child): Node[] => {
    switch (child.type) {
      case "yaml":
        found.title ??= frontmatterTitle(String(child.value ?? ""));
        return [];
      case "mdxjsEsm":
      case "mdxFlowExpression":
      case "mdxTextExpression":
        return [];
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement": {
        const inline = child.type === "mdxJsxTextElement";
        const tag = typeof child.name === "string" ? child.name : "";
        let markdown: string | undefined;
        try {
          markdown = tag ? instances[renderKey(tag, child.attributes)] : undefined;
        } catch {
          markdown = undefined;
        }
        if (markdown === undefined)
          return [placeholder(tag || "fragment", child.attributes, inline)];
        const nodes = fallback(markdown);
        return inline && nodes.length === 1 && nodes[0].type === "paragraph"
          ? (nodes[0].children ?? [])
          : nodes;
      }
      default:
        transform(child, instances, found);
        return [child];
    }
  });
}

/**
 * Renders a clean projection to article HTML for a link page. Block usages render their snapshot
 * fallback when the authority uploaded one, else a placeholder; no component code runs. Text that
 * does not parse as MDX (an edit in progress) renders as preformatted text.
 */
export function renderArticle(text: string, instances: Record<string, string>) {
  const found: { title?: string } = {};
  let tree: Node;
  try {
    tree = parser.parse(text) as unknown as Node;
  } catch {
    tree = {
      type: "root",
      children: [{ type: "code", value: text.replace(/^---\n[\s\S]*?\n---\n/, "") }],
    };
  }
  transform(tree, instances, found);
  const html = printer.stringify(printer.runSync(tree as never) as never);
  return { title: found.title, html: String(html) };
}
