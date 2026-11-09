/** One prose sentence; offsets are UTF-16 and relative to whatever the caller rebases them on. */
export interface Sentence {
  readonly from: number;
  readonly to: number;
  /** The sentence's prose: masked syntax and line breaks collapse to one space, none before punctuation. */
  readonly text: string;
  readonly words: number;
}
/** A markdown paragraph or one list item (with its continuation lines), relative to its group. */
export interface Block {
  readonly kind: "paragraph" | "item";
  readonly from: number;
  readonly to: number;
}
/** A blank-line separated group of lines: the unit of caching and of Harper/custom rules. */
export interface Paragraph {
  readonly from: number;
  readonly source: string;
  readonly prose: string;
  readonly blocks: readonly Block[];
}
/** Content from one heading (or the document start) to the next heading of any level. */
export interface Section {
  readonly from: number;
  readonly to: number;
  /** The heading's text range; absent for content before the first heading. */
  readonly heading?: { readonly from: number; readonly to: number };
  /** Whether the section holds an image, a flow block component or a code block. */
  readonly visual: boolean;
}
export interface Prose {
  readonly paragraphs: readonly Paragraph[];
  readonly sections: readonly Section[];
}
/**
 * The frontmatter block at the start of a document: `---`, any lines, then a closing `---` line.
 * A block that is opened but never closed is not frontmatter (it is prose).
 */
export const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
/** UTF-16 length of the closed frontmatter block at the start of `source`, or 0. */
export const frontmatterLength = (source: string) => source.match(FRONTMATTER)?.[0].length ?? 0;
const IMAGE_TAG = /^(?:img|picture|figure|video|svg|iframe)$/;
/**
 * Masks syntax in place so every retained character keeps its original UTF-16 offset, then
 * groups the prose into paragraphs, blocks and heading sections. Structural facts (markers,
 * visuals) are read from source syntax but never counted as prose.
 */
export function analyze(source: string): Prose {
  const chars = source.split("");
  const visuals: number[] = [];
  const masked = (i: number) => chars[i] !== source[i];
  const hide = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  };
  const mask = (pattern: RegExp, visual = false) => {
    for (const m of source.matchAll(pattern)) {
      if (visual && !masked(m.index)) visuals.push(m.index);
      hide(m.index, m.index + m[0].length);
    }
  };
  // A closed frontmatter block is never prose, whether or not its YAML parses.
  const front = frontmatterLength(source);
  if (front) hide(0, front);
  let fence: { marker: string; count: number; from: number } | undefined;
  for (const line of source.matchAll(/^.*(?:\n|$)/gm)) {
    const token = line[0].match(/^ {0,3}(`{3,}|~{3,})(.*)/);
    if (!token || (!fence && masked(line.index + line[0].indexOf(token[1])))) continue;
    if (!fence) fence = { marker: token[1][0], count: token[1].length, from: line.index };
    else if (token[1][0] === fence.marker && token[1].length >= fence.count && !token[2].trim()) {
      visuals.push(fence.from);
      hide(fence.from, line.index + line[0].length);
      fence = undefined;
    }
  }
  if (fence) {
    visuals.push(fence.from);
    hide(fence.from, source.length);
  }
  for (const m of source.matchAll(/^(?: {4}|\t)[^\n]*(?:\n|$)/gm)) {
    const text = m[0].search(/\S/);
    if (text >= 0 && !masked(m.index + text)) visuals.push(m.index);
    hide(m.index, m.index + m[0].length);
  }
  mask(/<!--\s*composed[\s\S]*?<!--\s*\/composed\s*-->/g, true);
  mask(/<!--[\s\S]*?-->/g);
  mask(/<ComposedBlock\b[\s\S]*?<\/ComposedBlock>/g, true);
  mask(/^\s*(?:import|export)\s[^\n]*(?:\n|$)/gm);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== "`") continue;
    const start = i;
    while (chars[i + 1] === "`") i++;
    const count = i - start + 1;
    for (let end = i + 1; end < chars.length; end++) {
      if (chars[end] !== "`") continue;
      const closing = end;
      while (chars[end + 1] === "`") end++;
      if (end - closing + 1 === count) {
        hide(start, end + 1);
        i = end;
        break;
      }
    }
  }
  // Expressions and tags can contain quoted braces/angle brackets and nested expressions.
  const tags: { start: number; end: number; name: string }[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "{") {
      const start = i;
      let depth = 1;
      let quote = "";
      for (i++; i < chars.length; i++) {
        const c = source[i];
        if (quote) {
          if (c === "\\") i++;
          else if (c === quote) quote = "";
        } else if (/["'`]/.test(c)) quote = c;
        else if (c === "{") depth++;
        else if (c === "}" && !--depth) break;
      }
      hide(start, Math.min(i + 1, chars.length));
    } else if (chars[i] === "<" && /[A-Za-z/!>]/.test(source[i + 1] ?? "")) {
      const start = i;
      let quote = "";
      let depth = 0;
      for (i++; i < chars.length; i++) {
        const c = source[i];
        if (quote) {
          if (c === "\\") i++;
          else if (c === quote) quote = "";
        } else if (/["'`]/.test(c)) quote = c;
        else if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      const name = source.slice(start + 1).match(/^[A-Za-z][\w.:-]*/);
      if (name) tags.push({ start, end: Math.min(i + 1, chars.length), name: name[0] });
      hide(start, Math.min(i + 1, chars.length));
    }
  }
  for (const m of source.matchAll(/(!?)\[([^\]\n]*)\]\([^\n)]*\)/g)) {
    if (m[1]) {
      if (!masked(m.index)) visuals.push(m.index);
      hide(m.index, m.index + m[0].length);
    } else {
      hide(m.index, m.index + 1);
      hide(m.index + 1 + m[2].length, m.index + m[0].length);
    }
  }
  mask(/https?:\/\/[^\s<>]+/g);
  // Line markers that survived masking are real structure (code and JSX hid their own).
  const markers = new Map<number, "heading" | "item">();
  for (const m of source.matchAll(
    /^( {0,3})(#{1,6}(?=[ \t]|\r?$)|(?:[-+*]|\d{1,9}[.)])(?=[ \t]))/gm,
  ))
    if (!masked(m.index + m[1].length)) markers.set(m.index, m[2][0] === "#" ? "heading" : "item");
  mask(/^ {0,3}(?:#{1,6}\s+|>\s*|(?:[-+*]|\d+[.)])\s+)/gm);
  for (let i = 0; i < chars.length; i++) if (/[*_~]/.test(chars[i])) chars[i] = " ";
  const prose = chars.join("");
  const lineEnd = (i: number) => (source.indexOf("\n", i) + 1 || source.length + 1) - 1;
  for (const tag of tags) {
    const lineStart = source.lastIndexOf("\n", tag.start - 1) + 1;
    const flow =
      !source.slice(lineStart, tag.start).trim() &&
      !prose.slice(tag.start, lineEnd(tag.end - 1)).trim();
    if (IMAGE_TAG.test(tag.name) || (flow && /^[A-Z]/.test(tag.name))) visuals.push(tag.start);
  }
  const paragraphs: Paragraph[] = [];
  for (const m of prose.matchAll(/[^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*/g)) {
    if (!m[0].trim()) continue;
    const blocks: Block[] = [];
    let open: { kind: Block["kind"]; from: number; to: number } | undefined;
    const close = () => {
      if (open) blocks.push(open);
      open = undefined;
    };
    for (let from = 0; from < m[0].length;) {
      const end = m[0].indexOf("\n", from) < 0 ? m[0].length : m[0].indexOf("\n", from);
      const to = m[0][end - 1] === "\r" ? end - 1 : end;
      const marker = markers.get(m.index + from);
      if (marker === "heading") close();
      else if (marker === "item") {
        close();
        open = { kind: "item", from, to };
      } else if (!m[0].slice(from, to).trim()) close();
      else if (open) open.to = to;
      else open = { kind: "paragraph", from, to };
      from = end + 1;
    }
    close();
    paragraphs.push({
      from: m.index,
      source: source.slice(m.index, m.index + m[0].length),
      prose: m[0],
      blocks,
    });
  }
  const headings = [...markers].filter(([, kind]) => kind === "heading").map(([at]) => at);
  headings.sort((a, b) => a - b);
  const sections: Section[] = [];
  const starts = headings[0] === 0 ? headings : [0, ...headings];
  starts.forEach((from, i) => {
    const to = starts[i + 1] ?? source.length;
    const visual = visuals.some((v) => v >= from && v < to);
    if (!headings.includes(from)) return void sections.push({ from, to, visual });
    const line = prose.slice(from, lineEnd(from));
    const text = line.search(/\S/);
    const heading =
      text < 0
        ? { from, to: from + line.length }
        : { from: from + text, to: from + line.trimEnd().length };
    sections.push({ from, to, heading, visual });
  });
  return { paragraphs, sections };
}
// Words are letter/mark/number runs joined by apostrophes, hyphens, or digit-separating , and .
const WORD = /[\p{L}\p{M}\p{N}]+(?:(?:['’-]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{M}\p{N}]+)*/gu;
export const countWords = (text: string) => text.match(WORD)?.length ?? 0;
const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
  "cf",
  "approx",
  "fig",
  "eq",
]);
const CLOSERS = /["'”’)\]]/;
/** Whether the full stop at `dot` belongs to an abbreviation or initial rather than ending. */
function abbreviation(text: string, dot: number) {
  const token = text
    .slice(0, dot)
    .match(/\S*$/)![0]
    .replace(/^[("'“‘[]+/, "");
  return (
    ABBREVIATIONS.has(token.toLowerCase()) ||
    /^\p{Lu}$/u.test(token) ||
    /^(?:\p{L}\.)+\p{L}$/u.test(token)
  );
}
/**
 * The one sentence tokenizer for rules and the sparkline. A run of . ! ? (plus closing quotes or
 * brackets) ends a sentence when whitespace or the block end follows, except a single full stop
 * after an abbreviation or initial. The block end always ends a sentence. Offsets are relative to
 * `text` plus `offset`; sentences without words are dropped.
 */
export function splitSentences(text: string, offset = 0): Sentence[] {
  const result: Sentence[] = [];
  const push = (from: number, to: number) => {
    const lead = text.slice(from, to).search(/\S/);
    if (lead < 0) return;
    const body = text.slice(from + lead, to).trimEnd();
    const words = countWords(body);
    if (words)
      result.push({
        from: offset + from + lead,
        to: offset + from + lead + body.length,
        text: body.replace(/\s+/g, " ").replace(/ (?=[.,!?;:])/g, ""),
        words,
      });
  };
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?]/.test(text[i])) continue;
    let end = i;
    while (/[.!?]/.test(text[end + 1] ?? "")) end++;
    const single = end === i && text[i] === ".";
    while (CLOSERS.test(text[end + 1] ?? "")) end++;
    if ((end + 1 < text.length && !/\s/.test(text[end + 1])) || (single && abbreviation(text, i))) {
      i = end;
      continue;
    }
    push(start, end + 1);
    start = end + 1;
    i = end;
  }
  push(start, text.length);
  return result;
}
/** Each block's sentences, offsets relative to the paragraph. */
export const blockSentences = (p: Paragraph) =>
  p.blocks.map((b) => splitSentences(p.prose.slice(b.from, b.to), b.from));
