/** DUR-3 provider abstraction — public surface. */
export type { Provider, ChatRequest } from "./provider.js";
export { asLlmFn } from "./provider.js";
export { AnthropicProvider, type AnthropicOptions } from "./anthropic.js";
export {
  OpenAICompatProvider,
  type OpenAICompatOptions,
} from "./openai-compat.js";
// GolemLlmProvider lives in src/golem (deploy-side, typechecked vs tsconfig.golem).
