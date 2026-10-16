import { isProxy } from "node:util/types";
import {
  OWNER_FLUX3_VIDEO_MODEL_IDS,
  type OwnerFlux3VideoModelId
} from "./owner-flux3-video-source-profile.js";

const PARAMETERS_KEYS = Object.freeze(["resolution", "video_duration", "generate_audio"] as const);
const REQUEST_KEYS = Object.freeze(["model_id", "parameters"] as const);
const normalizedValues = new WeakSet<object>();

export interface OwnerFlux3VideoParameterValues {
  readonly resolution: "hd" | "fhd";
  readonly video_duration: number;
  readonly generate_audio: boolean;
}

export interface OwnerFlux3VideoParametersInput {
  readonly model_id: OwnerFlux3VideoModelId;
  readonly parameters: OwnerFlux3VideoParameterValues;
}

export type OwnerFlux3VideoParameters = Readonly<{
  model_id: OwnerFlux3VideoModelId;
  parameters: Readonly<OwnerFlux3VideoParameterValues>;
}>;

export type OwnerFlux3VideoWireSettings = Readonly<{
  model_type: OwnerFlux3VideoModelId;
  video_duration: number;
  resolution: "hd" | "fhd";
  aspect_ratio: "auto";
  generate_audio: boolean;
}>;

export type OwnerFlux3VideoCostParameters = Readonly<{
  resolution: "hd" | "fhd";
  video_duration: number;
}>;

export class OwnerFlux3VideoParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("Flux3 video parameters are invalid.");
    this.name = "OwnerFlux3VideoParametersError";
  }
}

/** Validates explicit controls only; it does not infer effective defaults or provider-supported combinations. */
export function normalizeOwnerFlux3VideoParameters(input: unknown): OwnerFlux3VideoParameters {
  try {
    const request = exactRecord(input, REQUEST_KEYS);
    if (!(OWNER_FLUX3_VIDEO_MODEL_IDS as readonly unknown[]).includes(request.model_id)) invalid();
    const modelId = request.model_id as OwnerFlux3VideoModelId;
    const values = exactRecord(request.parameters, PARAMETERS_KEYS);
    const durationLimit = modelId === "flux3_i2v" ? 20 : 15;
    if ((values.resolution !== "hd" && values.resolution !== "fhd") ||
        !isIntegerInRange(values.video_duration, 5, durationLimit) ||
        typeof values.generate_audio !== "boolean") invalid();
    const normalized: OwnerFlux3VideoParameters = deepFreeze({
      model_id: modelId,
      parameters: {
        resolution: values.resolution,
        video_duration: values.video_duration,
        generate_audio: values.generate_audio
      }
    });
    normalizedValues.add(normalized);
    return normalized;
  } catch (error) {
    if (error instanceof OwnerFlux3VideoParametersError) throw error;
    invalid();
  }
}

/** Pure settings projection; it carries no input URLs, prompt, count, or media measurements. */
export function projectOwnerFlux3VideoWireSettings(parameters: OwnerFlux3VideoParameters): OwnerFlux3VideoWireSettings {
  try {
    if (!parameters || typeof parameters !== "object" || isProxy(parameters) || !normalizedValues.has(parameters)) invalid();
    const { model_id, parameters: values } = parameters;
    return deepFreeze({
      model_type: model_id,
      video_duration: values.video_duration,
      resolution: values.resolution,
      aspect_ratio: "auto",
      generate_audio: values.generate_audio
    });
  } catch (error) {
    if (error instanceof OwnerFlux3VideoParametersError) throw error;
    invalid();
  }
}

/** Projects only the source-joined price query keys; unset draft and upstream n are never invented. */
export function projectOwnerFlux3VideoCostParameters(
  parameters: OwnerFlux3VideoParameters
): OwnerFlux3VideoCostParameters {
  try {
    if (!parameters || typeof parameters !== "object" || isProxy(parameters) || !normalizedValues.has(parameters)) invalid();
    return deepFreeze({
      resolution: parameters.parameters.resolution,
      video_duration: parameters.parameters.video_duration
    });
  } catch (error) {
    if (error instanceof OwnerFlux3VideoParametersError) throw error;
    invalid();
  }
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== required.length || keys.some((key) => typeof key !== "string" || !required.includes(key) ||
      !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
  return copy;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function invalid(): never {
  throw new OwnerFlux3VideoParametersError("INVALID_PARAMETERS");
}
