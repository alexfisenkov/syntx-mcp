import { createHash } from "node:crypto";
import { types } from "node:util";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^veo_omni_reference_[0-9a-f-]{36}$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const INPUT_KEYS = Object.freeze([
  "attemptId", "prompt", "input_type", "upscale", "aspect_ratio", "video_duration", "reference_handles"
] as const);
const UPSCALE_VALUES = Object.freeze([0, 1, 2, 3] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16"] as const);
const VIDEO_DURATIONS = Object.freeze([4, 6, 8, 10] as const);
const MIN_PROMPT_LENGTH = 8;
const MAX_PROMPT_LENGTH = 50_000;
const MODEL_ID = "veo_omni" as const;
const AI_NAME = "veo3" as const;

const PROFILE_DATA = deepFreeze({
  status: "CURRENT_1792156098_SOURCE_JOIN_OMNI_REFERENCES" as const,
  identity: { model_id: MODEL_ID, ai_name: AI_NAME },
  source_pins: {
    public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
    source_build_id: "1792156098",
    modules: {
      veo_form: "sha256:75c37d86280482f13b12d5edd546c36c0314cac91c24984aae0a6e9c7ba925a1",
      constants: "sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2",
      video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
      quality_helper: "sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4",
      app: "sha256:eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042",
      settings_helper: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
      video_route: "sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596",
      chat_input: "sha256:4b6139e2115b651af482800684f569f27dfa46e9154486814d1a8d376701a464",
      file_normalizer: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc"
    }
  },
  controls: {
    input_type: ["text", "image", "references"] as const,
    upscale: { values: UPSCALE_VALUES, labels: { 0: "720p", 1: "1080p", 2: "4K", 3: "360p Draft" } as const },
    aspect_ratio: ASPECT_RATIOS,
    video_duration: VIDEO_DURATIONS
  },
  source_modes: {
    text: { images: [0, 0] as const, videos: [0, 0] as const },
    image: { images: [1, 2] as const, videos: [0, 0] as const },
    references: {
      images_only: { images: [1, 7] as const, videos: [0, 0] as const },
      one_video_with_images: { images: [0, 5] as const, videos: [1, 1] as const }
    }
  },
  public_limits: {
    allowed_media_types: ["images", "videos"] as const,
    file_count_limit: { images: 7, videos: 1 },
    accepted_file_types: [
      "image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png", "video/mp4", "video/quicktime"
    ] as const,
    max_file_size_bytes: 1_048_576_000,
    max_video_duration_seconds: 10.2,
    min_prompt_codepoints: MIN_PROMPT_LENGTH,
    max_prompt_codepoints: MAX_PROMPT_LENGTH
  },
  local_resource_policy: {
    default_max_file_bytes: 67_108_864,
    minimum_configurable_file_bytes: 1,
    max_configurable_file_bytes: 1_048_576_000,
    configurable_cap_type: "POSITIVE_SAFE_INTEGER_BYTES" as const,
    cap_source: "TRUSTED_OPERATOR_COMPOSITION_NOT_CALLER_INPUT" as const,
    public_cap_is_not_local_default: true as const
  },
  upload: {
    source_tuple: { destination: "uploaded", check_duplicates: true, model_type: MODEL_ID },
    model_type_binding: "CURRENT_GLOBAL_SETTINGS_STORE_MODEL_TYPE" as const
  },
  file_semantics: {
    supported_reference_kinds: ["image", "video"] as const,
    input_order: "PRESERVED" as const,
    first_wins_dedupe_key: ["type", "url"] as const,
    normalized_entry_fields: ["type", "url"] as const,
    existing_file_urls: "APPENDED_AFTER_SELECTED_FILES" as const
  },
  cost_projection: {
    caller_keys: ["upscale", "video_duration"] as const,
    video_reference_extra: { mode: "video_ref" } as const,
    mode_in_generation_settings: "NOT_ESTABLISHED_BY_COST_QUERY" as const,
    amount_or_quote: "UNPROVEN" as const
  },
  prompt_mentions: {
    adapter_convention: "[[ref:N]]_TO_SOURCE_URL_MARKER" as const,
    index_base: 1 as const,
    index_target: "ORDERED_REFERENCE_HANDLES" as const,
    span_units: "UTF16_CODE_UNITS" as const,
    span_covers: "WHOLE_LOCAL_PLACEHOLDER" as const,
    input_prompt_bounds: "CHECK_BEFORE_RENDERING" as const,
    expanded_prompt: "RECHECK_BOUND_BEFORE_POST" as const,
    source_marker: "URL_MARKERS_ONLY_REPLACED_BY_SOURCE_SENDER" as const,
    raw_source_marker_tokens: ["<<<", ">>>"] as const,
    prompt_is_unchanged: true as const,
    translation_owner: "FOLLOWING_PRIVATE_RENDERER" as const
  },
  effective_defaults: "UNKNOWN" as const,
  duration_upscale_compatibility: "UNKNOWN_NOT_ENFORCED" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export const OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 = `sha256:${createHash("sha256")
  .update(canonicalJson(PROFILE_DATA), "utf8").digest("hex")}` as const;

const PROFILE = deepFreeze({ ...PROFILE_DATA, profile_sha256: OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 });

export type OwnerVeoOmniReferenceInputType = "image" | "references";
export type OwnerVeoOmniReferenceUpscale = (typeof UPSCALE_VALUES)[number];
export type OwnerVeoOmniReferenceAspectRatio = (typeof ASPECT_RATIOS)[number];
export type OwnerVeoOmniReferenceDuration = (typeof VIDEO_DURATIONS)[number];

export interface OwnerVeoOmniReferenceMention {
  readonly index: number;
  readonly start_utf16: number;
  readonly end_utf16: number;
}

export interface OwnerVeoOmniReferenceGenerationInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly input_type: OwnerVeoOmniReferenceInputType;
  readonly upscale: OwnerVeoOmniReferenceUpscale;
  readonly aspect_ratio: OwnerVeoOmniReferenceAspectRatio;
  readonly video_duration: OwnerVeoOmniReferenceDuration;
  readonly reference_handles: readonly string[];
  readonly semanticIntent: Readonly<{
    prompt: string;
    input_type: OwnerVeoOmniReferenceInputType;
    upscale: OwnerVeoOmniReferenceUpscale;
    aspect_ratio: OwnerVeoOmniReferenceAspectRatio;
    video_duration: OwnerVeoOmniReferenceDuration;
    reference_handles: readonly string[];
  }>;
  readonly reference_mentions: readonly OwnerVeoOmniReferenceMention[];
}

export type OwnerVeoOmniReferenceProfile = typeof PROFILE;

/** Closed static source facts and local adaptation policy; contains no URLs or wire body. */
export function getOwnerVeoOmniReferenceProfile(): OwnerVeoOmniReferenceProfile {
  return PROFILE;
}

/** Normalizes explicit reference intent and returns local placeholder spans for a later private renderer. */
export function normalizeOwnerVeoOmniReferenceGenerationInput(input: unknown): OwnerVeoOmniReferenceGenerationInput {
  const fields = exactRecord(input, INPUT_KEYS);
  if (typeof fields.attemptId !== "string" || !isExactMatch(ATTEMPT_PATTERN, fields.attemptId) ||
      (fields.input_type !== "image" && fields.input_type !== "references") ||
      !isIntegerMember(fields.upscale, UPSCALE_VALUES) || !isStringMember(fields.aspect_ratio, ASPECT_RATIOS) ||
      !isIntegerMember(fields.video_duration, VIDEO_DURATIONS)) invalid();

  const handles = snapshotHandles(fields.reference_handles);
  if (handles.length < 1 || handles.length > 7 || new Set(handles).size !== handles.length ||
      (fields.input_type === "image" && handles.length > 2)) invalid();

  const prompt = fields.prompt;
  if (typeof prompt !== "string" || [...prompt.trim()].length < MIN_PROMPT_LENGTH ||
      [...prompt].length > MAX_PROMPT_LENGTH || CONTROL.test(prompt) || !isWellFormedUnicode(prompt) ||
      prompt.includes("<<<") || prompt.includes(">>>")) invalid();
  const referenceMentions = parseReferenceMentions(prompt, handles.length);
  const inputType = fields.input_type as OwnerVeoOmniReferenceInputType;
  const upscale = fields.upscale as OwnerVeoOmniReferenceUpscale;
  const aspectRatio = fields.aspect_ratio as OwnerVeoOmniReferenceAspectRatio;
  const videoDuration = fields.video_duration as OwnerVeoOmniReferenceDuration;
  const semanticIntent: OwnerVeoOmniReferenceGenerationInput["semanticIntent"] = deepFreeze({
    prompt,
    input_type: inputType,
    upscale,
    aspect_ratio: aspectRatio,
    video_duration: videoDuration,
    reference_handles: handles
  });

  return deepFreeze({
    attemptId: fields.attemptId,
    prompt,
    input_type: inputType,
    upscale,
    aspect_ratio: aspectRatio,
    video_duration: videoDuration,
    reference_handles: handles,
    semanticIntent,
    reference_mentions: referenceMentions
  });
}

function exactRecord(value: unknown, requiredKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== requiredKeys.length ||
        keys.some((key) => typeof key !== "string" || !requiredKeys.includes(key) ||
          descriptors[key]?.enumerable !== true || !Object.hasOwn(descriptors[key]!, "value"))) invalid();
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) snapshot[key] = descriptors[key]!.value;
    return snapshot;
  } catch {
    invalid();
  }
}

function snapshotHandles(value: unknown): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 1 || lengthDescriptor.value > 7 || Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1) invalid();
    const handles: string[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value") ||
          typeof descriptor.value !== "string" || !isExactMatch(HANDLE_PATTERN, descriptor.value)) invalid();
      handles.push(descriptor.value);
    }
    return Object.freeze(handles);
  } catch {
    invalid();
  }
}

function parseReferenceMentions(prompt: string, handleCount: number): readonly OwnerVeoOmniReferenceMention[] {
  const mentions: OwnerVeoOmniReferenceMention[] = [];
  let cursor = 0;
  while (true) {
    const start = prompt.indexOf("[[ref:", cursor);
    if (start === -1) break;
    const close = prompt.indexOf("]]", start + 6);
    if (close === -1) invalid();
    const digits = prompt.slice(start + 6, close);
    if (!/^[1-9][0-9]*$/u.test(digits)) invalid();
    const index = Number(digits);
    if (!Number.isSafeInteger(index) || index > handleCount) invalid();
    mentions.push(Object.freeze({ index, start_utf16: start, end_utf16: close + 2 }));
    cursor = close + 2;
  }
  return Object.freeze(mentions);
}

function isIntegerMember<const T extends readonly number[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "number" && Number.isSafeInteger(value) && (values as readonly number[]).includes(value);
}

function isStringMember<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isExactMatch(pattern: RegExp, value: string): boolean {
  const match = pattern.exec(value);
  return match?.[0] === value;
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function invalid(): never {
  throw new Error("INVALID_REQUEST");
}
