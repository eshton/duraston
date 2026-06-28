/**
 * The DUR-2 durable agent loop: the same shape as the DUR-1 `runAgent`
 * (src/agent.ts), but every effect goes through the DurableExecutor so the run
 * is crash-resumable and exactly-once, and a tool can suspend the session
 * awaiting external input.
 *
 * The loop logic itself is runtime-agnostic: it talks only to the executor and
 * an injected `llm` function. On Golem the executor is implicit (automatic oplog)
 * and `llm` is the durable golem:llm / wasi:http call; in tests both are backed
 * by the in-memory harness. That seam is the whole point — identical logic,
 * swappable host.
 */
import type {
  AnthropicTool,
  ContentBlock,
  Message,
  ProviderResponse,
  ToolUseBlock,
} from "./ports.js";
import { runTool, toolSpecs } from "../tools.js";
import { DurableExecutor } from "./oplog.js";

const MAX_STEPS = 8;

/** Injected provider call. Journaled by the executor -> exactly-once on replay. */
export type LlmFn = (
  messages: Message[],
  tools: AnthropicTool[],
) => Promise<ProviderResponse>;

export interface DurableDeps {
  exec: DurableExecutor;
  llm: LlmFn;
}

/**
 * A pseudo-tool the model can call to ask the user something. Instead of
 * executing locally it suspends the session (Golem promise) until input is
 * delivered, then resumes with the answer fed back as the tool result.
 */
const ASK_USER = "ask_user";

function textOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export async function runDurableAgent(
  prompt: string,
  deps: DurableDeps,
): Promise<string> {
  const { exec, llm } = deps;
  const tools = toolSpecs();
  const messages: Message[] = [{ role: "user", content: prompt }];

  for (let step = 0; step < MAX_STEPS; step++) {
    // Journaled: replayed identically after a crash, never re-sent to the model.
    const res = await exec.durable(`llm:${step}`, () => llm(messages, tools));
    messages.push({ role: "assistant", content: res.content });

    if (res.stopReason !== "tool_use") {
      return textOf(res.content) || "(no text returned)";
    }

    const toolUses = res.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    const results = [];
    for (const tu of toolUses) {
      if (tu.name === ASK_USER) {
        // Suspend awaiting external input; resumes with the delivered answer.
        const question =
          (tu.input as { question?: string } | undefined)?.question ?? "";
        const answer = await exec.awaitInput(`${tu.id}:${question}`);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: answer });
      } else {
        // Side-effecting tool: journaled so a crash never double-executes it.
        const content = await exec.durable(`tool:${tu.id}`, () =>
          Promise.resolve(runTool(tu.name, tu.input)),
        );
        results.push({ type: "tool_result", tool_use_id: tu.id, content });
      }
    }
    messages.push({ role: "user", content: results as unknown as ContentBlock[] });
  }

  return `(stopped after ${MAX_STEPS} steps without a final answer)`;
}
