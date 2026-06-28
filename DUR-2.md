# DUR-2 — Extract runAgent into a durable Golem worker (agent-per-session)

**Goal:** turn the request-scoped agent loop into a durable worker where each
loop step is oplog-journaled, so a crashed run **resumes exactly-once without
re-calling the LLM**, and a session can **suspend awaiting input**.

**Status:** reference implementation + behavioral proof landed; deploy wrapper
written against the real SDK. Running it on actual Golem infra is gated on
DUR-9 (build/deploy pipeline) and DUR-6 (where the runtime lives).

---

## What the Golem model gives us for free (and what it doesn't)

From Golem's TS SDK (`@golemcloud/golem-ts-sdk`) and durability docs:

- Agents are **`@agent()` classes extending `BaseAgent`**; methods are decorated
  with `@prompt` / `@description`.
- **Durability is automatic.** Class fields and every host effect (LLM call,
  `wasi:http`, per-agent storage) are journaled to the oplog and replayed
  exactly-once after a crash or node relocation. You do **not** hand-journal.
- **Suspend/await-input** uses Golem **promises**: `createPromise()` →
  `awaitPromise(id)` (the worker suspends) → external `completePromise(id, bytes)`
  resumes it.

So DUR-2's real engineering is **not** building a journaling API — Golem owns
that — it is:

1. Restructuring `runAgent` from a request-scoped function into an
   **agent-per-session** worker whose conversation lives in durable state.
2. **Replay-safety / determinism**: nothing non-deterministic (`Date.now`,
   `Math.random`, unordered iteration) may influence control flow outside a
   journaled host call, or replay diverges. (DUR-1 already flagged this.)
3. Wiring the `ask_user` path to a Golem promise for human-in-the-loop suspend.

## What landed in this repo

A **runtime-agnostic** durable loop plus an **in-memory oplog harness** that lets
us prove the guarantees here, without a live Golem runtime:

| File | Role |
|------|------|
| `src/durable/oplog.ts` | models Golem's oplog + replay; `durable()`, `awaitInput()`, `Suspended`, `CrashError` |
| `src/durable/concierge.ts` | the durable loop — same shape as DUR-1's, every effect through the executor |
| `src/durable/session.ts` | `DurableSession`: the agent-per-session worker (owns journal+inbox, drives run/resume) |
| `src/durable/ports.ts` / `index.ts` | type surface + public exports |
| `test/durable.test.mjs` | behavioral proof (below) |
| `src/golem/agent.ts` | the real `@agent()` deploy target binding the loop to the SDK (compiles under DUR-9's pipeline) |

The harness is explicit only so behavior is observable; on Golem the executor is
implicit. The **loop logic is identical** between the tested harness and the
deploy wrapper — only the host behind the seam changes.

## Proof (runnable: `npm test`)

```
✓ exactly-once: crash mid-loop, replay does not re-call LLM or re-run tool
✓ suspend/resume: ask_user suspends the session, resumes with delivered input
✓ determinism guard: oplog divergence is detected
```

- **Exactly-once.** A run crashes (`CrashError`) after `llm:0` is journaled but
  before the tool runs. Recovery replays `llm:0` from the oplog — the scripted
  LLM is provably **not** re-invoked (total real calls = 2 for a 2-round convo,
  not 3) — and the tool executes exactly once.
- **Suspend/resume.** When the model calls `ask_user`, the session suspends with
  a key; after `provideInput(key, answer)` it resumes, replaying `llm:0` from the
  oplog (not re-called) and continuing to the final answer.
- **Determinism guard.** Corrupting the journal's op sequence (what a stray
  `Date.now()` would cause) is caught as an `oplog divergence` error rather than
  silently corrupting the run.

## Harness → Golem mapping

| harness (`src/durable`) | Golem runtime |
|-------------------------|----------------|
| `DurableExecutor.durable()` | automatic oplog journaling of host calls |
| `llm(messages, tools)` | DUR-1 fetch provider over `wasi:http` (journaled), or durable `golem:llm` → **DUR-3** |
| `awaitInput(key)` | `createPromise` + `awaitPromise` (worker suspends) |
| `provideInput(key, v)` | `completePromise(id, payload)` |
| `session.state` (journal/inbox) | automatic durable class state |

## Open items this surfaces

- **Provider binding (DUR-3):** fetch-over-`wasi:http` works and is journaled;
  decide vs `golem:llm`. The `llm` seam in `src/golem/agent.ts` is where it lands.
- **Secrets (DUR-7):** `src/golem/agent.ts` reads the key from Golem Config, not
  ambient env (DUR-1 proved env doesn't cross the sandbox).
- **In-worker data (DUR-8):** the demo tools are pure; real tools that read/write
  state need the WASM-compatible data path.
- **Build/deploy (DUR-9):** `src/golem/agent.ts` needs `golem build` to compile.
- **Streaming (DUR-5):** this models run-to-completion + suspend; token streaming
  back to the UI is a separate boundary concern.
