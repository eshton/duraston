/**
 * A deliberately minimal stand-in for astonagent's `runAgent`
 * (packages/core/src/loop.ts).
 *
 * The point of the spike (DUR-1) is NOT to faithfully port the real loop — it
 * is to reproduce its *shape* (a bounded step loop that interleaves model
 * calls and tool calls) with as few dependencies as possible, then progressively
 * reintroduce the real dependencies (zod, the provider SDKs, fetch) and record
 * which ones survive the JS->WASM toolchain and which break.
 *
 * Keep this file dependency-light on purpose. Each dependency you add is a data
 * point for the feasibility writeup.
 */

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

/** A single model turn. In the real loop this hits a provider; here it is injected. */
export type ModelCall = (messages: Message[]) => Promise<ModelResult>;

export interface ModelResult {
  /** Assistant text for this turn. */
  content: string;
  /** If set, the loop should run this tool and feed the result back. */
  toolCall?: { name: string; args: string };
}

/** A tool the agent can invoke. Injected so the loop has no hard tool deps. */
export type Tool = (args: string) => Promise<string>;

export interface RunAgentOptions {
  messages: Message[];
  model: ModelCall;
  tools: Record<string, Tool>;
  /** Hard cap on loop iterations, mirroring runAgent's step budget. */
  maxSteps?: number;
}

export interface RunAgentResult {
  messages: Message[];
  steps: number;
  stoppedBy: "model" | "maxSteps";
}

/**
 * The core loop. Each iteration is an external-I/O boundary: in a Golem worker
 * the model call and each tool call become oplog-journaled operations, so a
 * crash mid-loop resumes at the same step without re-issuing completed calls.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const maxSteps = opts.maxSteps ?? 8;
  const messages = [...opts.messages];

  for (let step = 1; step <= maxSteps; step++) {
    const result = await opts.model(messages); // <-- journaled I/O on Golem
    messages.push({ role: "assistant", content: result.content });

    if (!result.toolCall) {
      return { messages, steps: step, stoppedBy: "model" };
    }

    const tool = opts.tools[result.toolCall.name];
    const toolOutput = tool
      ? await tool(result.toolCall.args) // <-- journaled I/O on Golem
      : `error: unknown tool "${result.toolCall.name}"`;

    messages.push({ role: "tool", content: toolOutput });
  }

  return { messages, steps: maxSteps, stoppedBy: "maxSteps" };
}
