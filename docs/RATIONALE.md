# Duraston (Durable + Aston)

Exploring a durable-execution runtime for astonagent agents.

## Why

The astonagent framework runs its agent loop inside an HTTP request
(`createChatRoute -> runAgent`). That's the right shape for interactive chat —
short, user-present turns — and it's what we deployed on Vercel + Neon. But it
does not fit "always-on" in the sense of agents that keep working on their own:
autonomous multi-step loops, scheduled/background work, or sessions that must
outlive the request that started them.

Serverless is wrong for that case by construction: a function's lifetime is
tied to a single request. It's killed at a wall-clock cap (a problem already
flagged for the slow large Ollama Cloud models), it has no CPU between or after
requests, instances are ephemeral and non-sticky (no in-memory session, no
timers, no background tasks survive), and progress is tethered to the open
stream — a client disconnect aborts the run. Interactive chat lives happily in
that box; autonomous agents cannot.

## The bet

Run the agent loop on a durable-execution runtime instead. Golem (golem.cloud)
is an open-source, agent-native platform that runs code as WebAssembly
components with transparent durable execution: every external I/O event is
journaled in an oplog, so a worker executes exactly-once through crashes,
restarts, and deploys, and can suspend indefinitely awaiting input. It ships a
vendor-neutral durable LLM interface (OpenAI, Anthropic, Grok, Ollama), and is
self-hostable as well as managed — which reconciles the original
"run-it-on-my-machine" instinct with "always-on" (self-host the durable runtime
and still get immortal agents).

Mapped onto our code: `runAgent`'s step loop becomes a Golem worker; each
model/tool call is oplog-journaled, so a crash at step 5 of 8 resumes at step 5
with no duplicate work and no re-burned tokens. The session can sleep and wake
later. This is the same category as Temporal and Cloudflare Workflows/Durable
Objects; Golem's distinction is WASM components, self-hostability, and the
write-normal-code-get-invincibility model.

## Architecture

Golem replaces the agent *backend*, not the whole app — it is a worker runtime,
not a web host. The Vercel frontend (and a queryable conversation store, likely
Neon) stays; it invokes Golem workers, streams results, and reconnects to
suspended sessions. Persistence splits: the oplog owns durable agent state; Neon
owns UI-queryable conversation/message history.

## Risks / open questions

- TypeScript runs as a WASM component: no native modules (better-sqlite3 is
  out) and a reduced Node/npm surface. This is the gating unknown.
- Golem's agentic refocus is recent and TS support is less mature than Rust;
  production-readiness needs assessment.
- Reuse Golem's durable LLM interface vs. adapt @astonagent/providers (esp.
  Ollama) is undecided.

## Scope

This is exploratory and gated on a TS->WASM feasibility spike. If the spike
fails, the project is killed cheaply; the rest of the backlog depends on it.
Out of scope: the interactive chat path, which stays on Vercel + Neon under the
astonagent project.
