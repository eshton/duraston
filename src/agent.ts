/**
 * runAgent-equivalent loop. This is the heart of what DUR-1 needs to prove
 * compiles to WASM: an iterative provider/tool loop with bounded steps.
 *
 * In DUR-2 each iteration here becomes an oplog-journaled operation so a crashed
 * worker resumes exactly-once without re-calling the LLM. For the spike it is a
 * plain loop -- the control flow and its dependencies (zod, fetch, JSON) are
 * what we are validating.
 */
import {
  createMessage,
  type ContentBlock,
  type Message,
  type ProviderConfig,
  type ToolUseBlock,
} from "./provider.js";
import { runTool, toolSpecs } from "./tools.js";

const MAX_STEPS = 8;

const SYSTEM_PROMPT =
  "You are Duraston, a durable personal concierge. Use tools when helpful. " +
  "Keep answers concise.";

export interface RunOptions {
  apiKey: string;
  model?: string;
}

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function runAgent(prompt: string, opts: RunOptions): Promise<string> {
  const cfg: ProviderConfig = {
    apiKey: opts.apiKey,
    model: opts.model,
    system: SYSTEM_PROMPT,
  };
  const tools = toolSpecs();
  const messages: Message[] = [{ role: "user", content: prompt }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await createMessage(cfg, messages, tools);
    messages.push({ role: "assistant", content: res.content });

    if (res.stopReason !== "tool_use") {
      return textOf(res.content) || "(no text returned)";
    }

    // Execute every tool_use block and feed the results back as a user turn.
    const toolUses = res.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    const results = await Promise.all(
      toolUses.map(async (tu) => ({
        type: "tool_result" as const,
        tool_use_id: tu.id,
        content: await runTool(tu.name, tu.input),
      })),
    );
    messages.push({ role: "user", content: results as unknown as ContentBlock[] });
  }

  return `(stopped after ${MAX_STEPS} steps without a final answer)`;
}
