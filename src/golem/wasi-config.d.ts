/**
 * Minimal ambient types for `wasi:config/store` (the WASI config interface the
 * SDK ships at types/wasi_config_0_2_0_draft_store.d.ts). The host maps secret
 * sources (Vault, k8s secrets, KeyValue buckets) into this same store, so it is
 * the single injection point for both config and secrets in the sandbox.
 */
declare module "wasi:config/store@0.2.0-draft" {
  /** Returns the value for `key`, or undefined if absent. Re-reads on each call. */
  export function get(key: string): string | undefined;
  /** All config key/value pairs. */
  export function getAll(): [string, string][];
}
