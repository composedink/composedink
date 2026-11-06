import { projection, type View } from "./projection.ts";
import { insertSnippet } from "./marks.ts";
import { proposalVersion } from "./proposal.ts";
import { LoroDoc } from "loro-crdt";
import { createProcessor } from "@mdx-js/mdx";
import { baseFork, anchors, interval, type Author } from "./selection.ts";
import { attach } from "./alternatives.ts";
import { stash } from "./stash.ts";
import { head } from "./read.ts";
import { dissolveCrossed } from "./normalize.ts";
import { normalize } from "./text.ts";
type Hunk = { from: number; to: number; insert: string };
export function hunks(before: string, after: string): Hunk[] {
  const scratch = new LoroDoc();
  const text = scratch.getText("scratch");
  text.insert(0, before);
  scratch.commit();
  const start = scratch.frontiers();
  text.update(after);
  scratch.commit();
  const diff = scratch.diff(start, scratch.frontiers()).find(([id]) => id === text.id)?.[1];
  if (diff?.type !== "text") return [];
  const result: Hunk[] = [];
  let pos = 0;
  let h: Hunk | undefined;
  for (const part of diff.diff) {
    if (part.retain) {
      if (h) {
        result.push(h);
        h = undefined;
      }
      pos += part.retain;
    } else {
      h ??= { from: pos, to: pos, insert: "" };
      if (part.delete) {
        pos += part.delete;
        h.to = pos;
      }
      if (part.insert) h.insert += part.insert;
    }
  }
  if (h) result.push(h);
  return result;
}
function mapOffset(offset: number, changes: Hunk[], right: boolean) {
  let shift = 0;
  for (const h of changes) {
    if (offset < h.from || (offset === h.from && !right)) break;
    if (offset <= h.to) return h.from + shift + (right ? h.insert.length : 0);
    shift += h.insert.length - (h.to - h.from);
  }
  return offset + shift;
}
function units(text: string, changes: Hunk[]) {
  const yaml = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length ?? 0;
  if (changes.some((h) => h.from < yaml || (h.from === 0 && h.insert.startsWith("---"))))
    throw Error(
      "InvalidInvariant: frontmatter proposal requires explicit human --direct acceptance",
    );
  const tree = createProcessor().parse(text.slice(yaml));
  const ranges: { from: number; to: number }[] = [];
  function walk(node: (typeof tree.children)[number]) {
    const from = (node.position?.start.offset ?? 0) + yaml,
      to = (node.position?.end.offset ?? 0) + yaml;
    if (node.type === "list") {
      for (const child of node.children) {
        ranges.push({
          from: (child.position?.start.offset ?? 0) + yaml,
          to: (child.position?.end.offset ?? 0) + yaml,
        });
      }
    } else if (node.type === "paragraph") {
      for (const s of new Intl.Segmenter("en", { granularity: "sentence" }).segment(
        text.slice(from, to),
      )) {
        const raw = s.segment,
          trim = raw.trimEnd();
        ranges.push({ from: from + s.index, to: from + s.index + trim.length });
      }
    } else ranges.push({ from, to });
  }
  tree.children.forEach(walk);
  const selected = changes
    .map((h) => {
      const hits = ranges.filter((r) => h.from <= r.to && h.to >= r.from);
      return {
        from: Math.min(h.from, ...hits.map((r) => r.from)),
        to: Math.max(h.to, ...hits.map((r) => r.to)),
      };
    })
    .sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const r of selected) {
    const last = merged.at(-1);
    if (last && last.to >= r.from) last.to = Math.max(last.to, r.to);
    else merged.push(r);
  }
  return merged;
}
export function proposeBranch(
  doc: LoroDoc,
  base: LoroDoc,
  agent: LoroDoc,
  ranges: { from: number; to: number }[],
  changes: Hunk[],
  by: Author,
) {
  const current = doc.fork();
  current.import(agent.export({ mode: "update", from: base.version() }));
  const alternatives: string[] = [],
    detached: string[] = [];
  for (const r of ranges) {
    const liveAnchors = anchors(base, r.from, r.to);
    const live = interval(doc, liveAnchors);
    const af = mapOffset(r.from, changes, false),
      at = mapOffset(r.to, changes, true);
    const extraction = anchors(agent, af, at);
    const version = {
      ...proposalVersion(current, agent, liveAnchors, extraction),
      by,
      at: Date.now(),
    };
    if (live.to <= live.from) detached.push(stash(doc, version, "detached")!);
    else alternatives.push(attach(doc, live.from, live.to, [version], by));
  }
  normalize(doc);
  return { alternatives, detached };
}
export function apply(
  doc: LoroDoc,
  input: { base: string; view?: View; text: string; mode: "direct" | "propose"; by: Author },
) {
  const base = baseFork(doc, input.base),
    old = base.getText("mdx").toString(),
    projected = projection(base, input.view),
    visibleChanges = hunks(projected.text, input.text);

  const agent = base.fork();
  for (const h of [...visibleChanges].reverse()) {
    const ranges = projected.ranges(h.from, h.to);
    for (const r of [...ranges].reverse()) agent.getText("mdx").delete(r.from, r.to - r.from);
    insertSnippet(agent, projected.offset(h.from), { text: h.insert, dim: [] });
  }
  agent.commit();
  if (input.mode === "direct") {
    const before = doc.fork();
    doc.import(agent.export({ mode: "update", from: base.version() }));
    dissolveCrossed(doc, before);
    normalize(doc);
    return { mode: "direct" as const, head: head(doc) };
  }
  const branchChanges = hunks(old, agent.getText("mdx").toString());
  const ranges = units(old, branchChanges);
  const result = proposeBranch(doc, base, agent, ranges, branchChanges, input.by);
  return { mode: "propose" as const, ...result, head: head(doc) };
}
