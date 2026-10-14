import { isProxy } from "node:util/types";
import type { OwnerElevenLabsVoiceReference } from "./owner-elevenlabs-generation-parameters.js";

export const OWNER_ELEVENLABS_STS_MODEL_ID = "eleven_multilingual_sts_v2" as const;
export const OWNER_ELEVENLABS_STS_MODE = "speech_to_speech" as const;

const PROFILE = deepFreeze({
  profile_id: "elevenlabs-sts-web1428-partial-v1",
  model_id: OWNER_ELEVENLABS_STS_MODEL_ID,
  mode: OWNER_ELEVENLABS_STS_MODE,
  observed_web_wire: {
    endpoint: "audio/generate?ai_name=elevenlabs",
    prompt: "EMPTY_STRING",
    settings_keys: ["duration", "file_urls", "mode", "model_type", "voice_id"] as const,
    file_urls_item: { type: "audio", url: "TYPED_AUDIO_OBJECT_URL" },
    duration_source: "GENUINE_PROBE_OR_OWNED_REFERENCE_CONTEXT_NOT_CALLER" as const
  },
  input_boundary: {
    mime_type: "audio/mpeg" as const,
    minimum_duration_seconds: 5,
    maximum_duration_seconds: 300,
    maximum_bytes: 52_428_800,
    wav: "WAV1418_UPLOAD_REJECTED;NOT_PROMOTED" as const
  },
  result_output_policy: "ONE_OBJECT_LOCAL_BOUND" as const,
  source_scope: "PARTIAL_SOURCE_REPORT_ONLY" as const,
  runtime_usable: false as const,
  generation_allowed: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type OwnerElevenLabsStsParameterProfile = typeof PROFILE;
export type OwnerElevenLabsStsOriginalHandle = string & { readonly __ownerElevenLabsStsOriginalHandle: unique symbol };

export interface OwnerElevenLabsStsRequest {
  readonly model_id: typeof OWNER_ELEVENLABS_STS_MODEL_ID;
  readonly mode: typeof OWNER_ELEVENLABS_STS_MODE;
  readonly audio_original_handle: OwnerElevenLabsStsOriginalHandle;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
}

export interface OwnerElevenLabsStsNormalizedParameters extends OwnerElevenLabsStsRequest {
  readonly source_scope: "PARTIAL_OWNER_STS_PARAMETERS";
  readonly runtime_usable: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerElevenLabsStsParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("ElevenLabs STS parameters are invalid.");
    this.name = "OwnerElevenLabsStsParametersError";
  }
}

/** Reports the actual web shape and local STS bounds; it grants no native authority. */
export function getOwnerElevenLabsStsParameterProfile(): DeepReadonly<OwnerElevenLabsStsParameterProfile> {
  return PROFILE;
}

/** Accepts only the fixed STS v2 selection and the two opaque owner references. */
export function normalizeOwnerElevenLabsStsParameters(input: unknown): OwnerElevenLabsStsNormalizedParameters {
  const request = readExactRecord(input, ["model_id", "mode", "audio_original_handle", "voice_ref"]);
  if (request.model_id !== OWNER_ELEVENLABS_STS_MODEL_ID || request.mode !== OWNER_ELEVENLABS_STS_MODE ||
      !isOriginalHandle(request.audio_original_handle) || !isVoiceReference(request.voice_ref)) invalid();
  return deepFreeze({
    model_id: OWNER_ELEVENLABS_STS_MODEL_ID,
    mode: OWNER_ELEVENLABS_STS_MODE,
    audio_original_handle: request.audio_original_handle as OwnerElevenLabsStsOriginalHandle,
    voice_ref: request.voice_ref as OwnerElevenLabsVoiceReference,
    source_scope: "PARTIAL_OWNER_STS_PARAMETERS" as const,
    runtime_usable: false as const,
    generation_allowed: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  }) as OwnerElevenLabsStsNormalizedParameters;
}

function isOriginalHandle(value: unknown): value is string {
  return typeof value === "string" && /^elevenlabs_sts_original_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function isVoiceReference(value: unknown): value is OwnerElevenLabsVoiceReference {
  return typeof value === "string" && /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(descriptors, key)) ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) record[key] = descriptors[key]!.value;
  return record;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never { throw new OwnerElevenLabsStsParametersError("INVALID_PARAMETERS"); }
