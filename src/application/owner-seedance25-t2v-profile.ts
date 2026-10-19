import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { createGenerationContractRegistryV2, type GenerationContractRegistryV2, type GenerationContractV2Input,
  serializeGenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import type { OwnerReviewedNoReferenceT2vNormalizedRequest, OwnerReviewedNoReferenceT2vProfile }
  from "./owner-hailuo01-t2v-profile.js";

export const OWNER_SEEDANCE25_T2V_CONTRACT_VARIANT_ID = "seedance-2.5-omni-t2v-source-reviewed-no-media-720p-5s" as const;
export const OWNER_SEEDANCE25_T2V_PUBLIC_CATALOG_VERSION =
  "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const MODEL_ID = "seedance-2.5" as const;
const AI_NAME = "seedance" as const;
const OPERATION_ID = "generate-video" as const;
const PUBLIC_MODELS_SHA256 = "sha256:cb2581608a551f4bc783af85d2edd8cca6a926f8f84f41e3382885ba9a3cf054" as const;
const CATALOG_MODELS_CANONICAL_SHA256 = "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1" as const;
const FORM_SHA256 = "sha256:7f2ab55df709707cfe5c40c3ee01ad9c9bad8eb812f75bbb21ce54875ea75d93" as const;
const COST2_SHA256 = "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const;
const ENRICH_SHA256 = "sha256:09611977302662f75f1076cefed631360c1734ba07f7795fe289f562dee49ba6" as const;
const VIDEO_SHA256 = "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b" as const;
const NEW_SESSION_SHA256 = "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc" as const;
const PROMPT_LOCAL_UTF16_LIMIT = 5_000;
const COST_FIELDS = Object.freeze(["video_duration", "duration", "mode", "size", "resolution"] as const);
const COST_PARAMETER_BINDINGS = Object.freeze({
  video_duration: Object.freeze({ kind: "parameter", parameter: "video_duration" }),
  duration: Object.freeze({ kind: "literal", value: 0 }),
  mode: Object.freeze({ kind: "literal", value: "omni-references" }),
  size: Object.freeze({ kind: "parameter", parameter: "aspect_ratio" }),
  resolution: Object.freeze({ kind: "parameter", parameter: "resolution" })
});
const authenticProfiles = new WeakSet<object>();

export interface OwnerSeedance25T2vSourceContract {
  readonly status: "CURRENT_1792363638_FORM_AND_PUBLIC_ROW_SOURCE_CONTRACT_PROVIDER_UNPROVEN";
  readonly source_pins: Readonly<{
    public_catalog_version: typeof OWNER_SEEDANCE25_T2V_PUBLIC_CATALOG_VERSION;
    public_models_sha256: typeof PUBLIC_MODELS_SHA256;
    catalog_models_canonical_sha256: typeof CATALOG_MODELS_CANONICAL_SHA256;
    build_id: "1792363638";
    form_module: "seedance2.js";
    form_bytes: 17_281;
    form_sha256: typeof FORM_SHA256;
    cost_helper_module: "cost2.js";
    cost_helper_sha256: typeof COST2_SHA256;
    model_validator_helper_module: "useEnrichFileMetaWithDuration.js";
    model_validator_helper_bytes: 45_241;
    model_validator_helper_sha256: typeof ENRICH_SHA256;
    shared_video_sender_module: "video.js";
    shared_video_sender_sha256: typeof VIDEO_SHA256;
    new_session_helper_module: "NewSessionButton.js";
    new_session_helper_bytes: 2_052;
    new_session_helper_sha256: typeof NEW_SESSION_SHA256;
  }>;
  readonly identity: Readonly<{ model_id: typeof MODEL_ID; ai_name: typeof AI_NAME; model_type: typeof MODEL_ID; operation_id: typeof OPERATION_ID }>;
  readonly controls: Readonly<{
    mode: Readonly<{ value: "omni-references"; allowed_initial_candidates: readonly ["omni-references"] }>;
    resolution: Readonly<{ value: "720p"; allowed_initial_candidates: readonly ["720p"] }>;
    aspect_ratio: Readonly<{ value: "16:9"; allowed_initial_candidates: readonly ["16:9"] }>;
    video_duration: Readonly<{ value: 5; unit: "INTEGER_SECONDS" }>;
    generate_audio: Readonly<{ value: true }>;
    camera_fixed: Readonly<{ value: "OMITTED_UNDEFINED_INITIALIZER" }>;
    prompt: Readonly<{ source_max_length: 35_000; local_bound_utf16: typeof PROMPT_LOCAL_UTF16_LIMIT;
      local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" }>;
  }>;
  readonly form_validation: Readonly<{
    model_type_media_rule: "ONLY_BRANCHES_FOR_SEEDANCE_2_0";
    mode_media_rules: Readonly<{ frames: "REQUIRES_FIRST_FRAME_WHEN_FRAMES_MODE_ACTIVE"; extend: "REQUIRES_VIDEO_WHEN_EXTEND_MODE_ACTIVE";
      edit: "REQUIRES_VIDEO_WHEN_EDIT_MODE_ACTIVE" }>;
    initializer_mode_disposition: "MINI_REJECTED_FOR_QUOTE400_MODEL_SWITCH_CANDIDATE";
    no_media_candidate_validation: "UNCONFIRMED_FOR_OMNI_REFERENCES";
    mode_change_evidence: Readonly<{
      form_helper_imports: "S as w, M as B, o as q";
      form_mode_helper_offset: readonly [4295, 4341];
      form_model_watcher_offset: readonly [5328, 6937];
      seedance25_mode_assignment_offset: readonly [6694, 6711];
      helper_export_aliases: "S as Ka, M as zt, o as ja";
      helper_model_literal: "seedance-2.5";
      helper_mode_literal: "omni-references";
      helper_compare_model_literal: "seedance-2.0";
      helper_compare_mode_literal: "mini";
    }>;
    backend_validation: "UNPROVEN";
  }>;
  readonly wire_observation: Readonly<{
    method: "POST"; path: "/api/v1/video/generate"; query: Readonly<{ ai_name: typeof AI_NAME }>;
    settings_keys: readonly ["model_type", "mode", "resolution", "aspect_ratio", "video_duration", "generate_audio", "file_urls"];
    no_media: true; camera_fixed_omitted: true;
  }>;
  readonly cost_projection: Readonly<{
    public_row_keys: typeof COST_FIELDS; caller_keys: typeof COST_FIELDS; bindings: typeof COST_PARAMETER_BINDINGS;
    candidate_values: Readonly<{ video_duration: 5; duration: 0; mode: "omni-references"; size: "16:9"; resolution: "720p" }>;
    candidate_scope: "EXPLICIT_MODEL_WATCHER_MODE_NOT_FULL_POST_WATCHER_STATE";
    amount_or_quote: "UNPROVEN";
  }>;
  readonly public_bounds: Readonly<{ active: true; max_prompt_length: 35_000; max_video_duration: 30; min_video_duration: 2;
    max_video_file_size: 104_857_600; max_video_fps: 60; min_video_fps: 23; max_images: 30; max_videos: 10; max_audios: 10 }>;
  readonly defaults: "FORM_INITIALIZER_CANDIDATE_NOT_EFFECTIVE_DEFAULT_PROOF";
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerSeedance25T2vProfile extends OwnerReviewedNoReferenceT2vProfile<OwnerSeedance25T2vSourceContract> {}

const SOURCE: OwnerSeedance25T2vSourceContract = Object.freeze({
  status: "CURRENT_1792363638_FORM_AND_PUBLIC_ROW_SOURCE_CONTRACT_PROVIDER_UNPROVEN",
  source_pins: Object.freeze({ public_catalog_version: OWNER_SEEDANCE25_T2V_PUBLIC_CATALOG_VERSION,
    public_models_sha256: PUBLIC_MODELS_SHA256, catalog_models_canonical_sha256: CATALOG_MODELS_CANONICAL_SHA256,
    build_id: "1792363638", form_module: "seedance2.js", form_bytes: 17_281,
    form_sha256: FORM_SHA256, cost_helper_module: "cost2.js", cost_helper_sha256: COST2_SHA256,
    model_validator_helper_module: "useEnrichFileMetaWithDuration.js", model_validator_helper_bytes: 45_241,
    model_validator_helper_sha256: ENRICH_SHA256, shared_video_sender_module: "video.js", shared_video_sender_sha256: VIDEO_SHA256,
    new_session_helper_module: "NewSessionButton.js", new_session_helper_bytes: 2_052, new_session_helper_sha256: NEW_SESSION_SHA256 }),
  identity: Object.freeze({ model_id: MODEL_ID, ai_name: AI_NAME, model_type: MODEL_ID, operation_id: OPERATION_ID }),
  controls: Object.freeze({
    mode: Object.freeze({ value: "omni-references", allowed_initial_candidates: Object.freeze(["omni-references"] as const) }),
    resolution: Object.freeze({ value: "720p", allowed_initial_candidates: Object.freeze(["720p"] as const) }),
    aspect_ratio: Object.freeze({ value: "16:9", allowed_initial_candidates: Object.freeze(["16:9"] as const) }),
    video_duration: Object.freeze({ value: 5, unit: "INTEGER_SECONDS" as const }), generate_audio: Object.freeze({ value: true as const }),
    camera_fixed: Object.freeze({ value: "OMITTED_UNDEFINED_INITIALIZER" as const }),
    prompt: Object.freeze({ source_max_length: 35_000, local_bound_utf16: PROMPT_LOCAL_UTF16_LIMIT, local_bound_kind: "LOCAL_RESOURCE_BOUND_UTF16" as const })
  }),
  form_validation: Object.freeze({ model_type_media_rule: "ONLY_BRANCHES_FOR_SEEDANCE_2_0" as const,
    mode_media_rules: Object.freeze({ frames: "REQUIRES_FIRST_FRAME_WHEN_FRAMES_MODE_ACTIVE" as const,
      extend: "REQUIRES_VIDEO_WHEN_EXTEND_MODE_ACTIVE" as const, edit: "REQUIRES_VIDEO_WHEN_EDIT_MODE_ACTIVE" as const }),
    initializer_mode_disposition: "MINI_REJECTED_FOR_QUOTE400_MODEL_SWITCH_CANDIDATE" as const,
    no_media_candidate_validation: "UNCONFIRMED_FOR_OMNI_REFERENCES" as const,
    mode_change_evidence: Object.freeze({ form_helper_imports: "S as w, M as B, o as q" as const,
      form_mode_helper_offset: Object.freeze([4295, 4341] as const), form_model_watcher_offset: Object.freeze([5328, 6937] as const),
      seedance25_mode_assignment_offset: Object.freeze([6694, 6711] as const), helper_export_aliases: "S as Ka, M as zt, o as ja" as const,
      helper_model_literal: "seedance-2.5" as const, helper_mode_literal: "omni-references" as const,
      helper_compare_model_literal: "seedance-2.0" as const, helper_compare_mode_literal: "mini" as const }),
    backend_validation: "UNPROVEN" as const }),
  wire_observation: Object.freeze({ method: "POST" as const, path: "/api/v1/video/generate" as const,
    query: Object.freeze({ ai_name: AI_NAME }),
    settings_keys: Object.freeze(["model_type", "mode", "resolution", "aspect_ratio", "video_duration", "generate_audio", "file_urls"] as const),
    no_media: true as const, camera_fixed_omitted: true as const }),
  cost_projection: Object.freeze({ public_row_keys: COST_FIELDS, caller_keys: COST_FIELDS, bindings: COST_PARAMETER_BINDINGS,
    candidate_values: Object.freeze({ video_duration: 5, duration: 0, mode: "omni-references" as const, size: "16:9" as const, resolution: "720p" as const }),
    candidate_scope: "EXPLICIT_MODEL_WATCHER_MODE_NOT_FULL_POST_WATCHER_STATE" as const,
    amount_or_quote: "UNPROVEN" as const }),
  public_bounds: Object.freeze({ active: true as const, max_prompt_length: 35_000, max_video_duration: 30, min_video_duration: 2,
    max_video_file_size: 104_857_600, max_video_fps: 60, min_video_fps: 23, max_images: 30, max_videos: 10, max_audios: 10 }),
  defaults: "FORM_INITIALIZER_CANDIDATE_NOT_EFFECTIVE_DEFAULT_PROOF" as const,
  backend_acceptance: "UNPROVEN" as const
});

export function buildOwnerSeedance25T2vGenerationContractInput(catalog: DiscoveryCatalogRepository, reviewedAt: string): GenerationContractV2Input {
  assertCatalog(catalog);
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("OWNER_SEEDANCE25_T2V_SOURCE_UNAVAILABLE");
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  return {
    variant_id: OWNER_SEEDANCE25_T2V_CONTRACT_VARIANT_ID, model_id: MODEL_ID, operation_id: OPERATION_ID, modality: "video", route: "video",
    ai_name: AI_NAME, model_type: MODEL_ID, status: "reviewed",
    provenance: { settings_source_sha256: FORM_SHA256, references: [
      { kind: "public_catalog", reference: `Seedance 2.5 exact model row in pinned public catalog ${catalogVersion}; source GET response sha256=${PUBLIC_MODELS_SHA256}`, sha256: CATALOG_MODELS_CANONICAL_SHA256 },
      { kind: "frontend_static", reference: "seedance2.js build 1792363638; initializer mini is superseded for the model-switch candidate by mode helper O [4295,4341], watcher [5328,6937], and Seedance 2.5 assignment [6694,6711]", sha256: FORM_SHA256 },
      { kind: "frontend_static", reference: "useEnrichFileMetaWithDuration.js build 1792363638; form aliases S as w/M as B/o as q join through S as Ka/M as zt/o as ja to seedance-2.5/omni-references/seedance-2.0", sha256: ENRICH_SHA256 },
      { kind: "frontend_static", reference: "cost2.js current source; five current public cost fields and inline duration/size mapping", sha256: COST2_SHA256 },
      { kind: "frontend_static", reference: "video.js generic video route/sender binding", sha256: VIDEO_SHA256 },
      { kind: "frontend_static", reference: "NewSessionButton.js typed file_urls merger and video MIME role fallback", sha256: NEW_SESSION_SHA256 },
      { kind: "manual_review", reference: "No-media validation for the explicit omni-references candidate is unconfirmed; backend and provider acceptance remain unproven. The earlier mini initializer candidate was rejected for the recorded quote-400 model-switch path." }
    ], reviewed_at: reviewedAt },
    cost_parameter_bindings: COST_PARAMETER_BINDINGS,
    parameters: { type: "object", additional_properties: false,
      required: ["prompt", "resolution", "aspect_ratio", "video_duration", "generate_audio", "mode"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: PROMPT_LOCAL_UTF16_LIMIT },
        resolution: { type: "string", enum: ["720p"] }, aspect_ratio: { type: "string", enum: ["16:9"] },
        video_duration: { type: "integer", enum: [5] }, generate_audio: { type: "boolean", enum: [true] }, mode: { type: "string", enum: ["omni-references"] }
      }, conditions: [], conditional_enums: [] },
    wire: { dispatch_action: OPERATION_ID, input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { resolution: "resolution", aspect_ratio: "aspect_ratio", video_duration: "video_duration",
        generate_audio: "generate_audio", mode: "mode" }, fixed_settings: { file_urls: [] }, media_reference_fields: {} },
    output: { decoder_profile: "syntx-owner-video-mp4", mime_types: ["video/mp4", "video/quicktime"] },
    limits: { max_parameters: 6, max_value_depth: 1, max_serialized_bytes: 131_072, max_normalized_nodes: 20_000 }
  };
}

export function createOwnerSeedance25T2vGenerationRegistry(catalog: DiscoveryCatalogRepository, reviewedAt: string): GenerationContractRegistryV2 {
  return createGenerationContractRegistryV2({ schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes, contracts: [buildOwnerSeedance25T2vGenerationContractInput(catalog, reviewedAt)] });
}

export function createOwnerSeedance25T2vProfile(catalogDirectory?: string, reviewedAt = "2026-10-19T15:00:01.000Z"): OwnerSeedance25T2vProfile {
  const catalog = loadSelectedDiscoveryCatalog(OWNER_SEEDANCE25_T2V_PUBLIC_CATALOG_VERSION, catalogDirectory).discoveryCatalog;
  const registry = createOwnerSeedance25T2vGenerationRegistry(catalog, reviewedAt);
  const version = contentAddressedVersion(registry);
  const profile: OwnerSeedance25T2vProfile = Object.freeze({ catalog, registry, registryVersion: version, source: SOURCE,
    modelId: MODEL_ID, aiName: AI_NAME, modelType: MODEL_ID, operationId: OPERATION_ID,
    variantId: OWNER_SEEDANCE25_T2V_CONTRACT_VARIANT_ID, costParameterFields: COST_FIELDS,
    normalizeGenerationInput, buildContractInput: (value: string) => buildOwnerSeedance25T2vGenerationContractInput(catalog, value) });
  authenticProfiles.add(profile);
  return profile;
}

export function isAuthenticOwnerSeedance25T2vProfile(value: unknown): value is OwnerSeedance25T2vProfile {
  return !!value && typeof value === "object" && !types.isProxy(value) && authenticProfiles.has(value);
}

function normalizeGenerationInput(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  const expected = ["attemptId", "prompt", "resolution", "aspect_ratio", "video_duration", "generate_audio"];
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\0") !== expected.sort().join("\0")) invalid();
  const row = value as Record<string, unknown>;
  if (typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId) ||
      typeof row.prompt !== "string" || !row.prompt.trim() || row.prompt.length > PROMPT_LOCAL_UTF16_LIMIT || !wellFormed(row.prompt) ||
      row.resolution !== "720p" || row.aspect_ratio !== "16:9" || row.video_duration !== 5 || row.generate_audio !== true) invalid();
  const parameters = Object.freeze({ prompt: row.prompt, resolution: "720p", aspect_ratio: "16:9", video_duration: 5,
    generate_audio: true, mode: "omni-references" });
  return Object.freeze({ attemptId: row.attemptId, prompt: row.prompt, parameters,
    semanticIntent: Object.freeze({ ...parameters }) });
}

function assertCatalog(catalog: DiscoveryCatalogRepository): void {
  const model = catalog.getModel(MODEL_ID);
  if (catalog.source_hashes.models !== CATALOG_MODELS_CANONICAL_SHA256 || model.active !== true || model.id !== MODEL_ID ||
      model.upstream_id !== MODEL_ID || model.ai_name !== AI_NAME || model.settings?.uploadable !== true ||
      model.settings.max_prompt_length !== 35_000 || !isDeepStrictEqual([...(model.settings.get_cost_params ?? [])].sort(), [...COST_FIELDS].sort())) {
    throw new Error("OWNER_SEEDANCE25_T2V_SOURCE_UNAVAILABLE");
  }
}
function contentAddressedVersion(registry: GenerationContractRegistryV2): string {
  return `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
}
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  try { const proto = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value);
    return (proto === Object.prototype || proto === null) && Reflect.ownKeys(d).every(k => typeof k === "string" &&
      Object.hasOwn(d[k]!, "value") && d[k]!.enumerable === true); } catch { return false; }
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = value.charCodeAt(i + 1); if (n < 0xdc00 || n > 0xdfff) return false; i++; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false; }
  return true;
}
function invalid(): never { throw new Error("OWNER_SEEDANCE25_T2V_INVALID_REQUEST"); }
