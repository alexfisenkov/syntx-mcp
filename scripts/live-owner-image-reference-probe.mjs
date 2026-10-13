#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadGenerationContractRegistryV2 } from "../dist/src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../dist/src/catalog/selected-discovery-catalog.js";
import { GenerationContractExecutorV2 } from "../dist/src/adapter/syntx/generation-contract-executor-v2.js";
import { observeOwnedImageArtifact } from "../dist/src/adapter/syntx/owned-image-artifact-observer.js";
import { isSyntxModelInfoCallerParameterKey } from "../dist/src/adapter/syntx/http-client.js";
import { ModelAccessService } from "../dist/src/application/model-access.js";
import { createOwnerGenerationPreflight } from "../dist/src/application/owner-generation-preflight.js";
import { OwnerContractMediaError } from "../dist/src/application/owner-contract-media.js";
import { OwnerMediaReferenceStore, OwnerMediaReferenceStoreError } from "../dist/src/application/owner-media-reference-store.js";
import { uploadOwnerImageReference } from "../dist/src/application/owner-image-reference-upload-service.js";
import { prepareOwnerImageReferenceRequest, getOwnerImageReferenceCandidateStoreBinding } from "../dist/src/application/owner-image-reference-request-preparer.js";
import { createOwnerImageReferenceOneShotPermit } from "../dist/src/application/owner-image-reference-one-shot-policy.js";
import { resolveOwnerReferencePrincipal } from "../dist/src/auth/owner-reference-principal.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { registerSyntxOwnerImageReferenceProbeTool } from "../dist/src/mcp/syntx-owner-image-reference-probe.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

export const OWNER_IMAGE_REFERENCE_REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
export const OWNER_IMAGE_REFERENCE_CASE_ID = "banana21-reference-512-v2";
export const OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME = "syntx_owner_probe_image_reference";
const CONFIRM_FLAG = "--confirm-owner-image-reference-probe";
const REAL_FLAG = "--real";
const CASE_PROMPT = "Use the supplied reference image only as a gentle visual cue for a small red house between two green trees on a quiet hill under a clear sky. Create one square image with no text.";
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const BASE_VARIANT = "banana21-image-1k-minimal-square";
const BASE_SCHEMA_HASH = "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UNKNOWN_RECOVERY_WINDOW_MS = 15 * 60_000;
const validatedConfigs = new WeakSet();

export function parseOwnerImageReferenceProbeArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 6 || argv[0] !== CONFIRM_FLAG || argv[1] !== REAL_FLAG ||
      argv[2] !== "--registry-version" || argv[3] !== OWNER_IMAGE_REFERENCE_REGISTRY_VERSION ||
      argv[4] !== "--case" || argv[5] !== OWNER_IMAGE_REFERENCE_CASE_ID) return null;
  const config = Object.freeze({ registryVersion: argv[3], caseId: argv[5] });
  validatedConfigs.add(config);
  return config;
}

/** Deterministic, dependency-free 512x512 synthetic PNG; no user file/photo is read. */
export function createOwnerImageReferenceFixture() {
  const width = 512;
  const height = 512;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      let color = [218, 235, 247, 255];
      if (y >= 348) color = [122, 171, 111, 255];
      if (y >= 326 && y < 348) color = [156, 192, 132, 255];
      for (const center of [92, 420]) {
        const canopyHalf = Math.floor((y - 180) * 0.55);
        if (y >= 180 && y <= 290 && Math.abs(x - center) <= canopyHalf) {
          color = y < 238 ? [48, 111, 66, 255] : [62, 132, 73, 255];
        }
        if (y >= 286 && y <= 354 && Math.abs(x - center) <= 7) color = [111, 75, 49, 255];
      }
      if (y >= 238 && y <= 360 && x >= 180 && x <= 332) color = [190, 54, 47, 255];
      if (y >= 170 && y <= 244 && Math.abs(x - 256) <= Math.floor((244 - y) * 1.18)) color = [126, 42, 40, 255];
      if (y >= 270 && y <= 297 && ((x >= 200 && x <= 226) || (x >= 286 && x <= 312))) color = [211, 231, 238, 255];
      if (y >= 303 && y <= 360 && x >= 242 && x <= 271) color = [105, 61, 45, 255];
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3];
    }
  }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  const decoded = inspectFixturePng(bytes);
  if (decoded.width !== width || decoded.height !== height || decoded.rgbaBytes !== width * height * 4) throw new Error("REFERENCE_FIXTURE_INVALID");
  return Object.freeze({ bytes, width, height, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
}

export async function runOwnerImageReferenceProbe(config, io = process, dependencies = {}) {
  if (!config || typeof config !== "object" || !validatedConfigs.has(config)) return summary("CONFIRMATION_REQUIRED");
  if (!existsSync(resolve(PROJECT_ROOT, "AGENTS.md")) || !existsSync(resolve(PROJECT_ROOT, "src")) ||
      !existsSync(resolve(PROJECT_ROOT, "catalog", "runtime", "v2"))) return summary("SOURCE_CHECKOUT_REQUIRED");
  const privateSend = dependencies.sendPrivateIpc ?? io.sendPrivateIpc ?? (io === process ? defaultSendPrivateIpc : null);
  const waitAck = dependencies.waitForHandoffAck ?? io.waitForHandoffAck ?? defaultWaitForHandoffAck;
  if (typeof privateSend !== "function") return summary("PRIVATE_IPC_REQUIRED");
  const emit = async (message) => { try { return await privateSend(message, 5_000) === true; } catch { return false; } };

  const fixture = createOwnerImageReferenceFixture();
  let runtime;
  let server;
  let client;
  let referenceStore;
  let attemptId = null;
  let uploadCallCount = 0;
  let probeCallCount = 0;
  let generationDispatchCount = 0;
  let recoveryCallCount = 0;
  let actualRequestMetadata = null;
  let rawDispatchStarted = false;
  let recoveredUnknown = false;
  let summaryValue = summary("NOT_STARTED", { fixture_sha256: fixture.sha256, fixture_width: fixture.width, fixture_height: fixture.height });
  let finalized = false;
  const finalize = async () => {
    if (finalized) return summaryValue;
    finalized = true;
    try { referenceStore?.close(); } catch { summaryValue = summary("REFERENCE_STORE_CLEANUP_UNKNOWN", { ...summaryValue }); }
    if (attemptId !== null) {
      const unlink = await unlinkAndReadback(client, attemptId, dependencies);
      summaryValue = summary(summaryValue.status, { ...summaryValue, local_unlink_status: unlink });
    }
    if (actualRequestMetadata !== null) summaryValue = summary(summaryValue.status, { ...summaryValue, ...actualRequestMetadata });
    await closeSession(client, server);
    try { runtime?.authStore?.close?.(); } catch { summaryValue = summary(summaryValue.status, { ...summaryValue, auth_store_close: "UNCONFIRMED" }); }
    await emit({ event: "FINAL", ...summaryValue });
    return summaryValue;
  };

  try {
    const registry = (dependencies.loadRegistry ?? loadGenerationContractRegistryV2)(config.registryVersion, resolve(PROJECT_ROOT, "catalog"));
    const selected = (dependencies.loadCatalog ?? loadSelectedDiscoveryCatalog)();
    const catalog = selected.discoveryCatalog;
    const runtimeFactory = dependencies.createRuntime ?? createObservedOwnerRuntime;
    runtime = runtimeFactory({
      accountStatusEnabled: true,
      ownerContractMediaEnabled: true,
      generationContractRegistry: registry,
      requestTimeoutMs: 30_000
    });
    const ownerMedia = runtime.serverOptions?.ownerContractMedia;
    if (!ownerMedia?.service || ownerMedia.executor?.getContract === undefined || runtime.catalog === undefined) throw new Error("OWNER_MEDIA_UNAVAILABLE");
    const contractRecord = ownerMedia.executor.getContract("banana-2.1", "generate-image", BASE_VARIANT);
    if (!contractRecord || contractRecord.status !== "live_verified" || contractRecord.schema_hash !== BASE_SCHEMA_HASH ||
        contractRecord.output?.mime_types?.length !== 1 || contractRecord.output.mime_types[0] !== "image/jpeg") throw new Error("BASE_PROFILE_UNAVAILABLE");
    const contract = Object.freeze({
      model_id: contractRecord.model_id, operation_id: "generate-image", modality: "image", ai_name: contractRecord.ai_name,
      model_type: contractRecord.model_type, variant_id: BASE_VARIANT, schema_hash: contractRecord.schema_hash,
      status: "live_verified", mime_types: Object.freeze(["image/jpeg"]),
      registry_version: config.registryVersion, catalog_version: registry.catalog_version
    });
    const baseParameters = Object.freeze({ prompt: CASE_PROMPT });
    const executor = new GenerationContractExecutorV2(registry, catalog);
    const preparedBase = executor.prepare({ model_id: "banana-2.1", operation_id: "generate-image", catalog_version: registry.catalog_version,
      variant_id: BASE_VARIANT, parameters: baseParameters });
    const candidateBinding = getOwnerImageReferenceCandidateStoreBinding(registry, catalog);
    const fixedPromptSha256 = `sha256:${createHash("sha256").update(CASE_PROMPT, "utf8").digest("hex")}`;
    const intentFingerprint = `sha256:${createHash("sha256").update(canonicalJson({
      registry_version: config.registryVersion, model_id: "banana-2.1", operation_id: "generate-image", variant_id: BASE_VARIANT,
      schema_hash: candidateBinding.schema_hash, fixture_sha256: fixture.sha256, fixture_width: fixture.width,
      fixture_height: fixture.height, purpose: OWNER_IMAGE_REFERENCE_CASE_ID, fixed_prompt_sha256: fixedPromptSha256,
      normalized_settings: preparedBase.settings,
      reference_slot: { settings_field: "file_urls", cardinality: 1, entry_type: "image", handle_scoped: true }
    })).digest("hex")}`;
    summaryValue = summary("PREPARED", {
      registry_version: config.registryVersion, model_id: "banana-2.1", variant_id: BASE_VARIANT,
      base_schema_hash: BASE_SCHEMA_HASH, candidate_schema_hash: candidateBinding.schema_hash,
      fixed_prompt_sha256: fixedPromptSha256, normalized_setting_fields: Object.freeze(Object.keys(preparedBase.settings).sort()),
      fixture_sha256: fixture.sha256, fixture_width: fixture.width, fixture_height: fixture.height,
      intent_fingerprint: intentFingerprint, upload_call_count: 0, generation_call_count: 0, retry_count: 0
    });

    const serverOptions = { ...runtime.serverOptions };
    delete serverOptions.ownerContractMedia;
    const open = dependencies.openSession ?? openInMemorySession;
    ({ server, client } = await open(runtime, serverOptions, dependencies));
    const namesBefore = new Set((await client.listTools({}, { timeout: 5_000 })).tools?.map((tool) => tool.name) ?? []);
    for (const name of ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status", "syntx_get_generation_schema", "syntx_validate_generation"]) {
      if (!namesBefore.has(name)) throw new Error("REQUIRED_MCP_TOOL_MISSING");
    }
    if (namesBefore.has(OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME) || namesBefore.has("syntx_owner_generate_media")) throw new Error("PROBE_NOT_ISOLATED");
    const schemaResult = await client.callTool({ name: "syntx_get_generation_schema", arguments: {
      model_id: "banana-2.1", operation_id: "generate-image", variant_id: BASE_VARIANT
    } }, undefined, { timeout: 5_000 });
    if (schemaResult.isError === true || schemaResult.structuredContent?.schema_status !== "live_verified" ||
        schemaResult.structuredContent?.model_id !== "banana-2.1" || schemaResult.structuredContent?.variant_id !== BASE_VARIANT ||
        schemaResult.structuredContent?.schema_hash !== BASE_SCHEMA_HASH) throw new Error("BASE_SCHEMA_MISMATCH");
    const validation = await client.callTool({ name: "syntx_validate_generation", arguments: {
      model_id: "banana-2.1", operation_id: "generate-image", variant_id: BASE_VARIANT, parameters: baseParameters
    } }, undefined, { timeout: 5_000 });
    if (validation.isError === true || validation.structuredContent?.validation_status !== "VALID" ||
        validation.structuredContent?.variant_id !== BASE_VARIANT || validation.structuredContent?.schema_hash !== BASE_SCHEMA_HASH) {
      throw new Error("BASE_VALIDATION_FAILED");
    }

    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} }, undefined, { timeout: 12_000 });
    attemptId = begun?.structuredContent?.attempt_id;
    const handoff = begun?.content?.find((item) => item.type === "resource_link");
    if (begun?.isError === true || !ATTEMPT_PATTERN.test(attemptId ?? "") || handoff?.type !== "resource_link" ||
        !isSafeHandoffUri(handoff.uri)) throw new Error("AUTH_HANDOFF_UNAVAILABLE");
    const ackController = new AbortController();
    const ackPromise = Promise.resolve(waitAck(45_000, ackController.signal));
    if (!await emit({ event: "BEGIN", attempt_id: attemptId, handoff_uri: handoff.uri,
      case_id: OWNER_IMAGE_REFERENCE_CASE_ID, intent_fingerprint: intentFingerprint,
      fixture_sha256: fixture.sha256, fixture_bytes: fixture.bytes.byteLength, fixture_width: fixture.width, fixture_height: fixture.height,
      registry_version: config.registryVersion, candidate_schema_hash: candidateBinding.schema_hash })) {
      ackController.abort();
      await ackPromise.catch(() => false);
      throw new Error("PRIVATE_IPC_BEGIN_UNKNOWN");
    }
    if (!await ackPromise) throw new Error("HANDOFF_ACK_MISSING");
    const linkedStatus = await pollLinkedLogin(client, attemptId, dependencies);
    if (!linkedStatus) throw new Error("AUTH_NOT_LINKED");
    const linkedPrincipal = await resolveOwnerReferencePrincipal({ binding: runtime.authBinding, attemptId, linkService: runtime.linkService });
    if (linkedPrincipal.connection_id !== attemptId || linkedPrincipal.tenant_id !== runtime.authBinding.tenant_id ||
        linkedPrincipal.subject_id !== runtime.authBinding.subject) throw new Error("OWNER_PRINCIPAL_SCOPE_MISMATCH");

    const account = await client.callTool({ name: "syntx_get_account_status", arguments: { link_attempt_id: attemptId } }, undefined, { timeout: 15_000 });
    if (account.isError === true || account.structuredContent?.subscription?.active !== true) throw new Error("SUBSCRIPTION_REQUIRED_OR_UNVERIFIED");
    const freshGates = createFreshGates(runtime, registry, catalog, contractRecord, preparedBase.settings);
    await freshGates.verifyFreshSubscription(attemptId, { tenant_id: runtime.authBinding.tenant_id, subject_id: runtime.authBinding.subject, connection_id: attemptId });
    await freshGates.verifyModelAccess(attemptId, { tenant_id: runtime.authBinding.tenant_id, subject_id: runtime.authBinding.subject, connection_id: attemptId }, "banana-2.1");
    await freshGates.authorizeCost(attemptId, { tenant_id: runtime.authBinding.tenant_id, subject_id: runtime.authBinding.subject, connection_id: attemptId });
    if (!await emit({ event: "READY", attempt_id: attemptId, intent_fingerprint: intentFingerprint,
      fixture_sha256: fixture.sha256, subscription_status: "ACTIVE_READBACK", model_access: "ALLOWED_READBACK",
      cost_preflight: "VERIFIED", dispatch_count_authorized: 1 })) throw new Error("PRIVATE_IPC_READY_UNKNOWN");

    const storeNow = dependencies.now ?? Date.now;
    referenceStore = new OwnerMediaReferenceStore({ now: storeNow });
    const rawUploadClient = runtime.createChatClient(attemptId);
    const uploadClient = Object.freeze({
      uploadFileReferences: async (request) => {
        uploadCallCount += 1;
        if (uploadCallCount !== 1) throw new Error("UPLOAD_RETRY_FORBIDDEN");
        return rawUploadClient.uploadFileReferences(request);
      }
    });
    let receipt;
    try {
      receipt = await uploadOwnerImageReference({ registry, catalog, store: referenceStore, binding: runtime.authBinding,
        attemptId, linkService: runtime.linkService, client: uploadClient, filename: "owner-reference-fixture-v2.png",
        mime_type: "image/png", bytes: fixture.bytes });
    } catch (error) {
      summaryValue = summary(error instanceof OwnerMediaReferenceStoreError && error.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN"
        ? "UPLOAD_OUTCOME_UNKNOWN" : "UPLOAD_FAILED", { ...summaryValue, upload_call_count: uploadCallCount, generation_call_count: 0, retry_count: 0 });
      return await finalize();
    }
    const candidate = await prepareOwnerImageReferenceRequest({ registry, catalog, store: referenceStore,
      binding: runtime.authBinding, attemptId, linkService: runtime.linkService,
      reference_handle: receipt.reference_handle, parameters: baseParameters });
    const principal = await resolveOwnerReferencePrincipal({ binding: runtime.authBinding, attemptId, linkService: runtime.linkService });
    const permitNow = dependencies.permitNow ?? storeNow;
    const permit = createOwnerImageReferenceOneShotPermit({ candidate, registry, catalog, principal, attemptId, now: permitNow });
    const mediaClient = createSingleImageClient(runtime.createChatClient(attemptId), async (request) => {
      actualRequestMetadata = fingerprintActualRequest(request, preparedBase.settings);
      if (!await emit({ event: "IMAGE_REQUEST_LATCHED", attempt_id: attemptId, ...actualRequestMetadata })) {
        throw new Error("REQUEST_FINGERPRINT_IPC_UNKNOWN");
      }
    }, () => { generationDispatchCount += 1; rawDispatchStarted = true; });
    const lifecycleInput = Object.freeze({ client: mediaClient, attemptId, contract, candidate, permit,
      resolveAuthPrincipal: async (boundAttemptId, signal) => {
        if (boundAttemptId !== attemptId) throw new Error("PRINCIPAL_SCOPE_MISMATCH");
        return resolveOwnerReferencePrincipal({ binding: runtime.authBinding, attemptId: boundAttemptId, linkService: runtime.linkService });
      },
      preflight: freshGates, binding: runtime.authBinding, linkService: runtime.linkService,
      referenceStore, referenceHandle: receipt.reference_handle });
    registerSyntxOwnerImageReferenceProbeTool(server, { attemptId, service: ownerMedia.service, input: lifecycleInput });
    const registeredNames = new Set((await client.listTools({}, { timeout: 5_000 })).tools?.map((tool) => tool.name) ?? []);
    if (!registeredNames.has(OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME)) throw new Error("REFERENCE_TOOL_REGISTRATION_FAILED");
    await dependencies.beforeProbeCall?.();

    probeCallCount = 1;
    let probeResult;
    try {
      probeResult = await client.callTool({ name: OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME, arguments: { link_attempt_id: attemptId } },
        undefined, { timeout: 10 * 60_000, maxTotalTimeout: 10 * 60_000 });
    } catch {
      probeResult = { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "OUTCOME_UNKNOWN" } }) }] };
    }
    let artifacts;
    if (probeResult?.isError === true) {
      const error = parseSafeToolError(probeResult);
      if (error.code !== "OUTCOME_UNKNOWN") {
        summaryValue = summary(error.code === "PRE_DISPATCH_FAILED" ? "PRE_DISPATCH_FAILED" : "PROBE_FAILED",
          { ...summaryValue, upload_call_count: uploadCallCount, generation_call_count: generationDispatchCount, mcp_probe_call_count: probeCallCount, retry_count: 0 });
        return await finalize();
      }
      if (!rawDispatchStarted) {
        summaryValue = summary("PRE_DISPATCH_FAILED", { ...summaryValue, upload_call_count: uploadCallCount,
          generation_call_count: 0, mcp_probe_call_count: probeCallCount, retry_count: 0 });
        return await finalize();
      }
      summaryValue = summary("OUTCOME_UNKNOWN", { ...summaryValue, upload_call_count: uploadCallCount,
        generation_call_count: generationDispatchCount, mcp_probe_call_count: probeCallCount,
        recovery_call_count: 0, retry_count: 0 });
      const recoveryId = error.recoveryId ?? findRecoveryId(ownerMedia.service, attemptId, candidate.candidate_variant_id);
      if (recoveryId === null) {
        summaryValue = summary("OUTCOME_UNKNOWN", { ...summaryValue, upload_call_count: uploadCallCount, generation_call_count: generationDispatchCount,
          mcp_probe_call_count: probeCallCount, recovery_call_count: 0, recovery_available: false,
          recovery_status: "UNRECOVERABLE_HANDLE_UNAVAILABLE", retry_count: 0 });
        return await finalize();
      }
      const recovery = await waitForReferenceRecovery({ ownerMedia, runtime, attemptId, recoveryId, contract,
        summaryValue, emit, waitForParentAction: dependencies.waitForParentAction ?? io.waitForParentAction ?? defaultWaitForParentAction,
        now: dependencies.now ?? Date.now, dependencies });
      recoveryCallCount = recovery.recoveryCallCount;
      if (recovery.artifacts === null) {
        summaryValue = summary("OUTCOME_UNKNOWN", { ...summaryValue, upload_call_count: uploadCallCount,
          generation_call_count: generationDispatchCount, mcp_probe_call_count: probeCallCount,
          recovery_call_count: recoveryCallCount, recovery_available: true, recovery_window: recovery.window,
          finish_action: recovery.finished ? "RECEIVED" : "NOT_RECEIVED", retry_count: 0 });
        return await finalize();
      }
      artifacts = recovery.artifacts;
      recoveredUnknown = true;
    } else {
      const result = probeResult?.structuredContent;
      if (result?.status !== "candidate_result_observed" || result?.candidate_status !== "blocked" ||
          result?.dispatch_allowed !== false || result.model_id !== "banana-2.1" || result.operation_id !== "generate-image") {
        summaryValue = summary("OUTCOME_UNKNOWN", { ...summaryValue, upload_call_count: uploadCallCount,
          generation_call_count: generationDispatchCount, mcp_probe_call_count: probeCallCount,
          recovery_call_count: recoveryCallCount, recovery_available: false,
          recovery_status: "RESULT_BINDING_UNVERIFIED", retry_count: 0 });
        return await finalize();
      }
      artifacts = result.artifacts;
    }

    const observed = await (dependencies.observeOwnedImageArtifact ?? observeOwnedImageArtifact)({ artifacts });
    if (observed?.status !== "OBSERVED" || observed.mime !== "image/jpeg" || observed.width === undefined || observed.height === undefined ||
        !/^sha256:[a-f0-9]{64}$/u.test(observed.sha256 ?? "")) {
      summaryValue = summary("ARTIFACT_OBSERVER_UNVERIFIED", { ...summaryValue, upload_call_count: uploadCallCount,
        generation_call_count: generationDispatchCount, mcp_probe_call_count: probeCallCount, recovery_call_count: recoveryCallCount, retry_count: 0,
        observer_status: observed?.status === "UNKNOWN" ? "UNKNOWN" : "UNVERIFIED" });
      return await finalize();
    }
    summaryValue = summary("PASS_EXACT_RESULT_ONLY", { ...summaryValue, upload_call_count: uploadCallCount,
      generation_call_count: generationDispatchCount, mcp_probe_call_count: probeCallCount, recovery_call_count: recoveryCallCount, retry_count: 0,
      candidate_status: "blocked", dispatch_allowed: false, result_mime: observed.mime,
      result_byte_size: observed.byte_size, result_width: observed.width, result_height: observed.height,
      result_sha256: observed.sha256, result_observation: "BYTE_OBSERVED" });
    if (recoveredUnknown) {
      const finishPromise = waitForFinishAction(dependencies.waitForParentAction ?? io.waitForParentAction ?? defaultWaitForParentAction,
        dependencies.now ?? Date.now);
      await emit({ event: "TERMINAL_RESULT", ...summaryValue });
      const finishAction = await finishPromise;
      summaryValue = summary(summaryValue.status, { ...summaryValue, finish_action: finishAction ? "RECEIVED" : "NOT_RECEIVED" });
    }
    return await finalize();
  } catch (error) {
    summaryValue = summary(error instanceof Error && /^[A-Z][A-Z0-9_]{0,79}$/u.test(error.message) ? error.message : "PROBE_UNAVAILABLE",
      { ...summaryValue, upload_call_count: uploadCallCount, generation_call_count: generationDispatchCount, mcp_probe_call_count: probeCallCount, retry_count: 0 });
    return await finalize();
  } finally {
    await finalize();
  }
  return summaryValue;
}

function createFreshGates(runtime, registry, catalog, contractRecord, fixedSettings) {
  const assertGeneration = createOwnerGenerationPreflight({ catalog,
    resolveSubscription: (attemptId, signal) => runtime.createReadClient(attemptId).getSubscription(signal) });
  const model = catalog.getModel("banana-2.1");
  const expectedCatalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const allowedCostKeys = new Set((model.settings?.get_cost_params ?? []).filter(isSyntxModelInfoCallerParameterKey));
  const costParameters = Object.freeze(Object.fromEntries(Object.entries(fixedSettings).filter(([key, value]) => allowedCostKeys.has(key) &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))));
  let latestAccess = null;
  return Object.freeze({
    verifyFreshSubscription: async (attemptId, principal, signal) => {
      if (principal.connection_id !== attemptId) throw new Error("PRINCIPAL_SCOPE_MISMATCH");
      await assertGeneration(attemptId, "banana-2.1", signal);
    },
    verifyModelAccess: async (attemptId, principal, modelId, signal) => {
      if (principal.connection_id !== attemptId || modelId !== "banana-2.1") throw new Error("MODEL_ACCESS_SCOPE_MISMATCH");
      const access = await new ModelAccessService(catalog, runtime.createReadClient(attemptId)).getModelAccess({
        model_id: modelId, cost_parameters: costParameters
      }, signal);
      if (access.account_read_live !== true || access.parameters_redacted !== true || access.access !== true ||
          access.model_id !== contractRecord.model_id || access.ai_name !== contractRecord.ai_name ||
          access.model_type !== contractRecord.model_type || access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
          access.catalog_version !== expectedCatalogVersion || typeof access.cost !== "number" || !Number.isFinite(access.cost) || access.cost < 0) {
        throw new Error("MODEL_ACCESS_NOT_VERIFIED");
      }
      latestAccess = access;
    },
    authorizeCost: async (attemptId, principal, candidate) => {
      if (principal.connection_id !== attemptId || (candidate !== undefined && candidate?.candidate_schema_hash === undefined) || latestAccess === null ||
          typeof latestAccess.cost !== "number" || !Number.isFinite(latestAccess.cost) || latestAccess.cost < 0 ||
          (latestAccess.discount_cost !== null && (typeof latestAccess.discount_cost !== "number" || !Number.isFinite(latestAccess.discount_cost) || latestAccess.discount_cost < 0))) {
        throw new Error("COST_PREFLIGHT_NOT_VERIFIED");
      }
    }
  });
}

async function pollLinkedLogin(client, attemptId, dependencies) {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + 180_000;
  while (now() < deadline) {
    const result = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } }, undefined, { timeout: 12_000 });
    const value = result?.structuredContent;
    if (result?.isError === true || value?.attempt_id !== attemptId) return false;
    if (value.status === "LINKED" && value.linked === true) return true;
    if (value.status !== "HANDOFF_ISSUED" && value.status !== "POLLING") return false;
    await sleep(2_500);
  }
  return false;
}

async function waitForReferenceRecovery({ ownerMedia, runtime, attemptId, recoveryId, contract, summaryValue, emit,
  waitForParentAction, now, dependencies }) {
  const deadline = now() + UNKNOWN_RECOVERY_WINDOW_MS;
  let recoveryCallCount = 0;
  let actionPromise = Promise.resolve(waitForParentAction(Math.max(0, deadline - now())));
  await emit({ event: "OUTCOME_UNKNOWN", ...summaryValue, recovery_available: true, recovery_id: recoveryId,
    recovery_call_count: 0, recovery_window: "OPEN", retry_count: 0 });
  while (now() < deadline) {
    const action = await actionPromise;
    if (action === null) return { artifacts: null, recoveryCallCount, window: now() >= deadline ? "EXPIRED" : "OPEN", finished: false };
    if (action.action === "finish") return { artifacts: null, recoveryCallCount, window: "OPEN", finished: true };
    if (action.action !== "reconcile") {
      actionPromise = Promise.resolve(waitForParentAction(Math.max(0, deadline - now())));
      continue;
    }
    recoveryCallCount += 1;
    let artifacts = null;
    try {
      const readClient = createReadOnlyClient(runtime.createChatClient(attemptId));
      const result = await ownerMedia.service.reconcile({ client: readClient, attemptId, recoveryId, contract });
      if (Array.isArray(result?.artifacts) && result.artifacts.length > 0) artifacts = result.artifacts;
    } catch { /* Same known recovery handle may remain unknown; never start another upload or generation. */ }
    if (artifacts !== null) return { artifacts, recoveryCallCount, window: "RESOLVED", finished: false };
    if (now() >= deadline) break;
    actionPromise = Promise.resolve(waitForParentAction(Math.max(0, deadline - now())));
    await emit({ event: "OUTCOME_UNKNOWN", ...summaryValue, recovery_available: true, recovery_id: recoveryId,
      recovery_call_count: recoveryCallCount, recovery_window: now() >= deadline ? "EXPIRED" : "OPEN", retry_count: 0 });
  }
  return { artifacts: null, recoveryCallCount, window: "EXPIRED", finished: false };
}

async function waitForFinishAction(waitForParentAction, now) {
  const deadline = now() + UNKNOWN_RECOVERY_WINDOW_MS;
  while (now() < deadline) {
    const action = await waitForParentAction(Math.max(0, deadline - now()));
    if (action === null) return false;
    if (action.action === "finish") return true;
    // A terminal result needs no further reconciliation; keep waiting only for finish.
  }
  return false;
}

async function unlinkAndReadback(client, attemptId, dependencies) {
  if (!client) return "NOT_AVAILABLE";
  try {
    const unlink = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }, undefined, { timeout: 12_000 });
    if (unlink?.isError === true || unlink?.structuredContent?.status !== "REVOKED") return "UNCONFIRMED";
    const status = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } }, undefined, { timeout: 12_000 });
    return status?.isError !== true && status?.structuredContent?.attempt_id === attemptId &&
      status?.structuredContent?.status === "REVOKED" && status?.structuredContent?.linked === false
      ? "REVOKED_READBACK_CONFIRMED" : "UNCONFIRMED";
  } catch { return "UNCONFIRMED"; }
}

async function openInMemorySession(runtime, serverOptions, dependencies) {
  const server = (dependencies.createMcpServer ?? createMcpServer)(runtime.application, serverOptions);
  const client = new Client({ name: "syntx-owner-image-reference-probe-source", version: "1.0.0" });
  const [clientTransport, serverTransport] = (dependencies.InMemoryTransport ?? InMemoryTransport).createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); return { server, client }; }
  catch (error) { await closeSession(client, server); throw error; }
}

function parseSafeToolError(result) {
  try {
    const parsed = JSON.parse(result?.content?.find((entry) => entry.type === "text")?.text ?? "{}");
    const code = typeof parsed?.error?.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/u.test(parsed.error.code) ? parsed.error.code : "PROBE_UNAVAILABLE";
    const recoveryId = typeof parsed?.error?.recovery_id === "string" && RECOVERY_PATTERN.test(parsed.error.recovery_id) ? parsed.error.recovery_id : null;
    return { code, recoveryId };
  } catch { return { code: "PROBE_UNAVAILABLE", recoveryId: null }; }
}

function findRecoveryId(service, attemptId, variantId) {
  try {
    const values = service.listRecoveries(attemptId, 20).filter((item) => item.model_id === "banana-2.1" &&
      item.operation_id === "generate-image" && item.variant_id === "banana21-image-1k-minimal-square");
    return values.length === 1 && RECOVERY_PATTERN.test(values[0].recovery_id) ? values[0].recovery_id : null;
  } catch { return null; }
}

function createSingleImageClient(client, beforeRawDispatch, onRawDispatch) {
  let dispatches = 0;
  return Object.freeze({
    createChat: (...args) => client.createChat(...args),
    startImageWithInternalReferences: async (baseRequest, references, signal) => {
      dispatches += 1;
      if (dispatches !== 1) throw new Error("IMAGE_RETRY_FORBIDDEN");
      if (typeof client.startImageWithInternalReferences !== "function") throw new Error("INTERNAL_IMAGE_PORT_UNAVAILABLE");
      if (!isPlainRecord(baseRequest) || !isPlainRecord(baseRequest.settings) || !Array.isArray(baseRequest.settings.file_urls) ||
          baseRequest.settings.file_urls.length !== 0 || !Array.isArray(references) || references.length !== 1 ||
          !isPlainRecord(references[0]) || Object.keys(references[0]).sort().join(",") !== "url" ||
          typeof references[0].url !== "string") {
        throw new Error("INTERNAL_IMAGE_REFERENCE_INPUT_INVALID");
      }
      const predictedRequest = { ...baseRequest, settings: { ...baseRequest.settings,
        file_urls: references.map((reference) => ({ type: "image", url: reference.url })) } };
      await beforeRawDispatch(predictedRequest);
      onRawDispatch();
      return client.startImageWithInternalReferences(baseRequest, references, signal);
    },
    startVideo: async () => { throw new Error("VIDEO_DISPATCH_FORBIDDEN"); },
    listInProgress: (...args) => client.listInProgress(...args),
    getMessage: (...args) => client.getMessage(...args),
    ...(client.listMessageCandidates === undefined ? {} : {
      listMessageCandidates: (...args) => client.listMessageCandidates(...args)
    })
  });
}

function fingerprintActualRequest(request, expectedBaseSettings) {
  if (!isPlainRecord(request) || Object.keys(request).sort().join(",") !== "ai_name,chat_uuid,prompt,settings" ||
      request.ai_name !== "banana" || request.prompt !== CASE_PROMPT || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(request.chat_uuid) ||
      !isPlainRecord(request.settings) || !Array.isArray(request.settings.file_urls) || request.settings.file_urls.length !== 1) {
    throw new Error("ACTUAL_REFERENCE_REQUEST_SHAPE_INVALID");
  }
  const [entry] = request.settings.file_urls;
  if (!isPlainRecord(entry) || Object.keys(entry).sort().join(",") !== "type,url" || entry.type !== "image" || typeof entry.url !== "string") {
    throw new Error("ACTUAL_REFERENCE_REQUEST_SHAPE_INVALID");
  }
  const url = new URL(entry.url);
  if (url.protocol !== "https:" || url.hostname !== "r2.syntx.ai" || url.username || url.password || url.port || url.hash) {
    throw new Error("ACTUAL_REFERENCE_REQUEST_SHAPE_INVALID");
  }
  const { file_urls: _privateReferenceUrls, ...normalizedSettings } = request.settings;
  const { file_urls: _emptyBaseReferenceSlot, ...expectedNormalizedSettings } = expectedBaseSettings;
  if (canonicalJson(normalizedSettings) !== canonicalJson(expectedNormalizedSettings)) throw new Error("ACTUAL_REFERENCE_SETTINGS_MISMATCH");
  const wireBody = { chat_uuid: request.chat_uuid, prompt: request.prompt, settings: request.settings };
  return Object.freeze({
    actual_request_fingerprint: `sha256:${createHash("sha256").update(canonicalJson(request), "utf8").digest("hex")}`,
    predicted_wire_body_fingerprint: `sha256:${createHash("sha256").update(canonicalJson(wireBody), "utf8").digest("hex")}`,
    actual_request_fields: Object.freeze(Object.keys(request).sort()),
    actual_settings_fields: Object.freeze(Object.keys(request.settings).sort()),
    reference_entry_shape: Object.freeze({ count: 1, keys: Object.freeze(["type", "url"]), type: "image" })
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function createReadOnlyClient(client) {
  return Object.freeze({
    listInProgress: (...args) => client.listInProgress(...args),
    getMessage: (...args) => client.getMessage(...args),
    ...(client.listMessageCandidates === undefined ? {} : {
      listMessageCandidates: (...args) => client.listMessageCandidates(...args)
    })
  });
}

function inspectFixturePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("REFERENCE_FIXTURE_INVALID");
  let offset = 8;
  let width = 0;
  let height = 0;
  let compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error("REFERENCE_FIXTURE_INVALID");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (pngCrc(Buffer.concat([Buffer.from(type), data])) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error("REFERENCE_FIXTURE_INVALID");
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") compressed.push(data);
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (offset !== bytes.length || compressed.length === 0 || width !== 512 || height !== 512) throw new Error("REFERENCE_FIXTURE_INVALID");
  const raw = inflateSync(Buffer.concat(compressed));
  return { width, height, rgbaBytes: raw.length - height };
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  return Buffer.concat([u32(data.length), typeBytes, data, u32(pngCrc(Buffer.concat([typeBytes, data])))]);
}
function pngCrc(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; }
function isSafeHandoffUri(value) {
  try { const url = new URL(value); return url.protocol === "https:" && ["t.me", "telegram.me"].includes(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}
function summary(status, safeFields = {}) {
  const { status: _ignoredPreviousStatus, ...fields } = safeFields;
  return Object.freeze({ status, ...fields });
}
function defaultSendPrivateIpc(message, timeoutMs = 5_000) {
  if (typeof process.send !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs); timer.unref?.();
    const finish = (ok) => { if (settled) return; settled = true; clearTimeout(timer); resolve(ok); };
    try { process.send(message, (error) => finish(error == null)); } catch { finish(false); }
  });
}
function defaultWaitForHandoffAck(timeoutMs, signal) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onMessage = (message) => done(message !== null && typeof message === "object" && !Array.isArray(message) &&
      Object.keys(message).length === 1 && message.action === "handoff_sent");
    const onAbort = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs); timer.unref?.(); process.on("message", onMessage);
    if (signal?.aborted) return done(false);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function defaultWaitForParentAction(timeoutMs, signal) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onMessage = (message) => {
      if (message === null || typeof message !== "object" || Array.isArray(message) ||
          Object.keys(message).length !== 1 || !["reconcile", "finish"].includes(message.action)) return;
      done(Object.freeze({ action: message.action }));
    };
    const onAbort = () => done(null);
    const timer = setTimeout(() => done(null), Math.max(0, timeoutMs));
    timer.unref?.();
    process.on("message", onMessage);
    if (signal?.aborted) return done(null);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function closeSession(client, server) {
  try { await client?.close(); } catch { /* Safe teardown. */ }
  try { await server?.close(); } catch { /* Safe teardown. */ }
}

async function runCli(argv) {
  const config = parseOwnerImageReferenceProbeArgs(argv);
  if (config === null) {
    process.stderr.write("Refusing owner image-reference probe: exact confirmation, pinned registry, and fixed case are required.\n");
    process.exitCode = 2;
    return;
  }
  const result = await runOwnerImageReferenceProbe(config);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "PASS_EXACT_RESULT_ONLY" || result.local_unlink_status !== "REVOKED_READBACK_CONFIRMED") process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli(process.argv.slice(2)).catch(() => {
    process.stderr.write("Owner image-reference probe stopped without emitting private response data.\n");
    process.exitCode = 1;
  });
}
