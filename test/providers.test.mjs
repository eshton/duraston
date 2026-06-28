/**
 * DUR-3 provider-abstraction tests. Prove that two real adapters normalize to
 * the same ProviderResponse the loop consumes, that tool-calling round-trips,
 * and that the loop runs unchanged when the provider is swapped (the whole point
 * of the port).
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AnthropicProvider,
  OpenAICompatProvider,
  asLlmFn,
} from "../dist/providers.js";
import { DurableSession } from "../dist/durable.js";

function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, json = {}, text = "" } = handler(url, init) ?? {};
    return {
      ok: status < 400,
      status,
      async text() {
        return text;
      },
      async json() {
        return json;
      },
    };
  };
  return { fetchImpl, calls };
}

test("AnthropicProvider posts to the Messages API and returns normalized blocks", async () => {
  const { fetchImpl, calls } = stubFetch(() => ({
    json: { stop_reason: "end_turn", content: [{ type: "text", text: "hi there" }] },
  }));
  const p = new AnthropicProvider({ apiKey: "k", model: "claude-opus-4-8", fetchImpl });
  const res = await p.chat({ messages: [{ role: "user", content: "hi" }], tools: [] });

  assert.match(calls[0].url, /api\.anthropic\.com\/v1\/messages/);
  assert.equal(JSON.parse(calls[0].init.body).model, "claude-opus-4-8");
  assert.equal(res.stopReason, "end_turn");
  assert.equal(res.content[0].text, "hi there");
});

test("OpenAICompatProvider maps tools + tool_calls (the Ollama path)", async () => {
  const { fetchImpl, calls } = stubFetch(() => ({
    json: {
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_time", arguments: '{"timezone":"UTC"}' },
              },
            ],
          },
        },
      ],
    },
  }));
  const p = new OpenAICompatProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    fetchImpl,
  });
  const res = await p.chat({
    messages: [{ role: "user", content: "what time is it" }],
    tools: [
      {
        name: "get_time",
        description: "get time",
        input_schema: { type: "object", properties: { timezone: { type: "string" } } },
      },
    ],
  });

  // request: Ollama OpenAI-compatible endpoint, tools mapped to function shape
  assert.match(calls[0].url, /localhost:11434\/v1\/chat\/completions$/);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.tools[0].type, "function");
  assert.equal(sent.tools[0].function.name, "get_time");

  // response: tool_calls normalized to a tool_use block with parsed input
  assert.equal(res.stopReason, "tool_use");
  assert.equal(res.content[0].type, "tool_use");
  assert.equal(res.content[0].name, "get_time");
  assert.deepEqual(res.content[0].input, { timezone: "UTC" });
});

test("OpenAICompat translates the loop's block protocol into OpenAI messages", async () => {
  const { fetchImpl, calls } = stubFetch(() => ({
    json: { choices: [{ finish_reason: "stop", message: { content: "ok" } }] },
  }));
  const p = new OpenAICompatProvider({ baseUrl: "http://x/v1", model: "m", fetchImpl });
  await p.chat({
    system: "be brief",
    messages: [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "get_time", input: { timezone: "UTC" } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "12:00" }] },
    ],
    tools: [],
  });

  const msgs = JSON.parse(calls[0].init.body).messages;
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[1].role, "user");
  assert.equal(msgs[2].role, "assistant");
  assert.equal(msgs[2].tool_calls[0].id, "t1");
  assert.equal(msgs[3].role, "tool");
  assert.equal(msgs[3].tool_call_id, "t1");
  assert.equal(msgs[3].content, "12:00");
});

test("provider is swappable: the durable loop runs unchanged via asLlmFn", async () => {
  // An OpenAI-compatible backend that returns a final answer immediately.
  const { fetchImpl } = stubFetch(() => ({
    json: { choices: [{ finish_reason: "stop", message: { content: "scheduled!" } }] },
  }));
  const provider = new OpenAICompatProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    fetchImpl,
  });
  const session = new DurableSession("schedule it", asLlmFn(provider));
  const result = await session.run();
  assert.equal(result.status, "done");
  assert.match(result.text, /scheduled/);
});
