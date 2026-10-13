import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OwnerGrokImageReferenceService } from "../src/application/owner-grok-image-reference-service.js";
import { OwnerGrokImageReferenceLifecycleError } from "../src/application/owner-grok-image-reference-lifecycle.js";
import {
  registerSyntxOwnerGrokImageReferenceTools,
  SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME,
  SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME
} from "../src/mcp/owner-grok-image-reference-tools.js";
import type { OwnerGrokImageReferenceAspectRatio } from "../src/catalog/owner-grok-image-reference-profiles.js";

const PROFILE_IDS = [
  "grok-i2i-reference-one-source-reviewed",
  "grok-i2i-reference-multi-source-reviewed",
  "grok-i2i-pro-reference-one-source-reviewed"
] as const;
const ATTEMPT = "link_grok_tools_test_123456789012";
const HANDLE_1 = "reference_823e4567-e89b-12d3-a456-426614174000";
const HANDLE_2 = "reference_923e4567-e89b-12d3-a456-426614174000";
const RECOVERY = "recovery_823e4567-e89b-12d3-a456-426614174000";
const SHA = "a".repeat(64);
const PROFILE_SET_SHA256 = `sha256:${"b".repeat(64)}`;
const CATALOG_VERSION = "2026-10-08T13:18:39.393Z.36e6960df354";
const UNKNOWN_DIAGNOSTIC = Object.freeze({
  phase: "POST_CALL_STARTED" as const, echo_ack_known: false, history_get_eligible: false,
  history_get_performed: false, history_get_count: 0, history_get_count_capped: false,
  history_match: "NOT_RUN" as const, result_get_performed: false, result_get_count: 0,
  result_get_count_capped: false, result_binding_known: false, upstream_error_code: "UPSTREAM_TIMEOUT" as const
});

type ServicePort = Pick<OwnerGrokImageReferenceService,
  "getSchema" | "validate" | "upload" | "generate" | "reconcile" | "listRecoveries">;

function serviceHarness() {
  const calls = { schema: 0, validate: 0, upload: 0, generate: 0, reconcile: 0, listRecoveries: 0 };
  const mappedAttemptIds: string[] = [];
  let throwUnknown = false;
  const service: ServicePort = {
    getSchema(profileId) {
      calls.schema += 1;
      const pro = profileId === PROFILE_IDS[2];
      const multi = profileId === PROFILE_IDS[1];
      const modelId = pro ? "grok_i2i_pro" : "grok_i2i";
      return {
        profile_id: profileId as typeof PROFILE_IDS[number], schema_hash: `sha256:${"c".repeat(64)}`,
        profile_set_sha256: PROFILE_SET_SHA256, catalog_version: CATALOG_VERSION, model_id: modelId,
        variant_id: profileId as typeof PROFILE_IDS[number], operation_id: "generate-image",
        dispatch_allowed: false, backend_acceptance: "unproven",
        prompt: { required: true, min_length: 1, max_length: 5000 },
        reference_count: { minimum: multi ? 2 : 1, maximum: multi ? 3 : 1 },
        resolution: { required: true, values: ["1k", "2k"] },
        batch_size: { required: true, values: [1, 2, 3, 4, 5] },
        aspect_ratio: { required: multi, values: multi ? ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] : [] },
        fixed_settings: { n: 1 },
        output_policy: { client_mime_allowlist: ["image/jpeg", "image/png"], provider_mime_behavior: "unproven",
          batch_result_count_relation: "unproven", maximum_returned_artifacts: 5 }
      };
    },
    validate(profileId, parameters, referenceCount) {
      calls.validate += 1;
      const multi = profileId === PROFILE_IDS[1];
      const modelType = profileId === PROFILE_IDS[2] ? "grok_i2i_pro" : "grok_i2i";
      const values = parameters as {
        prompt: string;
        resolution: "1k" | "2k";
        batch_size: 1 | 2 | 3 | 4 | 5;
        aspect_ratio?: OwnerGrokImageReferenceAspectRatio;
      };
      if ((multi && (referenceCount < 2 || !values.aspect_ratio)) || (!multi && (referenceCount !== 1 || values.aspect_ratio))) {
        throw new Error("local profile validation rejected parameters");
      }
      return { profile_id: profileId as typeof PROFILE_IDS[number], model_id: modelType, reference_count: referenceCount,
        schema_hash: `sha256:${"c".repeat(64)}`, profile_set_sha256: PROFILE_SET_SHA256, catalog_version: CATALOG_VERSION,
        dispatch_allowed: false, backend_acceptance: "unproven",
        request: { prompt: values.prompt, settings: { n: 1, model_type: modelType, resolution: values.resolution,
          batch_size: values.batch_size, ...(values.aspect_ratio ? { aspect_ratio: values.aspect_ratio } : {}) } } };
    },
    async upload(input) {
      calls.upload += 1;
      mappedAttemptIds.push(input.attemptId);
      return { status: "accepted", reference_handle: HANDLE_1, mime_type: input.mime_type as "image/png",
        mime_type_source: "request_declared", size: 68, size_source: "request_bytes",
        profile_id: input.profile_id, model_id: input.profile_id === PROFILE_IDS[2] ? "grok_i2i_pro" : "grok_i2i",
        expires_in_seconds: 900,
        image: { mime_type: "image/png", width: 1, height: 1, sha256: SHA, byte_length: 68 },
        confidence_scope: "input_bytes_sniffed_and_dimensions_checked" };
    },
    async generate(input) {
      calls.generate += 1;
      mappedAttemptIds.push(input.attemptId);
      if (throwUnknown) {
        const error = new OwnerGrokImageReferenceLifecycleError("OUTCOME_UNKNOWN", RECOVERY);
        Object.defineProperty(error, "diagnostic", { value: UNKNOWN_DIAGNOSTIC, enumerable: true });
        throw error;
      }
      const aspectSpecified = Object.hasOwn(input.parameters as object, "aspect_ratio");
      if ((input.profile_id === PROFILE_IDS[1] && (input.reference_handles.length < 2 || !aspectSpecified)) ||
          (input.profile_id !== PROFILE_IDS[1] && (input.reference_handles.length !== 1 || aspectSpecified))) {
        throw new Error("profile-specific count or ratio rule rejected input");
      }
      return { status: "result_observed", backend_acceptance: "unproven", profile_schema_hash: `sha256:${"c".repeat(64)}`,
        profile_set_sha256: PROFILE_SET_SHA256, request_fingerprint: `sha256:${"d".repeat(64)}`, model_id: "grok_i2i",
        profile_id: input.profile_id, variant_id: input.profile_id, requested_batch_size: 2,
        actual_result_count: 2, batch_count_matches_requested: true, mime_confidence: "URL_EXTENSION_ONLY",
        artifacts: [
          { url: "https://r2.syntx.ai/grok-one.png", mime_type: "image/png", mime_source: "URL_EXTENSION", message_object_id: "object-1" },
          { url: "https://r2.syntx.ai/grok-two.jpg", mime_type: "image/jpeg", mime_source: "URL_EXTENSION", message_object_id: "object-2" }
        ] };
    },
    async reconcile(input) {
      calls.reconcile += 1;
      mappedAttemptIds.push(input.attemptId);
      return { status: "result_observed", backend_acceptance: "unproven", profile_schema_hash: `sha256:${"c".repeat(64)}`,
        profile_set_sha256: PROFILE_SET_SHA256, request_fingerprint: `sha256:${"d".repeat(64)}`, model_id: "grok_i2i",
        profile_id: input.profile_id, variant_id: input.profile_id, requested_batch_size: 1,
        actual_result_count: 1, batch_count_matches_requested: true, mime_confidence: "URL_EXTENSION_ONLY",
        artifacts: [{ url: "https://r2.syntx.ai/reconciled.png", mime_type: "image/png", mime_source: "URL_EXTENSION", message_object_id: "object-r" }] };
    },
    async listRecoveries(input) {
      calls.listRecoveries += 1;
      mappedAttemptIds.push(input.attemptId);
      return [{ recovery_id: RECOVERY, model_id: "grok_i2i", profile_id: input.profile_id,
        created_at: "2026-10-09T10:00:00.000Z", requested_batch_size: 2, diagnostic: UNKNOWN_DIAGNOSTIC }];
    }
  };
  return { service, calls, mappedAttemptIds, throwUnknown: (value: boolean) => { throwUnknown = value; } };
}

function harness(service: ServicePort) {
  const server = new McpServer({ name: "owner-grok-reference-tools-test", version: "1.0.0" });
  registerSyntxOwnerGrokImageReferenceTools(server, { service });
  const client = new Client({ name: "owner-grok-reference-tools-client", version: "1.0.0" });
  return { server, client };
}

async function connect(server: McpServer, client: Client) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

test("explicit registration adds exactly six bounded Grok tools with correct read/write annotations", async () => {
  const f = serviceHarness();
  const emptyServer = new McpServer({ name: "grok-default-absence-test", version: "1.0.0" });
  const emptyClient = new Client({ name: "grok-default-absence-client", version: "1.0.0" });
  await connect(emptyServer, emptyClient);
  try {
    await assert.rejects(emptyClient.listTools(), (error: unknown) => error !== null && typeof error === "object" &&
      "code" in error && error.code === -32601);
  } finally { await emptyClient.close(); await emptyServer.close(); }

  const { server, client } = harness(f.service);
  await connect(server, client);
  try {
    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME, SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME,
      SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME, SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME].sort());
    assert.ok(names.every((name) => name.length <= 64));
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of [SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME, SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME]) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, true);
      assert.equal(byName.get(name)?.annotations?.destructiveHint, false);
    }
    assert.equal(byName.get(SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME)?.annotations?.readOnlyHint, false);
    assert.equal(byName.get(SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME)?.annotations?.idempotentHint, false);
    assert.equal(byName.get(SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME)?.annotations?.readOnlyHint, true);
    for (const name of names) assert.match(byName.get(name)?.description ?? "", /source-reviewed|source.reviewed|unproven/iu);
    for (const name of [SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME, SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME]) {
      const properties = byName.get(name)?.inputSchema.properties as Record<string, { description?: string }>;
      assert.ok("link_attempt_id" in properties);
      assert.equal("attemptId" in properties, false);
      assert.match(properties.link_attempt_id?.description ?? "", /exact linked attempt/iu);
    }
  } finally { await client.close(); await server.close(); }
});

test("schema and validation tools use the actual SDK and remain local/read-only", async () => {
  const f = serviceHarness();
  const { server, client } = harness(f.service);
  await connect(server, client);
  try {
    const schemaResult = await client.callTool({ name: SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME,
      arguments: { profile_id: PROFILE_IDS[1] } });
    assert.equal(schemaResult.isError, undefined);
    const schema = schemaResult.structuredContent as Record<string, any>;
    assert.equal(schema.dispatch_allowed, false);
    assert.equal(schema.backend_acceptance, "unproven");
    assert.equal(schema.schema_hash, `sha256:${"c".repeat(64)}`);
    assert.equal(schema.profile_set_sha256, PROFILE_SET_SHA256);
    assert.equal(schema.catalog_version, CATALOG_VERSION);
    assert.equal(schema.reference_count.minimum, 2);
    assert.equal(schema.reference_count.maximum, 3);
    assert.equal(schema.aspect_ratio.required, true);

    const validation = await client.callTool({ name: SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[1], reference_count: 2,
      parameters: { prompt: "Two sources", resolution: "2k", batch_size: 5, aspect_ratio: "16:9" }
    } });
    assert.equal(validation.isError, undefined);
    const checked = validation.structuredContent as Record<string, any>;
    assert.equal(checked.schema_hash, `sha256:${"c".repeat(64)}`);
    assert.equal(checked.profile_set_sha256, PROFILE_SET_SHA256);
    assert.equal(checked.catalog_version, CATALOG_VERSION);
    assert.deepEqual(checked.request.settings, { n: 1, model_type: "grok_i2i", resolution: "2k", batch_size: 5, aspect_ratio: "16:9" });
    assert.equal(f.calls.schema, 1);
    assert.equal(f.calls.validate, 1);
    assert.equal(f.calls.upload + f.calls.generate + f.calls.reconcile + f.calls.listRecoveries, 0);
  } finally { await client.close(); await server.close(); }
});

test("six typed tools pass valid requests through, return strict schemas, and reject extra identifiers", async () => {
  const f = serviceHarness();
  const { server, client } = harness(f.service);
  await connect(server, client);
  try {
    const upload = await client.callTool({ name: SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[0], link_attempt_id: ATTEMPT,
      content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
      filename: "one.png", mime_type: "image/png"
    } });
    assert.equal(upload.isError, undefined);
    assert.equal((upload.structuredContent as Record<string, unknown>).reference_handle, HANDLE_1);
    assert.equal(JSON.stringify(upload).includes("r2.syntx.ai"), false);

    const generated = await client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[1], link_attempt_id: ATTEMPT, reference_handles: [HANDLE_1, HANDLE_2],
      parameters: { prompt: "Two source images", resolution: "2k", batch_size: 2, aspect_ratio: "4:3" }
    } });
    assert.equal(generated.isError, undefined);
    assert.equal((generated.structuredContent as Record<string, unknown>).actual_result_count, 2);
    assert.equal((generated.structuredContent as Record<string, unknown>).mime_confidence, "URL_EXTENSION_ONLY");
    assert.equal((generated.structuredContent as Record<string, unknown>).profile_schema_hash, `sha256:${"c".repeat(64)}`);
    assert.equal((generated.structuredContent as Record<string, unknown>).profile_set_sha256, PROFILE_SET_SHA256);

    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME,
      arguments: { profile_id: PROFILE_IDS[0], link_attempt_id: ATTEMPT, recovery_id: RECOVERY } });
    assert.equal(reconciled.isError, undefined);
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME,
      arguments: { profile_id: PROFILE_IDS[1], link_attempt_id: ATTEMPT, limit: 5 } });
    assert.equal(listed.isError, undefined);
    assert.equal((listed.structuredContent as Record<string, any>).recoveries[0].recovery_id, RECOVERY);
    assert.deepEqual(f.mappedAttemptIds, [ATTEMPT, ATTEMPT, ATTEMPT, ATTEMPT]);

    const beforeInvalid = { ...f.calls };
    const extraHandle = await client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[1], link_attempt_id: ATTEMPT, reference_handles: [HANDLE_1, HANDLE_2],
      parameters: { prompt: "Two sources", resolution: "2k", batch_size: 2, aspect_ratio: "4:3", url: "https://x.invalid/a" }
    } });
    assert.equal(extraHandle.isError, true);
    assert.deepEqual(f.calls, beforeInvalid);

    const missingConditionalRatio = await client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[1], link_attempt_id: ATTEMPT, reference_handles: [HANDLE_1, HANDLE_2],
      parameters: { prompt: "Two sources", resolution: "2k", batch_size: 2 }
    } });
    assert.equal(missingConditionalRatio.isError, true);
    assert.equal(f.calls.generate, beforeInvalid.generate + 1);
    assert.equal((missingConditionalRatio.structuredContent), undefined);

    const invalidAlias = await client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME, arguments: {
      profile_id: "grok_i2i", link_attempt_id: ATTEMPT, reference_handles: [HANDLE_1],
      parameters: { prompt: "One source", resolution: "1k", batch_size: 1 }
    } as never });
    assert.equal(invalidAlias.isError, true);
    assert.equal(f.calls.generate, beforeInvalid.generate + 1);

    const oldAlias = await client.callTool({ name: SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[0], attemptId: ATTEMPT, recovery_id: RECOVERY
    } as never });
    assert.equal(oldAlias.isError, true);
    assert.equal(f.calls.reconcile, beforeInvalid.reconcile);

    const extraIdentity = await client.callTool({ name: SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[0], link_attempt_id: ATTEMPT, content_base64: "aGVsbG8=", filename: "one.png", mime_type: "image/png", upstream_id: "id"
    } });
    assert.equal(extraIdentity.isError, true);
    assert.equal(f.calls.upload, beforeInvalid.upload);
  } finally { await client.close(); await server.close(); }
});

test("unknown generation error and scoped recovery list expose only the safe phase diagnostic", async () => {
  const f = serviceHarness();
  f.throwUnknown(true);
  const { server, client } = harness(f.service);
  await connect(server, client);
  try {
    const response = await client.callTool({ name: SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME, arguments: {
      profile_id: PROFILE_IDS[0], link_attempt_id: ATTEMPT, reference_handles: [HANDLE_1],
      parameters: { prompt: "Do not echo this secret prompt", resolution: "1k", batch_size: 1 }
    } });
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent, undefined);
    const text = (response.content as readonly { type: string; text?: string }[])[0]?.text ?? "";
    const error = JSON.parse(text) as { error: { code: string; message: string; recovery_id?: string; diagnostic?: unknown } };
    assert.equal(error.error.code, "OUTCOME_UNKNOWN");
    assert.equal(error.error.recovery_id, RECOVERY);
    assert.deepEqual(error.error.diagnostic, UNKNOWN_DIAGNOSTIC);
    assert.equal(text.includes("Do not echo this secret prompt"), false);
    assert.equal(text.includes(ATTEMPT), false);
    assert.equal(text.includes(HANDLE_1), false);
    assert.match(error.error.message, /do not retry|do not repeat/iu);

    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME,
      arguments: { profile_id: PROFILE_IDS[0], link_attempt_id: ATTEMPT, limit: 5 } });
    assert.equal(listed.isError, undefined);
    const value = listed.structuredContent as { recoveries?: readonly { diagnostic?: unknown }[] };
    assert.deepEqual(value.recoveries?.[0]?.diagnostic, UNKNOWN_DIAGNOSTIC);
  } finally { await client.close(); await server.close(); }
});
