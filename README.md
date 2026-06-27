# Duraston

**Durable + Aston** — an exploration of running astonagent agents on a
durable-execution runtime ([Golem](https://golem.cloud)) instead of
request-scoped serverless.

## The problem

astonagent runs its agent loop inside an HTTP request
(`createChatRoute -> runAgent`). That shape fits interactive chat — short,
user-present turns — and is what we deployed on Vercel + Neon. It does **not**
fit "always-on" agents: autonomous multi-step loops, scheduled/background work,
or sessions that must outlive the request that started them. A serverless
function's lifetime is tied to a single request — wall-clock caps, no CPU
between requests, ephemeral non-sticky instances, progress tethered to the open
stream.

## The bet

Run the agent loop on a durable-execution runtime. Golem runs code as
WebAssembly components with transparent durable execution: every external I/O
event is journaled in an **oplog**, so a worker executes exactly-once through
crashes, restarts, and deploys, and can suspend indefinitely awaiting input.

Mapped onto our code: `runAgent`'s step loop becomes a Golem worker; each
model/tool call is oplog-journaled, so a crash at step 5 of 8 resumes at step 5
with no duplicate work and no re-burned tokens.

## Architecture

Golem replaces the agent **backend**, not the whole app — it's a worker runtime,
not a web host.

```
┌────────────────┐      invoke / stream / resume      ┌──────────────────────┐
│  Vercel (UI)   │  ───────────────────────────────►  │   Golem worker        │
│  Next.js       │  ◄───────────────────────────────  │   (durable runAgent)  │
└───────┬────────┘                                     └───────────┬──────────┘
        │                                                          │
        │ UI-queryable history                       oplog (durable agent state)
        ▼                                                          ▼
┌────────────────┐                                     ┌──────────────────────┐
│  Neon/Postgres │                                     │   Golem oplog         │
│  conversations │                                     │   exactly-once I/O    │
└────────────────┘                                     └──────────────────────┘
```

Persistence splits: the oplog owns durable agent state; Neon owns UI-queryable
conversation/message history.

## Status: exploratory, gated on a spike

This project is **gated on a TS→WASM feasibility spike** (DUR-1). If the spike
fails, the project is killed cheaply. The rest of the backlog depends on it.

| Ticket | Status | What |
| ------ | ------ | ---- |
| DUR-1  | gating spike | Compile the astonagent agent loop (TS) to a WASM component on Golem |
| DUR-2  | blocked-by-spike | Extract `runAgent` into a Golem worker (agent-per-session) |
| DUR-3  | blocked-by-spike | Golem's durable LLM interface vs astonagent's Provider abstraction |
| DUR-4  | blocked-by-spike | Persistence split: oplog (agent state) vs Neon (UI history) |
| DUR-5  | blocked-by-spike | UI↔worker API boundary (invoke, stream, resume) |
| DUR-6  | blocked-by-spike | Self-host vs Golem Cloud + maturity/ops assessment |

See [`docs/RATIONALE.md`](docs/RATIONALE.md) for the full writeup and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the component breakdown.

## Layout

```
duraston/
├── spike/      DUR-1 — the gating TS→WASM feasibility experiment (active)
├── worker/     DUR-2 — durable Golem agent worker (placeholder)
├── docs/       rationale + architecture notes
└── wit/        shared WIT world definitions for Golem components
```

## Getting started

```bash
pnpm install
pnpm --filter @duraston/spike build   # attempt the TS->WASM build
```

Out of scope: the interactive chat path, which stays on Vercel + Neon under the
astonagent project.
