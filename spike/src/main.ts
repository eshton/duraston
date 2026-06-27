/**
 * Spike entry point (DUR-1).
 *
 * Runs the minimal agent loop with a fake model + tool so the whole thing can
 * be (a) executed on plain Node to confirm the logic, and (b) handed to the
 * Golem/jco componentize step to confirm it survives JS->WASM.
 *
 * When the Golem TS SDK is wired up, this `main` becomes the worker's exported
 * function (see wit/spike.wit and golem.yaml). For now it is a plain entry so
 * `node dist/main.js` works as a control.
 */

import { runAgent, type ModelCall, type Tool, type Message } from "./agent-loop.js";

// A scripted "model" that asks for one tool call, then answers. No network,
// so this run is a pure-logic control — add a real provider call to test what
// the WASM sandbox allows for outbound fetch.
const fakeModel: ModelCall = async (messages) => {
  const lastIsTool = messages[messages.length - 1]?.role === "tool";
  if (lastIsTool) {
    return { content: "Done — the durable loop completed." };
  }
  return {
    content: "Let me check the clock.",
    toolCall: { name: "now", args: "" },
  };
};

const tools: Record<string, Tool> = {
  // Intentionally avoids Date.now()/Math.random() — those are exactly the
  // sources of nondeterminism a durable runtime must journal, so a real port
  // routes them through the host. Here we keep it deterministic.
  now: async () => "2026-06-27T00:00:00Z",
};

const seed: Message[] = [
  { role: "system", content: "You are a durable agent." },
  { role: "user", content: "What time is it?" },
];

async function main(): Promise<void> {
  const result = await runAgent({ messages: seed, model: fakeModel, tools });
  console.log(`stoppedBy=${result.stoppedBy} steps=${result.steps}`);
  console.log(result.messages.map((m) => `  ${m.role}: ${m.content}`).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
