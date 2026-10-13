import { isDeepStrictEqual, types } from "node:util";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import {
  archiveGenerationContractRegistryV2,
  loadGenerationContractRegistryV2
} from "../catalog/generation-contract-history-v2.js";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import {
  createGenerationContractRegistryV2,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";
import {
  OWNER_HAILUO01_T2V_PUBLIC_CATALOG_VERSION,
  OWNER_HAILUO01_T2V_SETTINGS_INVENTORY_VERSION,
  type OwnerReviewedNoReferenceT2vNormalizedRequest,
  type OwnerReviewedNoReferenceT2vProfile
} from "./owner-hailuo01-t2v-profile.js";

export const OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID = "hailuo-2.3-t2v-source-reviewed-no-reference-768p-6-10-1080p-6s" as const;
export const OWNER_HAILUO23_T2V_CONTRACT_REGISTRY_VERSION = "sha256-0ca3bf6c8448edf63ba220fe1cedf548a7a909f0408978746d56861e648e2b83.json" as const;
export const OWNER_HAILUO23_T2V_PUBLIC_CATALOG_VERSION = OWNER_HAILUO01_T2V_PUBLIC_CATALOG_VERSION;
export const OWNER_HAILUO23_T2V_SETTINGS_INVENTORY_VERSION = OWNER_HAILUO01_T2V_SETTINGS_INVENTORY_VERSION;

const MODEL_ID = "hailuo-2.3" as const;
const AI_NAME = "hailuo-minimax" as const;
const OPERATION_ID = "generate-video" as const;
const FORM_SHA256 = "sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c" as const;
const VIDEO_SENDER_SHA256 = "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const BUILD_ID = "1791811899" as const;
const FORM_BYTES = 13_501;
const SENDER_BYTES = 8_689;
const PROMPT_LOCAL_UTF16_LIMIT = 5_000;
const authenticProfiles = new WeakSet<object>();
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export type OwnerHailuo23T2vResolution = "768p" | "1080p";
export type OwnerHailuo23T2vDuration = 6 | 10;

export interface OwnerHailuo23T2vSourceContract {
  readonly status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_SINGLE_UI_OBSERVATION";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_HAILUO23_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    settings_inventory_version: typeof OWNER_HAILUO23_T2V_SETTINGS_INVENTORY_VERSION;
    build_id: typeof BUILD_ID;
    form_module: "hailuo-minimax.js";
    form_bytes: typeof FORM_BYTES;
    form_sha256: typeof FORM_SHA256;
    sender_module: "video.js";
    sender_bytes: typeof SENDER_BYTES;
    sender_sha256: typeof VIDEO_SENDER_SHA256;
  }>;
  readonly identity: Readonly<{ model_id: typeof MODEL_ID; ai_name: typeof AI_NAME; model_type: typeof MODEL_ID; operation_id: typeof OPERATION_ID }>;
  readonly controls: Readonly<{
    resolution: Readonly<{ values: readonly ["768p", "1080p"]; effective_default: "UNKNOWN" }>;
    video_duration: Readonly<{ values: readonly [6, 10]; unit: "INTEGER_SECONDS"; effective_default: "UNKNOWN" }>;
    valid_pairs: readonly Readonly<{ resolution: OwnerHailuo23T2vResolution; video_duration: OwnerHailuo23T2vDuration }>[];
    prompt: Readonly<{ source_max_length: "UNKNOWN"; local_bound_utf16: typeof PROMPT_LOCAL_UTF16_LIMIT; local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" }>;
  }>;
  readonly wire_observation: Readonly<{
    source: "ROOT1140_CURRENT_CHROME_UI_OWNER_OBSERVATION";
    method: "POST";
    path: "/api/v1/video/generate";
    query: Readonly<{ ai_name: typeof AI_NAME }>;
    settings_keys: readonly ["model_type", "video_duration", "resolution", "file_urls"];
    no_references: true;
    no_presets: true;
    mode_field_present: false;
    gen_type_field_present: false;
    aspect_ratio_field_present: false;
  }>;
  readonly ui_observation: Readonly<{
    source: "ROOT1140_HAILUO23_UI_POST_AND_RESULT";
    provider_verified_pair: Readonly<{ resolution: "768p"; video_duration: 6 }>;
    other_pairs_status: "SOURCE_REVIEWED_NOT_PROVIDER_VERIFIED";
    output_observation: Readonly<{ container: "MP4"; video_codec: "H264"; width: 1366; height: 768; duration_seconds: 5.875; audio: false; decode_exit_code: 0 }>;
    requested_duration_is_not_output_duration_guarantee: true;
  }>;
  readonly cost_projection: Readonly<{
    caller_keys: readonly ["resolution", "video_duration"];
    transport_owned_keys: readonly ["model_type"];
    exact_ui_mapping_scope: "ONLY_768P_6S_OBSERVED";
    other_pair_mapping: "SOURCE_REVIEWED_NOT_PROVIDER_VERIFIED";
    amount_or_quote: "UNPROVEN";
  }>;
  readonly defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerHailuo23T2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerHailuo23T2vSourceContract> {}

const VALID_PAIRS: readonly Readonly<{ resolution: OwnerHailuo23T2vResolution; video_duration: OwnerHailuo23T2vDuration }>[] = Object.freeze([
  Object.freeze({ resolution: "768p", video_duration: 6 }),
  Object.freeze({ resolution: "768p", video_duration: 10 }),
  Object.freeze({ resolution: "1080p", video_duration: 6 })
]);

const SOURCE: OwnerHailuo23T2vSourceContract = Object.freeze({
  status: "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_SINGLE_UI_OBSERVATION",
  source_pins: Object.freeze({
    public_catalog_version: OWNER_HAILUO23_T2V_PUBLIC_CATALOG_VERSION,
    public_models_sha256: PUBLIC_MODELS_SHA256,
    settings_inventory_version: OWNER_HAILUO23_T2V_SETTINGS_INVENTORY_VERSION,
    build_id: BUILD_ID,
    form_module: "hailuo-minimax.js",
    form_bytes: FORM_BYTES,
    form_sha256: FORM_SHA256,
    sender_module: "video.js",
    sender_bytes: SENDER_BYTES,
    sender_sha256: VIDEO_SENDER_SHA256
  }),
  identity: Object.freeze({ model_id: MODEL_ID, ai_name: AI_NAME, model_type: MODEL_ID, operation_id: OPERATION_ID }),
  controls: Object.freeze({
    resolution: Object.freeze({ values: Object.freeze(["768p", "1080p"] as const), effective_default: "UNKNOWN" as const }),
    video_duration: Object.freeze({ values: Object.freeze([6, 10] as const), unit: "INTEGER_SECONDS" as const, effective_default: "UNKNOWN" as const }),
    valid_pairs: VALID_PAIRS,
    prompt: Object.freeze({ source_max_length: "UNKNOWN" as const, local_bound_utf16: PROMPT_LOCAL_UTF16_LIMIT, local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" as const })
  }),
  wire_observation: Object.freeze({
    source: "ROOT1140_CURRENT_CHROME_UI_OWNER_OBSERVATION" as const,
    method: "POST" as const,
    path: "/api/v1/video/generate" as const,
    query: Object.freeze({ ai_name: AI_NAME }),
    settings_keys: Object.freeze(["model_type", "video_duration", "resolution", "file_urls"] as const),
    no_references: true as const,
    no_presets: true as const,
    mode_field_present: false as const,
    gen_type_field_present: false as const,
    aspect_ratio_field_present: false as const
  }),
  ui_observation: Object.freeze({
    source: "ROOT1140_HAILUO23_UI_POST_AND_RESULT" as const,
    provider_verified_pair: Object.freeze({ resolution: "768p" as const, video_duration: 6 as const }),
    other_pairs_status: "SOURCE_REVIEWED_NOT_PROVIDER_VERIFIED" as const,
    output_observation: Object.freeze({ container: "MP4" as const, video_codec: "H264" as const, width: 1366, height: 768,
      duration_seconds: 5.875, audio: false as const, decode_exit_code: 0 as const }),
    requested_duration_is_not_output_duration_guarantee: true as const
  }),
  cost_projection: Object.freeze({
    caller_keys: Object.freeze(["resolution", "video_duration"] as const),
    transport_owned_keys: Object.freeze(["model_type"] as const),
    exact_ui_mapping_scope: "ONLY_768P_6S_OBSERVED" as const,
    other_pair_mapping: "SOURCE_REVIEWED_NOT_PROVIDER_VERIFIED" as const,
    amount_or_quote: "UNPROVEN" as const
  }),
  defaults: "UNKNOWN",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

export function buildOwnerHailuo23T2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractV2Input {
  assertSourceBinding(catalog, inventory);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("OWNER_HAILUO23_T2V_SOURCE_UNAVAILABLE");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  return {
    variant_id: OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID,
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
        { kind: "public_catalog", reference: `Hailuo 2.3 model in pinned B066 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "frontend_static", reference: `hailuo-minimax.js build ${BUILD_ID}; pinned Hailuo form source`, sha256: FORM_SHA256 },
        { kind: "frontend_static", reference: `video.js build ${BUILD_ID}; generic video sender source`, sha256: VIDEO_SENDER_SHA256 },
        { kind: "manual_review", reference: "Root1140 observed one no-reference/no-preset 768p/6 request and result; 768p/10 and 1080p/6 are static source-reviewed choices only. Backend acceptance is unproven." }
      ],
      reviewed_at: reviewedAt
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "resolution", "video_duration"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: PROMPT_LOCAL_UTF16_LIMIT },
        resolution: { type: "string", enum: ["768p", "1080p"] },
        video_duration: { type: "integer", enum: [6, 10] }
      },
      conditions: [],
      conditional_enums: [{ field: "video_duration", cases: [
        { when: { field: "resolution", equals: "768p" }, allowed_values: [6, 10] },
        { when: { field: "resolution", equals: "1080p" }, allowed_values: [6] }
      ] }]
    },
    wire: {
      dispatch_action: OPERATION_ID,
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: { video_duration: "video_duration", resolution: "resolution" },
      fixed_settings: { file_urls: [] },
      media_reference_fields: {}
    },
    output: { decoder_profile: "hailuo-23-video-v1", mime_types: ["video/mp4"] },
    limits: { max_parameters: 3, max_value_depth: 1, max_serialized_bytes: 32_768, max_normalized_nodes: 16 }
  };
}

export function createOwnerHailuo23T2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [buildOwnerHailuo23T2vGenerationContractInput(catalog, inventory, reviewedAt)]
  });
}

export async function archiveOwnerHailuo23T2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string,
  catalogDirectory?: string
) {
  return archiveGenerationContractRegistryV2(createOwnerHailuo23T2vGenerationRegistry(catalog, inventory, reviewedAt), catalogDirectory);
}

export function createOwnerHailuo23T2vProfile(catalogDirectory?: string): OwnerHailuo23T2vProfile {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_HAILUO23_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_HAILUO23_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  assertSourceBinding(catalog, inventory);
  const registry = loadGenerationContractRegistryV2(OWNER_HAILUO23_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const reviewedAt = registry.contracts[0]?.provenance.reviewed_at ?? "";
  const expected = createOwnerHailuo23T2vGenerationRegistry(catalog, inventory, reviewedAt);
  if (registry.contracts.length !== 1 || !isDeepStrictEqual(registry, expected)) throw new Error("OWNER_HAILUO23_T2V_PROFILE_MISMATCH");
  const profile: OwnerHailuo23T2vProfile = Object.freeze({
    catalog,
    registry,
    registryVersion: OWNER_HAILUO23_T2V_CONTRACT_REGISTRY_VERSION,
    source: SOURCE,
    modelId: MODEL_ID,
    aiName: AI_NAME,
    modelType: MODEL_ID,
    operationId: OPERATION_ID,
    variantId: OWNER_HAILUO23_T2V_CONTRACT_VARIANT_ID,
    costParameterFields: Object.freeze(["resolution", "video_duration"]),
    normalizeGenerationInput,
    buildContractInput: (value: string) => buildOwnerHailuo23T2vGenerationContractInput(catalog, inventory, value)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerHailuo23T2vProfile(value: unknown): value is OwnerHailuo23T2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function assertSourceBinding(catalog: DiscoveryCatalogRepository, inventory: MaplessSettingsInventory): void {
  const model = catalog.getModel(MODEL_ID);
  const modelRow = inventory.models.find((entry) => entry.model_id === MODEL_ID);
  const form = inventory.forms.find((entry) => entry.form_id === "hailuo-minimax");
  const settings = model.settings;
  const expectedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 || model.active !== true || model.ai_name !== AI_NAME ||
      model.upstream_id !== MODEL_ID || !model.operations.some((entry) => entry.id === OPERATION_ID && entry.output_modality === "video") ||
      !Array.isArray(settings?.get_cost_params) || !isDeepStrictEqual(settings.get_cost_params, ["resolution", "video_duration"]) ||
      !Array.isArray(settings?.accepted_file_types) || !isDeepStrictEqual(settings.accepted_file_types, expectedTypes) ||
      !Array.isArray(settings?.allowed_media_types) || !isDeepStrictEqual(settings.allowed_media_types, ["images"]) ||
      settings.file_count_limit !== 1 || settings.max_file_size !== 0 || settings.max_prompt_length !== 0 ||
      inventory.public_catalog.version !== OWNER_HAILUO23_T2V_PUBLIC_CATALOG_VERSION ||
      inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 || inventory.build.id !== BUILD_ID ||
      !modelRow || modelRow.active !== true || modelRow.ai_name !== AI_NAME || modelRow.form_id !== "hailuo-minimax" ||
      modelRow.form_binding_status !== "STRUCTURAL_MATCH" || modelRow.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
      modelRow.defaults_status !== "UNKNOWN" || modelRow.runtime_usable !== false ||
      !isDeepStrictEqual(modelRow.settings?.get_cost_params, ["resolution", "video_duration"]) ||
      !isDeepStrictEqual(modelRow.model_value_settings_keys, ["aspect_ratio", "mode", "model_type", "resolution", "video_duration"]) ||
      !isDeepStrictEqual(modelRow.payload_field_keys, ["mode", "model_type"]) ||
      !form || form.module_name !== "hailuo-minimax.js" || form.javascript.bytes !== FORM_BYTES ||
      form.javascript.sha256 !== FORM_SHA256 || form.javascript.parse_diagnostics !== 0) {
    throw new Error("OWNER_HAILUO23_T2V_SOURCE_UNAVAILABLE");
  }
}

function normalizeGenerationInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\0") !== ["attemptId", "prompt", "resolution", "video_duration"].sort().join("\0")) {
    throw new Error("INVALID_REQUEST");
  }
  const { attemptId, prompt, resolution, video_duration: duration } = value;
  if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId) || typeof prompt !== "string" ||
      prompt.trim().length === 0 || prompt.length > PROMPT_LOCAL_UTF16_LIMIT || PROMPT_CONTROL.test(prompt) || !isWellFormedUnicode(prompt) ||
      (resolution !== "768p" && resolution !== "1080p") || (duration !== 6 && duration !== 10) ||
      !VALID_PAIRS.some((pair) => pair.resolution === resolution && pair.video_duration === duration)) throw new Error("INVALID_REQUEST");
  const parameters = Object.freeze({ prompt, resolution, video_duration: duration });
  return Object.freeze({ attemptId, prompt, parameters,
    semanticIntent: Object.freeze({ prompt, resolution, video_duration: duration }) });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return false; }
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(descriptors).every((key) => typeof key === "string" &&
    descriptors[key]?.enumerable === true && Object.hasOwn(descriptors[key]!, "value"));
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) return false;
  }
  return true;
}
