/**
 * Anthropic provider adapter — the "adapt @astonagent/providers" path made
 * concrete. It reuses the DUR-1 fetch client verbatim (src/provider.ts), which
 * already proved it works inside the WASM component and is auto-journaled by
 * Golem over wasi:http (durable for free). This is the carryover: existing
 * provider code keeps working, wrapped in the Provider port.
 */
import { createMessage } from "../provider.js";
import type { Provider, ChatRequest } from "./provider.js";
import type { ProviderResponse } from "../durable/ports.js";

export type FetchLike = typeof fetch;

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  /** Injectable for tests; defaults to the global host fetch. */
  fetchImpl?: FetchLike;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";

  constructor(private readonly opts: AnthropicOptions) {}

  async chat(req: ChatRequest): Promise<ProviderResponse> {
    return createMessage(
      {
        apiKey: this.opts.apiKey,
        model: req.model ?? this.opts.model,
        system: req.system,
        maxTokens: req.maxTokens,
      },
      req.messages,
      req.tools,
      this.opts.fetchImpl,
    );
  }
}
