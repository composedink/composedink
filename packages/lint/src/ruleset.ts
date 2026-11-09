import type { Diagnostic } from "./index.ts";
import type { Paragraph } from "./prose.ts";
export type Severity = "error" | "warn" | "soft";
export type Medium = "phone" | "screen" | "web";
/** Public rule codes; each maps to one writing technique. */
export const RULE_CODES = [
  "paragraph.length",
  "budget",
  "preamble",
  "filler",
  "sentence.length",
  "harper",
  "bullets.long",
  "bold.inline",
  "visuals",
  "rhythm",
] as const;
/** Pre-ruleset style checks, individually switchable and on unless set to false. */
export const LEGACY_CODES = ["style:passive", "style:adverb", "style:simpler"] as const;
export type RuleSetting = false | Readonly<Record<string, unknown>>;
type CustomBase = {
  readonly code: string;
  readonly message: string;
  readonly severity: Severity;
  readonly replacement?: string;
};
export type CustomRule = CustomBase &
  ({ readonly phrases: readonly string[] } | { readonly regex: string });
export interface Ruleset {
  readonly extends: string | null;
  readonly rules: Readonly<Record<string, RuleSetting>>;
  readonly custom: readonly CustomRule[];
}
export interface EffectiveRules {
  readonly rules: Readonly<Record<string, RuleSetting>>;
  readonly custom: readonly CustomRule[];
}
/** Everything a lint pass reads besides the text: the document's effective rules and reader. */
export interface LintSettings extends EffectiveRules {
  readonly reader: string;
  readonly medium: Medium;
  readonly budget: number;
}
export type RuleCode = (typeof RULE_CODES)[number];
/** Each public rule's option object with its defaults; an author's object overrides by key. */
export const RULE_DEFAULTS = {
  "paragraph.length": { limits: { phone: 3, screen: 5, web: 6 } },
  budget: {},
  preamble: { phrases: ["sorry to bother you", "just wanted to ask", "I was wondering if"] },
  filler: {
    phrases: [
      "very",
      "really",
      "quite",
      "just",
      "basically",
      "actually",
      "perhaps",
      "maybe",
      "sort of",
      "kind of",
      "a bit",
      "I think",
      "I guess",
      "in my opinion",
    ],
  },
  "sentence.length": { maxWords: 25 },
  harper: {},
  "bullets.long": { maxSentences: 2 },
  "bold.inline": {},
  visuals: { maxWords: 400 },
  rhythm: { minSentences: 4, toleranceWords: 3 },
} as const satisfies Record<RuleCode, Record<string, unknown>>;
export type RuleOptions<C extends RuleCode> = {
  -readonly [
    K in keyof (typeof RULE_DEFAULTS)[C]
  ]: (typeof RULE_DEFAULTS)[C][K] extends readonly string[]
    ? readonly string[]
    : (typeof RULE_DEFAULTS)[C][K] extends number
      ? number
      : { [M in Medium]: number };
};
/** The built-in post ruleset: every public code on with its default options, no custom rules. */
export const DEFAULT_RULES: Ruleset = { extends: null, rules: RULE_DEFAULTS, custom: [] };
const count = (v: unknown, min = 1) => typeof v === "number" && Number.isInteger(v) && v >= min;
/** Checks one public rule's options object; throws naming the rule and option. */
function checkOptions(code: RuleCode, options: Readonly<Record<string, unknown>>) {
  const defaults: Readonly<Record<string, unknown>> = RULE_DEFAULTS[code];
  for (const [key, value] of Object.entries(options)) {
    const at = `rule "${code}" option "${key}"`;
    const fallback = defaults[key];
    if (fallback === undefined) throw Error(`rule "${code}" has no option "${key}"`);
    if (Array.isArray(fallback)) {
      if (!Array.isArray(value) || value.some((p) => typeof p !== "string" || !p.trim()))
        throw Error(`${at} must be a list of non-empty phrases`);
    } else if (typeof fallback === "number") {
      if (!count(value, key === "toleranceWords" ? 0 : 1))
        throw Error(
          `${at} must be a ${key === "toleranceWords" ? "whole" : "positive whole"} number`,
        );
    } else {
      if (!plain(value)) throw Error(`${at} must be an object of phone, screen and web limits`);
      for (const [medium, limit] of Object.entries(value))
        if (!["phone", "screen", "web"].includes(medium) || !count(limit))
          throw Error(
            `${at}: "${medium}" must be phone, screen or web with a positive whole limit`,
          );
    }
  }
}
/** A public rule's options merged over its defaults (limits merge per medium). */
export function ruleOptions<C extends RuleCode>(
  rules: EffectiveRules["rules"],
  code: C,
): RuleOptions<C> {
  const set = rules[code];
  const own: Record<string, unknown> = plain(set) ? set : {};
  const defaults: Record<string, unknown> = RULE_DEFAULTS[code];
  const merged: Record<string, unknown> = { ...defaults, ...own };
  if (plain(defaults.limits) && plain(own.limits))
    merged.limits = { ...defaults.limits, ...own.limits };
  return merged as RuleOptions<C>;
}
const isRuleCode = (code: string): code is RuleCode =>
  (RULE_CODES as readonly string[]).includes(code);
const CODE = /^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$/;
const HARPER = /^harper:[A-Za-z]+$/;
const builtin = (code: string) =>
  (RULE_CODES as readonly string[]).includes(code) ||
  (LEGACY_CODES as readonly string[]).includes(code) ||
  HARPER.test(code);
const reserved = (code: string) =>
  builtin(code) || /^(harper|style|block):/.test(code) || code === "harper";
const isSeverity = (v: unknown): v is Severity => v === "error" || v === "warn" || v === "soft";
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Validates one rules.json value. Throws an Error naming the offending field. */
export function parseRuleset(value: unknown): Ruleset {
  if (!plain(value)) throw Error("ruleset must be an object");
  for (const key of Object.keys(value))
    if (!["extends", "rules", "custom"].includes(key)) throw Error(`unknown ruleset key "${key}"`);
  const parent = value.extends;
  if (parent !== null && typeof parent !== "string")
    throw Error('"extends" must be a kind id or null');
  if (!plain(value.rules)) throw Error('"rules" must be an object');
  const rules: Record<string, RuleSetting> = {};
  for (const [code, setting] of Object.entries(value.rules)) {
    if (!CODE.test(code) && !HARPER.test(code)) throw Error(`invalid rule code "${code}"`);
    if (setting !== false && !plain(setting))
      throw Error(`rule "${code}" must be false or an options object`);
    if (setting !== false && isRuleCode(code)) checkOptions(code, setting);
    rules[code] = setting;
  }
  if (!Array.isArray(value.custom)) throw Error('"custom" must be an array');
  const seen = new Set<string>();
  const custom = value.custom.map((rule, i): CustomRule => {
    const at = `custom[${i}]`;
    if (!plain(rule)) throw Error(`${at} must be an object`);
    for (const key of Object.keys(rule))
      if (!["code", "message", "severity", "replacement", "phrases", "regex"].includes(key))
        throw Error(`${at}: unknown key "${key}"`);
    const { code, message, severity, replacement, phrases, regex } = rule;
    if (typeof code !== "string") throw Error(`${at}.code is required`);
    if (reserved(code)) throw Error(`${at}.code "${code}" collides with a built-in code`);
    if (!CODE.test(code)) throw Error(`${at}.code must be a lowercase code`);
    if (seen.has(code)) throw Error(`${at}.code "${code}" is defined twice`);
    seen.add(code);
    if (typeof message !== "string" || !message.trim()) throw Error(`${at}.message is required`);
    if (!isSeverity(severity)) throw Error(`${at}.severity must be error, warn or soft`);
    if (replacement !== undefined && typeof replacement !== "string")
      throw Error(`${at}.replacement must be a string`);
    const base = { code, message, severity, ...(replacement === undefined ? {} : { replacement }) };
    if ((phrases === undefined) === (regex === undefined))
      throw Error(`${at} needs exactly one of phrases or regex`);
    if (phrases !== undefined) {
      if (
        !Array.isArray(phrases) ||
        !phrases.length ||
        phrases.some((p) => typeof p !== "string" || !p.trim())
      )
        throw Error(`${at}.phrases must be non-empty strings`);
      return { ...base, phrases: phrases as string[] };
    }
    if (typeof regex !== "string" || !regex) throw Error(`${at}.regex must be a string`);
    try {
      new RegExp(regex, "gu");
    } catch (error) {
      throw Error(
        `${at}.regex is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { ...base, regex };
  });
  return { extends: parent, rules, custom };
}
/**
 * Merges a resolved chain, root first: rule codes override per code (an options object replaces
 * the inherited one), custom rules replace by code. The result has no extends.
 */
export function mergeRulesets(chain: readonly Ruleset[]): EffectiveRules {
  const rules: Record<string, RuleSetting> = {};
  const custom = new Map<string, CustomRule>();
  for (const ruleset of chain) {
    Object.assign(rules, ruleset.rules);
    for (const rule of ruleset.custom) custom.set(rule.code, rule);
  }
  for (const code of Object.keys(rules))
    if (!builtin(code) && !custom.has(code))
      throw Error(`unknown rule code "${code}": not built-in, Harper or custom`);
  return { rules, custom: [...custom.values()] };
}
/** Whether a diagnostic code is switched on by the effective rules. */
export function enabled(rules: EffectiveRules["rules"], code: string) {
  if (code === "block:props") return true;
  if (code.startsWith("harper:")) return plain(rules.harper) && rules[code] !== false;
  if ((RULE_CODES as readonly string[]).includes(code)) return plain(rules[code]);
  return rules[code] !== false;
}
export function severity(code: string): Severity {
  if (code === "block:props") return "error";
  if (code === "budget" || code === "rhythm") return "soft";
  return "warn";
}
/** A stable identity for a settings value; changes whenever any rule, option or reader does. */
export const configIdentity = (settings: LintSettings) => JSON.stringify(settings);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Literal phrases as one case-insensitive whole-word pattern. */
export const phrasePattern = (phrases: readonly string[], flags = "giu") =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${phrases.map((p) => escape(p.trim())).join("|")})(?![\\p{L}\\p{N}_])`,
    flags,
  );
/**
 * Pattern rules on one masked paragraph, offsets relative to the paragraph. Phrases are literal,
 * case-insensitive whole-word matches; regexes run with Unicode/global flags and skip empty
 * matches. A match touching masked syntax is skipped.
 */
export function customDiagnostics(p: Paragraph, rules: EffectiveRules): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const rule of rules.custom) {
    if (rules.rules[rule.code] === false) continue;
    const pattern = "phrases" in rule ? phrasePattern(rule.phrases) : new RegExp(rule.regex, "gu");
    for (const m of p.prose.matchAll(pattern)) {
      if (!m[0]) continue;
      const to = m.index + m[0].length;
      if (p.source.slice(m.index, to) !== m[0]) continue;
      result.push({
        from: m.index,
        to,
        code: rule.code,
        severity: rule.severity,
        message: rule.message,
        ...(rule.replacement === undefined ? {} : { replacement: rule.replacement }),
      });
    }
  }
  return result;
}
