import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerFluxImageAssetServiceError } from "../src/application/owner-flux-image-asset-service.js";
import { OwnerFluxImageGenerationServiceError } from "../src/application/owner-flux-image-generation-service.js";
import { OwnerFluxImageUploadServiceError } from "../src/application/owner-flux-image-upload-service.js";
import { createMcpServer, type CreateMcpServerOptions } from "../src/mcp/server.js";

const EXPECTED = [
  "syntx_upload_flux_image_reference",
  "syntx_register_flux_public_lora",
  "syntx_owner_generate_flux_image",
  "syntx_owner_reconcile_flux_image",
  "syntx_owner_list_flux_image_recoveries"
].sort();

async function toolsFor(options?: CreateMcpServerOptions) {
  const server = createMcpServer(createDefaultApplication(), options);
  const client = new Client({ name: "owner-flux-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { const tools = (await client.listTools()).tools; return { names: tools.map(({ name }) => name), tools, client, server }; }
  catch (error) { await client.close(); await server.close(); throw error; }
}

test("five Flux tools remain absent by default and appear only for an explicit owner composition", async () => {
  const defaults = await toolsFor();
  try { assert.equal(defaults.names.some((name) => EXPECTED.includes(name)), false); }
  finally { await defaults.client.close(); await defaults.server.close(); }

  const composition = {
    uploadService: { async upload() { throw new Error("unused"); } },
    assetService: { async registerPublicLora() { throw new Error("unused"); } },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() { throw new Error("unused"); },
      async listRecoveries() { return []; }, async invalidateAttempt() {}, async close() {} }
  };
  const owner = await toolsFor({ ownerFluxImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    assert.deepEqual(owner.names.filter((name) => EXPECTED.includes(name)).sort(), EXPECTED);
    for (const name of EXPECTED) {
      const tool = owner.tools.find((entry) => entry.name === name)!;
      assert.equal((tool.inputSchema as Record<string, unknown>).additionalProperties, false);
      assert.equal((tool.outputSchema as Record<string, unknown>).additionalProperties, false);
    }
    const annotations = Object.fromEntries(owner.tools.filter(({ name }) => EXPECTED.includes(name)).map(({ name, annotations: value }) => [name, value])) as
      Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }>;
    assert.deepEqual([annotations.syntx_upload_flux_image_reference?.readOnlyHint, annotations.syntx_upload_flux_image_reference?.destructiveHint], [false, true]);
    assert.deepEqual([annotations.syntx_register_flux_public_lora?.readOnlyHint, annotations.syntx_register_flux_public_lora?.destructiveHint,
      annotations.syntx_register_flux_public_lora?.idempotentHint], [false, false, false]);
    assert.deepEqual([annotations.syntx_owner_generate_flux_image?.readOnlyHint, annotations.syntx_owner_generate_flux_image?.destructiveHint], [false, true]);
    assert.deepEqual([annotations.syntx_owner_reconcile_flux_image?.readOnlyHint, annotations.syntx_owner_reconcile_flux_image?.destructiveHint], [true, false]);
    assert.deepEqual([annotations.syntx_owner_list_flux_image_recoveries?.readOnlyHint, annotations.syntx_owner_list_flux_image_recoveries?.destructiveHint], [true, false]);
  }
  finally { await owner.client.close(); await owner.server.close(); }
});

test("Flux MCP input and output contract schemas are exported for downstream composition and review", async () => {
  const module = await import("../src/mcp/owner-flux-image-tools.js") as unknown as Record<string, unknown>;
  const inputs = module.OWNER_FLUX_IMAGE_TOOL_INPUT_SCHEMAS;
  const outputs = module.OWNER_FLUX_IMAGE_TOOL_OUTPUT_SCHEMAS;
  assert.ok(inputs && typeof inputs === "object");
  assert.ok(outputs && typeof outputs === "object");
  assert.deepEqual(Object.keys(inputs).sort(), ["generate", "list_recoveries", "reconcile", "register_public_lora", "upload"].sort());
  assert.deepEqual(Object.keys(outputs).sort(), ["generate", "list_recoveries", "reconcile", "register_public_lora", "upload"].sort());
});

test("generation schema preserves all 18 source resolutions and exact fractional controls", async () => {
  const variants = ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"] as const;
  const resolutions = {
    "flux-1": ["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"],
    "flux-pro-1.1": ["1152x896", "1280x1024"],
    "flux-pro-1.1-ultra": ["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"]
  } as const;
  const received: Array<Record<string, unknown>> = [];
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); } },
    assetService: { async registerPublicLora() { throw new Error("unused"); } },
    generationService: {
      async generate(input: unknown) {
        const request = input as { model_id: typeof variants[number]; parameters: Record<string, unknown> & { civitai_loras: unknown[] } };
        received.push(request as unknown as Record<string, unknown>);
        return { status: "result_observed", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN",
          ai_name: "flux", model_id: request.model_id, variant: request.model_id, operation_id: "generate-image",
          profile_id: "flux-image-source-reviewed-v1", profile_schema_hash: `sha256:${"a".repeat(64)}`,
          catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, request_fingerprint: `sha256:${"b".repeat(64)}`,
          parameters: { resolution: request.parameters.resolution, cfg: request.parameters.cfg, steps: request.parameters.steps,
            image_strength: request.parameters.image_strength, workflow_type: request.parameters.workflow_type,
            raw: request.parameters.raw, lora_count: request.parameters.civitai_loras.length }, cost_inputs: {},
          cost_input_confidence: "NO_SOURCE_COST_INPUTS_QUOTE_AND_BILLING_UNPROVEN", reference_count: 0,
          input_references: [], lora_assets: [], actual_image: { mime_type: null, width: null, height: null }, geometry_verified: false,
          artifact: { url: "https://r2.syntx.ai/flux/result.unknown", mime_type: null, mime_source: "UNKNOWN",
            width: null, height: null, geometry_verified: false }, legal_approval: "NOT_ESTABLISHED", license_compatibility: "UNPROVEN" };
      },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {}
    }
  };
  const owner = await toolsFor({ ownerFluxImageReferences: composition } as unknown as CreateMcpServerOptions);
  try {
    const tool = (await owner.client.listTools()).tools.find(({ name }) => name === "syntx_owner_generate_flux_image")!;
    const rootSchema = tool.inputSchema as Record<string, unknown>;
    assert.equal(rootSchema.type, "object");
    assert.equal(rootSchema.additionalProperties, false);
    const properties = rootSchema.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(properties.model_id?.enum, variants);
    const parametersSchema = properties.parameters!;
    const branches = (parametersSchema.oneOf ?? parametersSchema.anyOf) as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(branches), JSON.stringify(parametersSchema));
    assert.equal(branches.length, 3);
    const expectedResolutionLists = [resolutions["flux-1"], resolutions["flux-pro-1.1"], resolutions["flux-pro-1.1-ultra"]];
    for (let index = 0; index < branches.length; index++) {
      const branch = branches[index]!;
      assert.equal(branch.additionalProperties, false);
      const branchProperties = branch.properties as Record<string, Record<string, unknown>>;
      assert.deepEqual(branchProperties.resolution?.enum, expectedResolutionLists[index]);
      assert.equal(branchProperties.cfg?.minimum, 1); assert.equal(branchProperties.cfg?.maximum, 4);
      assert.equal(branchProperties.cfg?.multipleOf, undefined);
      assert.equal(branchProperties.steps?.multipleOf, undefined);
      assert.equal(branchProperties.image_strength?.multipleOf, undefined);
      const loraItems = branchProperties.civitai_loras?.items as Record<string, unknown>;
      const loraProps = loraItems.properties as Record<string, Record<string, unknown>>;
      assert.equal(loraItems.additionalProperties, false);
      assert.equal(loraProps.strength_model?.multipleOf, undefined);
      assert.equal(loraProps.strength_clip?.multipleOf, undefined);
    }
    assert.deepEqual(branches.map((branch) => (branch.properties as Record<string, Record<string, unknown>>).civitai_loras?.maxItems), [3, 0, 0]);
    const allPairs: Array<readonly [string, string]> = [];
    for (const variant of variants) for (const resolution of resolutions[variant]) {
      const parameters = { resolution, cfg: 1.35, steps: 12.5, image_strength: 0.65,
        workflow_type: "default", raw: variant === "flux-pro-1.1-ultra" ? false : null, civitai_loras: [] };
      const result = await owner.client.callTool({ name: "syntx_owner_generate_flux_image", arguments: {
        link_attempt_id: "link_flux_tools_test_attempt_000001", model_id: variant, prompt: "preserve manual controls", parameters
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.deepEqual((result.structuredContent as { parameters: unknown }).parameters,
        { resolution, cfg: 1.35, steps: 12.5, image_strength: 0.65, workflow_type: "default",
          raw: variant === "flux-pro-1.1-ultra" ? false : null, lora_count: 0 });
      allPairs.push([variant, resolution]);
    }
    assert.equal(allPairs.length, 18);
    assert.equal(received.length, 18);
    assert.deepEqual((received[0] as { parameters: unknown }).parameters,
      { resolution: "1344x768", cfg: 1.35, steps: 12.5, image_strength: 0.65,
        workflow_type: "default", raw: null, civitai_loras: [] });
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("closed Flux schemas reject caller URLs, witness claims, mismatched weights, wrong branches, and extras before service calls", async () => {
  let uploadCalls = 0, registrationCalls = 0, generationCalls = 0;
  const composition = {
    uploadService: { async upload() { uploadCalls++; throw new Error("invalid input reached upload service"); } },
    assetService: { async registerPublicLora() { registrationCalls++; throw new Error("invalid input reached asset service"); } },
    generationService: { async generate() { generationCalls++; throw new Error("invalid input reached generation service"); },
      async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {} }
  };
  const owner = await toolsFor({ ownerFluxImageReferences: composition } as unknown as CreateMcpServerOptions);
  const attempt = "link_flux_tools_test_attempt_000001";
  const oneLora = "flux_lora_00000000-0000-4000-8000-000000000001";
  const validParameters = { resolution: "1024x1024", cfg: 1.25, steps: 12.5, image_strength: 0.65,
    workflow_type: "civitai", raw: null, civitai_loras: [{ handle: oneLora, strength_model: 0.375, strength_clip: 0.375 }] };
  const handle = (n: number) => `flux_lora_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const invalid = [
    { link_attempt_id: attempt, model_id: "flux-1", prompt: "sentinel prompt", parameters: validParameters,
      image_reference_handle: "flux_image_00000000-0000-4000-8000-000000000001", caller_url: "https://private.invalid/sentinel" },
    { link_attempt_id: attempt, model_id: "flux-pro-1.1", prompt: "no references", parameters: validParameters },
    { link_attempt_id: attempt, model_id: "flux-1", prompt: "wrong resolution", parameters: { ...validParameters, resolution: "2048x2048" } },
    { link_attempt_id: attempt, model_id: "flux-1", prompt: "mismatched strength", parameters: { ...validParameters,
      civitai_loras: [{ handle: oneLora, strength_model: 0.5, strength_clip: 0.25 }] } },
    { link_attempt_id: attempt, model_id: "flux-1", prompt: "wrong workflow", parameters: { ...validParameters, workflow_type: "default" } },
    { link_attempt_id: attempt, model_id: "flux-pro-1.1-ultra", prompt: "raw literal", parameters: { ...validParameters,
      resolution: "2048x2048", raw: null, civitai_loras: [], workflow_type: "default" } },
    { link_attempt_id: attempt, model_id: "flux-1", prompt: "too many", parameters: { ...validParameters,
      civitai_loras: [1, 2, 3, 4].map((n) => ({ handle: handle(n), strength_model: 0.5, strength_clip: 0.5 })) } },
    { link_attempt_id: attempt, model_id: "flux-1", prompt: "id and URL are never caller controls", parameters: { ...validParameters,
      civitai_loras: [{ id: "202", url: "https://private.invalid/sentinel", handle: oneLora, strength_model: 0.375, strength_clip: 0.375 }] } }
  ];
  try {
    for (const input of invalid) {
      const result = await owner.client.callTool({ name: "syntx_owner_generate_flux_image", arguments: input });
      assert.equal(result.isError, true);
      assert.equal(JSON.stringify(result).includes("private.invalid"), false);
    }
    for (const args of [
      { link_attempt_id: attempt, content_base64: "AAAA", filename: "x.png", mime_type: "image/png", private_url: "https://private.invalid/sentinel" },
      { link_attempt_id: attempt, content_base64: "AAAA", filename: "x.bmp", mime_type: "image/bmp" }
    ]) {
      const result = await owner.client.callTool({ name: "syntx_upload_flux_image_reference", arguments: args });
      assert.equal(result.isError, true); assert.equal(JSON.stringify(result).includes("private.invalid"), false);
    }
    for (const args of [
      { link_attempt_id: attempt, model_version_id: 202, file_id: 303, canonical_url: "https://private.invalid/sentinel" },
      { link_attempt_id: attempt, model_version_id: 202, file_id: 303, witness: { provenance_verified: true } },
      { link_attempt_id: attempt, model_version_id: 202, file_id: "303" }
    ]) {
      const result = await owner.client.callTool({ name: "syntx_register_flux_public_lora", arguments: args });
      assert.equal(result.isError, true); assert.equal(JSON.stringify(result).includes("private.invalid"), false);
    }
    assert.equal(uploadCalls, 0); assert.equal(registrationCalls, 0); assert.equal(generationCalls, 0);
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("Flux-1 forwards ordered zero-to-three opaque LoRA handles, synchronized fractional weights, and one optional image handle", async () => {
  const received: Array<Record<string, unknown>> = [];
  const composition = {
    uploadService: { async upload() { throw new Error("unused"); } },
    assetService: { async registerPublicLora() { throw new Error("unused"); } },
    generationService: { async generate(input: unknown) {
      const request = input as { model_id: "flux-1"; image_reference_handle?: string;
        parameters: { resolution: string; cfg: number; steps: number; image_strength: number; workflow_type: "default" | "civitai";
          raw: null; civitai_loras: Array<{ handle: string; strength_model: number; strength_clip: number }> } };
      received.push(request as unknown as Record<string, unknown>);
      const hasImage = request.image_reference_handle !== undefined;
      return { status: "result_observed", namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN",
        ai_name: "flux", model_id: "flux-1", variant: "flux-1", operation_id: "generate-image",
        profile_id: "flux-image-source-reviewed-v1", profile_schema_hash: `sha256:${"a".repeat(64)}`,
        catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, request_fingerprint: `sha256:${"b".repeat(64)}`,
        parameters: { resolution: request.parameters.resolution, cfg: request.parameters.cfg, steps: request.parameters.steps,
          image_strength: request.parameters.image_strength, workflow_type: request.parameters.workflow_type, raw: null,
          lora_count: request.parameters.civitai_loras.length }, cost_inputs: {},
        cost_input_confidence: "NO_SOURCE_COST_INPUTS_QUOTE_AND_BILLING_UNPROVEN", reference_count: hasImage ? 1 : 0,
        input_references: hasImage ? [{ mime_type: "image/png", width: 12, height: 8, size: 42,
          sha256: `sha256:${"d".repeat(64)}`, metadata_confidence: "CONTAINER_METADATA_ONLY" }] : [],
        lora_assets: request.parameters.civitai_loras.map((item, index) => ({ provenance: "public_civitai_verified",
          size: 1024 + index, sha256: `sha256:${String(index + 1).repeat(64)}`,
          strength_model: item.strength_model, strength_clip: item.strength_clip })),
        actual_image: { mime_type: null, width: null, height: null }, geometry_verified: false,
        artifact: { url: "https://r2.syntx.ai/flux/result.unknown", mime_type: null, mime_source: "UNKNOWN",
          width: null, height: null, geometry_verified: false }, legal_approval: "NOT_ESTABLISHED", license_compatibility: "UNPROVEN" };
    }, async reconcile() { throw new Error("unused"); }, async listRecoveries() { return []; },
      async invalidateAttempt() {}, async close() {} }
  };
  const owner = await toolsFor({ ownerFluxImageReferences: composition } as unknown as CreateMcpServerOptions);
  const expectedHandles = [1, 2, 3].map((n) => `flux_lora_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  const strengths = [0, 0.375, 1.5];
  try {
    for (let count = 0; count <= 3; count++) {
      const civitai_loras = expectedHandles.slice(0, count).map((handle, index) => ({ handle,
        strength_model: strengths[index]!, strength_clip: strengths[index]! }));
      const parameters = { resolution: "1024x1024", cfg: 2.25, steps: 16.5, image_strength: 0.625,
        workflow_type: count ? "civitai" : "default", raw: null, civitai_loras };
      const image_reference_handle = count === 1 ? "flux_image_00000000-0000-4000-8000-000000000001" : undefined;
      const result = await owner.client.callTool({ name: "syntx_owner_generate_flux_image", arguments: {
        link_attempt_id: "link_flux_tools_test_attempt_000001", model_id: "flux-1", prompt: "preserve asset order and weights",
        ...(image_reference_handle === undefined ? {} : { image_reference_handle }), parameters
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const forwarded = received[count]! as { image_reference_handle?: string; parameters: Record<string, unknown> };
      assert.equal(forwarded.image_reference_handle, image_reference_handle);
      assert.deepEqual(forwarded.parameters, parameters);
      const output = result.structuredContent as { lora_assets: Array<{ strength_model: number; strength_clip: number }>; reference_count: number };
      assert.deepEqual(output.lora_assets.map((item) => [item.strength_model, item.strength_clip]),
        civitai_loras.map((item) => [item.strength_model, item.strength_clip]));
      assert.equal(output.reference_count, image_reference_handle ? 1 : 0);
    }
  } finally { await owner.client.close(); await owner.server.close(); }
});

test("tool responses preserve safe registration receipts and actual frozen recovery diagnostics without leaking private values", async () => {
  const recoveryId = "flux_image_recovery_00000000-0000-4000-8000-000000000001";
  const diagnostic = { phase: "GENERATION_POST", post_started: true, echo_ack_known: false, history_binding: "NONE",
    history_binding_reason: null, history_get_calls: 0, history_get_calls_saturated: false, result_get_calls: 0,
    result_get_calls_saturated: false, result_status: "NOT_READ", result_reason: null } as const;
  const receipt = { status: "verified", reference_handle: "flux_lora_00000000-0000-4000-8000-000000000001", model_id: "flux-1",
    source_model_id: 101, model_version_id: 202, file_id: 303, size: 72, sha256: `sha256:${"c".repeat(64)}`,
    expires_in_seconds: 900, content_confidence: "STREAMED_SHA256_AND_SAFETENSORS_STRUCTURE", legal_approval: "NOT_ESTABLISHED",
    license_compatibility: "UNPROVEN", backend_acceptance: "UNPROVEN" };
  let uploadCalls = 0, registrationCalls = 0;
  const composition = {
    uploadService: { async upload() {
      if (++uploadCalls > 1) throw new OwnerFluxImageUploadServiceError("UPLOAD_OUTCOME_UNKNOWN");
      return { status: "uploaded", reference_handle: "flux_image_00000000-0000-4000-8000-000000000001",
      model_id: "flux-1", source_mime_type: "image/jpg", mime_type: "image/jpeg", width: 12, height: 8, size: 42,
      sha256: `sha256:${"d".repeat(64)}`, expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY",
      size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" }; } },
    assetService: { async registerPublicLora() {
      if (++registrationCalls > 1) throw new OwnerFluxImageAssetServiceError("ATTESTATION_FAILED");
      return receipt;
    } },
    generationService: { async generate() { throw new Error("unused"); }, async reconcile() {
      throw new OwnerFluxImageGenerationServiceError("OUTCOME_UNKNOWN", recoveryId, diagnostic);
    }, async listRecoveries() { return [{ recovery_id: recoveryId, created_at: "2026-10-11T00:00:00.000Z", model_id: "flux-1",
      operation_id: "generate-image", status: "OUTCOME_UNKNOWN", diagnostic }]; }, async invalidateAttempt() {}, async close() {} }
  };
  const owner = await toolsFor({ ownerFluxImageReferences: composition } as unknown as CreateMcpServerOptions);
  const attempt = "link_flux_tools_test_attempt_000001";
  try {
    const registered = await owner.client.callTool({ name: "syntx_register_flux_public_lora", arguments: {
      link_attempt_id: attempt, model_id_source: 101, model_version_id: 202, file_id: 303
    } });
    assert.equal(registered.isError, undefined, JSON.stringify(registered));
    assert.deepEqual(registered.structuredContent, receipt);
    assert.equal(JSON.stringify(registered).includes("civitai.com"), false);
    const failedRegistration = await owner.client.callTool({ name: "syntx_register_flux_public_lora", arguments: {
      link_attempt_id: attempt, model_version_id: 204, file_id: 404
    } });
    assert.equal(failedRegistration.isError, true);
    assert.equal(JSON.stringify(failedRegistration).includes("civitai.com"), false);
    assert.equal((JSON.parse((failedRegistration.content as Array<{ readonly text: string }>)[0]!.text) as { error: { code: string } }).error.code,
      "ATTESTATION_FAILED");
    const uploaded = await owner.client.callTool({ name: "syntx_upload_flux_image_reference", arguments: {
      link_attempt_id: attempt, content_base64: "AAAA", filename: "ref.png", mime_type: "image/png"
    } });
    assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
    const failedUpload = await owner.client.callTool({ name: "syntx_upload_flux_image_reference", arguments: {
      link_attempt_id: attempt, content_base64: "AAAA", filename: "ref.png", mime_type: "image/png"
    } });
    assert.equal(failedUpload.isError, true);
    assert.equal((JSON.parse((failedUpload.content as Array<{ readonly text: string }>)[0]!.text) as { error: { code: string } }).error.code,
      "UPLOAD_OUTCOME_UNKNOWN");
    const reconciled = await owner.client.callTool({ name: "syntx_owner_reconcile_flux_image", arguments: {
      link_attempt_id: attempt, recovery_id: recoveryId
    } });
    assert.equal(reconciled.isError, true);
    const errorText = (reconciled.content as Array<{ readonly text: string }>)[0]!.text;
    const error = JSON.parse(errorText) as { error: Record<string, unknown> };
    assert.equal(error.error.code, "OUTCOME_UNKNOWN"); assert.equal(error.error.recovery_id, recoveryId);
    assert.deepEqual(error.error.diagnostic, diagnostic);
    assert.equal(JSON.stringify(reconciled).includes("private.invalid"), false);
    const listed = await owner.client.callTool({ name: "syntx_owner_list_flux_image_recoveries", arguments: { link_attempt_id: attempt } });
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    assert.deepEqual((listed.structuredContent as { recoveries: unknown[] }).recoveries.length, 1);
  } finally { await owner.client.close(); await owner.server.close(); }
});
