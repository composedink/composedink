import { expect, it } from "vite-plus/test";
import type { Diagnostic } from "@composedink/lint";
import { underlines } from "../src/editor/diagnostics.ts";
import { groupDiagnostics, ruleLabel } from "../src/FeedbackList.tsx";
const d = (code: string, from: number, to: number, severity: Diagnostic["severity"] = "warn") => ({
  code,
  from,
  to,
  severity,
  message: `${code} at ${from}`,
});
it("draws one underline per range in the stronger severity, keeping every code and message", () => {
  const drawn = underlines(
    [
      d("filler", 4, 8),
      d("bold.inline", 4, 8),
      d("block:props", 10, 12, "error"),
      d("x", 10, 12),
      d("rhythm", 0, 20, "soft"),
    ],
    30,
  );
  expect(drawn).toEqual([
    {
      from: 4,
      to: 8,
      severity: "warn",
      codes: ["filler", "bold.inline"],
      messages: ["filler at 4", "bold.inline at 4"],
    },
    {
      from: 10,
      to: 12,
      severity: "error",
      codes: ["block:props", "x"],
      messages: ["block:props at 10", "x at 10"],
    },
  ]);
});
it("groups by rule with counts, strongest severity first, and names rules in plain words", () => {
  const groups = groupDiagnostics([
    d("filler", 30, 34),
    d("sentence.length", 5, 20),
    d("filler", 2, 6),
    d("block:props", 40, 50, "error"),
    d("rhythm", 0, 60, "soft"),
  ]);
  expect(groups.map((g) => [g.code, g.items.length])).toEqual([
    ["block:props", 1],
    ["filler", 2],
    ["sentence.length", 1],
    ["rhythm", 1],
  ]);
  expect(ruleLabel("filler")).toBe("Hedges and intensifiers");
  expect(ruleLabel("harper:Spelling")).toBe("Spelling");
  expect(ruleLabel("harper:WordChoice")).toBe("Word choice");
  expect(ruleLabel("jargon", d("jargon", 0, 1))).toBe("jargon at 0");
});
