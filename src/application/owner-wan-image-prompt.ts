import { isProxy } from "node:util/types";
import type { OwnerWanImageVariant } from "./owner-wan-image-parameters.js";

const PROMPT_LIMITS: Readonly<Record<OwnerWanImageVariant, number>> = Object.freeze({
  wan_25_i2i_preview: 1_500,
  wan_26_image: 1_500,
  wan_27_image: 5_000,
  wan_27_image_pro: 5_000
});
const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface OwnerWanImageNormalizedPrompt {
  readonly variant: OwnerWanImageVariant;
  readonly prompt: string;
  readonly length_units: number;
  readonly maximum_units: number;
  readonly unit: "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT";
  readonly admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL";
  readonly limit_confidence: "SOURCE_UI_BEHAVIOR_NOT_BACKEND_LIMIT";
  readonly local_character_guard: "REJECT_MALFORMED_UNICODE_AND_C0_C1_CONTROLS_EXCEPT_TAB_LF_CR";
  readonly character_guard_confidence: "LOCAL_INPUT_SAFETY_GUARD_NOT_PROVIDER_CONTRACT";
  readonly backend_limit: "UNPROVEN";
}

export class OwnerWanImagePromptError extends Error {
  constructor(readonly code: "INVALID_PROMPT" | "PROMPT_TOO_LONG") {
    super("The owner WAN image prompt is invalid.");
    this.name = "OwnerWanImagePromptError";
  }
}

/** Validates explicit prompt intent using the observed UI length metric; never clips or rewrites it. */
export function normalizeOwnerWanImagePrompt(input: unknown): Readonly<OwnerWanImageNormalizedPrompt> {
  const fields = readExactRecord(input);
  if (typeof fields.variant !== "string" || !Object.hasOwn(PROMPT_LIMITS, fields.variant) ||
      typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      UNSAFE_CONTROL_CHARACTERS.test(fields.prompt) || !isWellFormedUnicode(fields.prompt)) invalid();
  const variant = fields.variant as OwnerWanImageVariant;
  const prompt = fields.prompt;
  const maximumUnits = PROMPT_LIMITS[variant];
  const lengthUnits = measurePromptUnits(prompt);
  if (lengthUnits > maximumUnits) throw new OwnerWanImagePromptError("PROMPT_TOO_LONG");
  return deepFreeze({
    variant,
    prompt,
    length_units: lengthUnits,
    maximum_units: maximumUnits,
    unit: "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT" as const,
    admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL" as const,
    limit_confidence: "SOURCE_UI_BEHAVIOR_NOT_BACKEND_LIMIT" as const,
    local_character_guard: "REJECT_MALFORMED_UNICODE_AND_C0_C1_CONTROLS_EXCEPT_TAB_LF_CR" as const,
    character_guard_confidence: "LOCAL_INPUT_SAFETY_GUARD_NOT_PROVIDER_CONTRACT" as const,
    backend_limit: "UNPROVEN" as const
  });
}

function readExactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  const keys = ["variant", "prompt"];
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function measurePromptUnits(value: string): number {
  let units = value.length;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 0x000a) units += 1;
  }
  return units;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function invalid(): never {
  throw new OwnerWanImagePromptError("INVALID_PROMPT");
}
