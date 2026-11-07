import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
/** `link`: key linkId → `{url, doc}` for links this device created (tokens are never recoverable). */
export type StateKind = "receipt" | "history" | "intent" | "sync" | "link";
function state<T>(home: string, run: (db: DatabaseSync) => T) {
  const db = new DatabaseSync(join(home, "state.db"));
  try {
    db.exec(
      "PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,key))",
    );
    return run(db);
  } finally {
    db.close();
  }
}
export function indexState(home: string, kind: StateKind, key: string, payload: string) {
  state(home, (db) =>
    db.prepare("INSERT OR REPLACE INTO state VALUES (?,?,?)").run(kind, key, payload),
  );
}
export function readState(home: string, kind: StateKind, key: string): string | undefined {
  return state(home, (db) => {
    const row = db
      .prepare("SELECT payload FROM state WHERE kind = ? AND key = ?")
      .get(kind, key) as { payload: string } | undefined;
    return row?.payload;
  });
}
/** Removes every row of one kind (login clears the sync cursors). */
export function clearState(home: string, kind: StateKind) {
  state(home, (db) => db.prepare("DELETE FROM state WHERE kind = ?").run(kind));
}
