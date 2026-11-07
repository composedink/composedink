import { rememberedDestination } from "../store/intents.ts";
import { publish } from "../publish.ts";
import { importFile } from "../import.ts";
import { realpath } from "node:fs/promises";
import { dirname, basename } from "node:path";
import { checkComponent } from "../component/check.ts";
import { loadRewriteConfig, rewriteProvider, rewriteCount } from "../rewrite.ts";
import { select } from "../model/selection.ts";
import { lint } from "./lint.ts";
import { apply } from "../model/apply.ts";
import { propose, flip, resolve } from "../model/alternatives.ts";
import { ghost } from "../model/marks.ts";
import { cut, restore, stashList } from "../model/stash.ts";
import { authorSchema, selectionSchema, type Author } from "../model/selection.ts";
import {
  openThread,
  replyThread,
  resolveThread,
  threadState,
  threadViews,
} from "../model/threads.ts";
import { feedbackRequest, hasQuestion } from "../model/feedback.ts";
import { createFeedback, feedbackInput, requestFeedback } from "../feedback.ts";
import { inspect } from "../inspect.ts";
import { payloadHash } from "../store/receipts.ts";
import { preview, refreshPreviews } from "../export.ts";
import { z } from "zod";
import type { Authority } from "../authority.ts";
import { createPost, isPost, setKind } from "../model/text.ts";
import {
  creation,
  documentSettings,
  effectiveRules,
  kindExists,
  kindFiles,
  kindId,
  KIND_FILES,
  listKinds,
  loadKind,
  writeKindFile,
} from "../kinds.ts";
import { createComponent, readFiles, writeFiles, safePath } from "../model/files.ts";
import { pinDependency, addDependency } from "../model/deps.ts";
import { componentTemplate } from "../model/component-template.ts";
import { login, requireSession, serverJson, sessionStatus, signOut } from "../session.ts";
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const id = z.string().regex(/^composed:[a-z0-9-]+\/[a-z0-9-]+$/);
/**
 * Who is acting, supplied by the adapter (studio human, CLI/MCP agent, model review). It labels
 * thread messages and requests; it is never an input and grants no capability.
 */
export type Context = { by: Author };
function operation<S extends z.ZodType>(
  name: string,
  input: S,
  mutation: boolean,
  cli: readonly string[],
  run: (a: Authority, i: z.output<S>, context: Context) => unknown,
) {
  const schema = mutation
    ? z.intersection(input, z.object({ request: z.string().min(1).optional() }))
    : input;
  return {
    name,
    input: schema,
    mutation,
    cli,
    run: (a: Authority, i: unknown, context: Context) => run(a, input.parse(i), context),
  };
}
export const registry = [
  operation(
    "component.publish",
    z.object({ id, bump: z.enum(["patch", "minor", "major"]) }),
    true,
    ["component", "publish"],
    (a, i) => publish(a, i.id, i.bump),
  ),
  operation(
    "deps.pin",
    z.object({
      doc: z.string(),
      tag: z.string(),
      version: z.string().regex(/^(dev|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/),
    }),
    true,
    ["deps", "pin"],
    (a, i) => a.change(i.doc, (d) => pinDependency(d, i.tag, i.version)),
  ),
  operation(
    "doc.import",
    z.object({ doc: z.string(), file: z.string() }),
    true,
    ["import"],
    async (a, i) => {
      a.claimTarget(await realpath(dirname(i.file)));
      if (basename(i.file) !== "index.mdx")
        throw Error("RecoveryRequired: import requires exported index.mdx");
      return importFile(a, i.doc, dirname(i.file));
    },
  ),

  operation("component.check", z.object({ id }), false, ["component", "check"], (a, i) =>
    checkComponent(a.store.home, i.id, readFiles(a.get(i.id)).files),
  ),
  operation(
    "alt.rewrite",
    z.object({
      doc: z.string(),
      at: selectionSchema,
      instruction: z.string().optional(),
      count: rewriteCount,
    }),
    true,
    ["alt", "rewrite"],
    (a, i) => performRewrite(a, i),
  ),
  operation("lint", z.object({ doc: z.string() }), false, ["lint"], (a, i) => lint(a, i.doc)),
  operation(
    "ghost.set",
    z.object({ doc: z.string(), at: selectionSchema, dim: z.boolean() }),
    true,
    ["ghost", "set"],
    (a, i) => a.change(i.doc, (d) => ghost(d, i.at, i.dim)),
  ),
  operation(
    "stash.add",
    z.object({ doc: z.string(), at: selectionSchema }),
    true,
    ["stash", "add"],
    (a, i) => a.change(i.doc, (d) => cut(d, i.at)),
  ),
  operation(
    "stash.restore",
    z.object({ doc: z.string(), item: z.string(), at: selectionSchema }),
    true,
    ["stash", "restore"],
    (a, i) => a.change(i.doc, (d) => restore(d, i.item, i.at)),
  ),
  operation(
    "doc.apply",
    z.object({
      doc: z.string(),
      base: z.string(),
      view: z.enum(["full", "clean"]).default("full"),
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
    z.object({ doc: z.string(), alt: z.string(), rest: z.enum(["stash", "ghost"]) }),
    true,
    ["alt", "resolve"],
    (a, i) => a.change(i.doc, (d) => resolve(d, i.alt, i.rest)),
  ),
  operation("stash.list", z.object({ doc: z.string() }), false, ["stash", "list"], (a, i) =>
    stashList(a.get(i.doc)),
  ),
  operation(
    "export",
    z.object({
      doc: z.string(),
      to: z.string().optional(),
      view: z.enum(["full", "clean"]),
      mode: z.enum(["release", "preview"]).default("preview"),
    }),
    true,
    ["preview"],
    async (a, i) =>
      preview(a, i.doc, i.to ?? (await rememberedDestination(a.store.home, i.doc)), i.view, i.mode),
  ),
  operation(
    "doc.create",
    z.object({ slug, kind: kindId.default("post") }),
    true,
    ["new", "post"],
    async (a, i) => a.create(i.slug, createPost(i.slug, await creation(a.store.home, i.kind))),
  ),
  operation(
    "doc.kind",
    z.object({ id: z.string(), kind: kindId }),
    true,
    ["doc", "kind"],
    async (a, i) => {
      if (!(await kindExists(a.store.home, i.kind)))
        throw Error(`UnknownKind: ${i.kind}; fix: composed kind list`);
      await loadKind(a.store.home, i.kind);
      await effectiveRules(a.store.home, i.kind);
      await a.change(i.id, (d) => setKind(d, i.kind));
      return { kind: i.kind };
    },
  ),
  operation("kind.list", z.object({}), false, ["kind", "list"], (a) => listKinds(a.store.home)),
  operation(
    "thread.open",
    z.object({
      id: z.string(),
      base: z.string(),
      quote: z.string().min(1),
      text: z.string().min(1),
      question: z.string().optional(),
    }),
    true,
    ["thread", "open"],
    (a, i, c) =>
      a.change(i.id, (d) => {
        if (!isPost(d)) throw Error(`InvalidInvariant: ${i.id} is not a post`);
        if (i.question !== undefined && !hasQuestion(d, i.question))
          throw Error(`UnknownQuestion: ${i.question} is not a question of a request in ${i.id}`);
        const thread = openThread(
          d,
          { base: i.base, quote: i.quote },
          { text: i.text, by: c.by, question: i.question },
        );
        return { thread };
      }),
  ),
  operation(
    "thread.reply",
    z.object({ id: z.string(), thread: z.string(), text: z.string().min(1) }),
    true,
    ["thread", "reply"],
    (a, i, c) =>
      a.change(i.id, (d) => ({
        thread: i.thread,
        state: replyThread(d, i.thread, { by: c.by, text: i.text }),
      })),
  ),
  operation(
    "thread.resolve",
    z.object({ id: z.string(), thread: z.string() }),
    true,
    ["thread", "resolve"],
    (a, i) => a.change(i.id, (d) => ({ thread: i.thread, state: resolveThread(d, i.thread) })),
  ),
  operation(
    "thread.list",
    z.object({ id: z.string(), state: threadState.optional() }),
    false,
    ["thread", "list"],
    (a, i) => threadViews(a.get(i.id), i.state),
  ),
  operation("feedback.request", feedbackInput, true, ["feedback", "request"], (a, i, c) =>
    createFeedback(a, i, c.by),
  ),
  operation(
    "feedback.answers",
    z.object({ id: z.string(), request: z.string() }),
    false,
    ["feedback", "answers"],
    (a, i) => {
      const { questions, state } = feedbackRequest(a.get(i.id), i.request);
      return { request: i.request, questions, state };
    },
  ),
  operation("kind.read", z.object({ kind: kindId }), false, ["kind", "read"], (a, i) =>
    kindFiles(a.store.home, i.kind),
  ),
  operation(
    "kind.write",
    z.object({ kind: kindId, file: z.enum(KIND_FILES), text: z.string(), base: z.string() }),
    true,
    ["kind", "write"],
    (a, i) => writeKindFile(a, i.kind, i.file, i.text, i.base),
  ),
  operation(
    "rules.effective",
    z.object({ id: z.string() }),
    false,
    ["rules", "effective"],
    (a, i) => {
      if (!isPost(a.get(i.id))) throw Error(`InvalidInvariant: ${i.id} is not a post`);
      return documentSettings(a.store.home, a.get(i.id));
    },
  ),
  operation(
    "doc.read",
    z.object({ doc: z.string(), view: z.enum(["full", "clean"]).default("full") }),
    false,
    ["cat"],
    (a, i) => inspect(a, i.doc, i.view),
  ),
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
      const diagnostics = await refreshPreviews(a, i.id);
      return { ...result, diagnostics };
    },
  ),
  operation(
    "session.login",
    z
      .object({
        server: z.url({ protocol: /^https?$/ }),
        code: z.string().min(1).optional(),
        bootstrap: z.string().min(1).optional(),
        deviceName: z.string().min(1).max(64).optional(),
      })
      .refine((i) => (i.code === undefined) !== (i.bootstrap === undefined), {
        message: "pass exactly one of code or bootstrap",
      }),
    false,
    ["login"],
    async (a, i) => {
      const status = await login(a.store.home, i);
      await a.sync?.start();
      return status;
    },
  ),
  operation("session.logout", z.object({}), false, ["logout"], async (a) => {
    await signOut(a.store.home);
    await a.sync?.stop();
    return sessionStatus(a.store.home);
  }),
  operation("session.status", z.object({}), false, ["status"], (a) => sessionStatus(a.store.home)),
  operation("devices.pair", z.object({}), false, ["devices", "pair"], (a) =>
    serverJson(a.store.home, "/auth/pair", { method: "POST" }),
  ),
  operation("devices.list", z.object({}), false, ["devices", "list"], (a) =>
    serverJson(a.store.home, "/auth/devices"),
  ),
  operation(
    "devices.revoke",
    z.object({ device: z.string().min(1) }),
    false,
    ["devices", "revoke"],
    async (a, i) => {
      const session = await requireSession(a.store.home);
      const result = await serverJson(
        a.store.home,
        `/auth/devices/${encodeURIComponent(i.device)}`,
        { method: "DELETE" },
      );
      // Revoking this device signs out here at once.
      if (i.device === session.deviceId) {
        await signOut(a.store.home);
        await a.sync?.stop();
      }
      return result;
    },
  ),
  operation(
    "sync.now",
    z.object({ id: z.string().min(1).optional() }),
    false,
    ["sync"],
    async (a, i) => {
      await requireSession(a.store.home);
      if (!a.sync)
        throw Error("StudioRequired: sync runs inside composed studio; fix: composed studio");
      return a.sync.now(i.id);
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
const pendingRewrites = new WeakMap<
  Authority,
  Map<string, { hash: string; work: Promise<unknown> }>
>();
async function performRewrite(
  a: Authority,
  i: {
    doc: string;
    at: import("zod").infer<typeof selectionSchema>;
    instruction?: string;
    count: number;
  },
  signal?: AbortSignal,
  commit: (run: () => Promise<unknown>) => Promise<unknown> = (run) => a.serialize(run),
) {
  const text = await a.serialize(async () => {
    const { fork, from, to } = select(a.get(i.doc), i.at);
    if (from === to) throw Error("InvalidInvariant: select text to rewrite");
    return fork.getText("mdx").toString().slice(from, to);
  });
  const config = await loadRewriteConfig(a.store.home);
  const { versions } = await rewriteProvider(
    config,
    { text, instruction: i.instruction, count: i.count },
    signal,
  );
  return commit(async () => {
    if (signal?.aborted) throw Error("ProviderFailed: cancelled; fix: retry the rewrite");
    return a.change(i.doc, (d) =>
      propose(d, i.at, versions, { kind: "model", model: config.model }),
    );
  });
}
const unqueued = new Set([
  "session.login",
  "session.logout",
  "session.status",
  "devices.pair",
  "devices.list",
  "devices.revoke",
  "sync.now",
]);
export function bind(a: Authority) {
  return async (
    name: string,
    input: unknown,
    session?: string,
    signal?: AbortSignal,
    by: Author = { kind: "agent", name: "cli" },
  ) => {
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
    const hash = payloadHash(name, parsed);
    const commit = (run: () => Promise<unknown>) =>
      a.serialize(async () => {
        const execute = async () => (op.mutation ? a.transaction(request, hash, run) : run());
        return session && op.mutation && name !== "component.publish"
          ? a.sessionOperation(session, execute)
          : execute();
      });
    // Session, device and sync operations change no document; sync pulls serialize their own
    // transactions.
    if (unqueued.has(name)) return op.run(a, parsed, { by });
    // Model review awaits the provider outside the queue; it is not a session-undo item.
    if (name === "feedback.request")
      return requestFeedback(a, feedbackInput.parse(parsed), { by, signal, request, hash });
    if (name !== "alt.rewrite") return commit(async () => op.run(a, parsed, { by }));
    const prior = await a.serialize(async () =>
      request ? a.store.journal.lookup(request, hash) : undefined,
    );
    if (prior) return prior.result;
    const i = z
      .object({
        doc: z.string(),
        at: selectionSchema,
        instruction: z.string().optional(),
        count: rewriteCount,
      })
      .parse(parsed);
    let pending = pendingRewrites.get(a);
    if (!pending) {
      pending = new Map();
      pendingRewrites.set(a, pending);
    }
    if (request) {
      const same = pending.get(request);
      if (same) {
        if (same.hash !== hash) throw Error("RequestConflict: different rewrite payload");
        return same.work;
      }
    }
    const work = performRewrite(a, i, signal, commit);
    if (request) pending.set(request, { hash, work });
    try {
      return await work;
    } finally {
      if (request) pending.delete(request);
    }
  };
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
