import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
export function indexState(
  home: string,
  kind: "receipt" | "history" | "intent",
  key: string,
  payload: string,
) {
  const db = new DatabaseSync(join(home, "state.db"));
  try {
    db.exec(
      "PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (kind TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,key))",
    );
    db.prepare("INSERT OR REPLACE INTO state VALUES (?,?,?)").run(kind, key, payload);
  } finally {
    db.close();
  }
}
