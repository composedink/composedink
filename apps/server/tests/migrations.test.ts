import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vite-plus/test";
import { openDatabase } from "../src/db.ts";
import { MIGRATIONS } from "../src/migrations/index.ts";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
const storage = async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-migrations-"));
  homes.push(home);
  return home;
};
const version = (db: DatabaseSync) =>
  (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const tables = (db: DatabaseSync) =>
  (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);

it("brings a fresh database to user_version 2 with WAL and foreign keys", async () => {
  const db = openDatabase(await storage());
  expect(version(db)).toBe(2);
  expect(tables(db)).toEqual(["accounts", "devices", "docs", "pairing_codes", "updates"]);
  expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  db.close();
});

it("treats a rerun as a no-op", async () => {
  const home = await storage();
  openDatabase(home).close();
  const db = openDatabase(home);
  expect(version(db)).toBe(2);
  db.close();
});

it("rolls back a failing migration without a partial table", async () => {
  const home = await storage();
  openDatabase(home).close();
  const broken = [...MIGRATIONS, "CREATE TABLE partial (x INTEGER); SELECT nope FROM missing;"];
  expect(() => openDatabase(home, broken)).toThrow(/missing/);
  const db = new DatabaseSync(join(home, "server.db"));
  expect(version(db)).toBe(2);
  expect(tables(db)).not.toContain("partial");
  db.close();
});
