import { isProxy } from "node:util/types";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  type OwnerGrokV2vSourcePins,
  type OwnerGrokV2vSourceProfile
} from "./owner-grok-v2v-source-profile.js";

const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const PROFILE = getOwnerGrokV2vSourceProfile(MODEL_ID)!;
const REQUEST_KEYS = Object.freeze(["model_id", "prompt"] as const);
const MEASURED_KEYS = Object.freeze(["duration_seconds", "width", "height"] as const);
const normalizedRequests = new WeakSet<object>();
const measuredCandidates = new WeakSet<object>();

export interface OwnerGrokV2vParametersInput {
  readonly model_id: typeof MODEL_ID;
  readonly prompt: string;
}

export interface OwnerGrokV2vNormalizedParameters {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_REQUEST_CANDIDATE";
  readonly intent: Readonly<{ model_id: typeof MODEL_ID; prompt: string }>;
  readonly source_profile_id: OwnerGrokV2vSourceProfile["profile_id"];
  readonly source_pins: OwnerGrokV2vSourcePins;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerGrokV2vMeasuredDescriptor {
  readonly duration_seconds: number;
  readonly width: number;
  readonly height: number;
}

export interface OwnerGrokV2vMeasuredSettingsCandidate {
  readonly status: "LOCAL_MEASURED_CANDIDATE_NOT_UPLOAD_AUTHORITY";
  readonly model_id: typeof MODEL_ID;
  readonly settings_candidate: Readonly<{
    model_type: typeof MODEL_ID;
    aspect_ratio: null;
    video_duration: number;
    resolution: "480p" | "720p";
  }>;
  readonly cost_parameters_candidate: Readonly<{ video_duration: number; resolution: "480p" | "720p" }>;
  readonly source_profile_id: OwnerGrokV2vSourceProfile["profile_id"];
  readonly source_pins: OwnerGrokV2vSourcePins;
  readonly input_binding: "TRUSTED_OWNER_UPLOAD_RECEIPT_REQUIRED";
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerGrokV2vParametersError extends Error {
  readonly code = "INVALID_PARAMETERS" as const;
  constructor() {
    super("Grok V2V explicit parameters or measured descriptor are invalid.");
    this.name = "OwnerGrokV2vParametersError";
  }
}

/** Validates only the explicit source-bounded prompt and exact model identity. */
export function normalizeOwnerGrokV2vParameters(input: unknown): OwnerGrokV2vNormalizedParameters {
  try {
    const fields = exactRecord(input, REQUEST_KEYS);
    if (fields.model_id !== MODEL_ID || typeof fields.prompt !== "string" ||
        fields.prompt.trim().length === 0 || fields.prompt.length > PROFILE.prompt.max_length_utf16 ||
        !isWellFormedUnicode(fields.prompt)) invalid();
    const intent = Object.freeze({ model_id: MODEL_ID, prompt: fields.prompt });
    const result: OwnerGrokV2vNormalizedParameters = deepFreeze({
      status: "SOURCE_REVIEWED_EXPLICIT_REQUEST_CANDIDATE",
      intent,
      source_profile_id: PROFILE.profile_id,
      source_pins: PROFILE.source_pins,
      effective_defaults: "UNKNOWN",
      runtime_usable: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    normalizedRequests.add(result);
    return result;
  } catch (error) {
    if (error instanceof OwnerGrokV2vParametersError) throw error;
    invalid();
  }
}

/** Projects local metadata to candidates only; a plain descriptor is never an upload or dispatch authority. */
export function projectOwnerGrokV2vMeasuredSettings(input: unknown): OwnerGrokV2vMeasuredSettingsCandidate {
  try {
    const measured = exactRecord(input, MEASURED_KEYS);
    const duration = measured.duration_seconds, width = measured.width, height = measured.height;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 1 || duration > 8.7 ||
        !isPositiveSafeInteger(width) || !isPositiveSafeInteger(height)) invalid();
    const pixels = width * height;
    if (!Number.isSafeInteger(pixels)) invalid();
    const videoDuration = Number(Number(duration).toFixed(2));
    const resolution = pixels >= 409_920 ? "720p" : "480p";
    const settingsCandidate = Object.freeze({
      model_type: MODEL_ID,
      aspect_ratio: null,
      video_duration: videoDuration,
      resolution
    });
    const costParametersCandidate = Object.freeze({ video_duration: videoDuration, resolution });
    const result: OwnerGrokV2vMeasuredSettingsCandidate = deepFreeze({
      status: "LOCAL_MEASURED_CANDIDATE_NOT_UPLOAD_AUTHORITY",
      model_id: MODEL_ID,
      settings_candidate: settingsCandidate,
      cost_parameters_candidate: costParametersCandidate,
      source_profile_id: PROFILE.profile_id,
      source_pins: PROFILE.source_pins,
      input_binding: "TRUSTED_OWNER_UPLOAD_RECEIPT_REQUIRED",
      effective_defaults: "UNKNOWN",
      runtime_usable: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    measuredCandidates.add(result);
    return result;
  } catch (error) {
    if (error instanceof OwnerGrokV2vParametersError) throw error;
    invalid();
  }
}

/** Nominal checks for downstream preparers; they do not confer upload ownership or dispatch permission. */
export function isOwnerGrokV2vNormalizedParameters(value: unknown): value is OwnerGrokV2vNormalizedParameters {
  return !!value && typeof value === "object" && !isProxy(value) && normalizedRequests.has(value);
}

export function isOwnerGrokV2vMeasuredSettingsCandidate(value: unknown): value is OwnerGrokV2vMeasuredSettingsCandidate {
  return !!value && typeof value === "object" && !isProxy(value) && measuredCandidates.has(value);
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== required.length || keys.some((key) => typeof key !== "string" || !required.includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
    return copy;
  } catch (error) {
    if (error instanceof OwnerGrokV2vParametersError) throw error;
    invalid();
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
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

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function invalid(): never {
  throw new OwnerGrokV2vParametersError();
}
