/**
 * DurableSession — the runtime-agnostic model of a Golem "agent-per-session"
 * worker. It owns the durable state (journal + inbox) and drives the loop to
 * completion or suspension, recovering across simulated crashes by replaying.
 *
 * Lifecycle mirrors a Golem worker:
 *   run() ──> done            (final answer)
 *         └─> suspended(key)  (awaiting external input; deliver via provideInput)
 *   a CrashError thrown from run() models a node failure; call run() again to
 *   recover — the persisted state makes recovery a replay, not a restart.
 */
import {
  CrashError,
  DurableExecutor,
  Suspended,
  newDurableState,
  type DurableState,
} from "./oplog.js";
import { runDurableAgent, type LlmFn } from "./concierge.js";

export type RunResult =
  | { status: "done"; text: string; liveOps: number }
  | { status: "suspended"; key: string; liveOps: number };

export interface RunOptions {
  /** Simulate a crash before the Nth live op (for tests). */
  faultAfter?: number;
}

export class DurableSession {
  readonly state: DurableState;

  constructor(
    private readonly prompt: string,
    private readonly llm: LlmFn,
    state?: DurableState,
  ) {
    this.state = state ?? newDurableState();
  }

  /** Deliver external input that a suspended run is awaiting (Golem promise). */
  provideInput(key: string, value: string): void {
    this.state.inbox.set(key, value);
  }

  /**
   * Run or resume the session. Replays the persisted journal first, then
   * continues live. Throws CrashError if `faultAfter` triggers (caller recovers
   * by calling run() again).
   */
  async run(opts: RunOptions = {}): Promise<RunResult> {
    const exec = new DurableExecutor(this.state, opts.faultAfter);
    try {
      const text = await runDurableAgent(this.prompt, { exec, llm: this.llm });
      return { status: "done", text, liveOps: exec.liveOpCount };
    } catch (err) {
      if (err instanceof Suspended) {
        return { status: "suspended", key: err.promiseKey, liveOps: exec.liveOpCount };
      }
      if (err instanceof CrashError) throw err; // model node failure
      throw err;
    }
  }

  /**
   * Convenience: run, and if the run suspends, you receive the key to satisfy.
   * Used by the deploy wrapper where suspension maps to awaiting a real promise.
   */
  async runToCompletion(
    resolveInput: (key: string) => Promise<string>,
  ): Promise<string> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await this.run();
      if (r.status === "done") return r.text;
      this.provideInput(r.key, await resolveInput(r.key));
    }
  }
}
