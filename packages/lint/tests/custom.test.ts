import { expect, it } from "vite-plus/test";
import { createLinter, type CustomRule, type RuleSetting } from "../src/index.ts";
import { settings } from "./settings.ts";
async function run(text: string, custom: CustomRule[], rules: Record<string, RuleSetting> = {}) {
  const result = await createLinter().lint({
    base: "c",
    text,
    settings: { ...settings, rules: { ...settings.rules, harper: false, ...rules }, custom },
  });
  return result.diagnostics.filter((d) => custom.some((r) => r.code === d.code));
}
const phrase: CustomRule = {
  code: "jargon",
  message: "Say what you mean.",
  severity: "warn",
  phrases: ["synergy", "circle back"],
  replacement: "work together",
};
it("matches phrases literally, case-insensitively and as whole words with UTF-16 ranges", async () => {
  const text = "😀 Synergy wins. We circle back. Synergyish and (synergy).";
  const found = await run(text, [phrase]);
  const at = (quote: string, from = 0) => text.indexOf(quote, from);
  expect(found).toEqual([
    {
      from: at("Synergy"),
      to: at("Synergy") + 7,
      code: "jargon",
      severity: "warn",
      message: "Say what you mean.",
      replacement: "work together",
    },
    expect.objectContaining({ from: at("circle back"), to: at("circle back") + 11 }),
    expect.objectContaining({ from: at("synergy"), to: at("synergy") + 7 }),
  ]);
  expect(found[0].from).toBe(3);
  expect(await run("No jargon here: synergistic.", [phrase])).toEqual([]);
  expect(await run("a.b synergy", [{ ...phrase, phrases: ["a.b"] }])).toHaveLength(1);
  expect(await run("axb synergy", [{ ...phrase, phrases: ["a.b"] }])).toHaveLength(0);
});
it("never matches inside masked syntax", async () => {
  const text = [
    "---\ntitle: synergy\n---",
    "`synergy` and [link](https://synergy.test)",
    '<Chart label="synergy" />',
    "```\nsynergy\n```",
    "Visible synergy.",
  ].join("\n\n");
  const found = await run(text, [phrase]);
  expect(found).toHaveLength(1);
  expect(text.slice(found[0].from, found[0].to)).toBe("synergy");
  expect(found[0].from).toBe(text.lastIndexOf("synergy"));
});
it("runs Unicode regexes, skips empty matches and applies severity and disables", async () => {
  const regex: CustomRule = {
    code: "ellipsis",
    message: "Avoid trailing off.",
    severity: "soft",
    regex: "\\p{L}+…|x*",
  };
  const text = "🙂 Well… then";
  const found = await run(text, [regex]);
  expect(found).toEqual([
    {
      from: text.indexOf("Well"),
      to: text.indexOf("…") + 1,
      code: "ellipsis",
      severity: "soft",
      message: "Avoid trailing off.",
    },
  ]);
  expect(await run(text, [regex], { ellipsis: false })).toEqual([]);
  expect(await run("Synergy.", [phrase], { jargon: false })).toEqual([]);
});
