/**
 * Component entry point. jco componentize maps each exported function in the
 * `agent-worker` WIT world to a named export here. `run-session` (kebab in WIT)
 * binds to `runSession` (camel in JS).
 *
 * On Golem the worker's secrets come from Config/Secret (DUR-7); for the spike
 * we read an env var if one is present and otherwise run in a no-key mode so the
 * component still instantiates and exercises the loop's setup path.
 */
import { runAgent } from "./agent.js";

// `process` may be undefined under the WASI/StarlingMonkey runtime; guard it.
function readApiKey(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any).process?.env;
    return env?.ANTHROPIC_API_KEY ?? "";
  } catch {
    return "";
  }
}

export async function runSession(prompt: string): Promise<string> {
  const apiKey = readApiKey();
  if (!apiKey) {
    // No provider call possible without a key; return a deterministic marker so
    // the spike can confirm the component instantiates and the export is callable
    // end-to-end without needing a live API.
    return `duraston-spike: loop wired, no ANTHROPIC_API_KEY present. prompt was: "${prompt}"`;
  }
  try {
    return await runAgent(prompt, { apiKey });
  } catch (err) {
    // WIT `result<string, string>`: jco surfaces a thrown error as the err arm.
    throw new Error(err instanceof Error ? err.message : String(err));
  }
}
