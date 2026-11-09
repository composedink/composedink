import type { Diagnostic } from "./index.ts";
import type { Paragraph, Section, Sentence } from "./prose.ts";
import { phrasePattern, ruleOptions, severity, type LintSettings } from "./ruleset.ts";
const diagnostic = (
  from: number,
  to: number,
  code: string,
  message: string,
  replacement?: string,
): Diagnostic => ({
  from,
  to,
  code,
  severity: severity(code),
  message,
  ...(replacement === undefined ? {} : { replacement }),
});
const ASK =
  /(?<![\p{L}\p{N}_])(?:ask|asks|asking|request|requests|requesting|please)(?![\p{L}\p{N}_])|\?/iu;
const SIMPLER: Record<string, string> = {
  utilize: "use",
  commence: "start",
  approximately: "about",
  assistance: "help",
  endeavor: "try",
  subsequently: "then",
};
/**
 * Paragraph-local rules on one masked paragraph; offsets relative to the paragraph. `sentences`
 * holds each block's sentences from the shared tokenizer.
 */
export function paragraphRules(
  p: Paragraph,
  sentences: readonly (readonly Sentence[])[],
  settings: LintSettings,
): Diagnostic[] {
  const { rules } = settings;
  const result: Diagnostic[] = [];
  const add = (from: number, to: number, code: string, message: string, replacement?: string) =>
    result.push(diagnostic(from, to, code, message, replacement));
  // A phrase match counts only where source and prose agree, i.e. no masked syntax inside it.
  const prose = (from: number, to: number, text: string) => p.source.slice(from, to) === text;
  for (const m of p.prose.matchAll(
    /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w+ed|written|given|taken|made|seen|known|built|done|shown|found)\b/gi,
  ))
    add(
      m.index,
      m.index + m[0].length,
      "style:passive",
      "Consider naming who performs this action.",
    );
  // Hedges and intensifiers ("really", "actually", "basically", …) belong to filler; this legacy
  // list keeps only the other adverbs, so one word never draws two notes.
  for (const m of p.prose.matchAll(
    /\b(?:quickly|slowly|clearly|simply|extremely|suddenly|carefully|easily|obviously)\b/gi,
  ))
    add(
      m.index,
      m.index + m[0].length,
      "style:adverb",
      "Consider a more precise verb or removing this modifier.",
    );
  for (const m of p.prose.matchAll(
    /\b(?:utilize|commence|approximately|assistance|endeavor|subsequently)\b/gi,
  ))
    add(
      m.index,
      m.index + m[0].length,
      "style:simpler",
      "Consider a simpler word.",
      SIMPLER[m[0].toLowerCase()],
    );
  const filler = ruleOptions(rules, "filler").phrases;
  if (filler.length)
    for (const m of p.prose.matchAll(phrasePattern(filler)))
      if (prose(m.index, m.index + m[0].length, m[0]))
        add(
          m.index,
          m.index + m[0].length,
          "filler",
          `“${m[0]}” hedges or intensifies; cut it or say exactly how much.`,
        );
  const preamble = ruleOptions(rules, "preamble").phrases;
  const opener = preamble.length && new RegExp(`^\\s*${phrasePattern(preamble, "").source}`, "iu");
  const { maxWords } = ruleOptions(rules, "sentence.length");
  const limit = ruleOptions(rules, "paragraph.length").limits[settings.medium];
  const { maxSentences } = ruleOptions(rules, "bullets.long");
  p.blocks.forEach((block, i) => {
    const own = sentences[i];
    const text = p.prose.slice(block.from, block.to);
    const lead = opener && text.match(opener);
    if (lead) {
      const to = block.from + lead[0].length;
      const from = to - lead[0].trimStart().length;
      if (ASK.test(p.prose.slice(to, block.to)) && prose(from, to, p.prose.slice(from, to)))
        add(from, to, "preamble", "Cut the preamble and lead with the ask.");
    }
    for (const s of own)
      if (s.words > maxWords)
        add(s.from, s.to, "sentence.length", `Sentence has ${s.words} words; limit ${maxWords}.`);
    if (!own.length) return;
    if (block.kind === "paragraph" && own.length > limit)
      add(
        own[0].from,
        own.at(-1)!.to,
        "paragraph.length",
        `${own.length} sentences in one paragraph; limit ${limit} for ${settings.medium}.`,
      );
    if (block.kind === "item" && own.length > maxSentences)
      add(
        block.from + p.source.slice(block.from).search(/\S/),
        own.at(-1)!.to,
        "bullets.long",
        `List item has ${own.length} sentences; merge into a paragraph.`,
      );
  });
  const all = sentences.flat();
  for (const m of p.source.matchAll(
    /(?<![\p{L}\p{N}*\\])\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|(?<![\p{L}\p{N}_\\])__(?=\S)([\s\S]+?)(?<=\S)__(?![\p{L}\p{N}_])/gu,
  )) {
    const from = m.index + 2;
    const to = from + (m[1] ?? m[2]).length;
    const inner = p.prose.slice(from, to);
    if (!inner.trim()) continue;
    const first = from + inner.search(/\S/);
    const s = all.find((s) => s.from <= first && first < s.to);
    if (s && p.prose.slice(s.from, m.index).trim())
      add(from, to, "bold.inline", "Bold only a key thought at the start of its sentence.");
  }
  return result;
}
/** Everything a document-level rule reads: all prose sentences and heading sections. */
export interface Measured {
  readonly sentences: readonly Sentence[];
  readonly sections: readonly Section[];
  /** The first prose character's offset, or undefined for a document without prose. */
  readonly firstProse?: number;
  readonly firstProseLength: number;
}
/** Rules over the whole document; recomputed every pass from cached paragraph sentences. */
export function documentRules(doc: Measured, settings: LintSettings): Diagnostic[] {
  const { rules } = settings;
  const result: Diagnostic[] = [];
  const total = doc.sentences.reduce((sum, s) => sum + s.words, 0);
  if (doc.firstProse !== undefined && total > settings.budget)
    result.push(
      diagnostic(
        doc.firstProse,
        doc.firstProse + doc.firstProseLength,
        "budget",
        `${total} words is ${total - settings.budget} over the ${settings.budget}-word budget.`,
      ),
    );
  const { maxWords } = ruleOptions(rules, "visuals");
  for (const section of doc.sections) {
    if (section.visual) continue;
    const own = doc.sentences.filter((s) => s.from >= section.from && s.from < section.to);
    const words = own.reduce((sum, s) => sum + s.words, 0);
    const anchor = section.heading ?? own[0];
    if (words > maxWords && anchor)
      result.push(
        diagnostic(
          anchor.from,
          anchor.to,
          "visuals",
          `Section has ${words} words and no image, block or code; limit ${maxWords}.`,
        ),
      );
  }
  const { minSentences, toleranceWords } = ruleOptions(rules, "rhythm");
  const s = doc.sentences;
  for (let i = 0; i < s.length;) {
    let min = s[i].words;
    let max = min;
    let j = i + 1;
    for (; j < s.length; j++) {
      const lo = Math.min(min, s[j].words);
      const hi = Math.max(max, s[j].words);
      if (hi - lo > 2 * toleranceWords) break;
      [min, max] = [lo, hi];
    }
    if (j - i >= minSentences) {
      result.push(
        diagnostic(
          s[i].from,
          s[j - 1].to,
          "rhythm",
          `${j - i} sentences in a row of ${min}–${max} words; vary their length.`,
        ),
      );
      i = j;
    } else i++;
  }
  return result;
}
