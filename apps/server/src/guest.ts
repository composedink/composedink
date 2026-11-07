import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { randomUUID } from "node:crypto";
import {
  hasQuestion,
  head,
  isPost,
  openThread,
  replyThread,
  threadViews,
} from "@composedink/core/model";
import { HttpError, readJson, sendJson } from "./http.ts";
import type { LinkRow } from "./links.ts";
import type { Replicas } from "./replicas.ts";
import type { Append } from "./sync.ts";

export const GUEST_COOKIE = "composed_guest";
const YEAR_SECONDS = 31_536_000;
const bad = (message: string) => new HttpError(400, "BadRequest", message);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validName = (name: string) => name.length >= 1 && name.length <= 60;

/** The guest's display name from the link-scoped cookie, if it holds a valid one. */
export function guestName(req: IncomingMessage) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== GUEST_COOKIE) continue;
    try {
      const name = decodeURIComponent(value.join("="));
      return validName(name) ? name : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const text = (value: unknown, field: string, max: number) => {
  if (typeof value !== "string" || value.length < 1 || value.length > max)
    throw bad(`${field} must be 1 to ${max} characters`);
  return value;
};

/**
 * Guest writes on a link: threads and replies applied to the live replica with the model code the
 * authority uses, by `{kind: "guest", name, linkId}`, then stored through the relay's append path
 * (no device) so the author's devices receive them as ordinary sync.
 */
export function guests(replica: Replicas, append: Append) {
  /** JSON from this page only: `Content-Type: application/json` and an `Origin` whose host is `Host`. */
  function sameOrigin(req: IncomingMessage) {
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    let origin: string | undefined;
    try {
      origin = req.headers.origin ? new URL(req.headers.origin).host : undefined;
    } catch {
      origin = undefined;
    }
    if (type !== "application/json" || !origin || origin !== req.headers.host)
      throw new HttpError(403, "Forbidden", "comments come from the shared page");
  }

  /**
   * The cookie's name, else the body's (the first comment carries it). `remember` sets the
   * link-scoped cookie once the write has landed.
   */
  function author(
    req: IncomingMessage,
    link: LinkRow,
    token: string,
    body: Record<string, unknown>,
  ) {
    const by = (name: string) => ({ kind: "guest" as const, name, linkId: link.link_id });
    const cookie = guestName(req);
    if (cookie) return { by: by(cookie), remember: () => {} };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!validName(name)) throw bad("name must be 1 to 60 characters");
    const secure =
      req.headers["x-forwarded-proto"] === "https" || (req.socket as TLSSocket).encrypted === true;
    return {
      by: by(name),
      remember: (res: ServerResponse) =>
        res.setHeader(
          "Set-Cookie",
          `${GUEST_COOKIE}=${encodeURIComponent(name)}; Path=/s/${token}; HttpOnly; SameSite=Strict; Max-Age=${YEAR_SECONDS}${secure ? "; Secure" : ""}`,
        ),
    };
  }

  /** Applies `write` to the live replica and appends the resulting update with no device. */
  function commit<T>(link: LinkRow, write: (doc: ReturnType<Replicas["get"]>) => T) {
    const doc = replica.get(link.doc_id);
    const before = doc.oplogVersion();
    const result = write(doc);
    append(link.doc_id, link.account_id, null, doc.export({ mode: "update", from: before }));
    return result;
  }
  const view = (link: LinkRow, thread: string) => {
    const found = threadViews(replica.get(link.doc_id)).find((t) => t.thread === thread);
    if (!found) throw new HttpError(404, "NotFound", "no such thread");
    return { thread: found.thread, state: found.state, messages: found.messages };
  };

  async function open(req: IncomingMessage, res: ServerResponse, link: LinkRow, token: string) {
    const body = await readJson(req);
    if (!isRecord(body)) throw bad("expected a JSON object");
    const quote = text(body.quote, "quote", 2000);
    const message = text(body.text, "text", 4000);
    if (body.question !== undefined && typeof body.question !== "string")
      throw bad("question is a question id");
    const question = body.question as string | undefined;
    const doc = replica.get(link.doc_id);
    if (!isPost(doc)) throw new HttpError(404, "NotFound", "no such page");
    if (question !== undefined && !hasQuestion(doc, question))
      throw bad(`UnknownQuestion: ${question} is not a question of this page`);
    const { by, remember } = author(req, link, token, body);
    // A pinned link still comments against the live replica, anchored by quote.
    const thread = commit(link, (d) => {
      try {
        return openThread(
          d,
          { base: head(d), quote, view: "clean" },
          { text: message, by, question },
          randomUUID(),
          { detachedIfMissing: true },
        );
      } catch (error) {
        if (error instanceof Error && error.message === "AmbiguousQuote")
          throw new HttpError(409, "AmbiguousQuote", "select a longer passage");
        throw bad(error instanceof Error ? error.message : String(error));
      }
    });
    remember(res);
    return view(link, thread);
  }

  async function reply(
    req: IncomingMessage,
    res: ServerResponse,
    link: LinkRow,
    token: string,
    thread: string,
  ) {
    const body = await readJson(req);
    if (!isRecord(body)) throw bad("expected a JSON object");
    const message = text(body.text, "text", 4000);
    // Only threads started from this link: any other thread does not exist here.
    const first = threadViews(replica.get(link.doc_id)).find((t) => t.thread === thread)
      ?.messages[0]?.by;
    if (first?.kind !== "guest" || first.linkId !== link.link_id)
      throw new HttpError(404, "NotFound", "no such thread");
    const { by, remember } = author(req, link, token, body);
    commit(link, (d) => replyThread(d, thread, { by, text: message }));
    remember(res);
    return view(link, thread);
  }

  /** `POST /s/<token>/threads` and `POST /s/<token>/threads/:thread/replies` for an active link. */
  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    parts: string[],
    link: LinkRow,
  ) {
    const [, , token, route, thread, action, ...rest] = parts;
    if (req.method !== "POST" || route !== "threads" || rest.length)
      throw new HttpError(404, "NotFound", "no such route");
    if (thread === undefined) {
      sameOrigin(req);
      return sendJson(res, 201, await open(req, res, link, token));
    }
    if (thread && action === "replies") {
      sameOrigin(req);
      return sendJson(res, 201, await reply(req, res, link, token, thread));
    }
    throw new HttpError(404, "NotFound", "no such route");
  };
}
export type Guests = ReturnType<typeof guests>;
