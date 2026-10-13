import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, TOOL_NAMES } from "../src/mcp/server.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { loadOwnerGrokImageReferenceProfileSetV1 } from "../src/catalog/owner-grok-image-reference-profile-history.js";
import { OwnerGrokImageReferenceServiceError } from "../src/application/owner-grok-image-reference-service.js";
import { OwnerGrokImageReferenceLifecycleError } from "../src/application/owner-grok-image-reference-lifecycle.js";
import {
  SYNTX_OWNER_GENERATE_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_REFERENCE_RECOVERY_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME
} from "../src/mcp/owner-image-reference-tools.js";
import {
  assertOwnerImageReferenceModelAccess,
  createObservedOwnerRuntime,
  ownerImageReferenceCostParameters
} from "../src/runtime/observed-owner-runtime.js";
import {
  closeOwnerImageReferenceServicesOnTransportEof,
  closeOwnerImageReferenceServiceOnTransportEof,
  runObservedOwnerStdioServer
} from "../src/transports/stdio-owner.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME,
  SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME
} from "../src/mcp/owner-grok-image-reference-tools.js";

const REFERENCE_TOOL_NAMES = [
  SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_REFERENCE_RECOVERY_TOOL_NAME
];
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const GROK_PROFILE_VERSION = "sha256-87f53d7f198a6550038a59279948e10b251a4138509bf76c25c791c990d66299.json";
const GROK_PROFILE_ID = "grok-i2i-reference-one-source-reviewed";
const GROK_REFERENCE_TOOL_NAMES = [
  SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME,
  SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_UPLOAD_GROK_IMAGE_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_REFERENCE_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_REFERENCE_RECOVERY_TOOL_NAME
];
const GROK_TEST_ATTEMPT = "link_grok_runtime_fake_owner_0123456789";

function loadGrokProfiles() {
  const selected = loadSelectedDiscoveryCatalog();
  return loadOwnerGrokImageReferenceProfileSetV1(GROK_PROFILE_VERSION, selected.discoveryCatalog);
}

test("stdio reference flag is strict and durable-generation composition fails before startup", async () => {
  const previousReferences = process.env.SYNTX_OWNER_IMAGE_REFERENCES;
  const previousDurable = process.env.SYNTX_OWNER_DURABLE_GENERATION;
  const previousGrok = process.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES;
  const previousGrokVersion = process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION;
  try {
    process.env.SYNTX_OWNER_IMAGE_REFERENCES = "true";
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_IMAGE_REFERENCES configuration/u
    );

    process.env.SYNTX_OWNER_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u
    );

    delete process.env.SYNTX_OWNER_DURABLE_GENERATION;
    process.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES = "true";
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_GROK_IMAGE_REFERENCES configuration/u
    );
    process.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES = "1";
    delete process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION;
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION is required/u
    );

    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION = GROK_PROFILE_VERSION;
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u
    );
  } finally {
    if (previousReferences === undefined) delete process.env.SYNTX_OWNER_IMAGE_REFERENCES;
    else process.env.SYNTX_OWNER_IMAGE_REFERENCES = previousReferences;
    if (previousDurable === undefined) delete process.env.SYNTX_OWNER_DURABLE_GENERATION;
    else process.env.SYNTX_OWNER_DURABLE_GENERATION = previousDurable;
    if (previousGrok === undefined) delete process.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES;
    else process.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES = previousGrok;
    if (previousGrokVersion === undefined) delete process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION;
    else process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION = previousGrokVersion;
  }
});

test("stdio rejects a pinned Grok profile set from another selected public catalog epoch", async () => {
  const env = [
    ["SYNTX_OWNER_GROK_IMAGE_REFERENCES", process.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES],
    ["SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION", process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION],
    ["SYNTX_PUBLIC_CATALOG_VERSION", process.env.SYNTX_PUBLIC_CATALOG_VERSION]
  ] as const;
  try {
    process.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION = GROK_PROFILE_VERSION;
    process.env.SYNTX_PUBLIC_CATALOG_VERSION = "sha256-3c1ceb7c199054fad6ff2653f0bba6a16f09b80c8531a4d94776e6ee08b0f609.json";
    await assert.rejects(
      runObservedOwnerStdioServer(new PassThrough()),
      /OWNER_GROK_REFERENCE_PROFILE_ARTIFACT_INVALID/u
    );
  } finally {
    for (const [name, value] of env) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("owner image-reference tools stay absent by default", async () => {
  const runtime = createObservedOwnerRuntime();
  assert.equal(runtime.serverOptions.ownerImageReferences, undefined);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-reference-default-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.slice(0, TOOL_NAMES.length), [...TOOL_NAMES]);
    assert.equal(REFERENCE_TOOL_NAMES.some((name) => names.includes(name)), false);
    assert.equal(GROK_REFERENCE_TOOL_NAMES.some((name) => names.includes(name)), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("Grok reference tools are explicit, read-only schema and validation are network-free", async () => {
  let fetches = 0;
  const profiles = loadGrokProfiles();
  const runtime = createObservedOwnerRuntime({
    ownerGrokImageReferencesEnabled: true,
    ownerGrokImageReferenceProfiles: profiles,
    fetchImpl: (async () => {
      fetches += 1;
      throw new Error("No remote access is expected during registration or local validation.");
    }) as typeof fetch
  });
  const service = runtime.serverOptions.ownerGrokImageReferences;
  assert.ok(service);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-grok-reference-opt-in-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.slice(-GROK_REFERENCE_TOOL_NAMES.length), GROK_REFERENCE_TOOL_NAMES);
    const schema = await client.callTool({
      name: SYNTX_GET_GROK_REFERENCE_SCHEMA_TOOL_NAME,
      arguments: { profile_id: GROK_PROFILE_ID }
    });
    assert.equal(schema.isError, undefined);
    const validation = await client.callTool({
      name: SYNTX_VALIDATE_GROK_REFERENCE_TOOL_NAME,
      arguments: {
        profile_id: GROK_PROFILE_ID,
        reference_count: 1,
        parameters: { prompt: "A quiet room", resolution: "1k", batch_size: 1 }
      }
    });
    assert.equal(validation.isError, undefined);
    assert.equal(fetches, 0);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});

test("Grok fresh model-access gate uses an API-accepted availability batch and keeps failures before upload", async () => {
  let uploadCalls = 0;
  let chatCreateCalls = 0;
  let generationPostCalls = 0;
  let failCost = false;
  const modelReads: Array<{ model_type: string | null; batch_size: string | null }> = [];
  const runtime = createObservedOwnerRuntime({
    ownerGrokImageReferencesEnabled: true,
    ownerGrokImageReferenceProfiles: loadGrokProfiles(),
    fetchImpl: (async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/api/v1/user/subscription") {
        return Response.json({ active: true, type: "PRO" });
      }
      if (url.pathname === "/api/v2/get_model_info") {
        const model_type = url.searchParams.get("model_type");
        const batch_size = url.searchParams.get("batch_size");
        modelReads.push({ model_type, batch_size });
        if (batch_size === null) return new Response("{}", { status: 503 });
        return Response.json({
          access: true,
          cost: failCost ? null : Number(batch_size),
          discount_cost: null,
          free_remaining_generations: null,
          limit: null,
          show_warning: false
        });
      }
      if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
        uploadCalls += 1;
        return Response.json({ files: [{ id: `grok-file-${uploadCalls}`, url: `https://r2.syntx.ai/private/${uploadCalls}.png` }] });
      }
      if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
        chatCreateCalls += 1;
        return new Response("{}", { status: 503 });
      }
      if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
        generationPostCalls += 1;
        throw new Error("The fake create-chat gate should stop before generation POST.");
      }
      throw new Error("Unexpected fake request route.");
    }) as typeof fetch
  });
  const attemptId = GROK_TEST_ATTEMPT;
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "fake-upstream-attempt");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "fixture-credential" });

  const service = runtime.serverOptions.ownerGrokImageReferences;
  assert.ok(service);
  const proProfile = "grok-i2i-pro-reference-one-source-reviewed" as const;
  const uploaded = await service.upload({
    profile_id: proProfile,
    attemptId,
    content_base64: PNG_1X1,
    filename: "reference.png",
    mime_type: "image/png"
  });
  assert.equal(uploaded.model_id, "grok_i2i_pro");
  assert.deepEqual(modelReads, [{ model_type: "grok_i2i_pro", batch_size: "1" }]);
  assert.equal(uploadCalls, 1);

  const [concurrentI2i, concurrentPro] = await Promise.all([
    service.upload({ profile_id: GROK_PROFILE_ID, attemptId, content_base64: PNG_1X1, filename: "reference.png", mime_type: "image/png" }),
    service.upload({ profile_id: proProfile, attemptId, content_base64: PNG_1X1, filename: "reference.png", mime_type: "image/png" })
  ]);
  assert.equal(concurrentI2i.model_id, "grok_i2i");
  assert.equal(concurrentPro.model_id, "grok_i2i_pro");
  assert.deepEqual(modelReads.slice(1).map((read) => read.model_type).sort(), ["grok_i2i", "grok_i2i_pro"]);
  assert.ok(modelReads.slice(1).every((read) => read.batch_size === "1"));
  assert.equal(uploadCalls, 3);

  const extraForBatchFive = await service.upload({
    profile_id: proProfile,
    attemptId,
    content_base64: PNG_1X1,
    filename: "reference.png",
    mime_type: "image/png"
  });
  for (const [batchSize, reference] of [
    [4, concurrentPro.reference_handle],
    [5, extraForBatchFive.reference_handle]
  ] as const) {
    await assert.rejects(() => service.generate({
      profile_id: proProfile,
      attemptId,
      reference_handles: [reference],
      parameters: { prompt: `fixture batch ${batchSize}`, resolution: "1k", batch_size: batchSize }
    }), (error: unknown) => error instanceof OwnerGrokImageReferenceLifecycleError && error.code === "PRE_DISPATCH_FAILED");
    assert.equal(modelReads.filter((read) => read.batch_size === String(batchSize)).length, 1);
  }
  assert.equal(chatCreateCalls, 2);
  assert.equal(generationPostCalls, 0);

  failCost = true;
  await assert.rejects(() => service.upload({
    profile_id: proProfile,
    attemptId,
    content_base64: PNG_1X1,
    filename: "reference.png",
    mime_type: "image/png"
  }), (error: unknown) => error instanceof OwnerGrokImageReferenceServiceError && error.code === "PREFLIGHT_FAILED");
  assert.equal(uploadCalls, 4);

  const expiredAttempt = "link_expired_runtime_fake_owner_0123456789";
  await runtime.authStore.createAttempt({ attempt_id: expiredAttempt, binding, expires_at_ms: Date.now() - 1 });
  await assert.rejects(() => service.upload({
    profile_id: proProfile,
    attemptId: expiredAttempt,
    content_base64: PNG_1X1,
    filename: "reference.png",
    mime_type: "image/png"
  }), (error: unknown) => error instanceof OwnerGrokImageReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED");

  const foreignAttempt = "link_foreign_runtime_fake_owner_0123456789";
  await runtime.authStore.createAttempt({
    attempt_id: foreignAttempt,
    binding: { tenant_id: "tenant_foreign", subject: "subject_foreign" },
    expires_at_ms: Date.now() + 60_000
  });
  await assert.rejects(() => service.upload({
    profile_id: proProfile,
    attemptId: foreignAttempt,
    content_base64: PNG_1X1,
    filename: "reference.png",
    mime_type: "image/png"
  }), (error: unknown) => error instanceof OwnerGrokImageReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  assert.equal(modelReads.length, 9);
  assert.equal(uploadCalls, 4);
  await service.close();
});

test("explicit owner runtime opt-in keeps the fixed reference pin separate from the normal contract pin", async () => {
  const normalRegistry = loadGenerationContractRegistryV2(
    "sha256-2dbdeed0c7390430e37bbfc20486d0116943418cc37ec53a875ae49d41a2ba52.json"
  );
  const runtime = createObservedOwnerRuntime({
    ownerImageReferencesEnabled: true,
    ownerContractMediaEnabled: true,
    generationContractRegistry: normalRegistry
  });
  const service = runtime.serverOptions.ownerImageReferences;
  assert.ok(service);
  assert.ok(runtime.serverOptions.ownerContractMedia);
  assert.equal(
    runtime.serverOptions.generationContractRegistryV2?.registry_sha256,
    normalRegistry.registry_sha256
  );
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-reference-opt-in-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.deepEqual(names.slice(-REFERENCE_TOOL_NAMES.length), REFERENCE_TOOL_NAMES);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});

test("owner reference upload rejects a foreign attempt before any provider request", async () => {
  let fetches = 0;
  const runtime = createObservedOwnerRuntime({
    ownerImageReferencesEnabled: true,
    fetchImpl: (async () => {
      fetches += 1;
      throw new Error("Provider access is not expected in the foreign-attempt case.");
    }) as typeof fetch
  });
  const service = runtime.serverOptions.ownerImageReferences;
  assert.ok(service);
  const foreign = await runtime.linkService.createAttempt({
    tenant_id: "tenant_foreign_reference_fixture",
    subject: "subject_foreign_reference_fixture"
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-reference-foreign-attempt-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({
      name: SYNTX_OWNER_UPLOAD_IMAGE_REFERENCE_TOOL_NAME,
      arguments: {
        link_attempt_id: foreign.attempt_id,
        content_base64: PNG_1X1,
        filename: "reference.png",
        mime_type: "image/png"
      }
    });
    assert.equal(result.isError, true);
    assert.equal(fetches, 0);
    assert.equal(JSON.stringify(result).includes("tenant_foreign_reference_fixture"), false);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});

test("reference cost read uses only the fixed tuple keys allowed by the model", () => {
  const runtime = createObservedOwnerRuntime();
  const model = runtime.catalog.getModel("banana-2.1");
  const parameters = ownerImageReferenceCostParameters(model.settings?.get_cost_params, {
    model_type: "banana-2.1",
    n: 1,
    image_size: "1K",
    thinking_level: "minimal",
    aspect_ratio: "1:1",
    file_urls: ["https://private.invalid/reference"]
  });
  assert.deepEqual({ ...parameters }, { image_size: "1K" });
});

test("Grok cost parameters include batch size only while model type is derived from the selected model record", () => {
  const runtime = createObservedOwnerRuntime();
  const model = runtime.catalog.getModel("grok_i2i");
  assert.equal(model.id, "grok_i2i");
  assert.equal(model.upstream_id, "grok_i2i");
  const parameters = ownerImageReferenceCostParameters(model.settings?.get_cost_params, {
    model_type: "caller-value-is-ignored",
    batch_size: 4,
    resolution: "2k",
    aspect_ratio: "16:9",
    n: 1,
    file_urls: ["https://private.invalid/reference"]
  });
  assert.deepEqual({ ...parameters }, { batch_size: 4 });

  const expected = {
    model_id: model.id,
    ai_name: model.ai_name,
    model_type: model.upstream_id,
    catalog_kind: runtime.catalog.catalog_kind,
    catalog_version: `${runtime.catalog.fetched_at}.${runtime.catalog.source_hashes.models.slice(7, 19)}`,
    parameter_keys: ["batch_size"]
  };
  const context = {
    ...expected,
    account_read_live: true as const,
    parameters_redacted: true as const,
    access: true,
    cost: 5,
    discount_cost: null,
    free_remaining_generations: null,
    limit: null,
    show_warning: null,
    observed_at: "2026-10-10T00:00:00.000Z"
  };
  assert.doesNotThrow(() => assertOwnerImageReferenceModelAccess(context, expected));
  assert.throws(() => assertOwnerImageReferenceModelAccess({ ...context, model_type: "foreign-model-type" }, expected));
});

test("Grok actual candidate cost queries preserve batch sizes 1, 4, and 5 separately from availability preview", () => {
  const runtime = createObservedOwnerRuntime();
  const model = runtime.catalog.getModel("grok_i2i_pro");
  for (const batchSize of [1, 4, 5] as const) {
    const costParameters = ownerImageReferenceCostParameters(model.settings?.get_cost_params, {
      model_type: "caller-cannot-select-model-type",
      batch_size: batchSize,
      resolution: "1k",
      n: 1,
      file_urls: []
    });
    assert.deepEqual({ ...costParameters }, { batch_size: batchSize });
    const expected = {
      model_id: model.id,
      ai_name: model.ai_name,
      model_type: model.upstream_id,
      catalog_kind: runtime.catalog.catalog_kind,
      catalog_version: `${runtime.catalog.fetched_at}.${runtime.catalog.source_hashes.models.slice(7, 19)}`,
      parameter_keys: ["batch_size"]
    };
    assert.doesNotThrow(() => assertOwnerImageReferenceModelAccess({
      ...expected,
      account_read_live: true,
      parameters_redacted: true,
      access: true,
      cost: batchSize,
      discount_cost: null,
      free_remaining_generations: null,
      limit: null,
      show_warning: false,
      observed_at: "2026-10-10T00:00:00.000Z"
    }, expected));
  }
});

test("reference preflight rejects invalid cost and foreign model/catalog results", () => {
  const runtime = createObservedOwnerRuntime();
  const model = runtime.catalog.getModel("banana-2.1");
  const expected = {
    model_id: model.id,
    ai_name: model.ai_name,
    model_type: model.upstream_id,
    catalog_kind: runtime.catalog.catalog_kind,
    catalog_version: `${runtime.catalog.fetched_at}.${runtime.catalog.source_hashes.models.slice(7, 19)}`,
    parameter_keys: ["image_size"]
  };
  const base = {
    catalog_kind: expected.catalog_kind,
    catalog_version: expected.catalog_version,
    model_id: expected.model_id,
    ai_name: expected.ai_name,
    model_type: expected.model_type,
    account_read_live: true as const,
    parameter_keys: ["image_size"],
    parameters_redacted: true as const,
    access: true,
    cost: 3,
    discount_cost: 2,
    free_remaining_generations: null,
    limit: null,
    show_warning: null,
    observed_at: "2026-10-09T00:00:00.000Z"
  };
  assert.doesNotThrow(() => assertOwnerImageReferenceModelAccess(base, expected));
  assert.throws(() => assertOwnerImageReferenceModelAccess({ ...base, cost: null }, expected));
  assert.throws(() => assertOwnerImageReferenceModelAccess({ ...base, catalog_version: "foreign" }, expected));
  assert.throws(() => assertOwnerImageReferenceModelAccess({ ...base, model_id: "foreign-model" }, expected));
});

test("stdio EOF awaits reference close before profile cleanup and is reentrant", async () => {
  const events: string[] = [];
  let transportCloseCalls = 0;
  let resolveTransportClose!: () => void;
  const transportClosed = new Promise<void>((resolve) => { resolveTransportClose = resolve; });
  let transport!: Transport;
  transport = {
    async start() {},
    async send() {},
    async close() {
      transportCloseCalls += 1;
      transport.onclose?.();
      resolveTransportClose();
    }
  };
  const input = new PassThrough();
  const closeOnce = closeOwnerImageReferenceServiceOnTransportEof(
    transport,
    { async close() { await Promise.resolve(); events.push("references"); } },
    () => { events.push("profile"); },
    input
  );
  input.resume();
  input.push(null);
  await transportClosed;
  await closeOnce();
  assert.deepEqual(events, ["references", "profile"]);
  assert.equal(transportCloseCalls, 1);
  assert.equal(input.listenerCount("end"), 0);
});

test("combined image and Grok reference services close before the owner profile", async () => {
  const events: string[] = [];
  const transport: Transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); } };
  const input = new PassThrough();
  const closeOnce = closeOwnerImageReferenceServicesOnTransportEof(
    transport,
    { async close() { events.push("image-reference"); } },
    { async close() { events.push("grok-reference"); } },
    () => { events.push("profile"); },
    input
  );
  await closeOnce();
  await closeOnce();
  assert.deepEqual(events, ["image-reference", "grok-reference", "profile"]);
  assert.equal(input.listenerCount("end"), 0);
});

test("combined EOF cleanup still closes Grok references and the profile after image-service failure", async () => {
  const previousExitCode = process.exitCode;
  const events: string[] = [];
  const transport: Transport = { async start() {}, async send() {}, async close() {} };
  try {
    const closeOnce = closeOwnerImageReferenceServicesOnTransportEof(
      transport,
      { async close() { events.push("image-reference"); throw new Error("image-close-failed"); } },
      { async close() { events.push("grok-reference"); } },
      () => { events.push("profile"); },
      new PassThrough()
    );
    await assert.rejects(closeOnce(), /image-close-failed/u);
    assert.deepEqual(events, ["image-reference", "grok-reference", "profile"]);
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.exitCode = previousExitCode;
  }
});

test("reference EOF cleanup memoizes before synchronous reentry and still closes the profile after failure", async () => {
  const previousExitCode = process.exitCode;
  const events: string[] = [];
  let closeOnce!: () => Promise<void>;
  let reentrantPromise: Promise<void> | undefined;
  let serviceCloseCalls = 0;
  const transport: Transport = { async start() {}, async send() {}, async close() {} };
  closeOnce = closeOwnerImageReferenceServiceOnTransportEof(
    transport,
    { close() { serviceCloseCalls += 1; reentrantPromise = closeOnce(); throw new Error("synthetic close failure"); } },
    () => { events.push("profile"); },
    new PassThrough()
  );
  try {
    await assert.rejects(closeOnce(), /synthetic close failure/u);
    assert.equal(reentrantPromise, closeOnce());
    assert.equal(serviceCloseCalls, 1);
    assert.deepEqual(events, ["profile"]);
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
    process.exitCode = previousExitCode;
  }
});
