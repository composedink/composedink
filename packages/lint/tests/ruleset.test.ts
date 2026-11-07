import { expect, it } from "vite-plus/test";
import {
  createLinter,
  DEFAULT_RULES,
  enabled,
  mergeRulesets,
  parseRuleset,
  RULE_CODES,
  type Ruleset,
  type RuleSetting,
} from "../src/index.ts";
import { settings } from "./settings.ts";
const rule = (over: Record<string, unknown>) => ({
  code: "jargon",
  message: "Jargon.",
  severity: "warn",
  phrases: ["synergy"],
  ...over,
});
it("validates rules.json and keeps code execution out of configuration", () => {
  expect(parseRuleset(DEFAULT_RULES)).toEqual(DEFAULT_RULES);
  expect(Object.keys(DEFAULT_RULES.rules)).toEqual([...RULE_CODES]);
  for (const [value, message] of [
    [{ extends: null, rules: {}, custom: [], plugin: "x.js" }, /unknown ruleset key "plugin"/],
    [{ extends: 3, rules: {}, custom: [] }, /extends/],
    [{ extends: null, rules: { harper: true }, custom: [] }, /false or an options object/],
    [{ extends: null, rules: {}, custom: [rule({ regex: "(" })] }, /exactly one of phrases/],
    [
      { extends: null, rules: {}, custom: [rule({ phrases: undefined, regex: "(" })] },
      /regex is invalid/,
    ],
    [{ extends: null, rules: {}, custom: [rule({ code: "filler" })] }, /collides with a built-in/],
    [
      { extends: null, rules: {}, custom: [rule({ code: "harper:Spelling" })] },
      /collides with a built-in/,
    ],
    [{ extends: null, rules: {}, custom: [rule({ code: "style:x" })] }, /collides/],
    [{ extends: null, rules: {}, custom: [rule({}), rule({})] }, /defined twice/],
    [{ extends: null, rules: {}, custom: [rule({ severity: "info" })] }, /severity/],
    [{ extends: null, rules: {}, custom: [rule({ run: "fn" })] }, /unknown key "run"/],
  ] as const)
    expect(() => parseRuleset(value)).toThrow(message);
});
it("merges multi-level chains per code, replacing options and custom rules by code", () => {
  const post = DEFAULT_RULES;
  const team: Ruleset = {
    extends: "post",
    rules: { "sentence.length": false, "paragraph.length": { max: 4, extra: true } },
    custom: [rule({}) as never, rule({ code: "hedge", phrases: ["sort of"] }) as never],
  };
  const mine: Ruleset = {
    extends: "team",
    rules: { "sentence.length": {}, "paragraph.length": { max: 2 }, hedge: false },
    custom: [rule({ phrases: ["leverage"], severity: "soft" }) as never],
  };
  const effective = mergeRulesets([post, team, mine]);
  expect(effective).not.toHaveProperty("extends");
  expect(effective.rules["sentence.length"]).toEqual({});
  expect(effective.rules["paragraph.length"]).toEqual({ max: 2 });
  expect(effective.rules.hedge).toBe(false);
  expect(effective.custom).toEqual([
    rule({ phrases: ["leverage"], severity: "soft" }),
    rule({ code: "hedge", phrases: ["sort of"] }),
  ]);
  expect(enabled(effective.rules, "sentence.length")).toBe(true);
  expect(enabled(effective.rules, "hedge")).toBe(false);
  expect(enabled({}, "sentence.length")).toBe(false);
  expect(enabled({}, "style:adverb")).toBe(true);
  expect(() =>
    mergeRulesets([post, { extends: "post", rules: { "sentance.length": false }, custom: [] }]),
  ).toThrow(/unknown rule code "sentance.length"/);
});
it("switches Harper lint kinds individually and globally on a real Harper fixture", async () => {
  const text = "This is an test.";
  const codes = async (rules: Record<string, RuleSetting>) =>
    (
      await createLinter().lint({
        base: "h",
        text,
        settings: { ...settings, rules: { ...settings.rules, ...rules } },
      })
    ).diagnostics.map((d) => d.code);
  expect(await codes({})).toContain("harper:Miscellaneous");
  expect(await codes({ "harper:Miscellaneous": false })).not.toContain("harper:Miscellaneous");
  expect((await codes({ harper: false })).filter((c) => c.startsWith("harper:"))).toEqual([]);
}, 30000);
it("re-lints unchanged paragraphs when only configuration changes", async () => {
  const engine = createLinter();
  const text = "It was written quickly.";
  const first = await engine.lint({ base: "same", text, settings });
  expect(first.diagnostics.map((d) => d.code)).toContain("style:adverb");
  const cached = await engine.lint({ base: "same", text, settings });
  expect(cached.changedParagraphs).toBe(0);
  const quiet = { ...settings, rules: { ...settings.rules, "style:adverb": false as const } };
  const second = await engine.lint({ base: "same", text, settings: quiet });
  expect(second.changedParagraphs).toBe(1);
  expect(second.config).not.toBe(first.config);
  expect(second.diagnostics.map((d) => d.code)).not.toContain("style:adverb");
}, 30000);
