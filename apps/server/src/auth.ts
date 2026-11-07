import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { transaction } from "./db.ts";
import { HttpError, bearer, readJson, sendJson } from "./http.ts";
import type { EventHub } from "./events.ts";

export interface Device {
  deviceId: string;
  accountId: string;
  name: string;
}
const sha256 = (value: string) => createHash("sha256").update(value).digest();
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAIRING_MS = 10 * 60 * 1000;
const SEEN_MS = 60 * 1000;
const FAILURES_PER_MINUTE = 10;
const unauthorized = (message = "invalid or revoked device token") =>
  new HttpError(401, "Unauthorized", message);
/** Pairing codes hash as upper case without hyphens: `abcd-efgh` and `ABCDEFGH` are one code. */
export const normalizeCode = (code: string) => code.toUpperCase().replaceAll("-", "");

export function auth(db: DatabaseSync, events: EventHub, bootstrap: string | undefined) {
  const failures: number[] = [];
  const limited = (now: number) => {
    while (failures.length && failures[0] <= now - 60_000) failures.shift();
    return failures.length >= FAILURES_PER_MINUTE;
  };

  /** The device behind `Authorization: Bearer`; 401 when unknown or revoked. */
  function authenticate(req: IncomingMessage): Device {
    const token = bearer(req);
    if (!token) throw unauthorized("missing device token");
    const row = db
      .prepare(
        "SELECT device_id, account_id, name, last_seen_at, revoked_at FROM devices WHERE token_hash = ?",
      )
      .get(sha256(token)) as
      | {
          device_id: string;
          account_id: string;
          name: string;
          last_seen_at: number | null;
          revoked_at: number | null;
        }
      | undefined;
    if (!row || row.revoked_at !== null) throw unauthorized();
    const now = Date.now();
    if (row.last_seen_at === null || now - row.last_seen_at >= SEEN_MS)
      db.prepare("UPDATE devices SET last_seen_at = ? WHERE device_id = ?").run(now, row.device_id);
    return { deviceId: row.device_id, accountId: row.account_id, name: row.name };
  }

  function createDevice(accountId: string, name: string, now: number) {
    const token = randomBytes(32).toString("base64url");
    const deviceId = randomUUID();
    db.prepare(
      "INSERT INTO devices (device_id, account_id, name, token_hash, created_at) VALUES (?,?,?,?,?)",
    ).run(deviceId, accountId, name, sha256(token), now);
    return { accountId, deviceId, deviceName: name, token };
  }

  async function login(req: IncomingMessage) {
    const now = Date.now();
    if (limited(now)) throw new HttpError(429, "TooManyRequests", "too many failed sign-ins");
    const body = await readJson(req);
    if (!body || typeof body !== "object") throw new HttpError(400, "BadRequest", "expected JSON");
    const { deviceName, code, bootstrap: offered } = body as Record<string, unknown>;
    if (typeof deviceName !== "string" || deviceName.length < 1 || deviceName.length > 64)
      throw new HttpError(400, "BadRequest", "deviceName must be 1 to 64 characters");
    if (
      (code !== undefined && typeof code !== "string") ||
      (offered !== undefined && typeof offered !== "string")
    )
      throw new HttpError(400, "BadRequest", "code and bootstrap are strings");
    const fail = () => {
      failures.push(now);
      return unauthorized("sign-in refused");
    };
    if ((code === undefined) === (offered === undefined)) throw fail();
    if (typeof offered === "string") {
      const { n } = db.prepare("SELECT count(*) AS n FROM accounts").get() as { n: number };
      if (n !== 0 || !bootstrap || !timingSafeEqual(sha256(offered), sha256(bootstrap)))
        throw fail();
      return transaction(db, () => {
        const accountId = randomUUID();
        db.prepare("INSERT INTO accounts (account_id, name, created_at) VALUES (?,?,?)").run(
          accountId,
          "owner",
          now,
        );
        return createDevice(accountId, deviceName, now);
      });
    }
    const hash = sha256(normalizeCode(code as string));
    return transaction(db, () => {
      const row = db
        .prepare(
          "SELECT account_id FROM pairing_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
        )
        .get(hash, now) as { account_id: string } | undefined;
      if (!row) throw fail();
      db.prepare("UPDATE pairing_codes SET used_at = ? WHERE code_hash = ?").run(now, hash);
      return createDevice(row.account_id, deviceName, now);
    });
  }

  function pair(device: Device) {
    const raw = Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join("");
    const expiresAt = Date.now() + PAIRING_MS;
    db.prepare(
      "INSERT INTO pairing_codes (code_hash, account_id, created_by_device, expires_at) VALUES (?,?,?,?)",
    ).run(sha256(raw), device.accountId, device.deviceId, expiresAt);
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
  }

  function devices(device: Device) {
    const rows = db
      .prepare(
        "SELECT device_id, name, created_at, last_seen_at, revoked_at FROM devices WHERE account_id = ? ORDER BY created_at, device_id",
      )
      .all(device.accountId) as {
      device_id: string;
      name: string;
      created_at: number;
      last_seen_at: number | null;
      revoked_at: number | null;
    }[];
    return {
      current: device.deviceId,
      devices: rows.map((r) => ({
        deviceId: r.device_id,
        name: r.name,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        revokedAt: r.revoked_at,
      })),
    };
  }

  function revoke(device: Device, target: string) {
    const row = db
      .prepare("SELECT revoked_at FROM devices WHERE device_id = ? AND account_id = ?")
      .get(target, device.accountId) as { revoked_at: number | null } | undefined;
    if (!row) throw new HttpError(404, "UnknownDevice", `no device ${target} in this account`);
    const revokedAt = row.revoked_at ?? Date.now();
    db.prepare("UPDATE devices SET revoked_at = ? WHERE device_id = ?").run(revokedAt, target);
    events.closeDevice(target);
    return { deviceId: target, revokedAt };
  }

  async function handle(req: IncomingMessage, res: ServerResponse, parts: string[]) {
    const [, , route, target, ...rest] = parts;
    if (req.method === "POST" && route === "login" && parts.length === 3)
      return sendJson(res, 201, await login(req));
    if (req.method === "POST" && route === "pair" && parts.length === 3)
      return sendJson(res, 201, pair(authenticate(req)));
    if (req.method === "GET" && route === "devices" && parts.length === 3)
      return sendJson(res, 200, devices(authenticate(req)));
    if (req.method === "DELETE" && route === "devices" && target && !rest.length)
      return sendJson(res, 200, revoke(authenticate(req), target));
    throw new HttpError(404, "NotFound", "no such route");
  }

  return { authenticate, handle };
}
export type Auth = ReturnType<typeof auth>;
