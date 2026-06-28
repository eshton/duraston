# DUR-7 — Secrets/config injection into the WASM sandbox

**Problem:** the ported worker needs provider credentials + config inside its
isolated WebAssembly sandbox. DUR-1 proved **ambient `process.env` does not cross
into the component**, so config must arrive through an explicit host channel —
Golem's Config/Secret (`wasi:config/store`), not env.

**Decision:** a `ConfigSource` port the worker reads through; secrets are wrapped
in a redacting `SecretValue`; provider + keys are selected from config so
swapping Anthropic ⇄ Ollama is a config change, not a redeploy.

---

## The astonagent env → Golem Config/Secret mapping

| astonagent env var | Kind | Golem | Read as |
|--------------------|------|-------|---------|
| `ANTHROPIC_API_KEY` | **secret** | Secret / `wasi:config` | `cfg.secret(...)` |
| `LLM_API_KEY` (OpenAI/Grok; optional for Ollama) | **secret** | Secret | `cfg.secret(...)` |
| `ANTHROPIC_MODEL`, `LLM_MODEL` | config | `wasi:config` | `cfg.get(...)` |
| `LLM_BASE_URL` (e.g. Ollama host) | config | `wasi:config` | `cfg.require(...)` |
| `DURASTON_PROVIDER` (`anthropic`\|`openai-compat`) | config | `wasi:config` | `cfg.get(...)` |

Keys live in `src/config/config.ts` (`KEYS`). `providerFromConfig(cfg)` reads them
and builds the DUR-3 provider — the single place env-config becomes a live client.

## What's in the repo

| File | Role |
|------|------|
| `src/config/config.ts` | `ConfigSource` port, `SecretValue` (redacting), `MapConfig` (dev/Vercel), `KEYS` |
| `src/config/factory.ts` | `providerFromConfig` — env-config → DUR-3 provider |
| `src/golem/golem-config.ts` | Golem adapter over `wasi:config/store` (deploy-side) |
| `src/golem/agent.ts` | now builds its provider via `providerFromConfig(new GolemConfig())` |
| `test/config.test.mjs` | port behavior, redaction, provider selection |

## The security property: secrets can't leak by accident

`SecretValue` renders as `[redacted]` in `String()`, template literals, and
`JSON.stringify`; the raw value is only reachable via `.expose()`, called at the
exact point of use (the HTTP `x-api-key` header). So a stray `console.log(cfg)`
or structured-log of a request context cannot spill a key.

```
✓ SecretValue refuses to render itself; expose() is the only way out
✓ MapConfig: get / require / secret
✓ providerFromConfig builds Anthropic by default
✓ providerFromConfig builds the Ollama (openai-compat) path from config
✓ missing required secret/config fails fast
```

The Golem adapter (`agent.ts` + `golem-config.ts`) typechecks against the real
SDK / `wasi:config` in `typecheck:golem`.

## Provisioning & rotation

- **Provisioning (per worker/owner):** secrets are set on the component/agent at
  deploy time. The CI deploy job (DUR-9) provisions `ANTHROPIC_API_KEY` from a
  per-environment GitHub secret onto the Golem component; per-owner scoping rides
  on Golem's agent identity (one agent instance per session/owner).
- **Rotation:** `wasi:config/store.get` re-reads on every call (the SDK's
  `Secret.get()` is documented to "lazily load or reload"), so rotating a secret
  in the host takes effect on the worker's **next read** — no redeploy.
- **Replay safety (ties to DUR-2):** secret *values* must never steer control
  flow, or oplog replay could diverge when a key rotates mid-session. Keys are
  only read at the point of an HTTP call (itself journaled), so a rotated key
  simply applies to subsequent live calls and never corrupts replay.

## Hand-offs

- **DUR-9**: the deploy job's secret-provisioning step (`golem component env set`)
  is the provisioning mechanism; finalize the exact CLI invocation against the
  installed Golem CLI.
- **DUR-4/DUR-8**: the Neon `HttpStore` auth header is itself a `cfg.secret(...)`.
