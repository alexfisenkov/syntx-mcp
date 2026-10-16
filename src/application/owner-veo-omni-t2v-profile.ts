import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import type { DiscoveryCatalogRepository, DiscoveryModelRecord } from "../catalog/discovery-catalog.js";
import {
  createGenerationContractRegistryV2,
  serializeGenerationContractRegistryV2,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";
import type { OwnerReviewedNoReferenceT2vNormalizedRequest, OwnerReviewedNoReferenceT2vProfile } from "./owner-hailuo01-t2v-profile.js";
import { getOwnerVeoOmniGenerationParameterReport, type OwnerVeoOmniParameterReport } from "./owner-veo-omni-parameters.js";

export const OWNER_VEO_OMNI_T2V_MODEL_ID = "veo_omni" as const;
export const OWNER_VEO_OMNI_T2V_PUBLIC_CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
export const OWNER_VEO_OMNI_T2V_CONTRACT_REGISTRY_VERSION = "sha256-e63187da912456292de27966a65d9bd110ccb405e658a648f34ca27eda3a253c.json" as const;
export const OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID = "veo-omni-t2v-source-reviewed-no-reference" as const;

const MODEL_ID = OWNER_VEO_OMNI_T2V_MODEL_ID;
const AI_NAME = "veo3" as const;
const OPERATION_ID = "generate-video" as const;
const REVIEWED_AT = "2026-10-16T16:42:12.000Z" as const;
const PUBLIC_MODELS_SHA256 = "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1" as const;
const CATALOG_FETCHED_AT = "2026-10-16T08:51:59.507Z" as const;
const MIN_PROMPT_LENGTH = 8;
const MAX_PROMPT_LENGTH = 50_000;
const MAX_VIDEO_DURATION = 10.2;
const MAX_FILE_SIZE = 1_048_576_000;
const UPSCALE_VALUES = Object.freeze([0, 1, 2, 3] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16"] as const);
const VIDEO_DURATIONS = Object.freeze([4, 6, 8, 10] as const);
const COST_PARAMETER_FIELDS = Object.freeze(["upscale", "video_duration"] as const);
const PUBLIC_ALLOWED_MEDIA_TYPES = Object.freeze(["images", "videos"] as const);
const PUBLIC_FILE_COUNT_LIMITS = Object.freeze({ images: 7, videos: 1 });
const T2V_FIXED_SETTINGS = Object.freeze({ type: "text", file_urls: Object.freeze([] as const) });
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const INPUT_KEYS = Object.freeze(["attemptId", "prompt", "upscale", "aspect_ratio", "video_duration"] as const);
const authenticProfiles = new WeakSet<object>();

export type OwnerVeoOmniT2vUpscale = (typeof UPSCALE_VALUES)[number];
export type OwnerVeoOmniT2vAspectRatio = (typeof ASPECT_RATIOS)[number];
export type OwnerVeoOmniT2vDuration = (typeof VIDEO_DURATIONS)[number];

export interface OwnerVeoOmniT2vGenerationInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly upscale: OwnerVeoOmniT2vUpscale;
  readonly aspect_ratio: OwnerVeoOmniT2vAspectRatio;
  readonly video_duration: OwnerVeoOmniT2vDuration;
}

export interface OwnerVeoOmniT2vSourceContract {
  readonly status: "CURRENT_1792156098_SOURCE_JOIN_OMNI_T2V";
  readonly source_pins: OwnerVeoOmniParameterReport["source_pins"];
  readonly identity: Readonly<{ model_id: typeof MODEL_ID; ai_name: typeof AI_NAME; model_type: typeof MODEL_ID; operation_id: typeof OPERATION_ID }>;
  readonly controls: OwnerVeoOmniParameterReport["controls"];
  readonly settings_selection: OwnerVeoOmniParameterReport["settings_selection"];
  readonly cost_projection: OwnerVeoOmniParameterReport["cost_projection"];
  readonly local_t2v_scope: Readonly<{
    type: "text";
    file_urls: readonly [];
    caller_reference_fields: false;
    scope: "LOCAL_T2V_ONLY_PUBLIC_REFERENCE_LIMITS_RETAINED";
  }>;
  readonly public_model_limits: Readonly<{
    allowed_media_types: typeof PUBLIC_ALLOWED_MEDIA_TYPES;
    file_count_limit: typeof PUBLIC_FILE_COUNT_LIMITS;
    max_file_size: typeof MAX_FILE_SIZE;
    min_prompt_length: typeof MIN_PROMPT_LENGTH;
    max_prompt_length: typeof MAX_PROMPT_LENGTH;
    max_video_duration: typeof MAX_VIDEO_DURATION;
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly duration_upscale_compatibility: "UNKNOWN_NOT_ENFORCED";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerVeoOmniT2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerVeoOmniT2vSourceContract> {}

/** Builds the single local T2V contract from the exact C19 public catalog and current static source report. */
export function buildOwnerVeoOmniT2vGenerationContractInput(
  catalog: DiscoveryCatalogRepository,
  reviewedAt: string
): GenerationContractV2Input {
  const report = assertSourceReport();
  assertCatalogBinding(catalog);
  if (!Number.isFinite(Date.parse(reviewedAt))) sourceUnavailable();
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const modules = report.source_pins.modules;
  const formHash = modules.veo_form;
  if (typeof formHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(formHash)) sourceUnavailable();
  return {
    variant_id: OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID,
    model_id: MODEL_ID,
    operation_id: OPERATION_ID,
    modality: "video",
    route: "video",
    ai_name: AI_NAME,
    model_type: MODEL_ID,
    status: "reviewed",
    provenance: {
      settings_source_sha256: formHash,
      references: [
        { kind: "public_catalog", reference: `Exact active veo_omni row in pinned C19 catalog ${catalogVersion}`, sha256: PUBLIC_MODELS_SHA256 },
        { kind: "frontend_static", reference: "veo-3.js build 1792156098; text T2V values and explicit controls", sha256: formHash },
        { kind: "frontend_static", reference: "constants2.js build 1792156098; Veo Omni model discriminator", sha256: modules.constants },
        { kind: "frontend_static", reference: "settings3.js build 1792156098; shared settings-store selection", sha256: modules.settings_helper },
        { kind: "frontend_static", reference: "index7.js build 1792156098; common video-route settings selection", sha256: modules.video_route },
        { kind: "frontend_static", reference: "video.js build 1792156098; generic video/generate sender", sha256: modules.video_sender },
        { kind: "manual_review", reference: "Local T2V profile fixes text mode and empty file_urls; public Omni reference capability and other input modes remain intact." }
      ],
      reviewed_at: reviewedAt
    },
    cost_parameter_bindings: {
      upscale: { kind: "parameter", parameter: "upscale" },
      video_duration: { kind: "parameter", parameter: "video_duration" }
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "upscale", "aspect_ratio", "video_duration"],
      properties: {
        prompt: { type: "string", min_length: MIN_PROMPT_LENGTH, max_length: MAX_PROMPT_LENGTH },
        upscale: { type: "integer", enum: [...UPSCALE_VALUES] },
        aspect_ratio: { type: "string", enum: [...ASPECT_RATIOS] },
        video_duration: { type: "integer", enum: [...VIDEO_DURATIONS] }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: OPERATION_ID,
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: { upscale: "upscale", aspect_ratio: "aspect_ratio", video_duration: "video_duration" },
      fixed_settings: { ...T2V_FIXED_SETTINGS },
      media_reference_fields: {}
    },
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4"] },
    limits: { max_parameters: 4, max_value_depth: 1, max_serialized_bytes: 262_144, max_normalized_nodes: 32 }
  };
}

/** Creates a deterministic in-memory one-contract registry; it does not archive or select runtime capability. */
export function createOwnerVeoOmniT2vGenerationRegistry(
  catalog: DiscoveryCatalogRepository,
  reviewedAt: string
): GenerationContractRegistryV2 {
  const contract = buildOwnerVeoOmniT2vGenerationContractInput(catalog, reviewedAt);
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [contract]
  });
}

/** Loads only the pinned public catalog and returns a source-authentic but non-dispatching profile. */
export function createOwnerVeoOmniT2vProfile(catalogDirectory?: string): OwnerVeoOmniT2vProfile {
  const { discoveryCatalog: catalog } = loadSelectedDiscoveryCatalog(OWNER_VEO_OMNI_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory);
  const report = assertSourceReport();
  const registry = createOwnerVeoOmniT2vGenerationRegistry(catalog, REVIEWED_AT);
  if (registry.contracts.length !== 1 || registry.contracts[0]?.model_id !== MODEL_ID ||
      registry.contracts[0]?.variant_id !== OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID) sourceUnavailable();
  const registryVersion = contentAddressedVersion(registry);
  const contract = registry.contracts[0]!;
  const source: OwnerVeoOmniT2vSourceContract = deepFreeze({
    status: "CURRENT_1792156098_SOURCE_JOIN_OMNI_T2V",
    source_pins: report.source_pins,
    identity: { model_id: MODEL_ID, ai_name: AI_NAME, model_type: MODEL_ID, operation_id: OPERATION_ID },
    controls: report.controls,
    settings_selection: report.settings_selection,
    cost_projection: report.cost_projection,
    local_t2v_scope: {
      type: "text",
      file_urls: [],
      caller_reference_fields: false,
      scope: "LOCAL_T2V_ONLY_PUBLIC_REFERENCE_LIMITS_RETAINED"
    },
    public_model_limits: {
      allowed_media_types: PUBLIC_ALLOWED_MEDIA_TYPES,
      file_count_limit: PUBLIC_FILE_COUNT_LIMITS,
      max_file_size: MAX_FILE_SIZE,
      min_prompt_length: MIN_PROMPT_LENGTH,
      max_prompt_length: MAX_PROMPT_LENGTH,
      max_video_duration: MAX_VIDEO_DURATION
    },
    effective_defaults: "UNKNOWN",
    duration_upscale_compatibility: "UNKNOWN_NOT_ENFORCED",
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
  const profile: OwnerVeoOmniT2vProfile = Object.freeze({
    catalog,
    registry,
    registryVersion,
    source,
    modelId: MODEL_ID,
    aiName: AI_NAME,
    modelType: MODEL_ID,
    operationId: OPERATION_ID,
    variantId: contract.variant_id,
    costParameterFields: COST_PARAMETER_FIELDS,
    normalizeGenerationInput: normalizeOwnerVeoOmniT2vGenerationInput,
    buildContractInput: (reviewedAt: string) => buildOwnerVeoOmniT2vGenerationContractInput(catalog, reviewedAt)
  });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerVeoOmniT2vProfile(value: unknown): value is OwnerVeoOmniT2vProfile {
  return value !== null && typeof value === "object" && authenticProfiles.has(value);
}

/** Accepts only explicit text/no-reference T2V controls; model identity and file bindings are profile-owned. */
export function normalizeOwnerVeoOmniT2vGenerationInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  const request = exactRecord(value, INPUT_KEYS);
  const prompt = request.prompt;
  const codePointLength = typeof prompt === "string" ? [...prompt].length : -1;
  if (typeof request.attemptId !== "string" || !ATTEMPT_PATTERN.test(request.attemptId) ||
      typeof prompt !== "string" || [...prompt.trim()].length < MIN_PROMPT_LENGTH || codePointLength > MAX_PROMPT_LENGTH ||
      PROMPT_CONTROL.test(prompt) || !isWellFormedUnicode(prompt) ||
      typeof request.upscale !== "number" || !Number.isSafeInteger(request.upscale) || !(UPSCALE_VALUES as readonly number[]).includes(request.upscale) ||
      typeof request.aspect_ratio !== "string" || !(ASPECT_RATIOS as readonly string[]).includes(request.aspect_ratio) ||
      typeof request.video_duration !== "number" || !Number.isSafeInteger(request.video_duration) || !(VIDEO_DURATIONS as readonly number[]).includes(request.video_duration)) {
    throw new Error("INVALID_REQUEST");
  }
  const parameters = Object.freeze({
    prompt,
    upscale: request.upscale as OwnerVeoOmniT2vUpscale,
    aspect_ratio: request.aspect_ratio as OwnerVeoOmniT2vAspectRatio,
    video_duration: request.video_duration as OwnerVeoOmniT2vDuration
  });
  return Object.freeze({
    attemptId: request.attemptId,
    prompt,
    parameters,
    semanticIntent: Object.freeze({ ...parameters })
  });
}

function assertSourceReport(): OwnerVeoOmniParameterReport {
  const report = getOwnerVeoOmniGenerationParameterReport();
  const pin = report.source_pins;
  const modules = pin.modules;
  const moduleKeys = Object.keys(modules).sort();
  const expectedModuleKeys = ["app", "constants", "quality_helper", "settings_helper", "veo_form", "video_route", "video_sender"];
  const moduleHashes = Object.values(modules);
  if (report.status !== "SOURCE_REVIEWED_STATIC_ONLY" || report.model_id !== MODEL_ID || report.ai_name !== AI_NAME ||
      pin.public_catalog_version !== OWNER_VEO_OMNI_T2V_PUBLIC_CATALOG_VERSION || pin.public_models_sha256 !== PUBLIC_MODELS_SHA256 ||
      pin.source_build_id !== "1792156098" || !isDeepStrictEqual(moduleKeys, expectedModuleKeys) ||
      moduleHashes.length !== expectedModuleKeys.length || moduleHashes.some((hash) => typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) ||
      !isDeepStrictEqual(report.controls.type, ["text", "image", "references"]) ||
      !isDeepStrictEqual(report.controls.upscale.values, UPSCALE_VALUES) ||
      !isDeepStrictEqual(report.controls.aspect_ratio, ASPECT_RATIOS) ||
      !isDeepStrictEqual(report.controls.video_duration, VIDEO_DURATIONS) ||
      !isDeepStrictEqual(report.settings_selection, {
        helper_effect: "GLOBAL_SETTINGS_STORE_NOT_PAYLOAD_RETURN",
        dispatch_owner: "VIDEO_ROUTE_NOT_OMNI_FORM",
        truthy_custom_payload: "REPLACE_SETTINGS_SHALLOW_SNAPSHOT",
        otherwise: "SHALLOW_SETTINGS_SNAPSHOT",
        custom_payload_reset: "NULL_ON_RESET_PAGE_SETTINGS",
        references: "OWNED_BINDING_REQUIRED"
      }) ||
      !isDeepStrictEqual(report.cost_projection, {
        caller_keys: ["upscale", "video_duration"],
        video_reference_extra: { mode: "video_ref" },
        mode_in_generation_settings: "NOT_ESTABLISHED_BY_COST_QUERY",
        amount_or_quote: "UNPROVEN"
      }) || report.runtime_usable !== false || report.dispatch_allowed !== false || report.backend_acceptance !== "UNPROVEN") {
    sourceUnavailable();
  }
  return report;
}

function assertCatalogBinding(catalog: DiscoveryCatalogRepository): DiscoveryModelRecord {
  const model = catalog.getModel(MODEL_ID);
  const settings = model.settings;
  if (catalog.fetched_at !== CATALOG_FETCHED_AT || catalog.source_hashes.models !== PUBLIC_MODELS_SHA256 ||
      model.active !== true || model.ai_name !== AI_NAME || model.upstream_id !== MODEL_ID ||
      !model.operations.some((operation) => operation.id === OPERATION_ID && operation.output_modality === "video") ||
      !settings || !isDeepStrictEqual(settings.allowed_media_types, PUBLIC_ALLOWED_MEDIA_TYPES) ||
      !isDeepStrictEqual(settings.file_count_limit, PUBLIC_FILE_COUNT_LIMITS) || settings.max_file_size !== MAX_FILE_SIZE ||
      settings.min_prompt_length !== MIN_PROMPT_LENGTH || settings.max_prompt_length !== MAX_PROMPT_LENGTH ||
      settings.max_video_duration !== MAX_VIDEO_DURATION ||
      !isDeepStrictEqual(settings.get_cost_params, ["upscale", "video_duration", "mode"])) sourceUnavailable();
  return model;
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== expectedKeys.length ||
        keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key) ||
          descriptors[key]?.enumerable !== true || !Object.hasOwn(descriptors[key]!, "value"))) throw new Error("INVALID_REQUEST");
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) snapshot[key] = descriptors[key]!.value;
    return snapshot;
  } catch {
    throw new Error("INVALID_REQUEST");
  }
}

function contentAddressedVersion(registry: GenerationContractRegistryV2): string {
  const serialized = serializeGenerationContractRegistryV2(registry);
  return `sha256-${createHash("sha256").update(serialized, "utf8").digest("hex")}.json`;
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

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function sourceUnavailable(): never {
  throw new Error("OWNER_VEO_OMNI_T2V_SOURCE_UNAVAILABLE");
}
