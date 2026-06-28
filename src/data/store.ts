/**
 * DUR-8: the WASM-compatible data path for in-worker tools and the agent loop.
 *
 * `better-sqlite3` (native addon) cannot cross the JS->WASM toolchain — DUR-1
 * confirmed that empirically. So `@astonagent/db`'s runtime usages need a
 * data abstraction that has only WASM-friendly backends. `Store` is that
 * abstraction: a namespaced async key/value surface that maps onto all three
 * viable backends —
 *
 *   - MemoryStore   : agent-local state; on Golem this IS the durable oplog
 *                     (automatic class-field persistence). Free, exactly-once.
 *   - SqliteStore   : Golem per-agent private SQLite (node:sqlite shape, a
 *                     WASM SQLite — the drop-in for better-sqlite3 in-worker).
 *   - HttpStore     : an external store reached over fetch/HTTP (e.g. Neon Data
 *                     API). Pure fetch => WASM-friendly (DUR-1 proved fetch works).
 *
 * Tools and the loop depend only on this interface; the backend is chosen per
 * data tier (see DUR-8.md) and is the single thing DUR-4's persistence split
 * decides.
 */
export interface StoredItem<T = unknown> {
  key: string;
  value: T;
}

export interface Store {
  /** Upsert a JSON-serializable value under (namespace, key). */
  put(namespace: string, key: string, value: unknown): Promise<void>;
  /** Read a value, or undefined if absent. */
  get<T = unknown>(namespace: string, key: string): Promise<T | undefined>;
  /** List all items in a namespace, ordered by key (deterministic for replay). */
  list<T = unknown>(namespace: string): Promise<StoredItem<T>[]>;
  /** Remove a value; no-op if absent. */
  delete(namespace: string, key: string): Promise<void>;
}
