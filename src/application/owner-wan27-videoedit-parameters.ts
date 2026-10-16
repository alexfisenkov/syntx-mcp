import { createHash } from "node:crypto";
import { types } from "node:util";
import { canonicalJson, schemaHash } from "../domain/generation-contract.js";

const MODEL_ID = "wan_27_videoedit" as const;
const AI_NAME = "wan_video" as const;
const RESOLUTIONS = Object.freeze(["720P", "1080P"] as const);
const ASPECT_RATIOS = Object.freeze(["16:9", "9:16", "1:1", "4:3", "3:4"] as const);
const AUDIO_SETTINGS = Object.freeze(["auto", "origin"] as const);
const DURATION_MODES = Object.freeze(["preserve_input", "custom"] as const);
const MAX_SEED = 2_147_483_647;
const MAX_PROMPT_UTF16 = 1_500;
const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
  public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
  settings2_sha256: "sha256:1ccc25ae0052480436fa570c793401a81b4590586f86b270d4062a9d9b6541aa",
  form_build_id: "1792156098",
  form_sha256: "sha256:308d9504b372088774bc543f1527a2b4413d5c8db078e00755088065b735bd8a"
} as const);

const SOURCE_PROFILE_FACTS = Object.freeze({
  profile_id: "owner-wan27-videoedit-source2161-c19-v1",
  status: "CONDITIONAL_STATIC_SOURCE_CONTRACT_NOT_LIVE_UI_OR_PROVIDER_ACCEPTANCE" as const,
  model_id: MODEL_ID,
  ai_name: AI_NAME,
  source_pins: SOURCE_PINS,
  controls: Object.freeze({
    resolution: RESOLUTIONS,
    aspect_ratio: ASPECT_RATIOS,
    audio_setting: AUDIO_SETTINGS,
    prompt_extend: "BOOLEAN" as const,
    seed: Object.freeze({ nullable: true, minimum: 0, maximum: MAX_SEED, precision: 0 }),
    source_input_duration_seconds: Object.freeze({ minimum: 2, maximum: 10, unit: "SECONDS_FROM_FRESH_SELECTED_INPUT" as const }),
    video_duration: Object.freeze({ minimum: 2, maximum: 10, mode: DURATION_MODES, custom_unit: "INTEGER_SECONDS" as const })
  }),
  prompt_limit: Object.freeze({ maximum_utf16_length: MAX_PROMPT_UTF16, source: "C19_MAX_PROMPT_LENGTH_CONSERVATIVE_LOCAL_UTF16_GUARD" as const }),
  native_projection: Object.freeze({
    model_type: MODEL_ID,
    native_audio: false,
    shot_type: "single",
    rendering_speed: "basic",
    duration_rule: "ROUND2_SOURCE_INPUT_SECONDS",
    video_duration_preserve_rule: "ROUND2_SOURCE_INPUT_SECONDS",
    video_duration_custom_rule: "EXPLICIT_INTEGER_2_TO_FLOOR_SOURCE_INPUT_SECONDS_CAPPED_AT_10"
  }),
  effective_defaults: "UNKNOWN" as const,
  provider_defaults: "UNPROVEN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export const OWNER_WAN27_VIDEOEDIT_PARAMETERS_SOURCE = Object.freeze({
  ...SOURCE_PROFILE_FACTS,
  source_sha256: schemaHash(SOURCE_PROFILE_FACTS)
});

export type OwnerWan27VideoEditSourceProfile = typeof OWNER_WAN27_VIDEOEDIT_PARAMETERS_SOURCE;

/** Frozen exact target source profile; hash covers the profile facts, excluding its own hash field. */
export function getOwnerWan27VideoEditSourceProfile(): Readonly<OwnerWan27VideoEditSourceProfile> {
  return OWNER_WAN27_VIDEOEDIT_PARAMETERS_SOURCE;
}

export type OwnerWan27VideoEditResolution = typeof RESOLUTIONS[number];
export type OwnerWan27VideoEditAspectRatio = typeof ASPECT_RATIOS[number];
export type OwnerWan27VideoEditAudioSetting = typeof AUDIO_SETTINGS[number];
export type OwnerWan27VideoEditDurationMode = typeof DURATION_MODES[number];

export interface OwnerWan27VideoEditParametersInput {
  readonly model_id: typeof MODEL_ID;
  readonly prompt: string;
  readonly resolution: OwnerWan27VideoEditResolution;
  readonly aspect_ratio: OwnerWan27VideoEditAspectRatio;
  readonly audio_setting: OwnerWan27VideoEditAudioSetting;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  readonly duration_mode: OwnerWan27VideoEditDurationMode;
  /** Source-only projection input; it is not a trusted probe/receipt. */
  readonly source_input_duration_seconds: number;
  readonly custom_video_duration?: number;
}

export interface OwnerWan27VideoEditNativeSettings {
  readonly model_type: typeof MODEL_ID;
  readonly resolution: OwnerWan27VideoEditResolution;
  readonly aspect_ratio: OwnerWan27VideoEditAspectRatio;
  readonly video_duration: number;
  readonly audio_setting: OwnerWan27VideoEditAudioSetting;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  readonly native_audio: false;
  readonly shot_type: "single";
  readonly duration: number;
  readonly rendering_speed: "basic";
}

export interface OwnerWan27VideoEditNormalizedParameters {
  readonly status: "SOURCE_DERIVED_PARAMETERS_NORMALIZED_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<{
    readonly model_id: typeof MODEL_ID;
    readonly prompt: string;
    readonly settings: OwnerWan27VideoEditNativeSettings;
  }>;
  readonly source_pins: typeof SOURCE_PINS;
  readonly source_input_duration_context: Readonly<{
    readonly seconds: number;
    readonly authority: "SOURCE_ONLY_NOT_VALIDATED_VIDEO_RECEIPT";
  }>;
  /** Local selection alias for display only; intentionally excluded from fingerprint. */
  readonly duration_mode: OwnerWan27VideoEditDurationMode;
  readonly custom_video_duration?: number;
  readonly intent_fingerprint: string;
  readonly effective_defaults: "UNKNOWN";
  readonly provider_defaults: "UNPROVEN";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWan27VideoEditParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The owner WAN 2.7 Video Edit parameter selection is invalid.");
    this.name = "OwnerWan27VideoEditParametersError";
  }
}

/** Normalizes explicit source-derived controls only; duration is not a validated upload receipt. */
export function normalizeOwnerWan27VideoEditParameters(input: unknown): Readonly<OwnerWan27VideoEditNormalizedParameters> {
  const fields = exactRecord(input, ["model_id", "prompt", "resolution", "aspect_ratio", "audio_setting", "prompt_extend",
    "seed", "duration_mode", "source_input_duration_seconds"], ["custom_video_duration"]);
  if (fields.model_id !== MODEL_ID || typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      fields.prompt.length > MAX_PROMPT_UTF16 || !isWellFormedUnicode(fields.prompt) ||
      !oneOf(fields.resolution, RESOLUTIONS) || !oneOf(fields.aspect_ratio, ASPECT_RATIOS) ||
      !oneOf(fields.audio_setting, AUDIO_SETTINGS) || typeof fields.prompt_extend !== "boolean" ||
      !(fields.seed === null || (Number.isSafeInteger(fields.seed) && (fields.seed as number) >= 0 && (fields.seed as number) <= MAX_SEED)) ||
      !oneOf(fields.duration_mode, DURATION_MODES) || typeof fields.source_input_duration_seconds !== "number" ||
      !Number.isFinite(fields.source_input_duration_seconds) || fields.source_input_duration_seconds < 2 ||
      fields.source_input_duration_seconds > 10) invalid();

  const inputSeconds = fields.source_input_duration_seconds;
  const durationMode = fields.duration_mode as OwnerWan27VideoEditDurationMode;
  const hasCustomDuration = Object.hasOwn(fields, "custom_video_duration");
  let videoDuration: number;
  let customVideoDuration: number | undefined;
  if (durationMode === "preserve_input") {
    if (hasCustomDuration) invalid();
    videoDuration = round2(inputSeconds);
  } else {
    const maximum = Math.min(10, Math.floor(inputSeconds));
    const custom = fields.custom_video_duration;
    if (!hasCustomDuration || typeof custom !== "number" || !Number.isSafeInteger(custom) || custom < 2 || custom > maximum) invalid();
    videoDuration = custom;
    customVideoDuration = custom;
  }

  const settings: OwnerWan27VideoEditNativeSettings = Object.freeze({
    model_type: MODEL_ID,
    resolution: fields.resolution as OwnerWan27VideoEditResolution,
    aspect_ratio: fields.aspect_ratio as OwnerWan27VideoEditAspectRatio,
    video_duration: videoDuration,
    audio_setting: fields.audio_setting as OwnerWan27VideoEditAudioSetting,
    prompt_extend: fields.prompt_extend,
    seed: fields.seed as number | null,
    native_audio: false,
    shot_type: "single",
    duration: round2(inputSeconds),
    rendering_speed: "basic"
  });
  const prompt = fields.prompt;
  const intent = Object.freeze({ model_id: MODEL_ID, prompt, settings });
  const intentFingerprint = `sha256:${createHash("sha256").update(canonicalJson(intent), "utf8").digest("hex")}`;
  return Object.freeze({
    status: "SOURCE_DERIVED_PARAMETERS_NORMALIZED_NOT_DISPATCH_AUTHORITY" as const,
    intent,
    source_pins: SOURCE_PINS,
    source_input_duration_context: Object.freeze({
      seconds: inputSeconds,
      authority: "SOURCE_ONLY_NOT_VALIDATED_VIDEO_RECEIPT" as const
    }),
    duration_mode: durationMode,
    ...(customVideoDuration === undefined ? {} : { custom_video_duration: customVideoDuration }),
    intent_fingerprint: intentFingerprint,
    effective_defaults: "UNKNOWN" as const,
    provider_defaults: "UNPROVEN" as const,
    dispatch_allowed: false as const,
    runtime_usable: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function round2(value: number): number { return Math.round(value * 100) / 100; }

function exactRecord(value: unknown, requiredKeys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const allowed = [...requiredKeys, ...optionalKeys];
    if ((prototype !== Object.prototype && prototype !== null) || requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.length < requiredKeys.length || keys.length > allowed.length || keys.some((key) =>
          typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalid(); }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
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

function invalid(): never { throw new OwnerWan27VideoEditParametersError("INVALID_PARAMETERS"); }
