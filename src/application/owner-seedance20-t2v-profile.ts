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

export const OWNER_SEEDANCE20_T2V_CONTRACT_VARIANT_ID = "seedance-2.0-t2v-source-reviewed-no-reference-mini" as const;
export const OWNER_SEEDANCE20_T2V_CONTRACT_REGISTRY_VERSION = "sha256-e171367181bfcd0193d417248dc6265984ea200d1bf6d44a034e5e84db0717e6.json" as const;
export const OWNER_SEEDANCE20_T2V_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_SEEDANCE20_T2V_SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

const MODEL_ID = "seedance-2.0" as const;
const AI_NAME = "seedance" as const;
const OPERATION_ID = "generate-video" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const CURRENT_PUBLIC_MODELS_RESPONSE_SHA256 = "sha256:323b585b24a0637466c3729553e14d506aa9427418977db6f201819d83b8a083" as const;
const SOURCE_BUILD_ID = "1791904852" as const;
const SETTINGS_INVENTORY_BUILD_ID = "1791811899" as const;
const FORM_BYTES = 17_164;
const FORM_SHA256 = "sha256:202056a41201e283af786383beb50d8fdb039eaad4859e26b7ad05c85d852df7" as const;
const CHAT_ROUTE_BYTES = 12_849;
const CHAT_ROUTE_SHA256 = "sha256:a78d9b5f3af2adbb567dd505ef4b301f7e5e383438f8f09ff42e9418a6a1670d" as const;
const SETTINGS_HELPER_BYTES = 4_155;
const SETTINGS_HELPER_SHA256 = "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" as const;
const COST_HELPER_BYTES = 1_660;
const COST_HELPER_SHA256 = "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const;
const VIDEO_SENDER_BYTES = 8_689;
const VIDEO_SENDER_SHA256 = "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e" as const;
const PROMPT_LOCAL_UTF16_LIMIT = 5_000;
const PUBLIC_COST_FIELDS = Object.freeze(["video_duration", "duration", "mode", "size", "resolution"] as const);
const COST_FIELDS = Object.freeze(["duration", "mode", "resolution", "size", "video_duration"] as const);
const COST_PARAMETER_BINDINGS = Object.freeze({
  video_duration: Object.freeze({ kind: "parameter", parameter: "video_duration" }),
  duration: Object.freeze({ kind: "literal", value: 0 }),
  mode: Object.freeze({ kind: "literal", value: "mini" }),
  size: Object.freeze({ kind: "parameter", parameter: "aspect_ratio" }),
  resolution: Object.freeze({ kind: "parameter", parameter: "resolution" })
});
const RESOLUTIONS = Object.freeze(["480p", "720p"] as const);
const RATIOS = Object.freeze(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const);
const authenticProfiles = new WeakSet<object>();
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export interface OwnerSeedance20T2vSourceContract {
  readonly status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_MINI_VARIANT";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_SEEDANCE20_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    current_public_models_response_sha256: typeof CURRENT_PUBLIC_MODELS_RESPONSE_SHA256;
    settings_inventory_version: typeof OWNER_SEEDANCE20_T2V_SETTINGS_INVENTORY_VERSION;
    source_build_id: typeof SOURCE_BUILD_ID;
    settings_inventory_build_id: typeof SETTINGS_INVENTORY_BUILD_ID;
    app_router_module: "app.js";
    app_router_bytes: 2_434_959;
    app_router_sha256: "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1";
    settings_registry_module: "Settings2.js";
    settings_registry_bytes: 37_164;
    settings_registry_sha256: "sha256:edd1cb3411aca5877ab36153ae0e7bd236c53b531dcb4d98a2bc962f24017d10";
    form_module: "seedance2.js";
    form_bytes: typeof FORM_BYTES;
    form_sha256: typeof FORM_SHA256;
    chat_route_module: "index7.js";
    chat_route_bytes: typeof CHAT_ROUTE_BYTES;
    chat_route_sha256: typeof CHAT_ROUTE_SHA256;
    settings_helper_module: "settings3.js";
    settings_helper_bytes: typeof SETTINGS_HELPER_BYTES;
    settings_helper_sha256: typeof SETTINGS_HELPER_SHA256;
    cost_helper_module: "cost2.js";
    cost_helper_bytes: typeof COST_HELPER_BYTES;
    cost_helper_sha256: typeof COST_HELPER_SHA256;
    sender_module: "video.js";
    sender_bytes: typeof VIDEO_SENDER_BYTES;
    sender_sha256: typeof VIDEO_SENDER_SHA256;
  }>;
  readonly identity: Readonly<{ model_id: typeof MODEL_ID; ai_name: typeof AI_NAME; model_type: typeof MODEL_ID; operation_id: typeof OPERATION_ID }>;
  readonly controls: Readonly<{
    mode: Readonly<{ value: "mini"; source_choice: true }>;
    resolution: Readonly<{ values: typeof RESOLUTIONS; effective_default: "UNKNOWN" }>;
    aspect_ratio: Readonly<{ values: typeof RATIOS; effective_default: "UNKNOWN" }>;
    video_duration: Readonly<{ min: 4; max: 15; unit: "INTEGER_SECONDS"; effective_default: "UNKNOWN" }>;
    generate_audio: Readonly<{ values: readonly [false, true]; effective_default: "UNKNOWN" }>;
    prompt: Readonly<{ source_max_length: 35_000; local_bound_utf16: typeof PROMPT_LOCAL_UTF16_LIMIT; local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" }>;
  }>;
  readonly excluded_controls: Readonly<{
    camera_fixed: Readonly<{
      visibility: "HIDDEN_FOR_SEEDANCE_2_0";
      visible_condition: "model_type===seedance-1.5-pro";
      model_selection_value: "UNDEFINED";
    }>;
  }>;
  readonly wire_observation: Readonly<{
    source: "CURRENT_SETTINGS2_TO_INDEX7_TO_VIDEO_SENDER_STATIC_JOIN";
    method: "POST";
    path: "/api/v1/video/generate";
    query: Readonly<{ ai_name: typeof AI_NAME }>;
    settings_keys: readonly ["model_type", "mode", "resolution", "aspect_ratio", "video_duration", "generate_audio", "file_urls"];
    no_references: true;
    custom_settings_payload_used: false;
  }>;
  readonly cost_projection: Readonly<{
    caller_keys: typeof COST_FIELDS;
    public_row_keys: typeof PUBLIC_COST_FIELDS;
    bindings: typeof COST_PARAMETER_BINDINGS;
    transport_owned_keys: readonly ["ai_name", "model_type"];
    current_public_model_row: true;
    value_mapping: "SOURCE_PINNED_SETTINGS_GETTERS_AND_LITERAL_NO_REFERENCE_DURATION";
    amount_or_quote: "UNPROVEN";
  }>;
  readonly defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerSeedance20T2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerSeedance20T2vSourceContract> {}

const SOURCE: OwnerSeedance20T2vSourceContract = Object.freeze({
  status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_MINI_VARIANT",
  source_pins: Object.freeze({
    public_catalog_version: OWNER_SEEDANCE20_T2V_PUBLIC_CATALOG_VERSION,
    public_models_sha256: PUBLIC_MODELS_SHA256,
    current_public_models_response_sha256: CURRENT_PUBLIC_MODELS_RESPONSE_SHA256,
    settings_inventory_version: OWNER_SEEDANCE20_T2V_SETTINGS_INVENTORY_VERSION,
    source_build_id: SOURCE_BUILD_ID,
    settings_inventory_build_id: SETTINGS_INVENTORY_BUILD_ID,
    app_router_module: "app.js",
    app_router_bytes: 2_434_959,
    app_router_sha256: "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1",
    settings_registry_module: "Settings2.js",
    settings_registry_bytes: 37_164,
    settings_registry_sha256: "sha256:edd1cb3411aca5877ab36153ae0e7bd236c53b531dcb4d98a2bc962f24017d10",
    form_module: "seedance2.js",
    form_bytes: FORM_BYTES,
    form_sha256: FORM_SHA256,
    chat_route_module: "index7.js",
    chat_route_bytes: CHAT_ROUTE_BYTES,
    chat_route_sha256: CHAT_ROUTE_SHA256,
    settings_helper_module: "settings3.js",
    settings_helper_bytes: SETTINGS_HELPER_BYTES,
    settings_helper_sha256: SETTINGS_HELPER_SHA256,
    cost_helper_module: "cost2.js",
    cost_helper_bytes: COST_HELPER_BYTES,
    cost_helper_sha256: COST_HELPER_SHA256,
    sender_module: "video.js",
    sender_bytes: VIDEO_SENDER_BYTES,
    sender_sha256: VIDEO_SENDER_SHA256
  }),
  identity: Object.freeze({ model_id: MODEL_ID, ai_name: AI_NAME, model_type: MODEL_ID, operation_id: OPERATION_ID }),
  controls: Object.freeze({
    mode: Object.freeze({ value: "mini", source_choice: true as const }),
    resolution: Object.freeze({ values: RESOLUTIONS, effective_default: "UNKNOWN" as const }),
    aspect_ratio: Object.freeze({ values: RATIOS, effective_default: "UNKNOWN" as const }),
    video_duration: Object.freeze({ min: 4 as const, max: 15 as const, unit: "INTEGER_SECONDS" as const, effective_default: "UNKNOWN" as const }),
    generate_audio: Object.freeze({ values: Object.freeze([false, true] as const), effective_default: "UNKNOWN" as const }),
    prompt: Object.freeze({ source_max_length: 35_000 as const, local_bound_utf16: PROMPT_LOCAL_UTF16_LIMIT, local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" as const })
  }),
  excluded_controls: Object.freeze({
    camera_fixed: Object.freeze({
      visibility: "HIDDEN_FOR_SEEDANCE_2_0" as const,
      visible_condition: "model_type===seedance-1.5-pro" as const,
      model_selection_value: "UNDEFINED" as const
    })
  }),
  wire_observation: Object.freeze({
    source: "CURRENT_SETTINGS2_TO_INDEX7_TO_VIDEO_SENDER_STATIC_JOIN" as const,
    method: "POST" as const,
    path: "/api/v1/video/generate" as const,
    query: Object.freeze({ ai_name: AI_NAME }),
    settings_keys: Object.freeze(["model_type", "mode", "resolution", "aspect_ratio", "video_duration", "generate_audio", "file_urls"] as const),
    no_references: true as const,
    custom_settings_payload_used: false as const
  }),
  cost_projection: Object.freeze({
    caller_keys: COST_FIELDS,
    public_row_keys: PUBLIC_COST_FIELDS,
    bindings: COST_PARAMETER_BINDINGS,
    transport_owned_keys: Object.freeze(["ai_name", "model_type"] as const),
    current_public_model_row: true as const,
    value_mapping: "SOURCE_PINNED_SETTINGS_GETTERS_AND_LITERAL_NO_REFERENCE_DURATION" as const,
    amount_or_quote: "UNPROVEN" as const
  }),
  defaults: "UNKNOWN",
  runtime_usable: false,
  dispatch_allowed: false,
  backend_acceptance: "UNPROVEN"
});

export function buildOwnerSeedance20T2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractV2Input {
  assertSourceBinding(catalog, inventory);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("OWNER_SEEDANCE20_T2V_SOURCE_UNAVAILABLE");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  return {
    variant_id: OWNER_SEEDANCE20_T2V_CONTRACT_VARIANT_ID,
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
        { kind: "public_catalog", reference: `Seedance 2.0 exact model binding in B066 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "manual_review", reference: `Anonymous current public models GET; response sha256=${CURRENT_PUBLIC_MODELS_RESPONSE_SHA256}; cost2.js build ${SOURCE_BUILD_ID} projects the active row's five cost keys. seedance2.js calls cost2.u with duration=0 when no input video and size=settings.aspect_ratio; mode is the mini literal.` },
        { kind: "frontend_static", reference: `seedance2.js build ${SOURCE_BUILD_ID}; source-pinned no-reference mini T2V branch`, sha256: FORM_SHA256 },
        { kind: "frontend_static", reference: `Settings2.js build ${SOURCE_BUILD_ID}; source importer for seedance2.js`, sha256: "sha256:edd1cb3411aca5877ab36153ae0e7bd236c53b531dcb4d98a2bc962f24017d10" },
        { kind: "frontend_static", reference: `app.js build ${SOURCE_BUILD_ID}; current video-ai route component import`, sha256: "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1" },
        { kind: "frontend_static", reference: `index7.js build ${SOURCE_BUILD_ID}; video-ai settings selection and send callback`, sha256: CHAT_ROUTE_SHA256 },
        { kind: "frontend_static", reference: `settings3.js build ${SOURCE_BUILD_ID}; current settings-helper join`, sha256: SETTINGS_HELPER_SHA256 },
        { kind: "frontend_static", reference: `cost2.js build ${SOURCE_BUILD_ID}; current public row get_cost_params projection keys only`, sha256: COST_HELPER_SHA256 },
        { kind: "frontend_static", reference: `video.js build ${SOURCE_BUILD_ID}; generic video sender route and normalized empty file_urls`, sha256: VIDEO_SENDER_SHA256 },
        { kind: "manual_review", reference: "Mode mini is the source-closed no-reference Seedance 2.0 variant; resolutions 480p/720p, ratios 21:9/16:9/4:3/1:1/3:4/9:16, durations 4..15, and explicit generate_audio toggle are source choices. camera_fixed is hidden outside seedance-1.5-pro and resets to undefined for seedance-2.0. Defaults and provider acceptance remain unproven." }
      ],
      reviewed_at: reviewedAt
    },
    cost_parameter_bindings: COST_PARAMETER_BINDINGS,
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "resolution", "aspect_ratio", "video_duration", "generate_audio", "mode"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: PROMPT_LOCAL_UTF16_LIMIT },
        resolution: { type: "string", enum: [...RESOLUTIONS] },
        aspect_ratio: { type: "string", enum: [...RATIOS] },
        video_duration: { type: "integer", minimum: 4, maximum: 15 },
        generate_audio: { type: "boolean" },
        mode: { type: "string", enum: ["mini"] }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-video",
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: {
        resolution: "resolution",
        aspect_ratio: "aspect_ratio",
        video_duration: "video_duration",
        generate_audio: "generate_audio",
        mode: "mode"
      },
      fixed_settings: { file_urls: [] },
      media_reference_fields: {}
    },
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: 6, max_value_depth: 1, max_serialized_bytes: 131_072, max_normalized_nodes: 20_000 }
  };
}

export function createOwnerSeedance20T2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [buildOwnerSeedance20T2vGenerationContractInput(catalog, inventory, reviewedAt)]
  });
}

export async function archiveOwnerSeedance20T2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string,
  catalogDirectory?: string
) {
  return archiveGenerationContractRegistryV2(createOwnerSeedance20T2vGenerationRegistry(catalog, inventory, reviewedAt), catalogDirectory);
}

export function createOwnerSeedance20T2vProfile(catalogDirectory?: string): OwnerSeedance20T2vProfile {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_SEEDANCE20_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_SEEDANCE20_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  assertSourceBinding(catalog, inventory);
  const registry = loadGenerationContractRegistryV2(OWNER_SEEDANCE20_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const reviewedAt = registry.contracts[0]?.provenance.reviewed_at ?? "";
  const expected = createOwnerSeedance20T2vGenerationRegistry(catalog, inventory, reviewedAt);
  if (registry.contracts.length !== 1 || !isDeepStrictEqual(registry, expected)) throw new Error("OWNER_SEEDANCE20_T2V_PROFILE_MISMATCH");
  const profile: OwnerSeedance20T2vProfile = Object.freeze({
    catalog,
    registry,
    registryVersion: OWNER_SEEDANCE20_T2V_CONTRACT_REGISTRY_VERSION,
    source: SOURCE,
    modelId: MODEL_ID,
    aiName: AI_NAME,
    modelType: MODEL_ID,
    operationId: OPERATION_ID,
    variantId: OWNER_SEEDANCE20_T2V_CONTRACT_VARIANT_ID,
    costParameterFields: COST_FIELDS,
    normalizeGenerationInput,
    buildContractInput: (value: string) => buildOwnerSeedance20T2vGenerationContractInput(catalog, inventory, value)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerSeedance20T2vProfile(value: unknown): value is OwnerSeedance20T2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function assertSourceBinding(catalog: DiscoveryCatalogRepository, inventory: MaplessSettingsInventory): void {
  const model = catalog.getModel(MODEL_ID);
  const modelRow = inventory.models.find((entry) => entry.model_id === MODEL_ID);
  const form = inventory.forms.find((entry) => entry.form_id === "seedance");
  const settings = model.settings;
  if (catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 || model.active !== true || model.ai_name !== AI_NAME ||
      model.upstream_id !== MODEL_ID || !model.operations.some((entry) => entry.id === OPERATION_ID && entry.output_modality === "video") ||
      !isDeepStrictEqual(settings?.get_cost_params, PUBLIC_COST_FIELDS) || settings?.max_prompt_length !== 35_000 ||
      inventory.public_catalog.version !== OWNER_SEEDANCE20_T2V_PUBLIC_CATALOG_VERSION ||
      inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 || inventory.build.id !== SETTINGS_INVENTORY_BUILD_ID ||
      !modelRow || modelRow.active !== true || modelRow.ai_name !== AI_NAME || modelRow.form_id !== "seedance" ||
      modelRow.form_binding_status !== "STRUCTURAL_MATCH" || modelRow.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
      modelRow.defaults_status !== "UNKNOWN" || modelRow.runtime_usable !== false ||
      !isDeepStrictEqual(modelRow.settings?.get_cost_params, PUBLIC_COST_FIELDS) ||
      !isDeepStrictEqual(modelRow.model_value_settings_keys, ["aspect_ratio", "camera_fixed", "generate_audio", "mode", "model_type", "resolution", "video_duration"]) ||
      !isDeepStrictEqual(modelRow.payload_field_keys, ["camera_fixed", "mode", "model_type"]) ||
      !form || form.module_name !== "seedance2.js" || form.javascript.parse_diagnostics !== 0) {
    throw new Error("OWNER_SEEDANCE20_T2V_SOURCE_UNAVAILABLE");
  }
}

function normalizeGenerationInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  const expectedKeys = ["attemptId", "prompt", "resolution", "aspect_ratio", "video_duration", "generate_audio"];
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\0") !== expectedKeys.sort().join("\0")) throw new Error("INVALID_REQUEST");
  const request = value as Record<string, unknown>;
  if (typeof request.attemptId !== "string" || !ATTEMPT_PATTERN.test(request.attemptId) ||
      typeof request.prompt !== "string" || request.prompt.trim().length === 0 || request.prompt.length > PROMPT_LOCAL_UTF16_LIMIT ||
      PROMPT_CONTROL.test(request.prompt) || !isWellFormedUnicode(request.prompt) ||
      (request.resolution !== "480p" && request.resolution !== "720p") ||
      typeof request.aspect_ratio !== "string" || !RATIOS.includes(request.aspect_ratio as typeof RATIOS[number]) ||
      typeof request.video_duration !== "number" || !Number.isInteger(request.video_duration) || request.video_duration < 4 || request.video_duration > 15 ||
      typeof request.generate_audio !== "boolean") throw new Error("INVALID_REQUEST");
  const parameters = Object.freeze({
    prompt: request.prompt,
    resolution: request.resolution,
    aspect_ratio: request.aspect_ratio,
    video_duration: request.video_duration,
    generate_audio: request.generate_audio,
    mode: "mini"
  });
  return Object.freeze({ attemptId: request.attemptId, prompt: request.prompt, parameters,
    semanticIntent: Object.freeze({ ...parameters }) });
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
