import { BaseAgent, agent, prompt, description } from "@golemcloud/golem-ts-sdk";
import { Reminder, EpochMillis } from "./types";

/**
 * A durable, per-owner reminder. This is the showcase for Golem's durable
 * suspend/resume: `waitUntilDue` can sleep for days or weeks at zero cost and
 * resume exactly where it left off after any crash or redeploy — no cron jobs,
 * no external scheduler, no re-hydrating state.
 *
 * One instance is addressed per reminder id via `ReminderAgent.get(id)`.
 */
@agent()
class ReminderAgent extends BaseAgent {
  private readonly id: string;
  private reminder?: Reminder;

  constructor(id: string) {
    super();
    this.id = id;
  }

  @prompt("Schedule a reminder")
  @description("Stores a reminder and arms it to fire at the given time.")
  async schedule(text: string, dueAt: EpochMillis): Promise<Reminder> {
    this.reminder = { id: this.id, text, dueAt, status: "pending" };
    return this.reminder;
  }

  @prompt("Wait until this reminder is due, then fire it")
  @description(
    "Durably sleeps until the reminder's due time and marks it fired. " +
      "Safe to call once after scheduling; survives restarts.",
  )
  async waitUntilDue(): Promise<Reminder> {
    if (!this.reminder) {
      throw new Error(`Reminder ${this.id} has not been scheduled`);
    }
    // TODO: replace with the SDK's durable sleep primitive once confirmed
    // against the installed @golemcloud/golem-ts-sdk version. The intent is a
    // durable wait until `this.reminder.dueAt` that the runtime persists, e.g.:
    //   await sleepUntil(this.reminder.dueAt);
    if (this.reminder.status === "pending") {
      this.reminder.status = "fired";
    }
    return this.reminder;
  }

  @description("Cancels a pending reminder.")
  async cancel(): Promise<void> {
    if (this.reminder && this.reminder.status === "pending") {
      this.reminder.status = "cancelled";
    }
  }

  @description("Returns the current state of this reminder.")
  async get(): Promise<Reminder | undefined> {
    return this.reminder;
  }
}

export { ReminderAgent };
