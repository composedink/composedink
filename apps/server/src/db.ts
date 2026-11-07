import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { MIGRATIONS } from "./migrations/index.ts";

/** Opens `<storage>/server.db` and applies every migration above `user_version` in one transaction. */
export function openDatabase(storage: string, migrations: readonly string[] = MIGRATIONS) {
  const db = new DatabaseSync(join(storage, "server.db"));
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
    );
    migrate(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export function migrate(db: DatabaseSync, migrations: readonly string[]) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const { user_version: current } = db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    for (let version = current + 1; version <= migrations.length; version++) {
      db.exec(migrations[version - 1]);
      db.exec(`PRAGMA user_version = ${version}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Runs `work` inside `BEGIN IMMEDIATE`, committing on return and rolling back on throw. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
