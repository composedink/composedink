import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { createPost, replaceText } from "../src/model/text.ts";
import { creation, effectiveRules, kindFiles, kindPath } from "../src/kinds.ts";
import { QUESTIONS } from "../src/kinds/builtins.ts";
const kindJson = JSON.stringify({
  reader: "team",
  medium: "phone",
  budget: 300,
  frontmatter: [],
  meta: ["reader", "medium", "budget"],
  export: { strip: [] },
  questions: QUESTIONS,
});
const jargon = {
  code: "jargon",
  message: "Plain words.",
  severity: "warn",
  phrases: ["synergy"],
};
async function kind(home: string, id: string, rules: unknown) {
  await mkdir(kindPath(home, id), { recursive: true });
  await writeFile(kindPath(home, id, "kind.json"), kindJson);
  await writeFile(kindPath(home, id, "template.mdx"), "");
  await writeFile(kindPath(home, id, "rules.json"), JSON.stringify(rules));
}
it("resolves multi-level rulesets, keeps disabled entries and reads config without stale caches", async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-rulesets-"));
  try {
    await kind(home, "team", {
      extends: "post",
      rules: { "sentence.length": false, "paragraph.length": { limits: { phone: 3, web: 4 } } },
      custom: [jargon, { ...jargon, code: "hedge", phrases: ["kind of"] }],
    });
    await kind(home, "mine", {
      extends: "team",
      rules: { "sentence.length": {}, "paragraph.length": { limits: { phone: 2 } }, hedge: false },
      custom: [{ ...jargon, severity: "soft", phrases: ["synergy", "leverage"] }],
    });
    const effective = await effectiveRules(home, "mine");
    expect(effective).not.toHaveProperty("extends");
    expect(effective.rules).toMatchObject({
      "sentence.length": {},
      "paragraph.length": { limits: { phone: 2 } },
      hedge: false,
      harper: {},
    });
    expect(effective.custom.find((r) => r.code === "jargon")).toMatchObject({
      severity: "soft",
      phrases: ["synergy", "leverage"],
    });
    const a = await authority(await openStore(home));
    const run = bind(a);
    await a.create("m", createPost("m", await creation(home, "mine")));
    await a.change("m", (d) => replaceText(d, "We leverage synergy, kind of."));
    const codes = async () =>
      ((await run("lint", { doc: "m" })) as { code: string; severity: string }[]).map(
        (d) => `${d.code}/${d.severity}`,
      );
    expect(await codes()).toEqual(expect.arrayContaining(["jargon/soft", "jargon/soft"]));
    expect(await codes()).not.toContain("hedge/warn");
    expect(await run("rules.effective", { id: "m" })).toMatchObject({
      reader: "team",
      medium: "phone",
      budget: 300,
      warnings: [],
      rules: { hedge: false },
    });
    // An edit made outside composed is read on the next use; nothing is cached.
    await writeFile(
      kindPath(home, "mine", "rules.json"),
      JSON.stringify({ extends: "team", rules: { jargon: false }, custom: [] }),
    );
    expect(await codes()).not.toContain("jargon/warn");
    expect(await codes()).toContain("hedge/warn");
    expect((await kindFiles(home, "mine")).files["rules.json"]).toContain('"jargon":false');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
