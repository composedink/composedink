import type { LoroDoc } from "loro-crdt";
import { interval, anchors } from "./selection.ts";
import { snippet } from "./stash.ts";

export function proposalVersion(
  merged: LoroDoc,
  agent: LoroDoc,
  liveAnchors: ReturnType<typeof anchors>,
  extraction: ReturnType<typeof anchors>,
) {
  const live = interval(merged, liveAnchors);
  const range = interval(merged, extraction);
  const source = snippet(merged, range.from, Math.max(range.from, range.to));
  const text = merged.getText("mdx");
  let value = "";
  const dim: [number, number][] = [];
  for (let i = range.from; i < range.to;) {
    const position = i;
    const offset = position - range.from;
    const character = String.fromCodePoint(source.text.codePointAt(offset)!);
    i += character.length;
    const authored = text.getCursor(position, 0)?.pos()?.peer === agent.peerIdStr;
    if (!authored && !(position >= live.from && position < live.to)) continue;
    if (source.dim.some(([from, to]) => offset >= from && offset < to)) {
      const last = dim.at(-1);
      if (last && last[1] === value.length) last[1] += character.length;
      else dim.push([value.length, value.length + character.length]);
    }
    value += character;
  }
  return { text: value, dim };
}
