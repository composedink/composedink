import type { IncomingMessage, ServerResponse } from "node:http";

/** An error answered as `{error: "<Code>: message"}` with its status. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, body?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Splits the raw path on `/` and only then decodes each segment, so an encoded `/` (a component id
 * `composed%3Ascope%2Fname`) stays inside one segment. The first element is always "".
 */
export function segments(url: string | undefined) {
  const path = (url ?? "/").split("?")[0];
  try {
    return path.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    throw new HttpError(400, "BadRequest", "malformed path");
  }
}

export const query = (url: string | undefined) =>
  new URL(url ?? "/", "http://localhost").searchParams;

/** Reads a request body, answering 413 as soon as it exceeds `limit` bytes. */
export async function readBody(req: IncomingMessage, limit: number) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw tooLarge(req, limit);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw tooLarge(req, limit);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function tooLarge(req: IncomingMessage, limit: number) {
  // Drain the rest so the client can read the answer instead of a reset connection.
  req.resume();
  return new HttpError(413, "TooLarge", `body exceeds ${limit} bytes`);
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "BadRequest", "body is not JSON");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Answers any thrown error: HttpError keeps its status, anything else is a 500. */
export function sendError(res: ServerResponse, error: unknown) {
  if (error instanceof HttpError)
    return sendJson(res, error.status, { ...error.body, error: error.message });
  console.error(error);
  sendJson(res, 500, { error: "Internal: unexpected server error" });
}

export const bearer = (req: IncomingMessage) => {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
  return match?.[1];
};
