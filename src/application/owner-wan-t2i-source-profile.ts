import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerWanT2iSourceParameters,
  OWNER_WAN_T2I_MODELS,
  type OwnerWanT2iModel,
  type OwnerWanT2iSourceParameters
} from "./owner-wan-t2i-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const CATALOG_SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const PUBLIC_ROW_SCHEMA_HASHES = Object.freeze({
  wan_25_t2i_preview: "85dd8513cc1fb51429fef15454ec7959935284734cbb4d0f58c7feb7e046883a",
  wan_26_t2i: "44ab97682526f0564452a190742c059754a16427e5b09ce5c4736d79e2000f6e"
} as const);
const DISCOVERY_RECORD_SCHEMA_HASHES = Object.freeze({
  wan_25_t2i_preview: "sha256:46c6575ccb75a4e8475979993b5f0f7142d96c5f3ec68c075816798352321d26",
  wan_26_t2i: "sha256:608eca0223fedd4ad09afcdf772774f04542dd2a266176aa3b10cc24a9c74b9b"
} as const);
const MODEL_RECORD_KEYS = Object.freeze([
  "id", "upstream_id", "ai_name", "display_name", "description", "active", "default", "type", "scope",
  "modalities", "operations", "features", "settings", "llm_enrichment", "catalog_kind", "runtime_usable",
  "fetched_at", "source_hashes"
] as const);
const SOURCE_HASH_KEYS = Object.freeze(["ai", "llm_models", "models"] as const);
const EXPECTED_SETTINGS = deepFreeze({
  accepted_file_types: [], allowed_media_types: [], attach_info_text: null, file_count_limit: 0,
  get_cost_params: ["size", "batch_size"], max_file_size: 0, max_prompt_length: 1_500,
  max_side: 5_000, min_side: 384, uploadable: false
});
const SOURCE_PARAMETERS = getOwnerWanT2iSourceParameters();
const FORM_SHA256 = "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3";
const SETTINGS_HELPER_SHA256 = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
const COST_QUERY_SHA256 = "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223";
const COST_HELPER_SHA256 = "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9";
const SEED_HELPER_SHA256 = "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b";
const PALETTE_HELPER_SHA256 = "sha256:8062897bb3259b540840c65ad99af558a991d106b1b658f3eb1de3e9b06dc348";
const SOURCE_ARTIFACTS = deepFreeze({
  form: { module: "wan-image.js", build_id: "1791467421", bytes: 53_279,
    sha256: SOURCE_PARAMETERS.source_pins.form_sha256, execution: false as const },
  shared_store: { module: "app.js", build_id: "1791467421",
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" },
  settings_helper: { module: "settings3.js", build_id: "1791467421", bytes: 4_123,
    sha256: SOURCE_PARAMETERS.source_pins.settings_helper_sha256 },
  cost_helper: { module: "cost2.js", build_id: "1791467421", bytes: 1_660,
      sha256: SOURCE_PARAMETERS.source_pins.cost_helper_sha256 },
  cost_query_builder: { module: "cost.js", build_id: "1791467421", bytes: 2_745,
    sha256: SOURCE_PARAMETERS.source_pins.cost_source_sha256 },
  seed_helper: { module: "RandomSeed.js", build_id: "1791467421", bytes: 1_656,
    sha256: SEED_HELPER_SHA256 },
  palette_helper: { module: "sanitizeHex.js", build_id: "1791467421", bytes: 168,
    sha256: PALETTE_HELPER_SHA256 },
  prompt_component: { module: "index14.js", build_id: "1791467421", bytes: 258_638,
    sha256: "sha256:fbc1b642688cb9cfdd6e6ebe46593662e13ab05187b8e39c0ecd3244552a0928" },
  sender_parent: { module: "index6.js", build_id: "1791467421", bytes: 12_886,
    sha256: "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447" },
  sender: { module: "video.js", build_id: "1791467421", bytes: 8_689,
    sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae" }
});
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerWanT2iCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata" | "catalog_kind" | "runtime_usable"> {}

export interface OwnerWanT2iSourceProfile {
  readonly profile_id: "owner-wan-t2i-source-profile-v1";
  readonly model_id: OwnerWanT2iModel;
  readonly ai_name: "wan_image";
  readonly model_type: OwnerWanT2iModel;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly catalog_default_flag: boolean;
  readonly catalog_default_confidence: "PUBLIC_CATALOG_FLAG_ONLY_NOT_RUNTIME_SELECTION";
  readonly source_binding: DeepReadonly<{
    selected_public_catalog_version: typeof CATALOG_VERSION;
    selected_public_catalog_fetched_at: typeof CATALOG_FETCHED_AT;
    selected_public_source_hashes: typeof CATALOG_SOURCE_HASHES;
    public_catalog_raw_model_row_schema_hash: string;
    public_catalog_raw_model_row_hash_codec: "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD";
    discovery_model_record_schema_hash: string;
    discovery_record_hash_codec: "DOMAIN_SCHEMA_HASH_CANONICAL_JSON";
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_control_confidence: "PINNED_STATIC_SOURCE_NOT_EFFECTIVE_CACHE_OR_PROVIDER_PROOF";
    source_execution: false;
  }>;
  readonly parameters_source: OwnerWanT2iSourceParameters;
  readonly public_settings: Readonly<Record<string, unknown> & {
    readonly accepted_file_types: readonly string[];
    readonly allowed_media_types: readonly string[];
    readonly file_count_limit: 0;
    readonly get_cost_params: readonly ["size", "batch_size"];
    readonly max_file_size: 0;
    readonly max_prompt_length: 1_500;
    readonly uploadable: false;
  }>;
  readonly public_input_metadata: DeepReadonly<{
    accepted_file_types: readonly [];
    allowed_media_types: readonly [];
    file_count_limit: 0;
    uploadable: false;
    metadata_confidence: "PUBLIC_CATALOG_METADATA_NOT_UPLOAD_PERMISSION";
    max_file_size: 0;
    max_file_size_interpretation: "ZERO_NOT_UNLIMITED_OR_PROVIDER_CAP";
    max_prompt_length: 1_500;
    prompt_limit_interpretation: "SOURCE_UI_INPUT_LIMIT_NOT_BACKEND_LIMIT";
  }>;
  readonly cost_policy: DeepReadonly<{
    declared_model_info_keys: readonly ["size", "batch_size"];
    controlled_input_keys: readonly ["batch_size"];
    size_policy: "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS";
    source_hook: "COMMON_UNGUARDED_WAN_IMAGE_COST2_CALL_NO_OVERRIDES";
    query_route: "GET_MODEL_INFO_AI_NAME_AND_EXACT_SELECTED_MODEL_TYPE";
    query_is_generation_wire: false;
    projection_status: "JOINED_SOURCE_DEFINITION_ONLY_NO_INTENT_VALUES";
    confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP";
    quote_units_billing_hard_cap: "UNPROVEN";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerWanT2iSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner WAN T2I source profile could not be verified.");
    this.name = "OwnerWanT2iSourceProfileError";
  }
}

/** Binds one exact e551 T2I row and static source profile; this grants no upload or generation authority. */
export function getOwnerWanT2iSourceProfile(
  modelInput: unknown,
  catalogInput: OwnerWanT2iCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerWanT2iSourceProfile> {
  if (!isModel(modelInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  assertSourceParameters();
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [modelInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model, modelInput);
  const expectedDefault = modelInput === "wan_26_t2i";
  if (record.id !== modelInput || record.upstream_id !== modelInput || record.ai_name !== "wan_image" ||
      record.active !== true || record.default !== expectedDefault || record.fetched_at !== CATALOG_FETCHED_AT ||
      record.scope !== "image" || !sameJson(record.modalities, ["image"]) || !sameJson(record.operations, [{
        id: "generate-image", display_name: "Generate image", output_modality: "image", derivation: "PUBLIC_AI_SCOPE"
      }]) || !sameJson(record.settings, EXPECTED_SETTINGS) ||
      schemaHash(record) !== DISCOVERY_RECORD_SCHEMA_HASHES[modelInput]) fail("PROFILE_BINDING_MISMATCH");

  const sourceBinding = deepFreeze({
    selected_public_catalog_version: CATALOG_VERSION,
    selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
    selected_public_source_hashes: CATALOG_SOURCE_HASHES,
    public_catalog_raw_model_row_schema_hash: `sha256:${SOURCE_PARAMETERS.source_pins.model_row_sha256[modelInput]}`,
    public_catalog_raw_model_row_hash_codec: "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD" as const,
    discovery_model_record_schema_hash: DISCOVERY_RECORD_SCHEMA_HASHES[modelInput],
    discovery_record_hash_codec: "DOMAIN_SCHEMA_HASH_CANONICAL_JSON" as const,
    source_artifacts: SOURCE_ARTIFACTS,
    source_control_confidence: "PINNED_STATIC_SOURCE_NOT_EFFECTIVE_CACHE_OR_PROVIDER_PROOF" as const,
    source_execution: false as const
  });
  const base = deepFreeze({
    profile_id: "owner-wan-t2i-source-profile-v1" as const,
    model_id: modelInput,
    ai_name: "wan_image" as const,
    model_type: modelInput,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    public_catalog_version: CATALOG_VERSION,
    catalog_default_flag: record.default,
    catalog_default_confidence: "PUBLIC_CATALOG_FLAG_ONLY_NOT_RUNTIME_SELECTION" as const,
    source_binding: sourceBinding,
    parameters_source: SOURCE_PARAMETERS,
    public_settings: record.settings,
    public_input_metadata: {
      accepted_file_types: [] as const,
      allowed_media_types: [] as const,
      file_count_limit: 0 as const,
      uploadable: false as const,
      metadata_confidence: "PUBLIC_CATALOG_METADATA_NOT_UPLOAD_PERMISSION" as const,
      max_file_size: 0 as const,
      max_file_size_interpretation: "ZERO_NOT_UNLIMITED_OR_PROVIDER_CAP" as const,
      max_prompt_length: 1_500 as const,
      prompt_limit_interpretation: "SOURCE_UI_INPUT_LIMIT_NOT_BACKEND_LIMIT" as const
    },
    cost_policy: {
      declared_model_info_keys: ["size", "batch_size"] as const,
      controlled_input_keys: ["batch_size"] as const,
      size_policy: "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS" as const,
      source_hook: "COMMON_UNGUARDED_WAN_IMAGE_COST2_CALL_NO_OVERRIDES" as const,
      query_route: "GET_MODEL_INFO_AI_NAME_AND_EXACT_SELECTED_MODEL_TYPE" as const,
      query_is_generation_wire: false as const,
      projection_status: "JOINED_SOURCE_DEFINITION_ONLY_NO_INTENT_VALUES" as const,
      confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
      quote_units_billing_hard_cap: "UNPROVEN" as const
    },
    effective_defaults: "UNKNOWN" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerWanT2iSourceProfile>;
}

function snapshotCatalog(input: unknown): Readonly<{ receiver: object; getModel: (...args: never[]) => unknown }> {
  if (!plainRecordOrClass(input)) fail("INVALID_REQUEST");
  const getModel = readDataProperty(input, "getModel");
  const fetchedAt = readDataProperty(input, "fetched_at");
  const catalogKind = readDataProperty(input, "catalog_kind");
  const runtimeUsable = readDataProperty(input, "runtime_usable");
  const hashes = snapshotExactRecord(snapshotJson(readDataProperty(input, "source_hashes")), SOURCE_HASH_KEYS);
  const metadata = snapshotJson(readDataProperty(input, "catalog_metadata"));
  if (!plainRecord(metadata)) fail("PROFILE_BINDING_MISMATCH");
  const metadataFields = snapshotExactRecord(metadata, ["fetched_at", "source_hashes", "sources", "summary", "public_settings_coverage"]);
  const metadataHashes = snapshotExactRecord(metadataFields.source_hashes, SOURCE_HASH_KEYS);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false ||
      metadataFields.fetched_at !== CATALOG_FETCHED_AT || metadataFields.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(hashes, CATALOG_SOURCE_HASHES) || !sameJson(metadataHashes, CATALOG_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input as object, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown, model: OwnerWanT2iModel): Readonly<Record<string, unknown> & {
  readonly id: string; readonly upstream_id: string; readonly ai_name: string; readonly active: true; readonly default: boolean;
  readonly fetched_at: string; readonly scope: "image"; readonly modalities: readonly unknown[];
  readonly operations: readonly Readonly<Record<string, unknown>>[]; readonly settings: Readonly<Record<string, unknown>>;
}> {
  const snapshot = snapshotJson(value);
  const record = snapshotExactRecord(snapshot, MODEL_RECORD_KEYS);
  if (schemaHash(record) !== DISCOVERY_RECORD_SCHEMA_HASHES[model]) fail("PROFILE_BINDING_MISMATCH");
  if (record.id !== model || record.upstream_id !== model || record.ai_name !== "wan_image" || record.active !== true ||
      typeof record.default !== "boolean" || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || record.runtime_usable !== false ||
      !sameJson(record.source_hashes, CATALOG_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze(record) as ReturnType<typeof snapshotModel>;
}

function assertSourceParameters(): void {
  const pins = SOURCE_PARAMETERS.source_pins;
  if (!Object.isFrozen(SOURCE_PARAMETERS) || !sameJson(SOURCE_PARAMETERS.model_ids, OWNER_WAN_T2I_MODELS) ||
      pins.public_catalog_version !== CATALOG_VERSION ||
      pins.public_models_sha256 !== CATALOG_SOURCE_HASHES.models ||
      pins.model_row_hash_codec !== "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD" ||
      pins.model_row_sha256.wan_25_t2i_preview !== PUBLIC_ROW_SCHEMA_HASHES.wan_25_t2i_preview ||
      pins.model_row_sha256.wan_26_t2i !== PUBLIC_ROW_SCHEMA_HASHES.wan_26_t2i ||
      pins.form_build_id !== "1791467421" || pins.form_sha256 !== FORM_SHA256 ||
      pins.settings_helper_sha256 !== SETTINGS_HELPER_SHA256 ||
      pins.cost_source_sha256 !== COST_QUERY_SHA256 || pins.cost_helper_sha256 !== COST_HELPER_SHA256 ||
      SOURCE_PARAMETERS.cost.size !== "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS" ||
      !sameJson(SOURCE_PARAMETERS.cost.declared_get_cost_params, ["size", "batch_size"]) ||
      !sameJson(SOURCE_PARAMETERS.cost.cost_inputs, ["batch_size"]) ||
      SOURCE_PARAMETERS.dispatch_allowed !== false || SOURCE_PARAMETERS.runtime_activation !== false ||
      SOURCE_PARAMETERS.backend_acceptance !== "UNPROVEN") fail("PROFILE_BINDING_MISMATCH");
}

function snapshotExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotJson(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) fail("PROFILE_BINDING_MISMATCH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("PROFILE_BINDING_MISMATCH");
    return value;
  }
  if (!value || typeof value !== "object" || isProxy(value)) fail("PROFILE_BINDING_MISMATCH");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Reflect.ownKeys(descriptors);
    if (actual.length !== value.length + 1 || actual.some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
          !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("PROFILE_BINDING_MISMATCH");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
      result.push(snapshotJson(descriptor.value, depth + 1, budget));
    }
    return Object.freeze(result);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) ||
      descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = snapshotJson(descriptors[key]!.value, depth + 1, budget);
  return Object.freeze(result);
}

function readDataProperty(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor)) fail("INVALID_REQUEST");
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function plainRecordOrClass(value: unknown): value is object {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !isProxy(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return schemaHash(left) === schemaHash(right); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
}

function isModel(value: unknown): value is OwnerWanT2iModel {
  return typeof value === "string" && (OWNER_WAN_T2I_MODELS as readonly string[]).includes(value);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never {
  throw new OwnerWanT2iSourceProfileError(code);
}
