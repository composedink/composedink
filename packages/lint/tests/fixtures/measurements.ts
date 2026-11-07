import type { LintSettings } from "../../src/index.ts";
/** A range plus, optionally, what the diagnostic must say or be coded as. */
export interface Expected {
  readonly from: number;
  readonly to: number;
  readonly code?: string;
  readonly message?: RegExp;
}
export interface Case {
  readonly text: string;
  /** Options object for the rule under test (replaces the post default object). */
  readonly options?: Record<string, unknown>;
  /** Reading values the rule reads (medium, budget). */
  readonly settings?: Partial<Pick<LintSettings, "medium" | "budget">>;
}
export interface Fixture {
  readonly code: string;
  readonly positive: Case & { readonly expected: readonly Expected[] };
  readonly negative: Case;
}
export interface Extra extends Case {
  readonly name: string;
  readonly code: string;
  readonly expected: readonly Expected[];
}
/** The quote's UTF-16 range in text, found independently of the linter. */
export function at(text: string, quote: string, occurrence = 0, extra: Partial<Expected> = {}) {
  let from = -1;
  for (let i = 0; i <= occurrence; i++) from = text.indexOf(quote, from + 1);
  if (from < 0) throw Error(`fixture quote "${quote}" not found`);
  return { from, to: from + quote.length, ...extra };
}
/** One sentence of n words: "Word word … word." */
export const sentence = (n: number, word = "word") =>
  [word[0].toUpperCase() + word.slice(1), ...Array(n - 1).fill(word)].join(" ") + ".";
const run = (...lengths: number[]) => lengths.map((n) => sentence(n)).join(" ");

const longParagraph = "😀 One here. Two here. Three here. Four here.";
const budget = "---\ntitle: Many words in the title here\n---\n\n😀 One two three. Four five six.";
const preamble = "Sorry to bother you, but could you review this? 🙏";
const filler = "😀 It is very good, sort of. Really.";
const twentySix = sentence(26);
const harper = "😀 This is an test.";
const bullets = "- One. Two. Three.\n- Fine here.";
const bold = "😀 It is **key** now. Also __this__ too.";
const section = `## Long\n\n${run(6, 6)}`;
const rhythm = run(5, 5, 5, 5);

export const fixtures: readonly Fixture[] = [
  {
    code: "paragraph.length",
    positive: {
      text: longParagraph,
      settings: { medium: "phone" },
      expected: [{ from: 0, to: longParagraph.length, message: /4 sentences.*3.*phone/ }],
    },
    negative: { text: longParagraph, settings: { medium: "web" } },
  },
  {
    code: "budget",
    positive: {
      text: budget,
      settings: { budget: 5 },
      expected: [{ ...at(budget, "😀"), message: /6 words.*1 over.*5/ }],
    },
    negative: { text: budget, settings: { budget: 6 } },
  },
  {
    code: "preamble",
    positive: { text: preamble, expected: [at(preamble, "Sorry to bother you")] },
    negative: { text: "Sorry to bother you, the build is green." },
  },
  {
    code: "filler",
    positive: {
      text: filler,
      expected: [at(filler, "very"), at(filler, "sort of"), at(filler, "Really")],
    },
    negative: { text: "It is good. Everyone agrees." },
  },
  {
    code: "sentence.length",
    positive: {
      text: twentySix,
      expected: [{ from: 0, to: twentySix.length, message: /26 words.*25/ }],
    },
    negative: { text: sentence(25) },
  },
  {
    code: "harper",
    positive: {
      text: harper,
      expected: [{ ...at(harper, "an"), code: "harper:Miscellaneous" }],
    },
    negative: { text: "This is a test." },
  },
  {
    code: "bullets.long",
    positive: {
      text: bullets,
      expected: [{ ...at(bullets, "- One. Two. Three."), message: /3 sentences.*merge/i }],
    },
    negative: { text: "- One. Two.\n- Three. Four." },
  },
  {
    code: "bold.inline",
    positive: { text: bold, expected: [at(bold, "key"), at(bold, "this")] },
    negative: { text: "**Key point.** Then more. Done. **Next** step." },
  },
  {
    code: "visuals",
    positive: {
      text: section,
      options: { maxWords: 10 },
      expected: [{ ...at(section, "Long"), message: /12 words/ }],
    },
    negative: { text: `${section}\n\n![chart](chart.png)`, options: { maxWords: 10 } },
  },
  {
    code: "rhythm",
    positive: {
      text: rhythm,
      expected: [{ from: 0, to: rhythm.length, message: /4 sentences.*5–5 words/ }],
    },
    negative: { text: run(5, 5, 5) },
  },
];

const fourSentences = run(2, 2, 2, 2);
const fiveSentences = run(2, 2, 2, 2, 2);
const sixSentences = run(2, 2, 2, 2, 2, 2);
const listAfterIntro = "Intro here.\n\n- One.\n- Two.\n- Three.\n- Four.";
const overBudget = "😀 One two three four five six.";
const headingBudget = "# A long heading of many words\n\nOne two.";
const midPreamble = "The build broke. Sorry to bother you, can you look?";
const please = "I was wondering if you could please review.";
const quick = "Quick question: can you look?";
const second = "Status is green.\n\nJust wanted to ask: can you merge?";
const itemPreamble = "- Sorry to bother you, can you look?";
const customFiller = "It is very kinda good.";
const shortLimit = "One two three four five six. Short one.";
const emojiLong = "😀 " + sentence(26);
const continuation = "- One.\n  Two. Three.\n- Four.";
const ordered = "1. One. Two. Three.";
const note = "Note: **this** matters.";
const words12 = run(6, 6);
const inlineJsx = `## Long\n\n${sentence(8)} <Thing>inline</Thing> more words here.`;
const leading = words12;
const multi = `## A\n\n${words12}\n\n## B\n\n![x](y.png)\n\n${words12}\n\n### C\n\n${words12}`;
const big = `## Big\n\n${Array.from({ length: 40 }, () => sentence(10)).join(" ")} ${sentence(1)}`;
const fits = `## Fits\n\n${Array.from({ length: 40 }, () => sentence(10)).join(" ")}`;
const hidden30 = Array(30).fill("hidden").join(" ");
const hiddenWords = `## S\n\n${sentence(5)} {"${hidden30}"} and <b title="${hidden30}">bold</b> text.`;
const edge = run(5, 11, 8, 7);
const twoRuns = run(5, 5, 5, 5, 20, 9, 9, 9, 9);
const three = run(5, 5, 5);
const tight = run(5, 7, 6, 5);

export const extras: readonly Extra[] = [
  {
    name: "phone limit is inclusive",
    code: "paragraph.length",
    text: run(2, 2, 2),
    settings: { medium: "phone" },
    expected: [],
  },
  {
    name: "limits option overrides one medium",
    code: "paragraph.length",
    text: fourSentences,
    settings: { medium: "phone" },
    options: { limits: { phone: 4 } },
    expected: [],
  },
  {
    name: "over an overridden limit",
    code: "paragraph.length",
    text: fiveSentences,
    settings: { medium: "phone" },
    options: { limits: { phone: 4 } },
    expected: [{ from: 0, to: fiveSentences.length }],
  },
  {
    name: "screen default keeps other mediums' defaults",
    code: "paragraph.length",
    text: sixSentences,
    settings: { medium: "screen" },
    options: { limits: { phone: 1 } },
    expected: [{ from: 0, to: sixSentences.length }],
  },
  {
    name: "list items are not paragraph sentences",
    code: "paragraph.length",
    text: listAfterIntro,
    settings: { medium: "phone" },
    expected: [],
  },
  {
    name: "one word over",
    code: "budget",
    text: overBudget,
    settings: { budget: 5 },
    expected: [{ ...at(overBudget, "😀"), message: /1 over/ }],
  },
  {
    name: "headings are not counted",
    code: "budget",
    text: headingBudget,
    settings: { budget: 2 },
    expected: [],
  },
  { name: "mid-paragraph is not an opener", code: "preamble", text: midPreamble, expected: [] },
  {
    name: "please is an ask",
    code: "preamble",
    text: please,
    expected: [at(please, "I was wondering if")],
  },
  {
    name: "custom phrase list",
    code: "preamble",
    text: quick,
    options: { phrases: ["quick question"] },
    expected: [at(quick, "Quick question")],
  },
  {
    name: "custom list replaces the defaults",
    code: "preamble",
    text: "Sorry to bother you, can you look?",
    options: { phrases: ["quick question"] },
    expected: [],
  },
  {
    name: "a later paragraph opener",
    code: "preamble",
    text: second,
    expected: [at(second, "Just wanted to ask")],
  },
  {
    name: "a list item opener",
    code: "preamble",
    text: itemPreamble,
    expected: [at(itemPreamble, "Sorry to bother you")],
  },
  { name: "whole words only", code: "filler", text: "Every veryfine thing.", expected: [] },
  {
    name: "custom list replaces the defaults",
    code: "filler",
    text: customFiller,
    options: { phrases: ["kinda"] },
    expected: [at(customFiller, "kinda")],
  },
  {
    name: "maxWords option",
    code: "sentence.length",
    text: shortLimit,
    options: { maxWords: 5 },
    expected: [at(shortLimit, "One two three four five six.")],
  },
  {
    name: "emoji is not a word but keeps offsets",
    code: "sentence.length",
    text: emojiLong,
    expected: [{ from: 0, to: emojiLong.length }],
  },
  {
    name: "continuation lines belong to their item",
    code: "bullets.long",
    text: continuation,
    expected: [at(continuation, "- One.\n  Two. Three.")],
  },
  {
    name: "ordered items",
    code: "bullets.long",
    text: ordered,
    expected: [{ from: 0, to: ordered.length }],
  },
  {
    name: "maxSentences option",
    code: "bullets.long",
    text: "- One. Two. Three.",
    options: { maxSentences: 3 },
    expected: [],
  },
  {
    name: "a long one-sentence item is not a bullets.long",
    code: "bullets.long",
    text: "- " + sentence(31),
    expected: [],
  },
  { name: "bold in inline code", code: "bold.inline", text: "Use `**x**` here.", expected: [] },
  {
    name: "bold in a JSX attribute",
    code: "bold.inline",
    text: 'See <A b="**x**" /> here.',
    expected: [],
  },
  { name: "after a colon", code: "bold.inline", text: note, expected: [at(note, "this")] },
  {
    name: "sentence start after !",
    code: "bold.inline",
    text: "Done! __Next__ step.",
    expected: [],
  },
  {
    name: "a flow block component exempts",
    code: "visuals",
    text: `## Long\n\n${words12}\n\n<Chart value={1} />`,
    options: { maxWords: 10 },
    expected: [],
  },
  {
    name: "a fenced code block exempts",
    code: "visuals",
    text: `## Long\n\n${words12}\n\n\`\`\`js\nrun();\n\`\`\``,
    options: { maxWords: 10 },
    expected: [],
  },
  {
    name: "an img element exempts",
    code: "visuals",
    text: `## Long\n\n${words12} <img src="a.png" alt="" />`,
    options: { maxWords: 10 },
    expected: [],
  },
  {
    name: "inline JSX does not exempt",
    code: "visuals",
    text: inlineJsx,
    options: { maxWords: 10 },
    expected: [at(inlineJsx, "Long")],
  },
  {
    name: "content before the first heading is a section",
    code: "visuals",
    text: leading,
    options: { maxWords: 10 },
    expected: [at(leading, sentence(6))],
  },
  {
    name: "each heading starts a section regardless of level",
    code: "visuals",
    text: multi,
    options: { maxWords: 10 },
    expected: [at(multi, "A"), at(multi, "C", 0)],
  },
  {
    name: "default threshold 400 words",
    code: "visuals",
    text: big,
    expected: [{ ...at(big, "Big"), message: /401 words/ }],
  },
  { name: "exactly 400 words", code: "visuals", text: fits, expected: [] },
  {
    name: "masked expressions and attributes are not counted",
    code: "visuals",
    text: hiddenWords,
    options: { maxWords: 10 },
    expected: [],
  },
  {
    name: "a six-word spread qualifies",
    code: "rhythm",
    text: edge,
    expected: [{ from: 0, to: edge.length, message: /5–11 words/ }],
  },
  { name: "a seven-word spread breaks", code: "rhythm", text: run(5, 12, 8, 7), expected: [] },
  { name: "varied lengths", code: "rhythm", text: run(2, 10, 3, 12), expected: [] },
  {
    name: "a new run after a break",
    code: "rhythm",
    text: twoRuns,
    expected: [
      { from: 0, to: twoRuns.indexOf(sentence(20)) - 1 },
      { from: twoRuns.indexOf(sentence(9)), to: twoRuns.length },
    ],
  },
  {
    name: "minSentences option",
    code: "rhythm",
    text: three,
    options: { minSentences: 3 },
    expected: [{ from: 0, to: three.length }],
  },
  {
    name: "toleranceWords option",
    code: "rhythm",
    text: tight,
    options: { toleranceWords: 1 },
    expected: [{ from: 0, to: tight.length }],
  },
  {
    name: "toleranceWords option breaks",
    code: "rhythm",
    text: run(5, 8, 6, 5),
    options: { toleranceWords: 1 },
    expected: [],
  },
];
/** MDX places whose text is syntax, never prose: a trigger inside them must stay silent. */
export const hiding: readonly { readonly name: string; readonly wrap: (text: string) => string }[] =
  [
    {
      name: "frontmatter",
      wrap: (t) => `---\nnote: |\n${t.replace(/^/gm, "  ")}\n---\n`,
    },
    { name: "fenced code", wrap: (t) => "```md\n" + t + "\n```" },
    { name: "indented code", wrap: (t) => t.replace(/^/gm, "    ") },
    { name: "JSX attribute", wrap: (t) => `<Note text="${t.replaceAll('"', "'")}" />` },
    { name: "JSX expression", wrap: (t) => `{${JSON.stringify(t)}}` },
    {
      name: "nested JSX attribute",
      wrap: (t) => `<Outer>\n  <Inner label={${JSON.stringify(t)}} />\n</Outer>`,
    },
  ];
