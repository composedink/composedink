import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite } from "./store/store.ts";
const scope = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const mapping = z.object({
  server: z.url().refine((s) => /^https?:/.test(s)),
  tokenRef: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
});
const schema = z.record(scope, mapping);
export async function scopeConfig(home: string) {
  try {
    return schema.parse(JSON.parse(await readFile(join(home, "scopes.json"), "utf8")));
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return {};
    throw e;
  }
}
export async function configureScope(home: string, name: string, server: string, tokenRef: string) {
  const config = await scopeConfig(home);
  config[scope.parse(name)] = mapping.parse({ server: server.replace(/\/$/, ""), tokenRef });
  await mkdir(home, { recursive: true });
  await atomicWrite(join(home, "scopes.json"), JSON.stringify(config, null, 2) + "\n");
}
