import { types } from "node:util";
import {
  normalizeOwnerKlingI2vParameters,
  OWNER_KLING_I2V_SOURCE_PINS,
  type OwnerKlingI2vMode,
  type OwnerKlingI2vVersion
} from "./owner-kling-i2v-parameters.js";

const MODEL_ID = "kling_image2video" as const;
const INPUT_KEYS = Object.freeze(["parameters", "controls"] as const);
const TEMPERATURE_HIDDEN_VERSIONS = Object.freeze(["3.0", "3.0-turbo"] as const);

const SOURCE = Object.freeze({
  status: "CURRENT_1791904852_SOURCE_ONLY_SETTINGS_TEMPLATE" as const,
  source_pins: OWNER_KLING_I2V_SOURCE_PINS,
  settings_keys: Object.freeze([
    "model_type", "version", "mode", "video_duration", "native_audio", "temperature", "multi_shots"
  ] as const),
  model_type_binding: "EXPLICIT_MODEL_ID_KLING_IMAGE2VIDEO" as const,
  aspect_ratio: "OMIT_I2V_WATCHER_RESETS_UNDEFINED" as const,
  gen_type: "OMIT_I2V_INITIALIZER_UNDEFINED_AND_CONTROL_IS_MOTION_CONTROL_ONLY" as const,
  temperature: Object.freeze({
    active_versions: "ALL_CURRENT_I2V_VERSIONS" as const,
    ui_hidden_versions: TEMPERATURE_HIDDEN_VERSIONS,
    watcher_fallback: 0.5 as const,
    active_value: "REQUIRED_EXPLICIT_NUMBER_0_TO_1_STEP_0.1" as const,
    hidden_ui_value: "PRESERVE_EXPLICIT_SETTING_FOR_3.0_AND_3.0-TURBO" as const
  }),
  multi_shots: Object.freeze({
    active_version: "3.0" as const,
    active_value: "REQUIRE_FALSE_UNTIL_SCENE_PAYLOAD_SOURCE_CLOSURE" as const,
    true_case: "BLOCKED_SCENE_CONSTRUCTOR_ADDITIONAL_PAYLOAD_UNRESOLVED" as const,
    hidden_values: "OMIT_FOR_OTHER_I2V_VERSIONS_BY_FORM_DELETION" as const
  }),
  cache: "NEVER_READ_OR_PROJECT_PERSISTED_BROWSER_SETTINGS" as const,
  reference: Object.freeze({
    required_count: 1 as const,
    wire_type: "image" as const,
    sender_field: "settings.file_urls" as const,
    status: "OWNED_REFERENCE_BINDING_REQUIRED_LATER" as const
  }),
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

export interface OwnerKlingI2vWireSettingsTemplate {
  readonly status: typeof SOURCE.status;
  readonly source: typeof SOURCE;
  readonly prompt: string;
  readonly settings_template: Readonly<{
    model_type: typeof MODEL_ID;
    version: OwnerKlingI2vVersion;
    mode: OwnerKlingI2vMode;
    video_duration: number;
    native_audio: boolean;
    temperature: number;
    multi_shots?: boolean;
  }>;
  readonly reference_requirement: typeof SOURCE.reference;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerKlingI2vWireSourceErrorCode = "INVALID_WIRE_INPUT";

export class OwnerKlingI2vWireSourceError extends Error {
  constructor(readonly code: OwnerKlingI2vWireSourceErrorCode) {
    super("Kling I2V settings template is invalid.");
    this.name = "OwnerKlingI2vWireSourceError";
  }
}

/** Projects explicit I2V settings only; owned file_urls are bound by a later private preparer. */
export function buildOwnerKlingI2vWireSettingsTemplate(input: unknown): OwnerKlingI2vWireSettingsTemplate {
  const fields = exactRecord(input, INPUT_KEYS);
  const parameters = normalizeOwnerKlingI2vParameters(fields.parameters);
  const controls = snapshotControls(fields.controls, parameters.intent.version);
  const settings = Object.freeze({
    model_type: MODEL_ID,
    version: parameters.intent.version,
    mode: parameters.intent.mode,
    video_duration: parameters.intent.video_duration,
    native_audio: parameters.intent.native_audio,
    temperature: controls.temperature,
    ...(controls.multi_shots === undefined ? {} : { multi_shots: controls.multi_shots })
  });
  return Object.freeze({
    status: SOURCE.status,
    source: SOURCE,
    prompt: parameters.intent.prompt,
    settings_template: settings,
    reference_requirement: SOURCE.reference,
    runtime_usable: false,
    dispatch_allowed: false,
    backend_acceptance: "UNPROVEN"
  });
}

function snapshotControls(value: unknown, version: OwnerKlingI2vVersion): Readonly<{
  temperature: number;
  multi_shots?: boolean;
}> {
  const expected = version === "3.0" ? ["temperature", "multi_shots"] : ["temperature"];
  const fields = exactRecord(value, expected);
  if (typeof fields.temperature !== "number" || !Number.isFinite(fields.temperature) ||
      fields.temperature < 0 || fields.temperature > 1 ||
      Math.abs(fields.temperature - Math.round(fields.temperature * 10) / 10) > 1e-9) invalid();
  if (version === "3.0") {
    if (fields.multi_shots !== false) invalid();
    return Object.freeze({ temperature: fields.temperature, multi_shots: false });
  }
  return Object.freeze({ temperature: fields.temperature });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return invalid();
  }
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
        descriptors[key as string]?.enumerable !== true || !Object.hasOwn(descriptors[key as string]!, "value"))) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function invalid(): never { throw new OwnerKlingI2vWireSourceError("INVALID_WIRE_INPUT"); }
