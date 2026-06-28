/**
 * SessionGateway — the server side of the DUR-5 boundary. It owns one durable
 * agent session and turns it into a resumable, reconnectable event stream.
 *
 * On Golem this maps to: invoke() -> an agent worker RPC; the event log -> the
 * worker's durable output stream (oplog-backed, so reconnect/replay is free);
 * provideInput() -> completePromise on the worker's awaited promise. Here it is
 * in-process over DurableSession (DUR-2) so the whole boundary is testable.
 *
 * Key property: model_call events are emitted by wrapping the provider seam, so
 * they fire only on *live* model calls. During a resume the pre-suspension steps
 * are replayed from the oplog (the provider is not called), so they are not
 * re-emitted — the stream stays duplicate-free without any explicit dedup.
 */
import { DurableSession } from "../durable/session.js";
import type { LlmFn } from "../durable/concierge.js";
import type { ServerEvent, UnsequencedEvent } from "./protocol.js";

export interface GatewayOptions {
  sessionId: string;
  prompt: string;
  /** The provider call (e.g. asLlmFn(provider) from DUR-3). */
  provider: LlmFn;
}

type Listener = (event: ServerEvent) => void;

export class SessionGateway {
  readonly sessionId: string;
  private readonly log: ServerEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly session: DurableSession;
  private liveStep = 0;
  private started = false;

  constructor(opts: GatewayOptions) {
    this.sessionId = opts.sessionId;
    const instrumented: LlmFn = (messages, tools) => {
      this.emit({ type: "model_call", step: this.liveStep++ });
      return opts.provider(messages, tools);
    };
    this.session = new DurableSession(opts.prompt, instrumented);
  }

  private emit(event: UnsequencedEvent): ServerEvent {
    const sequenced = { seq: this.log.length, ...event } as ServerEvent;
    this.log.push(sequenced);
    for (const l of this.listeners) l(sequenced);
    return sequenced;
  }

  /** Start the session and run until it suspends or completes. */
  async invoke(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.emit({ type: "started", sessionId: this.sessionId });
    await this.drive();
  }

  /** Deliver awaited input (Golem completePromise) and resume. */
  async provideInput(key: string, value: string): Promise<void> {
    this.session.provideInput(key, value);
    this.emit({ type: "resumed" });
    await this.drive();
  }

  private async drive(): Promise<void> {
    try {
      const result = await this.session.run();
      if (result.status === "suspended") {
        this.emit({ type: "suspended", key: result.key });
      } else {
        this.emit({ type: "message", text: result.text });
        this.emit({ type: "done", text: result.text });
      }
    } catch (err) {
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Buffered events with seq >= fromSeq — the reconnect replay. */
  eventsSince(fromSeq: number): ServerEvent[] {
    return this.log.filter((e) => e.seq >= fromSeq);
  }

  /** Whether the session is currently waiting at a `suspended` event. */
  get isSuspended(): boolean {
    const last = this.log[this.log.length - 1];
    return last?.type === "suspended";
  }

  /** Subscribe to live events; returns an unsubscribe fn. */
  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Async stream for a (re)connecting client: replays everything from `fromSeq`,
   * then yields live events. Ends after a terminal event (done/error).
   */
  async *stream(fromSeq = 0): AsyncGenerator<ServerEvent> {
    const queue: ServerEvent[] = [...this.eventsSince(fromSeq)];
    let notify: (() => void) | null = null;
    const unsub = this.onEvent((e) => {
      queue.push(e);
      notify?.();
    });
    try {
      while (true) {
        while (queue.length) {
          const e = queue.shift()!;
          yield e;
          if (e.type === "done" || e.type === "error") return;
        }
        // If we've already replayed past a terminal event, stop.
        const last = this.log[this.log.length - 1];
        if (last && (last.type === "done" || last.type === "error") && !queue.length) {
          return;
        }
        await new Promise<void>((resolve) => (notify = resolve));
        notify = null;
      }
    } finally {
      unsub();
    }
  }
}
