import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, access } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import {
  authority,
  openStore,
  bind,
  atomicWrite,
  acquire,
  undoSession,
} from "@composedink/core/node";
export async function studio(home: string) {
  await mkdir(home, { recursive: true });
  const port = Number(process.env.COMPOSED_PORT ?? 4747);
  const artifactPort = Number(process.env.COMPOSED_ARTIFACT_PORT ?? 4848);
  const origin = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString("base64url");
  const ownership = await acquire(home, "studio");
  if (ownership.kind === "connect") return;
  const a = await authority(await openStore(home));
  const run = bind(a);
  await atomicWrite(join(home, "session.token"), token);
  const webRoot = resolve(import.meta.dirname, "../../web");
  const packaged = process.env.NODE_ENV === "production";
  const assetsRoot = join(webRoot, "dist");
  if (packaged) await access(join(assetsRoot, "index.html"));
  const vite = packaged
    ? undefined
    : await createViteServer({
        configFile: false,
        root: webRoot,
        appType: "custom",
        optimizeDeps: { exclude: ["loro-crdt", "loro-codemirror", "harper.js"] },
        server: {
          hmr: false,
          middlewareMode: true,
          fs: { allow: [resolve(webRoot, "../.."), home] },
        },
      });
  const server = createServer(async (req, res) => {
    if (req.url === "/session") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ token, origin }));
      return;
    }
    if (new URL(req.url ?? "/", origin).pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      const template = packaged
        ? await readFile(join(assetsRoot, "index.html"), "utf8")
        : await readFile(join(webRoot, "index.html"), "utf8");
      const html = template.replace(
        "<head>",
        `<head><script>window.__composedSession=${JSON.stringify({ token, origin })}</script>`,
      );
      res.end(vite ? await vite.transformIndexHtml("/", html) : html);
      return;
    }
    if (!vite) {
      try {
        const root = await realpath(assetsRoot);
        const path = await realpath(resolve(root, `.${new URL(req.url ?? "/", origin).pathname}`));
        if (!path.startsWith(root + sep)) throw new Error("Invalid asset path");
        res.setHeader(
          "Content-Type",
          path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : "application/octet-stream",
        );
        res.end(await readFile(path));
      } catch {
        res.statusCode = 404;
        res.end();
      }
      return;
    }
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", origin);
    if (req.headers.origin !== origin || url.searchParams.get("token") !== token) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit("connection", ws, req));
  });
  sockets.on("connection", (socket) => {
    let session = randomBytes(16).toString("hex");
    let unsubscribe: (() => void) | undefined;
    socket.on("close", () => unsubscribe?.());
    let frames = Promise.resolve();
    socket.on("message", (raw) => {
      frames = frames
        .then(async () => {
          const frame = JSON.parse(
            (Array.isArray(raw)
              ? Buffer.concat(raw)
              : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw)
            ).toString(),
          );
          try {
            if (frame.subscribe) {
              if (typeof frame.session === "string" && /^[0-9a-f-]{36}$/.test(frame.session))
                session = frame.session;
              unsubscribe?.();
              unsubscribe = a.subscribe((doc, bytes) => {
                if (doc === frame.subscribe && socket.readyState === WebSocket.OPEN)
                  socket.send(
                    JSON.stringify({ doc, bytes: Buffer.from(bytes).toString("base64") }),
                  );
              });
              await a.serialize(async () => {
                socket.send(
                  JSON.stringify({
                    doc: frame.subscribe,
                    snapshot: Buffer.from(a.synchronize(frame.subscribe, frame.base)).toString(
                      "base64",
                    ),
                    head: a.read(frame.subscribe).base,
                  }),
                );
              });
            } else if (frame.bytes) {
              const result = await a.serialize(() =>
                a.typing(frame.doc, Buffer.from(frame.bytes, "base64")),
              );
              socket.send(JSON.stringify({ doc: frame.doc, seq: frame.seq, ...result }));
            } else {
              const result = frame.undo
                ? await undoSession(a, session)
                : frame.human
                  ? await run(frame.name, frame.input, session)
                  : await run(frame.name, frame.input);
              socket.send(JSON.stringify({ request: frame.request, result }));
            }
          } catch (error) {
            socket.send(JSON.stringify({ request: frame.request, error: String(error) }));
          }
        })
        .catch((error) => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ error: String(error) }));
        });
    });
  });
  const artifacts = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const root = await realpath(join(home, "artifacts"));
      const path = await realpath(resolve(root, `.${new URL(req.url ?? "/", origin).pathname}`));
      if (!path.startsWith(root + sep)) throw new Error("Invalid path");
      res.setHeader("Cache-Control", "public,max-age=31536000,immutable");
      res.setHeader(
        "Content-Type",
        path.endsWith(".js") ? "text/javascript" : "application/octet-stream",
      );
      res.end(await readFile(path));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await Promise.all([
    new Promise<void>((r) => server.listen(port, "127.0.0.1", r)),
    new Promise<void>((r) => artifacts.listen(artifactPort, "127.0.0.1", r)),
  ]);
  await ownership.ready();
  console.log(JSON.stringify({ ready: true, origin, artifactPort }));
  const close = async () => {
    sockets.close();
    for (const socket of sockets.clients) socket.terminate();
    server.close();
    artifacts.close();
    await vite?.close();
    await ownership.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
}
