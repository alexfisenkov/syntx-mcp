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

export const OWNER_VEO_T2V_CONTRACT_VARIANT_IDS = Object.freeze({
  veo3: "veo3-t2v-source-reviewed-no-reference-8s",
  veo3fast: "veo3fast-t2v-source-reviewed-no-reference-8s",
  veo3fast_r: "veo3fast-r-t2v-source-reviewed-no-reference-8s"
} as const);

export const OWNER_VEO_T2V_CONTRACT_REGISTRY_VERSION = "sha256-3724dec65b7b423dee9a18285271aa7b1aa54d56c221ba66453fd18030de2af6.json" as const;
export const OWNER_VEO_T2V_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" as const;
export const OWNER_VEO_T2V_SETTINGS_INVENTORY_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json" as const;

export type OwnerVeoT2vModelId = keyof typeof OWNER_VEO_T2V_CONTRACT_VARIANT_IDS;
export type OwnerVeoT2vUpscale = 0 | 1 | 2;
export type OwnerVeoT2vAspectRatio = "16:9" | "9:16";

export interface OwnerVeoT2vGenerationInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly upscale: OwnerVeoT2vUpscale;
  readonly aspect_ratio: OwnerVeoT2vAspectRatio;
  readonly video_duration: 8;
}

const AI_NAME = "veo3" as const;
const OPERATION_ID = "generate-video" as const;
const PUBLIC_MODELS_SHA256 = "sha256:7ffbeff2ef1efa9d617d6e26e3e1c11e1d355cc45b34a2a427159f7e91fa4667" as const;
const CURRENT_PUBLIC_MODELS_RESPONSE_SHA256 = "sha256:323b585b24a0637466c3729553e14d506aa9427418977db6f201819d83b8a083" as const;
const SOURCE_BUILD_ID = "1791904852" as const;
const SETTINGS_INVENTORY_BUILD_ID = "1791811899" as const;
const CURRENT_FORM_BYTES = 17_151;
const CURRENT_FORM_SHA256 = "sha256:e626d6b87290f49282bac0523c0896d254c2871a48288917c8f1fbc54a82ea9f" as const;
const INVENTORY_FORM_BYTES = 17_151;
const INVENTORY_FORM_SHA256 = "sha256:df95c89b8d161ce370fdf91fa00e9fa6aaae040c8b3aa543112ebb5d239c83cc" as const;
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
const QUALITY_HELPER_BYTES = 132;
const QUALITY_HELPER_SHA256 = "sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4" as const;
const CONSTANTS_BYTES = 414;
const CONSTANTS_SHA256 = "sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2" as const;
const PROMPT_MIN_LENGTH = 8;
const MODEL_IDS = Object.freeze(["veo3", "veo3fast", "veo3fast_r"] as const);
const UPSCALE_OPTIONS = Object.freeze([
  Object.freeze({ value: 0, label: "720p" }),
  Object.freeze({ value: 1, label: "1080p" }),
  Object.freeze({ value: 2, label: "4K" })
] as const satisfies readonly Readonly<{ value: OwnerVeoT2vUpscale; label: string }>[]);
const EXCLUDED_UPSCALE_OPTIONS = Object.freeze([
  Object.freeze({ value: 3, label: "360p Draft", reason: "NON_OMNI_BRANCH_EXCLUDED" })
] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16"] as const);
const VIDEO_DURATIONS = Object.freeze([8] as const);
const COST_PARAMETER_FIELDS = Object.freeze(["upscale"] as const);
const COST_PARAMETER_BINDINGS = Object.freeze({
  upscale: Object.freeze({ kind: "parameter", parameter: "upscale" })
});
const SOURCE_SETTINGS_KEYS = Object.freeze(["model_type", "type", "upscale", "aspect_ratio", "video_duration", "file_urls"] as const);
const INVENTORY_MODEL_VALUE_SETTINGS_KEYS = Object.freeze(["aspect_ratio", "model_type", "type", "upscale", "video_duration"] as const);
const authenticProfiles = new WeakSet<object>();
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

interface OwnerVeoT2vContractSchemaHashes {
  readonly veo3: string;
  readonly veo3fast: string;
  readonly veo3fast_r: string;
}

const CONTRACT_SCHEMA_HASHES: OwnerVeoT2vContractSchemaHashes = Object.freeze({
  veo3: "sha256:391a4954cd404a94add5a8a695197f228fa4d6bdf5d19cea5b30a54fc6f2a456",
  veo3fast: "sha256:d4daf9667124f861fd5c64a9d1ce813c09f35c93062bc8596e8b27cc65e0f9c6",
  veo3fast_r: "sha256:579a8d3102e075b38932cf664119dcf14375db47922ebf8e42d4b27df15881a7"
});

export interface OwnerVeoT2vSourceContract {
  readonly status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_VEO_T2V";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_VEO_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    current_public_models_response_sha256: typeof CURRENT_PUBLIC_MODELS_RESPONSE_SHA256;
    settings_inventory_version: typeof OWNER_VEO_T2V_SETTINGS_INVENTORY_VERSION;
    current_source_build_id: typeof SOURCE_BUILD_ID;
    settings_inventory_build_id: typeof SETTINGS_INVENTORY_BUILD_ID;
    current_form_module: "veo-3.js";
    current_form_bytes: typeof CURRENT_FORM_BYTES;
    current_form_sha256: typeof CURRENT_FORM_SHA256;
    inventory_form_module: "veo-3.js";
    inventory_form_bytes: typeof INVENTORY_FORM_BYTES;
    inventory_form_sha256: typeof INVENTORY_FORM_SHA256;
    app_router_module: "app.js";
    app_router_bytes: typeof APP_BYTES;
    app_router_sha256: typeof APP_SHA256;
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
    quality_helper_module: "quality.js";
    quality_helper_bytes: typeof QUALITY_HELPER_BYTES;
    quality_helper_sha256: typeof QUALITY_HELPER_SHA256;
    constants_module: "constants2.js";
    constants_bytes: typeof CONSTANTS_BYTES;
    constants_sha256: typeof CONSTANTS_SHA256;
  }>;
  readonly identity: Readonly<{
    model_id: OwnerVeoT2vModelId;
    ai_name: typeof AI_NAME;
    model_type: OwnerVeoT2vModelId;
    operation_id: typeof OPERATION_ID;
  }>;
  readonly contract_schema_hash: string;
  readonly controls: Readonly<{
    upscale: Readonly<{
      options: typeof UPSCALE_OPTIONS;
      excluded_options: typeof EXCLUDED_UPSCALE_OPTIONS;
      effective_default: "UNKNOWN";
      labels_are_not_values: true;
    }>;
    aspect_ratio: Readonly<{ values: typeof ASPECT_RATIOS; effective_default: "UNKNOWN" }>;
    video_duration: Readonly<{ values: typeof VIDEO_DURATIONS; unit: "INTEGER_SECONDS"; effective_default: "UNKNOWN" }>;
    type: Readonly<{ fixed_value: "text" }>;
    prompt: Readonly<{
      min_length_from_catalog: typeof PROMPT_MIN_LENGTH;
      min_length_basis: "PINNED_PUBLIC_MODEL_CATALOG_MIN_PROMPT_LENGTH";
      source_max_length: "UNKNOWN";
    }>;
  }>;
  readonly no_reference_source: Readonly<{
    form_id: "veo-3";
    t2v_type: "text";
    public_file_count_limit: 0;
    file_urls: readonly [];
    references_in_caller_input: false;
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
    caller_keys: typeof COST_PARAMETER_FIELDS;
    bindings: typeof COST_PARAMETER_BINDINGS;
    transport_owned_keys: readonly ["model_type"];
    cost2_u_call_arity: 5;
    fifth_argument_override_keys: readonly ["mode"];
    amount_or_quote: "UNPROVEN";
  }>;
  readonly defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerVeoT2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerVeoT2vSourceContract> {}

const SOURCE_PINS: OwnerVeoT2vSourceContract["source_pins"] = Object.freeze({
  public_catalog_version: OWNER_VEO_T2V_PUBLIC_CATALOG_VERSION,
  public_models_sha256: PUBLIC_MODELS_SHA256,
  current_public_models_response_sha256: CURRENT_PUBLIC_MODELS_RESPONSE_SHA256,
  settings_inventory_version: OWNER_VEO_T2V_SETTINGS_INVENTORY_VERSION,
  current_source_build_id: SOURCE_BUILD_ID,
  settings_inventory_build_id: SETTINGS_INVENTORY_BUILD_ID,
  current_form_module: "veo-3.js",
  current_form_bytes: CURRENT_FORM_BYTES,
  current_form_sha256: CURRENT_FORM_SHA256,
  inventory_form_module: "veo-3.js",
  inventory_form_bytes: INVENTORY_FORM_BYTES,
  inventory_form_sha256: INVENTORY_FORM_SHA256,
  app_router_module: "app.js",
  app_router_bytes: APP_BYTES,
  app_router_sha256: APP_SHA256,
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
  quality_helper_module: "quality.js",
  quality_helper_bytes: QUALITY_HELPER_BYTES,
  quality_helper_sha256: QUALITY_HELPER_SHA256,
  constants_module: "constants2.js",
  constants_bytes: CONSTANTS_BYTES,
  constants_sha256: CONSTANTS_SHA256
});

const SOURCE_CONTROLS: OwnerVeoT2vSourceContract["controls"] = Object.freeze({
  upscale: Object.freeze({ options: UPSCALE_OPTIONS, excluded_options: EXCLUDED_UPSCALE_OPTIONS, effective_default: "UNKNOWN", labels_are_not_values: true }),
  aspect_ratio: Object.freeze({ values: ASPECT_RATIOS, effective_default: "UNKNOWN" }),
  video_duration: Object.freeze({ values: VIDEO_DURATIONS, unit: "INTEGER_SECONDS", effective_default: "UNKNOWN" }),
  type: Object.freeze({ fixed_value: "text" }),
  prompt: Object.freeze({
    min_length_from_catalog: PROMPT_MIN_LENGTH,
    min_length_basis: "PINNED_PUBLIC_MODEL_CATALOG_MIN_PROMPT_LENGTH",
    source_max_length: "UNKNOWN"
  })
});

export function buildOwnerVeoT2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  modelId: OwnerVeoT2vModelId,
  reviewedAt: string
): GenerationContractV2Input {
  assertSourceBinding(catalog, inventory);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("OWNER_VEO_T2V_SOURCE_UNAVAILABLE");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  return {
    variant_id: OWNER_VEO_T2V_CONTRACT_VARIANT_IDS[modelId],
    model_id: modelId,
    operation_id: OPERATION_ID,
    modality: "video",
    route: "video",
    ai_name: AI_NAME,
    model_type: modelId,
    status: "reviewed",
    provenance: {
      settings_source_sha256: CURRENT_FORM_SHA256,
      references: [
        { kind: "public_catalog", reference: `Exact active ${modelId} row in B066 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "manual_review", reference: `Anonymous models response sha256=${CURRENT_PUBLIC_MODELS_RESPONSE_SHA256}; current build ${SOURCE_BUILD_ID}; Veo no-reference T2V form, cost, option-value and sender joins are pinned in owner-veo-t2v-profile.ts.` },
        { kind: "frontend_static", reference: `veo-3.js build ${SOURCE_BUILD_ID}; exact non-Omni T2V controls, numeric upscale options, type=text and fixed 8-second duration`, sha256: CURRENT_FORM_SHA256 },
        { kind: "frontend_static", reference: `Settings2.js build ${SOURCE_BUILD_ID}; exact Veo form registration`, sha256: SETTINGS_REGISTRY_SHA256 },
        { kind: "frontend_static", reference: `app.js build ${SOURCE_BUILD_ID}; model selection and Veo route`, sha256: APP_SHA256 },
        { kind: "frontend_static", reference: `settings3.js build ${SOURCE_BUILD_ID}; current settings selection helper`, sha256: SETTINGS_HELPER_SHA256 },
        { kind: "frontend_static", reference: `cost2.js build ${SOURCE_BUILD_ID}; public upscale cost key and current fifth-argument override path`, sha256: COST_HELPER_SHA256 },
        { kind: "frontend_static", reference: `index7.js build ${SOURCE_BUILD_ID}; current video form route`, sha256: CHAT_ROUTE_SHA256 },
        { kind: "frontend_static", reference: `video.js build ${SOURCE_BUILD_ID}; selected video settings are submitted with the Veo request`, sha256: VIDEO_SENDER_SHA256 },
        { kind: "frontend_static", reference: `quality.js build ${SOURCE_BUILD_ID}; mapper preserves numeric option values 0, 1 and 2; value 3 is excluded for the non-Omni branch`, sha256: QUALITY_HELPER_SHA256 },
        { kind: "frontend_static", reference: `constants2.js build ${SOURCE_BUILD_ID}; exact veo_omni discriminator used by the form`, sha256: CONSTANTS_SHA256 },
        { kind: "manual_review", reference: "Source-only no-reference T2V profile. Public model defaults are not treated as effective UI defaults; references, provider acceptance, generated outputs and billing are unproven." }
      ],
      reviewed_at: reviewedAt
    },
    cost_parameter_bindings: COST_PARAMETER_BINDINGS,
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "upscale", "aspect_ratio", "video_duration"],
      properties: {
        prompt: { type: "string", min_length: PROMPT_MIN_LENGTH },
        upscale: { type: "integer", enum: [0, 1, 2] },
        aspect_ratio: { type: "string", enum: [...ASPECT_RATIOS] },
        video_duration: { type: "integer", enum: [8] }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: OPERATION_ID,
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: { upscale: "upscale", aspect_ratio: "aspect_ratio", video_duration: "video_duration" },
      fixed_settings: { type: "text", file_urls: [] },
      media_reference_fields: {}
    },
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: 4, max_value_depth: 1, max_serialized_bytes: 262_144, max_normalized_nodes: 32 }
  };
}

export function createOwnerVeoT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string
): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: MODEL_IDS.map((modelId) => buildOwnerVeoT2vGenerationContractInput(catalog, inventory, modelId, reviewedAt))
  });
}

export async function archiveOwnerVeoT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  inventory: MaplessSettingsInventory,
  reviewedAt: string,
  catalogDirectory?: string
) {
  return archiveGenerationContractRegistryV2(createOwnerVeoT2vGenerationRegistry(catalog, inventory, reviewedAt), catalogDirectory);
}

export function createOwnerVeoT2vProfile(modelId: OwnerVeoT2vModelId, catalogDirectory?: string): OwnerVeoT2vProfile {
  if (!MODEL_IDS.includes(modelId)) throw new Error("OWNER_VEO_T2V_MODEL_UNSUPPORTED");
  const catalog = loadSelectedDiscoveryCatalog(OWNER_VEO_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_VEO_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  assertSourceBinding(catalog, inventory);
  const registry = loadGenerationContractRegistryV2(OWNER_VEO_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const selected = registry.contracts.find((contract) => contract.model_id === modelId);
  const reviewedAt = selected?.provenance.reviewed_at ?? "";
  const expected = createOwnerVeoT2vGenerationRegistry(catalog, inventory, reviewedAt);
  if (!isDeepStrictEqual(registry, expected) || registry.contracts.length !== MODEL_IDS.length) {
    throw new Error("OWNER_VEO_T2V_PROFILE_MISMATCH");
  }
  for (const contractModelId of MODEL_IDS) {
    const contract = registry.contracts.find((entry) => entry.model_id === contractModelId);
    if (!contract || contract.schema_hash !== CONTRACT_SCHEMA_HASHES[contractModelId]) {
      throw new Error("OWNER_VEO_T2V_PROFILE_MISMATCH");
    }
  }
  if (!selected) throw new Error("OWNER_VEO_T2V_PROFILE_MISMATCH");
  const source: OwnerVeoT2vSourceContract = Object.freeze({
    status: "CURRENT_1791904852_SOURCE_JOIN_NO_REFERENCE_VEO_T2V",
    source_pins: SOURCE_PINS,
    identity: Object.freeze({ model_id: modelId, ai_name: AI_NAME, model_type: modelId, operation_id: OPERATION_ID }),
    contract_schema_hash: selected.schema_hash,
    controls: SOURCE_CONTROLS,
    no_reference_source: Object.freeze({ form_id: "veo-3", t2v_type: "text", public_file_count_limit: 0, file_urls: Object.freeze([] as const), references_in_caller_input: false }),
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
      caller_keys: COST_PARAMETER_FIELDS,
      bindings: COST_PARAMETER_BINDINGS,
      transport_owned_keys: Object.freeze(["model_type"] as const),
      cost2_u_call_arity: 5,
      fifth_argument_override_keys: Object.freeze(["mode"] as const),
      amount_or_quote: "UNPROVEN"
    }),
    defaults: "UNKNOWN",
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  const profile: OwnerVeoT2vProfile = Object.freeze({
    catalog,
    registry,
    registryVersion: OWNER_VEO_T2V_CONTRACT_REGISTRY_VERSION,
    source,
    modelId,
    aiName: AI_NAME,
    modelType: modelId,
    operationId: OPERATION_ID,
    variantId: selected.variant_id,
    costParameterFields: COST_PARAMETER_FIELDS,
    normalizeGenerationInput: normalizeGenerationInput,
    buildContractInput: (value: string) => buildOwnerVeoT2vGenerationContractInput(catalog, inventory, modelId, value)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerVeoT2vProfile(value: unknown): value is OwnerVeoT2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function assertSourceBinding(catalog: DiscoveryCatalogRepository, inventory: MaplessSettingsInventory): void {
  if (catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 ||
      inventory.public_catalog.version !== OWNER_VEO_T2V_PUBLIC_CATALOG_VERSION ||
      inventory.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256 || inventory.build.id !== SETTINGS_INVENTORY_BUILD_ID) {
    throw new Error("OWNER_VEO_T2V_SOURCE_UNAVAILABLE");
  }
  const expectedRowKeys = INVENTORY_MODEL_VALUE_SETTINGS_KEYS;
  for (const modelId of MODEL_IDS) {
    const model = catalog.getModel(modelId);
    const row = inventory.models.find((entry) => entry.model_id === modelId);
    const settings = model.settings;
    if (model.active !== true || model.ai_name !== AI_NAME || model.upstream_id !== modelId ||
        !model.operations.some((operation) => operation.id === OPERATION_ID && operation.output_modality === "video") ||
        !settings || settings.file_count_limit !== 0 || settings.min_prompt_length !== PROMPT_MIN_LENGTH ||
        !isDeepStrictEqual(settings.get_cost_params, COST_PARAMETER_FIELDS) ||
        !row || row.active !== true || row.ai_name !== AI_NAME || row.form_id !== "veo-3" ||
        row.form_binding_status !== "STRUCTURAL_MATCH" || row.settings_status !== "PUBLIC_SETTINGS_KNOWN" ||
        row.defaults_status !== "UNKNOWN" || row.runtime_usable !== false ||
        !isDeepStrictEqual(row.settings?.get_cost_params, COST_PARAMETER_FIELDS) ||
        !isDeepStrictEqual(row.model_value_settings_keys, expectedRowKeys) ||
        !isDeepStrictEqual(row.payload_field_keys, ["model_type"]) ||
        !isDeepStrictEqual(row.static_setting_defaults, {})) {
      throw new Error("OWNER_VEO_T2V_SOURCE_UNAVAILABLE");
    }
  }
  const form = inventory.forms.find((entry) => entry.form_id === "veo-3");
  if (!form || form.module_name !== "veo-3.js" || form.javascript.bytes !== INVENTORY_FORM_BYTES ||
      form.javascript.sha256 !== INVENTORY_FORM_SHA256 || form.javascript.parse_diagnostics !== 0 ||
      !isDeepStrictEqual(form.javascript.model_value_settings_keys, expectedRowKeys) ||
      !isDeepStrictEqual(form.javascript.static_setting_defaults, {})) {
    throw new Error("OWNER_VEO_T2V_SOURCE_UNAVAILABLE");
  }
}

function normalizeGenerationInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  const expectedKeys = ["attemptId", "prompt", "upscale", "aspect_ratio", "video_duration"];
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\0") !== expectedKeys.sort().join("\0")) {
    throw new Error("INVALID_REQUEST");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.attemptId !== "string" || !ATTEMPT_PATTERN.test(request.attemptId) ||
      typeof request.prompt !== "string" || request.prompt.trim().length < PROMPT_MIN_LENGTH ||
      PROMPT_CONTROL.test(request.prompt) || !isWellFormedUnicode(request.prompt) ||
      typeof request.upscale !== "number" || ![0, 1, 2].includes(request.upscale) ||
      typeof request.aspect_ratio !== "string" || !ASPECT_RATIOS.includes(request.aspect_ratio as OwnerVeoT2vAspectRatio) ||
      request.video_duration !== 8) {
    throw new Error("INVALID_REQUEST");
  }
  const parameters = Object.freeze({
    prompt: request.prompt,
    upscale: request.upscale,
    aspect_ratio: request.aspect_ratio,
    video_duration: request.video_duration
  });
  return Object.freeze({
    attemptId: request.attemptId,
    prompt: request.prompt,
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
