/**
 * Evidence for DUR-1: prove `fetch` actually executes through wasi:http inside
 * a componentized JS module (not merely that it links). Builds an isolated
 * probe component that POSTs to the Anthropic Messages API with a dummy key;
 * a real HTTP 401 coming back proves the outbound request left the sandbox.
 *
 *   npx jco componentize probe/probe.js --wit probe/probe.wit \
 *     --world-name http-probe --out probe/probe.wasm
 *   npx jco transpile probe/probe.wasm -o probe/t
 *   node probe/run.mjs
 */
import { check } from "./t/probe.js";

const url = process.argv[2] ?? "https://api.anthropic.com/v1/messages";
try {
  console.log(await check(url));
} catch (e) {
  console.log("ERR:", String(e).slice(0, 300));
}
