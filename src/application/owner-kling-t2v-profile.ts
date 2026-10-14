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

export const OWNER_KLING_T2V_CONTRACT_VARIANT_IDS = Object.freeze({
  kling_text2video: "kling-t2v-source-reviewed-no-reference-full-form-controls",
  kling_o1_text2video: "kling-o1-t2v-source-reviewed-no-reference-hd"
} as const);
export const OWNER_KLING_T2V_CONTRACT_REGISTRY_VERSION = "sha256-c908abe364c3592601cd1b0d8525bf5063c04a1f04313588f577eb82418c8159.json" as const;
export const OWNER_KLING_T2V_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_KLING_T2V_SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

export type OwnerKlingT2vModelId = keyof typeof OWNER_KLING_T2V_CONTRACT_VARIANT_IDS;

const AI_NAME = "kling" as const;
const OPERATION_ID = "generate-video" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const CURRENT_PUBLIC_MODELS_RESPONSE_SHA256 = "sha256:323b585b24a0637466c3729553e14d506aa9427418977db6f201819d83b8a083" as const;
const SOURCE_BUILD_ID = "1791904852" as const;
const SETTINGS_INVENTORY_BUILD_ID = "1791811899" as const;
const FORM_BYTES = 32_012;
const FORM_SHA256 = "sha256:cdd5e9db14f57c901484c1bef541ba0b3fdd4d13153b990bd1f0edce1b3a5614" as const;
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
const ASPECT_HELPER_BYTES = 2_695;
const ASPECT_HELPER_SHA256 = "sha256:c7205b1a94ce8db03920b4bf9257108dd8af746cdaabb04e3f8e308bab23d2ee" as const;
const DURATION_SOURCE_BYTES = 1_644;
const DURATION_SOURCE_SHA256 = "sha256:13d991c46f54bdfc9f0dad43ae792580a21a5754a5de1d42900c81e3134c7d6b" as const;
const PROMPT_LOCAL_UTF16_LIMIT = 5_000;
const VERSION_CHOICES = Object.freeze(["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6", "3.0", "3.0-turbo"] as const);
const STANDARD_VERSIONS = Object.freeze(["1.5", "1.6", "2.1-master", "2.5-turbo", "2.6"] as const);
const LONG_DURATION_VERSIONS = Object.freeze(["3.0", "3.0-turbo"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "1:1", "9:16"] as const);
const SOURCE_DURATION_VALUES = Object.freeze([5, 10] as const);
const LONG_DURATIONS = Object.freeze(Array.from({ length: 15 }, (_, index) => index + 1));
const BASE_COST_FIELDS = Object.freeze(["version", "mode", "video_duration", "native_audio"] as const);
const O1_COST_FIELDS = Object.freeze(["version", "mode", "video_duration"] as const);
const NATIVE_AUDIO_VERSIONS = Object.freeze(["2.6", "3.0"] as const);
const BASE_COST_BINDINGS = Object.freeze({
  version: Object.freeze({ kind: "parameter", parameter: "version" }),
  mode: Object.freeze({ kind: "parameter", parameter: "mode" }),
  video_duration: Object.freeze({ kind: "parameter", parameter: "video_duration" }),
  native_audio: Object.freeze({ kind: "parameter", parameter: "native_audio" })
});
const O1_COST_BINDINGS = Object.freeze({
  version: Object.freeze({ kind: "literal", value: "" }),
  mode: Object.freeze({ kind: "parameter", parameter: "mode" }),
  video_duration: Object.freeze({ kind: "parameter", parameter: "video_duration" })
});
const authenticProfiles = new WeakSet<object>();
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export interface OwnerKlingT2vSourceContract {
  readonly status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_KLING_T2V";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_KLING_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    current_public_models_response_sha256: typeof CURRENT_PUBLIC_MODELS_RESPONSE_SHA256;
    settings_inventory_version: typeof OWNER_KLING_T2V_SETTINGS_INVENTORY_VERSION;
    source_build_id: typeof SOURCE_BUILD_ID;
    settings_inventory_build_id: typeof SETTINGS_INVENTORY_BUILD_ID;
    app_router_module: "app.js";
    app_router_bytes: typeof APP_BYTES;
    app_router_sha256: typeof APP_SHA256;
    settings_registry_module: "Settings2.js";
    settings_registry_bytes: typeof SETTINGS_REGISTRY_BYTES;
    settings_registry_sha256: typeof SETTINGS_REGISTRY_SHA256;
    form_module: "kling.js";
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
    aspect_helper_module: "AspectRatio.js";
    aspect_helper_bytes: typeof ASPECT_HELPER_BYTES;
    aspect_helper_sha256: typeof ASPECT_HELPER_SHA256;
    duration_source_module: "duration.js";
    duration_source_bytes: typeof DURATION_SOURCE_BYTES;
    duration_source_sha256: typeof DURATION_SOURCE_SHA256;
  }>;
  readonly identity: Readonly<{ model_id: OwnerKlingT2vModelId; ai_name: typeof AI_NAME; model_type: OwnerKlingT2vModelId; operation_id: typeof OPERATION_ID }>;
  readonly controls: Readonly<{
    version: Readonly<{ values: readonly string[]; effective_default: "UNKNOWN" }>;
    mode: Readonly<{ values: readonly string[]; effective_default: "UNKNOWN" }>;
    mode_values_by_version: Readonly<{ standard: readonly ["standart", "hd"]; master_2_1: readonly ["hd"]; o1: readonly ["hd"] }>;
    aspect_ratio: Readonly<{ values: typeof ASPECT_RATIOS; effective_default: "UNKNOWN" }>;
    video_duration: Readonly<{
      values_by_version: Readonly<{ standard: typeof SOURCE_DURATION_VALUES; long: typeof LONG_DURATIONS }>;
      long_duration_versions: typeof LONG_DURATION_VERSIONS;
      unit: "INTEGER_SECONDS";
      effective_default: "UNKNOWN";
    }>;
    native_audio: Readonly<{ values: readonly boolean[]; effective_default: "UNKNOWN" }>;
    native_audio_true_versions: readonly string[];
    prompt: Readonly<{ source_max_length: "UNKNOWN"; local_bound_utf16: typeof PROMPT_LOCAL_UTF16_LIMIT; local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" }>;
  }>;
  readonly no_reference_source: Readonly<{
    form_model: "kling_text2video" | "kling_o1_text2video";
    validator: "EXACT_ZERO_FILES" | "NO_REQUIRED_FILE_VALIDATOR";
    public_uploadable: false;
    file_urls: readonly [];
    optional_files_mention: boolean;
  }>;
  readonly wire_observation: Readonly<{
    source: "CURRENT_SETTINGS2_TO_INDEX7_TO_VIDEO_SENDER_STATIC_JOIN";
    method: "POST";
    path: "/api/v1/video/generate";
    query: Readonly<{ ai_name: typeof AI_NAME }>;
    settings_keys: readonly string[];
    no_references: true;
    custom_settings_payload_used: false;
  }>;
  readonly cost_projection: Readonly<{
    caller_keys: typeof BASE_COST_FIELDS | typeof O1_COST_FIELDS;
    bindings: typeof BASE_COST_BINDINGS | typeof O1_COST_BINDINGS;
    transport_owned_keys: readonly ["model_type"];
    cost2_u_call_arity: 1;
    cost2_u_override_parameter_position: 5;
    amount_or_quote: "UNPROVEN";
  }>;
  readonly defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerKlingT2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerKlingT2vSourceContract> {}

const SOURCE_PINS: OwnerKlingT2vSourceContract["source_pins"] = Object.freeze({
  public_catalog_version: OWNER_KLING_T2V_PUBLIC_CATALOG_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  current_public_models_response_sha256: CURRENT_PUBLIC_MODELS_RESPONSE_SHA256,
  settings_inventory_version: OWNER_KLING_T2V_SETTINGS_INVENTORY_VERSION,
  source_build_id: SOURCE_BUILD_ID,
  settings_inventory_build_id: SETTINGS_INVENTORY_BUILD_ID,
  app_router_module: "app.js",
  app_router_bytes: APP_BYTES,
  app_router_sha256: APP_SHA256,
  settings_registry_module: "Settings2.js",
  settings_registry_bytes: SETTINGS_REGISTRY_BYTES,
  settings_registry_sha256: SETTINGS_REGISTRY_SHA256,
  form_module: "kling.js",
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
  sender_sha256: VIDEO_SENDER_SHA256,
  aspect_helper_module: "AspectRatio.js",
  aspect_helper_bytes: ASPECT_HELPER_BYTES,
  aspect_helper_sha256: ASPECT_HELPER_SHA256,
  duration_source_module: "duration.js",
  duration_source_bytes: DURATION_SOURCE_BYTES,
  duration_source_sha256: DURATION_SOURCE_SHA256
});

export function buildOwnerKlingT2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  modelId: OwnerKlingT2vModelId,
  reviewedAt: string
): GenerationContractV2Input {
  assertSourceBinding(catalog, inventory);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("OWNER_KLING_T2V_SOURCE_UNAVAILABLE");
  const base = modelId === "kling_text2video";
  const bindings = base ? BASE_COST_BINDINGS : O1_COST_BINDINGS;
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const durationCases = [
    ...STANDARD_VERSIONS.map((version) => ({ when: { field: "version", equals: version }, allowed_values: [...SOURCE_DURATION_VALUES] })),
    ...LONG_DURATION_VERSIONS.map((version) => ({ when: { field: "version", equals: version }, allowed_values: [...LONG_DURATIONS] }))
  ];
  return {
    variant_id: OWNER_KLING_T2V_CONTRACT_VARIANT_IDS[modelId],
    model_id: modelId,
    operation_id: OPERATION_ID,
    modality: "video",
    route: "video",
    ai_name: AI_NAME,
    model_type: modelId,
    status: "reviewed",
    provenance: {
      settings_source_sha256: FORM_SHA256,
      references: [
        { kind: "public_catalog", reference: `Exact ${modelId} active model row in B066 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "manual_review", reference: `Anonymous public models response sha256=${CURRENT_PUBLIC_MODELS_RESPONSE_SHA256}; current build ${SOURCE_BUILD_ID}; full import/export and form/settings/cost/sender joins recorded in owner-kling-t2v-profile.ts.` },
        { kind: "frontend_static", reference: `kling.js build ${SOURCE_BUILD_ID}; no-reference form control, validator, version, mode, ratio, and duration branches`, sha256: FORM_SHA256 },
        { kind: "frontend_static", reference: `Settings2.js build ${SOURCE_BUILD_ID}; exact Kling form import registration`, sha256: SETTINGS_REGISTRY_SHA256 },
        { kind: "frontend_static", reference: `app.js build ${SOURCE_BUILD_ID}; selected form/settings route and duration helper export`, sha256: APP_SHA256 },
        { kind: "frontend_static", reference: `settings3.js build ${SOURCE_BUILD_ID}; exact imported settings helper binding`, sha256: SETTINGS_HELPER_SHA256 },
        { kind: "frontend_static", reference: `cost2.js build ${SOURCE_BUILD_ID}; current public cost-key projection; form calls cost2.u(model_type) and passes no override argument`, sha256: COST_HELPER_SHA256 },
        { kind: "frontend_static", reference: `cost.js build ${SOURCE_BUILD_ID}; separate cost request helper`, sha256: COST_REQUEST_SHA256 },
        { kind: "frontend_static", reference: `index7.js build ${SOURCE_BUILD_ID}; current video form routing`, sha256: CHAT_ROUTE_SHA256 },
        { kind: "frontend_static", reference: `video.js build ${SOURCE_BUILD_ID}; POST video sender and file_urls handling`, sha256: VIDEO_SENDER_SHA256 },
        { kind: "frontend_static", reference: `AspectRatio.js build ${SOURCE_BUILD_ID}; current Kling aspect selector options`, sha256: ASPECT_HELPER_SHA256 },
        { kind: "frontend_static", reference: `duration.js build ${SOURCE_BUILD_ID}; form's current duration helper dependency`, sha256: DURATION_SOURCE_SHA256 },
        { kind: "manual_review", reference: base
          ? "Source-closed base T2V choices: versions 1.5/1.6/2.1-master/2.5-turbo/2.6 allow 5 or 10 seconds; 3.0 and 3.0-turbo allow 1 through 15 seconds; modes standart/hd; ratios 16:9/1:1/9:16; native_audio boolean. 4K is excluded because its source guard is for kling_elements/version 3.0. Exact zero-file validator; no provider acceptance or effective defaults claimed."
          : "Source-closed O1 T2V branch: version is cleared, mode must be hd, ratios 16:9/1:1/9:16, duration options 5 or 10, and no file is required by its validator or public upload metadata. The public files_mention capability is optional and excluded from this no-reference request. Defaults and provider acceptance remain unproven." }
      ],
      reviewed_at: reviewedAt
    },
    cost_parameter_bindings: bindings,
    parameters: base ? {
      type: "object",
      additional_properties: false,
      required: ["prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: PROMPT_LOCAL_UTF16_LIMIT },
        version: { type: "string", enum: [...VERSION_CHOICES] },
        mode: { type: "string", enum: ["standart", "hd"] },
        aspect_ratio: { type: "string", enum: [...ASPECT_RATIOS] },
        video_duration: { type: "integer", enum: [...LONG_DURATIONS] },
        native_audio: { type: "boolean" }
      },
      conditions: [],
      conditional_enums: [
        { field: "video_duration", cases: durationCases },
        { field: "mode", cases: VERSION_CHOICES.map((version) => ({
          when: { field: "version", equals: version },
          allowed_values: version === "2.1-master" ? ["hd"] : ["standart", "hd"]
        })) },
        { field: "native_audio", cases: VERSION_CHOICES.map((version) => ({
          when: { field: "version", equals: version },
          allowed_values: NATIVE_AUDIO_VERSIONS.includes(version as typeof NATIVE_AUDIO_VERSIONS[number]) ? [false, true] : [false]
        })) }
      ]
    } : {
      type: "object",
      additional_properties: false,
      required: ["prompt", "mode", "aspect_ratio", "video_duration"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: PROMPT_LOCAL_UTF16_LIMIT },
        mode: { type: "string", enum: ["hd"] },
        aspect_ratio: { type: "string", enum: [...ASPECT_RATIOS] },
        video_duration: { type: "integer", enum: [...SOURCE_DURATION_VALUES] }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: OPERATION_ID,
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: base ? {
        version: "version", mode: "mode", aspect_ratio: "aspect_ratio", video_duration: "video_duration", native_audio: "native_audio"
      } : {
        mode: "mode", aspect_ratio: "aspect_ratio", video_duration: "video_duration"
      },
      fixed_settings: { file_urls: [] },
      media_reference_fields: {}
    },
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: base ? 6 : 4, max_value_depth: 1, max_serialized_bytes: 65_536, max_normalized_nodes: 64 }
  };
}

export function createOwnerKlingT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [
      buildOwnerKlingT2vGenerationContractInput(catalog, inventory, "kling_text2video", reviewedAt),
      buildOwnerKlingT2vGenerationContractInput(catalog, inventory, "kling_o1_text2video", reviewedAt)
    ]
  });
}

export async function archiveOwnerKlingT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string,
  catalogDirectory?: string
) {
  return archiveGenerationContractRegistryV2(createOwnerKlingT2vGenerationRegistry(catalog, inventory, reviewedAt), catalogDirectory);
}

export function createOwnerKlingT2vProfile(
  modelId: OwnerKlingT2vModelId = "kling_text2video",
  catalogDirectory?: string
): OwnerKlingT2vProfile {
  if (modelId !== "kling_text2video" && modelId !== "kling_o1_text2video") throw new Error("OWNER_KLING_T2V_MODEL_UNSUPPORTED");
  const catalog = loadSelectedDiscoveryCatalog(OWNER_KLING_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_KLING_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  assertSourceBinding(catalog, inventory);
  const registry = loadGenerationContractRegistryV2(OWNER_KLING_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const reviewedAt = registry.contracts.find((entry) => entry.model_id === modelId)?.provenance.reviewed_at ?? "";
  const expected = createOwnerKlingT2vGenerationRegistry(catalog, inventory, reviewedAt);
  if (!isDeepStrictEqual(registry, expected) || registry.contracts.length !== 2) throw new Error("OWNER_KLING_T2V_PROFILE_MISMATCH");
  const contract = registry.contracts.find((entry) => entry.model_id === modelId);
  if (!contract) throw new Error("OWNER_KLING_T2V_PROFILE_MISMATCH");
  const base = modelId === "kling_text2video";
  const source: OwnerKlingT2vSourceContract = Object.freeze({
    status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_KLING_T2V",
    source_pins: SOURCE_PINS,
    identity: Object.freeze({ model_id: modelId, ai_name: AI_NAME, model_type: modelId, operation_id: OPERATION_ID }),
    controls: Object.freeze({
      version: Object.freeze({ values: base ? VERSION_CHOICES : Object.freeze([]), effective_default: "UNKNOWN" as const }),
      mode: Object.freeze({ values: base ? Object.freeze(["standart", "hd"] as const) : Object.freeze(["hd"] as const), effective_default: "UNKNOWN" as const }),
      mode_values_by_version: Object.freeze({ standard: Object.freeze(["standart", "hd"] as const), master_2_1: Object.freeze(["hd"] as const), o1: Object.freeze(["hd"] as const) }),
      aspect_ratio: Object.freeze({ values: ASPECT_RATIOS, effective_default: "UNKNOWN" as const }),
      video_duration: Object.freeze({ values_by_version: Object.freeze({ standard: SOURCE_DURATION_VALUES, long: LONG_DURATIONS }), long_duration_versions: LONG_DURATION_VERSIONS, unit: "INTEGER_SECONDS" as const, effective_default: "UNKNOWN" as const }),
      native_audio: Object.freeze({ values: base ? Object.freeze([false, true] as const) : Object.freeze([]), effective_default: "UNKNOWN" as const }),
      native_audio_true_versions: base ? NATIVE_AUDIO_VERSIONS : Object.freeze([]),
      prompt: Object.freeze({ source_max_length: "UNKNOWN" as const, local_bound_utf16: PROMPT_LOCAL_UTF16_LIMIT, local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" as const })
    }),
    no_reference_source: Object.freeze({
      form_model: modelId,
      validator: base ? "EXACT_ZERO_FILES" as const : "NO_REQUIRED_FILE_VALIDATOR" as const,
      public_uploadable: false as const,
      file_urls: Object.freeze([] as const),
      optional_files_mention: !base
    }),
    wire_observation: Object.freeze({
      source: "CURRENT_SETTINGS2_TO_INDEX7_TO_VIDEO_SENDER_STATIC_JOIN" as const,
      method: "POST" as const,
      path: "/api/v1/video/generate" as const,
      query: Object.freeze({ ai_name: AI_NAME }),
      settings_keys: Object.freeze(base
        ? ["model_type", "version", "mode", "aspect_ratio", "video_duration", "native_audio", "file_urls"]
        : ["model_type", "mode", "aspect_ratio", "video_duration", "file_urls"]),
      no_references: true as const,
      custom_settings_payload_used: false as const
    }),
    cost_projection: Object.freeze({
      caller_keys: base ? BASE_COST_FIELDS : O1_COST_FIELDS,
      bindings: base ? BASE_COST_BINDINGS : O1_COST_BINDINGS,
      transport_owned_keys: Object.freeze(["model_type"] as const),
      cost2_u_call_arity: 1 as const,
      cost2_u_override_parameter_position: 5 as const,
      amount_or_quote: "UNPROVEN" as const
    }),
    defaults: "UNKNOWN",
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  const profile: OwnerKlingT2vProfile = Object.freeze({
    catalog,
    registry,
    registryVersion: OWNER_KLING_T2V_CONTRACT_REGISTRY_VERSION,
    source,
    modelId,
    aiName: AI_NAME,
    modelType: modelId,
    operationId: OPERATION_ID,
    variantId: contract.variant_id,
    costParameterFields: Object.freeze([...(base ? BASE_COST_FIELDS : O1_COST_FIELDS)]),
    normalizeGenerationInput: (value: unknown) => normalizeGenerationInput(value, modelId),
    buildContractInput: (value: string) => buildOwnerKlingT2vGenerationContractInput(catalog, inventory, modelId, value)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerKlingT2vProfile(value: unknown): value is OwnerKlingT2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function assertSourceBinding(catalog: DiscoveryCatalogRepository, inventory: MaplessSettingsInventory): void {
  for (const modelId of ["kling_text2video", "kling_o1_text2video"] as const) {
    const model = catalog.getModel(modelId);
    const row = inventory.models.find((entry) => entry.model_id === modelId);
    const expectedCostFields = modelId === "kling_text2video" ? BASE_COST_FIELDS : O1_COST_FIELDS;
    if (model.active !== true || model.ai_name !== AI_NAME || model.upstream_id !== modelId ||
        !model.operations.some((operation) => operation.id === OPERATION_ID && operation.output_modality === "video") ||
        !isDeepStrictEqual(model.settings?.get_cost_params, expectedCostFields) ||
        inventory.public_catalog.version !== OWNER_KLING_T2V_PUBLIC_CATALOG_VERSION ||
        inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 || inventory.build.id !== SETTINGS_INVENTORY_BUILD_ID ||
        !row || row.active !== true || row.ai_name !== AI_NAME || row.form_id !== "kling" ||
        row.form_binding_status !== "STRUCTURAL_MATCH" || row.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
        row.defaults_status !== "UNKNOWN" || row.runtime_usable !== false ||
        !isDeepStrictEqual(row.settings?.get_cost_params, expectedCostFields) ||
        !isDeepStrictEqual(row.model_value_settings_keys, ["aspect_ratio", "gen_type", "mode", "model_type", "multi_shots", "temperature", "version", "video_duration"]) ||
        !isDeepStrictEqual(row.payload_field_keys, ["mode", "model_type"])) {
      throw new Error("OWNER_KLING_T2V_SOURCE_UNAVAILABLE");
    }
  }
  const form = inventory.forms.find((entry) => entry.form_id === "kling");
  if (catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 || !form || form.module_name !== "kling.js" || form.javascript.parse_diagnostics !== 0) {
    throw new Error("OWNER_KLING_T2V_SOURCE_UNAVAILABLE");
  }
}

function normalizeGenerationInput(value: unknown, modelId: OwnerKlingT2vModelId): OwnerReviewedNoReferenceT2vNormalizedRequest {
  const base = modelId === "kling_text2video";
  const expectedKeys = base
    ? ["attemptId", "prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio"]
    : ["attemptId", "prompt", "mode", "aspect_ratio", "video_duration"];
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\0") !== [...expectedKeys].sort().join("\0")) throw new Error("INVALID_REQUEST");
  const request = value as Record<string, unknown>;
  const invalidShared = typeof request.attemptId !== "string" || !ATTEMPT_PATTERN.test(request.attemptId) ||
    typeof request.prompt !== "string" || request.prompt.trim().length === 0 || request.prompt.length > PROMPT_LOCAL_UTF16_LIMIT ||
    PROMPT_CONTROL.test(request.prompt) || !isWellFormedUnicode(request.prompt) ||
    typeof request.aspect_ratio !== "string" || !ASPECT_RATIOS.includes(request.aspect_ratio as typeof ASPECT_RATIOS[number]) ||
    (request.video_duration !== 5 && request.video_duration !== 10 && !LONG_DURATIONS.includes(request.video_duration as number));
  const invalidBase = base && (
    typeof request.native_audio !== "boolean" || !VERSION_CHOICES.includes(request.version as typeof VERSION_CHOICES[number]) ||
    (request.mode !== "standart" && request.mode !== "hd") ||
    (request.version === "2.1-master" && request.mode !== "hd") ||
    (request.native_audio === true && !NATIVE_AUDIO_VERSIONS.includes(request.version as typeof NATIVE_AUDIO_VERSIONS[number])) ||
    (STANDARD_VERSIONS.includes(request.version as typeof STANDARD_VERSIONS[number]) && !SOURCE_DURATION_VALUES.includes(request.video_duration as typeof SOURCE_DURATION_VALUES[number])) ||
    (LONG_DURATION_VERSIONS.includes(request.version as typeof LONG_DURATION_VERSIONS[number]) && !LONG_DURATIONS.includes(request.video_duration as number))
  );
  const invalidO1 = !base && (request.mode !== "hd" || (request.video_duration !== 5 && request.video_duration !== 10));
  if (invalidShared || invalidBase || invalidO1) {
    throw new Error("INVALID_REQUEST");
  }
  const parameters = Object.freeze(base
    ? { prompt: request.prompt, version: request.version, mode: request.mode, aspect_ratio: request.aspect_ratio, video_duration: request.video_duration, native_audio: request.native_audio }
    : { prompt: request.prompt, mode: request.mode, aspect_ratio: request.aspect_ratio, video_duration: request.video_duration });
  return Object.freeze({
    attemptId: request.attemptId as string,
    prompt: request.prompt as string,
    parameters,
    semanticIntent: Object.freeze(parameters as Record<string, string | number | boolean>)
  });
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
