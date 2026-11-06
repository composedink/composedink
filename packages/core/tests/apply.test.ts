import { expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authority, openStore, bind } from "../src/node.ts";
it("workflow 3 preserves human paragraph 2 and proposes merged paragraph 4", async () => {
  const home = await mkdtemp(join(tmpdir(), "apply-"));
  const a = await authority(await openStore(home)),
    run = bind(a);
  const by = { kind: "human" };
  try {
    await run("doc.create", { slug: "p" });
    let base = a.read("p").base;
    const original =
      "First paragraph.\n\nHuman paragraph.\n\nThird paragraph.\n\nFourth sentence. Another sentence.\n\nLast paragraph.";
    await run("doc.apply", { doc: "p", base, text: original, mode: "direct", by });
    base = a.read("p").base;
    await run("doc.apply", {
      doc: "p",
      base,
      text: original.replace("Human paragraph.", "Human edited paragraph."),
      mode: "direct",
      by,
    });
    const input = {
      doc: "p",
      base,
      text: original.replace("Fourth", "Agent"),
      mode: "propose",
      by: { kind: "agent", name: "test" },
      request: "proposal",
    };
    const r = (await run("doc.apply", input)) as { alternatives: string[] };
    expect(a.read("p").text).toBe(original.replace("Human paragraph.", "Human edited paragraph."));
    expect(r.alternatives).toHaveLength(1);
    expect(await run("doc.apply", input)).toEqual(r);
    await expect(run("doc.apply", { ...input, text: "different" })).rejects.toThrow(
      "RequestConflict",
    );
    await run("alt.flip", { doc: "p", alt: r.alternatives[0], to: 1 });
    expect(a.read("p").text).toBe(
      original.replace("Human paragraph.", "Human edited paragraph.").replace("Fourth", "Agent"),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

for (const scenario of [
  "delete",
  "replace",
  "partial",
  "inside",
  "edges",
  "empty",
  "full",
  "last",
] as const)
  it(`merged proposal extraction: ${scenario}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "apply-range-"));
    const a = await authority(await openStore(home)),
      run = bind(a);
    const by = { kind: "human" };
    const original = "First.\n\nHuman.\n\nThird.\n\nFourth sentence. Another sentence.\n\nLast.";
    const quote = "Fourth sentence. Another sentence.";
    const start = original.indexOf(quote);
    try {
      await run("doc.create", { slug: "p" });
      await run("doc.apply", {
        doc: "p",
        base: a.read("p").base,
        text: original,
        mode: "direct",
        by,
      });
      const base = a.read("p").base;
      const text =
        scenario === "delete"
          ? original.replace(quote, "")
          : scenario === "replace"
            ? original.replace(quote, "Human replacement.")
            : scenario === "partial"
              ? original.replace("Fourth sentence. ", "")
              : scenario === "inside"
                ? original.replace("Another", "Human Another")
                : scenario === "edges"
                  ? original.replace(quote, "LEFT " + quote + " RIGHT")
                  : original;
      if (text !== original) {
        const human = a.get("p").fork(),
          from = human.version(),
          target = human.getText("mdx");
        if (scenario === "delete" || scenario === "replace") {
          target.delete(start, quote.length);
          if (scenario === "replace") target.insert(start, "Human replacement.");
        } else if (scenario === "partial") target.delete(start, "Fourth sentence. ".length);
        else if (scenario === "inside") target.insert(original.indexOf("Another"), "Human ");
        else if (scenario === "edges") {
          target.insert(start + quote.length, " RIGHT");
          target.insert(start, "LEFT ");
        }
        human.commit();
        await a.typing("p", human.export({ mode: "update", from }));
      }
      const version =
        scenario === "empty"
          ? ""
          : scenario === "full"
            ? "Agent replacement!"
            : scenario === "last"
              ? "Fourth sentence. Another proposal!"
              : "Agent sentence. Another sentence.";
      const result = (await run("alt.propose", {
        doc: "p",
        at: { base, quote },
        versions: [version],
        by: { kind: "agent", name: "spike" },
      })) as { alt?: string; detached: string[] };
      if (scenario === "delete" || scenario === "replace") {
        expect(result.alt).toBeUndefined();
        expect(result.detached).toHaveLength(1);
        expect(a.read("p").text).toBe(text);
        expect(await run("stash.list", { doc: "p" })).toMatchObject([
          { reason: "detached", text: "Agent" },
        ]);
      } else {
        expect(result.alt).toBeDefined();
        expect(a.read("p").text).toBe(text);
        await run("alt.flip", { doc: "p", alt: result.alt, to: 1 });
        const expected =
          scenario === "partial"
            ? "AgentAnother sentence."
            : scenario === "inside"
              ? "Agent sentence. Human Another sentence."
              : version;
        expect(a.read("p").text).toBe(
          scenario === "edges"
            ? original.replace(quote, "LEFT " + expected + " RIGHT")
            : original.slice(0, start) + expected + original.slice(start + quote.length),
        );
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

it("validates base/quotes and rejects YAML proposals atomically", async () => {
  const home = await mkdtemp(join(tmpdir(), "apply-validation-"));
  const a = await authority(await openStore(home)),
    run = bind(a),
    by = { kind: "human" };
  try {
    await run("doc.create", { slug: "p" });
    await run("doc.apply", {
      doc: "p",
      base: a.read("p").base,
      text: "---\ntitle: Old\n---\n\nSame. Same.",
      mode: "direct",
      by,
    });
    const before = a.read("p"),
      base = before.base;
    await expect(
      run("doc.apply", { doc: "p", base: "garbage", text: "x", mode: "propose", by }),
    ).rejects.toThrow("UnknownBase");
    await expect(
      run("doc.apply", {
        doc: "p",
        base,
        text: before.text.replace("Old", "New"),
        mode: "propose",
        by,
      }),
    ).rejects.toThrow("human --direct");
    for (const [at, error] of [
      [{ quote: "Missing" }, "QuoteNotFound"],
      [{ quote: "Same." }, "AmbiguousQuote"],
      [{ quote: "Same.", nth: 2 }, "QuoteNotFound"],
    ] as const)
      await expect(
        run("alt.propose", { doc: "p", at: { base, ...at }, versions: ["x"], by }),
      ).rejects.toThrow(error);
    expect(a.read("p")).toEqual(before);
    await run("alt.propose", {
      doc: "p",
      at: { base, quote: "Same.", nth: 1 },
      versions: ["Chosen."],
      by,
    });
    expect(a.read("p").alts[0].from).toBe(before.text.lastIndexOf("Same."));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
