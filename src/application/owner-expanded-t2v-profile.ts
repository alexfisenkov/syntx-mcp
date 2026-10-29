import { isDeepStrictEqual, types } from "node:util";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
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
import type {
  OwnerReviewedNoReferenceT2vNormalizedRequest,
  OwnerReviewedNoReferenceT2vProfile
} from "./owner-hailuo01-t2v-profile.js";

export const OWNER_EXPANDED_T2V_PUBLIC_CATALOG_VERSION = "sha256-d1f43b4274fceb50c229711f093edb36c88e60e123da448a71ed256574f02009.json" as const;
export const OWNER_EXPANDED_T2V_SETTINGS_INVENTORY_VERSION = "sha256-a29a66acb812c92e00d9a125132de2be4dbb0728e4174d78d236936164abd880.json" as const;
export const OWNER_EXPANDED_T2V_CONTRACT_REGISTRY_VERSION = "sha256-3e56eaa1f8834896ce201689d5eb159194fe3edb8a16d4e97adae0938f912e07.json" as const;
const PUBLIC_MODELS_SHA256 = "sha256:9ad757694b6506005641d8cdb9e844107948236710d7c0b44173e6f9a2f9898b" as const;
const SENDER_SHA256 = "sha256:61c4817bf36754378a9602f4c3c3a2dc55a2a8a1862f909a9485411052a3291d" as const;
const BUILD_ID = "1793202992" as const;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export const OWNER_EXPANDED_T2V_MODEL_IDS = Object.freeze([
  "flux3_t2v", "happy_horse_t2v", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "text2video-4.5"
] as const);
export type OwnerExpandedT2vModelId = typeof OWNER_EXPANDED_T2V_MODEL_IDS[number];

interface ModelDefinition {
  readonly modelId: OwnerExpandedT2vModelId;
  readonly aiName: string;
  readonly formId: "flux-3-video" | "happy-horse" | "seedance" | "runway";
  readonly formModule: string;
  readonly formBytes: number;
  readonly formSha256: string;
  readonly fields: readonly Readonly<{ name: string; type: string; value: string | number | boolean; enum?: readonly (string | number | boolean)[]; minimum?: number; maximum?: number; step?: number; }>[];
  readonly costFields: readonly string[];
  readonly unresolvedControls: readonly string[];
  readonly sourceBranch: string;
}

const DEFINITIONS = Object.freeze([
  Object.freeze({ modelId: "flux3_t2v", aiName: "flux3_video", formId: "flux-3-video", formModule: "flux-3-video.js", formBytes: 6_225,
    formSha256: "sha256:aebde28281eed8cc7ba5a0e9f623106efa7b64f1e00839e161517106873f397b", costFields: ["video_duration", "resolution"],
    unresolvedControls: ["public cost key draft is not a form control and is excluded from cost bindings", "quote amount and backend acceptance are unknown"],
    sourceBranch: "CURRENT_FORM_T2V_BRANCH;duration=5..20;resolution=hd|fhd;aspect_ratio=auto|21:9|2:1|16:9|4:3|1:1|3:4|9:16;generate_audio=boolean",
    fields: [{ name: "video_duration", type: "integer", value: 5, minimum: 5, maximum: 20, step: 1 }, { name: "resolution", type: "string", value: "hd", enum: ["hd", "fhd"] },
      { name: "aspect_ratio", type: "string", value: "auto", enum: ["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"] },
      { name: "generate_audio", type: "boolean", value: true, enum: [true, false] }] }),
  Object.freeze({ modelId: "happy_horse_t2v", aiName: "happy_horse", formId: "happy-horse", formModule: "happy-horse.js", formBytes: 7_923,
    formSha256: "sha256:92d4ced5638fd01c8c2bd3855b9bfda437c08d26607d380218474136879fdbd4", costFields: ["video_duration", "resolution"],
    unresolvedControls: ["target model ID is not literal in form; source is family-level no-reference branch", "seed bounds and quote value are unknown", "quote amount is unknown"],
    sourceBranch: "CURRENT_FORM_FAMILY_NO_REFERENCE_BRANCH;EXACT_TARGET_ID_NOT_LITERAL;duration=integer_3_15;resolution=720P|1080P;aspect_ratio=16:9|9:16|1:1|4:3|3:4;native_audio=false_OUTSIDE_EDIT",
    fields: [{ name: "video_duration", type: "integer", value: 5, minimum: 3, maximum: 15, step: 1 }, { name: "resolution", type: "string", value: "720P", enum: ["720P", "1080P"] },
      { name: "aspect_ratio", type: "string", value: "16:9", enum: ["16:9", "9:16", "1:1", "4:3", "3:4"] }] }),
  Object.freeze({ modelId: "seedance-1.5-pro", aiName: "seedance", formId: "seedance", formModule: "seedance2.js", formBytes: 18_430,
    formSha256: "sha256:e61b39e1e98f365d59aedd4e894dddc6f77ff636d12293aa83becd971dd1df7a",
    costFields: ["video_duration", "resolution", "generate_audio"],
    unresolvedControls: ["effective defaults/carry-over remain caller supplied", "quote amount and backend acceptance are unknown"],
    sourceBranch: "CURRENT_MODEL_SWITCH_AND_MODEL_CONDITIONS;duration=5..12;resolution=720p_ONLY;aspect_ratio=21:9|16:9|4:3|1:1|3:4|9:16;generate_audio=boolean;camera_fixed=boolean",
    fields: [{ name: "video_duration", type: "integer", value: 5, minimum: 5, maximum: 12, step: 1 }, { name: "resolution", type: "string", value: "720p", enum: ["720p"] },
      { name: "aspect_ratio", type: "string", value: "16:9", enum: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
      { name: "generate_audio", type: "boolean", value: false, enum: [false, true] }, { name: "camera_fixed", type: "boolean", value: false, enum: [false, true] }] }),
  Object.freeze({ modelId: "seedance_pro", aiName: "seedance", formId: "seedance", formModule: "seedance2.js", formBytes: 18_430,
    formSha256: "sha256:e61b39e1e98f365d59aedd4e894dddc6f77ff636d12293aa83becd971dd1df7a", costFields: ["video_duration", "resolution"],
    unresolvedControls: ["effective defaults/carry-over remain caller supplied", "quote amount and backend acceptance are unknown"],
    sourceBranch: "CURRENT_MODEL_SWITCH_AND_MODEL_CONDITIONS;duration=5|10;resolution=480p|720p|1080p;aspect_ratio=21:9|16:9|4:3|1:1|3:4|9:16;mode/audio/camera_fixed cleared",
    fields: [{ name: "video_duration", type: "integer", value: 5, enum: [5, 10] }, { name: "resolution", type: "string", value: "1080p", enum: ["480p", "720p", "1080p"] },
      { name: "aspect_ratio", type: "string", value: "16:9", enum: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] }] }),
  Object.freeze({ modelId: "seedance_pro-fast", aiName: "seedance", formId: "seedance", formModule: "seedance2.js", formBytes: 18_430,
    formSha256: "sha256:e61b39e1e98f365d59aedd4e894dddc6f77ff636d12293aa83becd971dd1df7a", costFields: ["video_duration", "resolution"],
    unresolvedControls: ["effective defaults/carry-over remain caller supplied", "quote amount and backend acceptance are unknown"],
    sourceBranch: "CURRENT_MODEL_SWITCH_AND_MODEL_CONDITIONS;duration=5..12;resolution=480p|720p|1080p;aspect_ratio=16:9|4:3|1:1|3:4|9:16;mode/audio/camera_fixed cleared",
    fields: [{ name: "video_duration", type: "integer", value: 5, minimum: 5, maximum: 12, step: 1 }, { name: "resolution", type: "string", value: "1080p", enum: ["480p", "720p", "1080p"] },
      { name: "aspect_ratio", type: "string", value: "16:9", enum: ["16:9", "4:3", "1:1", "3:4", "9:16"] }] }),
  Object.freeze({ modelId: "text2video-4.5", aiName: "runway", formId: "runway", formModule: "runway.js", formBytes: 19_810,
    formSha256: "sha256:c63f6f9a9b97f1d3641d29ca5a7b0bfe82f3821a365055c0d63e07b6d278b7d6", costFields: ["video_duration"],
    unresolvedControls: ["wire duration encoding is not validated against backend", "quote amount is unknown"],
    sourceBranch: "CURRENT_FORM_MODEL_SWITCH_AND_RATIO_MAPPING;duration=5.0|8.0|10.0;aspect_ratio=16:9→169|9:16→916;no_file_urls",
    fields: [{ name: "video_duration", type: "string", value: "5.0", enum: ["5.0", "8.0", "10.0"] },
      { name: "aspect_ratio", type: "string", value: "169", enum: ["169", "916"] }] })
] satisfies readonly ModelDefinition[]);

export interface OwnerExpandedT2vSourceContract {
  readonly status: "CURRENT_STATIC_FORM_SOURCE_REVIEWED_CONTROLS_WITH_LIMITATIONS";
  readonly source_pins: Readonly<{ public_catalog_version: typeof OWNER_EXPANDED_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: string; settings_inventory_version: typeof OWNER_EXPANDED_T2V_SETTINGS_INVENTORY_VERSION;
    build_id: typeof BUILD_ID; form_module: string; form_bytes: number; form_sha256: string;
    sender_module: "video.js"; sender_bytes: 8_689; sender_sha256: typeof SENDER_SHA256 }>;
  readonly identity: Readonly<{ model_id: OwnerExpandedT2vModelId; ai_name: string; model_type: OwnerExpandedT2vModelId; operation_id: "generate-video" }>;
  readonly controls: Readonly<{ exact_reviewed_tuple: Readonly<Record<string, string | number | boolean>>;
    accepted_source_choices: Readonly<Record<string, readonly (string | number | boolean)[]>>;
    numeric_bounds: Readonly<Record<string, Readonly<{ minimum: number; maximum: number; step?: number }>>>;
    unresolved_controls: readonly string[];
    effective_defaults: "UNKNOWN_CALLER_MUST_SUPPLY_EXPLICIT_VALUES" }>;
  readonly wire_observation: Readonly<{ source: "CURRENT_STATIC_SHARED_SENDER"; method: "POST"; path: "/api/v1/video/generate";
    query_ai_name: string; settings_keys: readonly string[]; file_urls: readonly []; no_references: true }>;
  readonly cost_projection: Readonly<{ public_keys: readonly string[]; caller_keys: readonly string[]; omitted_public_keys: readonly string[];
    amount_or_quote: "UNPROVEN" }>;
  readonly output: Readonly<{ mime_type: "video/mp4"; evidence: "LOCAL_VIDEO_DECODER_PROFILE_ONLY_NOT_CURRENT_SOURCE_OR_PROVIDER_PROOF" }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerExpandedT2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerExpandedT2vSourceContract> {
  readonly modelId: OwnerExpandedT2vModelId;
}

const authenticProfiles = new WeakSet<object>();

export function createOwnerExpandedT2vGenerationRegistry(catalog: DiscoveryCatalogRepository, reviewedAt: string): GenerationContractRegistryV2 {
  if (!Number.isFinite(Date.parse(reviewedAt)) || catalog.source_hashes.models !== PUBLIC_MODELS_SHA256) throw new Error("OWNER_EXPANDED_T2V_SOURCE_UNAVAILABLE");
  const contracts = DEFINITIONS.map((definition) => buildContractInput(catalog, definition, reviewedAt));
  return createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: catalogVersion(catalog),
    source_hashes: catalog.source_hashes, contracts });
}

export async function archiveOwnerExpandedT2vGenerationRegistry(catalogDirectory?: string, reviewedAt = "2026-10-29T00:00:00.000Z") {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_EXPANDED_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  return archiveGenerationContractRegistryV2(createOwnerExpandedT2vGenerationRegistry(catalog, reviewedAt), catalogDirectory);
}

export function createOwnerExpandedT2vProfiles(catalogDirectory?: string): ReadonlyMap<OwnerExpandedT2vModelId, OwnerExpandedT2vProfile> {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_EXPANDED_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const settings = loadMaplessSettingsInventoryVersion(OWNER_EXPANDED_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  if (settings.build.id !== BUILD_ID || settings.public_catalog.models_sha256 !== PUBLIC_MODELS_SHA256) throw new Error("OWNER_EXPANDED_T2V_SETTINGS_SOURCE_UNAVAILABLE");
  const registry = loadGenerationContractRegistryV2(OWNER_EXPANDED_T2V_CONTRACT_REGISTRY_VERSION, catalogDirectory);
  const reviewedAt = registry.contracts[0]?.provenance.reviewed_at ?? "";
  const expected = createOwnerExpandedT2vGenerationRegistry(catalog, reviewedAt);
  if (!isDeepStrictEqual(registry, expected) || registry.contracts.length !== DEFINITIONS.length) throw new Error("OWNER_EXPANDED_T2V_REGISTRY_MISMATCH");
  const result = new Map<OwnerExpandedT2vModelId, OwnerExpandedT2vProfile>();
  for (const definition of DEFINITIONS) {
    const profile: OwnerExpandedT2vProfile = Object.freeze({
      catalog, registry, registryVersion: OWNER_EXPANDED_T2V_CONTRACT_REGISTRY_VERSION,
      source: buildSource(catalog, definition), modelId: definition.modelId, aiName: definition.aiName,
      modelType: definition.modelId, operationId: "generate-video", variantId: variantId(definition.modelId),
      costParameterFields: Object.freeze([...definition.costFields]),
      normalizeGenerationInput: (value: unknown) => normalizeInput(value, definition),
      buildContractInput: (at: string) => buildContractInput(catalog, definition, at)
    });
    authenticProfiles.add(profile);
    result.set(definition.modelId, profile);
  }
  return result;
}

export function isAuthenticOwnerExpandedT2vProfile(value: unknown): value is OwnerExpandedT2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

function buildSource(catalog: DiscoveryCatalogRepository, definition: ModelDefinition): OwnerExpandedT2vSourceContract {
  const model = catalog.getModel(definition.modelId);
  if (model.active !== true || model.ai_name !== definition.aiName || model.upstream_id !== definition.modelId ||
      !model.operations.some((operation) => operation.id === "generate-video" && operation.output_modality === "video")) {
    throw new Error("OWNER_EXPANDED_T2V_MODEL_BINDING_INVALID");
  }
  const publicCost = Array.isArray(model.settings?.get_cost_params) ? model.settings.get_cost_params.filter((x): x is string => typeof x === "string") : [];
  return Object.freeze({
    status: "CURRENT_STATIC_FORM_SOURCE_REVIEWED_CONTROLS_WITH_LIMITATIONS",
    source_pins: Object.freeze({ public_catalog_version: OWNER_EXPANDED_T2V_PUBLIC_CATALOG_VERSION,
      public_models_sha256: catalog.source_hashes.models, settings_inventory_version: OWNER_EXPANDED_T2V_SETTINGS_INVENTORY_VERSION,
      build_id: BUILD_ID, form_module: definition.formModule, form_bytes: definition.formBytes, form_sha256: definition.formSha256,
      sender_module: "video.js", sender_bytes: 8_689, sender_sha256: SENDER_SHA256 }),
    identity: Object.freeze({ model_id: definition.modelId, ai_name: definition.aiName, model_type: definition.modelId, operation_id: "generate-video" }),
    controls: Object.freeze({ exact_reviewed_tuple: Object.freeze(Object.fromEntries(definition.fields.map((field) => [field.name, field.value]))),
      accepted_source_choices: Object.freeze(Object.fromEntries(definition.fields.flatMap((field) => field.enum ? [[field.name, Object.freeze([...field.enum])]] : []))),
      numeric_bounds: Object.freeze(Object.fromEntries(definition.fields.flatMap((field) => field.minimum !== undefined && field.maximum !== undefined
        ? [[field.name, Object.freeze({ minimum: field.minimum, maximum: field.maximum, ...(field.step === undefined ? {} : { step: field.step }) })]] : []))),
      unresolved_controls: Object.freeze([...definition.unresolvedControls]), effective_defaults: "UNKNOWN_CALLER_MUST_SUPPLY_EXPLICIT_VALUES" }),
    wire_observation: Object.freeze({ source: "CURRENT_STATIC_SHARED_SENDER", method: "POST", path: "/api/v1/video/generate",
      query_ai_name: definition.aiName, settings_keys: Object.freeze([...new Set(["model_type", ...definition.fields.map((field) => field.name), "file_urls"])]),
      file_urls: Object.freeze([]) as readonly [], no_references: true }),
    cost_projection: Object.freeze({ public_keys: Object.freeze(publicCost), caller_keys: Object.freeze([...definition.costFields]),
      omitted_public_keys: Object.freeze(publicCost.filter((key) => !definition.costFields.includes(key))), amount_or_quote: "UNPROVEN" }),
    output: Object.freeze({ mime_type: "video/mp4", evidence: "LOCAL_VIDEO_DECODER_PROFILE_ONLY_NOT_CURRENT_SOURCE_OR_PROVIDER_PROOF" }),
    runtime_usable: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN"
  });
}

function buildContractInput(catalog: DiscoveryCatalogRepository, definition: ModelDefinition, reviewedAt: string): GenerationContractV2Input {
  return {
    variant_id: variantId(definition.modelId), model_id: definition.modelId, operation_id: "generate-video", modality: "video",
    route: "video", ai_name: definition.aiName, model_type: definition.modelId, status: "reviewed",
    provenance: { settings_source_sha256: definition.formSha256, reviewed_at: reviewedAt,
      references: [
        { kind: "public_catalog", reference: `Active model binding in ${OWNER_EXPANDED_T2V_PUBLIC_CATALOG_VERSION}`, sha256: catalog.source_hashes.models },
        { kind: "frontend_static", reference: `${definition.formModule} build ${BUILD_ID}; source-supported control choices and limitations; ${definition.sourceBranch}`, sha256: definition.formSha256 },
        { kind: "frontend_static", reference: `video.js build ${BUILD_ID}; shared POST video/generate; query ai_name; settings/file_urls projection`, sha256: SENDER_SHA256 },
        { kind: "manual_review", reference: `Explicit limitations: ${definition.unresolvedControls.join("; ")}; effective defaults, quote amount, output MIME source and backend/provider acceptance remain unproven.` }
      ] },
    parameters: { type: "object", additional_properties: false,
      required: ["prompt", ...definition.fields.map((field) => field.name)],
      properties: Object.fromEntries([ ["prompt", { type: "string", min_length: 1, max_length: 5_000 } ], ...definition.fields.map((field) => [field.name, {
        type: field.type as "string" | "integer" | "number" | "boolean", ...(field.enum === undefined ? {} : { enum: [...field.enum] }),
        ...(field.minimum === undefined ? {} : { minimum: field.minimum }), ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
        ...(field.step === undefined ? {} : { step: field.step })
      }]) ]),
      conditions: [], conditional_enums: [] },
    wire: { dispatch_action: "generate-video", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: Object.fromEntries(definition.fields.map((field) => [field.name, field.name])),
      fixed_settings: { file_urls: [] }, media_reference_fields: {} },
    cost_parameter_bindings: Object.fromEntries(definition.costFields.map((field) => [field, { kind: "parameter", parameter: field }])),
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: definition.fields.length + 1, max_value_depth: 1, max_serialized_bytes: 32_768, max_normalized_nodes: 32 }
  };
}

function normalizeInput(value: unknown, definition: ModelDefinition): OwnerReviewedNoReferenceT2vNormalizedRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("INVALID_REQUEST");
  const required = ["attemptId", "model_id", "prompt", ...definition.fields.map((field) => field.name)].sort();
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) || Object.keys(value).sort().join("\0") !== required.join("\0")) throw new Error("INVALID_REQUEST");
  const request = value as Record<string, unknown>;
  if (request.model_id !== definition.modelId || typeof request.attemptId !== "string" || !ATTEMPT_PATTERN.test(request.attemptId) || typeof request.prompt !== "string" ||
      request.prompt.trim().length === 0 || request.prompt.length > 5_000 || PROMPT_CONTROL.test(request.prompt) ||
      definition.fields.some((field) => !isAcceptedFieldValue(field, request[field.name]))) throw new Error("INVALID_REQUEST");
  const parameters = Object.freeze({ prompt: request.prompt, ...Object.fromEntries(definition.fields.map((field) => [field.name, request[field.name]])) });
  return Object.freeze({ attemptId: request.attemptId, prompt: request.prompt, parameters,
    semanticIntent: Object.freeze({ prompt: request.prompt, ...Object.fromEntries(definition.fields.map((field) => [field.name, request[field.name]])) }) });
}

function isAcceptedFieldValue(field: ModelDefinition["fields"][number], value: unknown): boolean {
  if (field.type === "string" && typeof value !== "string" || field.type === "boolean" && typeof value !== "boolean" ||
      (field.type === "integer" || field.type === "number") && typeof value !== "number") return false;
  if (field.type === "integer" && !Number.isInteger(value)) return false;
  if (field.enum !== undefined && !field.enum.includes(value as string | number | boolean)) return false;
  if (typeof value === "number" && (field.minimum !== undefined && value < field.minimum || field.maximum !== undefined && value > field.maximum ||
      field.step !== undefined && (value - (field.minimum ?? 0)) % field.step !== 0)) return false;
  return true;
}

function variantId(modelId: OwnerExpandedT2vModelId): string { return `expanded-t2v-${modelId}-noref-controls-v2`; }
function catalogVersion(catalog: DiscoveryCatalogRepository): string { return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`; }
