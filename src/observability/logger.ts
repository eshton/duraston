/**
 * DUR-10: structured logging for durable workers.
 *
 * Debugging long-lived WASM workers is harder than request-scoped serverless, so
 * logs must be (a) structured (machine-parseable for aggregation), (b) carry the
 * session/worker id and the oplog position they happened at, and (c) never leak
 * secrets. The redaction here reuses DUR-7's contract: anything that stringifies
 * to "[redacted]" stays redacted, and known-sensitive keys are masked.
 *
 * On Golem these lines go to the worker's stdout, which the platform captures
 * per worker; the `seq`/`oplogIndex` field is what lets you line a log up against
 * the oplog when reproducing a stuck run.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const SENSITIVE_KEY = /(api[_-]?key|authorization|token|secret|password)/i;

/** Redact secret-ish values so a structured log line can't spill credentials. */
export function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (value == null) return value;
  // DUR-7 SecretValue (and anything else) that renders as [redacted].
  if (typeof value === "object" && String(value) === "[redacted]") return "[redacted]";
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k);
    }
    return out;
  }
  return value;
}

export interface LoggerOptions {
  sessionId: string;
  /** Where lines go; defaults to console.log. Injectable for tests. */
  sink?: (line: string) => void;
  /** Stamp provided externally (no Date.now in the sandbox / for determinism). */
  now?: () => string;
}

export class Logger {
  constructor(private readonly opts: LoggerOptions) {}

  log(level: LogLevel, message: string, fields: LogFields = {}): string {
    const line = JSON.stringify({
      level,
      sessionId: this.opts.sessionId,
      message,
      ...(this.opts.now ? { ts: this.opts.now() } : {}),
      ...(redact(fields) as Record<string, unknown>),
    });
    (this.opts.sink ?? ((l: string) => console.log(l)))(line);
    return line;
  }

  debug(m: string, f?: LogFields): string {
    return this.log("debug", m, f);
  }
  info(m: string, f?: LogFields): string {
    return this.log("info", m, f);
  }
  warn(m: string, f?: LogFields): string {
    return this.log("warn", m, f);
  }
  error(m: string, f?: LogFields): string {
    return this.log("error", m, f);
  }
}
