# DUR-1 — TS→WASM feasibility spike

**Go/no-go.** Everything else in Duraston depends on the answer to one question:

> Does `runAgent` plus its real dependencies (zod, provider fetch/SDK calls)
> compile and run as a Golem WebAssembly component?

If yes, DUR-2…DUR-6 are unblocked. If no, the project is killed cheaply.

## What's here

| File | Purpose |
| ---- | ------- |
| `src/agent-loop.ts` | Minimal stand-in for `runAgent` — the loop *shape*, dependency-light on purpose |
| `src/main.ts` | Entry point: runs the loop with a fake model + tool (pure-logic control) |
| `../wit/spike.wit` | WIT world for the component (`run: func(prompt) -> string`) |
| `golem.yaml` | Golem component manifest (**sketch** — toolchain not yet verified) |

## How to run the spike

### 1. Control run on plain Node (logic check)

```bash
pnpm install
pnpm build:js
node dist/main.js
```

Expected: the loop does one tool call (`now`) then a final answer, printing the
transcript. This confirms the logic before WASM enters the picture.

### 2. The actual experiment — componentize to WASM

```bash
pnpm build:wasm   # currently a stub that exits 1 — see golem.yaml
```

This is the unknown. The `build:wasm` script and `golem.yaml` are sketches: the
Golem CLI / jco / componentize-js versions and the exact componentize command
are **not yet verified**. Resolving them IS the spike.

## What to probe (and record below)

Reintroduce real dependencies one at a time and note what survives the
JS→WASM toolchain:

- [ ] **zod** — does schema validation componentize?
- [ ] **outbound `fetch`** — does the WASM sandbox allow HTTP to a provider, or
      must it route through a Golem host import?
- [ ] **provider SDKs** (`@anthropic-ai/sdk`, OpenAI, etc.) — do they pull in
      Node built-ins the toolchain can't supply?
- [ ] **native modules** — `better-sqlite3` and friends are expected to be
      *out*. Confirm and note the replacement (Golem key-value / oplog state).
- [ ] **Node/npm surface** — which `node:` built-ins are missing or shimmed?

## Findings

> Fill this in as the spike runs. This section is the deliverable — the
> go/no-go recommendation and the evidence behind it.

- Toolchain + versions:
- Compiles to a component? (y/n):
- Runs on Golem? (y/n):
- What broke:
- Recommendation (go / no-go / conditional):
