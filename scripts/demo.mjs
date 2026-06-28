/**
 * Invoke the componentized agent worker through jco's preview2 WASI host shim,
 * to prove the `run-session` export is callable end-to-end after building.
 * Run with: npm run build && npm run demo
 */
import { runSession } from "../dist/transpiled/agent.js";

const prompt = process.argv[2] ?? "Remind me to call mom tomorrow at 9am";
const out = await runSession(prompt);
console.log("RESULT:", out);
