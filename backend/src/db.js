import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS dishes (
    dish_id      TEXT PRIMARY KEY,
    dish_name    TEXT NOT NULL,
    image_url    TEXT NOT NULL,
    is_published INTEGER NOT NULL CHECK (is_published IN (0, 1)),
    version      INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
  );
`;

/** Opens (creating if needed) a SQLite database. Use ":memory:" for tests. */
export function openDb(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  return db;
}
