/**
 * Isolated wasi:http probe (see probe/run.mjs). Performs one outbound POST to
 * the given URL and returns the HTTP status + a slice of the body. Used to
 * confirm the global `fetch` provided by StarlingMonkey reaches the network
 * through wasi:http/outgoing-handler once componentized.
 */
export async function check(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "dummy",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  const body = await res.text();
  return `HTTP ${res.status}: ${body.slice(0, 160)}`;
}
