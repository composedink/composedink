import { describe, expect, it } from "vite-plus/test";
import { createLinter, RULE_CODES, type Diagnostic, type RuleSetting } from "../src/index.ts";
import { settings } from "./settings.ts";
import { extras, fixtures, hiding, type Case, type Expected } from "./fixtures/measurements.ts";
const engine = createLinter();
const matches = (code: string, d: Diagnostic) =>
  code === "harper" ? d.code.startsWith("harper:") : d.code === code;
async function lint(code: string, c: Case, override: Record<string, RuleSetting> = {}) {
  const result = await engine.lint({
    base: "m",
    text: c.text,
    settings: {
      ...settings,
      ...c.settings,
      rules: {
        ...settings.rules,
        ...(code === "harper" ? {} : { harper: false }),
        ...(c.options ? { [code]: c.options } : {}),
        ...override,
      },
    },
  });
  return { ...result, diagnostics: result.diagnostics.filter((d) => matches(code, d)) };
}
const severity = (code: string) => (code === "budget" || code === "rhythm" ? "soft" : "warn");
function expectFound(code: string, found: Diagnostic[], expected: readonly Expected[]) {
  expect(found.map((d) => ({ from: d.from, to: d.to }))).toEqual(
    expected.map(({ from, to }) => ({ from, to })),
  );
  expected.forEach((e, i) => {
    expect(found[i].severity).toBe(severity(code));
    if (e.code) expect(found[i].code).toBe(e.code);
    if (e.message) expect(found[i].message).toMatch(e.message);
  });
}
it("every registered rule has a positive and a negative fixture", () => {
  expect(fixtures.map((f) => f.code).sort()).toEqual([...RULE_CODES].sort());
  for (const f of fixtures) {
    expect(f.positive.expected.length, f.code).toBeGreaterThan(0);
    expect(f.negative.text, f.code).not.toBe("");
  }
});
describe.each(fixtures)("$code", ({ code, positive, negative }) => {
  it("reports the positive fixture with exact ranges, severity and message", async () => {
    expectFound(code, (await lint(code, positive)).diagnostics, positive.expected);
  }, 30000);
  it("is silent on the negative fixture", async () => {
    expect((await lint(code, negative)).diagnostics).toEqual([]);
  }, 30000);
  it("is silent when disabled", async () => {
    expect((await lint(code, positive, { [code]: false })).diagnostics).toEqual([]);
  }, 30000);
  it.each(hiding)(
    "is silent and draws no sentences inside $name",
    async ({ wrap }) => {
      const hidden = await lint(code, { ...positive, text: wrap(positive.text) });
      expect(hidden.diagnostics).toEqual([]);
      expect(hidden.sentences).toEqual([]);
    },
    30000,
  );
});
describe.each(extras)("$code: $name", (c) => {
  it("reports exactly the expected ranges", async () => {
    expectFound(c.code, (await lint(c.code, c)).diagnostics, c.expected);
  }, 30000);
});
