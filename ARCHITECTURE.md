# Architecture

## Overview

Duraston is a personal concierge composed of small, typed agents running on the
[Golem](https://golem.cloud) durable agent runtime. Each agent is a TypeScript class
extending `BaseAgent`, compiled to a WebAssembly component. Agent state lives in class
fields and is persisted automatically by the runtime — there is no separate database
to manage for the agent's own working state.

## Agent topology

```
                ┌───────────────────────┐
   owner ◄─────►│     ConciergeAgent     │   one instance per owner
                │  ConciergeAgent.get(   │   (owner-facing entry point)
                │       ownerId )        │
                └───┬────────┬────────┬──┘
                    │        │        │   inter-agent calls via <Agent>.get(id)
        ┌───────────▼──┐ ┌───▼──────┐ ┌▼──────────────┐
        │ ReminderAgent│ │InboxAgent│ │ ResearchAgent │
        │  per reminder│ │ per owner│ │   per task    │
        └──────────────┘ └──────────┘ └───────────────┘
```

- **ConciergeAgent** — the orchestrator. Owner-facing methods (`remindMe`,
  `triageMessage`, `inboxBacklog`, `research`) fan out to specialist agents using
  Golem's get-or-create handles (`SomeAgent.get(id)`). One instance per `ownerId`.
- **ReminderAgent** — one instance per reminder id. Holds a single `Reminder` and the
  durable wait that fires it. This is the clearest demonstration of durable
  suspend/resume.
- **InboxAgent** — one per owner. Holds the triaged backlog; classifies, summarizes,
  and drafts replies.
- **ResearchAgent** — one per research task. Runs (eventually) multi-step web + LLM
  research; relies on exactly-once execution so steps aren't repeated after a restart.

### Why these instance boundaries

Golem addresses agent instances by a string id. Choosing the id granularity *is* the
design:

- per-**reminder** / per-**task** instances isolate independent durable waits and let
  each fail/retry/resume on its own.
- per-**owner** instances (concierge, inbox) keep an owner's accumulating state together
  and serialize that owner's operations.

## Durability model (how the Golem guarantees are used)

- **Automatic state persistence** — `Reminder`, the triaged backlog, and the last
  research result are plain class fields; the runtime snapshots them. No manual
  serialization unless we override `saveSnapshot()` / `loadSnapshot()`.
- **Durable suspend/resume** — `ReminderAgent.waitUntilDue()` is meant to sleep until
  the due time and resume after any interruption. See "Open items" — the exact SDK
  primitive needs to be pinned down.
- **Exactly-once effects** — once capabilities call real external services (email send,
  bookings, paid API calls), Golem ensures each runs once even across crashes/redeploys.

## Data types

`src/types.ts` holds plain, serializable domain types (`Reminder`, `InboxMessage`,
`TriagedMessage`, `ResearchRequest`, `ResearchResult`). Golem's `golem-ts-typegen`
extracts these at build time into the data schemas used at the agent boundary, so they
must stay JSON-serializable (no classes/functions/`Date` — times are `EpochMillis`).

## Build & deploy pipeline

`golem.yaml` declares the `duraston:concierge` component. `golem build` runs the full
pipeline: TypeScript type-check → agent metadata generation → Rollup bundle → QuickJS
injection → wrapper generation → WIT linking → `.wasm`. `golem deploy` publishes it;
`golem repl` gives an interactive TypeScript console with handles to every agent.

## Open items / roadmap

1. **Pin the durable-sleep primitive.** `ReminderAgent.waitUntilDue()` currently
   marks the reminder fired synchronously with a `TODO`. The SDK exposes durable
   promises (`createPromise` / `awaitPromise` / `completePromise`) and scheduling
   utilities; choose the idiomatic way to sleep-until-a-timestamp and wire it in.
2. **Regenerate `golem.yaml` with the CLI.** The manifest was hand-written. Run
   `golem build` once the CLI is available to confirm/complete the pipeline config and
   generate `.agent/` + `.metadata/`.
3. **LLM integration.** Replace the deterministic stubs in `InboxAgent`
   (classify/summarize/draft) and `ResearchAgent` (research) with real model calls
   (Anthropic API). Exactly-once execution makes these external calls safe.
4. **Real tools.** Email/calendar connectors for the inbox, web search + fetch for
   research, and whatever booking/action APIs the concierge should drive.
5. **Identity & auth.** How owners are authenticated and mapped to `ownerId`, and how
   per-owner secrets/credentials are stored (Golem's `Secret` / `Config`).
6. **Human-in-the-loop approvals.** Draft replies and actions with side effects should
   pause for owner approval — a natural fit for durable promises that complete when the
   owner responds.
7. **Tests.** Unit tests for the deterministic logic now; integration tests against a
   local `golem server` once the pipeline builds.
