/**
 * DUR-10: oplog + event-stream inspection.
 *
 * The hardest part of operating durable workers is understanding *what a session
 * did* — to reproduce a stuck or failed run you need to read its replayed
 * history. These helpers turn the two records this project already keeps into a
 * readable trace:
 *   - the DurableExecutor journal (DUR-2) — the oplog: every effect, in order;
 *   - the SessionGateway event stream (DUR-5) — the externally observable timeline.
 *
 * On Golem the journal maps to the worker's real oplog (inspectable via the CLI);
 * the same classification/summary logic applies to its entries.
 */
import type { DurableState } from "../durable/oplog.js";
import type { ServerEvent } from "../boundary/protocol.js";
import { redact } from "./logger.js";

export type OpKind = "llm" | "tool" | "await" | "other";

export interface TraceEntry {
  index: number;
  op: string;
  kind: OpKind;
  summary: string;
}

function classify(op: string): OpKind {
  if (op.startsWith("llm:")) return "llm";
  if (op.startsWith("tool:")) return "tool";
  if (op.startsWith("await:")) return "await";
  return "other";
}

function summarize(kind: OpKind, value: unknown): string {
  if (kind === "llm" && value && typeof value === "object") {
    const v = value as { stopReason?: string; content?: unknown[] };
    return `stop=${v.stopReason ?? "?"} blocks=${v.content?.length ?? 0}`;
  }
  if (kind === "tool") return `result=${String(redact(value)).slice(0, 80)}`;
  if (kind === "await") return `input=${String(redact(value)).slice(0, 80)}`;
  return String(redact(value)).slice(0, 80);
}

/** Render the oplog journal as an ordered, human-readable trace. */
export function inspectJournal(state: DurableState): TraceEntry[] {
  return state.journal.map((entry, index) => {
    const kind = classify(entry.op);
    return { index, op: entry.op, kind, summary: summarize(kind, entry.value) };
  });
}

export type SessionStatus = "running" | "suspended" | "done" | "error" | "empty";

export interface Diagnosis {
  status: SessionStatus;
  modelCalls: number;
  toolCalls: number;
  /** Set when suspended: the input key the session is waiting on. */
  awaitingKey?: string;
  error?: string;
  lastEventType?: string;
  lastSeq?: number;
}

/**
 * Diagnose a session from its event stream — the first thing you'd want when a
 * run looks stuck: is it suspended (and on what), errored, or genuinely done?
 */
export function diagnoseStream(events: ServerEvent[]): Diagnosis {
  if (events.length === 0) return { status: "empty", modelCalls: 0, toolCalls: 0 };

  const last = events[events.length - 1];
  let status: SessionStatus = "running";
  let awaitingKey: string | undefined;
  let error: string | undefined;

  for (const e of events) {
    if (e.type === "suspended") {
      status = "suspended";
      awaitingKey = e.key;
    } else if (e.type === "resumed") {
      status = "running";
      awaitingKey = undefined;
    } else if (e.type === "done") {
      status = "done";
    } else if (e.type === "error") {
      status = "error";
      error = e.message;
    }
  }

  return {
    status,
    modelCalls: events.filter((e) => e.type === "model_call").length,
    toolCalls: events.filter((e) => e.type === "tool_use").length,
    awaitingKey,
    error,
    lastEventType: last.type,
    lastSeq: last.seq,
  };
}

/** A compact multi-line rendering for a terminal / log. */
export function formatTrace(entries: TraceEntry[]): string {
  return entries.map((e) => `#${e.index} [${e.kind}] ${e.op} — ${e.summary}`).join("\n");
}
