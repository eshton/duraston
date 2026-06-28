/**
 * DUR-7: config & secret injection into the WASM sandbox.
 *
 * DUR-1 proved ambient `process.env` does NOT cross into the component. So the
 * worker must read config/secrets through an explicit host channel. On Golem
 * that is `wasi:config/store` (the host maps Vault / k8s secrets / KeyValue into
 * it) plus the SDK's typed `Secret`/`Config`. This module is the runtime-agnostic
 * `ConfigSource` port: the loop/provider/store read through it; the backend is
 * the Golem host in production and a plain map in dev/tests.
 */

/**
 * A secret value that resists accidental disclosure: it never renders itself in
 * logs, `JSON.stringify`, or string coercion. Call `.expose()` at the exact
 * point of use (the HTTP header), never before.
 */
export class SecretValue {
  constructor(private readonly value: string) {}
  /** The only way to read the raw secret. */
  expose(): string {
    return this.value;
  }
  toString(): string {
    return "[redacted]";
  }
  toJSON(): string {
    return "[redacted]";
  }
  get [Symbol.toStringTag](): string {
    return "SecretValue";
  }
}

export interface ConfigSource {
  /** Non-secret config value, or undefined. */
  get(key: string): string | undefined;
  /** Non-secret config value or throw if absent (fail fast at startup). */
  require(key: string): string;
  /** Secret value, wrapped so it cannot be logged by accident. */
  secret(key: string): SecretValue;
}

/** Dev / Vercel adapter: config from an explicit record (NOT ambient env). */
export class MapConfig implements ConfigSource {
  constructor(private readonly values: Record<string, string | undefined>) {}
  get(key: string): string | undefined {
    return this.values[key];
  }
  require(key: string): string {
    const v = this.values[key];
    if (v === undefined || v === "") throw new Error(`missing required config: ${key}`);
    return v;
  }
  secret(key: string): SecretValue {
    return new SecretValue(this.require(key));
  }
}

// --- config keys (the astonagent env-var -> Config/Secret mapping) -----------
export const KEYS = {
  provider: "DURASTON_PROVIDER", // "anthropic" (default) | "openai-compat"
  anthropicKey: "ANTHROPIC_API_KEY", // secret
  anthropicModel: "ANTHROPIC_MODEL", // config
  llmBaseUrl: "LLM_BASE_URL", // config (e.g. Ollama host)
  llmModel: "LLM_MODEL", // config
  llmApiKey: "LLM_API_KEY", // secret (optional for Ollama)
} as const;
