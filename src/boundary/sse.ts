/**
 * Server-Sent Events transport for the DUR-5 stream. SSE is the natural fit:
 * the `id:` field carries our `seq`, so on a dropped connection the browser's
 * EventSource automatically reconnects with a `Last-Event-ID` header — the
 * server resumes via `gateway.eventsSince(lastEventId + 1)`. No bespoke
 * reconnect protocol needed.
 */
import type { ServerEvent } from "./protocol.js";

/** Encode one event as an SSE frame. */
export function toSSE(event: ServerEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** The seq to resume from given an incoming Last-Event-ID header (or null). */
export function resumeFrom(lastEventId: string | null | undefined): number {
  if (lastEventId == null || lastEventId === "") return 0;
  const n = Number(lastEventId);
  return Number.isFinite(n) ? n + 1 : 0;
}

/** Parse SSE frames back into events (for tests / non-browser clients). */
export function parseSSE(text: string): ServerEvent[] {
  const events: ServerEvent[] = [];
  for (const frame of text.split("\n\n")) {
    const dataLine = frame
      .split("\n")
      .find((l) => l.startsWith("data:"));
    if (!dataLine) continue;
    events.push(JSON.parse(dataLine.slice("data:".length).trim()) as ServerEvent);
  }
  return events;
}
