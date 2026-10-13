import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { schemaHash } from "../src/domain/generation-contract.js";
import { generationContractRegistryV2Schema, type GenerationContractRegistryV2, type GenerationContractV2 } from "../src/domain/generation-contract-v2.js";
import { OwnerMediaReferenceStore } from "../src/application/owner-media-reference-store.js";
import { GenerationContractExecutorV2, GenerationContractExecutionErrorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";
import { prepareOwnerReferenceRequest } from "../src/application/owner-reference-request-preparer.js";

const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const MODEL_ID = "wan_26_i2v";
const VARIANT_ID = "wan26-i2v-one-image-needs-wire";
const SETTINGS_SHA = `sha256:${"a".repeat(64)}`;
const ATTEMPT = "link_abcdefghijklmnopqrstuvwxyz123456";
const BINDING: AuthBinding = { tenant_id: "tenant_local_owner", subject: "subject_local_owner" };

function referenceStoreCatalogVersion(registry: GenerationContractRegistryV2): string {
  return `sha256-${registry.registry_sha256.slice("sha256:".length)}.json`;
}

function loadCurrentFixture() {
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: resolve("catalog") }).snapshot;
  const catalog = new DiscoveryCatalogRepository(snapshot);
  const model = catalog.getModel(MODEL_ID);
  const sourceHashes = catalog.source_hashes;
  const catalogVersion = `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
  const contractBase: Omit<GenerationContractV2, "schema_hash"> = {
    model_id: MODEL_ID,
    operation_id: "generate-video",
    variant_id: VARIANT_ID,
    model_type: model.upstream_id,
    ai_name: model.ai_name,
    modality: "video",
    route: "video",
    status: "blocked",
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "file_urls", "aspect_ratio", "resolution", "video_duration", "prompt_extend", "shot_type", "audio_setting", "seed", "native_audio"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 500 },
        file_urls: {
          type: "array", min_items: 1, max_items: 1,
          items: { type: "media_reference", modality: "image", source: "uploaded_file_id" }
        },
        aspect_ratio: { type: "string", enum: ["1:1", "16:9"] },
        resolution: { type: "string", enum: ["720P", "1080P"] },
        video_duration: { type: "integer", enum: [5, 10] },
        prompt_extend: { type: "boolean" },
        shot_type: { type: "string", enum: ["single"] },
        audio_setting: { type: "string", enum: ["auto"] },
        seed: { type: "integer", nullable: true },
        native_audio: { type: "boolean" }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-video",
      input_kind: "prompt_and_media",
      prompt_field: "prompt",
      settings_fields: {
        aspect_ratio: "aspect_ratio",
        resolution: "resolution",
        video_duration: "video_duration",
        prompt_extend: "prompt_extend",
        shot_type: "shot_type",
        audio_setting: "audio_setting",
        seed: "seed",
        native_audio: "native_audio"
      },
      fixed_settings: {},
      media_reference_fields: { file_urls: "image" }
    },
    provenance: {
      settings_source_sha256: SETTINGS_SHA,
      references: [
        { kind: "public_catalog", reference: "current-public-catalog-fixture", sha256: model.source_hashes.models },
        { kind: "frontend_static", reference: "candidate-source-fixture", sha256: SETTINGS_SHA },
        { kind: "manual_review", reference: "unreviewed-wire-candidate" }
      ]
    },
    limits: { max_parameters: 12, max_value_depth: 4, max_serialized_bytes: 4096, max_normalized_nodes: 32 }
  };
  const contract: GenerationContractV2 = { ...contractBase, schema_hash: schemaHash(contractBase) };
  const registryBase = {
    schema_version: "2.0.0" as const,
    catalog_version: catalogVersion,
    source_hashes: sourceHashes,
    contracts: [contract]
  };
  const registry = generationContractRegistryV2Schema.parse({
    ...registryBase,
    registry_sha256: schemaHash(registryBase)
  }) as GenerationContractRegistryV2;
  return { catalog, model, registry };
}

function rebuildRegistryWithContract(
  registry: GenerationContractRegistryV2,
  update: (contract: GenerationContractV2) => GenerationContractV2
): GenerationContractRegistryV2 {
  const { registry_sha256: _oldRegistryHash, ...registryBase } = registry;
  const contracts = registry.contracts.map((contract) => update(contract));
  const base = { ...registryBase, contracts };
  return generationContractRegistryV2Schema.parse({ ...base, registry_sha256: schemaHash(base) });
}

function linkedService() {
  return {
    async getStatus(): Promise<PublicAuthLinkAttempt> {
      return {
        attempt_id: ATTEMPT,
        authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: "LINKED",
        expires_at: null,
        linked: true
      };
    }
  };
}

test("prepares exactly one owned image handle into a blocked non-dispatchable WAN i2v candidate", async () => {
  const { catalog, model, registry } = loadCurrentFixture();
  const store = new OwnerMediaReferenceStore({ createHandle: () => "reference_823e4567-e89b-12d3-a456-426614174000" });
  let uploadCalls = 0;
  const linkService = linkedService();
  const receipt = await store.uploadAndIssue({
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService,
    client: { async uploadFileReferences() {
      uploadCalls += 1;
      return [{ url: "https://r2.syntx.ai/owned/reference.png" }];
    } },
    contract: {
      schema_hash: registry.contracts[0]!.schema_hash,
      catalog_version: referenceStoreCatalogVersion(registry),
      model_id: MODEL_ID,
      model_type: model.upstream_id,
      operation_id: "generate-video",
      modality: "video",
      variant_id: VARIANT_ID
    },
    filename: "reference.png",
    mime_type: "image/png",
    bytes: Uint8Array.from([1, 2, 3])
  });
  const uploadsBeforePrepare = uploadCalls;
  const candidate = await prepareOwnerReferenceRequest({
    candidate_status: "needs_wire_contract",
    registry,
    catalog,
    store,
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService,
    variant_id: VARIANT_ID,
    reference_handle: receipt.reference_handle,
    parameters: {
      prompt: "Animate the supplied still gently.",
      aspect_ratio: "16:9",
      resolution: "720P",
      video_duration: 5,
      prompt_extend: false,
      shot_type: "single",
      audio_setting: "auto",
      seed: null,
      native_audio: false
    }
  });

  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.confidence, "PREPARED_REFERENCE_CANDIDATE");
  assert.deepEqual(candidate.request.settings, {
    aspect_ratio: "16:9",
    resolution: "720P",
    video_duration: 5,
    prompt_extend: false,
    shot_type: "single",
    audio_setting: "auto",
    seed: null,
    native_audio: false,
    model_type: model.upstream_id,
    file_urls: ["https://r2.syntx.ai/owned/reference.png"]
  });
  assert.equal(candidate.request.settings.file_urls.includes("validation-reference-only"), false);
  assert.equal(candidate.request.prompt, "Animate the supplied still gently.");
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.request), true);
  assert.equal(Object.isFrozen(candidate.request.settings), true);
  assert.equal(Object.isFrozen(candidate.request.settings.file_urls), true);
  assert.equal(uploadCalls, uploadsBeforePrepare, "prepare performs no upload");
  store.close();
});

test("the V2 generation executor continues to reject the blocked reference candidate", () => {
  const { catalog, registry } = loadCurrentFixture();
  const executor = new GenerationContractExecutorV2(registry, catalog);
  assert.throws(() => executor.prepare({
    model_id: MODEL_ID,
    operation_id: "generate-video",
    variant_id: VARIANT_ID,
    catalog_version: registry.catalog_version,
    parameters: {
      prompt: "No dispatch",
      file_urls: ["reference_923e4567-e89b-12d3-a456-426614174000"],
      aspect_ratio: "16:9",
      resolution: "720P",
      video_duration: 5,
      prompt_extend: false,
      shot_type: "single",
      audio_setting: "auto",
      seed: null,
      native_audio: false
    }
  }), (error: unknown) => error instanceof GenerationContractExecutionErrorV2 && error.code === "GENERATION_CONTRACT_NOT_REVIEWED");
});

test("V2 registry schema still refuses a media-reference contract marked reviewed", () => {
  const { registry } = loadCurrentFixture();
  const original = registry.contracts[0]!;
  const { schema_hash: _oldHash, ...baseContract } = original;
  const reviewedBase = { ...baseContract, status: "reviewed" as const };
  const reviewedContract = { ...reviewedBase, schema_hash: schemaHash(reviewedBase) };
  const { registry_sha256: _oldRegistryHash, ...registryWithoutHash } = registry;
  const withoutHash = { ...registryWithoutHash, contracts: [reviewedContract] };
  assert.throws(() => generationContractRegistryV2Schema.parse({
    ...withoutHash,
    registry_sha256: schemaHash(withoutHash)
  }));
});

test("preflight rejects caller URL/file_urls, missing or malformed closed fields, and invalid candidate state before resolving", async () => {
  const { catalog, registry } = loadCurrentFixture();
  let resolverCalls = 0;
  const store = {
    async resolveImageReferences() {
      resolverCalls += 1;
      return { file_urls: ["https://r2.syntx.ai/should-not-be-reached.png"] };
    }
  } as unknown as OwnerMediaReferenceStore;
  const valid = {
    candidate_status: "needs_wire_contract" as const,
    registry,
    catalog,
    store,
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService: linkedService(),
    variant_id: VARIANT_ID,
    reference_handle: "reference_a23e4567-e89b-12d3-a456-426614174000",
    parameters: {
      prompt: "Safe fixture.", aspect_ratio: "16:9", resolution: "720P", video_duration: 5,
      prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false
    }
  };
  const invalidCases = [
    { ...valid, candidate_status: "live_verified" },
    { ...valid, variant_id: "not-in-registry" },
    { ...valid, reference_handle: "https://r2.syntx.ai/raw.png" },
    { ...valid, parameters: { ...valid.parameters, file_urls: ["reference_fake"] } },
    { ...valid, parameters: { ...valid.parameters, native_audio: undefined } },
    { ...valid, parameters: { ...valid.parameters, resolution: { guessed: "720P" } } }
  ];
  for (const input of invalidCases) {
    await assert.rejects(prepareOwnerReferenceRequest(input as never), (error: unknown) =>
      error instanceof Error && "code" in error && [
        "INVALID_REQUEST", "CANDIDATE_NOT_PREPARED", "PARAMETERS_INVALID"
      ].includes(String(error.code)) && !error.message.includes("r2.syntx.ai"));
  }
  const getterParameters = Object.defineProperty({ ...valid.parameters }, "resolution", { get() { throw new Error("must not read getter"); } });
  await assert.rejects(prepareOwnerReferenceRequest({ ...valid, parameters: getterParameters }), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  await assert.rejects(prepareOwnerReferenceRequest(new Proxy(valid, {})), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  assert.equal(resolverCalls, 0);
});

test("source candidates cannot smuggle settings defaults or fixed wire settings", async () => {
  const { catalog, registry } = loadCurrentFixture();
  let resolverCalls = 0;
  const store = {
    async resolveImageReferences() {
      resolverCalls += 1;
      return { file_urls: ["https://r2.syntx.ai/never.png"] };
    }
  } as unknown as OwnerMediaReferenceStore;
  const base = {
    candidate_status: "needs_wire_contract" as const,
    catalog, store, binding: BINDING, attemptId: ATTEMPT, linkService: linkedService(),
    variant_id: VARIANT_ID,
    reference_handle: "reference_e23e4567-e89b-12d3-a456-426614174000",
    parameters: {
      prompt: "Explicit settings only.", aspect_ratio: "16:9", resolution: "720P", video_duration: 5,
      prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false
    }
  };
  const withDefault = rebuildRegistryWithContract(registry, (contract) => {
    const { schema_hash: _oldHash, ...contractBase } = contract;
    const changedBase = {
      ...contractBase,
      parameters: {
        ...contract.parameters,
        properties: {
          ...contract.parameters.properties,
          resolution: { type: "string" as const, enum: ["720P", "1080P"], default: "720P" }
        }
      }
    };
    return { ...changedBase, schema_hash: schemaHash(changedBase) };
  });
  assert.throws(() => rebuildRegistryWithContract(registry, (contract) => {
    const { schema_hash: _oldHash, ...contractBase } = contract;
    const changedBase = { ...contractBase, wire: { ...contract.wire, fixed_settings: { resolution: "720P" } } };
    return { ...changedBase, schema_hash: schemaHash(changedBase) };
  }));
  await assert.rejects(prepareOwnerReferenceRequest({ ...base, registry: withDefault }), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "CONTRACT_SHAPE_UNSUPPORTED");
  assert.equal(resolverCalls, 0);
});

test("inactive, stale-source, or wrong-model current catalog bindings fail before resolving handles", async () => {
  const { model, registry } = loadCurrentFixture();
  let resolverCalls = 0;
  const store = {
    async resolveImageReferences() {
      resolverCalls += 1;
      return { file_urls: ["https://r2.syntx.ai/never.png"] };
    }
  } as unknown as OwnerMediaReferenceStore;
  const base = {
    candidate_status: "needs_wire_contract" as const,
    registry,
    store,
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService: linkedService(),
    variant_id: VARIANT_ID,
    reference_handle: "reference_b23e4567-e89b-12d3-a456-426614174000",
    parameters: {
      prompt: "Safe fixture.", aspect_ratio: "16:9", resolution: "720P", video_duration: 5,
      prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false
    }
  };
  const badCatalogModels = [
    { ...model, active: false },
    { ...model, upstream_id: "wrong-model-type" },
    { ...model, source_hashes: { ...model.source_hashes, models: `sha256:${"f".repeat(64)}` } }
  ];
  for (const badModel of badCatalogModels) {
    await assert.rejects(prepareOwnerReferenceRequest({
      ...base,
      catalog: { getModel: () => badModel }
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "CATALOG_BINDING_MISMATCH");
  }
  assert.equal(resolverCalls, 0);
});

test("expired or revoked owned handles fail closed without exposing URLs or file IDs", async () => {
  const { catalog, model, registry } = loadCurrentFixture();
  let status: "LINKED" | "REVOKED" = "LINKED";
  let now = 1_800_000_000_000;
  let uploadCalls = 0;
  const linkService = {
    async getStatus(): Promise<PublicAuthLinkAttempt> {
      return {
        attempt_id: ATTEMPT,
        authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status,
        expires_at: null,
        linked: status === "LINKED"
      };
    }
  };
  const store = new OwnerMediaReferenceStore({
    now: () => now,
    createHandle: () => "reference_c23e4567-e89b-12d3-a456-426614174000"
  });
  const receipt = await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService,
    client: { async uploadFileReferences() {
      uploadCalls += 1;
      return [{ file_id: "private_provider_id", url: "https://r2.syntx.ai/private/owned.png" }];
    } },
    contract: {
      schema_hash: registry.contracts[0]!.schema_hash,
      catalog_version: referenceStoreCatalogVersion(registry),
      model_id: MODEL_ID,
      model_type: model.upstream_id,
      operation_id: "generate-video",
      modality: "video",
      variant_id: VARIANT_ID
    },
    filename: "owned.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  });
  const common = {
    candidate_status: "needs_wire_contract" as const,
    registry, catalog, store, binding: BINDING, attemptId: ATTEMPT, linkService,
    variant_id: VARIANT_ID,
    reference_handle: receipt.reference_handle,
    parameters: {
      prompt: "Safe fixture.", aspect_ratio: "16:9", resolution: "720P", video_duration: 5,
      prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false
    }
  };
  status = "REVOKED";
  await assert.rejects(prepareOwnerReferenceRequest(common), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE" &&
    !error.message.includes("r2.syntx.ai") && !error.message.includes("private_provider_id") &&
    !error.message.includes(receipt.reference_handle));

  status = "LINKED";
  now += 15 * 60_000;
  await assert.rejects(prepareOwnerReferenceRequest(common), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE" &&
    !error.message.includes("r2.syntx.ai") && !error.message.includes("private_provider_id"));
  assert.equal(uploadCalls, 1, "prepare never retries or re-uploads");
  store.close();
});

test("prepared parameters are snapshotted before awaiting the private resolver", async () => {
  const { catalog, registry } = loadCurrentFixture();
  let finishResolve!: (value: { file_urls: readonly string[] }) => void;
  let markResolveCalled!: () => void;
  const resolverCalled = new Promise<void>((resolve) => { markResolveCalled = resolve; });
  const pendingResolution = new Promise<{ file_urls: readonly string[] }>((resolve) => { finishResolve = resolve; });
  const store = { async resolveImageReferences() { markResolveCalled(); return pendingResolution; } } as unknown as OwnerMediaReferenceStore;
  const parameters = {
    prompt: "Snapshot this prompt.", aspect_ratio: "16:9", resolution: "720P", video_duration: 5,
    prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false
  };
  const preparing = prepareOwnerReferenceRequest({
    candidate_status: "unreviewed", registry, catalog, store, binding: BINDING, attemptId: ATTEMPT,
    linkService: linkedService(), variant_id: VARIANT_ID,
    reference_handle: "reference_d23e4567-e89b-12d3-a456-426614174000",
    parameters
  });
  await resolverCalled;
  parameters.prompt = "mutated prompt";
  parameters.resolution = "1080P";
  finishResolve({ file_urls: ["https://r2.syntx.ai/snapshotted.png"] });
  const result = await preparing;
  assert.equal(result.request.prompt, "Snapshot this prompt.");
  assert.equal(result.request.settings.resolution, "720P");
  assert.equal(Array.isArray(result.request.settings.file_urls), true);
  assert.equal((result.request.settings.file_urls as readonly unknown[])[0], "https://r2.syntx.ai/snapshotted.png");
});
