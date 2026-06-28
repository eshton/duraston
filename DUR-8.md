# DUR-8 — WASM-compatible runtime data/tool layer

**Problem:** `better-sqlite3` and any native-addon data path cannot cross the
JS→WASM toolchain (DUR-1 confirmed this). So `@astonagent/db`'s **runtime** usages
— the tools and the agent loop that read/write data *inside the worker* — need a
WASM-compatible data path. (This is distinct from DUR-4, which draws the line for
*UI-facing* history.)

**Decision:** introduce a single `Store` port (`src/data/store.ts`) and pick the
backend per data tier. All three backends are WASM-friendly; the loop and tools
depend only on the interface.

---

## The three tiers (and the recommended backend for each)

| Data | Lifetime / scope | Backend | Why |
|------|------------------|---------|-----|
| Conversation / loop state | per session, agent-local | **durable oplog** (agent class fields) → `MemoryStore` locally | automatic + exactly-once on Golem; nothing to provision |
| Structured agent-private data (reminders, prefs, caches) | persists across sessions, one agent | **Golem per-agent SQLite** → `SqliteStore` (`node:sqlite`) locally | WASM SQLite, the drop-in for `better-sqlite3`; rich queries, private per agent |
| Shared / UI-queryable history | cross-session, read by the Vercel UI | **external store over HTTP** → `HttpStore` (Neon Data API / PostgREST) | pure `fetch` ⇒ WASM-safe (DUR-1); this is the DUR-4 boundary |

`MemoryStore` and `SqliteStore` pass an identical `Store` contract test, so code
is portable across tiers — you change the backend, not the tool.

## What's in the repo

| File | Role |
|------|------|
| `src/data/store.ts` | the `Store` port (namespaced async KV: put/get/list/delete) |
| `src/data/memory-store.ts` | agent-local tier (models oplog-backed durable state) |
| `src/data/sqlite-store.ts` | Golem per-agent SQLite (via `node:sqlite`) |
| `src/data/http-store.ts` | external store over fetch (PostgREST/Neon shape); injectable fetch |
| `src/data/reminder-tools.ts` | example *stateful* tools built on `Store` |
| `test/data.test.mjs` | contract across backends + HTTP request-shape + tool persistence |

## Proof (runnable: `npm test`)

```
✓ Store contract: MemoryStore
✓ Store contract: SqliteStore            (real node:sqlite round-trip)
✓ HttpStore issues PostgREST-shaped requests over fetch
✓ reminder tools persist and read back; replay is idempotent
```

The SQLite contract test runs against **real `node:sqlite`** — the same API
shape Golem exposes for per-agent SQLite — so the in-worker replacement for
`better-sqlite3` is demonstrated, not just asserted.

## Which `@astonagent/db` usages must change

- **Anything that constructs `better-sqlite3` / uses native bindings** at runtime
  → out; route through `Store`.
- **Runtime tool reads/writes** → depend on the `Store` interface, backend
  injected per tier (above).
- **Replay-safety:** keys derived from data, never `Date.now()`/random (see
  `reminderKey`), so a tool re-executed during oplog replay upserts idempotently
  — no duplicate rows. This is the data-layer half of DUR-2's determinism rule.

## Open items / hand-offs

- **DUR-4** owns the actual oplog-vs-Neon split for UI history; `HttpStore` is the
  worker-side client for the Neon half.
- **DUR-7**: `HttpStore` auth headers (and any DB connection secret) come from
  Golem Config/Secret, not ambient env.
- **DUR-2 integration:** the durable loop's tool dispatch can take a `Store`-backed
  toolset (`makeReminderTools(store)`) in place of the stub tools; wiring that
  into `runDurableAgent` is a small follow-up once the backend per tier is fixed.
