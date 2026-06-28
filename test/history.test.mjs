/**
 * DUR-4 tests: the worker's event stream projects into a queryable UI read-model
 * (conversations + messages), and re-applying the stream is idempotent — the
 * property that lets Neon be rebuilt from the oplog/stream without duplication.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionGateway } from "../dist/boundary.js";
import { HistoryProjector } from "../dist/history.js";
import { MemoryStore } from "../dist/data.js";

const toolUse = (id, name, input) => ({
  stopReason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const finalText = (text) => ({ stopReason: "end_turn", content: [{ type: "text", text }] });
const scripted = (plan) => async (messages) =>
  plan[messages.filter((m) => m.role === "assistant").length];

async function runProjected(store, sessionId, prompt, plan) {
  const gw = new SessionGateway({ sessionId, prompt, provider: scripted(plan) });
  await gw.invoke();
  if (gw.isSuspended) {
    const key = gw.eventsSince(0).find((e) => e.type === "suspended").key;
    await gw.provideInput(key, "3pm");
  }
  // A projector consumes the worker's durable event stream in order.
  const projector = new HistoryProjector(store);
  for (const e of gw.eventsSince(0)) await projector.apply(sessionId, e);
  return { gw, projector };
}

test("a completed session projects a queryable conversation + messages", async () => {
  const store = new MemoryStore();
  const { projector } = await runProjected(store, "s1", "schedule a call", [
    toolUse("q1", "ask_user", { question: "what time?" }),
    finalText("Booked for 3pm."),
  ]);

  const conv = await projector.getConversation("s1");
  assert.equal(conv.status, "done");
  assert.match(conv.preview, /3pm/);

  const msgs = await projector.listMessages("s1");
  // user prompt + the final assistant message (tool_use step emits no message)
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["user", "assistant"],
  );
  assert.equal(msgs[0].text, "schedule a call");
  assert.match(msgs[1].text, /3pm/);

  // listConversations powers the UI sidebar
  const all = await projector.listConversations();
  assert.equal(all.length, 1);
  assert.equal(all[0].sessionId, "s1");
});

test("suspended session is queryable as awaiting input", async () => {
  const store = new MemoryStore();
  const gw = new SessionGateway({
    sessionId: "s2",
    prompt: "hi",
    provider: scripted([toolUse("q1", "ask_user", { question: "when?" })]),
  });
  const projector = new HistoryProjector(store);
  await gw.invoke();
  for (const e of gw.eventsSince(0)) await projector.apply("s2", e);

  const conv = await projector.getConversation("s2");
  assert.equal(conv.status, "suspended");
  assert.match(conv.awaitingKey, /when\?/);
});

test("re-projecting the same stream is idempotent (Neon rebuildable from oplog)", async () => {
  const store = new MemoryStore();
  const { gw, projector } = await runProjected(store, "s3", "hi there", [finalText("hello!")]);

  const before = await projector.listMessages("s3");
  // replay every event again (e.g. a rebuild from the worker's durable stream)
  for (const e of gw.eventsSince(0)) await projector.apply("s3", e);
  const after = await projector.listMessages("s3");

  assert.equal(after.length, before.length, "no duplicate messages on replay");
  const conv = await projector.getConversation("s3");
  assert.equal(conv.status, "done");
});
