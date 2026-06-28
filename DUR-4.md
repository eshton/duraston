# DUR-4 — Persistence split: oplog (agent state) vs Neon (UI history)

**Question:** Golem's oplog replaces agent-state durability, but the UI still
needs a queryable store to list conversations/messages. Where's the line?

**Decision:** the oplog is the **source of truth for execution**; Neon/Postgres
is a **derived, queryable read-model** for the UI, built by **projecting the
worker's event stream** (DUR-5). The UI never writes agent state; the read-model
is disposable and rebuildable.

---

## The line

| Concern | Lives in | Why |
|---------|----------|-----|
| Conversation/loop state, message history *as executed*, tool results, suspension points | **Golem oplog** (+ agent class fields) | durability, exactly-once, replay — DUR-2. Authoritative. Not SQL-queryable, and that's fine. |
| Agent-private structured data (reminders, prefs) | **Golem per-agent SQLite** | DUR-8 tier 2. Private to the agent, rich queries. |
| "List my conversations", "show this thread", search, sidebar | **Neon/Postgres read-model** | the UI needs cross-session SQL the oplog can't serve. **Projected**, not authoritative. |

The pivot: **don't dual-write.** The worker doesn't write to Neon as a second
system of record (that invites divergence). Instead the worker emits an event
stream (DUR-5), and a projector turns it into Neon rows. One source of truth
(oplog), one derived view (Neon).

## How the read-model is built (runnable, tested)

`HistoryProjector` (`src/history/projector.ts`) consumes DUR-5 `ServerEvent`s and
writes read-model rows through the **DUR-8 `Store` port** — so it targets Neon via
`HttpStore` in production and `MemoryStore`/`SqliteStore` in tests, unchanged.

- `conversations` — one row per session: `status` (running/suspended/done/error),
  `lastSeq`, `preview`, `awaitingKey`. Powers the sidebar + "awaiting your input".
- `messages:<sessionId>` — ordered rows (keyed by zero-padded seq).

```
✓ a completed session projects a queryable conversation + messages
✓ suspended session is queryable as awaiting input
✓ re-projecting the same stream is idempotent (Neon rebuildable from oplog)
```

## Two properties that make the split safe

1. **Idempotent projection.** Each conversation tracks `lastSeq`; events ≤ it are
   skipped and messages are keyed by seq. So at-least-once delivery, reconnects,
   and a full rebuild all converge — **Neon can be dropped and rebuilt** by
   replaying the worker's durable stream. The oplog is authoritative; Neon is a
   cache that can never be "more correct" than the stream it came from.
2. **Serialized per session.** `apply()` is read-modify-write on the conversation
   row, so the projector serializes per session — concurrent events (live or
   pulled) can't interleave and lose updates.

## Deployment shape

```
Golem worker ──emit──> durable event stream ──pull/ordered──> HistoryProjector ──Store──> Neon
   (oplog: truth)         (DUR-5)                  (DUR-4)        (DUR-8 HttpStore)   (read-model)
```

The projector runs wherever convenient (a Vercel route consuming SSE, or a small
consumer next to the worker). Either way it only ever *derives* — losing it costs
a rebuild, never data.

## Hand-offs

- **DUR-8**: provides the `Store`/`HttpStore` the projection writes through.
- **DUR-5**: provides the event stream + seqs the projection consumes.
- **DUR-7**: Neon connection/credentials for the production `HttpStore`.
- Golem also ships a durable `rdbms/postgres` host binding (seen in the SDK) — an
  alternative for writing the read-model from *inside* the worker if we ever want
  that instead of an external projector; noted, not chosen (keeps the UI store
  outside the durable execution path).
