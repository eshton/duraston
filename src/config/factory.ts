/**
 * Build a Provider (DUR-3) from a ConfigSource (DUR-7). This is where the
 * astonagent env-var convention maps onto injected config/secrets: the secret
 * is read through the redacting `SecretValue` and only `.expose()`d here, at the
 * point it is handed to the provider that puts it in an HTTP header.
 */
import type { Provider } from "../providers/provider.js";
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAICompatProvider } from "../providers/openai-compat.js";
import { KEYS, type ConfigSource } from "./config.js";

export function providerFromConfig(cfg: ConfigSource, fetchImpl?: typeof fetch): Provider {
  const which = cfg.get(KEYS.provider) ?? "anthropic";

  if (which === "openai-compat") {
    return new OpenAICompatProvider({
      baseUrl: cfg.require(KEYS.llmBaseUrl),
      model: cfg.require(KEYS.llmModel),
      // Ollama needs no key; expose only if one was provisioned.
      apiKey: cfg.get(KEYS.llmApiKey) ? cfg.secret(KEYS.llmApiKey).expose() : undefined,
      fetchImpl,
    });
  }

  return new AnthropicProvider({
    apiKey: cfg.secret(KEYS.anthropicKey).expose(),
    model: cfg.get(KEYS.anthropicModel),
    fetchImpl,
  });
}
