import { expect, it } from "vite-plus/test";
import { createLinter } from "../src/index.ts";
import { settings } from "./settings.ts";
it("positions prose/style and schema diagnostics without linting syntax", async () => {
  const engine = createLinter();
  const text =
    "---\ntitle: quickly utilize\n---\n\n😀 This is an test. It was written quickly to utilize **tools**.\n\n" +
    Array(27).fill("word").join(" ") +
    ".\n\n- One item. Two items. Three items." +
    '\n\n```js\nquickly utilize\n```\n\n<Chart value={"quickly"} />\n\n[Link](https://quickly.utilize.test) and `quickly`.';
  const result = await engine.lint({
    base: "one",
    text,
    settings,
    blocks: [
      {
        from: text.indexOf("<Chart"),
        to: text.indexOf("/>") + 2,
        props: { value: 0 },
        schema: { type: "object", properties: { value: { type: "integer", minimum: 1 } } },
      },
    ],
  });
  for (const [code, quote] of [
    ["harper:Miscellaneous", "an"],
    ["style:passive", "was written"],
    ["style:adverb", "quickly"],
    ["style:simpler", "utilize"],
    ["bold.inline", "tools"],
    ["sentence.length", Array(27).fill("word").join(" ") + "."],
    ["bullets.long", "- One item. Two items. Three items."],
    ["block:props", '<Chart value={"quickly"} />'],
  ]) {
    const from = text.indexOf(quote, text.indexOf("😀"));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code,
        from,
        to: from + quote.length,
        severity: code === "block:props" ? "error" : "warn",
      }),
    );
  }
  expect(result.diagnostics.filter((d) => d.code === "style:adverb")).toHaveLength(1);
  expect(result.base).toBe("one");
}, 30000);
it("reuses unchanged paragraphs and shifts positions after insertions", async () => {
  const e = createLinter();
  await e.lint({ base: "a", text: "This is an test.\n\nIt was written quickly.", settings });
  const r = await e.lint({
    base: "b",
    text: "Hello there.\n\nThis is an test.\n\nIt was written quickly.",
    settings,
  });
  expect(r.changedParagraphs).toBe(1);
  expect(r.diagnostics).toContainEqual(expect.objectContaining({ from: 22, to: 24 }));
});
