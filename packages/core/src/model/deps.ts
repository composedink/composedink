import type { LoroDoc } from "loro-crdt";
import { KEYS } from "./keys.ts";
export function addDependency(doc: LoroDoc, tag: string, id: string) {
  doc.getMap(KEYS.deps).set(tag, { id, version: "dev" });
  doc.commit();
  return { tag };
}
