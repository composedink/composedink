import { createProcessor } from "@mdx-js/mdx";
import { parseDocument } from "yaml";
export function validateProjection(text: string, ranges: unknown) {
  const yaml = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  try {
    if (text.startsWith("---\n") || text.startsWith("---\r\n")) {
      if (!yaml) throw Error("Unclosed frontmatter");
      const parsed = parseDocument(yaml[1]);
      if (parsed.errors.length) throw parsed.errors[0];
    }
    return createProcessor().parse(
      yaml ? yaml[0].replace(/[^\r\n]/g, " ") + text.slice(yaml[0].length) : text,
    );
  } catch (error) {
    throw Error(
      `InvalidInvariant: invalid projected MDX/frontmatter; omitted source ranges ${JSON.stringify(ranges)}: ${String(error)}`,
    );
  }
}
