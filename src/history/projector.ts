/**
 * DUR-4: the persistence split, made concrete.
 *
 * THE LINE:
 *   - Golem oplog  = source of truth for *execution / agent state*. It owns
 *     durability, exactly-once, and replay (DUR-2). The UI must never write here
 *     and cannot SQL-query it.
 *   - Neon/Postgres = a derived, queryable *read-model* for the UI: list
 *     conversations, render message history. It is a PROJECTION of the worker's
 *     event stream (DUR-5), never the authority. If it is lost, it can be
 *     rebuilt by replaying the stream.
 *
 * HistoryProjector consumes DUR-5 ServerEvents and writes those read-model rows
 * through the DUR-8 Store port — so in production it targets Neon via HttpStore,
 * and in tests it targets MemoryStore/SqliteStore unchanged.
 *
 * Idempotency: each conversation tracks the last seq it has applied; events at
 * or below it are skipped, and messages are keyed by seq. So reconnect replays
 * and at-least-once delivery never create duplicates — the projection converges.
 */
import type { Store } from "../data/store.js";
import type { ServerEvent } from "../boundary/protocol.js";

export type ConversationStatus = "running" | "suspended" | "done" | "error";

export interface ConversationRecord {
  sessionId: string;
  status: ConversationStatus;
  lastSeq: number;
  preview: string;
  awaitingKey?: string;
}

export interface MessageRecord {
  seq: number;
  role: "user" | "assistant";
  text: string;
}

const CONVERSATIONS = "conversations";
const messagesNs = (sessionId: string) => `messages:${sessionId}`;
// Zero-pad seq so Store.list (ordered by key) returns messages in stream order.
const msgKey = (seq: number) => String(seq).padStart(12, "0");

export class HistoryProjector {
  constructor(private readonly store: Store) {}

  // Serialize applies per session: apply() does a read-modify-write on the
  // conversation record, so concurrent events for one session must not interleave
  // (whether delivered live via onEvent or pulled from the stream).
  private readonly chains = new Map<string, Promise<void>>();

  /** Apply one event to the read-model. Serialized per session, idempotent w.r.t. seq. */
  apply(sessionId: string, event: ServerEvent): Promise<void> {
    const prev = this.chains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(() => this.applyInner(sessionId, event));
    this.chains.set(
      sessionId,
      next.catch(() => undefined),
    );
    return next;
  }

  private async applyInner(sessionId: string, event: ServerEvent): Promise<void> {
    const conv =
      (await this.store.get<ConversationRecord>(CONVERSATIONS, sessionId)) ??
      ({ sessionId, status: "running", lastSeq: -1, preview: "" } as ConversationRecord);

    if (event.seq <= conv.lastSeq) return; // already applied
    conv.lastSeq = event.seq;

    switch (event.type) {
      case "started":
        conv.status = "running";
        conv.preview = event.prompt;
        await this.putMessage(sessionId, { seq: event.seq, role: "user", text: event.prompt });
        break;
      case "message":
        conv.preview = event.text;
        await this.putMessage(sessionId, { seq: event.seq, role: "assistant", text: event.text });
        break;
      case "suspended":
        conv.status = "suspended";
        conv.awaitingKey = event.key;
        break;
      case "resumed":
        conv.status = "running";
        delete conv.awaitingKey;
        break;
      case "done":
        conv.status = "done";
        conv.preview = event.text;
        break;
      case "error":
        conv.status = "error";
        break;
      // model_call / delta / tool_use: advance lastSeq only (handled above).
      default:
        break;
    }

    await this.store.put(CONVERSATIONS, sessionId, conv);
  }

  private async putMessage(sessionId: string, msg: MessageRecord): Promise<void> {
    await this.store.put(messagesNs(sessionId), msgKey(msg.seq), msg);
  }

  // --- UI read API -----------------------------------------------------------

  async getConversation(sessionId: string): Promise<ConversationRecord | undefined> {
    return this.store.get<ConversationRecord>(CONVERSATIONS, sessionId);
  }

  async listConversations(): Promise<ConversationRecord[]> {
    return (await this.store.list<ConversationRecord>(CONVERSATIONS)).map((i) => i.value);
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    return (await this.store.list<MessageRecord>(messagesNs(sessionId))).map((i) => i.value);
  }
}
