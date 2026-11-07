import { afterEach, expect, it } from "vite-plus/test";
import { BOOTSTRAP, startServer, type TestServer } from "./support/server.ts";

const servers: TestServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.remove();
});
async function server() {
  const s = await startServer();
  servers.push(s);
  return s;
}
const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const as = (token: string, init: RequestInit = {}) => ({
  ...init,
  headers: { authorization: `Bearer ${token}` },
});
async function login(s: TestServer, body: Record<string, unknown>) {
  const response = await s.fetch("/auth/login", json(body));
  return { status: response.status, body: await response.json() };
}

it("bootstraps the first account once and stores only token hashes", async () => {
  const s = await server();
  const first = await login(s, { deviceName: "A", bootstrap: BOOTSTRAP });
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({ deviceName: "A" });
  expect(Buffer.from(first.body.token, "base64url")).toHaveLength(32);
  const second = await login(s, { deviceName: "B", bootstrap: BOOTSTRAP });
  expect(second.status).toBe(401);
  expect(second.body.error).toMatch(/^Unauthorized: /);
  const stored = s.db.prepare("SELECT token_hash FROM devices").all() as {
    token_hash: Uint8Array;
  }[];
  expect(stored).toHaveLength(1);
  expect(Buffer.from(stored[0].token_hash).toString("base64url")).not.toBe(first.body.token);
  expect(s.db.prepare("SELECT name FROM accounts").all()).toEqual([{ name: "owner" }]);
});

it("pairs a second device with a single-use code and refuses expired codes", async () => {
  const s = await server();
  const a = (await login(s, { deviceName: "A", bootstrap: BOOTSTRAP })).body;
  const pair = await s.fetch("/auth/pair", as(a.token, { method: "POST" }));
  expect(pair.status).toBe(201);
  const { code, expiresAt } = await pair.json();
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  expect(expiresAt - Date.now()).toBeGreaterThan(9 * 60 * 1000);
  const b = await login(s, { deviceName: "B", code: code.toLowerCase().replace("-", "") });
  expect(b.status).toBe(201);
  expect(b.body.accountId).toBe(a.accountId);
  expect((await login(s, { deviceName: "C", code })).status).toBe(401);

  const late = await (await s.fetch("/auth/pair", as(a.token, { method: "POST" }))).json();
  s.db.prepare("UPDATE pairing_codes SET expires_at = ? WHERE used_at IS NULL").run(Date.now() - 1);
  expect((await login(s, { deviceName: "D", code: late.code })).status).toBe(401);
  expect((await login(s, { deviceName: "E" })).status).toBe(401);
  expect((await login(s, { deviceName: "", code })).status).toBe(400);
});

it("answers 429 from the 11th failed sign-in in a minute", async () => {
  const s = await server();
  for (let i = 0; i < 10; i++)
    expect((await login(s, { deviceName: "x", code: "AAAA-AAAA" })).status).toBe(401);
  const limited = await login(s, { deviceName: "x", code: "AAAA-AAAA" });
  expect(limited.status).toBe(429);
  expect(limited.body.error).toMatch(/^TooManyRequests: /);
});

it("lists devices, revokes them, and refuses revoked tokens everywhere", async () => {
  const s = await server();
  const a = (await login(s, { deviceName: "A", bootstrap: BOOTSTRAP })).body;
  const { code } = await (await s.fetch("/auth/pair", as(a.token, { method: "POST" }))).json();
  const b = (await login(s, { deviceName: "B", code })).body;

  const list = await (await s.fetch("/auth/devices", as(b.token))).json();
  expect(list.current).toBe(b.deviceId);
  expect(list.devices.map((d: { name: string }) => d.name)).toEqual(["A", "B"]);
  expect(list.devices[0]).toMatchObject({ deviceId: a.deviceId, revokedAt: null });
  expect(typeof list.devices[0].lastSeenAt).toBe("number");

  const events = await s.fetch("/sync/events", as(b.token));
  expect(events.status).toBe(200);
  const reader = events.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: heads");

  const revoked = await s.fetch(`/auth/devices/${b.deviceId}`, as(a.token, { method: "DELETE" }));
  expect(revoked.status).toBe(200);
  expect(await revoked.json()).toMatchObject({ deviceId: b.deviceId });
  // Revocation ends the device's open stream.
  let done = false;
  while (!done) done = (await reader.read()).done;

  expect((await s.fetch("/auth/pair", as(b.token, { method: "POST" }))).status).toBe(401);
  expect((await s.fetch("/sync/events", as(b.token))).status).toBe(401);
  expect((await s.fetch("/auth/devices", as(b.token))).status).toBe(401);
  expect((await s.fetch("/auth/devices", as(a.token))).status).toBe(200);
});

it("refuses to revoke a device of another account", async () => {
  const s = await server();
  const a = (await login(s, { deviceName: "A", bootstrap: BOOTSTRAP })).body;
  // A second account cannot be created through the API in this unit; insert one directly.
  s.db.prepare("INSERT INTO accounts VALUES ('other', 'other', 0)").run();
  const { createHash } = await import("node:crypto");
  s.db
    .prepare(
      "INSERT INTO devices (device_id, account_id, name, token_hash, created_at) VALUES (?,?,?,?,?)",
    )
    .run("intruder", "other", "X", createHash("sha256").update("intruder-token").digest(), 0);
  const attempt = await s.fetch(
    `/auth/devices/${a.deviceId}`,
    as("intruder-token", { method: "DELETE" }),
  );
  expect(attempt.status).toBe(404);
  expect((await s.fetch("/auth/devices", as(a.token))).status).toBe(200);
});
