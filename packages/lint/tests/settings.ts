import { DEFAULT_RULES, type LintSettings } from "../src/index.ts";
/** The built-in post ruleset with post reading values, as core resolves it for a new post. */
export const settings: LintSettings = {
  rules: DEFAULT_RULES.rules,
  custom: DEFAULT_RULES.custom,
  reader: "blog readers",
  medium: "web",
  budget: 1200,
};
