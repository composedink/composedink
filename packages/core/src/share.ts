import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Authority } from "./authority.ts";
import { evaluateUses } from "./export.ts";
import { exportStrip, removeRanges, resolveKind, stripRanges } from "./kinds.ts";
import {
  addRecipient,
  createRequest,
  feedbackRequest,
  feedbackRequests,
  type Question,
} from "./model/feedback.ts";
import { project } from "./model/projection.ts";
import { head } from "./model/read.ts";
import { renderKey } from "./model/render-key.ts";
import type { Author } from "./model/selection.ts";
import { snippet } from "./model/stash.ts";
import { isPost } from "./model/text.ts";
import { validateProjection } from "./model/validate.ts";
import { requireSession, serverJson } from "./session.ts";
import { indexState, readState } from "./store/recovery.ts";

export const shareCreateInput = z.object({
  id: z.string().min(1),
  mode: z.enum(["pinned", "live"]).default("pinned"),
  questions: z.array(z.string().min(1)).min(1).optional(),
  expiresIn: z
    .string()
    .regex(/^\d+[hd]$/)
    .optional(),
});
export type ShareCreateInput = z.infer<typeof shareCreateInput>;
interface ServerLink {
  linkId: string;
  mode: "pinned" | "live";
  questions: Question[];
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}
const linksPath = (id: string) => `/sync/links?doc=${encodeURIComponent(id)}`;
const noQuestions =
  "InvalidInvariant: kind has no feedback questions; fix: pass --question or add questions to kind.json";

/**
 * The render snapshot a link page uses for block usages: the clean projection with the kind's
 * `export.strip` applied, validated, and every composed usage evaluated as preview export does.
 * Keys are `renderKey(tag, attributes)`, which the server computes from its own parse.
 */
export async function renderSnapshot(a: Authority, id: string) {
  const doc = a.get(id);
  const projected = project(doc, "clean");
  const text = removeRanges(
    projected.text,
    stripRanges(projected.text, await exportStrip(a.store.home, doc)),
  );
  const ast = validateProjection(text, snippet(doc, 0, doc.getText("mdx").length).dim);
  const { uses } = await evaluateUses(a, id, ast, "preview");
  const instances: Record<string, string> = {};
  for (const use of uses) instances[renderKey(use.tag, use.node.attributes)] = use.markdown;
  return { instances };
}

/** The server's links for a document; each gains its URL when this device created it. */
export async function listLinks(home: string, id: string) {
  const { links } = (await serverJson(home, linksPath(id))) as { links: ServerLink[] };
  return {
    links: links.map((link) => {
      const local = readState(home, "link", link.linkId);
      return local ? { ...link, url: (JSON.parse(local) as { url: string }).url } : link;
    }),
  };
}

/** Link ids that are neither revoked nor expired. */
export async function activeLinks(home: string, id: string) {
  const now = Date.now();
  const { links } = (await serverJson(home, linksPath(id))) as { links: ServerLink[] };
  return new Set(
    links
      .filter((l) => l.revokedAt === null && (l.expiresAt === null || l.expiresAt > now))
      .map((l) => l.linkId),
  );
}

export async function revokeLink(home: string, link: string) {
  const result = (await serverJson(home, `/sync/links/${encodeURIComponent(link)}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  })) as { linkId: string; revokedAt: number };
  return { link: result.linkId, revokedAt: result.revokedAt };
}

/**
 * share.create: sync, record the link's request and (pinned) frontiers with the render snapshot in
 * one queued step, sync again so the server replica has the request, then create the link. Not a
 * receipt mutation: a lost answer is retried by creating another link, since tokens are never
 * recoverable.
 */
export async function createShare(a: Authority, input: ShareCreateInput, by: Author) {
  const session = await requireSession(a.store.home);
  if (!a.sync)
    throw Error(
      "StudioRequired: sharing syncs first, inside composed studio; fix: composed studio",
    );
  if (!isPost(a.get(input.id))) throw Error(`InvalidInvariant: ${input.id} is not a post`);
  await a.sync.now(input.id);
  const link = randomUUID();
  const recipient = `link:${link}` as const;
  const captured = await a.serialize(async () => {
    const doc = a.get(input.id);
    const pending = feedbackRequests(doc)
      .filter((r) => r.state.status === "pending")
      .sort((x, y) => y.at - x.at)[0];
    let questions = input.questions;
    if (!questions && !pending) {
      questions = (await resolveKind(a.store.home, String(doc.getMap("meta").get("kind")))).kind
        .config.questions;
      if (!questions.length) throw Error(noQuestions);
    }
    const request = questions ? randomUUID() : pending!.id;
    await a.transaction(undefined, "share-create", () =>
      a.change(input.id, (d) =>
        questions
          ? createRequest(d, { by, questions, to: [recipient] }, request)
          : addRecipient(d, request, recipient),
      ),
    );
    const current = a.get(input.id);
    return {
      request,
      questions: feedbackRequest(current, request).questions,
      frontiers: input.mode === "pinned" ? head(current) : undefined,
      snapshot: await renderSnapshot(a, input.id),
    };
  });
  await a.sync.now(input.id);
  const expiresAt = input.expiresIn
    ? Date.now() +
      Number(input.expiresIn.slice(0, -1)) *
        (input.expiresIn.endsWith("h") ? 3_600_000 : 86_400_000)
    : undefined;
  const created = (await serverJson(a.store.home, "/sync/links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      linkId: link,
      docId: input.id,
      mode: input.mode,
      ...(captured.frontiers ? { frontiers: captured.frontiers } : {}),
      questions: captured.questions,
      ...(expiresAt ? { expiresAt } : {}),
      instances: captured.snapshot.instances,
    }),
  })) as { linkId: string; token: string };
  const url = `${session.server}/s/${created.token}`;
  indexState(a.store.home, "link", link, JSON.stringify({ url, doc: input.id }));
  return {
    link,
    url,
    mode: input.mode,
    ...(expiresAt ? { expiresAt } : {}),
    request: captured.request,
    questions: captured.questions,
  };
}
