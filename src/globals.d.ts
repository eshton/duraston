/**
 * Runtime globals the component assumes are provided by the host.
 *
 * Under jco/StarlingMonkey these are backed by the WASI HTTP world; on Golem
 * `fetch` maps to the durable golem:llm/http host. We declare only the subset
 * the spike uses, deliberately NOT pulling in the full DOM lib -- the narrower
 * surface is itself a finding about what a Golem worker can rely on.
 */
declare function fetch(
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;
