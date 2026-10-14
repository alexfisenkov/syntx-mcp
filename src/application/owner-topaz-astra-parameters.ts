import { isProxy } from "node:util/types";
import { OWNER_TOPAZ_ASTRA_MODEL_IDS, getOwnerTopazAstraSourceProfile, type OwnerTopazAstraModelId } from "./owner-topaz-astra-source-profile.js";

export const OWNER_TOPAZ_ASTRA_PROMPT_LOCAL_BOUND = Object.freeze({
  max_utf8_bytes: 32 * 1024,
  policy: "LOCAL_RESOURCE_BOUND_NOT_SOURCE_OR_PROVIDER_LIMIT"
} as const);

export interface OwnerTopazAstraParametersInput {
  readonly model_id: OwnerTopazAstraModelId;
  readonly prompt: string;
  readonly parameters: Readonly<{
    resolution: "1920x1080" | "3840x2160";
    frame_rate: 24 | 30 | 60 | 120;
    slowmo: null | 2 | 3 | 4 | 6 | 8 | 10 | 12 | 16;
    creativity: "low" | "middle" | "high";
  }>;
}

export interface OwnerTopazAstraParameters extends OwnerTopazAstraParametersInput {}

export class OwnerTopazAstraParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Topaz Astra parameters are invalid.");
    this.name = "OwnerTopazAstraParametersError";
  }
}

/** Validates explicit controls only; empty prompt is representable because the Topaz form has no prompt control.
 * This does not attest that the backend accepts it, add defaults, or prove source-unknown combinations.
 */
export function normalizeOwnerTopazAstraParameters(input: unknown): Readonly<OwnerTopazAstraParameters> {
  try {
    const request = exactRecord(input, ["model_id", "prompt", "parameters"]);
    if (typeof request.model_id !== "string" || !(OWNER_TOPAZ_ASTRA_MODEL_IDS as readonly string[]).includes(request.model_id)) invalid();
    if (typeof request.prompt !== "string" || !wellFormedUnicode(request.prompt) ||
        Buffer.byteLength(request.prompt, "utf8") > OWNER_TOPAZ_ASTRA_PROMPT_LOCAL_BOUND.max_utf8_bytes) invalid();
    const values = exactRecord(request.parameters, ["resolution", "frame_rate", "slowmo", "creativity"]);
    const profile = getOwnerTopazAstraSourceProfile(request.model_id);
    if (!profile || !(profile.controls.resolution.values as readonly unknown[]).includes(values.resolution) ||
        !(profile.controls.frame_rate.values as readonly unknown[]).includes(values.frame_rate) ||
        !(profile.controls.slowmo.values as readonly unknown[]).includes(values.slowmo) ||
        !(profile.controls.creativity.values as readonly unknown[]).includes(values.creativity)) invalid();
    return deepFreeze({
      model_id: request.model_id as OwnerTopazAstraModelId,
      prompt: request.prompt,
      parameters: {
        resolution: values.resolution as OwnerTopazAstraParameters["parameters"]["resolution"],
        frame_rate: values.frame_rate as OwnerTopazAstraParameters["parameters"]["frame_rate"],
        slowmo: values.slowmo as OwnerTopazAstraParameters["parameters"]["slowmo"],
        creativity: values.creativity as OwnerTopazAstraParameters["parameters"]["creativity"]
      }
    }) as Readonly<OwnerTopazAstraParameters>;
  } catch (error) {
    if (error instanceof OwnerTopazAstraParametersError) throw error;
    invalid();
  }
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== required.length || keys.some((key) => typeof key !== "string" || !required.includes(key) ||
      !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function wellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; index += 1; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function invalid(): never { throw new OwnerTopazAstraParametersError("INVALID_PARAMETERS"); }
