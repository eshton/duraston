/**
 * Reference adapter: Golem's durable `golem:llm` behind the same Provider port.
 * Deploy-side (typechecked under tsconfig.golem.json, not part of the runnable
 * core), and the option DUR-3 weighs against adapting @astonagent/providers.
 *
 * IMPORTANT — honesty note: `golem:llm` is NOT part of @golemcloud/golem-ts-sdk
 * (the installed SDK ships rdbms/keyvalue/config/durability/sqlite bindings but
 * no llm). It is a SEPARATE component (golemcloud/golem-llm) you compose into the
 * app; its host functions are reached through generated bindings. Rather than
 * fabricate that import path/version, this adapter targets an injected
 * `GolemLlmHost` interface that represents the composed component. When wiring it
 * for real, replace `GolemLlmHost` with the generated `golem:llm` binding and
 * reconcile the field names against its WIT.
 */
import type { Provider, ChatRequest } from "../providers/provider.js";
import type { ContentBlock, ProviderResponse } from "../durable/ports.js";

/** Approximate shape of the composed golem:llm `send` host call. */
export interface GolemLlmMessage {
  role: string;
  content: string;
}
export interface GolemLlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}
export interface GolemLlmResponse {
  finishReason: string; // e.g. "stop" | "tool-calls"
  text: string;
  toolCalls: GolemLlmToolCall[];
}
export interface GolemLlmHost {
  /** Durable: journaled by Golem, replayed exactly-once. */
  send(input: {
    provider: string; // "anthropic" | "openai" | "ollama" | "grok" | ...
    model: string;
    messages: GolemLlmMessage[];
    toolsJson: string; // JSON-encoded tool specs
  }): Promise<GolemLlmResponse>;
}

export interface GolemLlmOptions {
  host: GolemLlmHost;
  provider: string;
  model: string;
}

export class GolemLlmProvider implements Provider {
  readonly name: string;

  constructor(private readonly opts: GolemLlmOptions) {
    this.name = `golem:llm(${opts.provider})`;
  }

  async chat(req: ChatRequest): Promise<ProviderResponse> {
    const res = await this.opts.host.send({
      provider: this.opts.provider,
      model: req.model ?? this.opts.model,
      messages: flatten(req),
      toolsJson: JSON.stringify(req.tools),
    });

    const blocks: ContentBlock[] = [];
    if (res.text) blocks.push({ type: "text", text: res.text });
    for (const tc of res.toolCalls) {
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: parse(tc.argumentsJson),
      });
    }
    return {
      stopReason: res.toolCalls.length ? "tool_use" : res.finishReason === "stop" ? "end_turn" : res.finishReason,
      content: blocks,
    };
  }
}

function flatten(req: ChatRequest): GolemLlmMessage[] {
  const msgs: GolemLlmMessage[] = [];
  if (req.system) msgs.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    msgs.push({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    });
  }
  return msgs;
}

function parse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
