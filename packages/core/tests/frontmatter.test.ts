import { expect, it } from "vite-plus/test";
import {
  frontmatterBlock,
  frontmatterProblem,
  frontmatterValues,
  setFrontmatterField,
} from "../src/index.ts";
const apply = (text: string, c: { from: number; to: number; insert: string }) =>
  text.slice(0, c.from) + c.insert + text.slice(c.to);
const post = "---\ntitle: Hello\nbudget: 1200\nmedium: web\n---\n\nBody.";
it("reads a block, its values and nothing from a malformed or unclosed one", () => {
  expect(frontmatterBlock(post)).toMatchObject({ yamlFrom: 4, to: post.indexOf("\nBody") });
  expect(frontmatterValues(post)).toEqual({ title: "Hello", budget: 1200, medium: "web" });
  expect(frontmatterValues("---\ntitle: [x\n---\n")).toEqual({});
  expect(frontmatterBlock("---\ntitle: open\n\nBody.")).toBeUndefined();
});
it("names the line and reason of a malformed block, and of one never closed", () => {
  expect(frontmatterProblem(post)).toBeUndefined();
  expect(frontmatterProblem("No block.")).toBeUndefined();
  const broken = "---\ntitle: Hi\nmedium: web# Why: I ship\n---\n\nBody.";
  expect(frontmatterProblem(broken)).toEqual({ line: 3, message: expect.any(String) });
  expect(frontmatterProblem(broken)!.message).not.toContain("\n");
  expect(frontmatterProblem("---\ntitle: open\n\nBody.")).toEqual({
    line: 1,
    message: "the block opened here is never closed with a --- line",
  });
  expect(frontmatterProblem("---\n- a\n- b\n---\n")).toMatchObject({ line: 2 });
});
it("sets, appends, removes and creates keys as YAML lines", () => {
  expect(apply(post, setFrontmatterField(post, "budget", 1500))).toBe(
    post.replace("budget: 1200", "budget: 1500"),
  );
  expect(apply(post, setFrontmatterField(post, "reader", "new engineers"))).toBe(
    post.replace("medium: web\n", "medium: web\nreader: new engineers\n"),
  );
  expect(apply(post, setFrontmatterField(post, "title", "Why: I ship"))).toContain(
    'title: "Why: I ship"\n',
  );
  expect(apply(post, setFrontmatterField(post, "medium", undefined))).not.toContain("medium");
  expect(apply("Body.", setFrontmatterField("Body.", "title", "T"))).toBe(
    "---\ntitle: T\n---\n\nBody.",
  );
  expect(apply("---\n---\n\nB", setFrontmatterField("---\n---\n\nB", "budget", 5))).toBe(
    "---\nbudget: 5\n---\n\nB",
  );
});
