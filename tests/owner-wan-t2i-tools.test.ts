import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { normalizeOwnerWanT2iParameters } from "../src/application/owner-wan-t2i-parameters.js";
import { OwnerWanT2iRequestPreparer } from "../src/application/owner-wan-t2i-request-preparer.js";
import { OwnerWanT2iGenerationService } from "../src/application/owner-wan-t2i-generation-service.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const TOOLS_MODULE_URL = new URL("../src/mcp/owner-wan-t2i-tools.js", import.meta.url).href;
const MODEL_IDS = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["720P", "1080P"] as const;
const BATCH_SIZES = [1, 2, 3, 4] as const;
const ATTEMPT = "link_wan_t2i_mcp_schema_test_000000000001";
const EXPECTED_TOOL_NAMES = ["syntx_owner_generate_wan_t2i_image", "syntx_owner_reconcile_wan_t2i_image",
  "syntx_owner_list_wan_t2i_image_recoveries"] as const;
const SERVER_MODULE_URL = new URL("../src/mcp/server.js", import.meta.url).href;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-t2i-mcp-tenant", subject: "wan-t2i-mcp-subject" });

function actualServiceFixture() {
  let unexpectedFetches = 0;
  const fetchImpl: typeof fetch = async () => {
    unexpectedFetches += 1;
    throw new Error("No fetch is expected from create/listTools in this fixture.");
  };
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-wan-t2i-owner-credential");
  } };
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl });
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION });
  const generationService = new OwnerWanT2iGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl })),
    createModelAccessService: () => new ModelAccessService(CATALOG, new SyntxHttpClient({ credentialBroker, fetchImpl })) });
  return { generationService, get unexpectedFetches() { return unexpectedFetches; } };
}

test("strict root generate schema accepts all 80 literal WAN T2I states without injecting fields", async () => {
  let toolsModule: Record<string, unknown> | null = null;
  try { toolsModule = await import(TOOLS_MODULE_URL) as Record<string, unknown>; }
  catch { /* Expected RED until the MCP input schema exists. */ }
  assert.ok(toolsModule?.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS, "MISSING_OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS");
  const schema = (toolsModule.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean } }
  }).generate;
  let cases = 0;
  for (const model_id of MODEL_IDS) for (const aspect_ratio of ASPECT_RATIOS) for (const resolution of RESOLUTIONS) {
    for (const batch_size of BATCH_SIZES) {
      const input = { link_attempt_id: ATTEMPT, model_id, prompt: `Explicit WAN T2I intent ${cases}`,
        parameters: { aspect_ratio, resolution, batch_size, prompt_extend: cases % 2 === 1,
          seed: batch_size === 4 ? 2_147_483_647 : null, color_palette: null, bbox_list: [] } };
      assert.equal(normalizeOwnerWanT2iParameters({ model_id, prompt: input.prompt, parameters: input.parameters })
        .source_bound_intent.model_id, model_id);
      assert.equal(schema.safeParse(input).success, true,
        `should accept ${model_id}/${aspect_ratio}/${resolution}/batch-${batch_size}`);
      cases += 1;
    }
  }
  assert.equal(cases, 80);
});

test("strict generate schema rejects hidden controls, omitted fields, and invalid prompt or inactive-state inputs", async () => {
  const toolsModule = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const inputSchemas = toolsModule.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean } }
  };
  const schema = inputSchemas.generate;
  const parameters = { aspect_ratio: "1:1", resolution: "720P", batch_size: 1, prompt_extend: false,
    seed: null, color_palette: null, bbox_list: [] };
  const valid = { link_attempt_id: ATTEMPT, model_id: "wan_25_t2i_preview", prompt: "explicit prompt", parameters };
  for (const field of ["n", "model_type", "size", "version", "file_urls", "reference_handles"]) {
    assert.equal(schema.safeParse({ ...valid, [field]: field === "n" ? 1 : "untrusted" }).success, false,
      `root must reject ${field}`);
  }
  assert.equal(schema.safeParse({ ...valid, parameters: { ...parameters, size: "720P" } }).success, false);
  assert.equal(schema.safeParse({ ...valid, parameters: { ...parameters, bbox_list: [[]] } }).success, false);
  assert.equal(schema.safeParse({ ...valid, parameters: { ...parameters, color_palette: [] } }).success, false);
  assert.equal(schema.safeParse({ ...valid, parameters: { ...parameters, seed: 1.5 } }).success, false);
  assert.equal(schema.safeParse({ ...valid, parameters: { ...parameters, batch_size: 5 } }).success, false);
  assert.equal(schema.safeParse({ ...valid, parameters: { ...parameters, aspect_ratio: "21:9" } }).success, false);
  assert.equal(schema.safeParse({ ...valid, parameters: { ...parameters, resolution: "4K" } }).success, false);
  assert.equal(schema.safeParse({ ...valid, prompt: `${"a".repeat(1_499)}\n` }).success, false,
    "the extra LF source UI unit is rejected even though the string code-unit length is 1500");
  assert.equal(schema.safeParse({ ...valid, prompt: "😀".repeat(750) }).success, true,
    "the UI limit counts UTF-16 units, not UTF-8 bytes");
  assert.equal(schema.safeParse({ link_attempt_id: ATTEMPT, model_id: "wan_25_t2i_preview", prompt: "x" }).success, false,
    "the root requires a full nested parameter object and does not inject defaults");
  assert.deepEqual(toolsModule.OWNER_WAN_T2I_TOOL_NAMES, [
    "syntx_owner_generate_wan_t2i_image", "syntx_owner_reconcile_wan_t2i_image", "syntx_owner_list_wan_t2i_image_recoveries"
  ]);
});

test("exports a registrar for all three actual WAN T2I owner tools", async () => {
  const toolsModule = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  assert.equal(typeof toolsModule.registerSyntxOwnerWanT2iTools, "function", "MISSING_OWNER_WAN_T2I_TOOL_REGISTRAR");
});

test("output schemas preserve observed versus partial batch semantics and safe recovery diagnostics", async () => {
  const toolsModule = await import(TOOLS_MODULE_URL) as Record<string, unknown>;
  const schemas = toolsModule.OWNER_WAN_T2I_TOOL_OUTPUT_SCHEMAS as {
    generate: { safeParse(value: unknown): { success: boolean } };
    reconcile: { safeParse(value: unknown): { success: boolean } };
    list_recoveries: { safeParse(value: unknown): { success: boolean } };
  };
  const artifact = { message_object_id: "img_1", message_id: "msg_1", object_type: "image", model_type: "wan_25_t2i_preview",
    completed: true, url: "https://r2.syntx.ai/generated/wan-1.png", mime_type: "image/png", mime_source: "URL_EXTENSION",
    width: null, height: null, geometry_verified: false };
  const base = { dispatch_allowed: false, backend_acceptance: "UNPROVEN", provider_execution: false,
    model_id: "wan_25_t2i_preview", profile_id: "owner-wan-t2i-source-profile-v1", profile_schema_hash: `sha256:${"a".repeat(64)}`,
    catalog_version: CATALOG_VERSION, request_fingerprint: `sha256:${"b".repeat(64)}`, intent_fingerprint: `sha256:${"c".repeat(64)}`,
    parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 2, prompt_extend: false, seed: null,
      color_palette: null, bbox_list: [] }, cost_routing: { ai_name: "wan_image", model_type: "wan_25_t2i_preview" },
    cost_inputs: { batch_size: 2 }, cost_input_confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP",
    source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY",
    requested_batch_size: 2, actual_result_count: 2, provider_terminal_confidence: "UNPROVEN" };
  assert.equal(schemas.generate.safeParse({ ...base, status: "result_observed",
    count_confidence: "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL", artifacts: [artifact, { ...artifact,
      message_object_id: "img_2", message_id: "msg_2", url: "https://r2.syntx.ai/generated/wan-2.webp",
      mime_type: "image/webp", mime_source: "URL_EXTENSION" }] }).success, true);
  assert.equal(schemas.reconcile.safeParse({ ...base, status: "partial_results",
    count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL", artifacts: [artifact] }).success, true,
  "a partial response can have the requested number of observed objects while one remains incomplete");
  assert.equal(schemas.generate.safeParse({ ...base, status: "result_observed",
    count_confidence: "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL", artifacts: [artifact] }).success, false);
  const diagnostic = { phase: "RESULT_WAIT", post_started: true, echo_ack_known: true, history_status: "READY",
    history_reason: null, result_status: "PENDING", result_reason: "RESULT_URI_PENDING", history_get_calls: 1,
    history_get_calls_saturated: false, result_get_calls: 2, result_get_calls_saturated: false };
  assert.equal(schemas.list_recoveries.safeParse({ recoveries: [{ recovery_id: `wan_t2i_recovery_${"a".repeat(8)}-${"b".repeat(4)}-${"c".repeat(4)}-${"d".repeat(4)}-${"e".repeat(12)}`,
    created_at: "2026-10-11T00:00:00.000Z", model_id: "wan_26_t2i", status: "OUTCOME_UNKNOWN", diagnostic }] }).success, true);
  assert.equal(schemas.list_recoveries.safeParse({ recoveries: [{ recovery_id: "invalid", created_at: "bad", model_id: "wan_26_t2i",
    status: "OUTCOME_UNKNOWN", diagnostic, raw_error: "private" }] }).success, false);
});

test("registers the three tools through createMcpServer with the actual generation service", async () => {
  const module = await import(SERVER_MODULE_URL) as Record<string, unknown>;
  assert.equal(typeof module.createMcpServer, "function");
  const fixture = actualServiceFixture();
  const createMcpServer = module.createMcpServer as (application: unknown, options?: unknown) => import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;
  const application = createDefaultApplication({ discoveryCatalog: CATALOG, runtimeCapabilities: null });
  assert.throws(() => createMcpServer(application, { ownerDurableGeneration: {} as never,
    ownerWanT2iImageReferences: { generationService: fixture.generationService } }),
  /OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT/u);
  const defaults = createMcpServer(application);
  const defaultPair = InMemoryTransport.createLinkedPair();
  const defaultClient = new Client({ name: "wan-t2i-default-surface-test", version: "1.0.0" });
  try {
    await defaults.connect(defaultPair[1]);
    await defaultClient.connect(defaultPair[0]);
    const defaultNames = (await defaultClient.listTools()).tools.map(({ name }) => name);
    assert.equal(defaultNames.some((name) => EXPECTED_TOOL_NAMES.includes(name as never)), false,
      "the optional WAN T2I tools remain absent from the default server");
  } finally { await Promise.all([defaultClient.close(), defaults.close()]); }

  const server = createMcpServer(application, {
    ownerWanT2iImageReferences: { generationService: fixture.generationService },
    maplessSettingsInventory: null,
    staticParameterProjection: null
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wan-t2i-mcp-tools-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    const selected = tools.filter(({ name }) => EXPECTED_TOOL_NAMES.includes(name as never));
    assert.deepEqual(selected.map(({ name }) => name), EXPECTED_TOOL_NAMES);
    const generateSchema = selected[0]?.inputSchema as { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
    assert.deepEqual(Object.keys(generateSchema.properties ?? {}).sort(), ["link_attempt_id", "model_id", "parameters", "prompt"]);
    assert.deepEqual([...(generateSchema.required ?? [])].sort(), ["link_attempt_id", "model_id", "parameters", "prompt"]);
    assert.equal(generateSchema.additionalProperties, false);
    const parameterProperties = (generateSchema.properties?.parameters as { properties?: Record<string, unknown>; required?: string[];
      additionalProperties?: boolean }).properties;
    assert.deepEqual(Object.keys(parameterProperties ?? {}).sort(), ["aspect_ratio", "batch_size", "bbox_list", "color_palette",
      "prompt_extend", "resolution", "seed"]);
    assert.equal(selected[0]?.annotations?.readOnlyHint, false);
    assert.equal(selected[0]?.annotations?.idempotentHint, false);
    assert.equal(selected[1]?.annotations?.readOnlyHint, true);
    assert.equal(selected[2]?.annotations?.readOnlyHint, true);
    assert.equal(fixture.unexpectedFetches, 0);
  } finally {
    await Promise.all([client.close(), server.close(), fixture.generationService.close()]);
  }
});
