/**
 * Example of stateful tools built on the Store port — the in-worker data path
 * DUR-8 is about. Unlike the DUR-1/DUR-2 stub tools (pure, in-memory strings),
 * these actually read/write persistent state, which is exactly what real
 * astonagent tools do via @astonagent/db today.
 *
 * Replay-safety note: the reminder key is derived deterministically from its
 * content (no Date.now / random), so re-running the tool during an oplog replay
 * produces the same key and the upsert is idempotent — no duplicate rows.
 */
import { z } from "zod";
import type { Store } from "./store.js";

const NS = "reminders";

export interface Reminder {
  text: string;
  when: string;
}

const addSchema = z.object({
  text: z.string().min(1).describe("What to be reminded about"),
  when: z.string().describe("ISO-8601 timestamp"),
});

function reminderKey(r: Reminder): string {
  // Deterministic, collision-resistant enough for a single agent's reminders.
  return `${r.when}|${r.text}`.toLowerCase().replace(/\s+/g, "-").slice(0, 120);
}

export interface StatefulTool {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (input: unknown) => Promise<string>;
}

/** Build the reminder toolset bound to a given Store backend. */
export function makeReminderTools(store: Store): StatefulTool[] {
  return [
    {
      name: "add_reminder",
      description: "Save a reminder for the user.",
      schema: addSchema,
      handler: async (input) => {
        const parsed = addSchema.safeParse(input);
        if (!parsed.success) return `error: ${parsed.error.message}`;
        const reminder: Reminder = parsed.data;
        await store.put(NS, reminderKey(reminder), reminder);
        return `saved reminder: "${reminder.text}" at ${reminder.when}`;
      },
    },
    {
      name: "list_reminders",
      description: "List all saved reminders.",
      schema: z.object({}),
      handler: async () => {
        const items = await store.list<Reminder>(NS);
        if (!items.length) return "no reminders";
        return items.map((i) => `- ${i.value.text} @ ${i.value.when}`).join("\n");
      },
    },
  ];
}
