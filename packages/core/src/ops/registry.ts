import { apply } from "../model/apply.ts";
import { propose, flip, resolve } from "../model/alternatives.ts";
import { stashList } from "../model/stash.ts";
import { authorSchema, selectionSchema } from "../model/selection.ts";
import { inspect } from "../inspect.ts";
import { payloadHash } from "../store/receipts.ts";
import { preview, refreshPreviews } from "../export.ts";
import { z } from "zod";
import type { Authority } from "../authority.ts";
import { createPost } from "../model/text.ts";
import { createComponent, readFiles, writeFiles, safePath } from "../model/files.ts";
import { addDependency } from "../model/deps.ts";
import { componentTemplate } from "../model/component-template.ts";
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const id = z.string().regex(/^composed:[a-z0-9-]+\/[a-z0-9-]+$/);
function operation<S extends z.ZodType>(
  name: string,
  input: S,
  mutation: boolean,
  cli: readonly string[],
  run: (a: Authority, i: z.output<S>) => unknown,
) {
  const schema = mutation
    ? z.intersection(input, z.object({ request: z.string().min(1).optional() }))
    : input;
  return {
    name,
    input: schema,
    mutation,
    cli,
    run: (a: Authority, i: unknown) => run(a, input.parse(i)),
  };
}
export const registry = [
  operation(
    "doc.apply",
    z.object({
      doc: z.string(),
      base: z.string(),
      view: z.literal("full").default("full"),
      text: z.string(),
      mode: z.enum(["direct", "propose"]),
      by: authorSchema,
    }),
    true,
    ["apply"],
    (a, i) => a.change(i.doc, (d) => apply(d, i)),
  ),
  operation(
    "alt.propose",
    z.object({
      doc: z.string(),
      at: selectionSchema,
      versions: z.array(z.string()).min(1),
      by: authorSchema,
    }),
    true,
    ["alt", "propose"],
    (a, i) => a.change(i.doc, (d) => propose(d, i.at, i.versions, i.by)),
  ),
  operation(
    "alt.flip",
    z.object({
      doc: z.string(),
      alt: z.string(),
      to: z.union([z.number().int().nonnegative(), z.enum(["next", "prev"])]),
    }),
    true,
    ["alt", "flip"],
    (a, i) => a.change(i.doc, (d) => flip(d, i.alt, i.to)),
  ),
  operation(
    "alt.resolve",
    z.object({ doc: z.string(), alt: z.string(), rest: z.literal("stash") }),
    true,
    ["alt", "resolve"],
    (a, i) => a.change(i.doc, (d) => resolve(d, i.alt)),
  ),
  operation("stash.list", z.object({ doc: z.string() }), false, ["stash", "list"], (a, i) =>
    stashList(a.get(i.doc)),
  ),
  operation("export", z.object({ doc: z.string(), to: z.string() }), true, ["preview"], (a, i) =>
    preview(a, i.doc, i.to),
  ),
  operation("doc.create", z.object({ slug }), true, ["new", "post"], (a, i) =>
    a.create(i.slug, createPost(i.slug)),
  ),
  operation("doc.read", z.object({ doc: z.string() }), false, ["cat"], (a, i) => inspect(a, i.doc)),
  operation(
    "component.create",
    z.object({ id, kind: z.enum(["inline", "block"]) }),
    true,
    ["component", "create"],
    (a, i) => a.create(i.id, createComponent(i.id, componentTemplate(i.kind))),
  ),
  operation("component.read", z.object({ id }), false, ["component", "read"], (a, i) =>
    readFiles(a.get(i.id)),
  ),
  operation(
    "component.write",
    z.object({
      id,
      base: z.string(),
      files: z.record(
        z.string().refine((p) => {
          try {
            safePath(p);
            return true;
          } catch {
            return false;
          }
        }),
        z.string(),
      ),
    }),
    true,
    ["component", "write"],
    async (a, i) => {
      const result = await a.change(i.id, (doc) => writeFiles(doc, i.base, i.files));
      await refreshPreviews(a, i.id);
      return result;
    },
  ),
  operation(
    "deps.add",
    z.object({
      doc: z.string(),
      tag: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
      component: id,
      version: z.literal("dev"),
    }),
    true,
    ["deps", "add"],
    (a, i) => a.change(i.doc, (doc) => addDependency(doc, i.tag, i.component)),
  ),
];
export function bind(a: Authority) {
  return (name: string, input: unknown, session?: string) =>
    a.serialize(async () => {
      const op = registry.find((op) => op.name === name);
      if (!op) throw new Error(`Unknown operation: ${name}`);
      const parsed = op.input.parse(input);
      const request =
        parsed &&
        typeof parsed === "object" &&
        "request" in parsed &&
        typeof parsed.request === "string"
          ? parsed.request
          : undefined;
      const execute = async () =>
        op.mutation
          ? a.transaction(request, payloadHash(name, parsed), async () => op.run(a, parsed))
          : op.run(a, parsed);
      return session && op.mutation ? a.sessionOperation(session, execute) : execute();
    });
}

export function undoSession(a: Authority, session: string) {
  return a.serialize(() =>
    a.undo(session, async (ids) => {
      for (const id of ids) {
        const doc = a.documents.get(id);
        if (doc?.getMap("meta").get("kind") === "component" && !doc.getMap("meta").get("deleted"))
          await refreshPreviews(a, id);
      }
    }),
  );
}
