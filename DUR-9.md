# DUR-9 — Build & deploy pipeline (golem build/deploy in CI)

**Goal:** a repeatable, automated path from PR → a deployed durable worker:
install the Golem CLI in CI, build TS → WASM, cache the build, select
environment/profile, and gate deploys.

**Status:** CI/CD wired and the manifest authored. The fast PR gates (typecheck,
tests, jco component build) **run and are green here**; the heavy `golem app
build`/`deploy` path is wired and pinned but only executes in CI with the Golem
toolchain + a Cloud token (not runnable in this sandbox — see "Validation").

---

## What's in the repo

| File | Role |
|------|------|
| `golem.yaml` | application manifest: the `duraston:concierge` TS component + `local`/`cloud` profiles |
| `.github/workflows/ci.yml` | every PR: `npm ci`, typecheck (core **and** Golem target), tests, **jco componentize smoke build**, artifact upload |
| `.github/workflows/deploy.yml` | on `main`: install pinned Golem CLI → `golem app build` (cached) → gated `golem app deploy` |
| `tsconfig.golem.json` | typechecks `src/golem` against the real `@golemcloud/golem-ts-sdk` |
| `package.json` | adds `@golemcloud/golem-ts-sdk` + `golem-ts-typegen` + `golem-ts`; scripts `golem:build`, `golem:deploy`, `typecheck:golem` |

## Two-tier pipeline (why)

- **PR CI (fast, credential-free):** the value signal on every change is "does
  it still typecheck, pass tests, and **componentize to WASM**?" The jco
  smoke build (the proven DUR-1 path) gives that in seconds without the Golem
  toolchain or any secret. This keeps PRs quick and contributors unblocked.
- **Deploy (heavy, gated):** `golem app build` (the real typegen → componentize
  → linked WASM) plus `golem app deploy` run only on `main`, behind a protected
  GitHub Environment (required reviewers) and the cloud profile's token.

## Caching, environments, secrets

- **WASM build cache:** `actions/cache` keyed on `package-lock.json` + `src/**`
  + `wit/**` + `golem.yaml`, caching `golem-temp` and the componentize-js cache.
- **Environment/profile selection:** `golem.yaml` `environments` (`local` =
  self-host, `cloud` = Golem Cloud — the DUR-6 decision); deploy picks via
  `--environment`, defaulting to `cloud`, overridable on `workflow_dispatch`.
- **Secrets:** `GOLEM_CLOUD_TOKEN` (per-environment GitHub secret) authenticates
  the CLI; `ANTHROPIC_API_KEY` is pushed to the component as a Golem secret —
  **not** ambient env (DUR-1 showed env doesn't cross the sandbox; DUR-7 owns
  this).

## Validation

- ✅ All three YAML files parse cleanly.
- ✅ `npm run typecheck` and `npm run typecheck:golem` pass — the latter checks
  `src/golem/agent.ts` against the **real** `@golemcloud/golem-ts-sdk` (its
  `agent`/`BaseAgent`/`prompt`/`createPromise`/`awaitPromise` imports all
  resolve), so DUR-2's deploy wrapper is validated, not assumed.
- ✅ `npm test` (7 cases) and `npm run build` (jco component) pass — these are
  exactly the PR CI steps.
- ⚠️ **Not run here:** `golem app build` / `golem app deploy`. They need the
  Golem CLI + (deploy) a Cloud account, which this environment lacks. Before the
  first real deploy: run `golem app new --language ts` once to confirm the
  manifest schema/version against the installed CLI and reconcile `golem.yaml`;
  verify the release-binary asset name/version for `GOLEM_CLI_VERSION`.

## Hand-offs

- **DUR-6**: which `server:` the `cloud`/`local` profiles point at.
- **DUR-7**: the secret-provisioning step is stubbed against `golem component
  env set`; finalize with Config/Secret semantics.
- **DUR-10**: add a post-deploy smoke invocation + log/trace capture to the
  deploy job once observability lands.
