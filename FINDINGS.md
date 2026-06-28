# DUR-1 Spike — Findings

**Question:** Can a representative astonagent agent loop (TS) — the `runAgent`
loop plus its real dependencies (`zod`, a `fetch`-based provider call) — compile
and run as a Golem-style WebAssembly **component**?

**Verdict: GO. ✅**

A representative agent loop compiles cleanly to a WASM component, instantiates
under a WASI 0.2 host, and its export is callable end-to-end. The provider
`fetch` path demonstrably reaches the network from inside the sandbox. The known
blockers (native modules, ambient env) are real but already accounted for by
existing tickets (DUR-7, DUR-8) — none of them threatens feasibility.

---

## What was built

A self-contained stand-in for `runAgent` (we deliberately did **not** vendor the
astonagent repo — the spike only needs the *shape* of the code):

| File | Role |
|------|------|
| `src/agent.ts` | the bounded provider/tool loop (`runAgent`) |
| `src/tools.ts` | a 2-tool registry declared with **zod** schemas + dispatch |
| `src/provider.ts` | **fetch**-based Anthropic Messages API client |
| `src/component.ts` | binds `run-session` (the WIT export) to the loop |
| `wit/agent.wit` | the `agent-worker` world: `run-session: func(string) -> result<string,string>` |
| `probe/` | an isolated component that proves `fetch` reaches the network |

**Toolchain:** TS → (esbuild bundle) → `@bytecodealliance/jco componentize`
(StarlingMonkey / SpiderMonkey engine, the same JS→WASM path Golem's TS support
uses). Node 22, jco 1.16, componentize-js 0.18.

## Reproduce

```bash
npm install
npm run typecheck      # tsc passes
npm run build          # esbuild bundle -> jco componentize -> dist/agent.wasm
npm run inspect        # show the component's WIT (exports + WASI imports)
npm run demo           # transpile + invoke run-session through the WASI shim
```

## Evidence

1. **Compiles.** `jco componentize` produced a valid component
   `dist/agent.wasm` (~13.5 MB — the bulk is the embedded StarlingMonkey JS
   engine; it is roughly constant regardless of app size).
2. **zod survives.** zod is bundled and runs inside the component (schema
   declaration + `safeParse` dispatch are on the exercised path). zod was the
   dependency most at risk under WASM (heavy Proxy / metaprogramming) — it is
   fine.
3. **Instantiates & is callable.** `run-session("…")` returns end-to-end through
   jco's preview2 WASI host shim.
4. **`fetch` actually works (not just links).** The `probe/` component issued a
   real HTTPS `POST` to `api.anthropic.com` via `wasi:http/outgoing-handler` and
   received a genuine `HTTP 401 invalid x-api-key` — i.e. the request left the
   sandbox and hit Anthropic. The provider call path is viable.

## Host surface the component requires

`jco wit dist/agent.wasm` shows the component imports standard **WASI 0.2.10**
interfaces — this is the contract DUR-2/DUR-5/DUR-7 must satisfy on Golem:

```
wasi:io/{error,poll,streams}
wasi:cli/{stdin,stdout,stderr,terminal-*}
wasi:clocks/{monotonic-clock,wall-clock}
wasi:filesystem/{types,preopens}
wasi:random/random
wasi:http/{types,outgoing-handler}      <- backs global fetch()
```

Export: `run-session: func(prompt: string) -> result<string, string>`.

## What breaks / what to watch (feeds the other DUR tickets)

- **No native modules.** `better-sqlite3` and anything with a `.node` addon
  cannot cross the JS→WASM toolchain — confirmed by design, not just docs. The
  in-worker data path must be WASM-friendly. → **DUR-8** (and the in-worker half
  of the persistence split, **DUR-4**).
- **Ambient `process.env` does NOT cross into the sandbox.** Empirically: a key
  set in the host `process.env` was invisible to `process.env` inside the
  component (the engine has its own isolated global). Secrets must be injected
  explicitly. → **DUR-7** (Golem Config/Secret), and confirms why ambient env is
  the wrong mental model.
- **Provider abstraction choice is still open.** Our `fetch` provider works, so
  reusing `@astonagent/providers` over WASI HTTP is viable. Golem also ships a
  durable `golem:llm` host interface; whether to bind to that (durable, but
  another abstraction) or keep the fetch client is a real decision. → **DUR-3**.
- **Component size.** ~13.5 MB baseline from the embedded JS engine. Acceptable,
  but worth noting for cold-start / deploy caching. → **DUR-9**.
- **Determinism under replay.** The loop uses `Promise.all` and will (in real
  use) read clocks/randomness; on Golem those must come from the durable host so
  oplog replay is exactly-once. Not exercised here. → **DUR-2**.

## Caveats on this spike

- This proves the **toolchain + code shape**, not the **Golem durable runtime**.
  We componentized with the generic `jco` path and ran under jco's WASI shim, not
  on a Golem worker. Mapping loop steps onto the oplog and validating
  suspend/resume is **DUR-2**; running on actual Golem (self-host vs Cloud) is
  **DUR-6/DUR-9**.
- The stand-in loop is small. The real `runAgent` may pull additional deps; each
  new dep is a small re-run of this same check, but nothing observed suggests a
  categorical blocker beyond native modules.

## Recommended next steps

1. Unblock the dependent tickets — the `blocked-by-spike` gate can lift.
2. Start **DUR-2** (oplog-journaled loop) and **DUR-8** (WASM data layer) in
   parallel; they are the critical path and both `high` priority.
3. Resolve **DUR-3** (golem:llm vs fetch provider) early — it shapes how much of
   `@astonagent/providers` carries over.
