/**
 * SQLite-backed Store. Locally this uses Node's built-in `node:sqlite`
 * (DatabaseSync); on Golem it maps to per-agent private SQLite exposed through
 * the TS SDK's node-sqlite-extensions. Crucially this is a *WASM* SQLite, not
 * the native `better-sqlite3` addon that DUR-1 ruled out — same ergonomics,
 * WASM-compatible. This is the recommended in-worker backend for structured,
 * agent-private data.
 */
import { DatabaseSync } from "node:sqlite";
import type { Store, StoredItem } from "./store.js";

export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  /** @param path file path, or ":memory:" (default). */
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS kv (
         namespace TEXT NOT NULL,
         key       TEXT NOT NULL,
         value     TEXT NOT NULL,
         PRIMARY KEY (namespace, key)
       )`,
    );
  }

  async put(namespace: string, key: string, value: unknown): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO kv (namespace, key, value) VALUES (?, ?, ?)
         ON CONFLICT (namespace, key) DO UPDATE SET value = excluded.value`,
      )
      .run(namespace, key, JSON.stringify(value));
  }

  async get<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    const row = this.db
      .prepare(`SELECT value FROM kv WHERE namespace = ? AND key = ?`)
      .get(namespace, key);
    return row ? (JSON.parse(row.value as string) as T) : undefined;
  }

  async list<T = unknown>(namespace: string): Promise<StoredItem<T>[]> {
    return this.db
      .prepare(`SELECT key, value FROM kv WHERE namespace = ? ORDER BY key`)
      .all(namespace)
      .map((row) => ({
        key: row.key as string,
        value: JSON.parse(row.value as string) as T,
      }));
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.db.prepare(`DELETE FROM kv WHERE namespace = ? AND key = ?`).run(namespace, key);
  }

  close(): void {
    this.db.close();
  }
}
