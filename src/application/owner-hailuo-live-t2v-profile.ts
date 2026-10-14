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
import type {
  OwnerReviewedNoReferenceT2vNormalizedRequest,
  OwnerReviewedNoReferenceT2vProfile
} from "./owner-hailuo01-t2v-profile.js";

export const OWNER_HAILUO_LIVE_T2V_CONTRACT_VARIANT_ID = "hailuo-01-live-t2v-source-reviewed-no-reference-720p-6s" as const;
export const OWNER_HAILUO_LIVE_T2V_CONTRACT_REGISTRY_VERSION = "sha256-b1faf2038371752dd509b51b3097deec23f468849c21bc82722672e4050f7aca.json" as const;
export const OWNER_HAILUO_LIVE_T2V_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_HAILUO_LIVE_T2V_SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

const MODEL_ID = "hailuo-01-live" as const;
const AI_NAME = "hailuo-minimax" as const;
const OPERATION_ID = "generate-video" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const CURRENT_PUBLIC_MODELS_RESPONSE_SHA256 = "sha256:323b585b24a0637466c3729553e14d506aa9427418977db6f201819d83b8a083" as const;
const SOURCE_BUILD_ID = "1791904852" as const;
const SETTINGS_INVENTORY_BUILD_ID = "1791811899" as const;
const FORM_BYTES = 13_501;
const FORM_SHA256 = "sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c" as const;
const APP_BYTES = 2_434_959;
const APP_SHA256 = "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1" as const;
const SETTINGS_REGISTRY_BYTES = 37_164;
const SETTINGS_REGISTRY_SHA256 = "sha256:edd1cb3411aca5877ab36153ae0e7bd236c53b531dcb4d98a2bc962f24017d10" as const;
const SETTINGS_HELPER_BYTES = 4_155;
const SETTINGS_HELPER_SHA256 = "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" as const;
const COST_HELPER_BYTES = 1_660;
const COST_HELPER_SHA256 = "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const;
const COST_REQUEST_BYTES = 2_745;
const COST_REQUEST_SHA256 = "sha256:261d93d75b204703201d1d0c3cf0ce747832159ef44f818cdd44ebee27c07ada" as const;
const CHAT_ROUTE_BYTES = 12_849;
const CHAT_ROUTE_SHA256 = "sha256:a78d9b5f3af2adbb567dd505ef4b301f7e5e383438f8f09ff42e9418a6a1670d" as const;
const VIDEO_SENDER_BYTES = 8_689;
const VIDEO_SENDER_SHA256 = "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e" as const;
const PROMPT_LOCAL_UTF16_LIMIT = 5_000;
const authenticProfiles = new WeakSet<object>();
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export interface OwnerHailuoLiveT2vSourceContract {
  readonly status: "CURRENT_1791904852_SOURCE_JOIN_LIVE_NO_REFERENCE_720P_6S";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_HAILUO_LIVE_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    current_public_models_response_sha256: typeof CURRENT_PUBLIC_MODELS_RESPONSE_SHA256;
    settings_inventory_version: typeof OWNER_HAILUO_LIVE_T2V_SETTINGS_INVENTORY_VERSION;
    source_build_id: typeof SOURCE_BUILD_ID;
    settings_inventory_build_id: typeof SETTINGS_INVENTORY_BUILD_ID;
    app_router_module: "app.js";
    app_router_bytes: typeof APP_BYTES;
    app_router_sha256: typeof APP_SHA256;
    settings_registry_module: "Settings2.js";
    settings_registry_bytes: typeof SETTINGS_REGISTRY_BYTES;
    settings_registry_sha256: typeof SETTINGS_REGISTRY_SHA256;
    form_module: "hailuo-minimax.js";
    form_bytes: typeof FORM_BYTES;
    form_sha256: typeof FORM_SHA256;
    settings_helper_module: "settings3.js";
    settings_helper_bytes: typeof SETTINGS_HELPER_BYTES;
    settings_helper_sha256: typeof SETTINGS_HELPER_SHA256;
    cost_helper_module: "cost2.js";
    cost_helper_bytes: typeof COST_HELPER_BYTES;
    cost_helper_sha256: typeof COST_HELPER_SHA256;
    cost_request_module: "cost.js";
    cost_request_bytes: typeof COST_REQUEST_BYTES;
    cost_request_sha256: typeof COST_REQUEST_SHA256;
    chat_route_module: "index7.js";
    chat_route_bytes: typeof CHAT_ROUTE_BYTES;
    chat_route_sha256: typeof CHAT_ROUTE_SHA256;
    sender_module: "video.js";
    sender_bytes: typeof VIDEO_SENDER_BYTES;
    sender_sha256: typeof VIDEO_SENDER_SHA256;
  }>;
  readonly identity: Readonly<{ model_id: typeof MODEL_ID; ai_name: typeof AI_NAME; model_type: typeof MODEL_ID; operation_id: typeof OPERATION_ID }>;
  readonly controls: Readonly<{
    resolution: Readonly<{ values: readonly ["720p"]; reset_candidate: "720p"; effective_default: "UNKNOWN" }>;
    video_duration: Readonly<{ values: readonly [6]; reset_candidate: 6; unit: "INTEGER_SECONDS"; effective_default: "UNKNOWN" }>;
    prompt: Readonly<{ source_max_length: "UNKNOWN"; local_bound_utf16: typeof PROMPT_LOCAL_UTF16_LIMIT; local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" }>;
  }>;
  readonly no_reference_source: Readonly<{
    zero_file_guard_status: "NO_LIVE_VALIDATOR_REQUIRES_FILES";
    nonmatching_file_guard_cases: readonly ["hailuo-02+512p", "hailuo-3.0+frames", "hailuo-3.0+omni-references"];
    public_uploadable: true;
    public_file_count_limit: 1;
    empty_file_urls: readonly [];
  }>;
  readonly wire_observation: Readonly<{
    source: "CURRENT_VIDEO_AI_ROUTE_SETTINGS_FALLBACK_TO_VIDEO_SENDER";
    method: "POST";
    path: "/api/v1/video/generate";
    query: Readonly<{ ai_name: typeof AI_NAME }>;
    settings_keys: readonly ["model_type", "resolution", "video_duration", "file_urls"];
    no_references: true;
    custom_settings_payload_used: false;
    mode_field_present: false;
    aspect_ratio_field_present: false;
    motion_id_field_present: false;
    no_presets: true;
  }>;
  readonly cost_projection: Readonly<{
    caller_keys: readonly ["resolution", "video_duration"];
    cost2_overrides: readonly ["duration", "size", "ref_count"];
    transport_owned_keys: readonly ["ai_name", "model_type"];
    request_path: "get_model_info";
    amount_or_quote: "UNPROVEN";
  }>;
  readonly defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerHailuoLiveT2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerHailuoLiveT2vSourceContract> {}

const SOURCE_PINS: OwnerHailuoLiveT2vSourceContract["source_pins"] = Object.freeze({
  public_catalog_version: OWNER_HAILUO_LIVE_T2V_PUBLIC_CATALOG_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  current_public_models_response_sha256: CURRENT_PUBLIC_MODELS_RESPONSE_SHA256,
  settings_inventory_version: OWNER_HAILUO_LIVE_T2V_SETTINGS_INVENTORY_VERSION,
  source_build_id: SOURCE_BUILD_ID,
  settings_inventory_build_id: SETTINGS_INVENTORY_BUILD_ID,
  app_router_module: "app.js",
  app_router_bytes: APP_BYTES,
  app_router_sha256: APP_SHA256,
  settings_registry_module: "Settings2.js",
  settings_registry_bytes: SETTINGS_REGISTRY_BYTES,
  settings_registry_sha256: SETTINGS_REGISTRY_SHA256,
  form_module: "hailuo-minimax.js",
  form_bytes: FORM_BYTES,
  form_sha256: FORM_SHA256,
  settings_helper_module: "settings3.js",
  settings_helper_bytes: SETTINGS_HELPER_BYTES,
  settings_helper_sha256: SETTINGS_HELPER_SHA256,
  cost_helper_module: "cost2.js",
  cost_helper_bytes: COST_HELPER_BYTES,
  cost_helper_sha256: COST_HELPER_SHA256,
  cost_request_module: "cost.js",
  cost_request_bytes: COST_REQUEST_BYTES,
  cost_request_sha256: COST_REQUEST_SHA256,
  chat_route_module: "index7.js",
  chat_route_bytes: CHAT_ROUTE_BYTES,
  chat_route_sha256: CHAT_ROUTE_SHA256,
  sender_module: "video.js",
  sender_bytes: VIDEO_SENDER_BYTES,
  sender_sha256: VIDEO_SENDER_SHA256
});

export function buildOwnerHailuoLiveT2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractV2Input {
  assertSourceBinding(catalog, inventory);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("OWNER_HAILUO_LIVE_T2V_SOURCE_UNAVAILABLE");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  return {
    variant_id: OWNER_HAILUO_LIVE_T2V_CONTRACT_VARIANT_ID,
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
        { kind: "public_catalog", reference: `Hailuo-01 Live exact active model row in B066 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "manual_review", reference: `Current anonymous hailuo-minimax.js build ${SOURCE_BUILD_ID}; exact Live selector mapping, resolution/duration matrix, empty-file validator path, cost query and sender joins are recorded in result1262.md.` },
        { kind: "frontend_static", reference: `hailuo-minimax.js build ${SOURCE_BUILD_ID}; literal Live model selector, per-model resolution map, duration-by-resolution map and file-validator branches`, sha256: FORM_SHA256 },
        { kind: "frontend_static", reference: `Settings2.js build ${SOURCE_BUILD_ID}; current Hailuo form import registration`, sha256: SETTINGS_REGISTRY_SHA256 },
        { kind: "frontend_static", reference: `app.js and index7.js build ${SOURCE_BUILD_ID}; current video-ai route caller`, sha256: CHAT_ROUTE_SHA256 },
        { kind: "frontend_static", reference: `settings3.js and cost2.js build ${SOURCE_BUILD_ID}; model settings/cost query helpers; Live public cost keys are resolution and video_duration`, sha256: SETTINGS_HELPER_SHA256 },
        { kind: "frontend_static", reference: `video.js build ${SOURCE_BUILD_ID}; exact video/generate sender, settings shallow-copy and empty-file normalization`, sha256: VIDEO_SENDER_SHA256 },
        { kind: "manual_review", reference: "Static source contract only. Live allows image uploads but no applicable current validator requires an image; this reviewed profile explicitly sends file_urls: []. Reset values are UI candidates, not effective server defaults. No backend acceptance, amount, output or provider terminal status is claimed." }
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
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: 3, max_value_depth: 1, max_serialized_bytes: 32_768, max_normalized_nodes: 16 }
  };
}

export function createOwnerHailuoLiveT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [buildOwnerHailuoLiveT2vGenerationContractInput(catalog, inventory, reviewedAt)]
  });
}

export async function archiveOwnerHailuoLiveT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string,
  catalogDirectory?: string
) {
  return archiveGenerationContractRegistryV2(createOwnerHailuoLiveT2vGenerationRegistry(catalog, inventory, reviewedAt), catalogDirectory);
}

export function createOwnerHailuoLiveT2vProfile(catalogDirectory?: string): OwnerHailuoLiveT2vProfile {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_HAILUO_LIVE_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_HAILUO_LIVE_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  assertSourceBinding(catalog, inventory);
  const registry = loadGenerationContractRegistryV2(OWNER_HAILUO_LIVE_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const reviewedAt = registry.contracts[0]?.provenance.reviewed_at ?? "";
  const expected = createOwnerHailuoLiveT2vGenerationRegistry(catalog, inventory, reviewedAt);
  if (!isDeepStrictEqual(registry, expected) || registry.contracts.length !== 1) throw new Error("OWNER_HAILUO_LIVE_T2V_PROFILE_MISMATCH");
  const profile: OwnerHailuoLiveT2vProfile = Object.freeze({
    catalog,
    registry,
    registryVersion: OWNER_HAILUO_LIVE_T2V_CONTRACT_REGISTRY_VERSION,
    source: SOURCE,
    modelId: MODEL_ID,
    aiName: AI_NAME,
    modelType: MODEL_ID,
    operationId: OPERATION_ID,
    variantId: OWNER_HAILUO_LIVE_T2V_CONTRACT_VARIANT_ID,
    costParameterFields: Object.freeze(["resolution", "video_duration"]),
    normalizeGenerationInput,
    buildContractInput: (value: string) => buildOwnerHailuoLiveT2vGenerationContractInput(catalog, inventory, value)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerHailuoLiveT2vProfile(value: unknown): value is OwnerHailuoLiveT2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function assertSourceBinding(catalog: DiscoveryCatalogRepository, inventory: MaplessSettingsInventory): void {
  const model = catalog.getModel(MODEL_ID);
  const modelRow = inventory.models.find((entry) => entry.model_id === MODEL_ID);
  const form = inventory.forms.find((entry) => entry.form_id === "hailuo-minimax");
  if (catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 || model.active !== true || model.ai_name !== AI_NAME ||
      model.upstream_id !== MODEL_ID || !model.operations.some((operation) => operation.id === OPERATION_ID && operation.output_modality === "video") ||
      !isDeepStrictEqual(model.settings?.get_cost_params, ["resolution", "video_duration"]) ||
      inventory.public_catalog.version !== OWNER_HAILUO_LIVE_T2V_PUBLIC_CATALOG_VERSION ||
      inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 || inventory.build.id !== SETTINGS_INVENTORY_BUILD_ID ||
      !modelRow || modelRow.active !== true || modelRow.ai_name !== AI_NAME || modelRow.form_id !== "hailuo-minimax" ||
      modelRow.form_binding_status !== "STRUCTURAL_MATCH" || modelRow.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
      modelRow.defaults_status !== "UNKNOWN" || modelRow.runtime_usable !== false ||
      !isDeepStrictEqual(modelRow.settings?.get_cost_params, ["resolution", "video_duration"]) ||
      !isDeepStrictEqual(modelRow.model_value_settings_keys, ["aspect_ratio", "mode", "model_type", "resolution", "video_duration"]) ||
      !isDeepStrictEqual(modelRow.payload_field_keys, ["mode", "model_type"]) ||
      modelRow.settings?.uploadable !== true || modelRow.settings.file_count_limit !== 1 ||
      !isDeepStrictEqual(modelRow.settings.allowed_media_types, ["images"]) ||
      !form || form.module_name !== "hailuo-minimax.js" || form.javascript.parse_diagnostics !== 0) {
    throw new Error("OWNER_HAILUO_LIVE_T2V_SOURCE_UNAVAILABLE");
  }
}

function normalizeGenerationInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  const expectedKeys = ["attemptId", "prompt", "resolution", "video_duration"];
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\0") !== expectedKeys.sort().join("\0")) throw new Error("INVALID_REQUEST");
  const { attemptId, prompt, resolution, video_duration: duration } = value;
  if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId) || typeof prompt !== "string" ||
      prompt.trim().length === 0 || prompt.length > PROMPT_LOCAL_UTF16_LIMIT || PROMPT_CONTROL.test(prompt) || !isWellFormedUnicode(prompt) ||
      resolution !== "720p" || duration !== 6) throw new Error("INVALID_REQUEST");
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

const SOURCE: OwnerHailuoLiveT2vSourceContract = Object.freeze({
  status: "CURRENT_1791904852_SOURCE_JOIN_LIVE_NO_REFERENCE_720P_6S",
  source_pins: SOURCE_PINS,
  identity: Object.freeze({ model_id: MODEL_ID, ai_name: AI_NAME, model_type: MODEL_ID, operation_id: OPERATION_ID }),
  controls: Object.freeze({
    resolution: Object.freeze({ values: Object.freeze(["720p"] as const), reset_candidate: "720p" as const, effective_default: "UNKNOWN" as const }),
    video_duration: Object.freeze({ values: Object.freeze([6] as const), reset_candidate: 6 as const, unit: "INTEGER_SECONDS" as const, effective_default: "UNKNOWN" as const }),
    prompt: Object.freeze({ source_max_length: "UNKNOWN" as const, local_bound_utf16: PROMPT_LOCAL_UTF16_LIMIT, local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" as const })
  }),
  no_reference_source: Object.freeze({
    zero_file_guard_status: "NO_LIVE_VALIDATOR_REQUIRES_FILES" as const,
    nonmatching_file_guard_cases: Object.freeze(["hailuo-02+512p", "hailuo-3.0+frames", "hailuo-3.0+omni-references"] as const),
    public_uploadable: true as const,
    public_file_count_limit: 1 as const,
    empty_file_urls: Object.freeze([] as const)
  }),
  wire_observation: Object.freeze({
    source: "CURRENT_VIDEO_AI_ROUTE_SETTINGS_FALLBACK_TO_VIDEO_SENDER" as const,
    method: "POST" as const,
    path: "/api/v1/video/generate" as const,
    query: Object.freeze({ ai_name: AI_NAME }),
    settings_keys: Object.freeze(["model_type", "resolution", "video_duration", "file_urls"] as const),
    no_references: true as const,
    custom_settings_payload_used: false as const,
    mode_field_present: false as const,
    aspect_ratio_field_present: false as const,
    motion_id_field_present: false as const,
    no_presets: true as const
  }),
  cost_projection: Object.freeze({
    caller_keys: Object.freeze(["resolution", "video_duration"] as const),
    cost2_overrides: Object.freeze(["duration", "size", "ref_count"] as const),
    transport_owned_keys: Object.freeze(["ai_name", "model_type"] as const),
    request_path: "get_model_info" as const,
    amount_or_quote: "UNPROVEN" as const
  }),
  defaults: "UNKNOWN",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});
