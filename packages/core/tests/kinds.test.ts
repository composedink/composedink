import { expect, it } from "vite-plus/test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
import { createPost, replaceText } from "../src/model/text.ts";
import {
  creation,
  documentSettings,
  effectiveRules,
  kindFiles,
  kindId,
  kindPath,
  listKinds,
  loadKind,
  resolveKind,
  restoreStripped,
  stripRanges,
  removeRanges,
  writeKindFile,
} from "../src/kinds.ts";
import { BUILTIN_KINDS, QUESTIONS } from "../src/kinds/builtins.ts";
async function withHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "composed-kinds-"));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
const kindJson = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    reader: "essay readers",
    medium: "screen",
    budget: 900,
    frontmatter: ["reader", "medium", "budget"],
    meta: [],
    export: { strip: [] },
    questions: QUESTIONS,
    ...over,
  });
async function userKind(home: string, id: string, files: Partial<Record<string, string>>) {
  await mkdir(kindPath(home, id), { recursive: true });
  for (const [file, text] of Object.entries(files))
    if (text !== undefined) await writeFile(join(kindPath(home, id), file), text);
}
it("copies built-ins on first use and never overwrites later user edits", () =>
  withHome(async (home) => {
    expect(await listKinds(home)).toEqual([
      { kind: "design-doc", origin: "builtin" },
      { kind: "hellotimber", origin: "builtin" },
      { kind: "post", origin: "builtin" },
      { kind: "proposal", origin: "builtin" },
      { kind: "weekly-update", origin: "builtin" },
    ]);
    const first = await kindFiles(home, "weekly-update");
    expect(first.files).toEqual(BUILTIN_KINDS["weekly-update"]);
    for (const file of ["kind.json", "template.mdx", "rules.json"] as const)
      expect(await readFile(kindPath(home, "weekly-update", file), "utf8")).toBe(
        BUILTIN_KINDS["weekly-update"][file],
      );
    const post = await loadKind(home, "post");
    expect(post.config).toMatchObject({ reader: "blog readers", medium: "web", budget: 1200 });
    expect(post.config.questions).toEqual(QUESTIONS);
    expect(post.rules.extends).toBeNull();
    for (const id of ["weekly-update", "proposal", "design-doc", "hellotimber"])
      expect((await loadKind(home, id)).rules.extends).toBe("post");
    const edited = kindJson({ reader: "my team" });
    await writeFile(kindPath(home, "weekly-update", "kind.json"), edited);
    const again = await kindFiles(home, "weekly-update");
    expect(again.files["kind.json"]).toBe(edited);
    expect(again.base).not.toBe(first.base);
    expect((await creation(home, "weekly-update")).text).toContain("reader: my team");
    await writeFile(join(home, "kinds", "essay.txt"), "not a kind");
    await userKind(home, "essay", { "kind.json": kindJson() });
    expect(await listKinds(home)).toContainEqual({ kind: "essay", origin: "user" });
  }));
it("rejects unsafe kind ids before touching paths", () =>
  withHome(async (home) => {
    for (const id of ["component", "../escape", "Upper", "a/b", "", "a--b", "-a"])
      expect(kindId.safeParse(id).success).toBe(false);
    expect(() => kindPath(home, "../../etc")).toThrow();
    await expect(kindFiles(home, "component")).rejects.toThrow(/reserved/);
  }));
it("falls back to built-in post with a warning for a missing kind, keeping the recorded id", () =>
  withHome(async (home) => {
    const missing = await resolveKind(home, "elsewhere");
    expect(missing.kind.id).toBe("post");
    expect(missing.warnings[0]).toContain('Kind "elsewhere"');
    const a = await authority(await openStore(home));
    await a.create("p", createPost("p", { kind: "elsewhere", meta: {}, text: "Hi." }));
    const settings = await documentSettings(home, a.get("p"));
    expect(settings.warnings).toHaveLength(1);
    expect(settings.rules).toEqual((await effectiveRules(home, "post")).rules);
    expect(a.get("p").getMap("meta").get("kind")).toBe("elsewhere");
  }));
it("distinguishes malformed configuration from missing kinds, naming the file", () =>
  withHome(async (home) => {
    await userKind(home, "broken", {
      "kind.json": "{ nope",
      "template.mdx": "",
      "rules.json": "{}",
    });
    await expect(resolveKind(home, "broken")).rejects.toThrow(
      new RegExp(`InvalidKind: ${kindPath(home, "broken", "kind.json")}: invalid JSON`),
    );
    await userKind(home, "placed", {
      "kind.json": kindJson({ meta: ["reader"] }),
      "template.mdx": "",
      "rules.json": JSON.stringify({ extends: null, rules: {}, custom: [] }),
    });
    await expect(loadKind(home, "placed")).rejects.toThrow(/"reader" must be listed exactly once/);
    await userKind(home, "partial", { "kind.json": kindJson() });
    await expect(loadKind(home, "partial")).rejects.toThrow(/template.mdx: missing file/);
    await userKind(home, "orphan", {
      "kind.json": kindJson(),
      "template.mdx": "",
      "rules.json": JSON.stringify({ extends: "nowhere", rules: {}, custom: [] }),
    });
    await expect(effectiveRules(home, "orphan")).rejects.toThrow(
      `${kindPath(home, "orphan", "rules.json")}: extends missing kind "nowhere"`,
    );
    for (const [id, parent] of [
      ["ping", "pong"],
      ["pong", "ping"],
    ])
      await userKind(home, id, {
        "kind.json": kindJson(),
        "template.mdx": "",
        "rules.json": JSON.stringify({ extends: parent, rules: {}, custom: [] }),
      });
    await expect(effectiveRules(home, "ping")).rejects.toThrow(/extends cycle ping → pong → ping/);
  }));
it("inherits rules through extends with per-code overrides", () =>
  withHome(async (home) => {
    await kindFiles(home, "weekly-update");
    await writeFile(
      kindPath(home, "weekly-update", "rules.json"),
      JSON.stringify({ extends: "post", rules: { "sentence.length": false }, custom: [] }),
    );
    await userKind(home, "standup", {
      "kind.json": kindJson(),
      "template.mdx": "## Today\n",
      "rules.json": JSON.stringify({
        extends: "weekly-update",
        rules: { "style:adverb": false },
        custom: [],
      }),
    });
    const rules = (await effectiveRules(home, "standup")).rules;
    expect(rules["sentence.length"]).toBe(false);
    expect(rules["style:adverb"]).toBe(false);
    expect(rules.harper).toEqual({});
  }));
it("stages kind writes in a transaction, rejecting stale bases before writing", () =>
  withHome(async (home) => {
    const a = await authority(await openStore(home));
    const { base, files } = await kindFiles(home, "proposal");
    const text = files["template.mdx"] + "\n## Appendix\n";
    const result = await a.transaction("write-1", "h1", () =>
      writeKindFile(a, "proposal", "template.mdx", text, base),
    );
    expect(await readFile(kindPath(home, "proposal", "template.mdx"), "utf8")).toBe(text);
    expect(result).toEqual({ base: (await kindFiles(home, "proposal")).base });
    expect(await a.transaction("write-1", "h1", async () => Error("not rerun"))).toEqual(result);
    await expect(
      a.transaction(undefined, "h2", () =>
        writeKindFile(a, "proposal", "template.mdx", "stale", base),
      ),
    ).rejects.toThrow(/UnknownBase/);
    const fresh = await kindFiles(home, "proposal");
    await expect(
      a.transaction(undefined, "h3", () =>
        writeKindFile(a, "proposal", "kind.json", "{}", fresh.base),
      ),
    ).rejects.toThrow(/InvalidKind/);
    expect(await readFile(kindPath(home, "proposal", "template.mdx"), "utf8")).toBe(text);
    const empty = await kindFiles(home, "essay");
    expect(empty.files).toEqual({ "kind.json": "", "template.mdx": "", "rules.json": "" });
    const written = await a.transaction(undefined, "h4", () =>
      writeKindFile(a, "essay", "kind.json", kindJson(), empty.base),
    );
    expect(written).toEqual({ base: (await kindFiles(home, "essay")).base });
    await expect(loadKind(home, "essay")).rejects.toThrow(/missing file/);
  }));
it("creates from a kind's template, frontmatter defaults and meta defaults", () =>
  withHome(async (home) => {
    const post = await creation(home, "post");
    expect(post.text).toBe(
      "---\ntitle: Untitled\nreader: blog readers\nmedium: web\nbudget: 1200\n---\n\n",
    );
    expect(post.meta).toEqual({});
    const hello = await creation(home, "hellotimber");
    expect(hello.text).toBe(BUILTIN_KINDS.hellotimber["template.mdx"]);
    expect(hello.meta).toEqual({ reader: "blog readers", medium: "web", budget: 1200 });
    await expect(creation(home, "nowhere")).rejects.toThrow(/UnknownKind/);
  }));
it("merges reading values as kind defaults, then meta, then explicit frontmatter", () =>
  withHome(async (home) => {
    const a = await authority(await openStore(home));
    const made = await creation(home, "hellotimber");
    await a.create("h", createPost("h", { ...made, meta: { ...made.meta, budget: 700 } }));
    expect(await documentSettings(home, a.get("h"))).toMatchObject({
      reader: "blog readers",
      budget: 700,
      warnings: [],
    });
    await a.change("h", (d) => replaceText(d, "---\nreader: engineers\nmedium: paper\n---\n"));
    expect(await documentSettings(home, a.get("h"))).toMatchObject({
      reader: "engineers",
      medium: "web",
      budget: 700,
      warnings: ['Frontmatter "medium" is invalid and ignored.'],
    });
  }));
it("strips whole frontmatter entries and rebases outside edits around them", () => {
  const full =
    "---\ntitle: A\nreader: |\n  two\n  lines\nlcd: B\nbudget: 5\n---\n\nBody **text**.\n";
  const ranges = stripRanges(full, ["reader", "budget"]);
  const stripped = removeRanges(full, ranges);
  expect(stripped).toBe("---\ntitle: A\nlcd: B\n---\n\nBody **text**.\n");
  expect(restoreStripped(full, ranges, stripped)).toBe(full);
  expect(restoreStripped(full, ranges, stripped.replace("lcd: B", "lcd: C"))).toBe(
    full.replace("lcd: B", "lcd: C"),
  );
  const rewritten = restoreStripped(full, ranges, "Body only.\n");
  expect(rewritten).toContain("reader: |\n  two\n  lines\n");
  expect(rewritten).toContain("budget: 5\n");
  expect(rewritten).not.toContain("title");
  expect(stripRanges("No frontmatter.", ["reader"])).toEqual([]);
});
it("exports hellotimber without reading keys, retains them in meta and reimports edits", () =>
  withHome(async (home) => {
    const a = await authority(await openStore(home));
    const run = bind(a);
    const made = await creation(home, "hellotimber");
    await a.create("ht", createPost("ht", made));
    const source =
      "---\ntitle: Post\nlcd: Short\nreader: engineers\ndate: 2026-11-06\n---\n\nHello [x](y).\n";
    await a.change("ht", (d) => replaceText(d, source));
    const to = join(home, "content");
    for (const view of ["full", "clean"] as const) {
      await run("export", { doc: "ht", to, view });
      const written = await readFile(join(to, "ht/index.mdx"), "utf8");
      expect(written).toBe(source.replace("reader: engineers\n", ""));
      expect(JSON.parse(await readFile(join(to, "ht/composed.lock.json"), "utf8")).view).toBe(view);
    }
    const outside = (await readFile(join(to, "ht/index.mdx"), "utf8"))
      .replace("lcd: Short", "lcd: Shorter")
      .replace("Hello", "Hello again");
    await writeFile(join(to, "ht/index.mdx"), outside);
    await run("doc.import", { doc: "ht", file: join(to, "ht/index.mdx") });
    expect(a.read("ht").text).toBe(
      source.replace("lcd: Short", "lcd: Shorter").replace("Hello", "Hello again"),
    );
    expect(a.get("ht").getMap("meta").get("reader")).toBe("engineers");
    expect(a.get("ht").getMap("meta").get("budget")).toBe(1200);
    await run("export", { doc: "ht", to, view: "clean" });
    expect(await readFile(join(to, "ht/index.mdx"), "utf8")).toBe(outside);
  }));
it("types into, restarts and previews a custom-kind post", () =>
  withHome(async (home) => {
    await userKind(home, "essay", {
      "kind.json": kindJson(),
      "template.mdx": "# Essay\n",
      "rules.json": JSON.stringify({ extends: "post", rules: {}, custom: [] }),
    });
    const a = await authority(await openStore(home));
    await a.create("e", createPost("e", await creation(home, "essay")));
    const fork = a.get("e").fork();
    replaceText(fork, a.read("e").text + "Typed.\n");
    await a.typing("e", fork.export({ mode: "update", from: a.get("e").version() }));
    expect(a.read("e").text).toContain("Typed.");
    const restarted = await authority(await openStore(home));
    expect(restarted.read("e").text).toContain("reader: essay readers");
    expect(restarted.get("e").getMap("meta").get("kind")).toBe("essay");
    const exported = await bind(restarted)("export", {
      doc: "e",
      to: join(home, "out"),
      view: "clean",
    });
    expect(exported).toMatchObject({ lock: { doc: "e" } });
    expect(await readFile(join(home, "out/e/index.mdx"), "utf8")).toContain("Typed.");
  }));
