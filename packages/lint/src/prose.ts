export interface Paragraph {
  from: number;
  source: string;
  prose: string;
}
// Mask syntax in place so every retained character keeps its original UTF-16 offset.
export function paragraphs(source: string): Paragraph[] {
  const chars = source.split("");
  const hide = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  };
  const mask = (pattern: RegExp) => {
    for (const m of source.matchAll(pattern)) hide(m.index, m.index + m[0].length);
  };
  mask(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/g);
  let fence: { marker: string; count: number; from: number } | undefined;
  for (const line of source.matchAll(/^.*(?:\n|$)/gm)) {
    const token = line[0].match(/^ {0,3}(`{3,}|~{3,})(.*)/);
    if (!token) continue;
    if (!fence) fence = { marker: token[1][0], count: token[1].length, from: line.index };
    else if (token[1][0] === fence.marker && token[1].length >= fence.count && !token[2].trim()) {
      hide(fence.from, line.index + line[0].length);
      fence = undefined;
    }
  }
  if (fence) hide(fence.from, source.length);
  mask(/^(?: {4}|\t)[^\n]*(?:\n|$)/gm);
  mask(/<!--\s*composed[\s\S]*?<!--\s*\/composed\s*-->/g);
  mask(/<!--[\s\S]*?-->/g);
  mask(/<ComposedBlock\b[\s\S]*?<\/ComposedBlock>/g);
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
      hide(start, Math.min(i + 1, chars.length));
    }
  }
  for (const m of source.matchAll(/(!?)\[([^\]\n]*)\]\([^\n)]*\)/g)) {
    if (m[1]) hide(m.index, m.index + m[0].length);
    else {
      hide(m.index, m.index + 1);
      hide(m.index + 1 + m[2].length, m.index + m[0].length);
    }
  }
  mask(/https?:\/\/[^\s<>]+/g);
  mask(/^ {0,3}(?:#{1,6}\s+|>\s*|(?:[-+*]|\d+[.)])\s+)/gm);
  for (let i = 0; i < chars.length; i++) if (/[*_~]/.test(chars[i])) chars[i] = " ";
  const masked = chars.join("");
  const result: Paragraph[] = [];
  for (const m of masked.matchAll(/[^\r\n]+(?:\r?\n(?!\s*\r?\n)[^\r\n]+)*/g)) {
    if (m[0].trim())
      result.push({
        from: m.index,
        source: source.slice(m.index, m.index + m[0].length),
        prose: m[0],
      });
  }
  return result;
}
