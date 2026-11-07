import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "node:crypto";
import { z } from "zod";
import { parseDocument, stringify } from "yaml";
import type { LoroDoc } from "loro-crdt";
import {
  mergeRulesets,
  parseRuleset,
  type EffectiveRules,
  type LintSettings,
  type Ruleset,
} from "@composedink/lint";
import { atomicWrite } from "./store/store.ts";
import { kindsDirectory } from "./config.ts";
import { BUILTIN_KINDS } from "./kinds/builtins.ts";
import { validateProjection } from "./model/validate.ts";
import { hunks } from "./model/apply.ts";
export const FIELDS = ["reader", "medium", "budget"] as const;
export type Field = (typeof FIELDS)[number];
export const KIND_FILES = ["kind.json", "template.mdx", "rules.json"] as const;
export type KindFile = (typeof KIND_FILES)[number];
/** A safe lowercase slug; "component" is reserved for component documents. */
export const kindId = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kind ids are lowercase slugs")
  .refine((id) => id !== "component", 'kind id "component" is reserved');
export type KindId = string;
const field = z.enum(FIELDS);
const medium = z.enum(["phone", "screen", "web"]);
export const kindSchema = z
  .strictObject({
    reader: z.string(),
    medium,
    budget: z.number().int().positive(),
    frontmatter: z.array(field),
    meta: z.array(field),
    export: z.strictObject({ strip: z.array(field) }),
    questions: z.array(z.string().min(1)),
  })
  .superRefine((kind, ctx) => {
    for (const f of FIELDS)
      if ([...kind.frontmatter, ...kind.meta].filter((p) => p === f).length !== 1)
        ctx.addIssue({
          code: "custom",
          message: `"${f}" must be listed exactly once across frontmatter and meta`,
        });
  });
export type KindConfig = z.infer<typeof kindSchema>;
export interface Kind {
  readonly id: KindId;
  readonly config: KindConfig;
  readonly template: string;
  readonly rules: Ruleset;
}
const root = (home: string) => kindsDirectory(home);
export const kindPath = (home: string, id: KindId, file?: KindFile) =>
  file ? join(root(home), kindId.parse(id), file) : join(root(home), kindId.parse(id));
const missing = (e: unknown) => !!e && typeof e === "object" && "code" in e && e.code === "ENOENT";
async function optional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if (missing(e)) return undefined;
    throw e;
  }
}
async function directory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}
export const kindBase = (files: Record<KindFile, string>) =>
  hash("sha256", JSON.stringify(KIND_FILES.map((f) => files[f])));
/** Copies a built-in's files on first use; never overwrites what the user has. */
async function seed(home: string, id: KindId) {
  const files = BUILTIN_KINDS[id];
  if (!files) return;
  await mkdir(kindPath(home, id), { recursive: true });
  for (const file of KIND_FILES)
    if ((await optional(kindPath(home, id, file))) === undefined)
      await atomicWrite(kindPath(home, id, file), files[file]);
}
async function raw(home: string, id: KindId) {
  await seed(home, id);
  const present: Partial<Record<KindFile, string>> = {};
  for (const file of KIND_FILES) present[file] = await optional(kindPath(home, id, file));
  return present;
}
/** The three files as text (absent files read as empty) and their base hash. */
export async function kindFiles(home: string, id: KindId) {
  const present = await raw(home, id);
  const files = Object.fromEntries(KIND_FILES.map((f) => [f, present[f] ?? ""])) as Record<
    KindFile,
    string
  >;
  return { kind: kindId.parse(id), base: kindBase(files), files };
}
export async function listKinds(home: string) {
  const ids = new Set(Object.keys(BUILTIN_KINDS));
  try {
    for (const entry of await readdir(root(home), { withFileTypes: true }))
      if (entry.isDirectory() && kindId.safeParse(entry.name).success) ids.add(entry.name);
  } catch (e) {
    if (!missing(e)) throw e;
  }
  return [...ids]
    .sort()
    .map((kind) => ({ kind, origin: kind in BUILTIN_KINDS ? "builtin" : ("user" as const) }));
}
export const kindExists = async (home: string, id: KindId) =>
  kindId.parse(id) in BUILTIN_KINDS || (await directory(kindPath(home, id)));
const invalid = (path: string, message: string) =>
  Error(`InvalidKind: ${path}: ${message}; fix: correct the file with composed kind write`);
function parseJson(path: string, text: string) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw invalid(path, `invalid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
}
const zodMessage = (e: z.ZodError) =>
  e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ");
/** Validates one file's text; used before writes and before use. */
export function checkKindFile(path: string, file: KindFile, text: string) {
  if (file === "kind.json") {
    const result = kindSchema.safeParse(parseJson(path, text));
    if (!result.success) throw invalid(path, zodMessage(result.error));
    return result.data;
  }
  if (file === "rules.json") {
    try {
      const rules = parseRuleset(parseJson(path, text));
      if (rules.extends !== null) kindId.parse(rules.extends);
      return rules;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("InvalidKind")) throw e;
      throw invalid(
        path,
        e instanceof z.ZodError ? `extends: ${zodMessage(e)}` : e instanceof Error ? e.message : "",
      );
    }
  }
  try {
    validateProjection(text, []);
  } catch (e) {
    throw invalid(path, e instanceof Error ? e.message : String(e));
  }
  return text;
}
/** A complete, valid kind. Throws InvalidKind naming the file for incomplete or malformed config. */
export async function loadKind(home: string, id: KindId): Promise<Kind> {
  const present = await raw(home, id);
  for (const file of KIND_FILES)
    if (present[file] === undefined) throw invalid(kindPath(home, id, file), "missing file");
  return {
    id,
    config: checkKindFile(
      kindPath(home, id, "kind.json"),
      "kind.json",
      present["kind.json"]!,
    ) as KindConfig,
    template: present["template.mdx"]!,
    rules: checkKindFile(
      kindPath(home, id, "rules.json"),
      "rules.json",
      present["rules.json"]!,
    ) as Ruleset,
  };
}
/** The kind a document records, or built-in post with a warning when this device lacks it. */
export async function resolveKind(home: string, id: KindId) {
  if (kindId.safeParse(id).success && (await kindExists(home, id)))
    return { kind: await loadKind(home, id), warnings: [] as string[] };
  return {
    kind: await loadKind(home, "post"),
    warnings: [
      `Kind "${id}" is not configured on this device (${join(root(home), id)}); using built-in post rules. Fix: composed kind write ${id} or composed doc kind <id> <kind>.`,
    ],
  };
}
/** Resolves extends recursively (parent first) and merges into rules with no extends. */
export async function effectiveRules(home: string, id: KindId): Promise<EffectiveRules> {
  const chain: Ruleset[] = [];
  const seen: string[] = [];
  let current: string | null = id;
  while (current !== null) {
    const from = seen.at(-1);
    if (seen.includes(current))
      throw invalid(
        kindPath(home, from!, "rules.json"),
        `extends cycle ${[...seen, current].join(" → ")}`,
      );
    if (!(await kindExists(home, current)))
      throw invalid(kindPath(home, from ?? id, "rules.json"), `extends missing kind "${current}"`);
    const kind = await loadKind(home, current);
    chain.unshift(kind.rules);
    seen.push(current);
    current = kind.rules.extends;
  }
  try {
    return mergeRulesets(chain);
  } catch (e) {
    throw invalid(kindPath(home, id, "rules.json"), e instanceof Error ? e.message : String(e));
  }
}
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
export function frontmatterValues(text: string): Record<string, unknown> {
  const yaml = text.match(FRONTMATTER);
  if (!yaml) return {};
  const parsed = parseDocument(yaml[1]);
  if (parsed.errors.length) return {};
  const value: unknown = parsed.toJS();
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const fieldValue = {
  reader: (v: unknown) => (typeof v === "string" ? v : undefined),
  medium: (v: unknown) => (medium.safeParse(v).success ? (v as LintSettings["medium"]) : undefined),
  budget: (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined),
};
/** Valid reading values among `keys`, from a frontmatter or meta record. */
export function readingValues(record: Record<string, unknown>, keys: readonly Field[] = FIELDS) {
  const values: Partial<Record<Field, string | number>> = {};
  for (const key of keys) {
    const value = fieldValue[key](record[key]);
    if (value !== undefined) values[key] = value;
  }
  return values;
}
/**
 * What a document's lint pass and model brief read: effective rules plus reader/medium/budget
 * merged as kind defaults, then meta, then explicit frontmatter.
 */
export async function documentSettings(home: string, doc: LoroDoc) {
  const meta = doc.getMap("meta").toJSON() as Record<string, unknown>;
  const { kind, warnings } = await resolveKind(home, String(meta.kind));
  const { rules, custom } = await effectiveRules(home, kind.id);
  const front = frontmatterValues(doc.getText("mdx").toString());
  const reading = {
    reader: kind.config.reader,
    medium: kind.config.medium,
    budget: kind.config.budget,
    ...readingValues(meta),
    ...readingValues(front),
  } as Pick<LintSettings, Field>;
  for (const key of FIELDS)
    if (key in front && readingValues(front, [key])[key] === undefined)
      warnings.push(`Frontmatter "${key}" is invalid and ignored.`);
  return { rules, custom, ...reading, warnings };
}
/** Adds `entries` to the template's frontmatter (creating one) unless a key is already there. */
export function withFrontmatter(template: string, entries: Partial<Record<Field, unknown>>) {
  const existing = frontmatterValues(template);
  const lines = Object.entries(entries)
    .filter(([key]) => !(key in existing))
    .map(([key, value]) => stringify({ [key]: value }))
    .join("");
  if (!lines) return template;
  const yaml = template.match(FRONTMATTER);
  if (!yaml) return `---\n${lines}---\n\n${template}`;
  const close = yaml[0].lastIndexOf("---");
  return template.slice(0, close) + lines + template.slice(close);
}
/** The document a kind creates: the template with frontmatter defaults, and meta defaults. */
export async function creation(home: string, id: KindId) {
  if (!(await kindExists(home, id)))
    throw Error(`UnknownKind: ${id}; fix: composed kind list, or composed kind write ${id}`);
  const kind = await loadKind(home, id);
  await effectiveRules(home, id);
  const { config } = kind;
  const text = withFrontmatter(
    kind.template,
    Object.fromEntries(config.frontmatter.map((f) => [f, config[f]])),
  );
  return {
    kind: id,
    text,
    meta: {
      ...Object.fromEntries(config.meta.map((f) => [f, config[f]])),
      ...readingValues(frontmatterValues(text), config.export.strip),
    },
  };
}
/**
 * Source ranges of top-level frontmatter keys in `keys`, whole lines including continuation
 * lines (indented or sequence items) — the export projection removes them.
 */
export function stripRanges(text: string, keys: readonly string[]) {
  const yaml = text.match(FRONTMATTER);
  if (!yaml || !keys.length) return [];
  const ranges: [number, number][] = [];
  const lines = [...yaml[1].matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((m) => m[0])
    .map((m) => ({ from: text.indexOf("\n") + 1 + m.index, text: m[0] }));
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
    const to = last.from + last.text.length;
    // The closing fence's newline belongs to the fence, so the last body line keeps its own.
    ranges.push([lines[i].from, last.text.endsWith("\n") ? to : to + 1]);
    i = end;
  }
  return ranges;
}
export const removeRanges = (text: string, ranges: readonly [number, number][]) =>
  ranges.reduceRight((t, [from, to]) => t.slice(0, from) + t.slice(to), text);
/**
 * Replaces one kind file when `base` (from kindFiles) is still current. The write is staged in
 * the caller's transaction, so a retried request returns its receipt instead of writing twice.
 */
export async function writeKindFile(
  a: { store: { home: string }; deviceWrite(path: string, text: string): void },
  id: KindId,
  file: KindFile,
  text: string,
  base: string,
) {
  const current = await kindFiles(a.store.home, id);
  if (current.base !== base)
    throw Error(`UnknownBase: kind ${id} changed since read; fix: composed kind read ${id}`);
  const path = kindPath(a.store.home, id, file);
  checkKindFile(path, file, text);
  a.deviceWrite(path, text);
  return { base: kindBase({ ...current.files, [file]: text }) };
}
/** The frontmatter keys this document's kind strips from exports. */
export async function exportStrip(home: string, doc: LoroDoc) {
  return (await resolveKind(home, String(doc.getMap("meta").get("kind")))).kind.config.export.strip;
}
/**
 * Rebases an edit of the stripped projection onto the full source: removed key lines stay where
 * they were, and insertions at their edges land before them (the clean-view edge rule).
 */
export function restoreStripped(full: string, ranges: readonly [number, number][], edited: string) {
  const position: number[] = [];
  for (let i = 0, r = 0; i < full.length; i++) {
    while (r < ranges.length && i >= ranges[r][1]) r++;
    if (r < ranges.length && i >= ranges[r][0]) continue;
    position.push(i);
  }
  const at = (p: number) => (p === 0 ? 0 : position[p - 1] + 1);
  let result = full;
  for (const h of hunks(removeRanges(full, ranges), edited).reverse()) {
    const kept = [];
    for (let p = h.from; p < h.to; p++) kept.push(position[p]);
    for (let k = kept.length - 1; k >= 0; k--)
      result = result.slice(0, kept[k]) + result.slice(kept[k] + 1);
    result = result.slice(0, at(h.from)) + h.insert + result.slice(at(h.from));
  }
  return result;
}
