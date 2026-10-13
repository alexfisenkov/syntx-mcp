import { isDeepStrictEqual, types } from "node:util";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import {
  archiveGenerationContractRegistryV2,
  loadGenerationContractRegistryV2
} from "../catalog/generation-contract-history-v2.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import {
  createGenerationContractRegistryV2,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";

export const OWNER_HAILUO01_T2V_CONTRACT_VARIANT_ID = "hailuo-01-t2v-source-reviewed-no-reference-720p-6s" as const;
export const OWNER_HAILUO01_T2V_CONTRACT_REGISTRY_VERSION = "sha256-ba1a31c751c12dbf24fb7b1e8ecdd7eb9c9eb9cbd0162448b67f9ec6cd1b224b.json" as const;
export const OWNER_HAILUO01_T2V_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_HAILUO01_T2V_SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

const MODEL_ID = "hailuo-01" as const;
const AI_NAME = "hailuo-minimax" as const;
const OPERATION_ID = "generate-video" as const;
const FORM_SHA256 = "sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c" as const;
const VIDEO_SENDER_SHA256 = "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const PROMPT_LOCAL_UTF16_LIMIT = 5_000;
const authenticProfiles = new WeakSet<object>();

export interface OwnerHailuo01T2vSourceContract {
  readonly status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_OBSERVATION";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_HAILUO01_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    settings_inventory_version: typeof OWNER_HAILUO01_T2V_SETTINGS_INVENTORY_VERSION;
    build_id: "1791811899";
    form_module: "hailuo-minimax.js";
    form_bytes: 13_501;
    form_sha256: typeof FORM_SHA256;
    sender_module: "video.js";
    sender_bytes: 8_689;
    sender_sha256: typeof VIDEO_SENDER_SHA256;
  }>;
  readonly identity: Readonly<{ model_id: typeof MODEL_ID; ai_name: typeof AI_NAME; model_type: typeof MODEL_ID; operation_id: typeof OPERATION_ID }>;
  readonly controls: Readonly<{
    resolution: Readonly<{ values: readonly ["720p"]; effective_default: "UNKNOWN" }>;
    video_duration: Readonly<{ values: readonly [6]; unit: "INTEGER_SECONDS"; effective_default: "UNKNOWN" }>;
    prompt: Readonly<{ source_max_length: "UNKNOWN"; local_bound: 5_000; local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" }>;
  }>;
  readonly wire_observation: Readonly<{
    source: "CURRENT_CHROME_UI_OWNER_OBSERVATION";
    method: "POST";
    path: "/api/v1/video/generate";
    query: Readonly<{ ai_name: typeof AI_NAME }>;
    settings_keys: readonly ["model_type", "video_duration", "resolution", "file_urls"];
    no_references: true;
    no_presets: true;
  }>;
  readonly cost_projection: Readonly<{
    caller_keys: readonly ["resolution", "video_duration"];
    transport_owned_keys: readonly ["model_type"];
    value_mapping: "UI_OBSERVED_RUNTIME_REQUEST";
    amount_or_quote: "UNPROVEN";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerReviewedNoReferenceT2vNormalizedRequest {
  readonly attemptId: string;
  readonly prompt: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly semanticIntent: Readonly<Record<string, string | number | boolean>>;
}

/** Sealed profile port consumed by the reusable no-reference T2V engine. */
export interface OwnerReviewedNoReferenceT2vProfile<TSource extends object = object> {
  readonly catalog: DiscoveryCatalogRepository;
  readonly registry: GenerationContractRegistryV2;
  readonly registryVersion: string;
  readonly source: TSource;
  readonly modelId: string;
  readonly aiName: string;
  readonly modelType: string;
  readonly operationId: "generate-video";
  readonly variantId: string;
  readonly costParameterFields: readonly string[];
  normalizeGenerationInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest;
  buildContractInput(reviewedAt: string): GenerationContractV2Input;
}

export interface OwnerHailuo01T2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerHailuo01T2vSourceContract> {
}

const SOURCE: OwnerHailuo01T2vSourceContract = Object.freeze({
  status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_OBSERVATION",
  source_pins: Object.freeze({
    public_catalog_version: OWNER_HAILUO01_T2V_PUBLIC_CATALOG_VERSION,
    public_models_sha256: PUBLIC_MODELS_SHA256,
    settings_inventory_version: OWNER_HAILUO01_T2V_SETTINGS_INVENTORY_VERSION,
    build_id: "1791811899",
    form_module: "hailuo-minimax.js",
    form_bytes: 13_501,
    form_sha256: FORM_SHA256,
    sender_module: "video.js",
    sender_bytes: 8_689,
    sender_sha256: VIDEO_SENDER_SHA256
  }),
  identity: Object.freeze({ model_id: MODEL_ID, ai_name: AI_NAME, model_type: MODEL_ID, operation_id: OPERATION_ID }),
  controls: Object.freeze({
    resolution: Object.freeze({ values: Object.freeze(["720p"] as const), effective_default: "UNKNOWN" as const }),
    video_duration: Object.freeze({ values: Object.freeze([6] as const), unit: "INTEGER_SECONDS" as const, effective_default: "UNKNOWN" as const }),
    prompt: Object.freeze({ source_max_length: "UNKNOWN" as const, local_bound: PROMPT_LOCAL_UTF16_LIMIT, local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" as const })
  }),
  wire_observation: Object.freeze({
    source: "CURRENT_CHROME_UI_OWNER_OBSERVATION" as const,
    method: "POST" as const,
    path: "/api/v1/video/generate" as const,
    query: Object.freeze({ ai_name: AI_NAME }),
    settings_keys: Object.freeze(["model_type", "video_duration", "resolution", "file_urls"] as const),
    no_references: true as const,
    no_presets: true as const
  }),
  cost_projection: Object.freeze({
    caller_keys: Object.freeze(["resolution", "video_duration"] as const),
    transport_owned_keys: Object.freeze(["model_type"] as const),
    value_mapping: "UI_OBSERVED_RUNTIME_REQUEST" as const,
    amount_or_quote: "UNPROVEN" as const
  }),
  effective_defaults: "UNKNOWN",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

/** Creates the one reviewed source contract; no alternate model or selector is accepted. */
export function buildOwnerHailuo01T2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  reviewedAt: string
): GenerationContractV2Input {
  const model = catalog.getModel(MODEL_ID);
  if (!Number.isFinite(Date.parse(reviewedAt)) || model.active !== true || model.ai_name !== AI_NAME ||
      model.upstream_id !== MODEL_ID || !model.operations.some((operation) => operation.id === OPERATION_ID && operation.output_modality === "video") ||
      catalog.source_hashes.models !== PUBLIC_MODELS_SHA256) throw new Error("OWNER_HAILUO01_T2V_SOURCE_UNAVAILABLE");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  return {
    variant_id: OWNER_HAILUO01_T2V_CONTRACT_VARIANT_ID,
    model_id: MODEL_ID,
    operation_id: OPERATION_ID,
    modality: "video",
    route: "video",
    ai_name: AI_NAME,
    model_type: MODEL_ID,
    status: "reviewed",
    provenance: {
      settings_source_sha256: FORM_SHA256,
      references: [
        { kind: "public_catalog", reference: `Hailuo-01 model in pinned B066 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "frontend_static", reference: "hailuo-minimax.js build 1791811899; pinned Hailuo form source", sha256: FORM_SHA256 },
        { kind: "frontend_static", reference: "video.js build 1791811899; generic video sender shape", sha256: VIDEO_SENDER_SHA256 },
        { kind: "manual_review", reference: "One exact UI-observed Hailuo-01 no-reference request; controls and body do not establish backend acceptance or output duration." }
      ],
      reviewed_at: reviewedAt
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "resolution", "video_duration"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: PROMPT_LOCAL_UTF16_LIMIT },
        resolution: { type: "string", enum: ["720p"] },
        video_duration: { type: "integer", enum: [6] }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: OPERATION_ID,
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: { resolution: "resolution", video_duration: "video_duration" },
      fixed_settings: { file_urls: [] },
      media_reference_fields: {}
    },
    output: { decoder_profile: "hailuo-01-video-v1", mime_types: ["video/mp4"] },
    limits: { max_parameters: 3, max_value_depth: 1, max_serialized_bytes: 32_768, max_normalized_nodes: 16 }
  };
}

export function createOwnerHailuo01T2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  reviewedAt: string
): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [buildOwnerHailuo01T2vGenerationContractInput(catalog, reviewedAt)]
  });
}

export async function archiveOwnerHailuo01T2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  reviewedAt: string,
  catalogDirectory?: string
) {
  return archiveGenerationContractRegistryV2(createOwnerHailuo01T2vGenerationRegistry(catalog, reviewedAt), catalogDirectory);
}

export function createOwnerHailuo01T2vProfile(catalogDirectory?: string): OwnerHailuo01T2vProfile {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_HAILUO01_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const registry = loadGenerationContractRegistryV2(OWNER_HAILUO01_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const expected = createOwnerHailuo01T2vGenerationRegistry(catalog,
    registry.contracts[0]?.provenance.reviewed_at ?? "");
  if (!isDeepStrictEqual(registry, expected) || registry.contracts.length !== 1) {
    throw new Error("OWNER_HAILUO01_T2V_PROFILE_MISMATCH");
  }
  const profile: OwnerHailuo01T2vProfile = Object.freeze({
    catalog, registry, registryVersion: OWNER_HAILUO01_T2V_CONTRACT_REGISTRY_VERSION, source: SOURCE,
    modelId: MODEL_ID, aiName: AI_NAME, modelType: MODEL_ID, operationId: OPERATION_ID,
    variantId: OWNER_HAILUO01_T2V_CONTRACT_VARIANT_ID,
    costParameterFields: Object.freeze(["resolution", "video_duration"]),
    normalizeGenerationInput: normalizeOwnerHailuo01T2vInput,
    buildContractInput: (reviewedAt: string) => buildOwnerHailuo01T2vGenerationContractInput(catalog, reviewedAt)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerHailuo01T2vProfile(value: unknown): value is OwnerHailuo01T2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function normalizeOwnerHailuo01T2vInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
  const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
      Reflect.ownKeys(value).some((key) => typeof key !== "string" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) ||
      Object.keys(value).sort().join("\0") !== ["attemptId", "prompt", "resolution", "video_duration"].sort().join("\0")) {
    throw new Error("INVALID_REQUEST");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.attemptId !== "string" || !ATTEMPT_PATTERN.test(request.attemptId) ||
      typeof request.prompt !== "string" || request.prompt.trim().length === 0 || request.prompt.length > PROMPT_LOCAL_UTF16_LIMIT ||
      PROMPT_CONTROL.test(request.prompt) || request.resolution !== "720p" || request.video_duration !== 6) {
    throw new Error("INVALID_REQUEST");
  }
  const parameters = Object.freeze({ prompt: request.prompt, resolution: "720p", video_duration: 6 });
  return Object.freeze({ attemptId: request.attemptId, prompt: request.prompt, parameters,
    semanticIntent: Object.freeze({ prompt: request.prompt, resolution: "720p", video_duration: 6 }) });
}
