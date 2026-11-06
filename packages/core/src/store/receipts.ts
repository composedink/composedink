import { indexState } from "./recovery.ts";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, hash } from "node:crypto";
import { z } from "zod";
import { atomicWrite } from "./store.ts";
import { fault } from "./compact.ts";
export const effectSchema = z.object({
  target: z.string(),
  old: z.tuple([z.string().nullable(), z.string().nullable()]),
  bytes: z.tuple([z.string(), z.string()]),
  base: z.string(),
});
const schema = z.object({
  request: z.string().optional(),
  hash: z.string(),
  result: z.unknown(),
  frontiers: z.record(z.string(), z.string()),
  writes: z.array(z.object({ id: z.string(), create: z.boolean(), bytes: z.string() })),
  applied: z.boolean(),
  effects: z.array(effectSchema).default([]),
  reconciliations: z.array(z.string()).default([]),
  reconciliationResults: z.record(z.string(), z.unknown()).default({}),
});
export type Envelope = z.infer<typeof schema>;
export const payloadHash = (name: string, input: unknown) =>
  hash(
    "sha256",
    canonical({
      name,
      input:
        input && typeof input === "object"
          ? Object.fromEntries(Object.entries(input).filter(([k]) => k !== "request" && k !== "by"))
          : input,
    }),
  );
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function saveReceipt(path: string, e: Envelope) {
  const payload = JSON.stringify(e);
  await atomicWrite(path, JSON.stringify({ data: e, sha256: hash("sha256", payload) }));
}
function readReceipt(raw: string) {
  const envelope = z.object({ data: z.unknown(), sha256: z.string() }).parse(JSON.parse(raw));
  if (hash("sha256", JSON.stringify(envelope.data)) !== envelope.sha256)
    throw new Error("RecoveryRequired: corrupt transaction envelope");
  return schema.parse(envelope.data);
}
export async function receipts(home: string, apply: (envelope: Envelope) => Promise<void>) {
  const directory = join(home, "state", "receipts");
  await mkdir(directory, { recursive: true });
  const reconciled = new Set<string>();
  const reconciliationResults = new Map<string, unknown>();
  const index = new Map<string, Envelope>();

  for (const name of (await readdir(directory)).filter((n) => n.endsWith(".json")).sort()) {
    const path = join(directory, name);
    const e = readReceipt(await readFile(path, "utf8"));
    if (!e.applied) {
      await apply(e);
      e.applied = true;
      await saveReceipt(path, e);
    }
    e.reconciliations.forEach((k) => {
      reconciled.add(k);
      reconciliationResults.set(k, e.reconciliationResults[k]);
    });
    if (e.request) {
      index.set(e.request, e);
      indexState(home, "receipt", e.request, JSON.stringify(e));
    }
  }
  return {
    reconciled: (key: string) => reconciled.has(key),
    reconciliation: (key: string) => reconciliationResults.get(key),
    lookup(request: string, payload: string) {
      const prior = index.get(request);
      if (prior && prior.hash !== payload)
        throw new Error("RequestConflict: request already used with different semantic arguments");
      return prior;
    },
    async commit(e: Envelope) {
      const path = join(directory, `${Date.now()}-${randomUUID()}.json`);
      await saveReceipt(path, e);
      fault("transaction:committed");
      await apply(e);
      e.applied = true;
      await saveReceipt(path, e);
      e.reconciliations.forEach((k) => {
        reconciled.add(k);
        reconciliationResults.set(k, e.reconciliationResults[k]);
      });
      if (e.request) {
        index.set(e.request, e);
        indexState(home, "receipt", e.request, JSON.stringify(e));
      }
      fault("transaction:before-ack");
    },
  };
}
