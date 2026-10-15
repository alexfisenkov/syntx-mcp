import { types } from "node:util";

const MODEL_ID = "kling_motion_control" as const;
const VERSIONS = Object.freeze(["2.6", "3.0"] as const);
const MODES = Object.freeze(["standart", "hd"] as const);
const GEN_TYPES = Object.freeze(["mcv", "mci"] as const);
const INPUT_KEYS = Object.freeze(["model_id", "version", "mode", "gen_type", "native_audio", "video_duration"] as const);

export const OWNER_KLING_MOTION_CONTROL_SOURCE_PINS = Object.freeze({
  public_catalog: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
  form_module: "kling.js",
  form_build_id: "1791904852",
  form_bytes: 32_012,
  form_sha256: "sha256:cdd5e9db14f57c901484c1bef541ba0b3fdd4d13153b990bd1f0edce1b3a5614"
} as const);

const SOURCE = Object.freeze({
  status: "CURRENT_1791904852_STATIC_MCV_SOURCE_PARAMETERS_ONLY" as const,
  model_id: MODEL_ID,
  operation_id: "generate-video" as const,
  ai_name: "kling" as const,
  source_pins: OWNER_KLING_MOTION_CONTROL_SOURCE_PINS,
  controls: Object.freeze({
    version: Object.freeze({ values: VERSIONS, effective_default: "UNKNOWN" as const }),
    mode: Object.freeze({ values: MODES, spelling: "EXACT_SOURCE_LITERAL" as const, effective_default: "UNKNOWN" as const }),
    gen_type: Object.freeze({ values: GEN_TYPES, effective_default: "UNKNOWN" as const }),
    native_audio: Object.freeze({ values: Object.freeze([false, true] as const), versions: VERSIONS, effective_default: "UNKNOWN" as const }),
    video_duration: Object.freeze({ min: 3, max_by_gen_type: Object.freeze({ mci: 10, mcv: 30 }), unit: "INTEGER_SECONDS" as const,
      applies_to_raw_input_duration: true as const, source_caps_are_upload_constraints: true as const })
  }),
  settings: Object.freeze({
    template_keys: Object.freeze(["model_type", "version", "mode", "gen_type", "native_audio", "video_duration"] as const),
    raw_video_binding: "FUTURE_PREPARER_RESPONSIBILITY" as const,
    references: "FUTURE_TYPED_OWNED_IMAGE_AND_VIDEO_PREPARER" as const
  }),
  omissions: Object.freeze({
    temperature: "EXPLICITLY_DELETED_FOR_MCV" as const,
    aspect_ratio: "CLEARED_FOR_RESOLVED_MOTION_CONTROL_INPUT" as const,
    multi_shots: "NOT_AN_MCV_CONTROL" as const,
    camera_movement: "NOT_AN_MCV_CONTROL" as const,
    motion_setting: "CONVERTED_BY_SENDER_TO_TYPED_VIDEO_REFERENCE_THEN_DELETED" as const,
    caller_file_urls: "NOT_ACCEPTED_OR_PROJECTED" as const
  }),
  cost_projection: Object.freeze({
    source: "B066_CURRENT_COST_HELPER_SETTINGS_KEYS_ONLY" as const,
    keys: Object.freeze(["mode", "video_duration", "version", "native_audio", "gen_type"] as const),
    values: "SAME_FROZEN_NORMALIZED_INTENT" as const,
    amount_or_quote: "UNPROVEN" as const
  }),
  effective_defaults: "UNKNOWN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export type OwnerKlingMotionControlVersion = typeof VERSIONS[number];
export type OwnerKlingMotionControlMode = typeof MODES[number];
export type OwnerKlingMotionControlGenType = typeof GEN_TYPES[number];

export interface OwnerKlingMotionControlParametersSource {
  readonly status: typeof SOURCE.status;
  readonly model_id: typeof MODEL_ID;
  readonly operation_id: typeof SOURCE.operation_id;
  readonly ai_name: typeof SOURCE.ai_name;
  readonly source_pins: typeof OWNER_KLING_MOTION_CONTROL_SOURCE_PINS;
  readonly controls: typeof SOURCE.controls;
  readonly settings: typeof SOURCE.settings;
  readonly omissions: typeof SOURCE.omissions;
  readonly cost_projection: typeof SOURCE.cost_projection;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerKlingMotionControlNormalizedParameters {
  readonly status: "SOURCE_REVIEWED_EXPLICIT_INTENT";
  readonly source_pins: typeof OWNER_KLING_MOTION_CONTROL_SOURCE_PINS;
  readonly intent: Readonly<{
    model_id: typeof MODEL_ID;
    version: OwnerKlingMotionControlVersion;
    mode: OwnerKlingMotionControlMode;
    gen_type: OwnerKlingMotionControlGenType;
    native_audio: boolean;
    video_duration: number;
  }>;
  readonly cost_query_candidate: Readonly<{
    keys: typeof SOURCE.cost_projection.keys;
    values: Readonly<{
      mode: OwnerKlingMotionControlMode;
      video_duration: number;
      version: OwnerKlingMotionControlVersion;
      native_audio: boolean;
      gen_type: OwnerKlingMotionControlGenType;
    }>;
    amount_or_quote: "UNPROVEN";
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerKlingMotionControlParametersErrorCode = "INVALID_PARAMETERS";

export class OwnerKlingMotionControlParametersError extends Error {
  constructor(readonly code: OwnerKlingMotionControlParametersErrorCode) {
    super("Kling Motion Control parameters are invalid.");
    this.name = "OwnerKlingMotionControlParametersError";
  }
}

/** Current source metadata and explicit local intent only; no upload or generation authority. */
export function getOwnerKlingMotionControlParametersSource(): OwnerKlingMotionControlParametersSource {
  return SOURCE;
}

/** Validates the explicit integer duration candidate against the source upload caps; it does not bind raw video metadata. */
export function normalizeOwnerKlingMotionControlParameters(input: unknown): OwnerKlingMotionControlNormalizedParameters {
  const fields = exactRecord(input, INPUT_KEYS);
  if (fields.model_id !== MODEL_ID || typeof fields.version !== "string" ||
      !VERSIONS.includes(fields.version as OwnerKlingMotionControlVersion) || typeof fields.mode !== "string" ||
      !MODES.includes(fields.mode as OwnerKlingMotionControlMode) || typeof fields.gen_type !== "string" ||
      !GEN_TYPES.includes(fields.gen_type as OwnerKlingMotionControlGenType) || typeof fields.native_audio !== "boolean" ||
      typeof fields.video_duration !== "number" || !Number.isSafeInteger(fields.video_duration)) invalid();

  const version = fields.version as OwnerKlingMotionControlVersion;
  const mode = fields.mode as OwnerKlingMotionControlMode;
  const genType = fields.gen_type as OwnerKlingMotionControlGenType;
  const videoDuration = fields.video_duration as number;
  const maxDuration = genType === "mci" ? SOURCE.controls.video_duration.max_by_gen_type.mci : SOURCE.controls.video_duration.max_by_gen_type.mcv;
  if (videoDuration < SOURCE.controls.video_duration.min || videoDuration > maxDuration) invalid();

  const intent = Object.freeze({
    model_id: MODEL_ID, version, mode, gen_type: genType, native_audio: fields.native_audio as boolean,
    video_duration: videoDuration
  });
  const costValues = Object.freeze({
    mode: intent.mode, video_duration: intent.video_duration, version: intent.version,
    native_audio: intent.native_audio, gen_type: intent.gen_type
  });
  return Object.freeze({
    status: "SOURCE_REVIEWED_EXPLICIT_INTENT" as const,
    source_pins: OWNER_KLING_MOTION_CONTROL_SOURCE_PINS,
    intent,
    cost_query_candidate: Object.freeze({ keys: SOURCE.cost_projection.keys, values: costValues, amount_or_quote: "UNPROVEN" as const }),
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
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
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
      ownKeys.length !== keys.length || !keys.every((key) => ownKeys.includes(key))) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    if (typeof key !== "string") invalid();
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function invalid(): never { throw new OwnerKlingMotionControlParametersError("INVALID_PARAMETERS"); }
