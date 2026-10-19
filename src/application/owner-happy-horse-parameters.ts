import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

export const OWNER_HAPPY_HORSE_MODEL_IDS = Object.freeze([
  "happy_horse_first_frame", "happy_horse_references", "happy_horse_edit"
] as const);
export type OwnerHappyHorseModelId = typeof OWNER_HAPPY_HORSE_MODEL_IDS[number];
export type OwnerHappyHorseImageModelId = Exclude<OwnerHappyHorseModelId, "happy_horse_edit">;

const PROMPT_LOCAL_LIMIT = 1_000;
const SOURCE = Object.freeze({
  profile_id: "owner-happy-horse-image-source-2320-v1",
  status: "STATIC_FORM_AND_PINNED_CATALOG_METADATA_ONLY" as const,
  source_build: "1792363638" as const,
  form_sha256: "sha256:a6ab7f1d4e420a541178de13b3b33e6a54649708cdb0e8b54fe6e4fb384cdffa" as const,
  public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const,
  ai_name: "happy_horse" as const,
  scope: "video" as const,
  route: "video/generate" as const,
  model_ids: OWNER_HAPPY_HORSE_MODEL_IDS,
  catalog_defaults: "UNKNOWN" as const,
  initializer_candidates: Object.freeze({ aspect_ratio: "16:9" as const, video_duration: 5 as const,
    resolution: "720P" as const, seed: null }),
  source_candidate_confidence: "FORM_INITIALIZER_ONLY_NOT_EFFECTIVE_DEFAULT_OR_VALID_COMBINATION" as const,
  cost_query_keys: Object.freeze(["resolution", "video_duration"] as const),
  prompt_local_limit_utf16: PROMPT_LOCAL_LIMIT,
  prompt_limit_confidence: "LOCAL_CONSERVATIVE_BOUND_NOT_PROVIDER_LIMIT" as const,
  input: Object.freeze({ accepted_mime_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"] as const),
    max_file_size_catalog_bytes: 10 * 1024 * 1024, min_side_catalog_pixels: 400, max_side_catalog_pixels: 8_000,
    first_frame_image_count: 1, references_image_count: Object.freeze({ minimum: 1, maximum: 9 }),
    edit: Object.freeze({ accepted_video_mime_types: Object.freeze(["video/mp4", "video/quicktime"] as const),
      video_count: 1, image_count_initial_slice: 0, catalog_duration_seconds: Object.freeze({ minimum: 3, maximum: 60 }),
      catalog_dimension_pixels: Object.freeze({ minimum: 400, maximum: 2_160 }), max_file_size_catalog_bytes: 100 * 1024 * 1024 }) }),
  role_mapping: Object.freeze({ happy_horse_first_frame: "first_frame" as const, happy_horse_references: "image" as const,
    happy_horse_edit: "video" as const }),
  role_mapping_confidence: "SAME_BUILD_GENERIC_SENDER_SOURCE_MAPPING_STATIC_ONLY" as const,
  wire_payload_confidence: "SOURCE_DERIVED_CANDIDATE_NOT_BACKEND_ACCEPTANCE" as const,
  upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER" as const,
  provider_acceptance: "UNPROVEN" as const,
  dispatch_allowed: false as const,
  runtime_usable: false as const
});
const SOURCE_PROFILE = Object.freeze({ ...SOURCE, source_sha256: schemaHash(SOURCE) });

export interface OwnerHappyHorseParametersInput {
  readonly model_id: OwnerHappyHorseModelId;
  readonly prompt: string;
  readonly aspect_ratio: "16:9";
  readonly resolution: "720P";
  readonly video_duration: 5;
  readonly seed: null;
}

export interface OwnerHappyHorseNormalizedParameters {
  readonly status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerHappyHorseParametersInput>;
  readonly source_parameters: Readonly<{
    readonly model_type: OwnerHappyHorseModelId;
    readonly aspect_ratio: "16:9";
    readonly resolution: "720P";
    readonly video_duration: 5;
    readonly seed: null;
  }>;
  readonly source_profile_sha256: string;
  readonly cost_query_keys: readonly ["resolution", "video_duration"];
  readonly prompt_limit_confidence: "LOCAL_CONSERVATIVE_BOUND_NOT_PROVIDER_LIMIT";
  readonly initializer_confidence: "FORM_INITIALIZER_ONLY_NOT_EFFECTIVE_DEFAULT_OR_VALID_COMBINATION";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerHappyHorseParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("HappyHorse initial-slice parameters are invalid.");
    this.name = "OwnerHappyHorseParametersError";
  }
}

export function getOwnerHappyHorseSourceProfile() { return SOURCE_PROFILE; }

/** Fixed initial source candidates only. This intentionally does not claim the full settings matrix. */
export function normalizeOwnerHappyHorseParameters(input: unknown): Readonly<OwnerHappyHorseNormalizedParameters> {
  const fields = exactRecord(input, ["model_id", "prompt", "aspect_ratio", "resolution", "video_duration", "seed"]);
  if (!isOwnerHappyHorseModelId(fields.model_id) || typeof fields.prompt !== "string" || !wellFormed(fields.prompt) ||
      fields.prompt.trim().length === 0 || fields.prompt.length > PROMPT_LOCAL_LIMIT || fields.aspect_ratio !== "16:9" ||
      fields.resolution !== "720P" || fields.video_duration !== 5 || fields.seed !== null) invalid();
  const intent = Object.freeze({ model_id: fields.model_id, prompt: fields.prompt, aspect_ratio: "16:9" as const,
    resolution: "720P" as const, video_duration: 5 as const, seed: null });
  return Object.freeze({ status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" as const, intent,
    source_parameters: Object.freeze({ model_type: fields.model_id, aspect_ratio: "16:9" as const,
      resolution: "720P" as const, video_duration: 5 as const, seed: null }),
    source_profile_sha256: SOURCE_PROFILE.source_sha256, cost_query_keys: SOURCE.cost_query_keys,
    prompt_limit_confidence: SOURCE.prompt_limit_confidence,
    initializer_confidence: SOURCE.source_candidate_confidence, dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const });
}

export function isOwnerHappyHorseModelId(value: unknown): value is OwnerHappyHorseModelId {
  return typeof value === "string" && (OWNER_HAPPY_HORSE_MODEL_IDS as readonly string[]).includes(value);
}
export function isOwnerHappyHorseImageModelId(value: unknown): value is OwnerHappyHorseImageModelId {
  return value === "happy_horse_first_frame" || value === "happy_horse_references";
}

function exactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== expected.length || keys.some(key =>
      typeof key !== "string" || !expected.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of expected) out[key] = descriptors[key]!.value;
    return out;
  } catch { return invalid(); }
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { if (i + 1 >= value.length) return false; const n = value.charCodeAt(++i); if (n < 0xdc00 || n > 0xdfff) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
function invalid(): never { throw new OwnerHappyHorseParametersError("INVALID_PARAMETERS"); }
