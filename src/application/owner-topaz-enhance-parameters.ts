import { isProxy } from "node:util/types";
import {
  OWNER_TOPAZ_ENHANCE_ALGORITHM_IDS,
  OWNER_TOPAZ_ENHANCE_MODEL_ID,
  type OwnerTopazEnhanceAlgorithmId
} from "./owner-topaz-enhance-source-profile.js";

const PARAMETER_KEYS = Object.freeze([
  "blur", "halo", "focus", "grain", "model", "noise", "details", "preblur", "upscale", "prenoise", "compression", "interpolation"
] as const);
const normalizedValues = new WeakSet<object>();

export interface OwnerTopazEnhanceParameterValues {
  readonly blur: number;
  readonly halo: number;
  readonly focus: "off" | "normal" | "strong";
  readonly grain: "off" | "on";
  readonly model: OwnerTopazEnhanceAlgorithmId;
  readonly noise: number;
  readonly details: number;
  readonly preblur: number;
  readonly upscale: 1 | 2 | 4;
  readonly prenoise: number;
  readonly compression: number;
  readonly interpolation: 24 | 25 | 30 | 45 | 50 | 60;
}

export interface OwnerTopazEnhanceParametersInput {
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly parameters: OwnerTopazEnhanceParameterValues;
}
export type OwnerTopazEnhanceParameters = Readonly<{
  model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  parameters: Readonly<OwnerTopazEnhanceParameterValues>;
}>;

export interface OwnerTopazEnhanceMeasuredVideo {
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
}

export interface OwnerTopazEnhanceWireSettings {
  readonly model_type: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly resolution: "1" | "2" | "4";
  readonly video_duration: number;
  readonly width: number;
  readonly height: number;
  readonly parameters: Readonly<OwnerTopazEnhanceParameterValues & { readonly blend: 0; readonly promode: 0 }>;
}

export class OwnerTopazEnhanceParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Topaz Enhance parameters are invalid.");
    this.name = "OwnerTopazEnhanceParametersError";
  }
}

/** Validates explicit UI controls only. No defaults or source-unproven combination rules are applied. */
export function normalizeOwnerTopazEnhanceParameters(input: unknown): OwnerTopazEnhanceParameters {
  try {
    const request = exactRecord(input, ["model_id", "parameters"]);
    if (request.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID) invalid();
    const values = exactRecord(request.parameters, PARAMETER_KEYS);
    if (!isBoundedInteger(values.blur, -100, 100) || !isBoundedInteger(values.halo, -100, 100) ||
        !isBoundedInteger(values.noise, -100, 100) || !isBoundedInteger(values.details, -100, 100) ||
        !isBoundedInteger(values.preblur, -100, 100) || !isBoundedInteger(values.compression, -100, 100) ||
        !isBoundedInteger(values.prenoise, 0, 100) || ![1, 2, 4].includes(values.upscale as number) ||
        ![24, 25, 30, 45, 50, 60].includes(values.interpolation as number) ||
        !(OWNER_TOPAZ_ENHANCE_ALGORITHM_IDS as readonly unknown[]).includes(values.model) ||
        !["off", "normal", "strong"].includes(values.focus as string) || !["off", "on"].includes(values.grain as string)) invalid();
    const result: OwnerTopazEnhanceParameters = deepFreeze({
      model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID,
      parameters: {
        blur: values.blur as number,
        halo: values.halo as number,
        focus: values.focus as OwnerTopazEnhanceParameterValues["focus"],
        grain: values.grain as OwnerTopazEnhanceParameterValues["grain"],
        model: values.model as OwnerTopazEnhanceAlgorithmId,
        noise: values.noise as number,
        details: values.details as number,
        preblur: values.preblur as number,
        upscale: values.upscale as 1 | 2 | 4,
        prenoise: values.prenoise as number,
        compression: values.compression as number,
        interpolation: values.interpolation as OwnerTopazEnhanceParameterValues["interpolation"]
      }
    });
    normalizedValues.add(result);
    return result;
  } catch (error) {
    if (error instanceof OwnerTopazEnhanceParametersError) throw error;
    invalid();
  }
}

/** Pure settings projection; not proof of file ownership, provenance, backend support, or permission to dispatch. */
export function projectOwnerTopazEnhanceWireSettings(
  parameters: OwnerTopazEnhanceParameters,
  measuredVideo: OwnerTopazEnhanceMeasuredVideo
): OwnerTopazEnhanceWireSettings {
  try {
    if (!parameters || typeof parameters !== "object" || !normalizedValues.has(parameters)) invalid();
    const measurement = exactRecord(measuredVideo, ["width", "height", "duration_seconds"]);
    if (!isPositiveSafeInteger(measurement.width) || !isPositiveSafeInteger(measurement.height) ||
        typeof measurement.duration_seconds !== "number" || !Number.isFinite(measurement.duration_seconds) ||
        measurement.duration_seconds < 2 || measurement.duration_seconds > 26.25) invalid();
    const p = parameters.parameters;
    if (p.upscale === 4 && (measurement.width >= 1280 || measurement.height >= 720)) invalid();
    return deepFreeze({
      model_type: OWNER_TOPAZ_ENHANCE_MODEL_ID,
      resolution: String(p.upscale) as "1" | "2" | "4",
      video_duration: Math.round(measurement.duration_seconds),
      width: measurement.width as number,
      height: measurement.height as number,
      parameters: {
        blur: p.blur,
        halo: p.halo,
        blend: 0,
        focus: p.focus,
        grain: p.grain,
        model: p.model,
        noise: p.noise,
        details: p.details,
        preblur: p.preblur,
        promode: 0,
        upscale: p.upscale,
        prenoise: p.prenoise,
        compression: p.compression,
        interpolation: p.interpolation
      }
    });
  } catch (error) {
    if (error instanceof OwnerTopazEnhanceParametersError) throw error;
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

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function invalid(): never { throw new OwnerTopazEnhanceParametersError("INVALID_PARAMETERS"); }
