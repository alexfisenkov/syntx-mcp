import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerSeedreamImageSourceParameters,
  type OwnerSeedreamImageVariant
} from "./owner-seedream-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const SOURCE_PARAMETERS = getOwnerSeedreamImageSourceParameters();
const BASIC_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const);
const FLASH_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/heic", "image/heif", "image/tiff", "image/gif", "image/webp"] as const);
const PRO_MIMES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif"] as const);
const COMMON = Object.freeze({
  allowed_media_types: ["images"], attach_info_text: null, max_prompt_length: 0, uploadable: true
});
const MODEL_SETTINGS = Object.freeze({
  "seedream-4": Object.freeze({ ...COMMON, accepted_file_types: BASIC_MIMES, file_count_limit: 4, get_cost_params: [], max_file_size: 10_485_760 }),
  "seedream-4.5": Object.freeze({ ...COMMON, accepted_file_types: BASIC_MIMES, file_count_limit: 4, get_cost_params: [], max_file_size: 10_485_760 }),
  "seedream-5": Object.freeze({ ...COMMON, accepted_file_types: BASIC_MIMES, file_count_limit: 14, get_cost_params: [], max_file_size: 10_485_760 }),
  "seedream-5.0-flash": Object.freeze({
    ...COMMON, accepted_file_types: FLASH_MIMES, file_count_limit: 10, get_cost_params: [], max_file_size: 31_457_280,
    max_image_aspect_ratio: 16, max_image_dimension: 8_400, max_image_file_size: 11_010_048,
    max_image_height: 6_000, max_image_pixel_count: 36_000_000, max_image_width: 6_000,
    min_image_aspect_ratio: 0.0625, min_image_height: 15, min_image_pixel_count: 196, min_image_width: 15
  }),
  "seedream-5.0-pro": Object.freeze({
    ...COMMON, accepted_file_types: PRO_MIMES, file_count_limit: 10, get_cost_params: ["batch_size", "resolution"], max_file_size: 31_457_280,
    max_image_aspect_ratio: 16, max_image_dimension: 8_400, max_image_file_size: 27_525_120,
    max_image_height: 6_000, max_image_pixel_count: 36_000_000, max_image_width: 6_000,
    min_image_aspect_ratio: 0.0625, min_image_height: 15, min_image_pixel_count: 196, min_image_width: 15
  })
} as const);
const FORM_SOURCE = Object.freeze({
  module: "seedream.js", build_id: "1791467421", bytes: 9_142,
  sha256: "sha256:3e762f2725970438f392c18f1d4153e93d4aee1165597e28207a8853a0a5b1d1",
  evidence: "ROOT590_ANONYMOUS_GET_AND_STATIC_AST; VENDOR_NOT_EXECUTED" as const
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerSeedreamImageSourceProfile {
  readonly profile_id: "seedream-image-source-reviewed-v1";
  readonly model_id: OwnerSeedreamImageVariant;
  readonly variant: OwnerSeedreamImageVariant;
  readonly ai_name: "seedream";
  readonly model_type: OwnerSeedreamImageVariant;
  readonly catalog_default_flag: boolean;
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly source_controller_markers: Readonly<{
    controlled_fields: readonly ["aspect_ratio", "resolution", "output_format", "background"];
    inactive_fields: "NON_FLASH_FIELDS_NULL_IN_LOCAL_STATE_AND_OMITTED_FROM_WIRE";
    fixed_wire: Readonly<{ n: 1; stream: false }>;
    transparency: "FLASH_ONLY_SINGLE_PNG_AND_PIXEL_ELIGIBILITY_CONTEXT; NO_OWNED_OR_PIXEL_PROOF_HERE";
  }>;
  readonly parameters_source: ReturnType<typeof getOwnerSeedreamImageSourceParameters>;
  readonly public_settings: Readonly<Record<string, unknown>>;
  readonly reference_count: Readonly<{ minimum: 0; maximum: number; confidence: "PUBLIC_FILE_COUNT_METADATA_NOT_PROVIDER_ACCEPTANCE" }>;
  readonly mime_policy: Readonly<{ accepted_file_types: readonly string[]; confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE" }>;
  readonly input_policy: Readonly<{
    generic_max_file_bytes: number;
    image_max_file_bytes: number;
    local_structural_max_bytes: number;
    local_policy: "SELECTED_E551_IMAGE_METADATA_CEILING_NOT_PROVIDER_LIMIT";
    max_image_dimension: number | null;
    max_image_width: number | null;
    max_image_height: number | null;
    max_image_pixel_count: number | null;
    min_image_width: number | null;
    min_image_height: number | null;
    min_image_pixel_count: number | null;
    max_image_aspect_ratio: number | null;
    min_image_aspect_ratio: number | null;
    dimensions_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  }>;
  readonly cost_policy: Readonly<{
    declared_metadata_keys: readonly string[];
    controlled_inputs: readonly string[];
    pro_batch_size_semantics: "EXPLICIT_REFERENCE_COUNT_INCLUDING_ZERO";
    quote_or_amount: "UNPROVEN";
    confidence: "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}
export interface OwnerSeedreamImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

export class OwnerSeedreamImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Seedream image source profile could not be verified.");
    this.name = "OwnerSeedreamImageSourceProfileError";
  }
}

/** Returns a frozen reviewed profile for one exact e551 model record; it is not a runtime or provider guarantee. */
export function getOwnerSeedreamImageSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerSeedreamImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerSeedreamImageSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [variantInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model, variantInput);
  const expectedSettings = MODEL_SETTINGS[variantInput];
  const isDefault = variantInput === "seedream-5";
  if (record.id !== variantInput || record.upstream_id !== variantInput || record.ai_name !== "seedream" ||
      record.active !== true || record.default !== isDefault || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" || record.operations.length !== 1 ||
      record.operations[0]?.id !== "generate-image" || record.operations[0]?.output_modality !== "image" ||
      record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" || !sameJson(record.settings, expectedSettings)) fail("PROFILE_BINDING_MISMATCH");
  const genericBytes = expectedSettings.max_file_size;
  const imageBytes = "max_image_file_size" in expectedSettings ? expectedSettings.max_image_file_size : genericBytes;
  const count = expectedSettings.file_count_limit;
  const inputPolicy = deepFreeze({
    generic_max_file_bytes: genericBytes,
    image_max_file_bytes: imageBytes,
    local_structural_max_bytes: imageBytes,
    local_policy: "SELECTED_E551_IMAGE_METADATA_CEILING_NOT_PROVIDER_LIMIT" as const,
    max_image_dimension: numberOrNull(expectedSettings, "max_image_dimension"),
    max_image_width: numberOrNull(expectedSettings, "max_image_width"),
    max_image_height: numberOrNull(expectedSettings, "max_image_height"),
    max_image_pixel_count: numberOrNull(expectedSettings, "max_image_pixel_count"),
    min_image_width: numberOrNull(expectedSettings, "min_image_width"),
    min_image_height: numberOrNull(expectedSettings, "min_image_height"),
    min_image_pixel_count: numberOrNull(expectedSettings, "min_image_pixel_count"),
    max_image_aspect_ratio: numberOrNull(expectedSettings, "max_image_aspect_ratio"),
    min_image_aspect_ratio: numberOrNull(expectedSettings, "min_image_aspect_ratio"),
    dimensions_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const
  });
  const declaredCostKeys = expectedSettings.get_cost_params;
  const controlledInputs = variantInput === "seedream-5.0-pro" ? ["batch_size", "resolution"] : [];
  const base = deepFreeze({
    profile_id: "seedream-image-source-reviewed-v1" as const,
    model_id: variantInput, variant: variantInput, ai_name: "seedream" as const, model_type: variantInput,
    catalog_default_flag: record.default, operation_id: "generate-image" as const,
    public_catalog_version: CATALOG_VERSION,
    source_binding: {
      selected_public_catalog_version: CATALOG_VERSION,
      selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
      selected_public_source_hashes: SOURCE_HASHES,
      normalized_public_model: record,
      settings_inventory: {
        version: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
        form_id: "seedream", form_binding_status: "STRUCTURAL_MATCH", runtime_usable: false,
        defaults_status: "UNKNOWN", dynamic_visibility: "NOT_FULLY_EVALUATED", payload_acceptance: "NOT_RUNTIME_VERIFIED"
      },
      form_source: FORM_SOURCE,
      source_join: "ROOT591_CONTROL_JOIN_STATIC_SOURCE_ONLY; NOT_BROWSER_OR_PROVIDER_PROOF"
    },
    source_controller_markers: {
      controlled_fields: ["aspect_ratio", "resolution", "output_format", "background"] as const,
      inactive_fields: "NON_FLASH_FIELDS_NULL_IN_LOCAL_STATE_AND_OMITTED_FROM_WIRE" as const,
      fixed_wire: { n: 1 as const, stream: false as const },
      transparency: "FLASH_ONLY_SINGLE_PNG_AND_PIXEL_ELIGIBILITY_CONTEXT; NO_OWNED_OR_PIXEL_PROOF_HERE" as const
    },
    parameters_source: SOURCE_PARAMETERS,
    public_settings: record.settings,
    reference_count: { minimum: 0 as const, maximum: count, confidence: "PUBLIC_FILE_COUNT_METADATA_NOT_PROVIDER_ACCEPTANCE" as const },
    mime_policy: { accepted_file_types: record.settings.accepted_file_types as readonly string[], confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE" as const },
    input_policy: inputPolicy,
    cost_policy: {
      declared_metadata_keys: declaredCostKeys,
      controlled_inputs: controlledInputs,
      pro_batch_size_semantics: "EXPLICIT_REFERENCE_COUNT_INCLUDING_ZERO" as const,
      quote_or_amount: "UNPROVEN" as const,
      confidence: "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE" as const
    },
    effective_defaults: "UNKNOWN" as const,
    dispatch_allowed: false as const, runtime_activation: false as const, backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerSeedreamImageSourceProfile>;
}

function snapshotCatalog(input: unknown): Readonly<{ receiver: object; getModel: (...args: never[]) => unknown }> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const read = (key: string): unknown => {
    let current: object | null = input as object;
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  };
  const getModel = read("getModel"), fetchedAt = read("fetched_at"), catalogKind = read("catalog_kind");
  const runtimeUsable = read("runtime_usable");
  const hashes = readDataRecord(read("source_hashes"), ["ai", "llm_models", "models"]);
  const metadata = readSelectedFields(read("catalog_metadata"), ["fetched_at", "source_hashes", "public_settings_coverage"]);
  const metadataHashes = readDataRecord(metadata.source_hashes, ["ai", "llm_models", "models"]);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false || metadata.fetched_at !== CATALOG_FETCHED_AT ||
      metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" || !sameJson(hashes, SOURCE_HASHES) || !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input as object, getModel: getModel as (...args: never[]) => unknown });
}

interface SeedreamModelSnapshot {
  readonly id: string;
  readonly upstream_id: string;
  readonly ai_name: string;
  readonly active: true;
  readonly default: unknown;
  readonly fetched_at: string;
  readonly scope: unknown;
  readonly modalities: readonly unknown[];
  readonly operations: readonly Readonly<{ id: unknown; output_modality: unknown; derivation: unknown }>[];
  readonly settings: Readonly<Record<string, unknown>>;
}
function snapshotModel(value: unknown, variant: OwnerSeedreamImageVariant): SeedreamModelSnapshot {
  const fields = readSelectedFields(value, ["id", "upstream_id", "ai_name", "active", "default", "scope", "modalities", "operations", "settings", "fetched_at", "source_hashes", "catalog_kind", "runtime_usable"]);
  const settingKeys = Object.keys(MODEL_SETTINGS[variant]);
  const settings = readDataRecord(fields.settings, settingKeys);
  const settingsSnapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of settingKeys) {
    const value = settings[key];
    settingsSnapshot[key] = key === "accepted_file_types" || key === "allowed_media_types" || key === "get_cost_params"
      ? snapshotDenseArray(value) : value;
  }
  const operations = snapshotDenseArray(fields.operations).map((operation) => {
    const op = readDataRecord(operation, ["id", "display_name", "output_modality", "derivation"]);
    return Object.freeze({ id: op.id, output_modality: op.output_modality, derivation: op.derivation });
  });
  const hashes = readDataRecord(fields.source_hashes, ["ai", "llm_models", "models"]);
  if (fields.active !== true || fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || fields.runtime_usable !== false || !sameJson(hashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({
    id: readString(fields.id), upstream_id: readString(fields.upstream_id), ai_name: readString(fields.ai_name), active: true,
    default: fields.default, fetched_at: readString(fields.fetched_at), scope: fields.scope,
    modalities: snapshotDenseArray(fields.modalities), operations, settings: settingsSnapshot, source_hashes: hashes
  });
}

function readDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readSelectedFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result[key] = descriptor.value;
  }
  return result;
}
function snapshotDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if (actual.length !== value.length + 1 || !actual.includes("length") || actual.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) fail("PROFILE_BINDING_MISMATCH");
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
function numberOrNull(record: Readonly<Record<string, unknown>>, key: string): number | null { const value = record[key]; return typeof value === "number" ? value : null; }
function plainRecord(value: unknown): value is Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false; const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null; }
function isVariant(value: unknown): value is OwnerSeedreamImageVariant { return typeof value === "string" && SOURCE_PARAMETERS.variants.includes(value as OwnerSeedreamImageVariant); }
function deepFreeze<T>(value: T): DeepReadonly<T> { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>; for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]); return Object.freeze(value) as DeepReadonly<T>; }
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerSeedreamImageSourceProfileError(code); }
