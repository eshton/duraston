/**
 * DUR-3: the Provider port.
 *
 * The durable loop (DUR-2) already talks to an injected `LlmFn`. This makes that
 * seam first-class: a `Provider` normalizes any backend — a direct fetch client
 * (the DUR-1 path, = adapting @astonagent/providers), an OpenAI/Ollama-compatible
 * endpoint, or Golem's durable `golem:llm` component — to the single
 * `ProviderResponse` shape the loop consumes.
 *
 * Decision (see DUR-3.md): adapt @astonagent/providers behind this port as the
 * default; keep a golem:llm adapter as an option. Either way the loop is
 * untouched — only the object behind `Provider` changes.
 */
import type {
  AnthropicTool,
  Message,
  ProviderResponse,
} from "../durable/ports.js";
import type { LlmFn } from "../durable/concierge.js";

export interface ChatRequest {
  messages: Message[];
  tools: AnthropicTool[];
  model?: string;
  system?: string;
  maxTokens?: number;
}

export interface Provider {
  /** Human-readable id, e.g. "anthropic" / "ollama(openai-compat)". */
  readonly name: string;
  chat(req: ChatRequest): Promise<ProviderResponse>;
}

/** Bridge a Provider into the loop's LlmFn seam. */
export function asLlmFn(provider: Provider, opts: Partial<ChatRequest> = {}): LlmFn {
  return (messages, tools) => provider.chat({ messages, tools, ...opts });
}
