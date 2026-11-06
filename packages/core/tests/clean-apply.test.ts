import { propose, flip } from "../src/model/alternatives.ts";
import { expect, it } from "vite-plus/test";
import { createPost, replaceText } from "../src/model/text.ts";
import { apply } from "../src/model/apply.ts";
import { head } from "../src/model/read.ts";
import { projection, project } from "../src/model/projection.ts";
import { snippet } from "../src/model/stash.ts";
it("seeded clean edits preserve hidden UTF-16 substrings and marks against an independent character oracle", () => {
  let seed = 505;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 150; trial++) {
    const d = createPost("p");
    d.configTextStyle({ dim: { expand: "none" } });
    const tokens = ["a", "b", "😀", "\n", "Z"];
    const chars: { text: string; hidden: boolean }[] = Array.from({ length: 20 }, () => ({
      text: tokens[random(tokens.length)],
      hidden: random(3) === 0,
    }));
    const source = chars.map((c) => c.text).join("");
    replaceText(d, source);
    let pos = 0;
    for (const c of chars) {
      if (c.hidden) container(d).mark({ start: pos, end: pos + c.text.length }, "dim", true);
      pos += c.text.length;
    }
    d.commit();
    const clean = chars
      .filter((c) => !c.hidden)
      .map((c) => c.text)
      .join("");
    expect(project(d, "clean").text).toBe(clean);
    const map = projection(d, "clean");
    const oracle: number[] = [];
    let sourceOffset = 0;
    for (const c of chars) {
      if (!c.hidden) for (let i = 0; i < c.text.length; i++) oracle.push(sourceOffset + i);
      sourceOffset += c.text.length;
    }
    for (let i = 0; i < oracle.length; i++)
      expect(map.ranges(i, i + 1)).toEqual([{ from: oracle[i], to: oracle[i] + 1 }]);
    const beforeFlip = snippet(d, 0, source.length);
    const id = propose(
      d,
      { base: head(d), view: "full", from: 0, to: source.length },
      ["Alternative."],
      { kind: "human" },
    ).alt!;
    flip(d, id, 1);
    flip(d, id, 0);
    expect(snippet(d, 0, d.getText("mdx").length)).toEqual(beforeFlip);
    let hidden = chars
      .filter((c) => c.hidden)
      .map((c) => c.text)
      .join("");
    const visible = chars.filter((c) => !c.hidden);
    const left = random(visible.length + 1),
      right = left + random(visible.length - left + 1);
    const edited =
      visible
        .slice(0, left)
        .map((c) => c.text)
        .join("") +
      "NEW" +
      visible
        .slice(right)
        .map((c) => c.text)
        .join("");
    const base = head(d);
    const concurrent = container(d),
      end = concurrent.length;
    concurrent.insert(end, "Ω");
    concurrent.mark({ start: end, end: end + 1 }, "dim", true);
    d.commit();
    hidden += "Ω";
    apply(d, { base, view: "clean", text: edited, mode: "direct", by: { kind: "human" } });
    expect(project(d, "clean").text).toBe(edited);
    const s = snippet(d, 0, d.getText("mdx").length);
    expect(s.dim.map(([f, t]) => s.text.slice(f, t)).join("")).toBe(hidden);
    if (trial % 10 === 0) {
      apply(d, { base: head(d), view: "clean", text: "", mode: "direct", by: { kind: "human" } });
      expect(d.getText("mdx").toString()).toBe(hidden);
    }
  }
});

function container(d: import("loro-crdt").LoroDoc) {
  return d.getText("mdx");
}
