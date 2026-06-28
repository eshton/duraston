/**
 * DUR-10 tests: structured logs redact secrets, the oplog journal renders as a
 * readable trace, and a session's stream diagnoses as running/suspended/done/
 * error — the operability primitives for durable workers.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger, redact, inspectJournal, diagnoseStream, formatTrace } from "../dist/observability.js";
import { DurableSession } from "../dist/durable.js";
import { SessionGateway } from "../dist/boundary.js";

test("logger emits structured JSON and redacts secrets", () => {
  const lines = [];
  const log = new Logger({ sessionId: "s1", sink: (l) => lines.push(l) });
  log.info("calling provider", { model: "claude-opus-4-8", api_key: "sk-ant-leak", nested: { token: "t" } });

  const rec = JSON.parse(lines[0]);
  assert.equal(rec.level, "info");
  assert.equal(rec.sessionId, "s1");
  assert.equal(rec.model, "claude-opus-4-8");
  assert.equal(rec.api_key, "[redacted]");
  assert.equal(rec.nested.token, "[redacted]");
  assert.doesNotMatch(lines[0], /sk-ant-leak/);
});

test("redact masks SecretValue-like objects and sensitive keys", () => {
  const secretLike = { toString: () => "[redacted]" };
  assert.equal(redact(secretLike), "[redacted]");
  assert.deepEqual(redact({ Authorization: "Bearer x", ok: 1 }), {
    Authorization: "[redacted]",
    ok: 1,
  });
});

test("inspectJournal renders the oplog as a classified trace", async () => {
  const toolUse = (id, name, input) => ({
    stopReason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
  });
  const finalText = (text) => ({ stopReason: "end_turn", content: [{ type: "text", text }] });
  const plan = [toolUse("t1", "get_time", { timezone: "UTC" }), finalText("12:00 UTC")];
  const session = new DurableSession("what time?", async (m) =>
    plan[m.filter((x) => x.role === "assistant").length],
  );
  await session.run();

  const trace = inspectJournal(session.state);
  const kinds = trace.map((t) => t.kind);
  assert.deepEqual(kinds, ["llm", "tool", "llm"]);
  assert.match(trace[0].summary, /stop=tool_use/);
  assert.match(formatTrace(trace), /#0 \[llm\]/);
});

test("diagnoseStream identifies a suspended session and what it awaits", async () => {
  const gw = new SessionGateway({
    sessionId: "s2",
    prompt: "schedule",
    provider: async () => ({
      stopReason: "tool_use",
      content: [{ type: "tool_use", id: "q1", name: "ask_user", input: { question: "when?" } }],
    }),
  });
  await gw.invoke();

  const dx = diagnoseStream(gw.eventsSince(0));
  assert.equal(dx.status, "suspended");
  assert.match(dx.awaitingKey, /when\?/);
  assert.equal(dx.modelCalls, 1);
});

test("diagnoseStream reports done with model-call count", async () => {
  const gw = new SessionGateway({
    sessionId: "s3",
    prompt: "hi",
    provider: async () => ({ stopReason: "end_turn", content: [{ type: "text", text: "hello" }] }),
  });
  await gw.invoke();
  const dx = diagnoseStream(gw.eventsSince(0));
  assert.equal(dx.status, "done");
  assert.equal(dx.modelCalls, 1);
  assert.equal(dx.lastEventType, "done");
});
