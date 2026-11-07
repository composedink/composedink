import { expect, it } from "vite-plus/test";
import {
  createLinter,
  DEFAULT_RULES,
  enabled,
  mergeRulesets,
  parseRuleset,
  RULE_CODES,
  RULE_DEFAULTS,
  ruleOptions,
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
it("validates every public rule's option shape and merges options over the post defaults", () => {
  const ruleset = (rules: Record<string, unknown>) => ({ extends: null, rules, custom: [] });
  expect(DEFAULT_RULES.rules).toEqual(RULE_DEFAULTS);
  expect(RULE_DEFAULTS).toEqual({
    "paragraph.length": { limits: { phone: 3, screen: 5, web: 6 } },
    budget: {},
    preamble: { phrases: ["sorry to bother you", "just wanted to ask", "I was wondering if"] },
    filler: { phrases: ["very", "really", "perhaps", "sort of"] },
    "sentence.length": { maxWords: 25 },
    harper: {},
    "bullets.long": { maxSentences: 2 },
    "bold.inline": {},
    visuals: { maxWords: 400 },
    rhythm: { minSentences: 4, toleranceWords: 3 },
  });
  for (const code of RULE_CODES)
    expect(parseRuleset(ruleset({ [code]: {} })).rules[code]).toEqual({});
  const valid = {
    "paragraph.length": { limits: { phone: 2 } },
    preamble: { phrases: [] },
    filler: { phrases: ["kinda"] },
    "sentence.length": { maxWords: 30 },
    "bullets.long": { maxSentences: 1 },
    visuals: { maxWords: 200 },
    rhythm: { minSentences: 3, toleranceWords: 0 },
  };
  expect(parseRuleset(ruleset(valid)).rules).toEqual(valid);
  for (const [rules, message] of [
    [{ "paragraph.length": { max: 3 } }, /"paragraph.length" has no option "max"/],
    [{ "paragraph.length": { limits: { tablet: 3 } } }, /phone, screen or web/],
    [{ "paragraph.length": { limits: { web: 0 } } }, /positive whole limit/],
    [{ "paragraph.length": { limits: 3 } }, /object of phone, screen and web/],
    [{ filler: { phrases: "very" } }, /list of non-empty phrases/],
    [{ preamble: { phrases: [" "] } }, /list of non-empty phrases/],
    [{ "sentence.length": { maxWords: 2.5 } }, /positive whole number/],
    [{ visuals: { maxWords: 0 } }, /positive whole number/],
    [{ rhythm: { toleranceWords: -1 } }, /"toleranceWords" must be a whole number/],
    [{ budget: { words: 10 } }, /"budget" has no option "words"/],
    [{ harper: { strict: true } }, /"harper" has no option "strict"/],
  ] as const)
    expect(() => parseRuleset(ruleset(rules)), JSON.stringify(rules)).toThrow(message);
  expect(ruleOptions({ "paragraph.length": { limits: { web: 4 } } }, "paragraph.length")).toEqual({
    limits: { phone: 3, screen: 5, web: 4 },
  });
  expect(ruleOptions({ filler: { phrases: ["kinda"] } }, "filler")).toEqual({ phrases: ["kinda"] });
  expect(ruleOptions({ rhythm: { minSentences: 5 } }, "rhythm")).toEqual({
    minSentences: 5,
    toleranceWords: 3,
  });
  expect(ruleOptions({ rhythm: false }, "rhythm")).toEqual(RULE_DEFAULTS.rhythm);
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
