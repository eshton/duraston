/**
 * DUR-5 boundary tests: invoke -> stream -> suspend -> resume -> done, plus
 * reconnect-from-cursor and SSE round-trip. Uses a scripted provider (no real
 * LLM) so the whole UI<->worker boundary runs in-process.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionGateway, toSSE, parseSSE, resumeFrom } from "../dist/boundary.js";

const toolUse = (id, name, input) => ({
  stopReason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const finalText = (text) => ({ stopReason: "end_turn", content: [{ type: "text", text }] });

// scripted provider keyed by assistant-turn count (replay-safe, like DUR-2/3)
function scripted(plan) {
  return async (messages) => {
    const turns = messages.filter((m) => m.role === "assistant").length;
    return plan[turns];
  };
}

test("invoke -> suspend -> resume -> done emits a correct, ordered event stream", async () => {
  const gw = new SessionGateway({
    sessionId: "s1",
    prompt: "schedule something",
    provider: scripted([toolUse("q1", "ask_user", { question: "what time?" }), finalText("Set for 3pm.")]),
  });

  const seen = [];
  gw.onEvent((e) => seen.push(e));

  await gw.invoke();
  // After invoke: started, model_call(0), suspended
  assert.deepEqual(seen.map((e) => e.type), ["started", "model_call", "suspended"]);
  assert.ok(gw.isSuspended);
  const key = seen.find((e) => e.type === "suspended").key;
  assert.match(key, /what time\?/);

  await gw.provideInput(key, "3pm");
  // After resume: resumed, model_call(1) [step 0 replayed, not re-emitted], message, done
  assert.deepEqual(
    seen.map((e) => e.type),
    ["started", "model_call", "suspended", "resumed", "model_call", "message", "done"],
  );
  // model_call steps are 0 then 1 — the replayed pre-suspension call did NOT re-emit
  assert.deepEqual(seen.filter((e) => e.type === "model_call").map((e) => e.step), [0, 1]);
  assert.match(seen.at(-1).text, /3pm/);

  // seq is monotonic and contiguous
  assert.deepEqual(seen.map((e) => e.seq), [0, 1, 2, 3, 4, 5, 6]);
});

test("reconnect: eventsSince(cursor) replays only missed events", async () => {
  const gw = new SessionGateway({
    sessionId: "s2",
    prompt: "hi",
    provider: scripted([finalText("hello")]),
  });
  const beforeDisconnect = [];
  const unsub = gw.onEvent((e) => beforeDisconnect.push(e));
  await gw.invoke();
  // pretend the client saw seq 0 and 1, then dropped
  const lastSeen = beforeDisconnect[1].seq; // model_call (seq 1)
  unsub();

  // on reconnect the client asks for everything after lastSeen
  const missed = gw.eventsSince(resumeFrom(String(lastSeen)));
  assert.deepEqual(missed.map((e) => e.seq), [2, 3]); // message, done
  assert.equal(missed.at(-1).type, "done");
});

test("async stream replays from a cursor then ends on terminal event", async () => {
  const gw = new SessionGateway({
    sessionId: "s3",
    prompt: "hi",
    provider: scripted([finalText("yo")]),
  });
  await gw.invoke(); // completes synchronously here (no suspension)

  const collected = [];
  for await (const e of gw.stream(0)) collected.push(e.type);
  assert.deepEqual(collected, ["started", "model_call", "message", "done"]);
});

test("SSE encodes seq as id and round-trips", () => {
  const ev = { seq: 5, type: "suspended", key: "q1:what time?" };
  const frame = toSSE(ev);
  assert.match(frame, /^id: 5\n/);
  assert.match(frame, /event: suspended\n/);
  const [parsed] = parseSSE(frame);
  assert.deepEqual(parsed, ev);

  // Last-Event-ID resume math
  assert.equal(resumeFrom("5"), 6);
  assert.equal(resumeFrom(null), 0);
});
