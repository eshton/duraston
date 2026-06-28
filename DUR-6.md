# DUR-6 — Self-host vs Golem Cloud + maturity/ops assessment

**Question:** where does the durable runtime live — self-hosted Golem (OSS) or
Golem Cloud — and how production-ready is Golem for a TypeScript agent backend?

**Recommendation (decision is yours):** **start on Golem Cloud** for spike →
pilot to get a live worker fastest and unblock the "validate on real runtime"
gate that DUR-2/8/9 all wait on; keep a deliberate **exit ramp to self-host**.
The app is portable by construction — provider, store, and config all sit behind
ports, and `golem.yaml` already encodes `local` vs `cloud` profiles — so this is
reversible, not a lock-in.

---

## Maturity assessment (what this exploration actually established)

**Verified working (this repo):**
- TS → WASM component via jco/componentize-js (DUR-1), `fetch` over `wasi:http`
  reaches the network from inside the sandbox.
- The real `@golemcloud/golem-ts-sdk` (1.1.x) exists and the deploy target
  typechecks against it: `@agent()`/`BaseAgent`, `createPromise`/`awaitPromise`,
  `Secret`/`Config`, and durable bindings for `rdbms`/`keyvalue`/`durability`/
  `wasi:config`/per-agent SQLite.

**Risks observed (not blockers, but real):**
- **TS support is newer than Rust.** The agent refocus (Golem 1.3+) is recent;
  Rust is the mature path. Expect rougher edges and faster API churn in TS.
- **Version/manifest churn.** In DUR-9 the CLI release channel and `golem.yaml`
  schema/version needed pinning + reconciliation against `golem app new`. Treat
  CLI + SDK + manifestVersion as a single pinned set, bumped deliberately.
- **`golem:llm` is a separate component**, not in the SDK (DUR-3) — fine, but it
  is extra composition surface if adopted.
- **Nothing is yet validated on a live worker.** Everything here is proven in a
  local harness/CI. The first real `golem app build`/`deploy` + a crash/replay
  test on actual infra is the true go/no-go for production (DUR-9 hand-off).

## Self-host (OSS) vs Golem Cloud

| Dimension | Self-host (Golem OSS) | Golem Cloud |
|-----------|----------------------|-------------|
| Time-to-first-live-worker | slower (stand up + operate the cluster) | **fastest** (managed) |
| Ops burden | you run sharding, storage, upgrades, the oplog store | **managed** |
| Control / data residency | **full** (your infra, your region) | provider-controlled |
| Scaling | you own capacity planning | managed elasticity |
| Cost shape | infra + eng time | usage-based, less eng time |
| Maturity risk exposure | you absorb operational edges | provider absorbs infra edges |
| Best when | strict residency/control, predictable high volume, in-house platform team | moving fast, small team, validating the bet |

## Recommended path

1. **Now → pilot: Golem Cloud.** Lowest ops burden; gets a live worker so DUR-2
   (oplog replay), DUR-8 (per-agent SQLite), DUR-9 (build/deploy) graduate from
   "tested locally" to "validated on the runtime."
2. **Keep the exit ramp warm.** Everything is behind ports + `local`/`cloud`
   profiles; periodically run `golem app build` against a self-hosted `local`
   server in CI so self-host stays a config flip, not a rewrite.
3. **Flip to self-host when** any of: hard data-residency/compliance requirement;
   cost at steady-state volume beats managed; need for in-cluster colocation with
   other infra; or Cloud limits block a needed feature.

## What's needed to act (the part that needs you)

- A Golem Cloud account + token (feeds DUR-9's `GOLEM_CLOUD_TOKEN`), **or** a
  decision to stand up self-hosted Golem.
- Once either exists: run the first real deploy, then a deliberate crash/replay
  + suspend/resume test on the live worker to confirm the durability guarantees
  this repo demonstrates locally.

## Hand-offs

- **DUR-9**: profiles + deploy job are already parameterized for `cloud`/`local`.
- **DUR-10**: observability is the other prerequisite for operating either option
  with confidence.
