# DUR-3 — Golem's durable LLM interface vs astonagent's Provider abstraction

**Question:** reuse Golem's vendor-neutral durable `golem:llm`, or adapt
`@astonagent/providers`? Especially for the Ollama path. This decides how much
provider code carries over.

**Decision: adapt `@astonagent/providers` behind a `Provider` port as the
default; keep a `golem:llm` adapter as a drop-in option.** Both sit behind the
same port, so the choice is reversible per deployment and the agent loop never
changes.

---

## Key finding that drives the call

`golem:llm` is **not** part of `@golemcloud/golem-ts-sdk`. The installed SDK
ships durable bindings for `rdbms` (Postgres/MySQL), `keyvalue`, `config`,
`durability`, `websocket`, and per-agent SQLite — but **no llm**. `golem:llm` is
a **separate component** (golemcloud/golem-llm) you compose into the app and
reach through generated bindings. So "use golem:llm" is not free reuse — it is
adopting and composing another dependency and mapping our types onto its WIT.

Meanwhile the **fetch path is already proven** (DUR-1: a real call left the WASM
sandbox over `wasi:http`) and is **auto-journaled by Golem** — i.e. it is durable
for free, the main thing golem:llm would buy us.

## Why adapt `@astonagent/providers` (the fetch path)

- **Maximum carryover.** `AnthropicProvider` literally reuses the DUR-1
  `createMessage` client (`src/provider.ts`). Existing provider code keeps working.
- **Durable already.** Golem journals the `wasi:http` response, so crash/replay
  returns the same completion without re-calling — the DUR-2 exactly-once test
  relies on exactly this.
- **Tool-calling fidelity.** We control the exact request/response, so Anthropic
  tool-use maps 1:1 with no lossy intermediate schema.
- **Ollama is just a base URL.** Ollama exposes the OpenAI `/chat/completions`
  shape, so `OpenAICompatProvider` covers Ollama, OpenAI, Grok, vLLM, LM Studio —
  point `baseUrl` at the host, pick a model. No per-provider code.

## When golem:llm wins (kept as an option)

- You want to **swap providers by config**, not code, across many agents.
- You want Golem to own **provider-side streaming / retry / rate-limit** behavior.
- You prefer one managed dependency over maintaining provider clients.

The `GolemLlmProvider` reference (`src/golem/golem-llm-provider.ts`) shows the
mapping behind the identical `Provider` port; switching is a one-line wiring
change.

## What's in the repo

| File | Role |
|------|------|
| `src/providers/provider.ts` | the `Provider` port + `asLlmFn` (bridges to the DUR-2 loop seam) |
| `src/providers/anthropic.ts` | Anthropic adapter — reuses the DUR-1 fetch client |
| `src/providers/openai-compat.ts` | OpenAI/**Ollama** adapter incl. full message + tool-call translation |
| `src/golem/golem-llm-provider.ts` | `golem:llm` reference adapter (deploy-side; honest caveat inside) |
| `test/providers.test.mjs` | request/response + tool mapping + provider-swap through the loop |

## Proof (runnable: `npm test`)

```
✓ AnthropicProvider posts to the Messages API and returns normalized blocks
✓ OpenAICompatProvider maps tools + tool_calls (the Ollama path)
✓ OpenAICompat translates the loop's block protocol into OpenAI messages
✓ provider is swappable: the durable loop runs unchanged via asLlmFn
```

The last test is the thesis: the **same `DurableSession`** runs to completion
against an OpenAI/Ollama-compatible backend with no loop changes — only the
object behind `Provider` differs.

## Hand-offs

- **DUR-2**: the loop's `llm` seam is now `asLlmFn(provider)`; the deploy wrapper
  (`src/golem/agent.ts`) can construct whichever provider per environment.
- **DUR-5**: streaming. This models request/response; token streaming to the UI
  is where golem:llm's streaming support (or SSE over `wasi:http`) gets revisited.
- **DUR-7**: provider keys/base URLs come from Golem Config/Secret.
