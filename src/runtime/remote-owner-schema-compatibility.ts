import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// The owner stdio SDK exports Zod tuples as draft-07 `items: [schemas]`.
// Remote MCP advertises JSON Schema 2020-12, which represents the same
// positional tuple with `prefixItems` and a trailing `items` schema.
const DRAFT_07 = new Set(["http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft-07/schema#"]);
const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);
const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_SINGLES = new Set(["items", "additionalItems", "additionalProperties", "unevaluatedItems",
  "unevaluatedProperties", "contains", "not", "if", "then", "else", "propertyNames", "contentSchema"]);

type SchemaObject = Record<string, unknown>;
function record(value: unknown): value is SchemaObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSchema(value: unknown): unknown {
  if (!record(value)) return value; // Boolean schemas are valid in both dialects.
  const result: SchemaObject = { ...value };
  for (const [key, child] of Object.entries(value)) {
    if (SCHEMA_MAPS.has(key) && record(child)) {
      result[key] = Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, normalizeSchema(schema)]));
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(child)) {
      result[key] = child.map(normalizeSchema);
    } else if (SCHEMA_SINGLES.has(key) && key !== "items") {
      result[key] = normalizeSchema(child);
    } else if (key === "items" && !Array.isArray(child)) {
      result[key] = normalizeSchema(child);
    }
  }
  if (DRAFT_07.has(result.$schema as string)) result.$schema = DRAFT_2020_12;
  if (Array.isArray(value.items)) {
    const positional = value.items.map(normalizeSchema);
    delete result.items;
    delete result.additionalItems;
    if (positional.length > 0) result.prefixItems = positional;
    // `additionalItems` applied only after a draft-07 tuple. In 2020-12,
    // `items` governs those trailing positions; absent means unrestricted.
    if (Object.hasOwn(value, "additionalItems")) result.items = normalizeSchema(value.additionalItems);
  }
  return result;
}

/** Descriptor-only projection; the canonical child schemas and validators stay unchanged. */
export function normalizeRemoteOwnerToolSchemas(tool: Tool): Tool {
  return {
    ...tool,
    inputSchema: normalizeSchema(tool.inputSchema) as Tool["inputSchema"],
    ...(tool.outputSchema === undefined ? {} : { outputSchema: normalizeSchema(tool.outputSchema) as Tool["outputSchema"] })
  };
}
