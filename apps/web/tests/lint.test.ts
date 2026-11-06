import { expect, it } from "vite-plus/test";
import { LatestLint } from "../src/editor/lint.ts";
it("newest base and request are authoritative, including cancellation at the same base", () => {
  const gate = new LatestLint();
  const old = gate.request({ base: "a", text: "old" });
  const newest = gate.request({ base: "b", text: "new" });
  const reply = (id: number, base: string) => ({
    id,
    result: { base, diagnostics: [], changedParagraphs: 1, elapsedMs: 1 },
  });
  expect(gate.accept(reply(old.id, "a"), "b")).toBeUndefined();
  expect(gate.accept(reply(newest.id, "b"), "b")).toBeDefined();
  expect(gate.accept(reply(newest.id, "b"), "c")).toBeUndefined();
  gate.invalidate();
  expect(gate.accept(reply(newest.id, "b"), "b")).toBeUndefined();
});
