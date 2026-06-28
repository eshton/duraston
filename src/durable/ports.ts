/**
 * Type surface the durable layer depends on. Re-exported here so the durable
 * loop has one stable import for "the provider/tool shapes" independent of how
 * the DUR-1 spike happens to define them.
 */
export type {
  ContentBlock,
  Message,
  ProviderResponse,
  TextBlock,
  ToolUseBlock,
} from "../provider.js";
export type { AnthropicTool } from "../tools.js";
