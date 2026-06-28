# DUR-5 — UI ↔ worker API boundary (invoke, stream, resume)

**Goal:** specify how the Vercel frontend invokes a Golem agent worker, streams
results back, and reconnects to / resumes a suspended session.

**Status:** protocol + a runnable in-process gateway + SSE transport, all tested.
The Vercel route and Golem worker bindings are given as reference (they need the
deployed runtime — DUR-9/DUR-6).

---

## The contract

Three client intents, one event stream:

| Intent | Client | Server |
|--------|--------|--------|
| **invoke** | `POST /api/agent` `{sessionId, prompt}` | start the worker; open the event stream |
| **stream** | `GET /api/agent/:id/events` (SSE) | `started → model_call* → (suspended \| message → done)` |
| **resume** | `POST /api/agent/:id/input` `{key, value}` | `completePromise`; `resumed → … → done` |
| **reconnect** | SSE auto-reconnect w/ `Last-Event-ID` | replay events since that seq, then live |

Every server event carries a **monotonic `seq`** (`src/boundary/protocol.ts`).
That single idea covers both streaming and reconnect: the client tracks the last
seq it saw; on reconnect the server replays `eventsSince(seq+1)` then continues.
A suspended session is just "the stream is caught up to a `suspended` event and
waiting" — reconnect shows it immediately.

## What's in the repo (runnable, tested)

| File | Role |
|------|------|
| `src/boundary/protocol.ts` | `ClientMessage` + `ServerEvent` wire types |
| `src/boundary/gateway.ts` | `SessionGateway` over a DurableSession: event log, seq, `invoke`/`provideInput`/`stream`/`eventsSince` |
| `src/boundary/sse.ts` | SSE encode + `Last-Event-ID` resume math |
| `test/boundary.test.mjs` | full flow + reconnect + SSE |

```
✓ invoke -> suspend -> resume -> done emits a correct, ordered event stream
✓ reconnect: eventsSince(cursor) replays only missed events
✓ async stream replays from a cursor then ends on terminal event
✓ SSE encodes seq as id and round-trips
```

**Dedup-by-construction:** `model_call` events are emitted by wrapping the
provider seam, so they fire only on *live* model calls. On resume, pre-suspension
steps replay from the oplog (provider not called) and are **not** re-emitted — the
test asserts the model_call steps are `[0, 1]`, not `[0, 0, 1]`.

## Mapping to the real runtime

```
SessionGateway (here, in-process)     Golem + Vercel
────────────────────────────────     ─────────────────────────────────────────
invoke()                              Vercel route -> agent worker RPC (run())
event log (array + seq)               worker durable output stream (oplog-backed:
                                      reconnect replay is free, survives restarts)
suspended{key}                        worker hit awaitPromise; key = promiseId
provideInput(key, value)              Vercel route -> completePromise(id, bytes)
stream(fromSeq)                       SSE; EventSource Last-Event-ID = seq
```

### Reference: Vercel App Router (Anthropic provider)

```ts
// app/api/agent/[id]/events/route.ts
import { SessionGateway, toSSE, resumeFrom } from "duraston/boundary";
import { AnthropicProvider, asLlmFn } from "duraston/providers";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const gw = getOrCreateGateway(params.id, () =>
    new SessionGateway({
      sessionId: params.id,
      prompt: /* from session store */ "",
      provider: asLlmFn(new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! })),
    }),
  );
  const from = resumeFrom(req.headers.get("Last-Event-ID"));
  const stream = new ReadableStream({
    async start(controller) {
      for await (const e of gw.stream(from)) controller.enqueue(toSSE(e));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
```

In production `getOrCreateGateway` is a thin RPC client to the Golem worker, not
an in-memory map — the worker is the durable session; the route just bridges its
output stream to SSE.

## Open items / hand-offs

- **Token streaming (`delta` events):** the protocol reserves them; they are fed
  by provider-side streaming (DUR-3 / `golem:llm` streaming, or SSE chunking over
  `wasi:http`). The gateway already numbers and buffers them like any event.
- **`tool_use` events:** finer per-tool visibility needs a small loop hook in
  DUR-2 (kept out here to leave the loop untouched).
- **Auth/session store:** which sessions a user may invoke/resume — app concern.
- **DUR-6/DUR-9:** the RPC client + worker bindings need the deployed runtime.
