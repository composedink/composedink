import { expect, it } from "vite-plus/test";
import { createLinter } from "../src/index.ts";
import { settings } from "./settings.ts";
// Plan 18: filler phrases, overlapping filler and bold notes, and frontmatter that never lints.
const quiet = { ...settings, rules: { ...settings.rules, harper: false as const } };
const lint = (text: string, rules = quiet) =>
  createLinter().lint({ base: "w", text, settings: rules });
const at = (text: string, quote: string) => {
  const from = text.indexOf(quote);
  return { from, to: from + quote.length };
};
it("finds both hedges in “I think maybe”, case-insensitively and at word boundaries", async () => {
  const text = "I think maybe we ship. In My Opinion it works. Justify the thinking.";
  const filler = (await lint(text)).diagnostics.filter((d) => d.code === "filler");
  expect(filler.map(({ from, to }) => ({ from, to }))).toEqual([
    at(text, "I think"),
    at(text, "maybe"),
    at(text, "In My Opinion"),
  ]);
});
it("reports filler and bold.inline on the same range for **very**", async () => {
  const text = "The result was **very** good.";
  const found = (await lint(text)).diagnostics.filter((d) =>
    ["filler", "bold.inline"].includes(d.code),
  );
  expect(found.map((d) => d.code).sort()).toEqual(["bold.inline", "filler"]);
  expect(found.find((d) => d.code === "filler")).toMatchObject(at(text, "very"));
  // No legacy adverb note doubles a filler word.
  const twice = await lint("It actually and basically works.");
  expect(twice.diagnostics.filter((d) => d.code === "style:adverb")).toEqual([]);
  expect(twice.diagnostics.filter((d) => d.code === "filler")).toHaveLength(2);
});
it("a closed frontmatter block is never prose, even when its YAML is broken", async () => {
  const text = "---\ntitle: [unclosed\nmedium: web# Why I ship\n---\n\nThe body has one sentence.";
  const result = await createLinter().lint({ base: "b", text, settings });
  expect(result.sentences.map((s) => s.text)).toEqual(["The body has one sentence."]);
  const body = text.indexOf("The body");
  expect(result.diagnostics.filter((d) => d.from < body)).toEqual([]);
  // An empty block is closed too.
  const empty = await lint("---\n---\n\nOnly this counts.");
  expect(empty.sentences.map((s) => s.text)).toEqual(["Only this counts."]);
}, 30000);
it("a block that is opened but never closed is prose", async () => {
  const text = "---\ntitle: Open block. Still open.\n\nBody here.";
  const result = await lint(text);
  expect(result.sentences.map((s) => s.text)).toContain("Body here.");
  expect(result.sentences.some((s) => s.text.includes("Open block"))).toBe(true);
});
