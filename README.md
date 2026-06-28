# Duraston

**Durable + Aston.** Exploration of running [astonagent](https://github.com/eshton/astonagent)
agents on [Golem](https://golem.cloud)'s durable-execution runtime (WebAssembly
workers + oplog) so agent sessions can be **always-running / autonomous** — a
durable **personal concierge agent** — instead of request-scoped serverless.
Frontend stays on Vercel; Golem hosts the durable agent backend.

The whole effort is gated on a TS→WASM feasibility spike (**DUR-1**). This repo
currently holds that spike.

## DUR-1 spike — status: GO ✅

A representative agent loop (loop + `zod` tool schemas + `fetch`-based provider)
compiles to a WASM component, instantiates under a WASI 0.2 host, and its
`run-session` export is callable end-to-end — and `fetch` demonstrably reaches
the network from inside the sandbox.

See **[FINDINGS.md](./FINDINGS.md)** for the full write-up, evidence, the WASI
host surface the component needs, and how each result feeds the downstream DUR
tickets.

## DUR-2 — durable agent loop (agent-per-session)

A runtime-agnostic durable loop with an in-memory oplog harness that proves the
two guarantees the move to Golem is for: **exactly-once across a crash** (replay
does not re-call the LLM or re-run a tool) and **suspend/resume** awaiting user
input. The real `@agent()` deploy wrapper (`src/golem/agent.ts`) binds the same
loop to the Golem TS SDK. See **[DUR-2.md](./DUR-2.md)**.

## DUR-8 — WASM-compatible data layer

`better-sqlite3` can't cross to WASM, so in-worker tools/state use a single
`Store` port with three WASM-friendly backends: agent-local (oplog),
**Golem per-agent SQLite** (`node:sqlite`), and **external over HTTP** (Neon/
PostgREST via `fetch`). All backends share one contract. See **[DUR-8.md](./DUR-8.md)**.

```bash
npm test   # builds + runs all DUR-2 and DUR-8 tests
```

## DUR-9 — build & deploy pipeline

`golem.yaml` manifest + GitHub Actions: PR CI runs typecheck (incl. the Golem
deploy target against the real SDK), tests, and a jco component smoke build;
the gated deploy workflow installs the Golem CLI, runs `golem app build` (cached)
and a reviewer-gated `golem app deploy`. See **[DUR-9.md](./DUR-9.md)**.

## DUR-3 — provider abstraction

A `Provider` port behind the loop's `llm` seam: an Anthropic adapter (reuses the
DUR-1 fetch client) and an OpenAI/**Ollama**-compatible adapter, plus a
`golem:llm` reference. Decision: adapt `@astonagent/providers` (proven, durable
for free, max carryover; Ollama = a base-URL swap), keep `golem:llm` as a
drop-in option. The loop runs unchanged when the provider is swapped. See
**[DUR-3.md](./DUR-3.md)**.

## DUR-5 — UI↔worker boundary

The contract for the Vercel frontend to **invoke** a worker, **stream** results
(SSE), and **resume/reconnect** a suspended session. Every event carries a
monotonic `seq`, so reconnect = replay-since-cursor and resume = deliver input to
a suspended session. `SessionGateway` wraps a `DurableSession` and is fully
tested in-process. See **[DUR-5.md](./DUR-5.md)**.

## DUR-4 — persistence split (oplog vs Neon)

The oplog is the source of truth for execution; Neon/Postgres is a **derived
read-model** for the UI, built by projecting the DUR-5 event stream through the
DUR-8 `Store`. No dual-writes; the read-model is idempotent and rebuildable from
the stream. See **[DUR-4.md](./DUR-4.md)**.

### Layout (additions)

```
src/providers/        DUR-3: Provider port + Anthropic / OpenAI-Ollama adapters
src/boundary/         DUR-5: UI<->worker protocol, SessionGateway, SSE transport
src/history/          DUR-4: HistoryProjector — UI read-model from the event stream
src/golem/            DUR-2/3: @agent() deploy target + golem:llm reference
```

### Layout

```
src/                  DUR-1 spike: runAgent loop, tools (zod), fetch provider
src/durable/          DUR-2: durable loop + in-memory oplog harness
src/data/             DUR-8: Store port + memory/sqlite/http backends, stateful tools
src/golem/agent.ts    DUR-2: real @agent() deploy target (builds under DUR-9)
wit/agent.wit         the agent-worker component world
probe/                isolated component proving wasi:http fetch works
test/                 behavioral tests (durability + data layer)
scripts/demo.mjs      invoke the built component through jco's WASI shim
```

### Build & run

```bash
npm install
npm run typecheck   # tsc (excludes src/golem — that needs the Golem pipeline)
npm run build       # esbuild bundle -> jco componentize -> dist/agent.wasm
npm run inspect     # print the component's WIT (exports + WASI imports)
npm run demo        # transpile + call run-session end-to-end
npm test            # DUR-2 durability tests (exactly-once, suspend/resume)
```

Requires Node 22+. The WASM toolchain (`jco`, `componentize-js`) installs as a
dev dependency — no separate Golem CLI needed for the spike.
