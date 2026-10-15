import { types } from "node:util";
import {
  getOwnerKlingMotionControlParametersSource,
  normalizeOwnerKlingMotionControlParameters,
  type OwnerKlingMotionControlMode,
  type OwnerKlingMotionControlVersion,
  type OwnerKlingMotionControlGenType
} from "./owner-kling-motion-control-parameters.js";

const INPUT_KEYS = Object.freeze(["parameters", "prompt"] as const);
const SOURCE = Object.freeze({
  status: "CURRENT_1791904852_SOURCE_ONLY_SETTINGS_TEMPLATE" as const,
  source_pins: getOwnerKlingMotionControlParametersSource().source_pins,
  settings_keys: Object.freeze(["model_type", "version", "mode", "gen_type", "native_audio", "video_duration"] as const),
  model_type_binding: "EXPLICIT_MODEL_ID_KLING_MOTION_CONTROL" as const,
  prompt: "OPTIONAL_RAW_STRING_NO_NORMALIZATION" as const,
  references: Object.freeze({
    caller_urls_accepted: false as const,
    file_urls_projected: false as const,
    preset_motion: "FUTURE_PREPARER_MUST_RESOLVE_TO_TYPED_VIDEO_REFERENCE" as const,
    own_video: "FUTURE_PREPARER_MUST_RESOLVE_TO_TYPED_OWNED_VIDEO_REFERENCE" as const
  }),
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerKlingMotionControlWireSettingsTemplate {
  readonly status: typeof SOURCE.status;
  readonly source: typeof SOURCE;
  readonly settings_template: Readonly<{
    model_type: "kling_motion_control";
    version: OwnerKlingMotionControlVersion;
    mode: OwnerKlingMotionControlMode;
    gen_type: OwnerKlingMotionControlGenType;
    native_audio: boolean;
    video_duration: number;
  }>;
  readonly prompt?: string;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerKlingMotionControlWireSourceErrorCode = "INVALID_WIRE_INPUT";

export class OwnerKlingMotionControlWireSourceError extends Error {
  constructor(readonly code: OwnerKlingMotionControlWireSourceErrorCode) {
    super("Kling Motion Control settings template is invalid.");
    this.name = "OwnerKlingMotionControlWireSourceError";
  }
}

/** Projects only source-confirmed settings; prompt is optional and references stay outside the pure template. */
export function buildOwnerKlingMotionControlWireSettingsTemplate(input: unknown): OwnerKlingMotionControlWireSettingsTemplate {
  const fields = exactRecord(input, INPUT_KEYS, ["parameters"]);
  if (Object.hasOwn(fields, "prompt") && typeof fields.prompt !== "string") invalid();
  const normalized = normalizeOwnerKlingMotionControlParameters(fields.parameters);
  const intent = normalized.intent;
  const settingsTemplate = Object.freeze({
    model_type: "kling_motion_control" as const,
    version: intent.version,
    mode: intent.mode,
    gen_type: intent.gen_type,
    native_audio: intent.native_audio,
    video_duration: intent.video_duration
  });
  return Object.freeze({
    status: SOURCE.status,
    source: SOURCE,
    settings_template: settingsTemplate,
    ...(Object.hasOwn(fields, "prompt") ? { prompt: fields.prompt as string } : {}),
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactRecord(value: unknown, allowedKeys: readonly string[], requiredKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return invalid();
  }
  const ownKeys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) ||
      ownKeys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) ||
      !requiredKeys.every((key) => ownKeys.includes(key))) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    if (typeof key !== "string") invalid();
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function invalid(): never { throw new OwnerKlingMotionControlWireSourceError("INVALID_WIRE_INPUT"); }
