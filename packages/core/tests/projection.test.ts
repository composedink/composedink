import { expect, it } from "vite-plus/test";
import { createPost, replaceText } from "../src/model/text.ts";
import { ghost } from "../src/model/marks.ts";
import { head, read } from "../src/model/read.ts";
import { projection } from "../src/model/projection.ts";
import { apply } from "../src/model/apply.ts";
it("maps each visible UTF-16 unit and edge against an independent source array", () => {
  const d = createPost("p");
  replaceText(d, "a😀HIDEbSECRETc");
  ghost(d, { base: head(d), view: "full", from: 3, to: 7 }, true);
  ghost(d, { base: head(d), view: "full", from: 8, to: 14 }, true);
  const p = projection(d, "clean");
  expect(p.text).toBe("a😀bc");
  expect(read(d, "clean").view).toBe("clean");
  const source = [0, 1, 2, 7, 14];
  for (let i = 0; i < source.length; i++)
    expect(p.ranges(i, i + 1)).toEqual([{ from: source[i], to: source[i] + 1 }]);
  expect(p.offset(3)).toBe(3);
  expect(p.offset(4)).toBe(8);
  apply(d, { base: head(d), view: "clean", text: "a😀Xbc", mode: "direct", by: { kind: "human" } });
  expect(d.getText("mdx").toString()).toBe("a😀XHIDEbSECRETc");
});
it("merges stale clean edits with concurrent hidden text changes and marks", () => {
  const d = createPost("p");
  replaceText(d, "Hello HIDDEN world.");
  ghost(d, { base: head(d), view: "full", from: 6, to: 12 }, true);
  const base = head(d);
  const t = d.getText("mdx");
  t.insert(9, "X");
  d.commit();
  apply(d, { base, view: "clean", text: "Hi  world!", mode: "direct", by: { kind: "human" } });
  expect(projection(d, "clean").text).toBe("Hi  world!");
  expect(d.getText("mdx").toString()).toBe("Hi HIDXDEN world!");
});
import { propose, flip } from "../src/model/alternatives.ts";
it("clean proposals and emoji replacements retain hidden snippets and complete code points on flip", () => {
  const d = createPost("p");
  replaceText(d, "First HIDDEN sentence.");
  ghost(d, { base: head(d), view: "full", from: 6, to: 12 }, true);
  apply(d, {
    base: head(d),
    view: "clean",
    text: "Changed  sentence.",
    mode: "propose",
    by: { kind: "agent", name: "test" },
  });
  const a = read(d).alts[0];
  flip(d, a.id, 1);
  expect(projection(d, "clean").text).toBe("Changed  sentence.");
  expect(d.getText("mdx").toString()).toBe("Changed HIDDEN sentence.");
  const p = createPost("emoji");
  replaceText(p, "First sentence.");
  const id = propose(p, { base: head(p), view: "full", from: 0, to: 15 }, ["😀 sentence."], {
    kind: "human",
  }).alt!;
  flip(p, id, 1);
  expect(p.getText("mdx").toString()).toBe("😀 sentence.");
});
