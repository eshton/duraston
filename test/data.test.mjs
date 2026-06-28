/**
 * DUR-8 data-layer tests.
 *  - one Store contract, run against every WASM-compatible backend (memory +
 *    sqlite) so they are provably interchangeable;
 *  - HttpStore request-shape verified against a stub fetch (no live endpoint);
 *  - stateful reminder tools actually persist and read back through a Store.
 *
 * Run: npm test  (uses node --experimental-sqlite)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryStore,
  SqliteStore,
  HttpStore,
  makeReminderTools,
} from "../dist/data.js";

// --- shared contract ---------------------------------------------------------
function contract(name, makeStore) {
  test(`Store contract: ${name}`, async () => {
    const store = makeStore();
    assert.equal(await store.get("ns", "missing"), undefined);

    await store.put("ns", "b", { n: 2 });
    await store.put("ns", "a", { n: 1 });
    assert.deepEqual(await store.get("ns", "a"), { n: 1 });

    // upsert overwrites, does not duplicate
    await store.put("ns", "a", { n: 99 });
    assert.deepEqual(await store.get("ns", "a"), { n: 99 });

    // list is ordered by key and namespace-scoped
    await store.put("other", "z", { n: 0 });
    const items = await store.list("ns");
    assert.deepEqual(
      items.map((i) => i.key),
      ["a", "b"],
    );

    await store.delete("ns", "a");
    assert.equal(await store.get("ns", "a"), undefined);
    assert.equal((await store.list("ns")).length, 1);
  });
}

contract("MemoryStore", () => new MemoryStore());
contract("SqliteStore", () => new SqliteStore(":memory:"));

// --- HttpStore request shapes ------------------------------------------------
test("HttpStore issues PostgREST-shaped requests over fetch", async () => {
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    // emulate a list response for GET, empty for others
    const isList = init?.method === "GET" && url.includes("select=key,value");
    return {
      ok: true,
      status: 200,
      async text() {
        return "";
      },
      async json() {
        return isList ? [{ key: "a", value: { n: 1 } }] : [];
      },
    };
  };

  const store = new HttpStore({
    baseUrl: "https://db.example/rest/v1",
    headers: { apikey: "secret" },
    fetchImpl: stubFetch,
  });

  await store.put("reminders", "a", { n: 1 });
  const putCall = calls.at(-1);
  assert.equal(putCall.method, "POST");
  assert.match(putCall.url, /\/kv\?on_conflict=namespace,key$/);
  assert.equal(putCall.headers.Prefer, "resolution=merge-duplicates");
  assert.equal(putCall.headers.apikey, "secret");
  assert.deepEqual(JSON.parse(putCall.body), {
    namespace: "reminders",
    key: "a",
    value: { n: 1 },
  });

  const items = await store.list("reminders");
  assert.deepEqual(items, [{ key: "a", value: { n: 1 } }]);
  assert.match(calls.at(-1).url, /namespace=eq\.reminders&select=key,value&order=key/);
});

// --- stateful tools through a Store ------------------------------------------
test("reminder tools persist and read back; replay is idempotent", async () => {
  const store = new MemoryStore();
  const tools = makeReminderTools(store);
  const add = tools.find((t) => t.name === "add_reminder");
  const list = tools.find((t) => t.name === "list_reminders");

  await add.handler({ text: "call mom", when: "2026-06-29T09:00:00Z" });
  await add.handler({ text: "pay rent", when: "2026-07-01T08:00:00Z" });

  const listed = await list.handler({});
  assert.match(listed, /call mom/);
  assert.match(listed, /pay rent/);

  // Re-running the same add (an oplog replay) must NOT create a duplicate.
  await add.handler({ text: "call mom", when: "2026-06-29T09:00:00Z" });
  assert.equal((await store.list("reminders")).length, 2);
});
