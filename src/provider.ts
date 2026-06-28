/**
 * Minimal fetch-based Anthropic Messages API client.
 *
 * The DUR-1 question this answers: does a provider call that relies on global
 * `fetch` + JSON survive componentization? (astonagent's @astonagent/providers
 * uses the same fetch path.) Under jco, global fetch is backed by the WASI HTTP
 * world; on Golem it maps to the durable golem:llm host. The spike compiles the
 * code either way -- it just needs the host import wired at runtime.
 */

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export type ContentBlock = TextBlock | ToolUseBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ProviderResponse {
  stopReason: string;
  content: ContentBlock[];
}

export interface ProviderConfig {
  apiKey: string;
  // Default to the current flagship model; see Anthropic model ids.
  model?: string;
  maxTokens?: number;
  system?: string;
}

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-8";

export async function createMessage(
  cfg: ProviderConfig,
  messages: Message[],
  tools: unknown[],
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderResponse> {
  const res = await fetchImpl(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: cfg.model ?? DEFAULT_MODEL,
      max_tokens: cfg.maxTokens ?? 1024,
      ...(cfg.system ? { system: cfg.system } : {}),
      tools,
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`provider HTTP ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    stop_reason: string;
    content: ContentBlock[];
  };
  return { stopReason: data.stop_reason, content: data.content };
}
