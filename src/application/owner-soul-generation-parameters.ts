import { isProxy } from "node:util/types";
import { OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE, type OwnerSoulReferenceStrengthProfileStatus } from "./owner-soul-reference-strength-source-profile.js";

const MODEL_ID = "higgsfield-soul" as const;
const MODEL_TYPE = "higgsfield-soul" as const;
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" as const;
const FORM_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391" as const;
const RANDOM_SEED_HELPER_SHA256 = "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b" as const;
const COST_HELPER_SHA256 = "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" as const;
const APP_STORE_SHA256 = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" as const;
const SETTINGS_HELPER_SHA256 = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" as const;
const HISTORICAL_CHARACTER_MODULE_SHA256 = "sha256:17bf069c5ba2955b03e04c8778d895d11be0e85e097985bb40b019fc00597fff" as const;
const HISTORICAL_CHARACTER_SOURCE_SHA256 = "sha256:94c5e30ab516b945bb62b4c887b56ecce67ff97f0eed0e0f49f83540078d9a93" as const;
const MAX_PROMPT_UTF8_BYTES = 128 * 1024;
const MAX_STYLE_HANDLE_PATTERN = /^soul_style_[0-9a-f-]{36}$/u;
const MAX_CHARACTER_HANDLE_PATTERN = /^soul_character_[0-9a-f-]{36}$/u;
const PROMPT_FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const QUALITY_RESOLUTION_PAIRS = Object.freeze({
  "720p": Object.freeze([
    "2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048"
  ] as const),
  "1080p": Object.freeze([
    "2048x1152", "2016x1344", "2048x1536", "1536x1536", "1536x2048", "1344x2016", "1152x2048"
  ] as const)
});

const SOURCE_PARAMETERS = deepFreeze({
  model: {
    model_id: MODEL_ID,
    ai_name: MODEL_ID,
    model_type_source: "active_selected_e551_model_upstream_id",
    catalog_version: CATALOG_VERSION,
    pinned_default_model_type: MODEL_TYPE
  },
  source_pins: {
    build_id: "1791467421",
    form_sha256: FORM_SHA256,
    random_seed_helper_sha256: RANDOM_SEED_HELPER_SHA256,
    cost_helper_sha256: COST_HELPER_SHA256,
    app_store_sha256: APP_STORE_SHA256,
    settings_helper_sha256: SETTINGS_HELPER_SHA256
  },
  character_source_mapping: {
    binding: "inline_soul_form_a11",
    key_source: "record.id",
    label_source: "record.title",
    value_source: "record.reference_id",
    disabled_when: "status !== completed",
    known_statuses: Object.freeze(["not-ready", "in-progress", "queue", "error", "completed"] as const),
    model_value_prop_types: Object.freeze(["string", "number"] as const),
    server_reference_id_type: "UNOBSERVED_EMPTY_LIST"
  },
  historical_character_source_reference: {
    status: "HISTORICAL_NOT_CURRENT_CHARACTER_BINDING",
    compiled_module_sha256: HISTORICAL_CHARACTER_MODULE_SHA256,
    source_content_sha256: HISTORICAL_CHARACTER_SOURCE_SHA256
  },
  prompt: { required: true, minimum_utf8_bytes: 1, local_utf8_max_bytes: MAX_PROMPT_UTF8_BYTES, provider_max: "UNPROVEN" },
  quality_resolution_pairs: QUALITY_RESOLUTION_PAIRS,
  batch_size: { required: true, values: Object.freeze([1, 4] as const) },
  enhance_prompt: { required: true, type: "boolean" },
  seed: {
    required: true, nullable: true, minimum: 0, maximum: 2_147_483_647, integer: true,
    null_ui_choice: "random",
    zero_watcher_note: "external zero may be treated as random except recognized own-update echo",
    backend_semantics: "UNPROVEN"
  },
  style: {
    required: true, modes: Object.freeze(["none", "selected"] as const), maximum_selections: 1,
    ui_empty_value: "", empty_backend_acceptance: "UNPROVEN"
  },
  style_strength: { minimum: 0, maximum: 1, step: 0.1, conditional_on: "selected_style" },
  character: {
    required: true,
    modes: Object.freeze(["none", "selected"] as const),
    statuses: Object.freeze(["not-ready", "in-progress", "queue", "error", "completed"] as const),
    selection_requires_status: "completed",
    ui_empty_value: "", empty_backend_acceptance: "UNPROVEN",
    reference_id_ui_prop_types: Object.freeze(["string", "number"] as const),
    actual_server_reference_id_type: "UNOBSERVED_EMPTY_LIST"
  },
  reference_strength: {
    mode: "OPTIONAL_EXPLICIT_FIXED_INITIALIZER_ONLY",
    source_initializer_value: OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE,
    accepted_input_values: Object.freeze([OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE] as const),
    omitted_behavior: "KEEP_EXISTING_SETTINGS_PAYLOAD_UNCHANGED",
    provider_acceptance: "UNPROVEN"
  },
  fixed_settings: { n: 1 },
  dispatch_allowed: false,
  generation_readiness: "BLOCKED_SOURCE_OR_BACKEND_GATES"
});

export type OwnerSoulGenerationQuality = keyof typeof QUALITY_RESOLUTION_PAIRS;
export type OwnerSoulGenerationResolution = (typeof QUALITY_RESOLUTION_PAIRS)[OwnerSoulGenerationQuality][number];
export type OwnerSoulGenerationReferenceStrengthMode = OwnerSoulReferenceStrengthProfileStatus;

export type OwnerSoulGenerationStyleSelection =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly style_handle: string; readonly strength: number };

export type OwnerSoulGenerationCharacterSelection =
  | { readonly kind: "none" }
  | { readonly kind: "selected"; readonly character_handle: string };

export interface OwnerSoulGenerationParametersInput {
  readonly prompt: string;
  readonly quality: OwnerSoulGenerationQuality;
  readonly resolution: OwnerSoulGenerationResolution;
  readonly batch_size: 1 | 4;
  readonly enhance_prompt: boolean;
  readonly seed: number | null;
  readonly style: OwnerSoulGenerationStyleSelection;
  readonly character: OwnerSoulGenerationCharacterSelection;
  /** Optional opt-in to the sole source-observed initializer; arbitrary values are not admitted. */
  readonly reference_strength?: typeof OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE;
}

export interface OwnerSoulGenerationCatalogSnapshot {
  readonly catalog_version: string;
  readonly model: {
    readonly id: string;
    readonly ai_name: string;
    readonly upstream_id: string;
    readonly active: boolean;
  };
}

export interface OwnerSoulGenerationParametersResult {
  readonly intent: Readonly<OwnerSoulGenerationParametersInput>;
  readonly model: { readonly model_id: typeof MODEL_ID; readonly ai_name: typeof MODEL_ID; readonly model_type: string; readonly catalog_version: typeof CATALOG_VERSION };
  readonly source_pins: typeof SOURCE_PARAMETERS.source_pins;
  readonly fixed_settings: typeof SOURCE_PARAMETERS.fixed_settings;
  readonly reference_strength: OwnerSoulReferenceStrengthProfileStatus;
  readonly dispatch_allowed: false;
  readonly generation_readiness: typeof SOURCE_PARAMETERS.generation_readiness;
}

export type OwnerSoulGenerationParametersErrorCode = "INVALID_PARAMETERS" | "MODEL_BINDING_MISMATCH";

export class OwnerSoulGenerationParametersError extends Error {
  constructor(readonly code: OwnerSoulGenerationParametersErrorCode) {
    super("The explicit Soul generation intent is invalid or not source-bound.");
    this.name = "OwnerSoulGenerationParametersError";
  }
}

/** Source-reviewed UI choices only. This is not an executable generation schema. */
export function getOwnerSoulGenerationSourceParameters() {
  return SOURCE_PARAMETERS;
}

/** Normalizes explicit caller intent; it emits neither raw provider IDs nor a dispatch candidate. */
export function normalizeOwnerSoulGenerationParameters(
  input: OwnerSoulGenerationParametersInput | unknown,
  catalog?: OwnerSoulGenerationCatalogSnapshot
): OwnerSoulGenerationParametersResult {
  const fields = readExactRecord(input, [
    "prompt", "quality", "resolution", "batch_size", "enhance_prompt", "seed", "style", "character"
  ], ["reference_strength"]);
  if (typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      Buffer.byteLength(fields.prompt, "utf8") > MAX_PROMPT_UTF8_BYTES || PROMPT_FORBIDDEN_CONTROLS.test(fields.prompt)) {
    invalidParameters();
  }
  if (fields.quality !== "720p" && fields.quality !== "1080p") invalidParameters();
  if (!(QUALITY_RESOLUTION_PAIRS[fields.quality] as readonly string[]).includes(fields.resolution as string)) invalidParameters();
  if (fields.batch_size !== 1 && fields.batch_size !== 4) invalidParameters();
  if (typeof fields.enhance_prompt !== "boolean") invalidParameters();
  if (fields.seed !== null && (!Number.isSafeInteger(fields.seed) || (fields.seed as number) < 0 || (fields.seed as number) > 2_147_483_647)) {
    invalidParameters();
  }
  const style = normalizeStyleSelection(fields.style);
  const character = normalizeCharacterSelection(fields.character);
  if (Object.hasOwn(fields, "reference_strength") && fields.reference_strength !== OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE) invalidParameters();
  const modelType = resolveModelType(catalog);
  const normalizedIntent = Object.freeze({
    prompt: fields.prompt,
    quality: fields.quality,
    resolution: fields.resolution,
    batch_size: fields.batch_size,
    enhance_prompt: fields.enhance_prompt,
    seed: fields.seed,
    style,
    character,
    ...(fields.reference_strength === OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE
      ? { reference_strength: OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE } : {})
  }) as Readonly<OwnerSoulGenerationParametersInput>;
  return Object.freeze({
    intent: normalizedIntent,
    model: Object.freeze({ model_id: MODEL_ID, ai_name: MODEL_ID, model_type: modelType, catalog_version: CATALOG_VERSION }),
    source_pins: SOURCE_PARAMETERS.source_pins,
    fixed_settings: SOURCE_PARAMETERS.fixed_settings,
    reference_strength: fields.reference_strength === OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE
      ? "EXPLICIT_SOURCE_FIXED_0_7_BACKEND_UNPROVEN" : "UNRESOLVED_UNCONTROLLED_WIRE_FIELD",
    dispatch_allowed: false,
    generation_readiness: SOURCE_PARAMETERS.generation_readiness
  });
}

function normalizeStyleSelection(value: unknown): OwnerSoulGenerationStyleSelection {
  const fields = readRecord(value);
  if (fields.kind === "none") {
    assertExactKeys(fields, ["kind"]);
    return Object.freeze({ kind: "none" });
  }
  if (fields.kind !== "selected") invalidParameters();
  assertExactKeys(fields, ["kind", "style_handle", "strength"]);
  if (typeof fields.style_handle !== "string" || !MAX_STYLE_HANDLE_PATTERN.test(fields.style_handle) ||
      typeof fields.strength !== "number" || !Number.isFinite(fields.strength) || fields.strength < 0 || fields.strength > 1 ||
      Math.abs(fields.strength * 10 - Math.round(fields.strength * 10)) > 1e-9) invalidParameters();
  return Object.freeze({ kind: "selected", style_handle: fields.style_handle, strength: fields.strength });
}

function normalizeCharacterSelection(value: unknown): OwnerSoulGenerationCharacterSelection {
  const fields = readRecord(value);
  if (fields.kind === "none") {
    assertExactKeys(fields, ["kind"]);
    return Object.freeze({ kind: "none" });
  }
  if (fields.kind !== "selected") invalidParameters();
  assertExactKeys(fields, ["kind", "character_handle"]);
  if (typeof fields.character_handle !== "string" || !MAX_CHARACTER_HANDLE_PATTERN.test(fields.character_handle)) invalidParameters();
  return Object.freeze({ kind: "selected", character_handle: fields.character_handle });
}

function resolveModelType(catalog: OwnerSoulGenerationCatalogSnapshot | undefined): string {
  if (catalog === undefined) return MODEL_TYPE;
  const catalogFields = readExactRecord(catalog, ["catalog_version", "model"]);
  if (catalogFields.catalog_version !== CATALOG_VERSION) modelBindingMismatch();
  const model = readRecord(catalogFields.model);
  const modelId = model.id;
  const aiName = model.ai_name;
  const upstreamId = model.upstream_id;
  const active = model.active;
  if (modelId !== MODEL_ID || aiName !== MODEL_ID || active !== true || upstreamId !== MODEL_TYPE) modelBindingMismatch();
  return upstreamId;
}

function readExactRecord(value: unknown, requiredKeys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  const record = readRecord(value);
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  const keys = Object.keys(record);
  if (requiredKeys.some((key) => !Object.hasOwn(record, key)) || keys.some((key) => !allowedKeys.includes(key))) invalidParameters();
  return record;
}

function readRecord(value: unknown): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalidParameters();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidParameters();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !("value" in descriptors[key]!))) invalidParameters();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(descriptors)) result[key] = descriptors[key]!.value;
    return result;
  } catch (error) {
    if (error instanceof OwnerSoulGenerationParametersError) throw error;
    invalidParameters();
  }
}

function assertExactKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): void {
  const keys = Object.keys(record);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) invalidParameters();
}

function invalidParameters(): never {
  throw new OwnerSoulGenerationParametersError("INVALID_PARAMETERS");
}

function modelBindingMismatch(): never {
  throw new OwnerSoulGenerationParametersError("MODEL_BINDING_MISMATCH");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value as object)) deepFreeze((value as Record<PropertyKey, unknown>)[key]!);
    Object.freeze(value);
  }
  return value;
}
