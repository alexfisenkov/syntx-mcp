import { types } from "node:util";
import {
  OWNER_HAILUO02_I2V_MODEL,
  OWNER_HAILUO02_I2V_SOURCE_PINS,
  OWNER_HAILUO02_I2V_SOURCE_PROFILE
} from "./owner-hailuo02-i2v-source-profile.js";

const INPUT_KEYS = Object.freeze(["model_id", "resolution", "video_duration", "prompt", "image_handle"] as const);
const HANDLE_PATTERN = /^h02img_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export type OwnerHailuo02I2vResolution = "512p" | "768p" | "1080p";
export type OwnerHailuo02I2vDuration = 6 | 10;

export interface OwnerHailuo02I2vNormalizedParameters {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_INTENT";
  readonly source_pins: typeof OWNER_HAILUO02_I2V_SOURCE_PINS;
  readonly model: typeof OWNER_HAILUO02_I2V_MODEL;
  readonly intent: Readonly<{
    prompt: string;
    resolution: OwnerHailuo02I2vResolution;
    video_duration: OwnerHailuo02I2vDuration;
  }>;
  readonly reference_binding: Readonly<{
    required_count: 1;
    image_handle: string;
    owner_bound: false;
    file_urls_projected: false;
  }>;
  readonly cost_query_candidate: Readonly<{
    supported: true;
    keys: readonly ["resolution", "video_duration"];
    values: Readonly<{ resolution: OwnerHailuo02I2vResolution; video_duration: OwnerHailuo02I2vDuration }>;
    reference_count_included: false;
    amount_or_quote: "UNPROVEN";
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerHailuo02I2vParametersError extends Error {
  constructor() {
    super("Hailuo-02 I2V parameters are invalid.");
    this.name = "OwnerHailuo02I2vParametersError";
  }
}

/** Validates explicit source-supported intent; it does not authenticate handles or resolve uploaded URLs. */
export function normalizeOwnerHailuo02I2vParameters(input: unknown): OwnerHailuo02I2vNormalizedParameters {
  const fields = exactRecord(input);
  const resolution = fields.resolution;
  const duration = fields.video_duration;
  const prompt = fields.prompt;
  const imageHandle = fields.image_handle;
  if (fields.model_id !== OWNER_HAILUO02_I2V_MODEL.model_id ||
      typeof resolution !== "string" || !["512p", "768p", "1080p"].includes(resolution) ||
      !Number.isSafeInteger(duration) || (duration !== 6 && duration !== 10) ||
      typeof prompt !== "string" || !isWellFormedUnicode(prompt) || PROMPT_CONTROL.test(prompt) ||
      prompt.trim().length === 0 || prompt.length > OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls.prompt.local_bound_utf16 ||
      typeof imageHandle !== "string" || !HANDLE_PATTERN.test(imageHandle) ||
      !OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls.valid_pairs.some((pair) =>
        pair.resolution === resolution && pair.video_duration === duration)) invalid();

  return Object.freeze({
    status: "SOURCE_REVIEWED_EXPLICIT_INTENT" as const,
    source_pins: OWNER_HAILUO02_I2V_SOURCE_PINS,
    model: OWNER_HAILUO02_I2V_MODEL,
    intent: Object.freeze({
      prompt,
      resolution: resolution as OwnerHailuo02I2vResolution,
      video_duration: duration as OwnerHailuo02I2vDuration
    }),
    reference_binding: Object.freeze({ required_count: 1 as const, image_handle: imageHandle,
      owner_bound: false as const, file_urls_projected: false as const }),
    cost_query_candidate: Object.freeze({
      supported: true as const,
      keys: OWNER_HAILUO02_I2V_SOURCE_PROFILE.cost_projection.caller_keys,
      values: Object.freeze({ resolution: resolution as OwnerHailuo02I2vResolution, video_duration: duration as OwnerHailuo02I2vDuration }),
      reference_count_included: false as const,
      amount_or_quote: "UNPROVEN" as const
    }),
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactRecord(value: unknown): Record<(typeof INPUT_KEYS)[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalid();
  }
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== INPUT_KEYS.length ||
      keys.some((key) => typeof key !== "string" || !INPUT_KEYS.includes(key as (typeof INPUT_KEYS)[number]))) invalid();
  const result = Object.create(null) as Record<(typeof INPUT_KEYS)[number], unknown>;
  for (const key of INPUT_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalid();
    result[key] = descriptor.value;
  }
  return result;
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

function invalid(): never {
  throw new OwnerHailuo02I2vParametersError();
}
