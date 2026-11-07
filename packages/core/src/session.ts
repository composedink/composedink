import { readFile, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "./store/store.ts";
import { clearState, readState } from "./store/recovery.ts";

/**
 * The server session of a home. `session.json` holds `{server, accountId, deviceId, deviceName}`
 * while signed in and `{server}` after logout or revocation, so the fix can name the server.
 * `session.secret` (mode 0600) holds the device token. `session.token` is the studio socket
 * token and unrelated.
 */
export interface Session {
  server: string;
  accountId: string;
  deviceId: string;
  deviceName: string;
  token: string;
}
export interface SessionStatus {
  signedIn: boolean;
  server?: string;
  accountId?: string;
  deviceName?: string;
  lastSyncAt?: number;
}
type SessionFile = Partial<Omit<Session, "token">>;
const files = (home: string) => ({
  json: join(home, "session.json"),
  secret: join(home, "session.secret"),
});

async function readFileJson(home: string): Promise<SessionFile> {
  try {
    const value: unknown = JSON.parse(await readFile(files(home).json, "utf8"));
    return value && typeof value === "object" ? (value as SessionFile) : {};
  } catch {
    return {};
  }
}

/** The signed-in session, or undefined: signed in means a secret plus a `deviceId`. */
export async function currentSession(home: string): Promise<Session | undefined> {
  const file = await readFileJson(home);
  const token = await readFile(files(home).secret, "utf8").catch(() => undefined);
  if (!token || !file.server || !file.accountId || !file.deviceId || !file.deviceName)
    return undefined;
  return {
    server: file.server,
    accountId: file.accountId,
    deviceId: file.deviceId,
    deviceName: file.deviceName,
    token,
  };
}

export const signInRequired = (server?: string) =>
  Error(
    `SignInRequired: not signed in to a composed server; fix: composed login ${server ?? "<server>"}`,
  );

export async function requireSession(home: string): Promise<Session> {
  const session = await currentSession(home);
  if (session) return session;
  throw signInRequired((await readFileJson(home)).server);
}

/** Forgets the device locally (logout, revocation, any 401); keeps the server for the fix. */
export async function signOut(home: string) {
  const { server } = await readFileJson(home);
  await unlink(files(home).secret).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (server) await atomicWrite(files(home).json, JSON.stringify({ server }) + "\n");
}

export const lastSyncAt = (home: string): number | undefined => {
  const payload = readState(home, "sync", "");
  return payload ? (JSON.parse(payload) as { lastSyncAt?: number }).lastSyncAt : undefined;
};

export async function sessionStatus(home: string): Promise<SessionStatus> {
  const session = await currentSession(home);
  if (!session) {
    const { server } = await readFileJson(home);
    return { signedIn: false, ...(server ? { server } : {}) };
  }
  const at = lastSyncAt(home);
  return {
    signedIn: true,
    server: session.server,
    accountId: session.accountId,
    deviceName: session.deviceName,
    ...(at === undefined ? {} : { lastSyncAt: at }),
  };
}

const errorText = async (response: Response) => {
  const body: unknown = await response.json().catch(() => undefined);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string"
    ? body.error
    : `ServerError: ${response.status} ${response.statusText}`;
};

async function send(url: string, init: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw Error(
      `ServerUnreachable: ${new URL(url).origin}: ${String(error instanceof Error && error.cause instanceof Error ? error.cause.message : error)}`,
    );
  }
}

/**
 * A request to the signed-in server. A 401 means the device was revoked (or the server forgot it):
 * the home signs out and the call fails with the sign-in fix.
 */
export async function serverRequest(home: string, path: string, init: RequestInit = {}) {
  const session = await requireSession(home);
  const response = await send(session.server + path, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      authorization: `Bearer ${session.token}`,
    },
  });
  if (response.status === 401) {
    await signOut(home);
    throw signInRequired(session.server);
  }
  return response;
}

export async function serverJson(home: string, path: string, init: RequestInit = {}) {
  const response = await serverRequest(home, path, init);
  if (!response.ok) throw Error(await errorText(response));
  return response.json() as Promise<unknown>;
}

export async function login(
  home: string,
  input: { server: string; code?: string; bootstrap?: string; deviceName?: string },
) {
  const existing = await currentSession(home);
  if (existing)
    throw Error(`SignedIn: already signed in to ${existing.server}; fix: composed logout`);
  if ((input.code === undefined) === (input.bootstrap === undefined))
    throw Error("InvalidInput: pass exactly one of --code or --bootstrap");
  const server = new URL(input.server).href.replace(/\/+$/, "");
  const response = await send(server + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceName: input.deviceName ?? hostname(),
      ...(input.code === undefined ? { bootstrap: input.bootstrap } : { code: input.code }),
    }),
  });
  if (!response.ok) throw Error(await errorText(response));
  const body = (await response.json()) as {
    accountId: string;
    deviceId: string;
    deviceName: string;
    token: string;
  };
  await atomicWrite(files(home).secret, body.token, 0o600);
  await atomicWrite(
    files(home).json,
    JSON.stringify({
      server,
      accountId: body.accountId,
      deviceId: body.deviceId,
      deviceName: body.deviceName,
    }) + "\n",
  );
  // A new session starts from nothing: every stored cursor belonged to the previous one.
  clearState(home, "sync");
  return sessionStatus(home);
}
