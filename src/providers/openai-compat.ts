/**
 * OpenAI-compatible provider adapter. This is the **Ollama path** the DUR-3
 * ticket calls out: Ollama (and vLLM, LM Studio, OpenAI itself, Grok) all expose
 * the OpenAI `/chat/completions` shape, so one adapter + a base URL covers them.
 * Point `baseUrl` at the Ollama host and pick a local model — no new provider
 * code per backend.
 *
 * The adapter does the real work of translating between the loop's Anthropic-
 * style block protocol and OpenAI's messages/tool_calls shape, then normalizes
 * the response back to the single `ProviderResponse` the loop consumes.
 */
import type { Provider, ChatRequest } from "./provider.js";
import type {
  ContentBlock,
  Message,
  ProviderResponse,
  ToolUseBlock,
} from "../durable/ports.js";

export type FetchLike = typeof fetch;

export interface OpenAICompatOptions {
  baseUrl: string; // e.g. http://localhost:11434/v1 (Ollama) or https://api.openai.com/v1
  apiKey?: string;
  model: string;
  fetchImpl?: FetchLike;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/** Translate the loop's messages (Anthropic block protocol) to OpenAI messages. */
function toOpenAIMessages(messages: Message[], system?: string): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      const text = msg.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const toolUses = msg.content.filter(
        (b): b is ToolUseBlock => b.type === "tool_use",
      );
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolUses.length
          ? {
              tool_calls: toolUses.map((t) => ({
                id: t.id,
                type: "function" as const,
                function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      // user turn carrying tool_result blocks -> one OpenAI `tool` message each.
      for (const block of msg.content as unknown as Array<Record<string, unknown>>) {
        out.push({
          role: "tool",
          tool_call_id: String(block.tool_use_id ?? ""),
          content: String(block.content ?? ""),
        });
      }
    }
  }
  return out;
}

export class OpenAICompatProvider implements Provider {
  readonly name: string;

  constructor(private readonly opts: OpenAICompatOptions) {
    this.name = `openai-compat(${opts.baseUrl})`;
  }

  async chat(req: ChatRequest): Promise<ProviderResponse> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const body = {
      model: req.model ?? this.opts.model,
      messages: toOpenAIMessages(req.messages, req.system),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
      tools: req.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    };

    const res = await fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`openai-compat HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        finish_reason: string;
        message: { content: string | null; tool_calls?: OpenAIToolCall[] };
      }>;
    };
    const choice = data.choices[0];
    const blocks: ContentBlock[] = [];
    if (choice.message.content) {
      blocks.push({ type: "text", text: choice.message.content });
    }
    for (const tc of choice.message.tool_calls ?? []) {
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: safeJson(tc.function.arguments),
      });
    }
    const usedTools = (choice.message.tool_calls ?? []).length > 0;
    return {
      stopReason: usedTools ? "tool_use" : choice.finish_reason === "stop" ? "end_turn" : choice.finish_reason,
      content: blocks,
    };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
