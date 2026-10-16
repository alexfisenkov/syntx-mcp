import { createHash } from "node:crypto";
import { types } from "node:util";
import type { OwnerKling4ModelId } from "./owner-kling4-image-policy.js";

const MODEL_IDS = Object.freeze(["kling_4_keyframes", "kling_4_omni"] as const);
const CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const CATALOG_MODELS_SHA256 = "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1" as const;
const BUILD_ID = "1792156098" as const;
const MODES = Object.freeze(["standart", "hd"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "1:1", "9:16", "21:9"] as const);
const VERSION = "4.0" as const;
const MIN_DURATION = 3;
const MAX_DURATION = 30;
const MAX_PROMPT_UTF16_UNITS = 24_000;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE_PATTERN = /^kling4_reference_[0-9a-f-]{36}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const HANDLE_PREFIX = "[[ref";

export type OwnerKling4ParametersModelId = OwnerKling4ModelId;
export type OwnerKling4Mode = typeof MODES[number];
export type OwnerKling4AspectRatio = typeof ASPECT_RATIOS[number];
export type OwnerKling4ReferenceHandle = string & { readonly __ownerKling4ReferenceHandle: unique symbol };

const SOURCE_BINDINGS = deepFreeze({
  public_catalog: {
    file: "catalog/public/sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    version: CATALOG_VERSION,
    models_sha256: CATALOG_MODELS_SHA256
  },
  current_form: { file: "kling.js", build_id: BUILD_ID, sha256: "b6ced9afe924548678f49be6b10437d3f9d1279f6c2553eb467cc2a07f8aef53" },
  keyframes_reference_card: { file: "ReferenceCard.js", build_id: BUILD_ID, sha256: "dbfd0b6b245f6cba4e8388c64db208a5bcb03fa7fc252b58b979ea312b4c0854" },
  settings_helper: { file: "settings3.js", build_id: BUILD_ID, sha256: "7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" },
  settings_store_helper: { file: "app.js", build_id: BUILD_ID, sha256: "eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042" },
  common_video_sender: { file: "video.js", build_id: BUILD_ID, sha256: "3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b" },
  common_file_normalizer: { file: "NewSessionButton.js", build_id: BUILD_ID, sha256: "0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc" }
} as const);

const COMMON_PROFILE_FACTS = deepFreeze({
  version_values: [VERSION] as const,
  mode_values: MODES,
  aspect_ratio_values: ASPECT_RATIOS,
  video_duration_seconds: { min: MIN_DURATION, max: MAX_DURATION, step: 1 },
  prompt_utf16_unit_limit: MAX_PROMPT_UTF16_UNITS,
  prompt_limit_unit_status: "LOCAL_UTF16_GUARD_SOURCE_UNIT_NOT_INDEPENDENTLY_PROVED" as const,
  candidate_fields_require_explicit_values: true,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  provider_acceptance: "UNPROVEN" as const,
  common_settings_projection: "SOURCE_PROVES_SHARED_SETTINGS_COPY_NOT_K4_FINAL_WIRE" as const,
  common_file_normalization: {
    emitted_fields: ["type", "url"] as const,
    stripped_fields: ["role", "hash", "metadata", "addedOrder"] as const,
    current_then_existing_order: true,
    deduplication_key: "type:url" as const,
    duplicate_policy: "FIRST_OCCURRENCE_WINS" as const,
    emits_timestamps_or_slot_indices: false
  },
  local_reference_mention_syntax: "[[ref:N]]_ONE_BASED_ORDERED_HANDLE_INDEX" as const,
  local_closed_exclusions: ["temperature", "camera_movement", "multi_shots", "gen_type", "motion", "type", "n", "customPayload"] as const
});

export interface OwnerKling4KeyframesSourceInputProfile {
  readonly allowed_media_types: readonly ["images"];
  readonly catalog_file_count_limit: Readonly<{ images: 10 }>;
  readonly maximum_handle_count: Readonly<{ formula: "min(video_duration + 1, 10)"; minimum: 0; ceiling: 10 }>;
  readonly fresh_input_media_types: readonly ["images"];
  readonly reference_card: Readonly<{
    config_id: "kling-frames";
    allow_video_first: false;
    allow_audio: false;
    allow_middle: true;
    unique_frames: true;
    require_first_for_last: true;
    cascade_remove_first: true;
    interactive_first_accept: readonly ["images"];
    ui_roles: readonly ["first_frame", "middle_frame", "last_frame"];
    flattened_order: "first_then_existing_middle_order_then_last";
    ui_record_fields: readonly ["url", "type", "role", "hash", "metadata", "addedOrder"];
    legacy_hydration_first_clip_bypass: "PRESENT_BUT_NOT_FRESH_INPUT_SUPPORT";
    unique_frame_comparator: "UNPROVEN";
  }>;
  readonly generation_role_projection: "NO_ROLE_OR_SLOT_FIELD_PROVEN";
  readonly provider_role_interpretation: "UNPROVEN";
  readonly minimum_reference_count: "UNPROVEN";
  readonly aspect_ratio_visibility: "FIRST_SLOT_EMPTY_REQUIRED_BY_FORM";
  readonly native_audio_control: "FORCED_TRUE_BY_IMMEDIATE_WATCHER";
}

export interface OwnerKling4OmniSourceInputProfile {
  readonly allowed_media_types: readonly ["images", "videos"];
  readonly catalog_file_count_limits: Readonly<{ images: 10; videos: 5 }>;
  readonly maximum_handle_count: Readonly<{ minimum: 0; maximum: 15; basis: "SUM_OF_C19_PER_MEDIA_METADATA_LIMITS" }>;
  readonly per_media_count_enforcement: "FUTURE_TYPED_PREPARER";
  readonly aggregate_video_duration_seconds: 30;
  readonly aggregate_video_duration_enforcement: "FUTURE_PREPARER";
  readonly omni_reference_role_record_shape: "UNPROVEN";
  readonly minimum_reference_count: "UNPROVEN";
  readonly aspect_ratio_visibility: "SHOWN_FOR_OMNI_BY_FORM";
  readonly native_audio_control: "VISIBLE_BOOLEAN_AT_VERSION_4_0";
}

interface SourceProfileBase<ModelId extends OwnerKling4ParametersModelId, InputProfile> {
  readonly profile_id: string;
  readonly model_id: ModelId;
  readonly source_catalog_version: typeof CATALOG_VERSION;
  readonly source_bindings: typeof SOURCE_BINDINGS;
  readonly source_sha256: string;
  readonly settings: typeof COMMON_PROFILE_FACTS;
  readonly input_profile: InputProfile;
  readonly gaps: Readonly<{
    keyframes_provider_role_interpretation: "UNPROVEN";
    keyframes_selected_owned_role_conditions: "UNPROVEN";
    keyframes_unique_frame_comparator: "UNPROVEN";
    omni_mixed_media_role_binding: "UNPROVEN";
    global_minimum_reference_count: "UNPROVEN";
    zero_reference_generation: "UNPROVEN";
    multi_shots_cache_absence: "UNPROVEN";
    final_generation_wire: "UNPROVEN";
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly provider_acceptance: "UNPROVEN";
}

export type OwnerKling4SourceProfile =
  | SourceProfileBase<"kling_4_keyframes", OwnerKling4KeyframesSourceInputProfile>
  | SourceProfileBase<"kling_4_omni", OwnerKling4OmniSourceInputProfile>;

export interface OwnerKling4ParameterCandidateInput {
  readonly attemptId: string;
  readonly model_id: OwnerKling4ParametersModelId;
  readonly prompt: string;
  readonly version: "4.0";
  readonly mode: OwnerKling4Mode;
  readonly aspect_ratio: OwnerKling4AspectRatio;
  readonly video_duration: number;
  readonly native_audio: boolean;
  readonly reference_handles: readonly OwnerKling4ReferenceHandle[];
}

export interface OwnerKling4SemanticIntent {
  readonly model_id: OwnerKling4ParametersModelId;
  readonly version: "4.0";
  readonly mode: OwnerKling4Mode;
  readonly aspect_ratio: OwnerKling4AspectRatio;
  readonly video_duration: number;
  readonly native_audio: boolean;
  readonly reference_count: number;
}

export interface OwnerKling4ReferenceMention {
  readonly index: number;
  readonly start_utf16: number;
  readonly end_utf16: number;
}

export interface NormalizedOwnerKling4Parameters extends OwnerKling4ParameterCandidateInput {
  readonly status: "SOURCE_ONLY_PARAMETER_CANDIDATE";
  readonly profile_id: string;
  readonly profile_sha256: string;
  readonly semanticIntent: OwnerKling4SemanticIntent;
  readonly reference_mentions: readonly OwnerKling4ReferenceMention[];
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly provider_acceptance: "UNPROVEN";
}

export class OwnerKling4ParametersError extends Error {
  constructor(readonly code: "INVALID_CANDIDATE" | "UNKNOWN_MODEL") {
    super("The Kling 4 parameter candidate is invalid or does not name a supported C19 model.");
    this.name = "OwnerKling4ParametersError";
  }
}

const KEYFRAMES_INPUT_PROFILE: OwnerKling4KeyframesSourceInputProfile = deepFreeze({
  allowed_media_types: ["images"] as ["images"],
  catalog_file_count_limit: { images: 10 },
  maximum_handle_count: { formula: "min(video_duration + 1, 10)" as const, minimum: 0 as const, ceiling: 10 as const },
  fresh_input_media_types: ["images"] as ["images"],
  reference_card: {
    config_id: "kling-frames" as const,
    allow_video_first: false as const,
    allow_audio: false as const,
    allow_middle: true as const,
    unique_frames: true as const,
    require_first_for_last: true as const,
    cascade_remove_first: true as const,
    interactive_first_accept: ["images"] as ["images"],
    ui_roles: ["first_frame", "middle_frame", "last_frame"] as ["first_frame", "middle_frame", "last_frame"],
    flattened_order: "first_then_existing_middle_order_then_last" as const,
    ui_record_fields: ["url", "type", "role", "hash", "metadata", "addedOrder"] as ["url", "type", "role", "hash", "metadata", "addedOrder"],
    legacy_hydration_first_clip_bypass: "PRESENT_BUT_NOT_FRESH_INPUT_SUPPORT" as const,
    unique_frame_comparator: "UNPROVEN" as const
  },
  generation_role_projection: "NO_ROLE_OR_SLOT_FIELD_PROVEN" as const,
  provider_role_interpretation: "UNPROVEN" as const,
  minimum_reference_count: "UNPROVEN" as const,
  aspect_ratio_visibility: "FIRST_SLOT_EMPTY_REQUIRED_BY_FORM" as const,
  native_audio_control: "FORCED_TRUE_BY_IMMEDIATE_WATCHER" as const
} as const);

const OMNI_INPUT_PROFILE: OwnerKling4OmniSourceInputProfile = deepFreeze({
  allowed_media_types: ["images", "videos"] as ["images", "videos"],
  catalog_file_count_limits: { images: 10, videos: 5 },
  maximum_handle_count: { minimum: 0 as const, maximum: 15 as const, basis: "SUM_OF_C19_PER_MEDIA_METADATA_LIMITS" as const },
  per_media_count_enforcement: "FUTURE_TYPED_PREPARER" as const,
  aggregate_video_duration_seconds: 30,
  aggregate_video_duration_enforcement: "FUTURE_PREPARER" as const,
  omni_reference_role_record_shape: "UNPROVEN" as const,
  minimum_reference_count: "UNPROVEN" as const,
  aspect_ratio_visibility: "SHOWN_FOR_OMNI_BY_FORM" as const,
  native_audio_control: "VISIBLE_BOOLEAN_AT_VERSION_4_0" as const
} as const);

const PROFILE_GAPS = deepFreeze({
  keyframes_provider_role_interpretation: "UNPROVEN" as const,
  keyframes_selected_owned_role_conditions: "UNPROVEN" as const,
  keyframes_unique_frame_comparator: "UNPROVEN" as const,
  omni_mixed_media_role_binding: "UNPROVEN" as const,
  global_minimum_reference_count: "UNPROVEN" as const,
  zero_reference_generation: "UNPROVEN" as const,
  multi_shots_cache_absence: "UNPROVEN" as const,
  final_generation_wire: "UNPROVEN" as const
});

const KEYFRAMES_PROFILE = createSourceProfile("kling_4_keyframes", "OWNER_KLING4_KEYFRAMES_PARAMETERS_C19_V1", KEYFRAMES_INPUT_PROFILE);
const OMNI_PROFILE = createSourceProfile("kling_4_omni", "OWNER_KLING4_OMNI_PARAMETERS_C19_V1", OMNI_INPUT_PROFILE);
const PROFILES: Readonly<Record<OwnerKling4ParametersModelId, OwnerKling4SourceProfile>> = Object.freeze({
  kling_4_keyframes: KEYFRAMES_PROFILE,
  kling_4_omni: OMNI_PROFILE
});

/** Returns an immutable source-only profile for one exact C19 K4 model ID. */
export function getOwnerKling4SourceProfile(modelId: OwnerKling4ParametersModelId): OwnerKling4SourceProfile {
  if (!isModelId(modelId)) throw new OwnerKling4ParametersError("UNKNOWN_MODEL");
  return PROFILES[modelId];
}

/** Creates a strict, immutable local semantic candidate. It grants no runtime or generation authority. */
export function normalizeOwnerKling4Parameters(input: unknown): Readonly<NormalizedOwnerKling4Parameters> {
  const fields = exactInput(input);
  const modelId = fields.model_id;
  const profile = getOwnerKling4SourceProfile(modelId);
  if (!ATTEMPT_PATTERN.test(fields.attemptId) || !isWellFormedUnicode(fields.prompt) ||
      fields.prompt.length > MAX_PROMPT_UTF16_UNITS || CONTROL_CHARACTERS.test(fields.prompt) ||
      fields.prompt.includes("<<<") || fields.prompt.includes(">>>") ||
      fields.version !== VERSION || !isOneOf(MODES, fields.mode) || !isOneOf(ASPECT_RATIOS, fields.aspect_ratio) ||
      !Number.isSafeInteger(fields.video_duration) || fields.video_duration < MIN_DURATION || fields.video_duration > MAX_DURATION ||
      typeof fields.native_audio !== "boolean") invalid();
  if (modelId === "kling_4_keyframes" && fields.native_audio !== true) invalid();

  const maxHandleCount = modelId === "kling_4_keyframes"
    ? Math.min(fields.video_duration + 1, 10)
    : 15;
  const referenceHandles = copyReferenceHandles(fields.reference_handles, maxHandleCount);
  const referenceMentions = parseReferenceMentions(fields.prompt, referenceHandles.length);
  if (fields.prompt.trim().length === 0 && referenceHandles.length === 0) invalid();

  const semanticIntent = Object.freeze({
    model_id: modelId,
    version: VERSION,
    mode: fields.mode,
    aspect_ratio: fields.aspect_ratio,
    video_duration: fields.video_duration,
    native_audio: fields.native_audio,
    reference_count: referenceHandles.length
  });
  return Object.freeze({
    status: "SOURCE_ONLY_PARAMETER_CANDIDATE" as const,
    attemptId: fields.attemptId,
    model_id: modelId,
    prompt: fields.prompt,
    version: VERSION,
    mode: fields.mode,
    aspect_ratio: fields.aspect_ratio,
    video_duration: fields.video_duration,
    native_audio: fields.native_audio,
    reference_handles: referenceHandles,
    profile_id: profile.profile_id,
    profile_sha256: profile.source_sha256,
    semanticIntent,
    reference_mentions: referenceMentions,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    provider_acceptance: "UNPROVEN" as const
  });
}

function createSourceProfile<ModelId extends OwnerKling4ParametersModelId, InputProfile>(
  modelId: ModelId,
  profileId: string,
  inputProfile: InputProfile
): SourceProfileBase<ModelId, InputProfile> {
  const facts = deepFreeze({
    profile_id: profileId,
    model_id: modelId,
    source_catalog_version: CATALOG_VERSION,
    source_bindings: SOURCE_BINDINGS,
    settings: COMMON_PROFILE_FACTS,
    input_profile: inputProfile,
    gaps: PROFILE_GAPS,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    provider_acceptance: "UNPROVEN" as const
  });
  const sourceSha256 = createHash("sha256").update(JSON.stringify({
    public_catalog_version: CATALOG_VERSION,
    public_models_sha256: CATALOG_MODELS_SHA256,
    source_bindings: SOURCE_BINDINGS,
    profile: facts
  })).digest("hex");
  return deepFreeze({ ...facts, source_sha256: `sha256:${sourceSha256}` });
}

function exactInput(value: unknown): OwnerKling4ParameterCandidateInput {
  const fields = exactRecord(value, [
    "attemptId", "model_id", "prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio", "reference_handles"
  ]);
  if (typeof fields.attemptId !== "string" || typeof fields.model_id !== "string" || typeof fields.prompt !== "string" ||
      typeof fields.version !== "string" || typeof fields.mode !== "string" || typeof fields.aspect_ratio !== "string" ||
      typeof fields.video_duration !== "number" || typeof fields.native_audio !== "boolean" ||
      !isModelId(fields.model_id) || !isArrayValue(fields.reference_handles)) invalid();
  return fields as unknown as OwnerKling4ParameterCandidateInput;
}

function exactRecord(value: unknown, requiredKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== requiredKeys.length || keys.some((key) => typeof key !== "string" || !requiredKeys.includes(key) ||
      !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true) ||
      requiredKeys.some((key) => !Object.hasOwn(descriptors, key))) invalid();
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}

function copyReferenceHandles(value: readonly OwnerKling4ReferenceHandle[], maximum: number): readonly OwnerKling4ReferenceHandle[] {
  if (!isArrayValue(value)) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || typeof length !== "number" ||
      !Number.isSafeInteger(length) || length < 0 || length > maximum || keys.length !== length + 1) invalid();
  const output: OwnerKling4ReferenceHandle[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true ||
        typeof descriptor.value !== "string" || !REFERENCE_HANDLE_PATTERN.test(descriptor.value) || seen.has(descriptor.value)) invalid();
    seen.add(descriptor.value);
    output.push(descriptor.value as OwnerKling4ReferenceHandle);
  }
  return Object.freeze(output);
}

function parseReferenceMentions(prompt: string, referenceCount: number): readonly OwnerKling4ReferenceMention[] {
  const mentions: OwnerKling4ReferenceMention[] = [];
  let cursor = 0;
  while (true) {
    const start = prompt.indexOf(HANDLE_PREFIX, cursor);
    if (start < 0) break;
    const match = /^\[\[ref:([1-9][0-9]*)\]\]/u.exec(prompt.slice(start));
    if (!match) invalid();
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index > referenceCount) invalid();
    const end = start + match[0].length;
    mentions.push(Object.freeze({ index, start_utf16: start, end_utf16: end }));
    cursor = end;
  }
  return Object.freeze(mentions);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function isArrayValue(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function isModelId(value: unknown): value is OwnerKling4ParametersModelId {
  return typeof value === "string" && (MODEL_IDS as readonly string[]).includes(value);
}

function isOneOf<const Values extends readonly string[]>(values: Values, value: string): value is Values[number] {
  return (values as readonly string[]).includes(value);
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as Readonly<Value>;
  for (const key of Reflect.ownKeys(value)) {
    const child = (value as Record<PropertyKey, unknown>)[key];
    if (child && typeof child === "object") deepFreeze(child);
  }
  return Object.freeze(value);
}

function invalid(): never { throw new OwnerKling4ParametersError("INVALID_CANDIDATE"); }
