import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkComponent } from "../src/component/check.ts";
import { componentTemplate } from "../src/model/component-template.ts";
it("checks materialized modules and reports positioned type, metadata and fallback errors", async () => {
  const home = await mkdtemp(join(tmpdir(), "component-check-"));
  try {
    const files: Record<string, string> = componentTemplate("inline");
    files["nested/value.ts"] = 'export const value: number = "wrong";';
    const bad = await checkComponent(home, "composed:test/check", files);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "nested/value.ts", line: 1, column: 14 }),
      ]),
    );
    delete files["nested/value.ts"];
    files["syntax.ts"] = "export const a=1;\n\nconst broken = ;";
    expect((await checkComponent(home, "composed:test/check", files)).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "syntax.ts", line: 3 })]),
    );
    delete files["syntax.ts"];

    expect((await checkComponent(home, "composed:test/check", files)).ok).toBe(true);
    files["block.tsx"] = files["block.tsx"].replace(
      'sample:{name:"Lachlan"}',
      "sample:{name:process.exit()}",
    );
    const literal = await checkComponent(home, "composed:test/check", files);
    expect(literal.ok).toBe(false);
    expect(literal.diagnostics[0]).toMatchObject({ file: "block.tsx", line: 8 });
    files["fallback.ts"] = 'import "react";\nexport default () => "bad";';
    expect((await checkComponent(home, "composed:test/check", files)).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "fallback.ts", line: 1 })]),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
it("rejects install scripts and build-path escapes before installing", async () => {
  const files: Record<string, string> = componentTemplate("inline");
  files["package.json"] = JSON.stringify({ scripts: { postinstall: "exit 0" } });
  expect((await checkComponent("/unused", "composed:test/check", files)).ok).toBe(false);
  delete files["package.json"];
  files["node_modules/escape.ts"] = "";
  expect((await checkComponent("/unused", "composed:test/check", files)).ok).toBe(false);
});
