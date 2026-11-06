import type { LoroDoc } from "loro-crdt";
import { KEYS } from "./keys.ts";
export function addDependency(doc: LoroDoc, tag: string, id: string) {
  doc.getMap(KEYS.deps).set(tag, { id, version: "dev" });
  doc.commit();
  return { tag };
}

export function pinDependency(doc: LoroDoc, tag: string, version: string) {
  const dep = doc.getMap(KEYS.deps).get(tag);
  if (!dep || typeof dep !== "object" || !("id" in dep))
    throw Error("UnpinnedDependency: unknown tag");
  doc.getMap(KEYS.deps).set(tag, { id: dep.id, version });
  doc.commit();
}
