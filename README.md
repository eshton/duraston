# duraston

A personal **concierge agent** built on [Golem](https://golem.cloud) — the durable agent runtime.

Duraston handles the small, ongoing logistics of life: remembering things for you,
keeping your inbox under control, and researching options when you need to decide
something. It runs as a set of typed agents on Golem, so its work is durable by
construction — it can wait for days, survive crashes and redeploys, and never
double-executes an action.

## Why Golem

Golem gives us three guarantees that map directly onto what a concierge needs:

| Golem guarantee | What it buys duraston |
| --- | --- |
| **Durable suspend/resume** — agents sleep at zero cost and resume with full memory | Reminders and follow-ups that wait days/weeks without cron jobs or external schedulers |
| **Exactly-once tool execution** — every effect runs once, even across crashes/redeploys | Bookings, sends, and payments never fire twice |
| **Per-agent WASM sandbox** — isolated fs/db/env, authority bounded by the runtime | Each owner's data and capabilities are isolated by the platform, not by prompt text |

Agents are written as **typed TypeScript code**, not prompt chains. State lives in
class fields and is persisted automatically by the runtime.

## Capabilities (initial)

- **Reminders & follow-ups** (`ReminderAgent`) — durable, time-based reminders. The
  showcase for Golem's suspend/resume.
- **Inbox triage** (`InboxAgent`) — classify by importance, summarize, and draft replies.
- **Research & recommendations** (`ResearchAgent`) — multi-step research that survives
  interruption and runs each external call exactly once.

These are orchestrated by the owner-facing **`ConciergeAgent`** (one per owner).

## Project layout

```
src/
  concierge-agent.ts   # owner-facing orchestrator (ConciergeAgent.get(ownerId))
  reminder-agent.ts    # durable reminders / follow-ups
  inbox-agent.ts       # message triage + draft replies
  research-agent.ts    # research & recommendations
  types.ts             # shared, serializable domain types
golem.yaml             # Golem application manifest / build pipeline
ARCHITECTURE.md        # design notes and roadmap
```

## Getting started

> **Prerequisite:** the [Golem CLI](https://github.com/golemcloud/golem/releases)
> (`golem`). It is not installable from npm — download the binary for your platform.

```bash
# 1. Install JS dependencies (the TypeScript SDK)
npm install

# 2. Run a local Golem server (separate terminal)
golem server run

# 3. Type-check your agent code
npm run typecheck

# 4. Build the WebAssembly component
golem build      # (npm run build)

# 5. Deploy and interact
golem deploy     # (npm run deploy)
golem repl       # (npm run repl)
```

In the REPL:

```javascript
const me = await ConciergeAgent.get("owner-1")
await me.remindMe("Renew passport", Date.now() + 7 * 24 * 60 * 60 * 1000)
await me.triageMessage({ id: "m1", from: "alice@example.com", subject: "Lunch?", body: "Free Thursday?", receivedAt: Date.now() })
await me.research({ topic: "noise-cancelling headphones under $300" })
```

## Project tracking

Work on duraston is tracked in **Rooster** under the **Duraston** project (key
prefix **`DUR`**) — e.g. `DUR-1`, `DUR-2`. The backlog frames this repo as an
exploration of running [astonagent](https://github.com/eshton/astonagent) agents on
Golem's durable-execution runtime, gated on a TS→WASM feasibility spike (`DUR-1`);
everything else is **`blocked-by-spike`** until that lands.

Conventions:

- **Labels** group work by area: `golem`, `spike`, `providers`, `persistence`,
  `api`, `ops`, plus `blocked-by-spike` for anything downstream of `DUR-1`.
- Reference tickets by key in commits and PRs (e.g. `DUR-2: extract runAgent worker`).
- New workstreams should become `DUR` tickets before code lands, so the backlog stays
  the source of truth for scope.

## Status & caveats

- Golem Cloud is in **Developer Preview** (paid GA with SLAs targeted Q3 2026). The
  runtime is open-source and runs locally / Docker / k8s / any cloud today.
- The scaffold was authored by hand (the `golem` CLI was unavailable when bootstrapping).
  It type-checks against `@golemcloud/golem-ts-sdk`, but once the CLI is on hand, run
  `golem build` to generate the full pipeline (`.agent/`, `.metadata/`, WIT) and validate
  `golem.yaml`. See `ARCHITECTURE.md` for the open items.
- Capability internals (classify/summarize/research) are deterministic stubs today,
  ready to be wired to an LLM and real tools.
