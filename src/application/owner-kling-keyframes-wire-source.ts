import { types } from "node:util";
import {
  normalizeOwnerKlingKeyframesParameters,
  OWNER_KLING_KEYFRAMES_SOURCE_PINS,
  type OwnerKlingKeyframesMode,
  type OwnerKlingKeyframesVersion
} from "./owner-kling-keyframes-parameters.js";

const MODEL_ID = "kling_keyframes" as const;
const INPUT_KEYS = Object.freeze(["parameters", "controls"] as const);
const AXES = Object.freeze(["horizontal", "vertical", "zoom", "tilt", "pan", "roll"] as const);
const CAMERA_PRESETS = Object.freeze({
  down_back: Object.freeze({ vertical: -10, zoom: -10 }),
  forward_up: Object.freeze({ vertical: 10, zoom: 10 }),
  right_turn_forward: Object.freeze({ zoom: 10, pan: -10 }),
  left_turn_forward: Object.freeze({ zoom: 10, pan: 10 })
} as const);

const SOURCE = Object.freeze({
  status: "CURRENT_1791904852_SOURCE_ONLY_SETTINGS_TEMPLATE" as const,
  source_pins: OWNER_KLING_KEYFRAMES_SOURCE_PINS,
  settings_keys: Object.freeze([
    "model_type", "version", "mode", "video_duration", "native_audio", "temperature",
    "aspect_ratio", "camera_movement", "multi_shots"
  ] as const),
  model_type_binding: "EXPLICIT_MODEL_ID_KLING_KEYFRAMES" as const,
  aspect_ratio: Object.freeze({
    projection: "EXPLICIT_LOCAL_POLICY" as const,
    null_means: "OMIT" as const,
    ui: "HIDDEN" as const,
    effective_cache: "UNKNOWN" as const,
    provider_compatibility: "UNPROVEN" as const
  }),
  temperature: Object.freeze({
    all_versions: "REQUIRED_EXPLICIT_NUMBER_0_TO_1_STEP_0.1" as const,
    hidden_version: "3.0" as const,
    hidden_value: "PRESERVE_EXPLICIT_SETTING" as const
  }),
  multi_shots: Object.freeze({
    required_version: "3.0" as const,
    value: "EXPLICIT_BOOLEAN" as const,
    other_versions: "MUST_BE_ABSENT" as const
  }),
  camera_movement: Object.freeze({
    applicability: "1.5_HD_ONLY" as const,
    representation: "FLAT_SIX_AXIS_OBJECT" as const,
    random: "OMIT" as const
  }),
  references: Object.freeze({
    status: "SEPARATE_FUTURE_REFERENCE_PREPARER" as const,
    caller_urls_accepted: false as const,
    file_urls_projected: false as const
  }),
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerKlingKeyframesCameraMovement {
  readonly type: string;
  readonly horizontal: number;
  readonly vertical: number;
  readonly zoom: number;
  readonly tilt: number;
  readonly pan: number;
  readonly roll: number;
}

export interface OwnerKlingKeyframesWireSettingsTemplate {
  readonly status: typeof SOURCE.status;
  readonly source: typeof SOURCE;
  readonly settings_template: Readonly<{
    model_type: typeof MODEL_ID;
    version: OwnerKlingKeyframesVersion;
    mode: OwnerKlingKeyframesMode;
    video_duration: number;
    native_audio: boolean;
    temperature: number;
    aspect_ratio?: "16:9" | "1:1" | "9:16";
    camera_movement?: OwnerKlingKeyframesCameraMovement;
    multi_shots?: boolean;
  }>;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerKlingKeyframesWireSourceErrorCode = "INVALID_WIRE_INPUT";

export class OwnerKlingKeyframesWireSourceError extends Error {
  constructor(readonly code: OwnerKlingKeyframesWireSourceErrorCode) {
    super("Kling Keyframes settings template is invalid.");
    this.name = "OwnerKlingKeyframesWireSourceError";
  }
}

/** Projects explicit Keyframes settings only; references and generation authority remain separate. */
export function buildOwnerKlingKeyframesWireSettingsTemplate(input: unknown): OwnerKlingKeyframesWireSettingsTemplate {
  const fields = exactRecord(input, INPUT_KEYS);
  const parameters = normalizeOwnerKlingKeyframesParameters(fields.parameters);
  const controls = snapshotControls(fields.controls, parameters.intent.version, parameters.intent.mode);
  const settings = Object.freeze({
    model_type: MODEL_ID,
    version: parameters.intent.version,
    mode: parameters.intent.mode,
    video_duration: parameters.intent.video_duration,
    native_audio: parameters.intent.native_audio,
    temperature: controls.temperature,
    ...(parameters.intent.aspect_ratio === null ? {} : { aspect_ratio: parameters.intent.aspect_ratio }),
    ...(controls.camera_movement === undefined ? {} : { camera_movement: controls.camera_movement }),
    ...(controls.multi_shots === undefined ? {} : { multi_shots: controls.multi_shots })
  });
  return Object.freeze({
    status: SOURCE.status,
    source: SOURCE,
    settings_template: settings,
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
}

function snapshotControls(value: unknown, version: OwnerKlingKeyframesVersion, mode: OwnerKlingKeyframesMode): Readonly<{
  temperature: number;
  multi_shots?: boolean;
  camera_movement?: OwnerKlingKeyframesCameraMovement;
}> {
  const cameraApplicable = version === "1.5" && mode === "hd";
  const multiShotsApplicable = version === "3.0";
  const required = ["temperature", ...(multiShotsApplicable ? ["multi_shots"] : [])];
  const allowed = [...required, ...(cameraApplicable ? ["camera_movement"] : [])];
  const fields = snapshotOptionalRecord(value, required, allowed);
  if (typeof fields.temperature !== "number" || !Number.isFinite(fields.temperature) ||
      fields.temperature < 0 || fields.temperature > 1 ||
      Math.abs(fields.temperature - Math.round(fields.temperature * 10) / 10) > 1e-9) invalid();

  if (multiShotsApplicable && typeof fields.multi_shots !== "boolean") invalid();
  const cameraMovement = Object.hasOwn(fields, "camera_movement")
    ? normalizeCameraMovement(fields.camera_movement)
    : undefined;
  return Object.freeze({
    temperature: fields.temperature,
    ...(multiShotsApplicable ? { multi_shots: fields.multi_shots as boolean } : {}),
    ...(cameraMovement === undefined ? {} : { camera_movement: cameraMovement })
  });
}

function normalizeCameraMovement(value: unknown): OwnerKlingKeyframesCameraMovement {
  const fields = exactRecord(value, ["type", ...AXES]);
  if (typeof fields.type !== "string") return invalid();
  const type = fields.type;
  const values = Object.create(null) as Record<(typeof AXES)[number], number>;
  for (const axis of AXES) {
    const axisValue = fields[axis];
    if (typeof axisValue !== "number" || !Number.isFinite(axisValue)) invalid();
    values[axis] = axisValue;
  }

  const isPreset = Object.hasOwn(CAMERA_PRESETS, type);
  if (isPreset) {
    const preset = CAMERA_PRESETS[type as keyof typeof CAMERA_PRESETS];
    for (const axis of AXES) {
      const expected = preset[axis as keyof typeof preset] ?? 0;
      if (values[axis] !== expected) invalid();
    }
  } else if ((AXES as readonly string[]).includes(type)) {
    for (const axis of AXES) {
      if (axis !== type && values[axis] !== 0) invalid();
      if (axis === type && !isSliderValue(values[axis])) invalid();
    }
  } else {
    return invalid();
  }

  return Object.freeze({
    type,
    horizontal: values.horizontal,
    vertical: values.vertical,
    zoom: values.zoom,
    tilt: values.tilt,
    pan: values.pan,
    roll: values.roll
  });
}

function isSliderValue(value: number): boolean {
  return value >= -10 && value <= 10 && Math.abs(value - Math.round(value * 10) / 10) <= 1e-9;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return snapshotOptionalRecord(value, keys, keys);
}

function snapshotOptionalRecord(value: unknown, requiredKeys: readonly string[], allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return invalid();
  }
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) ||
      keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key)) ||
      !requiredKeys.every((key) => keys.includes(key))) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") invalid();
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function invalid(): never { throw new OwnerKlingKeyframesWireSourceError("INVALID_WIRE_INPUT"); }
