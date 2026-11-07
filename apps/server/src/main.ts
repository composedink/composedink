import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { artifactHandler } from "./artifacts.ts";
import { openDatabase } from "./db.ts";
import { HttpError, segments, sendError } from "./http.ts";
import { auth } from "./auth.ts";
import { eventHub } from "./events.ts";
import { sync } from "./sync.ts";
import { replicas } from "./replicas.ts";
import { links } from "./links.ts";

export interface ServerOptions {
  /** `$COMPOSED_STORAGE`: artifacts and `server.db`. */
  storage: string;
  /** `COMPOSED_TOKEN`: the bearer for artifact PUT. */
  token: string;
  /** `COMPOSED_BOOTSTRAP_TOKEN`: required until the first device signs in, then ignored. */
  bootstrap?: string;
  migrations?: readonly string[];
}

/** One `node:http` server for `/healthz`, `/c/` (artifacts), `/auth/` and `/sync/`. */
export function composedServer(options: ServerOptions) {
  mkdirSync(options.storage, { recursive: true });
  const db = openDatabase(options.storage, options.migrations);
  const { n } = db.prepare("SELECT count(*) AS n FROM accounts").get() as { n: number };
  if (n === 0 && !options.bootstrap) {
    db.close();
    throw Error("COMPOSED_BOOTSTRAP_TOKEN is required until the first device signs in");
  }
  const artifacts = artifactHandler({ root: options.storage, token: options.token });
  const events = eventHub();
  const devices = auth(db, events, options.bootstrap);
  const replica = replicas(db);
  const shared = links(db, replica);
  const relay = sync(db, devices, events, replica, shared);
  const server = createServer(async (req, res) => {
    try {
      const parts = segments(req.url);
      if (parts[1] === "healthz" && parts.length === 2 && req.method === "GET") {
        try {
          db.prepare("SELECT count(*) FROM accounts").get();
          res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
        } catch {
          res.writeHead(503, { "Content-Type": "text/plain" }).end("database unavailable");
        }
        return;
      }
      if (parts[1] === "c") return artifacts(req, res, parts);
      if (parts[1] === "auth") return await devices.handle(req, res, parts);
      if (parts[1] === "sync") return await relay.handle(req, res, parts);
      throw new HttpError(404, "NotFound", "no such route");
    } catch (error) {
      sendError(res, error);
    }
  });
  return {
    server,
    db,
    close() {
      events.closeAll();
      server.closeAllConnections();
      server.close();
      if (db.isOpen) db.close();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { server } = composedServer({
      storage: process.env.COMPOSED_STORAGE ?? "/data",
      token: process.env.COMPOSED_TOKEN ?? "",
      bootstrap: process.env.COMPOSED_BOOTSTRAP_TOKEN || undefined,
    });
    const host = process.env.HOST ?? "0.0.0.0";
    server.listen(Number(process.env.PORT ?? 4849), host, () => {
      const address = server.address();
      if (address && typeof address === "object")
        console.log(JSON.stringify({ ready: true, port: address.port }));
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
