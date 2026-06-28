// Shared domain types for the duraston concierge.
//
// Golem extracts these TypeScript types at build time (via golem-ts-typegen)
// and turns them into the data schemas used at the agent boundary, so keep
// them plain and serializable.

/** A point in time, expressed as epoch milliseconds. */
export type EpochMillis = number;

export interface Reminder {
  id: string;
  /** What to remind the owner about. */
  text: string;
  /** When the reminder should fire. */
  dueAt: EpochMillis;
  status: "pending" | "fired" | "cancelled";
}

export interface InboxMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: EpochMillis;
}

export type Importance = "urgent" | "normal" | "low" | "ignore";

export interface TriagedMessage {
  message: InboxMessage;
  importance: Importance;
  summary: string;
  /** A suggested reply the owner can approve, edit, or discard. */
  draftReply?: string;
}

export interface ResearchRequest {
  topic: string;
  /** Optional constraints, e.g. budget, dates, location. */
  constraints?: string;
}

export interface ResearchResult {
  topic: string;
  summary: string;
  recommendations: string[];
  /** Source URLs backing the recommendations. */
  sources: string[];
}
