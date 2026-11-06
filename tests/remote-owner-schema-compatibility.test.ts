import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { RemoteOwnerStdioBridge } from "../src/runtime/remote-owner-stdio-bridge.js";
import { normalizeRemoteOwnerToolSchemas } from "../src/runtime/remote-owner-schema-compatibility.js";

const draft07 = "http://json-schema.org/draft-07/schema#";
const schema = {
  $schema: draft07, type: "object", properties: {
    rectangle: { type: "array", items: [{ type: "integer", minimum: 0 }, { type: "string", const: "right" }],
      additionalItems: false, minItems: 2, maxItems: 2 },
    empty: { type: "array", items: [], additionalItems: false, minItems: 0, maxItems: 0 },
    tail: { type: "array", items: [{ const: "first" }], additionalItems: { type: "string" }, minItems: 1 },
    nested: { anyOf: [{ $schema: draft07, type: "array", items: [{ const: "nested" }], additionalItems: false },
      { type: "null" }] },
    homogeneous: { type: "array", items: { type: "integer" } }
  }, required: ["rectangle", "empty", "tail", "nested", "homogeneous"], additionalProperties: false
} as const;
const original: Tool = {
  name: "syntx_schema_compatibility_probe", description: "A local schema probe.",
  inputSchema: schema as unknown as Tool["inputSchema"],
  outputSchema: { ...schema, properties: { ...schema.properties,
    copy: { $ref: "#/$defs/copy" } }, $defs: { copy: { type: "array", items: [{ const: "kept" }], additionalItems: false } } } as unknown as Tool["outputSchema"],
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { "openai/fileParams": ["file"], "vendor/keep": "unchanged" }
};

function noLegacyTuples(value: unknown): void {
  if (Array.isArray(value)) { for (const item of value) noLegacyTuples(item); return; }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "items") assert.equal(Array.isArray(child), false);
    if (key === "additionalItems") assert.fail("draft-07 additionalItems escaped normalization");
    noLegacyTuples(child);
  }
}

test("remote descriptor conversion preserves positional, empty, trailing, and heterogeneous tuple semantics", () => {
  const before = structuredClone(original), normalized = normalizeRemoteOwnerToolSchemas(original);
  assert.deepEqual(original, before); // canonical child descriptors are not mutated
  assert.deepEqual(normalized.annotations, original.annotations);
  assert.deepEqual(normalized._meta, original._meta);
  assert.equal(normalized.inputSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(normalized.outputSchema?.$schema, "https://json-schema.org/draft/2020-12/schema");
  noLegacyTuples(normalized.inputSchema); noLegacyTuples(normalized.outputSchema);
  const input = normalized.inputSchema as unknown as typeof schema;
  assert.deepEqual((input.properties.rectangle as unknown as { prefixItems: unknown[] }).prefixItems,
    [{ type: "integer", minimum: 0 }, { type: "string", const: "right" }]);
  assert.equal((input.properties.rectangle as unknown as { items: boolean }).items, false);
  assert.equal(Object.hasOwn(input.properties.empty, "prefixItems"), false);
  assert.equal((input.properties.empty as unknown as { items: boolean }).items, false);
  assert.deepEqual((input.properties.tail as unknown as { items: unknown }).items, { type: "string" });
  assert.deepEqual(input.properties.homogeneous.items, { type: "integer" });
  assert.equal((input.properties.nested.anyOf[0] as { $schema: string }).$schema,
    "https://json-schema.org/draft/2020-12/schema");
  assert.equal((normalized.outputSchema as unknown as { properties: { copy: { $ref: string } } }).properties.copy.$ref, "#/$defs/copy");

  const ajv = new Ajv2020({ strict: false, validateSchema: true });
  const validate = ajv.compile(normalized.inputSchema);
  const good = { rectangle: [0, "right"], empty: [], tail: ["first", "more"], nested: ["nested"], homogeneous: [1, 2] };
  assert.equal(validate(good), true);
  for (const bad of [
    { ...good, rectangle: ["right", 0] }, { ...good, rectangle: [0, "right", "extra"] },
    { ...good, empty: [1] }, { ...good, tail: ["first", 2] }, { ...good, nested: ["nested", "extra"] }
  ]) assert.equal(validate(bad), false);
  ajv.compile(normalized.outputSchema);
});

test("actual SDK gateway tools/list carries normalized schemas and unchanged metadata", async () => {
  const bridge = new RemoteOwnerStdioBridge(async () => ({
    listTools: async () => ({ tools: [original] }), listResources: async () => ({ resources: [] }),
    readResource: async () => ({ contents: [] }), callTool: async () => ({ content: [] }), close: async () => {}
  }));
  const server = bridge.createServer();
  const client = new Client({ name: "schema-compatibility-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const tool = (await client.listTools()).tools[0]!;
    noLegacyTuples(tool.inputSchema); noLegacyTuples(tool.outputSchema);
    assert.deepEqual(tool.annotations, original.annotations);
    assert.deepEqual(tool._meta?.["openai/fileParams"], ["file"]);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: "oauth2", scopes: ["syntx:owner"] }]);
  } finally { await client.close(); await server.close(); await bridge.close(); }
});
