import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerGrokT2iGenerationServiceError } from "../src/application/owner-grok-t2i-generation-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import { registerSyntxOwnerGrokT2iImageTools } from "../src/mcp/owner-grok-t2i-image-tools.js";

const TOOL_NAMES = [
  "syntx_upload_grok_t2i_image_reference",
  "syntx_owner_generate_grok_t2i_image",
  "syntx_owner_reconcile_grok_t2i_image",
  "syntx_owner_list_grok_t2i_image_recoveries"
];

async function inspect(options?: unknown) {
  const server = createMcpServer(createDefaultApplication(), options as never);
  const client = new Client({ name: "grok-t2i-image-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return { tools: (await client.listTools()).tools, client, server }; }
  catch (error) { await client.close(); await server.close(); throw error; }
}

test("four full4 Grok T2I MCP tools are absent by default and appear only under explicit owner composition", async () => {
  const defaults = await inspect();
  try { assert.equal(defaults.tools.some(({ name }) => TOOL_NAMES.includes(name)), false); }
  finally { await defaults.client.close(); await defaults.server.close(); }

  const composition = {
    uploadService: { async upload() { throw new Error("unused"); } },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const owner = await inspect({ ownerGrokT2iImageReferences: composition });
  try {
    assert.deepEqual(owner.tools.map(({ name }) => name).filter((name) => TOOL_NAMES.includes(name)).sort(), [...TOOL_NAMES].sort());
    for (const name of TOOL_NAMES) {
      const tool = owner.tools.find((item) => item.name === name)!;
      assert.equal((tool.inputSchema as Record<string, unknown>).additionalProperties, false, `${name} input must be closed`);
      assert.equal((tool.outputSchema as Record<string, unknown>).additionalProperties, false, `${name} output must be closed`);
      assert.equal(Object.hasOwn(tool.inputSchema as object, "anyOf"), false, `${name} must keep its root schema an object`);
    }
    const uploadTool = owner.tools.find((item) => item.name === "syntx_upload_grok_t2i_image_reference")!;
    const contentBase64 = ((uploadTool.inputSchema as { properties: Record<string, unknown> }).properties.content_base64 as Record<string, unknown>);
    assert.equal(contentBase64.maxLength, Math.ceil((64 * 1024 * 1024) / 3) * 4, "published limit is the local 64 MiB resource ceiling");
    const annotations = Object.fromEntries(owner.tools.filter(({ name }) => TOOL_NAMES.includes(name)).map(({ name, annotations: value }) => [name, value])) as
      Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }>;
    assert.deepEqual([annotations.syntx_upload_grok_t2i_image_reference?.readOnlyHint,
      annotations.syntx_upload_grok_t2i_image_reference?.destructiveHint,
      annotations.syntx_upload_grok_t2i_image_reference?.idempotentHint,
      annotations.syntx_upload_grok_t2i_image_reference?.openWorldHint], [false, true, false, true]);
    assert.deepEqual([annotations.syntx_owner_generate_grok_t2i_image?.readOnlyHint,
      annotations.syntx_owner_generate_grok_t2i_image?.destructiveHint,
      annotations.syntx_owner_generate_grok_t2i_image?.idempotentHint,
      annotations.syntx_owner_generate_grok_t2i_image?.openWorldHint], [false, true, false, true]);
    for (const name of ["syntx_owner_reconcile_grok_t2i_image", "syntx_owner_list_grok_t2i_image_recoveries"]) {
      assert.deepEqual([annotations[name]?.readOnlyHint, annotations[name]?.destructiveHint,
        annotations[name]?.idempotentHint, annotations[name]?.openWorldHint], [true, false, true, true]);
    }
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("SDK tool validates every source ratio/reference-count branch and forwards all explicit controls without defaults", async () => {
  const received: Array<Record<string, unknown>> = [];
  const generationService = {
    async generate(input: unknown) {
      const request = input as { attemptId: string; model_id: string; prompt: string; parameters: Record<string, unknown>; reference_handles: string[] };
      received.push(request as unknown as Record<string, unknown>);
      const batchSize = request.parameters.batch_size as number;
      return {
        status: "result_observed", backend_acceptance: "UNPROVEN", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED",
        ai_name: "grok_image", model_id: request.model_id, operation_id: "generate-image", profile_id: "grok-t2i-test-v1",
        profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        request_fingerprint: `sha256:${"b".repeat(64)}`, parameters: request.parameters,
        reference_count: request.reference_handles.length,
        artifacts: Array.from({ length: batchSize }, (_, index) => ({ message_object_id: index === 0 ? "output~1" : `output-${index + 1}`,
          url: `https://r2.syntx.ai/private/grok/output-${index + 1}.png`, mime_type: "image/png",
          width: null, height: null, geometry_verified: false }))
      };
    },
    async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
    async invalidateAttempt() {}, async close() {}
  };
  const uploadService = { async upload() { throw new Error("unused"); } };
  const owner = await inspect({ ownerGrokT2iImageReferences: { uploadService, generationService } });
  const baseRatios = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"];
  const imagineRatios = ["1:1", "2:3", "3:2", "9:16", "16:9"];
  const scenarios = [
    ...(["grok_t2i", "grok_t2i_pro"] as const).flatMap((model_id) => baseRatios.map((aspect_ratio) => ({ model_id, referenceCount: 0, aspect_ratio }))),
    ...Array.from({ length: 6 }, (_, referenceCount) => (referenceCount === 0 ? imagineRatios : baseRatios)
      .map((aspect_ratio) => ({ model_id: "grok_imagine_2" as const, referenceCount, aspect_ratio }))),
    ...Array.from({ length: 4 }, (_, referenceCount) => (referenceCount === 0 ? imagineRatios : baseRatios)
      .map((aspect_ratio) => ({ model_id: "grok_imagine_quality" as const, referenceCount, aspect_ratio })))
  ].flat();
  let accepted = 0;
  try {
    for (const scenario of scenarios) for (const batch_size of [1, 2, 3, 4, 5]) {
      const reference_handles = Array.from({ length: scenario.referenceCount }, (_, index) =>
        `grok_t2i_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
      const parameters = { aspect_ratio: scenario.aspect_ratio, resolution: batch_size % 2 === 0 ? "2k" : "1k", batch_size,
        ...(scenario.model_id === "grok_imagine_2" ? { details_quality: batch_size % 2 === 0 ? "medium" : "low" } : {}) };
      const result = await owner.client.callTool({ name: "syntx_owner_generate_grok_t2i_image", arguments: {
        link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: scenario.model_id,
        prompt: "Explicit settings only", reference_handles, parameters
      } });
      assert.equal(result.isError, undefined, `${scenario.model_id}/${scenario.referenceCount}/${scenario.aspect_ratio}/${batch_size}: ${JSON.stringify(result)}`);
      assert.deepEqual((result.structuredContent as { parameters: unknown }).parameters, parameters);
      const forwarded = received.at(-1)!;
      assert.deepEqual(Object.keys(forwarded).sort(), ["attemptId", "model_id", "parameters", "prompt", "reference_handles"].sort());
      assert.equal(forwarded.attemptId, "link_grok_tools_0123456789abcdef");
      assert.equal(forwarded.model_id, scenario.model_id);
      assert.deepEqual(forwarded.parameters, parameters);
      assert.equal((result.structuredContent as { artifacts: unknown[] }).artifacts.length, batch_size);
      accepted += 1;
    }
    assert.equal(accepted, scenarios.length * 5);
    assert.equal(received.length, accepted);
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("upload accepts only Imagine models, canonical bounded base64, and returns an exact URL-free receipt", async () => {
  const uploads: Array<Record<string, unknown>> = [];
  const composition = {
    uploadService: { async upload(input: unknown) {
      uploads.push(input as Record<string, unknown>);
      const request = input as { model_id: "grok_imagine_2" | "grok_imagine_quality"; mime_type: string };
      return { status: "uploaded", reference_handle: "grok_t2i_image_00000000-0000-4000-8000-000000000001",
        model_id: request.model_id, source_mime_type: request.mime_type, mime_type: "image/jpeg", width: 1, height: 1, size: 3,
        sha256: `sha256:${"a".repeat(64)}`, expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY",
        size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" };
    } },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const owner = await inspect({ ownerGrokT2iImageReferences: composition });
  try {
    const receipt = await owner.client.callTool({ name: "syntx_upload_grok_t2i_image_reference", arguments: {
      link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_imagine_2", content_base64: "YWJj",
      filename: "reference.jpg", mime_type: "image/jpg"
    } });
    assert.equal(receipt.isError, undefined);
    const { signal, ...uploadRequest } = uploads[0]!;
    assert.ok(signal instanceof AbortSignal);
    assert.deepEqual(uploadRequest, { attemptId: "link_grok_tools_0123456789abcdef", model_id: "grok_imagine_2",
      content_base64: "YWJj", filename: "reference.jpg", mime_type: "image/jpg" });
    assert.equal(JSON.stringify(receipt.structuredContent).includes("https://"), false);
    assert.equal(JSON.stringify(receipt.structuredContent).includes("content_base64"), false);
    for (const invalid of [
      { link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_t2i", content_base64: "YWJj", filename: "ref.jpg", mime_type: "image/jpeg" },
      { link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_imagine_2", content_base64: "YR==", filename: "ref.jpg", mime_type: "image/jpeg" },
      { link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_imagine_2", content_base64: "YWJj", filename: "../ref.jpg", mime_type: "image/jpeg" },
      { link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_imagine_2", content_base64: "YWJj", filename: "ref.jpg", mime_type: "image/jpeg", file_urls: [] }
    ]) {
      const rejected = await owner.client.callTool({ name: "syntx_upload_grok_t2i_image_reference", arguments: invalid });
      assert.equal(rejected.isError, true);
    }
    assert.equal(uploads.length, 1, "invalid upload requests are rejected before the upload service");
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("wrong branch shapes, missing details, guessed authority fields, repeated refs, and prompt over-budget fail before service", async () => {
  let calls = 0;
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); } },
    generationService: { async generate(input: unknown) {
      calls += 1;
      const request = input as { model_id: string; parameters: Record<string, unknown>; reference_handles: string[] };
      const batchSize = request.parameters.batch_size as number;
      return { status: "result_observed", backend_acceptance: "UNPROVEN", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED",
        ai_name: "grok_image", model_id: request.model_id, operation_id: "generate-image", profile_id: "p",
        profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        request_fingerprint: `sha256:${"b".repeat(64)}`, parameters: request.parameters,
        reference_count: request.reference_handles.length, artifacts: Array.from({ length: batchSize }, (_, index) => ({
          message_object_id: `output-${index + 1}`, url: `https://r2.syntx.ai/grok/output-${index + 1}.png`,
          mime_type: "image/png", width: null, height: null, geometry_verified: false })) };
    }, async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {} }
  };
  const owner = await inspect({ ownerGrokT2iImageReferences: composition });
  const validBase = { link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_t2i", prompt: "valid",
    reference_handles: [], parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 } };
  try {
    const invalid = [
      { ...validBase, reference_handles: ["grok_t2i_image_00000000-0000-4000-8000-000000000001"] },
      { ...validBase, n: 1 },
      { ...validBase, cost_inputs: {} },
      { ...validBase, principal: { tenant_id: "caller", subject_id: "caller", connection_id: "link_grok_tools_0123456789abcdef" } },
      { ...validBase, file_urls: [] },
      { ...validBase, reference_count: 0 },
      { ...validBase, stream: false },
      { ...validBase, parameters: { ...validBase.parameters, details_quality: "low" } },
      { ...validBase, parameters: { aspect_ratio: "1:1", resolution: "1k" } },
      { ...validBase, model_id: "grok_imagine_2", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 } },
      { ...validBase, model_id: "grok_imagine_quality", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1,
        details_quality: "low" } },
      { ...validBase, model_id: "grok_imagine_quality", parameters: { aspect_ratio: "2:1", resolution: "1k", batch_size: 1 } },
      { ...validBase, model_id: "grok_imagine_quality", reference_handles: ["grok_t2i_image_00000000-0000-4000-8000-000000000001",
        "grok_t2i_image_00000000-0000-4000-8000-000000000001"], parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 } },
      { ...validBase, prompt: "я".repeat(5_001) }
    ];
    for (const input of invalid) {
      const result = await owner.client.callTool({ name: "syntx_owner_generate_grok_t2i_image", arguments: input });
      assert.equal(result.isError, true);
    }
    assert.equal(calls, 0);
    const validUnicode = { ...validBase, model_id: "grok_imagine_2", prompt: "я".repeat(500) + "😀".repeat(250),
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1, details_quality: "low" } };
    assert.equal(validUnicode.prompt.length, 1_000);
    const accepted = await owner.client.callTool({ name: "syntx_owner_generate_grok_t2i_image", arguments: validUnicode });
    assert.equal(accepted.isError, undefined);
    assert.equal(calls, 1);
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("unknown-outcome errors retain only typed recovery diagnostics, and list output has no prompt or media URL", async () => {
  const recoveryId = "grok_t2i_recovery_00000000-0000-4000-8000-000000000001";
  const diagnostic = {
    phase: "RESULT_WAIT", post_started: true, echo_ack_known: true, history_status: "READY", history_reason: null,
    result_status: "PARTIAL", result_reason: "OUTPUT_BATCH_PARTIAL", history_get_calls: 2, history_get_calls_saturated: false,
    result_get_calls: 1, result_get_calls_saturated: false
  } as const;
  const recoveries = [{ recovery_id: recoveryId, created_at: "2026-10-11T02:00:00.000Z", model_id: "grok_imagine_2",
    operation_id: "generate-image", status: "OUTCOME_UNKNOWN", diagnostic }];
  const listRequests: Array<Record<string, unknown>> = [];
  const generationService = {
    async generate() { throw new OwnerGrokT2iGenerationServiceError("OUTCOME_UNKNOWN", recoveryId, diagnostic); },
    async reconcile() { throw new Error("unused"); }, async listRecoveries(input: unknown) { listRequests.push(input as Record<string, unknown>); return recoveries; },
    async invalidateAttempt() {}, async close() {}
  };
  const owner = await inspect({ ownerGrokT2iImageReferences: { uploadService: { async upload() { throw new Error("unused"); } }, generationService } });
  try {
    const started = await owner.client.callTool({ name: "syntx_owner_generate_grok_t2i_image", arguments: {
      link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_imagine_2", prompt: "private prompt should not echo",
      reference_handles: [], parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1, details_quality: "low" }
    } });
    assert.equal(started.isError, true);
    const errorText = (started.content as readonly { type: string; text?: string }[]).find((item) => item.type === "text")?.text ?? "";
    const error = JSON.parse(errorText) as { error: { code: string; recovery_id?: string; diagnostic?: Record<string, unknown> } };
    assert.equal(error.error.code, "OUTCOME_UNKNOWN");
    assert.equal(error.error.recovery_id, recoveryId);
    assert.equal(error.error.diagnostic?.history_status, "READY");
    assert.equal(error.error.diagnostic?.result_status, "PARTIAL");
    assert.equal(error.error.diagnostic?.result_reason, "OUTPUT_BATCH_PARTIAL");
    assert.equal(errorText.includes("private prompt"), false);

    const listed = await owner.client.callTool({ name: "syntx_owner_list_grok_t2i_image_recoveries", arguments: {
      link_attempt_id: "link_grok_tools_0123456789abcdef", limit: 5
    } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    assert.deepEqual((listed.structuredContent as { recoveries: unknown[] }).recoveries, recoveries);
    assert.deepEqual(listRequests, [{ attemptId: "link_grok_tools_0123456789abcdef", limit: 5 }]);
    assert.equal(JSON.stringify(listed.structuredContent).includes("https://"), false);
    assert.equal(JSON.stringify(listed.structuredContent).includes("prompt"), false);
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("reconcile forwards only the attempt and exact opaque recovery handle, including cancellation signal", async () => {
  const received: Array<{ input: unknown; signal: unknown }> = [];
  const generationService = {
    async generate() { throw new Error("unused"); },
    async reconcile(input: unknown, signal?: AbortSignal) {
      received.push({ input, signal });
      return { status: "result_observed", backend_acceptance: "UNPROVEN", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED",
        ai_name: "grok_image", model_id: "grok_t2i", operation_id: "generate-image", profile_id: "grok-t2i-test-v1",
        profile_schema_hash: `sha256:${"a".repeat(64)}`, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        request_fingerprint: `sha256:${"b".repeat(64)}`,
        parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, reference_count: 0,
        artifacts: [{ message_object_id: "output~1", url: "https://r2.syntx.ai/private/grok/output.png", mime_type: "image/png",
          width: null, height: null, geometry_verified: false }] };
    }, async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {}
  };
  const owner = await inspect({ ownerGrokT2iImageReferences: { uploadService: { async upload() { throw new Error("unused"); } }, generationService } });
  try {
    const response = await owner.client.callTool({ name: "syntx_owner_reconcile_grok_t2i_image", arguments: {
      link_attempt_id: "link_grok_tools_0123456789abcdef", recovery_id: "grok_t2i_recovery_00000000-0000-4000-8000-000000000001"
    } });
    assert.equal(response.isError, undefined, JSON.stringify(response));
    assert.equal((response.structuredContent as Record<string, unknown>).status, "result_observed");
    assert.equal(received.length, 1);
    assert.deepEqual(received[0]!.input, { attemptId: "link_grok_tools_0123456789abcdef",
      recovery_id: "grok_t2i_recovery_00000000-0000-4000-8000-000000000001" });
    assert.ok(received[0]!.signal instanceof AbortSignal);
    const rejected = await owner.client.callTool({ name: "syntx_owner_reconcile_grok_t2i_image", arguments: {
      link_attempt_id: "link_grok_tools_0123456789abcdef", recovery_id: "grok_t2i_recovery_00000000-0000-4000-8000-000000000001",
      model_id: "grok_t2i"
    } });
    assert.equal(rejected.isError, true);
    assert.equal(received.length, 1);
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("tool handlers reject proxy/getter payloads without executing accessors or invoking services", async () => {
  const handlers = new Map<string, (input: unknown, extra: unknown) => Promise<CallToolResult>>();
  let generateCalls = 0;
  const fakeServer = { registerTool(name: string, _config: unknown,
    handler: (input: unknown, extra: unknown) => Promise<CallToolResult>) { handlers.set(name, handler); } } as unknown as McpServer;
  registerSyntxOwnerGrokT2iImageTools(fakeServer, {
    uploadService: { async upload() { throw new Error("must not run"); } },
    generationService: { async generate() { generateCalls += 1; throw new Error("must not run"); },
      async reconcile() { throw new Error("must not run"); }, async listRecoveries() { return []; } }
  });
  const generate = handlers.get("syntx_owner_generate_grok_t2i_image")!;
  let getterCalled = false;
  const getterInput = Object.defineProperty({}, "link_attempt_id", { enumerable: true, get() {
    getterCalled = true; throw new Error("private getter must not execute");
  } });
  const getterResult = await generate(getterInput, { signal: undefined });
  assert.equal(getterCalled, false);
  assert.equal(getterResult.isError, true);
  const proxyInput = new Proxy({}, { getPrototypeOf() { throw new Error("proxy trap must not execute"); } });
  const proxyResult = await generate(proxyInput, { signal: undefined });
  assert.equal(proxyResult.isError, true);
  assert.equal(generateCalls, 0);
});

test("malformed service output is replaced with a safe fallback instead of exposing getters or raw values", async () => {
  const handlers = new Map<string, (input: unknown, extra: unknown) => Promise<CallToolResult>>();
  const secret = "raw upstream URL https://private.invalid/secret and private prompt";
  const fakeServer = { registerTool(name: string, _config: unknown,
    handler: (input: unknown, extra: unknown) => Promise<CallToolResult>) { handlers.set(name, handler); } } as unknown as McpServer;
  registerSyntxOwnerGrokT2iImageTools(fakeServer, {
    uploadService: { async upload() { throw new Error(secret); } },
    generationService: { async generate() { return new Proxy({}, { getPrototypeOf() { throw new Error(secret); } }) as never; },
      async reconcile() { throw new Error(secret); }, async listRecoveries() { return []; } }
  });
  const generate = handlers.get("syntx_owner_generate_grok_t2i_image")!;
  const result = await generate({ link_attempt_id: "link_grok_tools_0123456789abcdef", model_id: "grok_t2i", prompt: "safe",
    reference_handles: [], parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 } }, { signal: undefined });
  assert.equal(result.isError, true);
  const text = result.content.find((item) => item.type === "text")?.text ?? "";
  assert.equal(text.includes("private.invalid"), false);
  assert.equal(text.includes("private prompt"), false);
});
