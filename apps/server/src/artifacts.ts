import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import { join } from "node:path";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const filename = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
export function artifactServer({ root, token }: { root: string; token: string }) {
  if (!token) throw Error("Artifact server requires a token");
  let queue = Promise.resolve();
  return createServer((req, res) => {
    const run = async () => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
      const parts = decodeURIComponent((req.url ?? "").split("?")[0]).split("/");
      const [, prefix, scope, name, version, ...files] = parts;
      if (
        prefix !== "c" ||
        !scope ||
        !name ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scope) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "") ||
        !files.length ||
        files.some((p) => !filename.test(p) || p === "." || p === "..")
      ) {
        res.writeHead(400).end();
        return;
      }
      const relative = files.join("/");
      const released = join(root, "releases", scope, name, version);
      const staging = join(root, "staging", scope, name, version);
      if (req.method === "PUT") {
        const auth = Buffer.from(req.headers.authorization ?? "");
        const expected = Buffer.from(`Bearer ${token}`);
        if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
          res.writeHead(401).end();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const complete = await exists(released);
        const directory = complete ? released : staging;
        const path = join(directory, relative);
        if (await exists(path)) {
          if (Buffer.compare(await readFile(path), body) !== 0) {
            res.writeHead(409).end();
            return;
          }
          if (complete || relative !== "release.json") {
            res.writeHead(200).end();
            return;
          }
        }
        if (complete) {
          res.writeHead(409).end();
          return;
        }
        if (relative === "release.json") {
          const manifest: unknown = JSON.parse(body.toString());
          if (
            !manifest ||
            typeof manifest !== "object" ||
            !("files" in manifest) ||
            !manifest.files ||
            typeof manifest.files !== "object" ||
            Array.isArray(manifest.files)
          ) {
            res.writeHead(400).end();
            return;
          }
          const entries = Object.entries(manifest.files);
          if (!entries.some(([p]) => p === "remoteEntry.js")) {
            res.writeHead(400).end();
            return;
          }
          for (const [p, digest] of entries) {
            if (
              p === "release.json" ||
              p.split("/").some((s) => !filename.test(s) || s === "." || s === "..") ||
              typeof digest !== "string" ||
              !/^[a-f0-9]{64}$/.test(digest)
            ) {
              res.writeHead(400).end();
              return;
            }
            if (
              !(await exists(join(staging, p))) ||
              hash(await readFile(join(staging, p))) !== digest
            ) {
              res.writeHead(409).end();
              return;
            }
          }
          const temporary = path + "." + randomUUID() + ".tmp";
          await writeFile(temporary, body, { flag: "wx", flush: true });
          await rename(temporary, path);
          await mkdir(join(released, ".."), { recursive: true });
          await rename(staging, released);
        } else {
          await mkdir(join(path, ".."), { recursive: true });
          const temporary = path + "." + randomUUID() + ".tmp";
          await writeFile(temporary, body, { flag: "wx", flush: true });
          await rename(temporary, path);
        }
        res.writeHead(200).end();
        return;
      }
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      if (
        !(await exists(join(released, "release.json"))) ||
        !(await exists(join(released, relative)))
      ) {
        res.writeHead(404).end();
        return;
      }
      const manifest = JSON.parse(await readFile(join(released, "release.json"), "utf8"));
      if (relative !== "release.json" && !Object.hasOwn(manifest.files, relative)) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader(
        "Content-Type",
        relative.endsWith(".js")
          ? "application/javascript"
          : relative.endsWith(".json")
            ? "application/json"
            : relative.endsWith(".css")
              ? "text/css"
              : "application/octet-stream",
      );
      res.end(await readFile(join(released, relative)));
    };
    queue = queue.then(run).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
}
