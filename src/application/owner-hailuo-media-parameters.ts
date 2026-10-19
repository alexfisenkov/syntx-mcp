import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

export const OWNER_HAILUO_INITIAL_MODEL_IDS = Object.freeze([
  "hailuo-01-live-character", "hailuo-2.3-fast", "hailuo-3.0"
] as const);
export type OwnerHailuoInitialModelId = typeof OWNER_HAILUO_INITIAL_MODEL_IDS[number];

const AI_NAME = "hailuo-minimax" as const;
const SCOPE = "video" as const;
const ROUTE = "video/generate" as const;
const PROMPT_MAXIMUM_UTF16_LENGTH = 1_000;
const PROMPT_LIMIT_CONFIDENCE = "LOCAL_CONSERVATIVE_BOUND_NOT_PROVIDER_LIMIT" as const;
const UPLOAD_DESTINATION = "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER" as const;
const COST_QUERY_KEYS = deepFreeze({
  "hailuo-01-live-character": ["resolution", "video_duration"],
  "hailuo-2.3-fast": ["resolution", "video_duration"],
  "hailuo-3.0": ["ref_count", "resolution", "duration", "video_duration"]
} as const);

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const SOURCE_FACTS = deepFreeze({
  profile_id: "owner-hailuo-initial-source-contracts-2316-v1",
  status: "CURRENT_FORM_AND_PUBLIC_MODEL_METADATA_ONLY" as const,
  source_pins: {
    form_build_id: "1792363638" as const,
    form_module: "hailuo-minimax.js" as const,
    form_sha256: "sha256:b2f3d32382e493d0432db3c813d1bf7063653aaa4ef6131c65222c754e65ffbf" as const,
    video_module: "video.js" as const,
    video_sha256: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b" as const,
    settings_module: "settings3.js" as const,
    settings_sha256: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" as const,
    cost_module: "cost.js" as const,
    cost_sha256: "sha256:261d93d75b204703201d1d0c3cf0ce747832159ef44f818cdd44ebee27c07ada" as const,
    cost_ui_module: "cost2.js" as const,
    cost_ui_sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const,
    uploader_module: "fileUploader.js" as const,
    uploader_sha256: "sha256:45f3174473d1ae4c9e57fbee47c7bf0c7e75773e9f3b36dbb8c3e5cc7ec3863a" as const,
    public_models_url: "https://api.syntx.ai/api/v1/ai/models?lang=ru" as const,
    public_models_fetched_at: "2026-10-19T13:02:22.274Z" as const,
    public_models_sha256: "sha256:cb2581608a551f4bc783af85d2edd8cca6a926f8f84f41e3382885ba9a3cf054" as const
  },
  ai_name: AI_NAME,
  scope: SCOPE,
  route: ROUTE,
  model_ids: OWNER_HAILUO_INITIAL_MODEL_IDS,
  model_selector: {
    identity_field: "value" as const,
    root_form_value: "hailuo-minimax" as const,
    child_root_excluded: true as const,
    selected_row_model_type: "EXACT_SELECTED_PUBLIC_MODEL_VALUE" as const
  },
  effective_defaults: "NOT_INJECTED_EXPLICIT_PARAMETERS_REQUIRED" as const,
  source_supported_tuples: {
    "hailuo-01-live-character": [{ resolution: "720p", video_duration: 6 }],
    "hailuo-2.3-fast": [
      { resolution: "768p", video_duration: 6 },
      { resolution: "768p", video_duration: 10 },
      { resolution: "1080p", video_duration: 6 }
    ],
    "hailuo-3.0": [{ resolution: "2K", video_duration: 5, aspect_ratio: "16:9", mode: "omni-references" }]
  },
  source_initial_settings: {
    "hailuo-01-live-character": { model_type: "hailuo-01-live-character", resolution: "720p", video_duration: 6 },
    "hailuo-2.3-fast": { model_type: "hailuo-2.3-fast", resolution: "768p", video_duration: 6 },
    "hailuo-3.0": { model_type: "hailuo-3.0", resolution: "2K", video_duration: 5, aspect_ratio: "16:9", mode: "omni-references" }
  },
  public_input_metadata: {
    "hailuo-01-live-character": {
      active: true, default: false, allowed_media_types: ["images"], file_count_limit: 1,
      accepted_file_types: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
      max_file_size: { images: 20_971_520 }, max_file_size_semantics: "CURRENT_PUBLIC_POSITIVE_BOUND",
      max_prompt_length: 0, max_prompt_length_semantics: "ZERO_SEMANTICS_UNKNOWN", uploadable: true
    },
    "hailuo-2.3-fast": {
      active: true, default: true, allowed_media_types: ["images"], file_count_limit: 1,
      accepted_file_types: ["image/jpeg", "image/jpg", "image/png", "image/webp"],
      max_file_size: 0, max_file_size_semantics: "ZERO_SEMANTICS_UNKNOWN",
      max_prompt_length: 0, max_prompt_length_semantics: "ZERO_SEMANTICS_UNKNOWN", uploadable: true
    },
    "hailuo-3.0": {
      active: true, default: false, allowed_media_types: ["images", "audios", "videos"],
      file_count_limit: { audios: 3, first_frame: 1, images: 9, last_frame: 1, videos: 3 },
      accepted_file_types: ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp", "image/gif",
        "video/mp4", "video/quicktime", "audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav"],
      max_file_size: 0, max_file_size_semantics: "ZERO_SEMANTICS_UNKNOWN",
      max_prompt_length: 0, max_prompt_length_semantics: "ZERO_SEMANTICS_UNKNOWN", max_audio_duration: 15, min_audio_duration: 2,
      max_video_duration: 15, min_video_duration: 2, min_dimension: 256, max_dimension: 5_760, uploadable: true
    }
  },
  mode_policy: {
    initial_slice: { mode: "omni-references", resolution: "2K", video_duration: 5, image_count: 1 },
    rejected_candidate: { mode: "frames", resolution: "768p", video_duration: 4, image_count: 1,
      observation: "GENERATION_HTTP_422_OBSERVED_NOT_REPLAYED" },
    frames_mode_public_cap: { images: 2 },
    minimum_frame_count: "NOT_PROVEN"
  },
  cost_query_keys: COST_QUERY_KEYS,
  cost_confidence: "CURRENT_PUBLIC_MODEL_FIELDS_NOT_TARIFF_OR_BILLING_PROOF" as const,
  prompt_maximum_utf16_length: PROMPT_MAXIMUM_UTF16_LENGTH,
  prompt_limit_confidence: PROMPT_LIMIT_CONFIDENCE,
  prompt_public_metadata_values: { all_initial_ids: 0 },
  upload_destination: UPLOAD_DESTINATION,
  wire: {
    body_fields: Object.freeze(["chat_id", "prompt", "settings"] as const),
    route: ROUTE,
    query: { ai_name: AI_NAME },
    common_settings_fields: Object.freeze(["model_type", "resolution", "video_duration", "file_urls"] as const),
    hailuo3_settings_fields: Object.freeze(["model_type", "resolution", "video_duration", "aspect_ratio", "mode", "file_urls"] as const),
    file_url: { type: "image" as const, cardinality: 1 as const }
  },
  dispatch_allowed: false as const,
  upload_authority: false as const,
  runtime_usable: false as const,
  backend_acceptance: "UNPROVEN" as const
});

const SOURCE_PROFILE = deepFreeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

export type OwnerHailuoInitialInput =
  | { readonly model_id: "hailuo-01-live-character"; readonly prompt: string; readonly resolution: "720p"; readonly video_duration: 6 }
  | { readonly model_id: "hailuo-2.3-fast"; readonly prompt: string; readonly resolution: "768p"; readonly video_duration: 6 | 10 }
  | { readonly model_id: "hailuo-2.3-fast"; readonly prompt: string; readonly resolution: "1080p"; readonly video_duration: 6 }
  | { readonly model_id: "hailuo-3.0"; readonly prompt: string; readonly resolution: "2K"; readonly video_duration: 5;
      readonly aspect_ratio: "16:9"; readonly mode: "omni-references" };

export interface OwnerHailuoInitialNormalizedParameters {
  readonly status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerHailuoInitialInput>;
  readonly source_parameters: Readonly<{
    readonly model_type: OwnerHailuoInitialModelId;
    readonly resolution: string;
    readonly video_duration: number;
    readonly aspect_ratio?: "16:9";
    readonly mode?: "omni-references";
  }>;
  readonly profile_sha256: string;
  readonly prompt_limit_confidence: typeof PROMPT_LIMIT_CONFIDENCE;
  readonly prompt_maximum_utf16_length: typeof PROMPT_MAXIMUM_UTF16_LENGTH;
  readonly cost_query_keys: readonly string[];
  readonly upload_destination: typeof UPLOAD_DESTINATION;
  readonly dispatch_allowed: false;
  readonly upload_authority: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerHailuoInitialParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The owner Hailuo initial parameter tuple is invalid.");
    this.name = "OwnerHailuoInitialParametersError";
  }
}

export function getOwnerHailuoInitialSourceProfile(): DeepReadonly<typeof SOURCE_PROFILE> {
  return SOURCE_PROFILE;
}

/** Normalizes only the exact current initial tuple; it does not fill omitted controls or upload destination. */
export function normalizeOwnerHailuoInitialParameters(input: unknown): Readonly<OwnerHailuoInitialNormalizedParameters> {
  const fields = readExactParameterRecord(input);
  const modelId = fields.model_id;
  const prompt = fields.prompt;
  if (!isOwnerHailuoInitialModelId(modelId) || typeof prompt !== "string" || prompt.trim().length === 0 ||
      !isWellFormedUnicode(prompt) || prompt.length > PROMPT_MAXIMUM_UTF16_LENGTH) invalidParameters();

  let resolution: string;
  let videoDuration: number;
  let aspectRatio: "16:9" | undefined;
  let mode: "omni-references" | undefined;
  if (modelId === "hailuo-01-live-character") {
    if (!hasExactKeys(fields, ["model_id", "prompt", "resolution", "video_duration"]) ||
        fields.resolution !== "720p" || fields.video_duration !== 6) invalidParameters();
    resolution = "720p"; videoDuration = 6;
  } else if (modelId === "hailuo-2.3-fast") {
    if (!hasExactKeys(fields, ["model_id", "prompt", "resolution", "video_duration"]) ||
        !((fields.resolution === "768p" && (fields.video_duration === 6 || fields.video_duration === 10)) ||
          (fields.resolution === "1080p" && fields.video_duration === 6))) invalidParameters();
    resolution = fields.resolution as "768p" | "1080p";
    videoDuration = fields.video_duration as 6 | 10;
  } else {
    if (!hasExactKeys(fields, ["model_id", "prompt", "resolution", "video_duration", "aspect_ratio", "mode"]) ||
        fields.resolution !== "2K" || fields.video_duration !== 5 || fields.aspect_ratio !== "16:9" || fields.mode !== "omni-references") invalidParameters();
    resolution = "2K"; videoDuration = 5; aspectRatio = "16:9"; mode = "omni-references";
  }

  const intent = Object.freeze({
    model_id: modelId,
    prompt,
    resolution,
    video_duration: videoDuration,
    ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
    ...(mode === undefined ? {} : { mode })
  }) as Readonly<OwnerHailuoInitialInput>;
  const source_parameters = Object.freeze({
    model_type: modelId,
    resolution,
    video_duration: videoDuration,
    ...(aspectRatio === undefined ? {} : { aspect_ratio: aspectRatio }),
    ...(mode === undefined ? {} : { mode })
  });
  return Object.freeze({
    status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" as const,
    intent,
    source_parameters,
    profile_sha256: SOURCE_PROFILE.source_sha256,
    prompt_limit_confidence: PROMPT_LIMIT_CONFIDENCE,
    prompt_maximum_utf16_length: PROMPT_MAXIMUM_UTF16_LENGTH,
    cost_query_keys: COST_QUERY_KEYS[modelId],
    upload_destination: UPLOAD_DESTINATION,
    dispatch_allowed: false as const,
    upload_authority: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

export function isOwnerHailuoInitialModelId(value: unknown): value is OwnerHailuoInitialModelId {
  return typeof value === "string" && (OWNER_HAILUO_INITIAL_MODEL_IDS as readonly string[]).includes(value);
}

function readExactParameterRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalidParameters();
  try {
    const prototype = Object.getPrototypeOf(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = ["model_id", "prompt", "resolution", "video_duration", "aspect_ratio", "mode"];
    if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalidParameters();
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return invalidParameters(); }
}

function hasExactKeys(fields: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(fields);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(fields, key));
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalidParameters(): never { throw new OwnerHailuoInitialParametersError("INVALID_PARAMETERS"); }
