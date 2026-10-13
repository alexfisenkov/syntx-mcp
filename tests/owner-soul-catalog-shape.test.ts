import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  OwnerSoulCatalogShapeHttpClient,
  OwnerSoulCatalogShapeHttpError,
  type SoulCatalogShapeKind
} from "../src/adapter/syntx/owner-soul-catalog-shape-http-client.js";
import {
  OwnerSoulCatalogShapeService,
  OwnerSoulCatalogShapeServiceError
} from "../src/application/owner-soul-catalog-shape-service.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import type { AuthBinding } from "../src/auth/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerSyntxOwnerSoulCatalogShapeTools,
  SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME
} from "../src/mcp/owner-soul-catalog-shape-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { closeOwnerReadServicesOnTransportEof } from "../src/transports/stdio-owner.js";

function credentialBroker() {
  return {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-owner-credential");
    }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("Soul shape read uses only a fixed GET and returns redacted shape metadata", async () => {
  const secretId = "private-style-id-7e4";
  const secretValue = "private-style-value-sentinel";
  const secretName = "Alex personal style";
  const secretUrl = "https://private.example/character.png?token=secret";
  let calls = 0;
  const client = new OwnerSoulCatalogShapeHttpClient({
    credentialBroker: credentialBroker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles");
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-owner-credential");
      return jsonResponse({
        styles: [{ value: secretValue, style_id: secretId, name: secretName, image: secretUrl, hidden_private_field: "sensitive" }],
        total: 1,
        private_top_secret: "do not return"
      });
    }
  });

  const result = await client.inspect("styles");
  assert.equal(calls, 1);
  assert.equal(result.kind, "styles");
  assert.equal(result.outcome, "SHAPE_OBSERVED");
  assert.equal(result.top_level.fields.styles?.types[0], "array");
  assert.equal(result.top_level.unknown_key_count, 1);
  assert.equal(result.items.container_key, "styles");
  assert.equal(result.items.item_count, 1);
  assert.equal(result.items.inspected_count, 1);
  assert.equal(result.items.unknown_key_count, 1);
  assert.deepEqual(result.items.fields.style_id?.types, ["string"]);
  assert.deepEqual(result.items.fields.value?.types, ["string"]);
  assert.deepEqual(result.items.fields.name?.types, ["string"]);
  assert.deepEqual(result.items.fields.image?.types, ["string"]);
  const serialized = JSON.stringify(result);
  for (const secret of [secretId, secretValue, secretName, secretUrl, "hidden_private_field", "private_top_secret", "sensitive"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("Soul shape kind chooses only the two fixed observed GET routes", async () => {
  const urls: string[] = [];
  const client = new OwnerSoulCatalogShapeHttpClient({
    credentialBroker: credentialBroker(),
    fetchImpl: async (input) => {
      urls.push(String(input));
      return jsonResponse([]);
    }
  });
  const styles = await client.inspect("styles");
  const characters = await client.inspect("characters");
  assert.deepEqual(urls, [
    "https://api.syntx.ai/api/v1/hf/lora/styles",
    "https://api.syntx.ai/api/v1/hf/lora/list"
  ]);
  assert.equal(styles.outcome, "EMPTY_INCONCLUSIVE");
  assert.equal(characters.outcome, "EMPTY_INCONCLUSIVE");
});

test("Soul shape reader rejects oversized and malformed bodies without returning response text", async () => {
  const tooLarge = new OwnerSoulCatalogShapeHttpClient({
    credentialBroker: credentialBroker(),
    fetchImpl: async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "70000" }
    })
  });
  await assert.rejects(() => tooLarge.inspect("styles"), (error: unknown) =>
    error instanceof OwnerSoulCatalogShapeHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");

  const malformed = new OwnerSoulCatalogShapeHttpClient({
    credentialBroker: credentialBroker(),
    fetchImpl: async () => new Response("not-json-private-response", {
      status: 200, headers: { "content-type": "application/json" }
    })
  });
  await assert.rejects(() => malformed.inspect("characters"), (error: unknown) =>
    error instanceof OwnerSoulCatalogShapeHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
});

test("Soul shape sample cap stays 20 by default, permits 128 explicitly, and remains capped", async () => {
  const sentinel = "private-style-value-sentinel-77";
  const rows = Array.from({ length: 78 }, (_, index) => ({ value: `${sentinel}-${index}`, name: "private label" }));
  const create = (maxInspectedItems?: number) => new OwnerSoulCatalogShapeHttpClient({
    credentialBroker: credentialBroker(),
    ...(maxInspectedItems === undefined ? {} : { maxInspectedItems }),
    fetchImpl: async () => jsonResponse({ items: rows })
  } as never);
  const defaultResult = await create().inspect("styles");
  assert.equal(defaultResult.items.item_count, 78);
  assert.equal(defaultResult.items.inspected_count, 20);
  assert.equal(defaultResult.items.truncated, true);

  const expandedResult = await create(128).inspect("styles");
  assert.equal(expandedResult.items.item_count, 78);
  assert.equal(expandedResult.items.inspected_count, 78);
  assert.equal(expandedResult.items.truncated, false);
  assert.deepEqual(expandedResult.items.fields.value?.types, ["string"]);
  assert.equal(JSON.stringify(expandedResult).includes(sentinel), false);

  const overCap = await create(128).inspect("styles");
  assert.equal(overCap.items.inspected_count, 78);
  const moreRowsClient = new OwnerSoulCatalogShapeHttpClient({
    credentialBroker: credentialBroker(),
    maxInspectedItems: 128 as never,
    fetchImpl: async () => jsonResponse({ items: Array.from({ length: 130 }, (_, index) => ({ value: `hidden-${index}` })) })
  } as never);
  const overLimit = await moreRowsClient.inspect("styles");
  assert.equal(overLimit.items.item_count, 130);
  assert.equal(overLimit.items.inspected_count, 128);
  assert.equal(overLimit.items.truncated, true);
});

test("invalid Soul shape sample caps fail before auth or fetch", async () => {
  let credentials = 0;
  let fetches = 0;
  assert.throws(() => new OwnerSoulCatalogShapeHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentials += 1;
      return operation("synthetic-owner-credential");
    } },
    maxInspectedItems: 64,
    fetchImpl: async () => { fetches += 1; return jsonResponse({ items: [] }); }
  } as never), (error: unknown) =>
    error instanceof OwnerSoulCatalogShapeHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentials, 0);
  assert.equal(fetches, 0);
});

test("Soul shape service checks exact linked attempt before and after the read", async () => {
  const attemptId = "link_soul_shape_service_test_123456789";
  let principalChecks = 0;
  let reads = 0;
  const linkedStatus = {
    attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status: "LINKED",
    expires_at: new Date(1_900_000_000_000).toISOString(),
    linked: true
  };
  const service = new OwnerSoulCatalogShapeService({
    binding: { tenant_id: "tenant_soul_test", subject: "subject_soul_test" },
    linkService: { async getStatus(_binding: AuthBinding, id: string) {
      principalChecks += 1;
      assert.equal(id, attemptId);
      return principalChecks === 1 ? linkedStatus : { ...linkedStatus };
    } } as never,
    catalog: { getModel(id: string) {
      assert.equal(id, "higgsfield-soul");
      return { id, ai_name: id, active: true, modalities: ["image"] };
    } } as never,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient(id) {
      assert.equal(id, attemptId);
      return { async inspect(kind: SoulCatalogShapeKind) {
        reads += 1;
        return {
          kind, outcome: "EMPTY_INCONCLUSIVE", response_bytes: 2,
          top_level: { fields: {}, unknown_key_count: 0 },
          items: { container_key: null, item_count: 0, inspected_count: 0, truncated: false,
            value_types: [], fields: {}, unknown_key_count: 0 }
        };
      } } as never;
    }
  });

  const result = await service.inspect({ attemptId, kind: "characters" });
  assert.equal(result.kind, "characters");
  assert.equal(result.model_id, "higgsfield-soul");
  assert.equal(result.catalog_version, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  assert.equal(result.generation_allowed, false);
  assert.equal(reads, 1);
  assert.equal(principalChecks, 2);
  await service.close();
});

test("Soul shape service rejects an unpinned catalog before resolving credentials", () => {
  let credentialClients = 0;
  assert.throws(() => new OwnerSoulCatalogShapeService({
    binding: { tenant_id: "tenant_soul_test", subject: "subject_soul_test" },
    linkService: { async getStatus() { throw new Error("must not be called"); } } as never,
    catalog: { getModel(id: string) { return { id, ai_name: id, active: true, modalities: ["image"] }; } } as never,
    catalogVersion: "other-catalog-version",
    resolveClient() { credentialClients += 1; throw new Error("must not be called"); }
  }), (error: unknown) => error instanceof OwnerSoulCatalogShapeServiceError && error.code === "MODEL_BINDING_MISMATCH");
  assert.equal(credentialClients, 0);
});

test("Soul shape service invalidation aborts its bounded read and close waits for completion", async () => {
  const attemptId = "link_soul_shape_abort_test_123456789";
  let started!: () => void;
  const readStarted = new Promise<void>((resolve) => { started = resolve; });
  const linkedStatus = {
    attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status: "LINKED", expires_at: new Date(1_900_000_000_000).toISOString(), linked: true
  };
  const service = new OwnerSoulCatalogShapeService({
    binding: { tenant_id: "tenant_soul_test", subject: "subject_soul_test" },
    linkService: { async getStatus(_binding: AuthBinding, _id: string) { return { ...linkedStatus }; } } as never,
    catalog: { getModel(id: string) { return { id, ai_name: id, active: true, modalities: ["image"] }; } } as never,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient() {
      return { inspect(_kind: SoulCatalogShapeKind, signal?: AbortSignal) {
        started();
        return new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new OwnerSoulCatalogShapeHttpError("UPSTREAM_REQUEST_ABORTED")), { once: true });
        });
      } } as never;
    }
  });
  const operation = service.inspect({ attemptId, kind: "styles" });
  await readStarted;
  service.invalidateAttempt(attemptId);
  await assert.rejects(operation, (error: unknown) => error instanceof OwnerSoulCatalogShapeServiceError && error.code === "UPSTREAM_REQUEST_ABORTED");
  await service.close();
  await assert.rejects(() => service.inspect({ attemptId, kind: "styles" }),
    (error: unknown) => error instanceof OwnerSoulCatalogShapeServiceError && error.code === "SERVICE_CLOSED");
});

test("Soul shape service denies an unlinked or changed principal without returning the shape", async () => {
  const attemptId = "link_soul_shape_revoke_test_123456789";
  let statusCalls = 0;
  let reads = 0;
  const service = new OwnerSoulCatalogShapeService({
    binding: { tenant_id: "tenant_soul_test", subject: "subject_soul_test" },
    linkService: { async getStatus(_binding: AuthBinding, id: string) {
      statusCalls += 1;
      const common = { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        expires_at: new Date(1_900_000_000_000).toISOString(), linked: true };
      return statusCalls === 2 ? { ...common, status: "REVOKED" } : { ...common, status: "LINKED" };
    } } as never,
    catalog: { getModel(id: string) { return { id, ai_name: id, active: true, modalities: ["image"] }; } } as never,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient() {
      return { async inspect(kind: SoulCatalogShapeKind) {
        reads += 1;
        return {
          kind, outcome: "SHAPE_OBSERVED", response_bytes: 2,
          top_level: { fields: {}, unknown_key_count: 0 },
          items: { container_key: null, item_count: 1, inspected_count: 1, truncated: false,
            value_types: ["object"], fields: {}, unknown_key_count: 0 }
        };
      } } as never;
    }
  });
  await assert.rejects(() => service.inspect({ attemptId, kind: "styles" }),
    (error: unknown) => error instanceof OwnerSoulCatalogShapeServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  assert.equal(reads, 1);
  assert.equal(statusCalls, 2);
  await service.close();
});

test("Soul shape MCP tool is opt-in, input-closed, and output contains only source-scope metadata", async () => {
  const attemptId = "link_soul_shape_tool_test_123456789";
  let calls = 0;
  const server = new McpServer({ name: "soul-shape-tool-test", version: "1" });
  registerSyntxOwnerSoulCatalogShapeTools(server, { service: {
    async inspect(input) {
      calls += 1;
      assert.deepEqual(input.attemptId, attemptId);
      assert.equal(input.kind, "styles");
      return {
        model_id: "higgsfield-soul", catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        confidence_scope: "owner_authenticated_fixed_route_shape_only", generation_allowed: false,
        backend_acceptance: "unproven", kind: "styles", outcome: "SHAPE_OBSERVED", response_bytes: 10,
        top_level: { fields: { styles: { types: ["array"], occurrences: 1 } }, unknown_key_count: 0 },
        items: { container_key: "styles", item_count: 1, inspected_count: 1, truncated: false,
          value_types: ["object"], fields: { style_id: { types: ["string"], occurrences: 1 } }, unknown_key_count: 0 }
      };
    }
  } });
  const client = new Client({ name: "soul-shape-tool-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME]);
    const result = await client.callTool({ name: SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME,
      arguments: { link_attempt_id: attemptId, kind: "styles" } });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { generation_allowed: boolean }).generation_allowed, false);
    const invalid = await client.callTool({ name: SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME,
      arguments: { link_attempt_id: attemptId, kind: "styles", owner_id: "cannot-select-principal" } });
    assert.equal(invalid.isError, true);
    assert.equal(calls, 1);
  } finally { await client.close(); await server.close(); }
});

test("owner runtime registers Soul shape only with its explicit flag and listTools makes no request", async () => {
  let fetches = 0;
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl: async () => {
    fetches += 1;
    throw new Error("Tool registration must not make a request.");
  } });
  assert.equal(defaultRuntime.serverOptions.ownerSoulCatalogShape, undefined);

  const optedRuntime = createObservedOwnerRuntime({ ownerSoulCatalogShapeEnabled: true, fetchImpl: async () => {
    fetches += 1;
    throw new Error("Tool listing must not make a request.");
  } });
  assert.ok(optedRuntime.serverOptions.ownerSoulCatalogShape);
  const server = createMcpServer(optedRuntime.application, optedRuntime.serverOptions);
  const client = new Client({ name: "soul-shape-runtime-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes(SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME), true);
    assert.equal(fetches, 0);
  } finally { await client.close(); await server.close(); }
});

test("Soul style options are an independent default-off owner runtime surface", async () => {
  let fetches = 0;
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    throw new Error("Listing MCP tools must not make a style request.");
  };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl });
  assert.equal((defaultRuntime.serverOptions as unknown as { ownerSoulStyleOptions?: unknown }).ownerSoulStyleOptions, undefined);

  const shapeOnlyRuntime = createObservedOwnerRuntime({ ownerSoulCatalogShapeEnabled: true, fetchImpl });
  assert.equal((shapeOnlyRuntime.serverOptions as unknown as { ownerSoulStyleOptions?: unknown }).ownerSoulStyleOptions, undefined);

  const styleRuntime = createObservedOwnerRuntime({ ownerSoulStyleOptionsEnabled: true, fetchImpl });
  assert.ok((styleRuntime.serverOptions as unknown as { ownerSoulStyleOptions?: unknown }).ownerSoulStyleOptions);
  const server = createMcpServer(styleRuntime.application, styleRuntime.serverOptions);
  const client = new Client({ name: "soul-style-runtime-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes("syntx_list_owner_soul_style_options"), true);
    assert.equal(names.includes(SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME), false);
    assert.equal(fetches, 0);
  } finally { await client.close(); await server.close(); }
});

test("owner stdio flag is default-off and opt-in adds only the read-only shape tool", async () => {
  const baseEnv = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("SYNTX_OWNER_")
      && entry[0] !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  for (const enabled of [false, true]) {
    const client = new Client({ name: "soul-shape-owner-stdio-test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/src/transports/stdio-owner.js"],
      cwd: process.cwd(),
        env: {
          ...baseEnv,
          SYNTX_PUBLIC_CATALOG_VERSION: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        ...(enabled ? {
          SYNTX_OWNER_SOUL_CATALOG_SHAPE: "1",
          SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS: "128"
        } : {})
      },
      stderr: "pipe"
    });
    await client.connect(transport as unknown as Transport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.equal(names.includes(SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME), enabled);
    } finally { await client.close(); }
  }
});

test("owner stdio rejects a partial or non-exact Soul shape sample-cap configuration", () => {
  const baseEnv = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("SYNTX_OWNER_")
      && entry[0] !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  const cases = [
    { SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS: "128" },
    { SYNTX_OWNER_SOUL_CATALOG_SHAPE: "1", SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS: "0128" }
  ];
  for (const extraEnv of cases) {
    const result = spawnSync(process.execPath, ["dist/src/transports/stdio-owner.js"], {
      cwd: process.cwd(),
      env: { ...baseEnv, SYNTX_PUBLIC_CATALOG_VERSION: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, ...extraEnv },
      input: "",
      encoding: "utf8",
      timeout: 5000
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.includes("tool"), false);
  }
});

test("owner stdio style-options flag is default-off and invalid values fail before startup", () => {
  const baseEnv = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("SYNTX_OWNER_")
      && entry[0] !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  const run = (extraEnv: Record<string, string>) => spawnSync(process.execPath, ["dist/src/transports/stdio-owner.js"], {
    cwd: process.cwd(),
    env: { ...baseEnv, SYNTX_PUBLIC_CATALOG_VERSION: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, ...extraEnv },
    input: "",
    encoding: "utf8",
    timeout: 5000
  });
  const invalid = run({ SYNTX_OWNER_SOUL_STYLE_OPTIONS: "true" });
  assert.equal(invalid.error, undefined);
  assert.notEqual(invalid.status, 0);
});

test("owner stdio registers style options only for its independent explicit flag", async () => {
  const baseEnv = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("SYNTX_OWNER_")
      && entry[0] !== "SYNTX_PUBLIC_CATALOG_VERSION"));
  for (const enabled of [false, true]) {
    const client = new Client({ name: "soul-style-owner-stdio-test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/src/transports/stdio-owner.js"],
      cwd: process.cwd(),
      env: {
        ...baseEnv,
        SYNTX_PUBLIC_CATALOG_VERSION: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        ...(enabled ? { SYNTX_OWNER_SOUL_STYLE_OPTIONS: "1" } : {})
      },
      stderr: "pipe"
    });
    await client.connect(transport as unknown as Transport);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      assert.equal(names.includes("syntx_list_owner_soul_style_options"), enabled);
      assert.equal(names.includes(SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME), false);
    } finally { await client.close(); }
  }
});

test("owner read-service EOF close drains style options before auth release", async () => {
  const events: string[] = [];
  const input = new PassThrough();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const close = closeOwnerReadServicesOnTransportEof(
    serverTransport as unknown as Transport,
    undefined,
    undefined,
    undefined,
    { async close() { events.push("style-close-start"); await Promise.resolve(); events.push("style-close-done"); } },
    () => events.push("auth-close"),
    input
  );
  input.end();
  await close();
  assert.deepEqual(events, ["style-close-start", "style-close-done", "auth-close"]);
  await clientTransport.close();
});
