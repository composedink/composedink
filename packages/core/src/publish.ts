import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { object, parseSchema } from "@composedink/blocks";
import type { Authority } from "./authority.ts";
import { bundle, sha256 } from "./bundle.ts";
import { readFiles } from "./model/files.ts";
import { addRelease } from "./model/releases.ts";
import { atomicWrite } from "./store/store.ts";
import { scopeConfig } from "./config.ts";
const intentSchema = z.object({
  version: z.string(),
  frontiers: z.string(),
  sourceHash: z.string(),
  artifactHash: z.string(),
  at: z.number(),
  url: z.string(),
  files: z.record(z.string(), z.string()),
  built: z.object({
    kind: z.enum(["block", "inline"]),
    entry: z.string(),
    sourceHash: z.string(),
    fallback: z.string(),
    props: z.unknown().transform((value) => {
      const schema = parseSchema(value);
      if (schema.type !== "object") throw Error("Invalid release props");
      return schema;
    }),
  }),
});
const intentPath = (home: string, id: string, version: string) =>
  join(home, "state", "publishes", sha256(id), version + ".json");
export async function published(a: Authority, id: string, version: string) {
  const record = a.get(id).getMap("releases").get(version);
  if (!object(record)) throw Error(`UnpinnedDependency: ${id}@${version} is unpublished`);
  const intent = intentSchema.parse(
    JSON.parse(await readFile(intentPath(a.store.home, id, version), "utf8")),
  );
  if (record.artifactHash !== intent.artifactHash || record.sourceHash !== intent.sourceHash)
    throw Error("RecoveryRequired: release metadata mismatch");
  return intent;
}
export async function publish(a: Authority, id: string, bump: "patch" | "minor" | "major") {
  const [scope, name] = id.slice("composed:".length).split("/");
  const config = (await scopeConfig(a.store.home))[scope];
  if (!config) throw Error(`Configure scope ${scope} with composed config scope`);
  const token = process.env[config.tokenRef];
  if (!token) throw Error(`Missing token environment reference ${config.tokenRef}`);
  const releases = a.get(id).getMap("releases").toJSON();
  const versions = Object.keys(releases)
    .map((v) => v.split(".").map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const next = versions.at(-1) ?? [0, 0, 0];
  const position = { major: 0, minor: 1, patch: 2 }[bump];
  next[position]++;
  for (let j = position + 1; j < 3; j++) next[j] = 0;
  const version = next.join(".");
  const path = intentPath(a.store.home, id, version);
  let intent: z.infer<typeof intentSchema>;
  try {
    intent = intentSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (e) {
    if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) throw e;
    const snapshot = readFiles(a.get(id));
    const url = `${config.server}/c/${scope}/${name}/${version}`;
    const built = await bundle(a.store.home, id, snapshot.files, url, version);
    const files: Record<string, string> = {};
    async function collect(directory: string, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name;
        if (entry.isDirectory()) await collect(join(directory, entry.name), relative + "/");
        else files[relative] = (await readFile(join(directory, entry.name))).toString("base64");
      }
    }
    await collect(join(a.store.home, "artifacts", built.name));
    const manifest = JSON.stringify({
      files: Object.fromEntries(
        Object.entries(files).map(([p, b]) => [p, sha256(Buffer.from(b, "base64"))]),
      ),
    });
    files["release.json"] = Buffer.from(manifest).toString("base64");
    intent = {
      version,
      frontiers: snapshot.base,
      sourceHash: built.sourceHash,
      artifactHash: sha256(manifest),
      at: Date.now(),
      url: built.entry,
      files,
      built,
    };
    await mkdir(join(path, ".."), { recursive: true });
    await atomicWrite(path, JSON.stringify(intent));
  }
  for (const [file, bytes] of Object.entries(intent.files)) {
    const response = await fetch(new URL(file, intent.url), {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
      body: Buffer.from(bytes, "base64"),
    });
    if (!response.ok)
      throw Error(
        `${response.status === 409 ? "VersionExists" : "PublishFailed"}: PUT ${file}: ${response.status}`,
      );
  }
  await a.change(id, (d) =>
    addRelease(d, version, {
      frontiers: intent.frontiers,
      sourceHash: intent.sourceHash,
      artifactHash: intent.artifactHash,
      at: intent.at,
    }),
  );
  return { version, url: intent.url };
}
