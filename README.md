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

### Layout

```
src/              representative runAgent loop, tools (zod), fetch provider
wit/agent.wit     the agent-worker component world
probe/            isolated component proving wasi:http fetch works
scripts/demo.mjs  invoke the built component through jco's WASI shim
```

### Build & run

```bash
npm install
npm run typecheck   # tsc
npm run build       # esbuild bundle -> jco componentize -> dist/agent.wasm
npm run inspect     # print the component's WIT (exports + WASI imports)
npm run demo        # transpile + call run-session end-to-end
```

Requires Node 22+. The WASM toolchain (`jco`, `componentize-js`) installs as a
dev dependency — no separate Golem CLI needed for the spike.
