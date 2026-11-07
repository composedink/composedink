import { expect, it } from "vite-plus/test";
import { LatestLint } from "../src/editor/lint.ts";
import { DEFAULT_RULES } from "@composedink/lint";
const settings = { ...DEFAULT_RULES, reader: "r", medium: "web" as const, budget: 1 };
it("newest base and request are authoritative, including cancellation at the same base", () => {
  const gate = new LatestLint();
  const old = gate.request({ base: "a", text: "old", settings });
  const newest = gate.request({ base: "b", text: "new", settings });
  const reply = (id: number, base: string, config = "rules-1") => ({
    id,
    result: { base, config, diagnostics: [], changedParagraphs: 1, elapsedMs: 1 },
  });
  expect(gate.accept(reply(old.id, "a"), "b", "rules-1")).toBeUndefined();
  expect(gate.accept(reply(newest.id, "b"), "b", "rules-1")).toBeDefined();
  expect(gate.accept(reply(newest.id, "b"), "c", "rules-1")).toBeUndefined();
  // Same request and frontiers, older rules: a rules-only change must not show stale results.
  expect(gate.accept(reply(newest.id, "b", "rules-0"), "b", "rules-1")).toBeUndefined();
  gate.invalidate();
  expect(gate.accept(reply(newest.id, "b"), "b", "rules-1")).toBeUndefined();
});
