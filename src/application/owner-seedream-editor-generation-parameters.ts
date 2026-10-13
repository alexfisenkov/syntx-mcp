import { isProxy } from "node:util/types";
import {
  normalizeOwnerSeedreamEditorParameters,
  type OwnerSeedreamEditorVariant,
  type OwnerSeedreamEditorParameters
} from "./owner-seedream-editor-parameters.js";

export const OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND = Object.freeze({
  max_utf8_bytes: 32 * 1024,
  policy: "LOCAL_RESOURCE_BOUND_NOT_SOURCE_OR_PROVIDER_LIMIT"
} as const);

export interface OwnerSeedreamEditorGenerationParametersInput {
  readonly variant: OwnerSeedreamEditorVariant;
  readonly prompt: string;
  readonly parameters: OwnerSeedreamEditorParameters;
}

export interface OwnerSeedreamEditorGenerationParameters {
  readonly variant: OwnerSeedreamEditorVariant;
  readonly prompt: string;
  readonly parameters: Readonly<OwnerSeedreamEditorParameters>;
}

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export class OwnerSeedreamEditorGenerationParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Seedream Editor generation parameters are invalid.");
    this.name = "OwnerSeedreamEditorGenerationParametersError";
  }
}

/** Validates the explicit prompt and source controls without adding defaults or private wire fields. */
export function normalizeOwnerSeedreamEditorGenerationParameters(input: unknown): Readonly<OwnerSeedreamEditorGenerationParameters> {
  try {
    const request = readExactRecord(input, ["variant", "prompt", "parameters"]);
    if (typeof request.prompt !== "string" || !isWellFormedUnicode(request.prompt) || request.prompt.trim().length === 0 ||
        Buffer.byteLength(request.prompt, "utf8") > OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND.max_utf8_bytes) invalid();
    const intent = normalizeOwnerSeedreamEditorParameters({ variant: request.variant, parameters: request.parameters });
    return deepFreeze({
      variant: intent.variant,
      prompt: request.prompt,
      parameters: { aspect_ratio: intent.parameters.aspect_ratio, resolution: intent.parameters.resolution }
    }) as Readonly<OwnerSeedreamEditorGenerationParameters>;
  } catch (error) {
    if (error instanceof OwnerSeedreamEditorGenerationParametersError) throw error;
    invalid();
  }
}

function readExactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !required.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false;
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
function invalid(): never { throw new OwnerSeedreamEditorGenerationParametersError("INVALID_PARAMETERS"); }
