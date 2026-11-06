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
  refreshPreviews,
  previewTargets,
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
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (packaged)
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self' data: ws://127.0.0.1:" +
          port +
          "; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
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
              : path.endsWith(".wasm")
                ? "application/wasm"
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
  const unsubscribePreviews = a.subscribe((id) => {
    // Component operations refresh inside their transaction; typing and post operations refresh here.
    if (a.documents.get(id)?.getMap("meta").get("kind") !== "post") return;
    void a
      .serialize(() =>
        a.transaction(undefined, "preview-refresh", async () => {
          const diagnostics = await refreshPreviews(a, id);
          if (diagnostics.length)
            for (const socket of sockets.clients)
              if (socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ preview: { diagnostics } }));
        }),
      )
      .catch((error) => console.error(`BuildFailed: ${String(error)}`));
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", origin);
    if (req.headers.origin !== origin || url.searchParams.get("token") !== token) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit("connection", ws, req));
  });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  sockets.on("connection", (socket) => {
    clearTimeout(idleTimer);
    socket.once("close", () => {
      if (process.env.COMPOSED_DESKTOP_OWNER === "1" && sockets.clients.size === 0)
        idleTimer = setTimeout(() => {
          void a.serialize(async () => {
            if (sockets.clients.size === 0 && !(await previewTargets(home)).length)
              void close(true);
          });
        }, 2000);
    });
    let session = randomBytes(16).toString("hex");
    let unsubscribe: (() => void) | undefined;
    socket.on("close", () => unsubscribe?.());
    const rewrites = new Map<number, AbortController>();
    socket.on("close", () => {
      for (const controller of rewrites.values()) controller.abort();
    });
    const send = (frame: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
    };
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
            if (typeof frame.cancel === "number") {
              rewrites.get(frame.cancel)?.abort();
            } else if (frame.name === "alt.rewrite") {
              const controller = new AbortController();
              rewrites.set(frame.request, controller);
              void run(
                frame.name,
                frame.input,
                frame.human ? session : undefined,
                controller.signal,
              )
                .then(
                  (result) => send({ request: frame.request, result }),
                  (error) => send({ request: frame.request, error: String(error) }),
                )
                .finally(() => rewrites.delete(frame.request));
            } else if (frame.subscribe) {
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
              if (
                result &&
                typeof result === "object" &&
                "diagnostics" in result &&
                Array.isArray(result.diagnostics) &&
                result.diagnostics.length
              )
                for (const peer of sockets.clients)
                  if (peer.readyState === WebSocket.OPEN)
                    peer.send(JSON.stringify({ preview: { diagnostics: result.diagnostics } }));
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
  let closing = false;
  const close = async (idle = false) => {
    if (closing) return;
    await a.serialize(async () => {});
    if (idle && ((await previewTargets(home)).length || sockets.clients.size > 0)) return;
    closing = true;
    clearTimeout(idleTimer);
    unsubscribePreviews();
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
