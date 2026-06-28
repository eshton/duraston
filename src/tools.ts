/**
 * Tool registry, mirroring how astonagent declares tools: a zod schema for the
 * input plus a handler. zod is the dependency the DUR-1 spike most wants to
 * stress under the JS->WASM toolchain (it leans on Proxy, getters, and a large
 * amount of runtime metaprogramming).
 */
import { z } from "zod";

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  handler: (input: z.infer<S>) => Promise<string> | string;
}

/** JSON-Schema shape the Anthropic API expects for each tool. */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const getTimeSchema = z.object({
  timezone: z.string().default("UTC").describe("IANA timezone name"),
});

const addReminderSchema = z.object({
  text: z.string().min(1).describe("What to be reminded about"),
  when: z.string().describe("ISO-8601 timestamp"),
});

/**
 * A tiny but representative concierge toolset. Handlers are intentionally pure /
 * in-memory so the spike does not depend on a data layer (that is DUR-8's
 * problem); the point here is that the *declaration + dispatch* path compiles.
 */
export const TOOLS: ToolDef[] = [
  {
    name: "get_time",
    description: "Get the current time in a timezone.",
    schema: getTimeSchema,
    handler: (input) => `(stub) current time in ${input.timezone}`,
  },
  {
    name: "add_reminder",
    description: "Schedule a reminder for the user.",
    schema: addReminderSchema,
    handler: (input) => `(stub) reminder set: "${input.text}" at ${input.when}`,
  },
];

/** Convert a zod object schema to the JSON Schema the provider API wants. */
function toJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const def = (value as z.ZodTypeAny)._def;
    const description =
      typeof def.description === "string" ? def.description : undefined;
    properties[key] = { type: "string", ...(description ? { description } : {}) };
    if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
      required.push(key);
    }
  }
  return { type: "object", properties, required };
}

export function toolSpecs(): AnthropicTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toJsonSchema(t.schema as z.ZodObject<z.ZodRawShape>),
  }));
}

/** Validate input with zod, then run the matching handler. */
export async function runTool(name: string, rawInput: unknown): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `error: unknown tool "${name}"`;
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return `error: invalid input for ${name}: ${parsed.error.message}`;
  }
  return tool.handler(parsed.data);
}
