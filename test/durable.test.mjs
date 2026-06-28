/**
 * DUR-2 behavioral tests. These run the durable loop against the in-memory
 * oplog harness and assert the two guarantees that make a Golem agent worker
 * worth the move off request-scoped serverless:
 *
 *   1. exactly-once across a crash  — a crashed run resumes via replay and does
 *      NOT re-call the LLM or re-execute a tool.
 *   2. suspend / resume             — a session can suspend awaiting external
 *      input and resume when it arrives, without re-calling the LLM.
 *
 * Plus a determinism guard test (oplog divergence is caught loudly).
 *
 * Run: npm test  (builds dist/durable.js first)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DurableSession, CrashError } from "../dist/durable.js";

// --- a scripted, deterministic "LLM" -----------------------------------------
// Decides its response from conversation state (number of assistant turns so
// far), so it is replay-safe: the same step always yields the same response.
function makeScriptedLlm(plan) {
  let realCalls = 0;
  const llm = async (messages) => {
    realCalls++;
    const assistantTurns = messages.filter((m) => m.role === "assistant").length;
    const step = plan[assistantTurns];
    if (!step) throw new Error(`no scripted response for turn ${assistantTurns}`);
    return step;
  };
  return { llm, calls: () => realCalls };
}

const toolUse = (id, name, input) => ({
  stopReason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const finalText = (text) => ({
  stopReason: "end_turn",
  content: [{ type: "text", text }],
});

test("exactly-once: crash mid-loop, replay does not re-call LLM or re-run tool", async () => {
  const plan = [
    toolUse("t1", "add_reminder", { text: "call mom", when: "2026-06-29T09:00:00Z" }),
    finalText("Done — reminder set."),
  ];
  const scripted = makeScriptedLlm(plan);
  const session = new DurableSession("remind me to call mom", scripted.llm);

  // Crash before the 2nd live op: llm:0 journals, then the tool op crashes.
  await assert.rejects(() => session.run({ faultAfter: 1 }), CrashError);
  assert.equal(scripted.calls(), 1, "LLM called once before crash");
  assert.equal(
    session.state.journal.filter((e) => e.op.startsWith("llm:")).length,
    1,
    "only llm:0 journaled before crash",
  );

  // Recover: replay from the persisted journal, then continue live.
  const result = await session.run();
  assert.equal(result.status, "done");
  assert.match(result.text, /reminder set/i);

  // The key guarantee: llm:0 was served from the oplog, NOT re-called.
  assert.equal(scripted.calls(), 2, "LLM total = 2 (llm:0 replayed, llm:1 live)");
  // And every effect is journaled exactly once.
  assert.equal(session.state.journal.filter((e) => e.op.startsWith("llm:")).length, 2);
  assert.equal(session.state.journal.filter((e) => e.op.startsWith("tool:")).length, 1);
});

test("suspend/resume: ask_user suspends the session, resumes with delivered input", async () => {
  const plan = [
    toolUse("q1", "ask_user", { question: "what time?" }),
    finalText("Great, scheduled for 3pm."),
  ];
  const scripted = makeScriptedLlm(plan);
  const session = new DurableSession("schedule something", scripted.llm);

  const suspended = await session.run();
  assert.equal(suspended.status, "suspended");
  assert.ok(suspended.key.includes("what time?"), "suspended on the question key");
  assert.equal(scripted.calls(), 1, "LLM called once before suspension");

  // External party delivers the input (Golem: completePromise), then resume.
  session.provideInput(suspended.key, "3pm");
  const done = await session.run();
  assert.equal(done.status, "done");
  assert.match(done.text, /3pm/);
  assert.equal(scripted.calls(), 2, "llm:0 replayed on resume, not re-called");
});

test("determinism guard: oplog divergence is detected", async () => {
  const plan = [finalText("hi")];
  const scripted = makeScriptedLlm(plan);
  const session = new DurableSession("hi", scripted.llm);
  await session.run(); // journals llm:0

  // Corrupt the journal to simulate a non-deterministic replay (e.g. code read
  // Date.now() outside a durable op, shifting the op sequence).
  session.state.journal[0].op = "llm:99";
  await assert.rejects(() => session.run(), /oplog divergence/);
});
