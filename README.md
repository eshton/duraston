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

```bash
npm test   # builds dist/durable.js, runs the durability tests
```

### Layout

```
src/                  DUR-1 spike: runAgent loop, tools (zod), fetch provider
src/durable/          DUR-2: durable loop + in-memory oplog harness
src/golem/agent.ts    DUR-2: real @agent() deploy target (builds under DUR-9)
wit/agent.wit         the agent-worker component world
probe/                isolated component proving wasi:http fetch works
test/                 durability behavioral tests
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
