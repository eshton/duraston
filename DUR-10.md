# DUR-10 — Observability & debugging for durable workers

**Problem:** debugging long-lived WASM workers is materially harder than
request-scoped serverless. We need logs, a way to inspect the oplog to understand
a session's replayed history, and a way to diagnose a stuck or failed run.

**Status:** runnable primitives landed — structured logging with secret
redaction, an oplog-journal renderer, and a stream diagnoser. The Golem-side
hooks (CLI oplog dump, platform log capture) are noted as the deploy-time
complement.

---

## What's in the repo

| File | Role |
|------|------|
| `src/observability/logger.ts` | structured JSON logger; redacts secrets (DUR-7 contract + sensitive-key masking) |
| `src/observability/inspector.ts` | `inspectJournal` (oplog → trace), `diagnoseStream` (stuck/failed/done), `formatTrace` |
| `test/observability.test.mjs` | redaction, trace classification, diagnosis |

## Three operability primitives

1. **Structured logs that can't leak secrets.** `Logger` emits one JSON object
   per line with `level` + `sessionId`, and `redact()` masks both `SecretValue`
   (anything that renders as `[redacted]`) and sensitive-looking keys
   (`api_key`, `authorization`, `token`, …) recursively. On Golem these lines go
   to the worker's stdout, captured per worker.

2. **Read the oplog as a trace.** `inspectJournal(state)` turns the DurableExecutor
   journal (DUR-2 — the oplog) into ordered, classified entries:
   ```
   #0 [llm]  llm:0  — stop=tool_use blocks=1
   #1 [tool] tool:t1 — result=(stub) current time in UTC
   #2 [llm]  llm:1  — stop=end_turn blocks=1
   ```
   This is how you reproduce a stuck/failed run: see exactly which effects were
   journaled (and replayed) and where it stopped.

3. **Diagnose a session from its stream.** `diagnoseStream(events)` (DUR-5
   events) answers the first operational question — is it `running`, `suspended`
   (and **on what input key**), `done`, or `error` (with the message)? — plus
   model/tool call counts and the last seq.

```
✓ logger emits structured JSON and redacts secrets
✓ redact masks SecretValue-like objects and sensitive keys
✓ inspectJournal renders the oplog as a classified trace
✓ diagnoseStream identifies a suspended session and what it awaits
✓ diagnoseStream reports done with model-call count
```

## Mapping to Golem (deploy-time complement)

- **Logs:** `Logger` → worker stdout, captured by the platform per worker.
- **Oplog inspection:** `inspectJournal`'s classification/summary applies to the
  real oplog entries dumped via the Golem CLI; the same `op` naming
  (`llm:`/`tool:`/`await:`) is what makes a live oplog readable.
- **Tracing:** the SDK exposes span/context bindings (`golem:api/context`) — wire
  `Logger` fields (sessionId, seq) into spans so logs, traces, and oplog line up.
- **Stuck-run runbook:** `diagnoseStream` first (suspended? on what key? errored?);
  if suspended, the awaited promise key tells you what input is missing; if
  errored, the message + the journal tail show where it stopped.

## Hand-offs

- **DUR-9**: add a post-deploy smoke invocation that logs a `diagnoseStream`
  summary, and surface worker logs in CI artifacts.
- **DUR-2**: the per-tool `tool_use` event (a small loop hook) would enrich both
  the stream diagnosis and the trace.
