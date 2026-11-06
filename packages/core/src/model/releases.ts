import type { LoroDoc } from "loro-crdt";
import { KEYS } from "./keys.ts";
export interface Release {
  frontiers: string;
  sourceHash: string;
  artifactHash: string;
  at: number;
}
export function addRelease(doc: LoroDoc, version: string, record: Release) {
  const releases = doc.getMap(KEYS.releases);
  if (releases.get(version) !== undefined) throw Error("VersionExists");
  releases.set(version, record);
  doc.commit();
}
