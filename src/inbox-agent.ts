import { BaseAgent, agent, prompt, description } from "@golemcloud/golem-ts-sdk";
import { InboxMessage, TriagedMessage, Importance } from "./types";

/**
 * Triages the owner's inbox: classifies messages by importance, summarizes
 * them, and drafts replies for approval. One instance per owner addressed via
 * `InboxAgent.get(ownerId)`.
 *
 * The triaged backlog lives in agent state, so it persists durably across
 * restarts without any external store.
 */
@agent()
class InboxAgent extends BaseAgent {
  private readonly ownerId: string;
  private triaged: TriagedMessage[] = [];

  constructor(ownerId: string) {
    super();
    this.ownerId = ownerId;
  }

  @prompt("Triage an incoming message")
  @description(
    "Classifies a message by importance, summarizes it, and drafts a reply. " +
      "Stores the result in the owner's triaged backlog.",
  )
  async triage(message: InboxMessage): Promise<TriagedMessage> {
    const result: TriagedMessage = {
      message,
      importance: this.classify(message),
      summary: this.summarize(message),
      draftReply: this.draftReply(message),
    };
    this.triaged.push(result);
    return result;
  }

  @description("Returns triaged messages, optionally filtered by importance.")
  async backlog(importance?: Importance): Promise<TriagedMessage[]> {
    if (!importance) return this.triaged;
    return this.triaged.filter((t) => t.importance === importance);
  }

  // --- Heuristic placeholders ---------------------------------------------
  // These deterministic stubs keep the agent runnable today. Swap them for an
  // LLM call (e.g. via the Anthropic API) once the model integration lands;
  // Golem's exactly-once guarantee makes the external call safe to retry.

  private classify(message: InboxMessage): Importance {
    const haystack = `${message.subject} ${message.body}`.toLowerCase();
    if (/(urgent|asap|immediately|deadline)/.test(haystack)) return "urgent";
    if (/(newsletter|unsubscribe|promotion|sale)/.test(haystack)) return "low";
    return "normal";
  }

  private summarize(message: InboxMessage): string {
    const firstLine = message.body.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
  }

  private draftReply(message: InboxMessage): string | undefined {
    if (this.classify(message) === "low") return undefined;
    return `Hi ${message.from},\n\nThanks for your message regarding "${message.subject}". ` +
      `I'll get back to you shortly.\n\nBest,\nDuraston (on behalf of the owner)`;
  }
}

export { InboxAgent };
