import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, link, unlink, readFile, realpath, access } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { authority, openStore, bind, atomicWrite } from "@composedink/core/node";
export async function studio(home: string) {
  await mkdir(home, { recursive: true });
  const port = Number(process.env.COMPOSED_PORT ?? 4747);
  const artifactPort = Number(process.env.COMPOSED_ARTIFACT_PORT ?? 4848);
  const origin = `http://127.0.0.1:${port}`;
  const token = randomBytes(32).toString("base64url");
  const lock = join(home, "workspace.lock");
  const pending = join(home, `workspace.${process.pid}.tmp`);
  const info = {
    pid: process.pid,
    processStartTime: Date.now() - process.uptime() * 1000,
    kind: "studio",
    socket: `ws://127.0.0.1:${port}`,
    ready: false,
  };
  await atomicWrite(pending, JSON.stringify(info));
  await link(pending, lock);
  await unlink(pending);
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
        optimizeDeps: { exclude: ["loro-crdt", "loro-codemirror"] },
        server: { middlewareMode: true, fs: { allow: [resolve(webRoot, "../.."), home] } },
      });
  const server = createServer(async (req, res) => {
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
  sockets.on("connection", (socket) =>
    socket.on("message", (raw) => {
      void a
        .serialize(async () => {
          const frame = JSON.parse(
            (Array.isArray(raw)
              ? Buffer.concat(raw)
              : Buffer.from(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw)
            ).toString(),
          );
          try {
            if (frame.subscribe) {
              socket.send(
                JSON.stringify({
                  doc: frame.subscribe,
                  snapshot: Buffer.from(
                    a.get(frame.subscribe).export({ mode: "snapshot" }),
                  ).toString("base64"),
                }),
              );
              return;
            }
            if (frame.bytes) {
              const bytes = Buffer.from(frame.bytes, "base64");
              const result = await a.typing(frame.doc, bytes);
              const update = JSON.stringify({ doc: frame.doc, bytes: frame.bytes });
              for (const peer of sockets.clients)
                if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(update);
              socket.send(JSON.stringify({ doc: frame.doc, seq: frame.seq, ...result }));
              return;
            }
          } catch (error) {
            socket.send(JSON.stringify({ request: frame.request, error: String(error) }));
            return;
          }
          // Operations use the same queue; execute after releasing this frame's slot.
          queueMicrotask(() => {
            void run(frame.name, frame.input).then(
              (result) => socket.send(JSON.stringify({ request: frame.request, result })),
              (error) =>
                socket.send(JSON.stringify({ request: frame.request, error: String(error) })),
            );
          });
        })
        .catch((error) => socket.send(JSON.stringify({ error: String(error) })));
    }),
  );
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
  await atomicWrite(lock, JSON.stringify({ ...info, ready: true }));
  console.log(JSON.stringify({ ready: true, origin, artifactPort }));
  const close = async () => {
    sockets.close();
    for (const socket of sockets.clients) socket.terminate();
    server.close();
    artifacts.close();
    await vite?.close();
    await unlink(lock);
    process.exit(0);
  };
  process.once("SIGTERM", () => {
    void close();
  });
  process.once("SIGINT", () => {
    void close();
  });
}
