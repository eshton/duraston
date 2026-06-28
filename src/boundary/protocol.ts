/**
 * DUR-5: the UI <-> worker wire contract.
 *
 * The Vercel frontend must (a) invoke a Golem agent worker, (b) stream results
 * back, and (c) reconnect to / resume a suspended session. This module is the
 * transport-agnostic protocol for all three; `sse.ts` is one concrete transport.
 *
 * Reconnect model: every server event carries a monotonic `seq` per session.
 * The client remembers the last seq it saw; on reconnect it asks for events
 * since that seq (over SSE this is the standard `Last-Event-ID` header). The
 * server replays buffered events, then resumes live streaming — no lost or
 * duplicated events, and a suspended session is simply "caught up to a
 * `suspended` event and waiting".
 */

/** Client -> server. */
export type ClientMessage =
  | { type: "invoke"; sessionId: string; prompt: string }
  | { type: "provide_input"; sessionId: string; key: string; value: string };

/** Server -> client, streamed. `seq` is monotonic per session (0-based). */
export type ServerEvent =
  | { seq: number; type: "started"; sessionId: string; prompt: string }
  /** A live model call began (step index). Replayed steps do NOT emit this. */
  | { seq: number; type: "model_call"; step: number }
  /** Token/partial-text streaming hook (fed by provider streaming — DUR-3/golem:llm). */
  | { seq: number; type: "delta"; text: string }
  /** A tool was invoked (finer visibility; emitted when the loop exposes it). */
  | { seq: number; type: "tool_use"; name: string }
  /** Worker suspended on a Golem promise; client must provide input for `key`. */
  | { seq: number; type: "suspended"; key: string }
  /** Suspended session resumed after input was delivered. */
  | { seq: number; type: "resumed" }
  /** A complete assistant message. */
  | { seq: number; type: "message"; text: string }
  /** Session finished; `text` is the final answer. */
  | { seq: number; type: "done"; text: string }
  | { seq: number; type: "error"; message: string };

export type ServerEventType = ServerEvent["type"];

/** A server event before it has been assigned a sequence number. */
export type UnsequencedEvent =
  ServerEvent extends infer E
    ? E extends { seq: number }
      ? Omit<E, "seq">
      : never
    : never;
