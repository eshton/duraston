/**
 * In-memory Store. Models agent-local state which, on Golem, is held in durable
 * agent class fields and journaled to the oplog automatically — so this backend
 * is "free" and exactly-once on the real runtime. Values are deep-cloned on the
 * way in/out so callers cannot mutate stored state by reference (matching the
 * serialize-on-persist semantics of the durable backends).
 */
import type { Store, StoredItem } from "./store.js";

export class MemoryStore implements Store {
  private readonly data = new Map<string, Map<string, string>>();

  private ns(namespace: string): Map<string, string> {
    let m = this.data.get(namespace);
    if (!m) {
      m = new Map();
      this.data.set(namespace, m);
    }
    return m;
  }

  async put(namespace: string, key: string, value: unknown): Promise<void> {
    this.ns(namespace).set(key, JSON.stringify(value));
  }

  async get<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    const raw = this.ns(namespace).get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async list<T = unknown>(namespace: string): Promise<StoredItem<T>[]> {
    return [...this.ns(namespace).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, raw]) => ({ key, value: JSON.parse(raw) as T }));
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.ns(namespace).delete(key);
  }
}
