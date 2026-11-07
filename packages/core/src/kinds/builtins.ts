import { DEFAULT_RULES } from "@composedink/lint";
// Editable seed content: copied into $COMPOSED_HOME/kinds/<id>/ on first use, then the user's.
export const QUESTIONS = [
  "How easy was it to read, and what one thing would improve it?",
  "What resonated, and what was redundant?",
  "How could the takeaways be clearer?",
  "Which part was most confusing?",
];
const inFrontmatter = (reader: string, medium: string, budget: number) => ({
  reader,
  medium,
  budget,
  frontmatter: ["reader", "medium", "budget"],
  meta: [],
  export: { strip: [] },
  questions: QUESTIONS,
});
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const fromPost = json({ extends: "post", rules: {}, custom: [] });
const seed = (kind: unknown, template: string, rules = fromPost) => ({
  "kind.json": json(kind),
  "template.mdx": template,
  "rules.json": rules,
});
export const BUILTIN_KINDS: Record<
  string,
  Record<"kind.json" | "template.mdx" | "rules.json", string>
> = {
  post: seed(
    inFrontmatter("blog readers", "web", 1200),
    "---\ntitle: Untitled\n---\n\n",
    json(DEFAULT_RULES),
  ),
  "weekly-update": seed(
    inFrontmatter("teammates", "screen", 500),
    "---\ntitle: Weekly update\n---\n\n## Done\n\n## Next\n\n## Blocked\n",
  ),
  proposal: seed(
    inFrontmatter("decision makers", "screen", 1500),
    "---\ntitle: Proposal\n---\n\n## Problem\n\n## Proposal\n\n## Alternatives\n\n## Decision needed\n",
  ),
  "design-doc": seed(
    inFrontmatter("implementers", "screen", 2000),
    "---\ntitle: Design\n---\n\n## Context\n\n## Goals and non-goals\n\n## Design\n\n## Alternatives considered\n\n## Risks\n",
  ),
  hellotimber: seed(
    {
      reader: "blog readers",
      medium: "web",
      budget: 1200,
      frontmatter: [],
      meta: ["reader", "medium", "budget"],
      export: { strip: ["reader", "medium", "budget"] },
      questions: QUESTIONS,
    },
    '---\ntitle: Untitled\nsummary: ""\ndraft: true\n---\n\n',
  ),
};
