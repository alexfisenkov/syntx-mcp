import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { getOwnerSoulGenerationSourceParameters } from "./owner-soul-generation-parameters.js";

const MODEL_ID = "higgsfield-soul" as const;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const MODEL_RECORD_SHA256 = "sha256:16da8ea2298f05143e9992197536d63830a9359428312e2c635287d8f152fa22";
const SOURCE_PARAMETERS = getOwnerSoulGenerationSourceParameters();
const COST_INPUT_KEYS = Object.freeze(["quality", "resolution", "batch_size"] as const);
const MODEL_RECORD_KEYS = Object.freeze([
  "id", "upstream_id", "ai_name", "display_name", "description", "active", "default", "type", "scope", "modalities",
  "operations", "features", "settings", "llm_enrichment", "catalog_kind", "runtime_usable", "fetched_at", "source_hashes"
] as const);
const SOURCE_HASH_KEYS = Object.freeze(["ai", "llm_models", "models"] as const);
const EXPECTED_PUBLIC_SETTINGS = Object.freeze({
  accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"] as const),
  allowed_media_types: Object.freeze(["images"] as const),
  attach_info_text: null,
  get_cost_params: Object.freeze(["quality", "resolution", "batch_size", "version"] as const),
  max_file_size: 0,
  max_prompt_length: 0,
  uploadable: true
});
const SOURCE_IDENTITIES = deepFreeze({
  form: { module: "higgsfield-soul.js", build_id: "1791467421", bytes: 13_664,
    sha256: "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391" },
  app_store: { module: "app.js", build_id: "1791467421",
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" },
  settings_helper: { module: "settings3.js", build_id: "1791467421",
    sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" },
  cost_helper: { module: "cost2.js", build_id: "1791467421", bytes: 1_660,
    sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" },
  seed_helper: { module: "RandomSeed.js", build_id: "1791467421", bytes: 1_656,
    sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
    previous_inventory_sha256: "sha256:def0200d386d96249e3af381b6a4e85fd18f7e286936fa86ab82c9ed6d69a7e5" },
  sender_parent: { module: "index6.js", build_id: "1791467421", bytes: 12_886,
    sha256: "sha256:eb4fe700c7afae0756348aad3118c55ec8c9b5f5e5d18832045be07bbd368447" },
  sender_module: { module: "video.js", build_id: "1791467421", bytes: 8_689,
    sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae" }
} as const);
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerSoulImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata" | "catalog_kind" | "runtime_usable"> {}

export interface OwnerSoulImageSourceProfile {
  readonly profile_id: "owner-soul-image-source-profile-v1";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof MODEL_ID;
  readonly model_type: typeof MODEL_ID;
  readonly model_type_source: "ACTIVE_SELECTED_E551_UPSTREAM_ID_NOT_RUNTIME_SELECTION";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly catalog_default_flag: true;
  readonly catalog_default_confidence: "PUBLIC_CATALOG_FLAG_ONLY_NOT_RUNTIME_SELECTION";
  readonly source_binding: DeepReadonly<{
    selected_public_catalog_version: typeof CATALOG_VERSION;
    selected_public_catalog_fetched_at: typeof CATALOG_FETCHED_AT;
    selected_public_source_hashes: typeof SOURCE_HASHES;
    full_public_record_sha256: typeof MODEL_RECORD_SHA256;
    full_public_record_verified: true;
    files: typeof SOURCE_IDENTITIES;
    form_to_shared_settings: "PINNED_FORM_CALLS_SETTINGS3_U_IMAGE_AND_SOUL";
    shared_settings_to_sender: "STATIC_APP_STORE_TO_GENERIC_SENDER_JOIN";
    direct_ui_mount: "DYNAMIC_FORM_MOUNT_UNRESOLVED_UI";
    direct_ui_mount_blocks_explicit_native_intent: false;
    sender: {
      parent_export: "Pe";
      sender_export: "sendMessage";
      sender_import: "video.js:u";
      request_envelope: readonly ["chat_uuid", "prompt", "settings"];
      ordinary_branch: "IF_CUSTOM_SLOT_NULL_SPREADS_APP_STORE_SETTINGS";
      custom_payload_branch: "TRUTHY_REPLACES_SETTINGS_NOT_MERGED";
      custom_payload_snapshot_before_chat_branch: true;
      reference_canonicalization: "APPENDS_MAPPED_FILES_TO_SETTINGS_FILE_URLS";
      direct_soul_form_mount: "DYNAMIC_FORM_MOUNT_UNRESOLVED_UI";
      reference_strength_wire_fate: "CONDITIONAL_NOT_RUNTIME_OBSERVED";
      source_execution: false;
      backend_acceptance: "UNPROVEN";
    };
  }>;
  readonly parameters_source: ReturnType<typeof getOwnerSoulGenerationSourceParameters>;
  readonly source_initializers: DeepReadonly<{
    resolution: "1152x2048";
    quality: "720p";
    batch_size: 1;
    reference_id: "";
    reference_strength: 0.7;
    style_id: "";
    style_strength: 0.7;
    enhance_prompt: true;
    seed: null;
    confidence: "SOURCE_INITIALIZERS_NOT_EFFECTIVE_DEFAULTS";
  }>;
  readonly style_selection: DeepReadonly<{
    modes: readonly ["none", "selected"];
    maximum_selections: 1;
    ui_empty_value: "";
    identifier: "DYNAMIC_NOT_STATIC_ENUM";
    source_value: "record.style_id";
    source_label: "record.name";
    source_image: "PRIVATE_NOT_EMITTED";
    strength_minimum: 0;
    strength_maximum: 1;
    strength_step: 0.1;
    strength_condition: "SELECTED_STYLE_ONLY";
    owner_style_handles: "READ_ONLY_PROCESS_LOCAL_NOT_GENERATION_PERMISSION";
    backend_acceptance: "UNPROVEN";
  }>;
  readonly character_selection: DeepReadonly<{
    modes: readonly ["none", "selected"];
    optional_none_branch: true;
    selection_key: "record.id";
    display_label: "record.title";
    selected_value_source: "record.reference_id";
    selection_requires_status: "completed";
    known_statuses: readonly ["not-ready", "in-progress", "queue", "error", "completed"];
    ui_value_types: readonly ["string", "number"];
    server_reference_id_type: "UNOBSERVED_EMPTY_LIST";
    owned_reference_permission: "UNPROVEN_NO_CHARACTER_UPLOAD_HANDLE";
    backend_acceptance: "UNPROVEN";
  }>;
  readonly reference_strength: DeepReadonly<{
    initializer_value: 0.7;
    visible_control: false;
    saved_model_value_key: false;
    removed_by_fixed_cache_prune: false;
    ordinary_sender_condition: "ACTIVE_SETTINGS_FIELD_AND_NULL_CUSTOM_PAYLOAD";
    effective_value: "UNPROVEN";
    normalizer_accepts: false;
    backend_acceptance: "UNPROVEN";
  }>;
  readonly public_settings: Readonly<Record<string, unknown>>;
  readonly public_input_metadata: DeepReadonly<{
    accepted_file_types: typeof EXPECTED_PUBLIC_SETTINGS.accepted_file_types;
    allowed_media_types: typeof EXPECTED_PUBLIC_SETTINGS.allowed_media_types;
    file_count_limit: null;
    file_count_limit_interpretation: "ABSENT_NOT_UNLIMITED_OR_REFERENCE_SELECTOR";
    max_file_size: 0;
    max_file_size_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP";
    max_prompt_length: 0;
    max_prompt_length_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP";
    uploadable: true;
    upload_interpretation: "PUBLIC_CATALOG_METADATA_ONLY_NOT_OWNER_UPLOAD_PERMISSION";
  }>;
  readonly cost_policy: DeepReadonly<{
    declared_model_info_keys: typeof EXPECTED_PUBLIC_SETTINGS.get_cost_params;
    cost_input_keys: typeof COST_INPUT_KEYS;
    projector: "projectOwnerSoulImageCostParameters";
    cost_inputs_confidence: "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP";
    cost_helper_sha256: typeof SOURCE_IDENTITIES.cost_helper.sha256;
    selector: "settings.model_type_OR_settings.model";
    query_is_generation_wire: false;
    generation_cost_inputs: null;
    projection_status: "JOINED_PARAMETER_DEFINITION_ONLY_NO_INTENT_VALUES";
    version_value: "UNRESOLVED_NOT_UI_CONTROL";
    quote_or_unit: "UNPROVEN";
  }>;
  readonly direct_ui_mount_blocks_explicit_native_intent: false;
  readonly source_confidence: "PINNED_STATIC_SOURCE_AND_E551_ROW_NOT_RENDERED_UI_OR_PROVIDER_PROOF";
  readonly effective_defaults: "UNKNOWN_SOURCE_INITIALIZERS_NOT_EFFECTIVE_DEFAULTS";
  readonly generation_readiness: "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerSoulImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Soul image source profile could not be verified.");
    this.name = "OwnerSoulImageSourceProfileError";
  }
}

/** Returns full pinned source metadata for Soul explicit intent; this is not a generation permit. */
export function getOwnerSoulImageSourceProfile(
  modelInput: unknown,
  catalogInput: OwnerSoulImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerSoulImageSourceProfile> {
  if (modelInput !== MODEL_ID) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  assertParameterSource();
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [MODEL_ID]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model);
  if (record.id !== MODEL_ID || record.upstream_id !== MODEL_ID || record.ai_name !== MODEL_ID || record.active !== true ||
      record.default !== true || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      !sameJson(record.modalities, ["image"]) || !sameJson(record.operations, [{
        id: "generate-image", display_name: "Generate image", output_modality: "image", derivation: "PUBLIC_AI_SCOPE"
      }]) || !sameJson(record.settings, EXPECTED_PUBLIC_SETTINGS) || schemaHash(record) !== MODEL_RECORD_SHA256) {
    fail("PROFILE_BINDING_MISMATCH");
  }
  const base = deepFreeze({
    profile_id: "owner-soul-image-source-profile-v1" as const,
    model_id: MODEL_ID,
    ai_name: MODEL_ID,
    model_type: MODEL_ID,
    model_type_source: "ACTIVE_SELECTED_E551_UPSTREAM_ID_NOT_RUNTIME_SELECTION" as const,
    operation_id: "generate-image" as const,
    public_catalog_version: CATALOG_VERSION,
    catalog_default_flag: true as const,
    catalog_default_confidence: "PUBLIC_CATALOG_FLAG_ONLY_NOT_RUNTIME_SELECTION" as const,
    source_binding: {
      selected_public_catalog_version: CATALOG_VERSION,
      selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
      selected_public_source_hashes: SOURCE_HASHES,
      full_public_record_sha256: MODEL_RECORD_SHA256,
      full_public_record_verified: true as const,
      files: SOURCE_IDENTITIES,
      form_to_shared_settings: "PINNED_FORM_CALLS_SETTINGS3_U_IMAGE_AND_SOUL" as const,
      shared_settings_to_sender: "STATIC_APP_STORE_TO_GENERIC_SENDER_JOIN" as const,
      direct_ui_mount: "DYNAMIC_FORM_MOUNT_UNRESOLVED_UI" as const,
      direct_ui_mount_blocks_explicit_native_intent: false as const,
      sender: {
        parent_export: "Pe" as const,
        sender_export: "sendMessage" as const,
        sender_import: "video.js:u" as const,
        request_envelope: ["chat_uuid", "prompt", "settings"] as const,
        ordinary_branch: "IF_CUSTOM_SLOT_NULL_SPREADS_APP_STORE_SETTINGS" as const,
        custom_payload_branch: "TRUTHY_REPLACES_SETTINGS_NOT_MERGED" as const,
        custom_payload_snapshot_before_chat_branch: true as const,
        reference_canonicalization: "APPENDS_MAPPED_FILES_TO_SETTINGS_FILE_URLS" as const,
        direct_soul_form_mount: "DYNAMIC_FORM_MOUNT_UNRESOLVED_UI" as const,
        reference_strength_wire_fate: "CONDITIONAL_NOT_RUNTIME_OBSERVED" as const,
        source_execution: false as const,
        backend_acceptance: "UNPROVEN" as const
      }
    },
    parameters_source: SOURCE_PARAMETERS,
    source_initializers: {
      resolution: "1152x2048" as const, quality: "720p" as const, batch_size: 1 as const, reference_id: "" as const,
      reference_strength: 0.7 as const, style_id: "" as const, style_strength: 0.7 as const, enhance_prompt: true as const,
      seed: null, confidence: "SOURCE_INITIALIZERS_NOT_EFFECTIVE_DEFAULTS" as const
    },
    style_selection: {
      modes: ["none", "selected"] as const, maximum_selections: 1 as const, ui_empty_value: "" as const,
      identifier: "DYNAMIC_NOT_STATIC_ENUM" as const, source_value: "record.style_id" as const,
      source_label: "record.name" as const, source_image: "PRIVATE_NOT_EMITTED" as const,
      strength_minimum: 0 as const, strength_maximum: 1 as const, strength_step: 0.1 as const,
      strength_condition: "SELECTED_STYLE_ONLY" as const,
      owner_style_handles: "READ_ONLY_PROCESS_LOCAL_NOT_GENERATION_PERMISSION" as const, backend_acceptance: "UNPROVEN" as const
    },
    character_selection: {
      modes: ["none", "selected"] as const, optional_none_branch: true as const,
      selection_key: "record.id" as const, display_label: "record.title" as const, selected_value_source: "record.reference_id" as const,
      selection_requires_status: "completed" as const,
      known_statuses: ["not-ready", "in-progress", "queue", "error", "completed"] as const,
      ui_value_types: ["string", "number"] as const, server_reference_id_type: "UNOBSERVED_EMPTY_LIST" as const,
      owned_reference_permission: "UNPROVEN_NO_CHARACTER_UPLOAD_HANDLE" as const, backend_acceptance: "UNPROVEN" as const
    },
    reference_strength: {
      initializer_value: 0.7 as const, visible_control: false as const, saved_model_value_key: false as const,
      removed_by_fixed_cache_prune: false as const, ordinary_sender_condition: "ACTIVE_SETTINGS_FIELD_AND_NULL_CUSTOM_PAYLOAD" as const,
      effective_value: "UNPROVEN" as const, normalizer_accepts: false as const, backend_acceptance: "UNPROVEN" as const
    },
    public_settings: record.settings,
    public_input_metadata: {
      accepted_file_types: EXPECTED_PUBLIC_SETTINGS.accepted_file_types,
      allowed_media_types: EXPECTED_PUBLIC_SETTINGS.allowed_media_types,
      file_count_limit: null,
      file_count_limit_interpretation: "ABSENT_NOT_UNLIMITED_OR_REFERENCE_SELECTOR" as const,
      max_file_size: 0 as const,
      max_file_size_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP" as const,
      max_prompt_length: 0 as const,
      max_prompt_length_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP" as const,
      uploadable: true as const,
      upload_interpretation: "PUBLIC_CATALOG_METADATA_ONLY_NOT_OWNER_UPLOAD_PERMISSION" as const
    },
    cost_policy: {
      declared_model_info_keys: EXPECTED_PUBLIC_SETTINGS.get_cost_params,
      cost_input_keys: COST_INPUT_KEYS,
      projector: "projectOwnerSoulImageCostParameters" as const,
      cost_inputs_confidence: "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
      cost_helper_sha256: SOURCE_IDENTITIES.cost_helper.sha256,
      selector: "settings.model_type_OR_settings.model" as const,
      query_is_generation_wire: false as const,
      generation_cost_inputs: null,
      projection_status: "JOINED_PARAMETER_DEFINITION_ONLY_NO_INTENT_VALUES" as const,
      version_value: "UNRESOLVED_NOT_UI_CONTROL" as const,
      quote_or_unit: "UNPROVEN" as const
    },
    direct_ui_mount_blocks_explicit_native_intent: false as const,
    source_confidence: "PINNED_STATIC_SOURCE_AND_E551_ROW_NOT_RENDERED_UI_OR_PROVIDER_PROOF" as const,
    effective_defaults: "UNKNOWN_SOURCE_INITIALIZERS_NOT_EFFECTIVE_DEFAULTS" as const,
    generation_readiness: "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerSoulImageSourceProfile>;
}

function assertParameterSource(): void {
  const pins = SOURCE_PARAMETERS.source_pins;
  if (pins.build_id !== SOURCE_IDENTITIES.form.build_id || pins.form_sha256 !== SOURCE_IDENTITIES.form.sha256 ||
      pins.app_store_sha256 !== SOURCE_IDENTITIES.app_store.sha256 || pins.settings_helper_sha256 !== SOURCE_IDENTITIES.settings_helper.sha256 ||
      pins.cost_helper_sha256 !== SOURCE_IDENTITIES.cost_helper.sha256 || pins.random_seed_helper_sha256 !== SOURCE_IDENTITIES.seed_helper.sha256 ||
      SOURCE_PARAMETERS.model.model_type_source !== "active_selected_e551_model_upstream_id" || SOURCE_PARAMETERS.dispatch_allowed !== false ||
      !sameJson(SOURCE_PARAMETERS.quality_resolution_pairs, {
        "720p": ["2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048"],
        "1080p": ["2048x1152", "2016x1344", "2048x1536", "1536x1536", "1536x2048", "1344x2016", "1152x2048"]
      })) fail("PROFILE_BINDING_MISMATCH");
}

function snapshotCatalog(input: unknown): Readonly<{ receiver: object; getModel: (...args: never[]) => unknown }> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const getModel = readProperty(input, "getModel");
  const fetchedAt = readProperty(input, "fetched_at");
  const catalogKind = readProperty(input, "catalog_kind");
  const runtimeUsable = readProperty(input, "runtime_usable");
  const hashes = snapshotExactRecord(snapshotJson(readProperty(input, "source_hashes")), SOURCE_HASH_KEYS);
  const metadata = snapshotExactRecord(snapshotJson(readProperty(input, "catalog_metadata")),
    ["fetched_at", "source_hashes", "sources", "summary", "public_settings_coverage"]);
  const metadataHashes = snapshotExactRecord(metadata.source_hashes, SOURCE_HASH_KEYS);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false || metadata.fetched_at !== CATALOG_FETCHED_AT ||
      metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" || !sameJson(hashes, SOURCE_HASHES) ||
      !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input as object, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown): Readonly<Record<string, unknown> & { readonly settings: Readonly<Record<string, unknown>> }> {
  const record = snapshotExactRecord(snapshotJson(value), MODEL_RECORD_KEYS);
  const settings = snapshotExactRecord(record.settings, Object.keys(EXPECTED_PUBLIC_SETTINGS));
  const normalized = deepFreeze({ ...record, settings });
  if (schemaHash(normalized) !== MODEL_RECORD_SHA256) fail("PROFILE_BINDING_MISMATCH");
  return normalized as Readonly<Record<string, unknown> & { readonly settings: Readonly<Record<string, unknown>> }>;
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

function snapshotJson(value: unknown, depth = 0, budget: { nodes: number } = { nodes: 0 }): DeepReadonly<unknown> {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) fail("PROFILE_BINDING_MISMATCH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("PROFILE_BINDING_MISMATCH"); return value; }
  if (Array.isArray(value)) return Object.freeze(snapshotArray(value).map((item) => snapshotJson(item, depth + 1, budget)));
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result[key] = snapshotJson(descriptors[key]!.value, depth + 1, budget);
  }
  return deepFreeze(result);
}

function snapshotArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if (actual.length !== value.length + 1 || !actual.includes("length") || actual.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("PROFILE_BINDING_MISMATCH");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result.push(descriptor.value);
  }
  return Object.freeze(result);
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
function sameJson(left: unknown, right: unknown): boolean { try { return schemaHash(left) === schemaHash(right); } catch { fail("PROFILE_BINDING_MISMATCH"); } }
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value as object)) deepFreeze((value as Record<PropertyKey, unknown>)[key]!);
  return Object.freeze(value) as DeepReadonly<T>;
}
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerSoulImageSourceProfileError(code); }
