import { expect, it } from "vite-plus/test";
import { createLinter, type Sentence } from "../src/index.ts";
import { settings } from "./settings.ts";
const quiet = { ...settings, rules: { ...settings.rules, harper: false as const } };
const lint = (text: string, engine = createLinter()) =>
  engine.lint({ base: "s", text, settings: quiet });
/** Expected sentences from quotes: the range is the quote's own position in the text. */
function expected(text: string, rows: [quote: string, words: number, shown?: string][]) {
  let from = 0;
  return rows.map(([quote, words, shown]): Sentence => {
    const at = text.indexOf(quote, from);
    if (at < 0) throw Error(`missing "${quote}"`);
    from = at + quote.length;
    return { from: at, to: at + quote.length, text: shown ?? quote, words };
  });
}
it("positions prose sentences and skips headings, frontmatter, code and JSX syntax", async () => {
  const text = [
    "---\ntitle: Hi. There.\n---",
    "# Heading words here",
    "😀 Dr. Smith paid $3.50 for it. Was it worth it? Yes!\nIt wraps\nacross lines",
    "- One item. Second.\n  Continued here.\n- Next item",
    "```\nCode. Here.\n```",
    '<Note label="Hidden. Text.">Child prose stays.</Note>',
    "E.g. this works, i.e. fine. The end",
  ].join("\n\n");
  expect((await lint(text)).sentences).toEqual(
    expected(text, [
      ["😀 Dr. Smith paid $3.50 for it.", 6],
      ["Was it worth it?", 4],
      ["Yes!", 1],
      ["It wraps\nacross lines", 4, "It wraps across lines"],
      ["One item.", 2],
      ["Second.", 1],
      ["Continued here.", 2],
      ["Next item", 2],
      ["Child prose stays.", 3],
      ["E.g. this works, i.e. fine.", 7],
      ["The end", 2],
    ]),
  );
});
it("keeps abbreviations, initials, decimals and versions inside one sentence", async () => {
  const text =
    "Mr. Lee and Dr. Ng met at 9.30 a.m. on Friday. U.S. policy changed. J. R. R. Tolkien wrote it. Version 2.0 shipped. It ended... Then more. Really?! Yes. He said “stop.” Then left.";
  expect((await lint(text)).sentences.map((s) => [s.text, s.words])).toEqual([
    ["Mr. Lee and Dr. Ng met at 9.30 a.m. on Friday.", 12],
    ["U.S. policy changed.", 4],
    ["J. R. R. Tolkien wrote it.", 6],
    ["Version 2.0 shipped.", 3],
    ["It ended...", 2],
    ["Then more.", 2],
    ["Really?!", 1],
    ["Yes.", 1],
    ["He said “stop.”", 3],
    ["Then left.", 2],
  ]);
});
it("drops word-less segments, counts emoji-adjacent words and keeps UTF-16 offsets", async () => {
  const text = "🙂🙂. Real words here 👍🏽. Café naïve 日本語 it’s well-known.";
  expect((await lint(text)).sentences).toEqual(
    expected(text, [
      ["Real words here 👍🏽.", 3],
      ["Café naïve 日本語 it’s well-known.", 5],
    ]),
  );
});
it("separates adjacent list items and ends sentences at paragraph and item ends", async () => {
  const text = "- First item without stop\n- Second item\n* Third\n1. Fourth item\n\nAfter list";
  expect((await lint(text)).sentences.map((s) => s.text)).toEqual([
    "First item without stop",
    "Second item",
    "Third",
    "Fourth item",
    "After list",
  ]);
});
it("returns empty measurements for empty prose", async () => {
  for (const text of [
    "",
    "---\ntitle: x\n---\n",
    "```\ncode\n```",
    "<Chart />",
    "# Only a heading",
  ])
    expect((await lint(text)).sentences).toEqual([]);
});
it("rebases cached sentences and keeps measuring when sentence rules are disabled", async () => {
  const engine = createLinter();
  const body = "😀 First one here. Second.\n\nThird paragraph now.";
  const first = await lint(body, engine);
  const shifted = await lint("New opening line.\n\n" + body, engine);
  expect(shifted.changedParagraphs).toBe(1);
  expect(shifted.sentences.slice(1)).toEqual(
    first.sentences.map((s) => ({ ...s, from: s.from + 19, to: s.to + 19 })),
  );
  const off = await engine.lint({
    base: "off",
    text: body,
    settings: {
      ...quiet,
      rules: { ...quiet.rules, "sentence.length": false, rhythm: false, "paragraph.length": false },
    },
  });
  expect(off.sentences).toEqual(first.sentences);
  expect(off.base).toBe("off");
});
