import { BaseAgent, agent, prompt, description } from "@golemcloud/golem-ts-sdk";
import { ResearchRequest, ResearchResult } from "./types";

/**
 * Runs research-and-recommendation tasks on the owner's behalf (travel,
 * purchases, restaurants, etc.). Long-running web/LLM work is exactly the kind
 * of multi-step effort Golem keeps alive across interruptions: each external
 * call runs exactly once, and the in-flight task survives restarts.
 *
 * Addressed per task via `ResearchAgent.get(taskId)`.
 */
@agent()
class ResearchAgent extends BaseAgent {
  private readonly taskId: string;
  private lastResult?: ResearchResult;

  constructor(taskId: string) {
    super();
    this.taskId = taskId;
  }

  @prompt("Research a topic and recommend options")
  @description(
    "Investigates a topic against any constraints and returns a summary, " +
      "ranked recommendations, and source URLs.",
  )
  async research(request: ResearchRequest): Promise<ResearchResult> {
    // TODO: wire to real tools — web search, page fetches, and an LLM for
    // synthesis. Because Golem executes tool calls exactly once and persists
    // intermediate state, this can fan out across many steps and resume after
    // any interruption without repeating work or losing progress.
    const result: ResearchResult = {
      topic: request.topic,
      summary:
        `Research for "${request.topic}" is not yet wired to live tools. ` +
        `Constraints: ${request.constraints ?? "none"}.`,
      recommendations: [],
      sources: [],
    };
    this.lastResult = result;
    return result;
  }

  @description("Returns the most recent research result for this task.")
  async lastResearch(): Promise<ResearchResult | undefined> {
    return this.lastResult;
  }
}

export { ResearchAgent };
