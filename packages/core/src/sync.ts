import { VersionVector } from "loro-crdt";
import type { Authority, SyncResult, SyncSlot } from "./authority.ts";
import {
  currentSession,
  sessionStatus,
  signInRequired,
  signOut,
  type Session,
  type SessionStatus,
} from "./session.ts";
import { indexState, readState } from "./store/recovery.ts";

const DEBOUNCE_MS = 500;
const POLL_MS = 30_000;
const BACKOFF_MS = [1_000, 30_000] as const;

/** Per document: the last server seq imported and the server vv after it (base64url). */
interface Cursor {
  seq: number;
  vv?: string;
}
const readCursor = (home: string, id: string): Cursor =>
  JSON.parse(readState(home, "sync", id) ?? '{"seq":0}') as Cursor;
const writeCursor = (home: string, id: string, cursor: Cursor) =>
  indexState(home, "sync", id, JSON.stringify(cursor));
const decodeVv = (vv: string) => VersionVector.decode(Buffer.from(vv, "base64url"));
const docPath = (id: string) => `/sync/docs/${encodeURIComponent(id)}/updates`;

/** The server answered 401: the device was revoked or forgotten. */
class Unauthorized extends Error {}
async function failure(response: Response) {
  const body: unknown = await response.json().catch(() => undefined);
  return Error(
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `ServerError: ${response.status} ${response.statusText}`,
  );
}

/** A hand-written `text/event-stream` reader: yields `{event, data}` per dispatched event. */
async function* events(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n");
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}

/**
 * The studio's sync loop for a signed-in home: pulls server updates into the authority (import
 * then normalize, under its queue) and pushes the authority's own updates. One cycle runs at a
 * time; local changes (debounced), `doc` events, stream (re)connection and a 30-second timer
 * trigger cycles, which coalesce.
 */
export function startSync(a: Authority, home: string, onStatus: (status: SessionStatus) => void) {
  let stopped = false;
  /** Aborts every in-flight request when the loop stops. */
  const halt = new AbortController();
  /** No cursor or status writes once stopped: the home may be signing out or going away. */
  const assertRunning = () => {
    if (stopped) throw Error("SyncStopped: the sync loop stopped");
  };
  let live = false;
  const heads = new Map<string, number>();
  let running: Promise<SyncResult> | undefined;
  let queued: Promise<SyncResult> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let stream: AbortController | undefined;
  let wake: (() => void) | undefined;
  let status: SessionStatus = { signedIn: true };
  const publish = async () => {
    status = await sessionStatus(home);
    onStatus(status);
  };

  async function request(session: Session, path: string, init: RequestInit = {}) {
    const response = await fetch(session.server + path, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, halt.signal]) : halt.signal,
      headers: {
        ...(init.headers as Record<string, string>),
        authorization: `Bearer ${session.token}`,
      },
    });
    if (response.status === 401) {
      await response.body?.cancel();
      throw new Unauthorized();
    }
    return response;
  }

  const setHeads = (data: string) => {
    heads.clear();
    for (const doc of (JSON.parse(data) as { docs: { docId: string; seq: number }[] }).docs)
      heads.set(doc.docId, doc.seq);
  };

  /** Without a live stream, open `/sync/events` only to read `heads`, then close it. */
  async function readHeads(session: Session) {
    const controller = new AbortController();
    try {
      const response = await request(session, "/sync/events", { signal: controller.signal });
      if (!response.ok || !response.body) throw await failure(response);
      for await (const event of events(response.body))
        if (event.event === "heads") return setHeads(event.data);
    } finally {
      controller.abort();
    }
  }

  async function pull(session: Session, id: string) {
    let cursor = readCursor(home, id);
    let head = heads.get(id);
    // The server no longer lists a document this home has pushed or pulled: its sync storage was
    // reset. Push with the stale cursor; the server answers 409 and the push resends everything.
    if (head === undefined) return { imported: false, forget: cursor.seq > 0 };
    // The server has fewer rows than this cursor: it was reset. Its rows import idempotently.
    if (head < cursor.seq) cursor = { seq: 0 };
    let imported = false;
    while (head > cursor.seq) {
      const response = await request(session, `${docPath(id)}?since=${cursor.seq}`);
      if (response.status === 404) {
        await response.body?.cancel();
        return { imported, forget: false };
      }
      if (!response.ok) throw await failure(response);
      const page = (await response.json()) as {
        head: number;
        vv: string;
        snapshot?: { seq: number; bytes: string };
        updates: { seq: number; bytes: string }[];
      };
      const blobs = [
        ...(page.snapshot ? [page.snapshot.bytes] : []),
        ...page.updates.map((u) => u.bytes),
      ].map((b) => new Uint8Array(Buffer.from(b, "base64")));
      const last = page.updates.at(-1)?.seq ?? page.snapshot?.seq ?? cursor.seq;
      assertRunning();
      if (blobs.length)
        imported =
          (await a.serialize(() =>
            a.transaction(undefined, "sync-pull", () => a.receive(id, blobs)),
          )) === true || imported;
      // Stored after the import commits: a crash before this only re-pulls.
      assertRunning();
      cursor = { seq: last, vv: page.vv };
      writeCursor(home, id, cursor);
      head = page.head;
      if (!blobs.length) break;
    }
    return { imported, forget: false };
  }

  async function push(session: Session, id: string, force = false) {
    let cursor = readCursor(home, id);
    let bytes = await a.serialize(async () => {
      const doc = a.documents.get(id);
      if (!doc) return undefined;
      const order = cursor.vv ? doc.oplogVersion().compare(decodeVv(cursor.vv)) : 1;
      if (!force && order !== 1 && order !== undefined) return undefined;
      return doc.export({ mode: "update", ...(cursor.vv ? { from: decodeVv(cursor.vv) } : {}) });
    });
    if (!bytes) return false;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await request(session, docPath(id), {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "composed-since": cursor.vv ?? "",
          },
          body: Buffer.from(bytes),
        });
      } catch (error) {
        // A lost acknowledgement: resend the same bytes once; the server dedups by version range.
        if (error instanceof Unauthorized || attempt > 0) throw error;
        continue;
      }
      if (response.status === 409 && attempt === 0) {
        // The server lacks what this cursor says it has (reset storage): adopt its vv and resend.
        const { vv } = (await response.json()) as { vv: string };
        cursor = { seq: 0, vv };
        bytes = await a.serialize(async () =>
          a.documents.get(id)!.export({ mode: "update", from: decodeVv(vv) }),
        );
        continue;
      }
      if (!response.ok) throw await failure(response);
      const result = (await response.json()) as { seq: number; vv: string; duplicate: boolean };
      assertRunning();
      // Advance seq only without a gap; rows from other devices in between are pulled next.
      writeCursor(home, id, {
        seq: result.seq === cursor.seq + 1 ? result.seq : cursor.seq,
        vv: result.vv,
      });
      return true;
    }
  }

  async function cycle(only?: string): Promise<SyncResult> {
    const session = await currentSession(home);
    if (!session) throw signInRequired(status.server);
    if (!live) await readHeads(session);
    const ids = only ? [only] : [...new Set([...a.documents.keys(), ...heads.keys()])].sort();
    const pulled: string[] = [];
    const pushed: string[] = [];
    for (const id of ids) {
      const { imported, forget } = await pull(session, id);
      if (imported) pulled.push(id);
      if (await push(session, id, forget)) pushed.push(id);
    }
    const lastSyncAt = Date.now();
    assertRunning();
    indexState(home, "sync", "", JSON.stringify({ lastSyncAt }));
    await publish();
    return { pushed, pulled, lastSyncAt };
  }

  /** Any 401: forget the device locally, stop the loop and publish the signed-out status. */
  async function unauthorized() {
    const { server } = await sessionStatus(home);
    void stop();
    await signOut(home);
    await publish();
    return signInRequired(server);
  }
  async function guarded(only?: string) {
    try {
      return await cycle(only);
    } catch (error) {
      if (error instanceof Unauthorized) throw await unauthorized();
      throw error;
    }
  }

  function run(only?: string): Promise<SyncResult> {
    if (stopped) return guarded(only);
    if (!running) {
      running = guarded(only).finally(() => {
        running = undefined;
      });
      return running;
    }
    queued ??= running
      .catch(() => {})
      .then(() => {
        queued = undefined;
        if (stopped) throw Error("SyncStopped: the sync loop stopped");
        return run();
      });
    return queued;
  }
  const trigger = () => {
    if (!stopped) run().catch(() => {});
  };

  async function connect() {
    let backoff: number = BACKOFF_MS[0];
    while (!stopped) {
      const session = await currentSession(home);
      if (!session) return;
      stream = new AbortController();
      try {
        const response = await request(session, "/sync/events", { signal: stream.signal });
        if (!response.ok || !response.body) throw await failure(response);
        for await (const event of events(response.body)) {
          if (event.event === "heads") {
            setHeads(event.data);
            live = true;
            backoff = BACKOFF_MS[0];
            trigger();
          } else if (event.event === "doc") {
            const { docId, seq } = JSON.parse(event.data) as { docId: string; seq: number };
            heads.set(docId, seq);
            trigger();
          }
        }
      } catch (error) {
        if (error instanceof Unauthorized) return void (await unauthorized());
      }
      live = false;
      if (stopped) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, backoff).unref();
      });
      backoff = Math.min(backoff * 2, BACKOFF_MS[1]);
    }
  }

  const unsubscribe = a.subscribe(() => {
    clearTimeout(debounce);
    debounce = setTimeout(trigger, DEBOUNCE_MS);
    debounce.unref();
  });
  const poll = setInterval(trigger, POLL_MS);
  poll.unref();
  void connect();

  function stop(): Promise<void> {
    const settled = Promise.all(
      [running, queued].map((p) => Promise.resolve(p).catch(() => {})),
    ).then(() => {});
    stopped = true;
    halt.abort();
    live = false;
    unsubscribe();
    clearTimeout(debounce);
    clearInterval(poll);
    stream?.abort();
    wake?.();
    return settled;
  }
  return {
    now: (id?: string) => run(id),
    stop,
    status: () => status,
  };
}

/**
 * The authority's sync slot in studio: starts the loop when the home is signed in, restarts it
 * after `session.login`, and stops it on logout. Status changes go to `onStatus`.
 */
export function syncSlot(
  a: Authority,
  home: string,
  onStatus: (status: SessionStatus) => void,
): SyncSlot {
  let loop: ReturnType<typeof startSync> | undefined;
  const slot: SyncSlot = {
    async start() {
      await loop?.stop();
      loop = (await currentSession(home)) ? startSync(a, home, onStatus) : undefined;
      onStatus(await sessionStatus(home));
    },
    async stop() {
      const stopping = loop?.stop();
      loop = undefined;
      await stopping;
      onStatus(await sessionStatus(home));
    },
    async now(id?: string) {
      if (!loop) await slot.start();
      if (!loop) throw signInRequired((await sessionStatus(home)).server);
      return loop.now(id);
    },
  };
  return slot;
}
