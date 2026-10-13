import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { OWNER_IDEOGRAM_IMAGE_INPUT_POLICY } from "./owner-ideogram-image-input.js";
import {
  OWNER_IDEOGRAM_IMAGE_CONTEXTS,
  getOwnerIdeogramImageParameterProfile,
  type OwnerIdeogramImageContext,
  type OwnerIdeogramImageModelId,
  type OwnerIdeogramImageMode
} from "./owner-ideogram-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const PARAMETERS_SOURCE = getOwnerIdeogramImageParameterProfile();
const EXPECTED_CONTEXTS = Object.freeze([
  Object.freeze({ model_id: "ideogram", mode: "generate" }),
  Object.freeze({ model_id: "ideogram", mode: "remix" }),
  Object.freeze({ model_id: "ideogram", mode: "reframe" }),
  Object.freeze({ model_id: "ideogram", mode: "replace_background" }),
  Object.freeze({ model_id: "ideogram", mode: "character_reference" }),
  Object.freeze({ model_id: "ideogram_40", mode: "generate" }),
  Object.freeze({ model_id: "ideogram_40", mode: "transparent" }),
  Object.freeze({ model_id: "ideogram_45", mode: "generate" }),
  Object.freeze({ model_id: "ideogram_45", mode: "precise_edit" })
] as const);
const MODEL_DEFAULTS = Object.freeze({ ideogram: true, ideogram_40: false, ideogram_45: true } as const);
const MODEL_SETTINGS = Object.freeze({
  ideogram: Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null,
    file_count_limit: Object.freeze({ images: 5 }), get_cost_params: Object.freeze(["rendering_speed", "batch_size"]),
    max_file_size: 0, max_prompt_length: 0, uploadable: true
  }),
  ideogram_40: Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null,
    file_count_limit: Object.freeze({ images: 1 }),
    get_cost_params: Object.freeze(["rendering_speed", "mode", "resolution", "batch_size"]),
    max_file_size: 52_428_800, max_prompt_length: 10_000, uploadable: true
  }),
  ideogram_45: Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null,
    file_count_limit: Object.freeze({ images: 5 }),
    get_cost_params: Object.freeze(["rendering_speed", "ref_count", "batch_size"]),
    max_file_size: 26_214_400, max_image_aspect_ratio: 6, max_prompt_length: 10_000,
    min_image_aspect_ratio: 0.1666, uploadable: true
  })
} as const);
const SOURCE_ARTIFACTS = Object.freeze({
  form: Object.freeze({
    module: "ideogram.js", url: "https://syntx.ai/assets/1791467421/ideogram.js", build_id: "1791467421",
    bytes: 28_373, sha256: "sha256:fb8f93597c1dc69fa811e48f5d3218ef5724d9f2f1dd175a3a63f320f930274a",
    evidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
  }),
  mode_registry: Object.freeze({
    module: "modes.registry.js", url: "https://syntx.ai/assets/1791467421/modes.registry.js", build_id: "1791467421",
    bytes: 7_965, sha256: "sha256:d4ad75ddd2336d24cba03e1b32dc162d18ff8d7ff4b15b91ab4fd83175dcc5ac",
    evidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
  }),
  random_seed: Object.freeze({
    module: "RandomSeed.js", url: "https://syntx.ai/assets/1791467421/RandomSeed.js", build_id: "1791467421",
    bytes: 1_656, sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
    evidence: "CURRENT_HASH_PINNED_STATIC_SOURCE_NOT_PROVIDER_RANGE" as const
  }),
  mask_field: Object.freeze({
    module: "MaskField.js", url: "https://syntx.ai/assets/1791467421/MaskField.js", build_id: "1791467421",
    bytes: 7_930, sha256: "sha256:939eb943acae4f98ac4204c24c8fbd07b9fcb472fd9f33e2087703175a80e665",
    evidence: "CURRENT_HASH_PINNED_STATIC_SOURCE_MASK_SEMANTICS_PARTIAL" as const
  })
});
const COST_INPUTS = Object.freeze({
  ideogram: Object.freeze(["rendering_speed←selected_setting", "batch_size←num_images"]),
  ideogram_40: Object.freeze(["rendering_speed←selected_setting", "mode←transparent_apiMode_only", "resolution←selected_setting", "batch_size←num_images"]),
  ideogram_45: Object.freeze(["rendering_speed←selected_setting", "ref_count←original_image_references_mask_excluded", "batch_size←num_images"])
} as const);
const EXPECTED_COST_METADATA = Object.freeze({
  ideogram: Object.freeze(["rendering_speed", "batch_size"]),
  ideogram_40: Object.freeze(["rendering_speed", "mode", "resolution", "batch_size"]),
  ideogram_45: Object.freeze(["rendering_speed", "ref_count", "batch_size"])
} as const);
const EXPECTED_COST_PROJECTION = Object.freeze({
  batch_size: "EXPLICIT_NUM_IMAGES",
  ideogram_45_ref_count: "ORIGINAL_IMAGE_REFERENCE_COUNT_IF_NONZERO_MASK_EXCLUDED",
  ideogram_40_mode: "TRANSPARENT_BRANCH_ONLY_GENERATE_UNDEFINED_OMITTED",
  quote_or_billing: "UNPROVEN"
} as const);

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerIdeogramImageSourceProfile {
  readonly profile_id: "ideogram-image-source-profile-v1";
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly ai_name: "ideogram";
  readonly model_type: OwnerIdeogramImageModelId;
  readonly catalog_default_flag: boolean;
  readonly catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly source_context: OwnerIdeogramImageContext;
  readonly source_binding: Readonly<{
    selected_public_catalog_version: typeof CATALOG_VERSION;
    selected_public_catalog_fetched_at: string;
    selected_public_source_hashes: typeof SOURCE_HASHES;
    normalized_public_model: Readonly<Record<string, unknown>>;
    settings_inventory: Readonly<{
      version: typeof SETTINGS_VERSION;
      form_id: "ideogram";
      form_binding_status: "STRUCTURAL_MATCH";
      settings_status: "PUBLIC_SETTINGS_KNOWN";
      runtime_usable: false;
      defaults_status: "UNKNOWN";
      conditional_visibility: "NOT_FULLY_EVALUATED";
      payload_acceptance: "NOT_RUNTIME_VERIFIED";
    }>;
    source_artifacts: typeof SOURCE_ARTIFACTS;
    mode_join_status: "ALL_NINE_STATIC_SOURCE_CONTEXTS_NOT_RUNTIME_VERIFIED";
    source_execution: false;
  }>;
  readonly parameters_source: ReturnType<typeof getOwnerIdeogramImageParameterProfile>;
  readonly public_settings: Readonly<Record<string, unknown> & {
    accepted_file_types: readonly string[];
    file_count_limit: Readonly<Record<string, number>>;
    get_cost_params: readonly string[];
    max_file_size: number;
    max_prompt_length: number;
    uploadable: boolean;
  }>;
  readonly input_policy: Readonly<{
    accepted_file_types: readonly string[];
    catalog_source_max_bytes: number;
    local_max_bytes: number;
    effective_local_max_bytes: number;
    source_size_scope: "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE";
    local_size_scope: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
    file_count_limit: Readonly<Record<string, number>>;
    max_prompt_length: number;
    prompt_metadata_scope: "PUBLIC_CATALOG_METADATA_NOT_EFFECTIVE_PROVIDER_LIMIT";
    provider_acceptance: "UNPROVEN";
  }>;
  readonly cost_policy: Readonly<{
    declared_metadata_keys: readonly string[];
    controlled_inputs: readonly string[];
    quote_or_amount: "UNPROVEN";
    confidence: "SOURCE_CALLBACK_INPUTS_ONLY_PRICE_AND_BILLING_UNPROVEN";
  }>;
  readonly effective_defaults: "UNKNOWN_NOT_FILLED_FROM_UI_INITIALIZER_CANDIDATES";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerIdeogramImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata" | "catalog_kind" | "runtime_usable"> {}

export class OwnerIdeogramImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Ideogram source profile could not be verified.");
    this.name = "OwnerIdeogramImageSourceProfileError";
  }
}

/** Returns frozen source metadata for one exact model/mode and e551 row; it grants no upload or dispatch authority. */
export function getOwnerIdeogramImageSourceProfile(
  modelInput: unknown,
  modeInput: unknown,
  catalogInput: OwnerIdeogramImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerIdeogramImageSourceProfile> {
  if (!isContext(modelInput, modeInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  assertParameterSourceBinding();
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [modelInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model, modelInput);
  if (record.id !== modelInput || record.upstream_id !== modelInput || record.ai_name !== "ideogram" || record.active !== true ||
      record.default !== MODEL_DEFAULTS[modelInput] || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" || record.operations.length !== 1 ||
      record.operations[0]?.id !== "generate-image" || record.operations[0]?.output_modality !== "image" ||
      record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" || !sameJson(record.settings, MODEL_SETTINGS[modelInput])) fail("PROFILE_BINDING_MISMATCH");
  const settings = record.settings;
  const inputPolicy = OWNER_IDEOGRAM_IMAGE_INPUT_POLICY.models[modelInput];
  if (!sameJson(inputPolicy.accepted_mime_types, settings.accepted_file_types) ||
      inputPolicy.source_max_bytes !== settings.max_file_size || inputPolicy.local_max_bytes !== 64 * 1024 * 1024) fail("PROFILE_BINDING_MISMATCH");
  const sourceContext = EXPECTED_CONTEXTS.find((context) => context.model_id === modelInput && context.mode === modeInput);
  const parameterContext = PARAMETERS_SOURCE.contexts.find((context) => context.model_id === modelInput && context.mode === modeInput);
  if (!sourceContext || !parameterContext || !sameJson(sourceContext, parameterContext)) fail("PROFILE_BINDING_MISMATCH");
  const sourceBinding = deepFreeze({
    selected_public_catalog_version: CATALOG_VERSION,
    selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
    selected_public_source_hashes: SOURCE_HASHES,
    normalized_public_model: record,
    settings_inventory: {
      version: SETTINGS_VERSION,
      form_id: "ideogram" as const,
      form_binding_status: "STRUCTURAL_MATCH" as const,
      settings_status: "PUBLIC_SETTINGS_KNOWN" as const,
      runtime_usable: false as const,
      defaults_status: "UNKNOWN" as const,
      conditional_visibility: "NOT_FULLY_EVALUATED" as const,
      payload_acceptance: "NOT_RUNTIME_VERIFIED" as const
    },
    source_artifacts: SOURCE_ARTIFACTS,
    mode_join_status: "ALL_NINE_STATIC_SOURCE_CONTEXTS_NOT_RUNTIME_VERIFIED" as const,
    source_execution: false as const
  });
  const base = deepFreeze({
    profile_id: "ideogram-image-source-profile-v1" as const,
    model_id: modelInput, mode: modeInput, ai_name: "ideogram" as const, model_type: modelInput,
    catalog_default_flag: record.default,
    catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION" as const,
    operation_id: "generate-image" as const, public_catalog_version: CATALOG_VERSION,
    source_context: parameterContext,
    source_binding: sourceBinding,
    parameters_source: PARAMETERS_SOURCE,
    public_settings: settings as OwnerIdeogramImageSourceProfile["public_settings"],
    input_policy: {
      accepted_file_types: settings.accepted_file_types as readonly string[],
      catalog_source_max_bytes: settings.max_file_size as number,
      local_max_bytes: inputPolicy.local_max_bytes,
      effective_local_max_bytes: inputPolicy.source_max_bytes === 0 ? inputPolicy.local_max_bytes : Math.min(inputPolicy.source_max_bytes, inputPolicy.local_max_bytes),
      source_size_scope: "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE" as const,
      local_size_scope: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const,
      file_count_limit: settings.file_count_limit as Readonly<Record<string, number>>,
      max_prompt_length: settings.max_prompt_length as number,
      prompt_metadata_scope: "PUBLIC_CATALOG_METADATA_NOT_EFFECTIVE_PROVIDER_LIMIT" as const,
      provider_acceptance: "UNPROVEN" as const
    },
    cost_policy: {
      declared_metadata_keys: settings.get_cost_params as readonly string[],
      controlled_inputs: COST_INPUTS[modelInput],
      quote_or_amount: "UNPROVEN" as const,
      confidence: "SOURCE_CALLBACK_INPUTS_ONLY_PRICE_AND_BILLING_UNPROVEN" as const
    },
    effective_defaults: "UNKNOWN_NOT_FILLED_FROM_UI_INITIALIZER_CANDIDATES" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerIdeogramImageSourceProfile>;
}

function assertParameterSourceBinding(): void {
  if (!sameJson(OWNER_IDEOGRAM_IMAGE_CONTEXTS, EXPECTED_CONTEXTS) || !sameJson(PARAMETERS_SOURCE.contexts, EXPECTED_CONTEXTS) ||
      PARAMETERS_SOURCE.source_pins.public_catalog_version !== CATALOG_VERSION ||
      PARAMETERS_SOURCE.source_pins.form_module_sha256 !== SOURCE_ARTIFACTS.form.sha256 ||
      PARAMETERS_SOURCE.source_pins.helper_module_sha256 !== SOURCE_ARTIFACTS.mode_registry.sha256 ||
      PARAMETERS_SOURCE.source_pins.source_execution !== false || PARAMETERS_SOURCE.dispatch_allowed !== false ||
      PARAMETERS_SOURCE.runtime_activation !== false || PARAMETERS_SOURCE.backend_acceptance !== "UNPROVEN" ||
      PARAMETERS_SOURCE.cost_input_mapping !== "SOURCE_CALLBACK_FIELDS_MAPPED_PRICE_AND_BACKEND_UNPROVEN" ||
      PARAMETERS_SOURCE.prompt_policy.required_in_all_contexts_except !== "ideogram/reframe" ||
      PARAMETERS_SOURCE.custom_source_bounds.prompt_maximum !== 10_000 ||
      !sameJson(PARAMETERS_SOURCE.cost_declared_keys, EXPECTED_COST_METADATA) ||
      !sameJson(PARAMETERS_SOURCE.cost_callback_projection, EXPECTED_COST_PROJECTION)) fail("PROFILE_BINDING_MISMATCH");
}

function snapshotCatalog(input: unknown): Readonly<{ receiver: object; getModel: (...args: never[]) => unknown }> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const getModel = readProperty(input, "getModel");
  const fetchedAt = readProperty(input, "fetched_at");
  const catalogKind = readProperty(input, "catalog_kind");
  const runtimeUsable = readProperty(input, "runtime_usable");
  const hashes = readDataRecord(readProperty(input, "source_hashes"), ["ai", "llm_models", "models"]);
  const metadata = readSelectedFields(readProperty(input, "catalog_metadata"), ["fetched_at", "source_hashes", "sources", "summary", "public_settings_coverage"]);
  const metadataHashes = readDataRecord(metadata.source_hashes, ["ai", "llm_models", "models"]);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false || metadata.fetched_at !== CATALOG_FETCHED_AT ||
      metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" || !sameJson(hashes, SOURCE_HASHES) ||
      !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown, model: OwnerIdeogramImageModelId): Readonly<{
  id: string; upstream_id: string; ai_name: string; display_name: string; description: string | null; active: boolean; default: boolean;
  type: string | null; scope: string | null; modalities: readonly unknown[];
  operations: readonly Readonly<{ id: unknown; display_name: unknown; output_modality: unknown; derivation: unknown }>[];
  features: DeepReadonly<unknown>; settings: Readonly<Record<string, unknown>>; llm_enrichment: DeepReadonly<unknown>;
  catalog_kind: string; runtime_usable: boolean; fetched_at: string; source_hashes: Readonly<Record<string, unknown>>;
}> {
  const fields = readSelectedFields(value, ["id", "upstream_id", "ai_name", "display_name", "description", "active", "default", "type", "scope", "modalities", "operations", "features", "settings", "llm_enrichment", "catalog_kind", "runtime_usable", "fetched_at", "source_hashes"]);
  const hashes = readDataRecord(fields.source_hashes, ["ai", "llm_models", "models"]);
  const settings = snapshotJson(fields.settings);
  const operations = snapshotArray(fields.operations).map((operation) => {
    const op = readSelectedFields(operation, ["id", "display_name", "output_modality", "derivation"]);
    return deepFreeze({ id: op.id, display_name: op.display_name, output_modality: op.output_modality, derivation: op.derivation });
  });
  const result = deepFreeze({
    id: readString(fields.id), upstream_id: readString(fields.upstream_id), ai_name: readString(fields.ai_name),
    display_name: readString(fields.display_name), description: fields.description === null ? null : readString(fields.description),
    active: readBoolean(fields.active), default: readBoolean(fields.default),
    type: fields.type === null ? null : readString(fields.type), scope: fields.scope === null ? null : readString(fields.scope),
    modalities: snapshotArray(fields.modalities), operations,
    features: snapshotJson(fields.features), settings: settings as Readonly<Record<string, unknown>>,
    llm_enrichment: snapshotJson(fields.llm_enrichment), catalog_kind: readString(fields.catalog_kind),
    runtime_usable: readBoolean(fields.runtime_usable), fetched_at: readString(fields.fetched_at), source_hashes: hashes
  });
  if (!sameJson(result.source_hashes, SOURCE_HASHES) || !sameJson(result.settings, MODEL_SETTINGS[model])) fail("PROFILE_BINDING_MISMATCH");
  return result;
}

function readProperty(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function readSelectedFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readDataRecord(value: unknown, exactKeys?: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (exactKeys && (actual.length !== exactKeys.length || actual.some((key) => typeof key !== "string" || !exactKeys.includes(key)))) fail("PROFILE_BINDING_MISMATCH");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of actual) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result[key] = descriptors[key]!.value;
  }
  return result;
}
function snapshotJson(value: unknown, depth = 0): DeepReadonly<unknown> {
  if (depth > 12) fail("PROFILE_BINDING_MISMATCH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("PROFILE_BINDING_MISMATCH"); return value; }
  if (Array.isArray(value)) return Object.freeze(snapshotArray(value).map((item) => snapshotJson(item, depth + 1)));
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result[key] = snapshotJson(descriptors[key]!.value, depth + 1);
  }
  return deepFreeze(result);
}
function snapshotArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))];
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== expected.length || actual.some((key) => typeof key !== "string" || !expected.includes(key))) fail("PROFILE_BINDING_MISMATCH");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}
function sameJson(left: unknown, right: unknown): boolean { try { return JSON.stringify(left) === JSON.stringify(right); } catch { fail("PROFILE_BINDING_MISMATCH"); } }
function readString(value: unknown): string { if (typeof value !== "string") fail("PROFILE_BINDING_MISMATCH"); return value; }
function readBoolean(value: unknown): boolean { if (typeof value !== "boolean") fail("PROFILE_BINDING_MISMATCH"); return value; }
function isContext(model: unknown, mode: unknown): model is OwnerIdeogramImageModelId {
  return typeof model === "string" && typeof mode === "string" && EXPECTED_CONTEXTS.some((context) => context.model_id === model && context.mode === mode);
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerIdeogramImageSourceProfileError(code); }
