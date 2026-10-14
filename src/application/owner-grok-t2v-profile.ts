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

export const OWNER_GROK_T2V_CONTRACT_VARIANT_ID = "grok-t2v-source-reviewed-no-reference" as const;
export const OWNER_GROK_T2V_CONTRACT_REGISTRY_VERSION = "sha256-d43d1f06c4409444b66a6c937695b1047355333d4d0ccd3869ada4fd5fd73ec1.json" as const;
export const OWNER_GROK_T2V_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_GROK_T2V_SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

export type OwnerGrokT2vResolution = "480p" | "720p";
export type OwnerGrokT2vAspectRatio = "16:9" | "9:16" | "3:2" | "2:3" | "1:1";
export type OwnerGrokT2vVideoDuration = 6 | 7 | 8 | 9 | 10;

export interface OwnerGrokT2vGenerationInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly aspect_ratio: OwnerGrokT2vAspectRatio;
  readonly resolution: OwnerGrokT2vResolution;
  readonly video_duration: OwnerGrokT2vVideoDuration;
}

const MODEL_ID = "grok_t2v" as const;
const AI_NAME = "grok_video" as const;
const OPERATION_ID = "generate-video" as const;
const SOURCE_BUILD_ID = "1791904852" as const;
const SETTINGS_INVENTORY_BUILD_ID = "1791811899" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const CURRENT_PUBLIC_MODELS_RESPONSE_SHA256 = "sha256:323b585b24a0637466c3729553e14d506aa9427418977db6f201819d83b8a083" as const;
const FORM_BYTES = 10_083;
const FORM_SHA256 = "sha256:c742501d84b369e863d3275ee8b3412fd00007a8308e6119b3b90adae3685423" as const;
const APP_BYTES = 2_434_959;
const APP_SHA256 = "sha256:6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1" as const;
const SETTINGS_REGISTRY_BYTES = 37_164;
const SETTINGS_REGISTRY_SHA256 = "sha256:edd1cb3411aca5877ab36153ae0e7bd236c53b531dcb4d98a2bc962f24017d10" as const;
const SETTINGS_HELPER_BYTES = 4_155;
const SETTINGS_HELPER_SHA256 = "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" as const;
const COST_HELPER_BYTES = 1_660;
const COST_HELPER_SHA256 = "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const;
const CHAT_ROUTE_BYTES = 12_849;
const CHAT_ROUTE_SHA256 = "sha256:a78d9b5f3af2adbb567dd505ef4b301f7e5e383438f8f09ff42e9418a6a1670d" as const;
const VIDEO_SENDER_BYTES = 8_689;
const VIDEO_SENDER_SHA256 = "sha256:5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e" as const;
const SLIDER_FORM_BYTES = 3_024;
const SLIDER_FORM_SHA256 = "sha256:406cd52179aa2ed1a526ab9ce5466d7a19f7653f7efd58bb91f7a1253fe061b6" as const;
const DURATION_HELPER_BYTES = 1_644;
const DURATION_HELPER_SHA256 = "sha256:13d991c46f54bdfc9f0dad43ae792580a21a5754a5de1d42900c81e3134c7d6b" as const;
const FORM_SOURCE_OFFSETS = Object.freeze({
  aspect_ratio_options: 2_426,
  resolution_options: 5_062,
  duration_options: 3_036,
  video_duration_slider: 8_796
} as const);
const APP_OPTION_HELPER_DEFINITION_OFFSETS = Object.freeze([107_485, 53_785, 35_173] as const);
const PROMPT_MAX_LENGTH = 5_000;
const INITIALIZER_CANDIDATES = Object.freeze({ aspect_ratio: "16:9", video_duration: 5, resolution: "480p" });
const ASPECT_RATIO_OPTIONS = Object.freeze(["16:9", "9:16", "3:2", "2:3", "1:1"] as const);
const RESOLUTION_OPTIONS = Object.freeze(["480p", "720p"] as const);
const VIDEO_DURATION_ENDPOINTS = Object.freeze([6, 10] as const);
const VIDEO_DURATION_STEP = 1 as const;
const VIDEO_DURATION_OPTIONS = Object.freeze([6, 7, 8, 9, 10] as const);
const ASPECT_RATIO_EXPANDED_MODEL_IDS = Object.freeze(["grok_15_t2v", "grok_15_i2v", "grok_15_r2v"] as const);
const REFERENCE_VALIDATOR_MODEL_IDS = Object.freeze(["grok_i2v", "grok_v2v", "grok_15_i2v"] as const);
const COST_PARAMETER_FIELDS = Object.freeze(["video_duration", "resolution"] as const);
const COST_PARAMETER_BINDINGS = Object.freeze({
  video_duration: Object.freeze({ kind: "parameter", parameter: "video_duration" }),
  resolution: Object.freeze({ kind: "parameter", parameter: "resolution" })
});
const SOURCE_SETTINGS_KEYS = Object.freeze(["model_type", "aspect_ratio", "video_duration", "resolution", "file_urls"] as const);
const INVENTORY_MODEL_VALUE_SETTINGS_KEYS = Object.freeze(["aspect_ratio", "model_type", "resolution", "video_duration"] as const);
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const authenticProfiles = new WeakSet<object>();

interface OwnerGrokT2vContractSchemaHash {
  readonly grok_t2v: string;
}

const CONTRACT_SCHEMA_HASHES: OwnerGrokT2vContractSchemaHash = Object.freeze({
  grok_t2v: "sha256:a79b1499a925c01b0bb64d8b633a3762a337b7128c98c66127a3e0a8f5e03c0d"
});

export interface OwnerGrokT2vSourceContract {
  readonly status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_GROK_T2V";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_GROK_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    current_public_models_response_sha256: typeof CURRENT_PUBLIC_MODELS_RESPONSE_SHA256;
    settings_inventory_version: typeof OWNER_GROK_T2V_SETTINGS_INVENTORY_VERSION;
    current_source_build_id: typeof SOURCE_BUILD_ID;
    settings_inventory_build_id: typeof SETTINGS_INVENTORY_BUILD_ID;
    current_form_module: "grok-video.js";
    current_form_bytes: typeof FORM_BYTES;
    current_form_sha256: typeof FORM_SHA256;
    form_source_offsets: typeof FORM_SOURCE_OFFSETS;
    app_router_module: "app.js";
    app_router_bytes: typeof APP_BYTES;
    app_router_sha256: typeof APP_SHA256;
    app_option_helper_export: "I";
    app_option_helper_definition_offsets: typeof APP_OPTION_HELPER_DEFINITION_OFFSETS;
    settings_registry_module: "Settings2.js";
    settings_registry_bytes: typeof SETTINGS_REGISTRY_BYTES;
    settings_registry_sha256: typeof SETTINGS_REGISTRY_SHA256;
    settings_helper_module: "settings3.js";
    settings_helper_bytes: typeof SETTINGS_HELPER_BYTES;
    settings_helper_sha256: typeof SETTINGS_HELPER_SHA256;
    cost_helper_module: "cost2.js";
    cost_helper_bytes: typeof COST_HELPER_BYTES;
    cost_helper_sha256: typeof COST_HELPER_SHA256;
    chat_route_module: "index7.js";
    chat_route_bytes: typeof CHAT_ROUTE_BYTES;
    chat_route_sha256: typeof CHAT_ROUTE_SHA256;
    sender_module: "video.js";
    sender_bytes: typeof VIDEO_SENDER_BYTES;
    sender_sha256: typeof VIDEO_SENDER_SHA256;
    slider_module: "SliderForm.js";
    slider_bytes: typeof SLIDER_FORM_BYTES;
    slider_sha256: typeof SLIDER_FORM_SHA256;
    duration_helper_module: "duration.js";
    duration_helper_bytes: typeof DURATION_HELPER_BYTES;
    duration_helper_sha256: typeof DURATION_HELPER_SHA256;
  }>;
  readonly identity: Readonly<{
    model_id: typeof MODEL_ID;
    ai_name: typeof AI_NAME;
    model_type: typeof MODEL_ID;
    operation_id: typeof OPERATION_ID;
  }>;
  readonly contract_schema_hash: string;
  readonly controls: Readonly<{
    aspect_ratio: Readonly<{
      values: typeof ASPECT_RATIO_OPTIONS;
      expanded_values_model_ids: typeof ASPECT_RATIO_EXPANDED_MODEL_IDS;
      effective_default: "UNKNOWN";
    }>;
    resolution: Readonly<{
      values: typeof RESOLUTION_OPTIONS;
      effective_default: "UNKNOWN";
    }>;
    video_duration: Readonly<{
      endpoints: typeof VIDEO_DURATION_ENDPOINTS;
      step: typeof VIDEO_DURATION_STEP;
      values: typeof VIDEO_DURATION_OPTIONS;
      effective_default: "UNKNOWN";
    }>;
    prompt: Readonly<{
      max_length_from_catalog: typeof PROMPT_MAX_LENGTH;
      min_length_from_source: "UNKNOWN";
      local_nonempty_policy: true;
    }>;
  }>;
  readonly initializer_candidates: Readonly<{
    values: typeof INITIALIZER_CANDIDATES;
    effective_defaults: "UNKNOWN";
    video_duration_is_within_exposed_slider_range: false;
  }>;
  readonly no_reference_source: Readonly<{
    form_id: "grok-video";
    public_file_count_limit: 0;
    accepted_file_types: readonly [];
    allowed_media_types: readonly [];
    form_validator_present: false;
    reference_validator_model_ids: typeof REFERENCE_VALIDATOR_MODEL_IDS;
    references_in_caller_input: false;
    file_urls: readonly [];
  }>;
  readonly wire_observation: Readonly<{
    source: "CURRENT_SETTINGS2_TO_INDEX7_TO_VIDEO_SENDER_STATIC_JOIN";
    method: "POST";
    path: "/api/v1/video/generate";
    query: Readonly<{ ai_name: typeof AI_NAME }>;
    settings_keys: typeof SOURCE_SETTINGS_KEYS;
    no_references: true;
    selected_settings_are_sent: true;
  }>;
  readonly cost_projection: Readonly<{
    public_fields: typeof COST_PARAMETER_FIELDS;
    bindings: typeof COST_PARAMETER_BINDINGS;
    helper_form_call_arity: 1;
    helper_formal_count: 6;
    fifth_argument_override_supplied_by_form: false;
    preflight_only: true;
    cost_aliases_in_generation_wire: false;
    amount_or_quote: "UNPROVEN";
  }>;
  readonly defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerGrokT2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerGrokT2vSourceContract> {
}

const SOURCE_PINS: OwnerGrokT2vSourceContract["source_pins"] = Object.freeze({
  public_catalog_version: OWNER_GROK_T2V_PUBLIC_CATALOG_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  current_public_models_response_sha256: CURRENT_PUBLIC_MODELS_RESPONSE_SHA256,
  settings_inventory_version: OWNER_GROK_T2V_SETTINGS_INVENTORY_VERSION,
  current_source_build_id: SOURCE_BUILD_ID,
  settings_inventory_build_id: SETTINGS_INVENTORY_BUILD_ID,
  current_form_module: "grok-video.js",
  current_form_bytes: FORM_BYTES,
  current_form_sha256: FORM_SHA256,
  form_source_offsets: FORM_SOURCE_OFFSETS,
  app_router_module: "app.js",
  app_router_bytes: APP_BYTES,
  app_router_sha256: APP_SHA256,
  app_option_helper_export: "I",
  app_option_helper_definition_offsets: APP_OPTION_HELPER_DEFINITION_OFFSETS,
  settings_registry_module: "Settings2.js",
  settings_registry_bytes: SETTINGS_REGISTRY_BYTES,
  settings_registry_sha256: SETTINGS_REGISTRY_SHA256,
  settings_helper_module: "settings3.js",
  settings_helper_bytes: SETTINGS_HELPER_BYTES,
  settings_helper_sha256: SETTINGS_HELPER_SHA256,
  cost_helper_module: "cost2.js",
  cost_helper_bytes: COST_HELPER_BYTES,
  cost_helper_sha256: COST_HELPER_SHA256,
  chat_route_module: "index7.js",
  chat_route_bytes: CHAT_ROUTE_BYTES,
  chat_route_sha256: CHAT_ROUTE_SHA256,
  sender_module: "video.js",
  sender_bytes: VIDEO_SENDER_BYTES,
  sender_sha256: VIDEO_SENDER_SHA256,
  slider_module: "SliderForm.js",
  slider_bytes: SLIDER_FORM_BYTES,
  slider_sha256: SLIDER_FORM_SHA256,
  duration_helper_module: "duration.js",
  duration_helper_bytes: DURATION_HELPER_BYTES,
  duration_helper_sha256: DURATION_HELPER_SHA256
});

const SOURCE_CONTROLS: OwnerGrokT2vSourceContract["controls"] = Object.freeze({
  aspect_ratio: Object.freeze({
    values: ASPECT_RATIO_OPTIONS,
    expanded_values_model_ids: ASPECT_RATIO_EXPANDED_MODEL_IDS,
    effective_default: "UNKNOWN"
  }),
  resolution: Object.freeze({ values: RESOLUTION_OPTIONS, effective_default: "UNKNOWN" }),
  video_duration: Object.freeze({
    endpoints: VIDEO_DURATION_ENDPOINTS,
    step: VIDEO_DURATION_STEP,
    values: VIDEO_DURATION_OPTIONS,
    effective_default: "UNKNOWN"
  }),
  prompt: Object.freeze({
    max_length_from_catalog: PROMPT_MAX_LENGTH,
    min_length_from_source: "UNKNOWN",
    local_nonempty_policy: true
  })
});

export function buildOwnerGrokT2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractV2Input {
  assertSourceBinding(catalog, inventory);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("OWNER_GROK_T2V_SOURCE_UNAVAILABLE");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  return {
    variant_id: OWNER_GROK_T2V_CONTRACT_VARIANT_ID,
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
        { kind: "public_catalog", reference: `Exact active ${MODEL_ID} row in pinned B066 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "manual_review", reference: `Anonymous models response sha256=${CURRENT_PUBLIC_MODELS_RESPONSE_SHA256}; current build ${SOURCE_BUILD_ID}; Grok T2V settings, no-reference guard, cost preflight and sender joins are pinned in owner-grok-t2v-profile.ts.` },
        { kind: "frontend_static", reference: `grok-video.js build ${SOURCE_BUILD_ID}; exact Grok T2V ratio branch, resolution options, integer-duration slider range and no-reference model validator inventory`, sha256: FORM_SHA256 },
        { kind: "frontend_static", reference: `Settings2.js build ${SOURCE_BUILD_ID}; Grok video form family registration is paired through the pinned 1b48 settings inventory`, sha256: SETTINGS_REGISTRY_SHA256 },
        { kind: "frontend_static", reference: `app.js build ${SOURCE_BUILD_ID}; exact I option-helper export and current Grok form route`, sha256: APP_SHA256 },
        { kind: "frontend_static", reference: `settings3.js build ${SOURCE_BUILD_ID}; Grok form invokes the current four-argument settings selection helper`, sha256: SETTINGS_HELPER_SHA256 },
        { kind: "frontend_static", reference: `cost2.js build ${SOURCE_BUILD_ID}; Grok form invokes the current cost helper without a fifth-argument override callback`, sha256: COST_HELPER_SHA256 },
        { kind: "frontend_static", reference: `index7.js build ${SOURCE_BUILD_ID}; current video form route`, sha256: CHAT_ROUTE_SHA256 },
        { kind: "frontend_static", reference: `video.js build ${SOURCE_BUILD_ID}; current selected video settings sender`, sha256: VIDEO_SENDER_SHA256 },
        { kind: "frontend_static", reference: `SliderForm.js build ${SOURCE_BUILD_ID}; omitted step prop uses the component's literal default step 1`, sha256: SLIDER_FORM_SHA256 },
        { kind: "frontend_static", reference: `duration.js build ${SOURCE_BUILD_ID}; imported by the current Grok video form`, sha256: DURATION_HELPER_SHA256 },
        { kind: "manual_review", reference: "Source-only no-reference T2V profile. Initializer values are not effective defaults; provider acceptance, output format, result readiness and billing remain unproven." }
      ],
      reviewed_at: reviewedAt
    },
    cost_parameter_bindings: COST_PARAMETER_BINDINGS,
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "aspect_ratio", "resolution", "video_duration"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: PROMPT_MAX_LENGTH },
        aspect_ratio: { type: "string", enum: [...ASPECT_RATIO_OPTIONS] },
        resolution: { type: "string", enum: [...RESOLUTION_OPTIONS] },
        video_duration: { type: "integer", enum: [...VIDEO_DURATION_OPTIONS] }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: OPERATION_ID,
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: {
        aspect_ratio: "aspect_ratio",
        resolution: "resolution",
        video_duration: "video_duration"
      },
      fixed_settings: { file_urls: [] },
      media_reference_fields: {}
    },
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: 4, max_value_depth: 1, max_serialized_bytes: 65_536, max_normalized_nodes: 24 }
  };
}

export function createOwnerGrokT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [buildOwnerGrokT2vGenerationContractInput(catalog, inventory, reviewedAt)]
  });
}

export async function archiveOwnerGrokT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string,
  catalogDirectory?: string
) {
  return archiveGenerationContractRegistryV2(createOwnerGrokT2vGenerationRegistry(catalog, inventory, reviewedAt), catalogDirectory);
}

export function createOwnerGrokT2vProfile(catalogDirectory?: string): OwnerGrokT2vProfile {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_GROK_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_GROK_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  assertSourceBinding(catalog, inventory);
  const registry = loadGenerationContractRegistryV2(OWNER_GROK_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const selected = registry.contracts.find(contract => contract.model_id === MODEL_ID);
  const reviewedAt = selected?.provenance.reviewed_at ?? "";
  const expected = createOwnerGrokT2vGenerationRegistry(catalog, inventory, reviewedAt);
  if (!isDeepStrictEqual(registry, expected) || registry.contracts.length !== 1 ||
      selected?.schema_hash !== CONTRACT_SCHEMA_HASHES.grok_t2v) {
    throw new Error("OWNER_GROK_T2V_PROFILE_MISMATCH");
  }
  const source: OwnerGrokT2vSourceContract = Object.freeze({
    status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_GROK_T2V",
    source_pins: SOURCE_PINS,
    identity: Object.freeze({ model_id: MODEL_ID, ai_name: AI_NAME, model_type: MODEL_ID, operation_id: OPERATION_ID }),
    contract_schema_hash: selected.schema_hash,
    controls: SOURCE_CONTROLS,
    initializer_candidates: Object.freeze({
      values: INITIALIZER_CANDIDATES,
      effective_defaults: "UNKNOWN",
      video_duration_is_within_exposed_slider_range: false
    }),
    no_reference_source: Object.freeze({
      form_id: "grok-video",
      public_file_count_limit: 0,
      accepted_file_types: Object.freeze([] as const),
      allowed_media_types: Object.freeze([] as const),
      form_validator_present: false,
      reference_validator_model_ids: REFERENCE_VALIDATOR_MODEL_IDS,
      references_in_caller_input: false,
      file_urls: Object.freeze([] as const)
    }),
    wire_observation: Object.freeze({
      source: "CURRENT_SETTINGS2_TO_INDEX7_TO_VIDEO_SENDER_STATIC_JOIN",
      method: "POST",
      path: "/api/v1/video/generate",
      query: Object.freeze({ ai_name: AI_NAME }),
      settings_keys: SOURCE_SETTINGS_KEYS,
      no_references: true,
      selected_settings_are_sent: true
    }),
    cost_projection: Object.freeze({
      public_fields: COST_PARAMETER_FIELDS,
      bindings: COST_PARAMETER_BINDINGS,
      helper_form_call_arity: 1,
      helper_formal_count: 6,
      fifth_argument_override_supplied_by_form: false,
      preflight_only: true,
      cost_aliases_in_generation_wire: false,
      amount_or_quote: "UNPROVEN"
    }),
    defaults: "UNKNOWN",
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  const profile: OwnerGrokT2vProfile = Object.freeze({
    catalog,
    registry,
    registryVersion: OWNER_GROK_T2V_CONTRACT_REGISTRY_VERSION,
    source,
    modelId: MODEL_ID,
    aiName: AI_NAME,
    modelType: MODEL_ID,
    operationId: OPERATION_ID,
    variantId: selected.variant_id,
    costParameterFields: COST_PARAMETER_FIELDS,
    normalizeGenerationInput: normalizeOwnerGrokT2vInput,
    buildContractInput: (value: string) => buildOwnerGrokT2vGenerationContractInput(catalog, inventory, value)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerGrokT2vProfile(value: unknown): value is OwnerGrokT2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function assertSourceBinding(catalog: DiscoveryCatalogRepository, inventory: MaplessSettingsInventory): void {
  if (catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 ||
      inventory.public_catalog.version !== OWNER_GROK_T2V_PUBLIC_CATALOG_VERSION ||
      inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 ||
      inventory.build.id !== SETTINGS_INVENTORY_BUILD_ID) {
    throw new Error("OWNER_GROK_T2V_SOURCE_UNAVAILABLE");
  }
  const model = catalog.getModel(MODEL_ID);
  const settings = model.settings;
  const row = inventory.models.find(entry => entry.model_id === MODEL_ID);
  if (model.active !== true || model.ai_name !== AI_NAME || model.upstream_id !== MODEL_ID ||
      !model.operations.some(operation => operation.id === OPERATION_ID && operation.output_modality === "video") ||
      !settings || settings.file_count_limit !== 0 || settings.uploadable !== false ||
      !isDeepStrictEqual(settings.accepted_file_types, []) || !isDeepStrictEqual(settings.allowed_media_types, []) ||
      settings.max_prompt_length !== PROMPT_MAX_LENGTH || !isDeepStrictEqual(settings.aspect_ratio, [
        { label: "2:3", value: "2:3" },
        { label: "3:2", value: "3:2" },
        { label: "1:1", value: "1:1" },
        { label: "9:16", value: "9:16" },
        { label: "16:9", value: "16:9" }
      ]) || !isDeepStrictEqual(settings.get_cost_params, COST_PARAMETER_FIELDS) ||
      !row || row.active !== true || row.ai_name !== AI_NAME || row.form_id !== "grok-video" ||
      row.form_binding_status !== "STRUCTURAL_MATCH" || row.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
      row.defaults_status !== "UNKNOWN" || row.runtime_usable !== false ||
      !isDeepStrictEqual(row.settings?.file_count_limit, 0) ||
      !isDeepStrictEqual(row.settings?.get_cost_params, COST_PARAMETER_FIELDS) ||
      !isDeepStrictEqual(row.model_value_settings_keys, INVENTORY_MODEL_VALUE_SETTINGS_KEYS) ||
      !isDeepStrictEqual(row.payload_field_keys, ["model_type"]) ||
      !isDeepStrictEqual(row.static_setting_defaults, {})) {
    throw new Error("OWNER_GROK_T2V_SOURCE_UNAVAILABLE");
  }
}

function normalizeOwnerGrokT2vInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
      Reflect.ownKeys(value).some(key => typeof key !== "string" ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) ||
      Object.keys(value).sort().join("\0") !== ["attemptId", "aspect_ratio", "prompt", "resolution", "video_duration"].sort().join("\0")) {
    throw new Error("INVALID_REQUEST");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.attemptId !== "string" || !ATTEMPT_PATTERN.test(request.attemptId) ||
      typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
      request.prompt.length > PROMPT_MAX_LENGTH || PROMPT_CONTROL.test(request.prompt) ||
      !ASPECT_RATIO_OPTIONS.includes(request.aspect_ratio as OwnerGrokT2vAspectRatio) ||
      !RESOLUTION_OPTIONS.includes(request.resolution as OwnerGrokT2vResolution) ||
      !VIDEO_DURATION_OPTIONS.includes(request.video_duration as OwnerGrokT2vVideoDuration)) {
    throw new Error("INVALID_REQUEST");
  }
  const parameters = Object.freeze({
    prompt: request.prompt,
    aspect_ratio: request.aspect_ratio as OwnerGrokT2vAspectRatio,
    resolution: request.resolution as OwnerGrokT2vResolution,
    video_duration: request.video_duration as OwnerGrokT2vVideoDuration
  });
  return Object.freeze({
    attemptId: request.attemptId,
    prompt: request.prompt,
    parameters,
    semanticIntent: Object.freeze({ ...parameters })
  });
}
