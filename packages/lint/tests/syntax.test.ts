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
    expect((await e.lint({ base: text, text, settings })).diagnostics).toEqual([]);
  }
  const text = "<Thing x={2}>It was written quickly.</Thing>";
  expect((await e.lint({ base: "child", text, settings })).diagnostics).toContainEqual(
    expect.objectContaining({ code: "style:adverb", from: 28, to: 35 }),
  );
});
