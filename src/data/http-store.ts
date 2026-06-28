/**
 * HTTP-backed Store: reaches an external datastore over fetch/HTTP, so it is
 * WASM-friendly by construction (DUR-1 proved fetch works inside the component).
 * The request shape here is PostgREST-style, which is what Neon's Data API and
 * Supabase expose — the likely target for UI-queryable history (see DUR-4).
 *
 * Backing table assumed:
 *   kv (namespace text, key text, value jsonb, primary key (namespace, key))
 *
 * `fetch` is injectable so the contract can be tested without a live endpoint;
 * in the worker it defaults to the global (host-backed) fetch.
 */
import type { Store, StoredItem } from "./store.js";

export type FetchLike = typeof fetch;

export interface HttpStoreOptions {
  /** Base URL of the data API, e.g. https://<proj>.neon.tech/rest/v1 */
  baseUrl: string;
  /** Auth/headers (e.g. apikey / Authorization) injected from Golem Config (DUR-7). */
  headers?: Record<string, string>;
  /** Injectable fetch; defaults to the global host fetch. */
  fetchImpl?: FetchLike;
}

export class HttpStore implements Store {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(opts: HttpStoreOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.headers = { "content-type": "application/json", ...(opts.headers ?? {}) };
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private url(query: string): string {
    return `${this.baseUrl}/kv?${query}`;
  }

  private eq(namespace: string, key: string): string {
    return `namespace=eq.${encodeURIComponent(namespace)}&key=eq.${encodeURIComponent(key)}`;
  }

  async put(namespace: string, key: string, value: unknown): Promise<void> {
    // Upsert: PostgREST merges duplicates with this Prefer header.
    const res = await this.fetchImpl(this.url("on_conflict=namespace,key"), {
      method: "POST",
      headers: { ...this.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ namespace, key, value }),
    });
    if (!res.ok) throw new Error(`HttpStore.put ${res.status}`);
  }

  async get<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    const res = await this.fetchImpl(this.url(`${this.eq(namespace, key)}&select=value`), {
      method: "GET",
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`HttpStore.get ${res.status}`);
    const rows = (await res.json()) as Array<{ value: T }>;
    return rows.length ? rows[0].value : undefined;
  }

  async list<T = unknown>(namespace: string): Promise<StoredItem<T>[]> {
    const res = await this.fetchImpl(
      this.url(`namespace=eq.${encodeURIComponent(namespace)}&select=key,value&order=key`),
      { method: "GET", headers: this.headers },
    );
    if (!res.ok) throw new Error(`HttpStore.list ${res.status}`);
    const rows = (await res.json()) as Array<{ key: string; value: T }>;
    return rows.map((r) => ({ key: r.key, value: r.value }));
  }

  async delete(namespace: string, key: string): Promise<void> {
    const res = await this.fetchImpl(this.url(this.eq(namespace, key)), {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`HttpStore.delete ${res.status}`);
  }
}
