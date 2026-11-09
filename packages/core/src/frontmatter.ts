import { parseDocument, stringify } from "yaml";
import { FRONTMATTER } from "@composedink/lint/prose";
/**
 * The post's settings block: `---`, YAML lines, a closing `---` line, at the very start of the
 * source. Browser-safe: the editor, the document list and kinds all read frontmatter through here.
 */
export interface FrontmatterBlock {
  /** End of the whole block, closing fence and its newline included. */
  readonly to: number;
  /** Start of the YAML text (after the opening fence's newline). */
  readonly yamlFrom: number;
  /** Start of the closing fence: the YAML text is [yamlFrom, close). */
  readonly close: number;
  readonly yaml: string;
}
export function frontmatterBlock(text: string): FrontmatterBlock | undefined {
  const match = text.match(FRONTMATTER);
  if (!match) return undefined;
  const yamlFrom = text.indexOf("\n") + 1;
  const close = Math.max(yamlFrom, match[0].lastIndexOf("---"));
  return { to: match[0].length, yamlFrom, close, yaml: text.slice(yamlFrom, close) };
}
/** Top-level values of a closed, parseable block; `{}` when there is none or it is malformed. */
export function frontmatterValues(text: string): Record<string, unknown> {
  const block = frontmatterBlock(text);
  if (!block) return {};
  const parsed = parseDocument(block.yaml);
  if (parsed.errors.length) return {};
  const value: unknown = parsed.toJS();
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Why the settings block cannot be read: a 1-based source line and a one-line reason. */
export interface FrontmatterProblem {
  readonly line: number;
  readonly message: string;
}
export function frontmatterProblem(text: string): FrontmatterProblem | undefined {
  const block = frontmatterBlock(text);
  if (!block) {
    // An opening fence with no closing fence: everything after it reads as prose.
    if (/^---[ \t]*\r?\n/.test(text))
      return { line: 1, message: "the block opened here is never closed with a --- line" };
    return undefined;
  }
  const parsed = parseDocument(block.yaml);
  const [error] = parsed.errors;
  if (error) {
    // yaml reports where it gave up, which can be past the last setting (an unclosed `[`): name
    // the last line of settings at most, never the closing fence.
    const last = block.yaml.replace(/\n$/, "").split("\n").length;
    const line = 1 + Math.min(error.linePos?.[0].line ?? 1, Math.max(1, last));
    // yaml's message carries a code frame after its first line; the notice shows only the reason.
    return {
      line,
      message: error.message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, ""),
    };
  }
  const value: unknown = parsed.toJS();
  if (value !== null && (typeof value !== "object" || Array.isArray(value)))
    return { line: 2, message: "settings must be key: value lines" };
  return undefined;
}
/**
 * Source ranges of top-level keys in `keys`: whole lines including continuation lines (indented
 * or sequence items). Export strips them; the settings strip replaces them.
 */
export function keyRanges(text: string, keys: readonly string[]) {
  const block = frontmatterBlock(text);
  if (!block || !keys.length) return [];
  const ranges: [number, number][] = [];
  const lines = [...block.yaml.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((m) => m[0])
    .map((m) => ({ from: block.yamlFrom + m.index, text: m[0] }));
  const continues = (i: number): boolean => {
    const line = lines[i]?.text;
    if (line === undefined) return false;
    if (/^(?:\s+\S|-(?:\s|$))/.test(line)) return true;
    return !line.trim() && continues(i + 1);
  };
  for (let i = 0; i < lines.length; i++) {
    const key = lines[i].text.match(/^([A-Za-z_][\w-]*)\s*:/)?.[1];
    if (!key || !keys.includes(key)) continue;
    let end = i;
    while (continues(end + 1)) end++;
    const last = lines[end];
    ranges.push([lines[i].from, last.from + last.text.length]);
    i = end;
  }
  return ranges;
}
/** One text change (CodeMirror's shape): replace [from, to) with `insert`. */
export interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}
/**
 * The change that sets (or with `undefined`, removes) one top-level key: the key's lines are
 * replaced in place, a missing key is appended before the closing fence, and a document without a
 * block gains one. Values are written as YAML scalars.
 */
export function setFrontmatterField(text: string, key: string, value: unknown): TextChange {
  const line = value === undefined ? "" : stringify({ [key]: value }, { lineWidth: 0 });
  const block = frontmatterBlock(text);
  if (!block) return { from: 0, to: 0, insert: line ? `---\n${line}---\n\n` : "" };
  const [range] = keyRanges(text, [key]);
  if (range) {
    // The last line may end at the closing fence without a newline of its own in odd sources.
    const insert = text[range[1] - 1] === "\n" || !line ? line : line.replace(/\n$/, "");
    return { from: range[0], to: range[1], insert };
  }
  const before = block.close > block.yamlFrom && text[block.close - 1] !== "\n" ? "\n" : "";
  return { from: block.close, to: block.close, insert: before + line };
}
