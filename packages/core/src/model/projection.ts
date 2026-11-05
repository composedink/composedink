import type { LoroDoc } from "loro-crdt";
import { read } from "./read.ts";
export function project(doc: LoroDoc) {
  return read(doc);
}
