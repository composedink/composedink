import type { Diagnostic } from "./index.ts";
import type { Paragraph } from "./prose.ts";
export const thresholds = { sentenceWords: 25, bulletWords: 30 } as const;
export function style(p: Paragraph): Diagnostic[] {
  const result: Diagnostic[] = [];
  const add = (from: number, to: number, code: string, message: string, replacement?: string) =>
    result.push({
      from,
      to,
      code,
      severity: "warn",
      message,
      ...(replacement === undefined ? {} : { replacement }),
    });
  for (const [pattern, code, message] of [
    [
      /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(?:\w+ed|written|given|taken|made|seen|known|built|done|shown|found)\b/gi,
      "style:passive",
      "Consider naming who performs this action.",
    ],
    [
      /\b(?:quickly|slowly|really|very|clearly|simply|actually|basically|extremely|suddenly|carefully|easily|obviously)\b/gi,
      "style:adverb",
      "Consider a more precise verb or removing this modifier.",
    ],
  ] as const)
    for (const m of p.prose.matchAll(pattern)) add(m.index, m.index + m[0].length, code, message);
  for (const m of p.prose.matchAll(
    /\b(?:utilize|commence|approximately|assistance|endeavor|subsequently)\b/gi,
  )) {
    const words: Record<string, string> = {
      utilize: "use",
      commence: "start",
      approximately: "about",
      assistance: "help",
      endeavor: "try",
      subsequently: "then",
    };
    add(
      m.index,
      m.index + m[0].length,
      "style:simpler",
      "Consider a simpler word.",
      words[m[0].toLowerCase()],
    );
  }
  for (const m of p.prose.matchAll(/[^.!?]+[.!?]?/g)) {
    const leading = m[0].length - m[0].trimStart().length;
    if ((m[0].match(/\b[\p{L}\p{N}’']+\b/gu) ?? []).length > thresholds.sentenceWords)
      add(
        m.index + leading,
        m.index + m[0].trimEnd().length,
        "sentence.length",
        `Sentence exceeds ${thresholds.sentenceWords} words.`,
      );
  }
  for (const m of p.source.matchAll(/(?:\*\*|__)(.+?)(?:\*\*|__)/g))
    if (
      p.prose.slice(m.index + 2, m.index + 2 + m[1].length).trim() &&
      p.prose.slice(0, m.index).trim() &&
      !/[.!?]\s*$/.test(p.prose.slice(0, m.index))
    )
      add(
        m.index + 2,
        m.index + 2 + m[1].length,
        "bold.inline",
        "Consider removing emphasis inside a sentence.",
      );
  for (const m of p.source.matchAll(/^\s*(?:[-+*]|\d+[.)])\s+[^\n]+/gm))
    if (
      (p.prose.slice(m.index, m.index + m[0].length).match(/\b\w+\b/g) ?? []).length >
      thresholds.bulletWords
    )
      add(
        m.index,
        m.index + m[0].length,
        "bullets.long",
        `Bullet exceeds ${thresholds.bulletWords} words.`,
      );
  return result;
}
