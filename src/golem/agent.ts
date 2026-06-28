/**
 * DUR-2 deploy target: the real Golem agent that binds the runtime-agnostic
 * durable loop (src/durable) to the Golem TypeScript SDK.
 *
 * NOTE: this file is the deployable artifact, not part of the local build. It
 * imports `@golemcloud/golem-ts-sdk` and only compiles via the Golem build
 * pipeline (`golem build`, which runs witgen + componentize) — that pipeline is
 * DUR-9. It is excluded from the local `tsc` (see tsconfig "exclude") so the
 * runnable harness + tests stay green without the Golem toolchain installed.
 *
 * How the seams map from the harness to real Golem:
 *
 *   harness (src/durable)         Golem runtime
 *   ─────────────────────         ─────────────────────────────────────────────
 *   DurableExecutor.durable()     automatic — every host call is oplog-journaled
 *   llm(messages, tools)          the DUR-1 fetch provider over wasi:http, which
 *                                 Golem journals (exactly-once). Alternatively
 *                                 the durable golem:llm host — that's DUR-3.
 *   awaitInput(key)               createPromise + awaitPromise (worker suspends)
 *   provideInput(key, value)      completePromise(promiseId, payload)
 *   session.state (journal/inbox) automatic durable class state (oplog)
 *
 * Because Golem makes durability automatic, the production loop does not need
 * the explicit DurableExecutor at all — host calls are journaled for free. We
 * still drive the loop through the same `runDurableAgent` so the *logic* is
 * identical to what the tests exercise; the executor here is a thin pass-through
 * that never replays (Golem owns replay), and suspension maps to a real promise.
 */
import {
  agent,
  BaseAgent,
  prompt,
  description,
  createPromise,
  awaitPromise,
} from "@golemcloud/golem-ts-sdk";

import { DurableSession } from "../durable/index.js";
import { asLlmFn } from "../providers/provider.js";
import { providerFromConfig } from "../config/factory.js";
import { GolemConfig } from "./golem-config.js";
import { toolSpecs } from "../tools.js";

/**
 * One worker instance per concierge session (agent-per-session). The conversation
 * state lives in durable class fields; a crash/relocation resumes exactly where
 * it left off, and `ask_user` tool calls suspend the worker on a Golem promise.
 *
 * The provider is built from injected Golem config/secrets (DUR-7) — NOT ambient
 * process.env, which DUR-1 showed does not cross into the sandbox. Provider
 * choice + keys come from config, so swapping Anthropic <-> Ollama (DUR-3) is a
 * config change, not a redeploy.
 */
@agent()
export class ConciergeAgent extends BaseAgent {
  private readonly session: DurableSession;

  constructor(private readonly prompt0: string) {
    super();
    const provider = providerFromConfig(new GolemConfig());
    this.session = new DurableSession(prompt0, asLlmFn(provider));
  }

  @prompt("Run the concierge session to completion, suspending for user input.")
  @description(
    "Drives the durable agent loop. If the model calls ask_user, the worker " +
      "suspends on a Golem promise until the answer is delivered, then resumes " +
      "without re-calling the LLM.",
  )
  async run(): Promise<string> {
    return this.session.runToCompletion(async (key) => {
      // Suspend awaiting external input: create a promise, hand its id to the
      // caller out-of-band, and block until completePromise delivers the answer.
      const promiseId = createPromise();
      const payload = await awaitPromise(promiseId); // worker suspends here
      return new TextDecoder().decode(payload);
    });
  }
}

// Touch toolSpecs so the tool surface is part of the component (advertised to
// the model); the loop itself pulls specs internally.
void toolSpecs;
