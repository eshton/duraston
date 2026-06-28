/**
 * DUR-7 tests: config/secret injection through the ConfigSource port, secret
 * redaction (the security property), and building the right provider from
 * config — proving provider choice (Anthropic vs Ollama) is config, not code.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MapConfig, SecretValue, providerFromConfig, KEYS } from "../dist/config.js";

test("SecretValue refuses to render itself; expose() is the only way out", () => {
  const s = new SecretValue("sk-ant-supersecret");
  assert.equal(String(s), "[redacted]");
  assert.equal(`key=${s}`, "key=[redacted]");
  assert.equal(JSON.stringify({ apiKey: s }), '{"apiKey":"[redacted]"}');
  // even logging an object containing it won't leak
  assert.doesNotMatch(JSON.stringify({ s }), /supersecret/);
  // the value is still retrievable at the point of use
  assert.equal(s.expose(), "sk-ant-supersecret");
});

test("MapConfig: get / require / secret", () => {
  const cfg = new MapConfig({ A: "1", SECRET: "shh" });
  assert.equal(cfg.get("A"), "1");
  assert.equal(cfg.get("MISSING"), undefined);
  assert.throws(() => cfg.require("MISSING"), /missing required config: MISSING/);
  const secret = cfg.secret("SECRET");
  assert.equal(String(secret), "[redacted]");
  assert.equal(secret.expose(), "shh");
});

test("providerFromConfig builds Anthropic by default", () => {
  const cfg = new MapConfig({ [KEYS.anthropicKey]: "sk-ant-x", [KEYS.anthropicModel]: "claude-opus-4-8" });
  const p = providerFromConfig(cfg);
  assert.equal(p.name, "anthropic");
});

test("providerFromConfig builds the Ollama (openai-compat) path from config", () => {
  const cfg = new MapConfig({
    [KEYS.provider]: "openai-compat",
    [KEYS.llmBaseUrl]: "http://localhost:11434/v1",
    [KEYS.llmModel]: "llama3.1",
  });
  const p = providerFromConfig(cfg);
  assert.match(p.name, /openai-compat\(http:\/\/localhost:11434\/v1\)/);
});

test("missing required secret/config fails fast", () => {
  const cfg = new MapConfig({}); // no ANTHROPIC_API_KEY
  assert.throws(() => providerFromConfig(cfg), /missing required config: ANTHROPIC_API_KEY/);
});
