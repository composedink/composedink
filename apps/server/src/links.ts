import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { decodeFrontiers } from "loro-crdt";
import { transaction } from "./db.ts";
import { HttpError, query, readJson, sendJson } from "./http.ts";
import type { Device } from "./auth.ts";
import type { Replicas } from "./replicas.ts";

const MiB = 1024 * 1024;
/** A link with its render snapshot: the instances can be as large as a document snapshot. */
const CREATE_LIMIT = 64 * MiB;
export const sha256 = (value: string) => createHash("sha256").update(value).digest();

export interface Question {
  id: string;
  text: string;
}
export interface LinkRow {
  link_id: string;
  account_id: string;
  doc_id: string;
  mode: "pinned" | "live";
  frontiers: string | null;
  questions: string;
  guests_may_comment: number;
  expires_at: number | null;
  revoked_at: number | null;
  created_at: number;
}
const notFound = (what: string) => new HttpError(404, "NotFound", `no ${what}`);
const bad = (message: string) => new HttpError(400, "BadRequest", message);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function parseCreate(body: unknown) {
  if (!isRecord(body)) throw bad("expected a JSON object");
  const { linkId, docId, mode, frontiers, questions, expiresAt, instances } = body;
  if (typeof linkId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(linkId))
    throw bad("linkId is 1 to 64 URL-safe characters");
  if (typeof docId !== "string" || !docId) throw bad("docId is a string");
  if (mode !== "pinned" && mode !== "live") throw bad('mode is "pinned" or "live"');
  if (mode === "pinned" ? typeof frontiers !== "string" || !frontiers : frontiers !== undefined)
    throw bad("a pinned link has frontiers and a live link has none");
  if (
    !Array.isArray(questions) ||
    !questions.every((q) => isRecord(q) && typeof q.id === "string" && typeof q.text === "string")
  )
    throw bad("questions is an array of {id, text}");
  if (expiresAt !== undefined && !Number.isSafeInteger(expiresAt))
    throw bad("expiresAt is a time in milliseconds");
  if (!isRecord(instances) || !Object.values(instances).every((m) => typeof m === "string"))
    throw bad("instances maps render keys to Markdown");
  return {
    linkId,
    docId,
    mode,
    frontiers: frontiers as string | undefined,
    questions: (questions as Question[]).map((q) => ({ id: q.id, text: q.text })),
    expiresAt: expiresAt as number | undefined,
    instances: instances as Record<string, string>,
  };
}

/**
 * Shared preview links. Management routes live under `/sync` (device-authenticated); `/s` pages
 * authenticate by link token alone. Only the SHA-256 of a link token is stored.
 */
export function links(db: DatabaseSync, replica: Replicas) {
  const owner = (docId: string) =>
    (
      db.prepare("SELECT account_id FROM docs WHERE doc_id = ?").get(docId) as
        | { account_id: string }
        | undefined
    )?.account_id;

  async function create(device: Device, req: IncomingMessage) {
    const input = parseCreate(await readJson(req, CREATE_LIMIT));
    // The authority syncs before it shares: an unsynced or foreign document does not exist here.
    if (owner(input.docId) !== device.accountId) throw notFound(`synced document ${input.docId}`);
    if (input.frontiers !== undefined) {
      try {
        replica.get(input.docId).forkAt(decodeFrontiers(Buffer.from(input.frontiers, "base64url")));
      } catch {
        throw new HttpError(409, "Conflict", "the server has not synced these frontiers yet");
      }
    }
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    transaction(db, () => {
      if (db.prepare("SELECT 1 FROM links WHERE link_id = ?").get(input.linkId))
        throw new HttpError(409, "Conflict", `link ${input.linkId} exists`);
      db.prepare(
        `INSERT INTO links (link_id, account_id, doc_id, token_hash, mode, frontiers, questions,
           guests_may_comment, expires_at, created_at, created_by_device)
         VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
      ).run(
        input.linkId,
        device.accountId,
        input.docId,
        sha256(token),
        input.mode,
        input.frontiers ?? null,
        JSON.stringify(input.questions),
        input.expiresAt ?? null,
        now,
        device.deviceId,
      );
      db.prepare("INSERT INTO render_snapshots (link_id, instances, at) VALUES (?,?,?)").run(
        input.linkId,
        JSON.stringify(input.instances),
        now,
      );
    });
    return { linkId: input.linkId, token };
  }

  function list(device: Device, docId: string | null) {
    if (!docId) throw bad("doc is required");
    const account = owner(docId);
    if (account !== undefined && account !== device.accountId) throw notFound(`document ${docId}`);
    const rows = db
      .prepare(
        "SELECT * FROM links WHERE doc_id = ? AND account_id = ? ORDER BY created_at, link_id",
      )
      .all(docId, device.accountId) as unknown as LinkRow[];
    return {
      links: rows.map((r) => ({
        linkId: r.link_id,
        mode: r.mode,
        questions: JSON.parse(r.questions) as Question[],
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
      })),
    };
  }

  function revoke(device: Device, linkId: string) {
    const row = db
      .prepare("SELECT revoked_at FROM links WHERE link_id = ? AND account_id = ?")
      .get(linkId, device.accountId) as { revoked_at: number | null } | undefined;
    if (!row) throw notFound(`link ${linkId}`);
    const revokedAt = row.revoked_at ?? Date.now();
    db.prepare("UPDATE links SET revoked_at = ? WHERE link_id = ?").run(revokedAt, linkId);
    return { linkId, revokedAt };
  }

  /** `/sync/links...` for an authenticated device. */
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    parts: string[],
    device: Device,
  ) {
    const [, , , linkId, action, ...rest] = parts;
    if (parts.length === 3 && req.method === "POST")
      return sendJson(res, 201, await create(device, req));
    if (parts.length === 3 && req.method === "GET")
      return sendJson(res, 200, list(device, query(req.url).get("doc")));
    if (linkId && action === "revoke" && !rest.length && req.method === "POST")
      return sendJson(res, 200, revoke(device, linkId));
    throw new HttpError(404, "NotFound", "no such route");
  }

  /** The link behind a token while it is usable: unknown, revoked and expired are all undefined. */
  function active(token: string, now = Date.now()) {
    const row = db.prepare("SELECT * FROM links WHERE token_hash = ?").get(sha256(token)) as
      | LinkRow
      | undefined;
    if (!row || row.revoked_at !== null) return undefined;
    if (row.expires_at !== null && row.expires_at <= now) return undefined;
    return row;
  }

  /** The render snapshot uploaded with the link: `{[renderKey]: markdown}`. */
  function instances(linkId: string) {
    const row = db
      .prepare("SELECT instances FROM render_snapshots WHERE link_id = ?")
      .get(linkId) as { instances: string } | undefined;
    return row ? (JSON.parse(row.instances) as Record<string, string>) : {};
  }

  return { handle, active, instances };
}
export type Links = ReturnType<typeof links>;
