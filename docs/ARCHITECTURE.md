# Architecture

Golem replaces the agent **backend** only. The web host, UI, and the
queryable conversation store stay where they are.

## Components

| Component | Lives on | Owns | Ticket |
| --------- | -------- | ---- | ------ |
| Frontend / chat UI | Vercel (Next.js) | rendering, auth, invoking workers | out of scope (astonagent) |
| Durable agent worker | Golem (WASM component) | the `runAgent` step loop, durable agent state | DUR-2 |
| LLM calls | Golem durable LLM iface **or** `@astonagent/providers` | model I/O, journaled in oplog | DUR-3 |
| Agent-state durability | Golem oplog | exactly-once replay of every external I/O event | DUR-2 / DUR-4 |
| UI history store | Neon / Postgres | queryable conversations & messages for the UI | DUR-4 |
| UI↔worker boundary | HTTP / RPC | invoke, stream, resume a suspended session | DUR-5 |
| Runtime hosting | self-host vs Golem Cloud | where the durable runtime runs; ops/maturity | DUR-6 |

## The durable mapping (the core idea)

```
runAgent step loop                Golem worker
─────────────────────             ─────────────────────────────
for step in 1..N:                 each iteration is durable
  msg = llm.call(...)    ───────► oplog-journaled external I/O
  if toolcall:                    (replayed, not re-executed,
    result = tool(...)   ───────►  on crash/restart/deploy)
  append to transcript            in-worker state survives
suspend awaiting input  ───────►  worker sleeps indefinitely,
                                  wakes on next invocation
```

A crash at step 5 of 8 resumes at step 5: no duplicate model calls, no
re-burned tokens. A session can suspend between turns and be resumed by a
later invocation from the UI.

## Persistence split (DUR-4)

- **Oplog (Golem):** the source of truth for *agent execution state* — the
  step the worker is on, pending tool calls, intermediate results. Not
  designed to be queried by the UI.
- **Neon/Postgres:** the source of truth for *UI-facing history* — the list
  of conversations and their messages, queryable for rendering and search.

The open question is exactly where the line falls and how the two stay
consistent (e.g. the worker writes completed turns to Neon as a journaled
side effect).

## Open decisions

These are intentionally unresolved until the spike (DUR-1) answers the gating
TS→WASM question. See [RATIONALE.md](RATIONALE.md#risks--open-questions).
