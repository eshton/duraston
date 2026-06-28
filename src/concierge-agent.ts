import { BaseAgent, agent, prompt, description } from "@golemcloud/golem-ts-sdk";
import { ReminderAgent } from "./reminder-agent";
import { InboxAgent } from "./inbox-agent";
import { ResearchAgent } from "./research-agent";
import {
  Reminder,
  EpochMillis,
  InboxMessage,
  TriagedMessage,
  ResearchRequest,
  ResearchResult,
} from "./types";

/**
 * The owner-facing entry point for duraston. One ConciergeAgent instance per
 * owner (`ConciergeAgent.get(ownerId)`) orchestrates the specialist agents.
 *
 * Inter-agent calls use Golem's get-or-create semantics: `SomeAgent.get(id)`
 * returns a durable handle to an instance (creating it on first use), and
 * method calls on that handle are remote, durable, and exactly-once.
 */
@agent()
class ConciergeAgent extends BaseAgent {
  private readonly ownerId: string;
  private reminderSeq = 0;
  private researchSeq = 0;

  constructor(ownerId: string) {
    super();
    this.ownerId = ownerId;
  }

  // --- Reminders & follow-ups ---------------------------------------------

  @prompt("Remind me about something at a specific time")
  @description("Creates a durable reminder that fires at the given time.")
  async remindMe(text: string, dueAt: EpochMillis): Promise<Reminder> {
    const id = `${this.ownerId}:reminder:${this.reminderSeq++}`;
    const reminder = ReminderAgent.get(id);
    const scheduled = await reminder.schedule(text, dueAt);
    // Arm the durable wait. With the SDK's scheduling primitive this hands off
    // to the runtime so the concierge itself need not stay blocked.
    void reminder.waitUntilDue();
    return scheduled;
  }

  // --- Inbox triage --------------------------------------------------------

  @prompt("Triage a message in my inbox")
  @description("Classifies, summarizes, and drafts a reply for one message.")
  async triageMessage(message: InboxMessage): Promise<TriagedMessage> {
    return InboxAgent.get(this.ownerId).triage(message);
  }

  @description("Returns the owner's triaged inbox backlog.")
  async inboxBacklog(): Promise<TriagedMessage[]> {
    return InboxAgent.get(this.ownerId).backlog();
  }

  // --- Research & recommendations -----------------------------------------

  @prompt("Research something and recommend options for me")
  @description("Kicks off a research task and returns its result.")
  async research(request: ResearchRequest): Promise<ResearchResult> {
    const id = `${this.ownerId}:research:${this.researchSeq++}`;
    return ResearchAgent.get(id).research(request);
  }
}

export { ConciergeAgent };
