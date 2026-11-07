import { expect, it } from "vite-plus/test";
import { createLinter } from "../src/index.ts";
import { settings } from "./settings.ts";
it("ignores nested JSX expressions, links in code, unclosed fences and fallback content", async () => {
  const e = createLinter();
  for (const text of [
    "```js\n[quickly](url)\nutilize",
    "~~~~js\nquickly\n~~~~~",
    '<Thing x={{a: ">", b: {c: "quickly"}}} />',
    "`[quickly](url)`",
    "``quickly ` utilize``",
    "<!-- composed fallback -->\nquickly\n<!-- /composed -->",
  ]) {
    const result = await e.lint({ base: text, text, settings });
    expect(result.diagnostics).toEqual([]);
    expect(result.sentences).toEqual([]);
  }
  const text = "<Thing x={2}>It was written quickly.</Thing>";
  const child = await e.lint({ base: "child", text, settings });
  expect(child.diagnostics).toContainEqual(
    expect.objectContaining({ code: "style:adverb", from: 28, to: 35 }),
  );
  // Ordinary prose children of inline JSX are prose; the tag and its props never are.
  expect(child.sentences).toEqual([
    { from: 13, to: 36, text: "It was written quickly.", words: 4 },
  ]);
  const nested = '😀 <Outer a={<Inner b="Hidden. Words." />}>Kept <Em>words</Em> here.</Outer>';
  expect((await e.lint({ base: "nested", text: nested, settings })).sentences).toEqual([
    { from: 0, to: nested.indexOf("</Outer>"), text: "😀 Kept words here.", words: 3 },
  ]);
});
