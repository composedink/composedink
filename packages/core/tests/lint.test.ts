import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authority, openStore, bind, registry } from "../src/node.ts";
import { replaceText } from "../src/model/text.ts";
it("registered lint returns positioned diagnostics without advancing the document base", async () => {
  const home = await mkdtemp(join(tmpdir(), "lint-"));
  const a = await authority(await openStore(home));
  const run = bind(a);
  try {
    await run("doc.create", { slug: "post" });
    await a.change("post", (d) => replaceText(d, "😀 This is an test."));
    const before = a.read("post");
    expect(await run("lint", { doc: "post" })).toContainEqual(
      expect.objectContaining({ from: 11, to: 13, replacement: "a" }),
    );
    expect(a.read("post")).toEqual(before);
    await run("component.create", { id: "composed:test/chart", kind: "block" });
    await run("deps.add", {
      doc: "post",
      tag: "Chart",
      component: "composed:test/chart",
      version: "dev",
    });
    await a.change("post", (d) => replaceText(d, "<Chart name={42} />"));
    expect(await run("lint", { doc: "post" })).toContainEqual(
      expect.objectContaining({ from: 0, to: 19, code: "block:props" }),
    );
    expect(registry.find((op) => op.name === "lint")?.mutation).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
it("a kind-created document runs its custom rule and kind.write disabling it silences lint", async () => {
  const home = await mkdtemp(join(tmpdir(), "lint-kind-"));
  const a = await authority(await openStore(home));
  const run = bind(a);
  try {
    const post = (await run("kind.read", { kind: "post" })) as { files: Record<string, string> };
    let { base } = (await run("kind.read", { kind: "memo" })) as { base: string };
    for (const [file, text] of [
      ["kind.json", post.files["kind.json"]],
      ["template.mdx", "Synergy first.\n"],
      [
        "rules.json",
        JSON.stringify({
          extends: "post",
          rules: {},
          custom: [
            { code: "jargon", message: "Plain words.", severity: "warn", phrases: ["synergy"] },
          ],
        }),
      ],
    ])
      ({ base } = (await run("kind.write", { kind: "memo", file, text, base })) as {
        base: string;
      });
    await run("doc.create", { slug: "memo-1", kind: "memo" });
    expect(await run("lint", { doc: "memo-1" })).toContainEqual(
      expect.objectContaining({
        code: "jargon",
        severity: "warn",
        from: a.read("memo-1").text.indexOf("Synergy"),
        to: a.read("memo-1").text.indexOf("Synergy") + 7,
      }),
    );
    const memo = (await run("kind.read", { kind: "memo" })) as { files: Record<string, string> };
    const rules = JSON.stringify({
      ...JSON.parse(memo.files["rules.json"]),
      rules: { jargon: false },
    });
    await run("kind.write", { kind: "memo", file: "rules.json", text: rules, base });
    expect(
      ((await run("lint", { doc: "memo-1" })) as { code: string }[]).map((d) => d.code),
    ).not.toContain("jargon");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
