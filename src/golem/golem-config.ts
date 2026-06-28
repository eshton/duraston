/**
 * Golem ConfigSource adapter (deploy-side; typechecked vs the real SDK/WASI).
 *
 * Reads through `wasi:config/store`, the WASI config interface the host backs
 * with the worker's provisioned config + secrets. The SDK also offers typed
 * `Secret<T>`/`Config<T>` wrappers over this; we use the raw store here for a
 * minimal, stable surface.
 *
 * Rotation: `wasi:config/store.get` re-reads on every call (the SDK's
 * `Secret.get()` likewise "lazily loads or reloads"), so rotating a secret in
 * the host takes effect on the worker's *next* read — no redeploy. Because
 * secret values must never steer control flow (they'd break oplog replay
 * determinism — DUR-2), a rotated key simply applies to subsequent live calls.
 */
import { get } from "wasi:config/store@0.2.0-draft";
import { SecretValue, type ConfigSource } from "../config/config.js";

export class GolemConfig implements ConfigSource {
  get(key: string): string | undefined {
    return get(key) ?? undefined;
  }

  require(key: string): string {
    const value = this.get(key);
    if (value === undefined || value === "") {
      throw new Error(`missing required Golem config/secret: ${key}`);
    }
    return value;
  }

  secret(key: string): SecretValue {
    // Secrets are injected into the same host store; wrap so they can't leak via
    // logs/JSON. The raw value is only revealed at the point of use via .expose().
    return new SecretValue(this.require(key));
  }
}
