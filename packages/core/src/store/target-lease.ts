import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
export function targetLease(directory: string) {
  const db = new DatabaseSync(join(directory, ".composed-export.db"));
  try {
    db.exec("PRAGMA busy_timeout=0");
    db.exec("BEGIN EXCLUSIVE");
  } catch (e) {
    db.close();
    if (e && typeof e === "object" && "errcode" in e && e.errcode === 5)
      throw Error(`TargetBusy: ${directory}`);
    throw e;
  }
  return () => db.close();
}
