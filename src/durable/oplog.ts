/**
 * In-memory model of Golem's oplog + automatic replay, used to demonstrate the
 * DUR-2 durability semantics WITHOUT a live Golem runtime.
 *
 * How Golem actually behaves (and what this models):
 *  - A worker's code re-executes from the top after a crash / node relocation.
 *  - Every host effect already recorded in the oplog returns its journaled value
 *    immediately, WITHOUT re-running the effect -> exactly-once side effects and
 *    no duplicate LLM calls.
 *  - Once the replay cursor passes the end of the journal, execution proceeds
 *    live and new effects are appended.
 *  - Awaiting external input (a Golem promise) suspends the worker; when the
 *    input arrives the worker resumes by replaying the journal and continuing.
 *
 * On real Golem all of this is automatic — you do not call `durable()` by hand;
 * host calls (golem:llm, wasi:http, per-agent storage) are journaled for you.
 * We make it explicit here purely so the behavior is observable and testable.
 */

/** Thrown by a durable op that must suspend the worker awaiting external input. */
export class Suspended extends Error {
  constructor(public readonly promiseKey: string) {
    super(`suspended awaiting input: ${promiseKey}`);
    this.name = "Suspended";
  }
}

/** Simulates an abrupt worker crash / node failure mid-execution. */
export class CrashError extends Error {
  constructor(op: string) {
    super(`simulated crash before op: ${op}`);
    this.name = "CrashError";
  }
}

export interface OplogEntry {
  op: string;
  value: unknown;
}

/**
 * Durable state that survives a crash: the journal of completed effects plus the
 * inbox of external inputs that have been delivered. In Golem this lives in the
 * oplog; here it is a plain object the session re-uses across runs.
 */
export interface DurableState {
  journal: OplogEntry[];
  inbox: Map<string, string>;
}

export function newDurableState(): DurableState {
  return { journal: [], inbox: new Map() };
}

export class DurableExecutor {
  private cursor = 0;
  private liveOps = 0;

  /**
   * @param state    persisted journal + inbox (re-used across replays)
   * @param faultAfter if set, throw CrashError before the Nth *new* (live) op,
   *                   to simulate a crash at a precise point.
   */
  constructor(
    private readonly state: DurableState,
    private readonly faultAfter?: number,
  ) {}

  /** Number of effects that have actually executed live (not replayed). */
  get liveOpCount(): number {
    return this.liveOps;
  }

  /**
   * Run `effect` exactly once across all replays. On replay the journaled value
   * is returned and `effect` is NOT invoked.
   */
  async durable<T>(op: string, effect: () => Promise<T>): Promise<T> {
    if (this.cursor < this.state.journal.length) {
      const entry = this.state.journal[this.cursor++];
      if (entry.op !== op) {
        // Replay must follow the exact same op sequence; divergence means the
        // code read a non-deterministic value (Date.now/Math.random/etc.)
        // outside a durable op. This guard is what surfaces DUR-1's determinism
        // requirement as a hard failure rather than silent corruption.
        throw new Error(
          `oplog divergence at index ${this.cursor - 1}: expected "${entry.op}", got "${op}"`,
        );
      }
      return entry.value as T;
    }

    // Live execution. Optionally crash before running, to model node failure.
    if (this.faultAfter !== undefined && this.liveOps >= this.faultAfter) {
      throw new CrashError(op);
    }

    const value = await effect();
    this.state.journal.push({ op, value });
    this.cursor++;
    this.liveOps++;
    return value;
  }

  /**
   * Suspend the worker awaiting external input keyed by `key` (a Golem promise).
   * If the input has already been delivered to the inbox, journal and return it;
   * otherwise throw Suspended to unwind the worker until the input arrives.
   */
  async awaitInput(key: string): Promise<string> {
    return this.durable(`await:${key}`, async () => {
      const value = this.state.inbox.get(key);
      if (value === undefined) throw new Suspended(key);
      return value;
    });
  }
}
