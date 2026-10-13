import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerBananaImageSourceParameters,
  type OwnerBananaImageVariant
} from "./owner-banana-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const SOURCE_PARAMETERS = getOwnerBananaImageSourceParameters();
const CATALOG_DEFAULTS = Object.freeze({ banana: false, "banana-2.1": false, banana2: false, banana3: true, banana3_light: true } as const);
const MODEL_SETTINGS = Object.freeze({
  banana: Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null, file_count_limit: 4,
    get_cost_params: Object.freeze([]), max_file_size: 0, max_prompt_length: 0, uploadable: true
  }),
  "banana-2.1": Object.freeze({
    accepted_file_types: Object.freeze(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime", "video/mpeg", "video/mov", "video/3gpp", "video/x-flv", "video/x-ms-wmv", "application/pdf"]),
    allowed_media_types: Object.freeze(["images", "videos", "other"]), attach_info_text: null,
    file_count_limit: Object.freeze({ documents: 10, images: 14, videos: 10 }), get_cost_params: Object.freeze(["image_size"]),
    image_resize_limit: 5_242_880,
    max_file_size: Object.freeze({ documents: 5_242_880, images: 7_340_032, videos: 20_971_520 }),
    max_image_dimension: 8_400, max_image_file_size: 7_340_032, max_image_pixel_count: 52_500_000,
    max_prompt_length: 0, max_total_file_size: 78_643_200, uploadable: true
  }),
  banana2: Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null, file_count_limit: 14,
    get_cost_params: Object.freeze(["image_size"]), max_file_size: 0, max_prompt_length: 0, uploadable: true
  }),
  banana3: Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null, file_count_limit: 14,
    get_cost_params: Object.freeze(["image_size"]), max_file_size: 0, max_prompt_length: 0, uploadable: true
  }),
  banana3_light: Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null, file_count_limit: 14,
    get_cost_params: Object.freeze(["image_size"]), max_file_size: 0, max_prompt_length: 0, uploadable: true
  })
} as const);
const SOURCE_ARTIFACTS = Object.freeze({
  form: Object.freeze({
    module: "banana.js", build_id: "1791467421", bytes: 7_033,
    sha256: "sha256:b66e233dc1ad667fc128b25c19255458ce51fe4bf6e4648d3848b27b402c1c1e",
    freshness: "ROOT546_ANONYMOUS_GET_MATCHED_PIN" as const,
    observed_http_date: "Sat, 10 Oct 2026 08:46:40 GMT",
    evidence: "HASH_PINNED_STATIC_AST_NOT_RENDERED_UI" as const
  }),
  settings_helper: Object.freeze({
    module: "settings3.js", bytes: 4_123,
    sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    freshness: "ROOT546_ANONYMOUS_GET_MATCHED_PIN" as const
  }),
  app_store: Object.freeze({
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
    evidence: "RETAINED_NOT_REFETCHED" as const
  }),
  ratio_static_map: Object.freeze({
    artifact: "catalog/runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-26627f87a943cc9a.json",
    sha256: "sha256:26627f87a943cc9a2a40ca159217f3e2e7f26232d58a9d5d5b9469d05d43ec50",
    evidence: "STATIC_CONTROL_OPTIONS_REUSED" as const
  }),
  banana_settings_candidate: Object.freeze({
    artifact: "banana-conditional-settings-v1.0.0.json",
    sha256: "sha256:9458bd83ce4091fc7a1bac333e45012ef1951ff0aaa5524788865c0ea8d12f1b",
    settings_inventory_version: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
    runtime_usable: false as const
  }),
  cost_helper: Object.freeze({
    module: "cost2.js", sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
    evidence: "ROOT549_RETAINED_STATIC_AST_NO_NEW_FETCH" as const
  }),
  cost_query: Object.freeze({
    module: "cost.js", sha256: "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223",
    evidence: "ROOT549_RETAINED_STATIC_AST_NO_NEW_FETCH" as const
  })
});
const VARIANTS = SOURCE_PARAMETERS.variants;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerBananaImageSourceProfile {
  readonly profile_id: "banana-image-source-reviewed-v1";
  readonly model_id: OwnerBananaImageVariant;
  readonly variant: OwnerBananaImageVariant;
  readonly ai_name: "banana";
  readonly model_type: OwnerBananaImageVariant;
  readonly catalog_default_flag: boolean;
  readonly catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly source_binding: Readonly<{
    selected_public_catalog_version: typeof CATALOG_VERSION;
    selected_public_catalog_fetched_at: string;
    selected_public_source_hashes: typeof SOURCE_HASHES;
    normalized_public_model: Readonly<Record<string, unknown>>;
    source_artifacts: typeof SOURCE_ARTIFACTS;
    settings_source: Readonly<{
      helper_call: string; store_import: string; source_confidence: "STATIC_AST_JOIN; RENDERED_UI_NOT_VERIFIED";
      watcher_mapping: Readonly<Record<string, unknown>>;
      explicit_caller_null_policy: "LOCAL_NORMALIZER_API_NOT_BROWSER_JSON_NULL_CLAIM";
    }>;
    cost_source: Readonly<{ factory: string; field_override_policy: "NO_BANANA_FIELD_OVERRIDES"; cost2_special_store_keys: readonly string[]; otherwise: "SELECTED_SETTINGS_FIELD"; quote_amount_currency_actual_billing_hardcap: "UNPROVEN" }>;
  }>;
  readonly parameters_source: ReturnType<typeof getOwnerBananaImageSourceParameters>;
  readonly public_settings: Readonly<Record<string, unknown> & {
    get_cost_params: readonly string[];
    max_file_size: number | Readonly<Record<string, number>>;
    max_prompt_length: number;
  }>;
  readonly reference_count: Readonly<{ minimum: number; maximum: number }>;
  readonly media_limits: Readonly<{
    accepted_file_types: readonly string[];
    allowed_media_types: readonly string[];
    file_count_by_media: Readonly<Record<string, number>>;
    max_file_bytes_by_media: Readonly<Record<string, number>>;
    max_file_size: number | Readonly<Record<string, number>>;
    file_size_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED" | "PER_MEDIA_CATALOG_METADATA";
    max_image_dimension: number | null;
    max_image_file_size: number | null;
    max_image_pixel_count: number | null;
    image_resize_limit: number | null;
    max_total_file_size: number | null;
    max_prompt_length: number;
    prompt_interpretation: "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED";
    provider_acceptance: "UNPROVEN";
  }>;
  readonly cost_policy: Readonly<{
    declared_metadata_keys: readonly string[];
    controlled_inputs: readonly string[];
    quote_or_amount: "UNPROVEN";
    confidence: "SOURCE_METADATA_ONLY_NOT_QUOTE";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerBananaImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

export class OwnerBananaImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Banana image source profile could not be verified.");
    this.name = "OwnerBananaImageSourceProfileError";
  }
}

/** Returns an immutable source admission profile for one exact selected e551 Banana row. */
export function getOwnerBananaImageSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerBananaImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerBananaImageSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [variantInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model, variantInput);
  const expectedSettings = MODEL_SETTINGS[variantInput];
  if (record.id !== variantInput || record.upstream_id !== variantInput || record.ai_name !== "banana" ||
      record.active !== true || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.default !== CATALOG_DEFAULTS[variantInput] ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" || record.operations.length !== 1 ||
      record.operations[0]?.id !== "generate-image" || record.operations[0]?.output_modality !== "image" ||
      record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" || !sameJson(record.settings, expectedSettings)) {
    fail("PROFILE_BINDING_MISMATCH");
  }
  const referenceCount = SOURCE_PARAMETERS.reference_limits[variantInput];
  const declaredCostKeys = record.settings.get_cost_params as readonly string[];
  const controlledInputs = variantInput === "banana" ? [] : ["image_size"];
  if (!sameJson(declaredCostKeys, controlledInputs)) fail("PROFILE_BINDING_MISMATCH");
  const sourceBinding = deepFreeze({
    selected_public_catalog_version: CATALOG_VERSION,
    selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
    selected_public_source_hashes: SOURCE_HASHES,
    normalized_public_model: record,
    source_artifacts: SOURCE_ARTIFACTS,
    settings_source: {
      helper_call: "settings3.u(image,banana,formSettings)",
      store_import: "app.b6",
      source_confidence: "STATIC_AST_JOIN; RENDERED_UI_NOT_VERIFIED" as const,
      watcher_mapping: {
        base_banana_image_size: null,
        banana3_light_image_size: "1K",
        other_image_size: "RETAIN_IF_ALLOWED_ELSE_2K",
        banana_2_1_thinking_invalid_fallback: "medium",
        inactive_thinking_level_value: "undefined_JSON_omitted"
      },
      explicit_caller_null_policy: "LOCAL_NORMALIZER_API_NOT_BROWSER_JSON_NULL_CLAIM" as const
    },
    cost_source: {
      factory: "cost2.u(ai_name)",
      field_override_policy: "NO_BANANA_FIELD_OVERRIDES" as const,
      cost2_special_store_keys: ["prompt"],
      otherwise: "SELECTED_SETTINGS_FIELD" as const,
      quote_amount_currency_actual_billing_hardcap: "UNPROVEN" as const
    }
  });
  const base = deepFreeze({
    profile_id: "banana-image-source-reviewed-v1" as const,
    model_id: variantInput,
    variant: variantInput,
    ai_name: "banana" as const,
    model_type: variantInput,
    catalog_default_flag: record.default,
    catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION" as const,
    operation_id: "generate-image" as const,
    public_catalog_version: CATALOG_VERSION,
    source_binding: sourceBinding,
    parameters_source: SOURCE_PARAMETERS,
    public_settings: record.settings as OwnerBananaImageSourceProfile["public_settings"],
    reference_count: referenceCount,
    media_limits: makeMediaLimits(record.settings),
    cost_policy: {
      declared_metadata_keys: declaredCostKeys,
      controlled_inputs: controlledInputs,
      quote_or_amount: "UNPROVEN" as const,
      confidence: "SOURCE_METADATA_ONLY_NOT_QUOTE" as const
    },
    effective_defaults: "UNKNOWN" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerBananaImageSourceProfile>;
}

function makeMediaLimits(settings: Readonly<Record<string, unknown>>): OwnerBananaImageSourceProfile["media_limits"] {
  const accepted = settings.accepted_file_types as readonly string[];
  const allowed = settings.allowed_media_types as readonly string[];
  const fileCount = settings.file_count_limit;
  const maxFileSize = settings.max_file_size;
  const countByMedia = typeof fileCount === "number" ? { images: fileCount } : fileCount as Record<string, number>;
  const bytesByMedia = typeof maxFileSize === "number" ? {} : maxFileSize as Record<string, number>;
  return deepFreeze({
    accepted_file_types: accepted,
    allowed_media_types: allowed,
    file_count_by_media: countByMedia,
    max_file_bytes_by_media: bytesByMedia,
    max_file_size: maxFileSize as number | Readonly<Record<string, number>>,
    file_size_interpretation: typeof maxFileSize === "number" ? "ZERO_UNRESOLVED_NOT_UNLIMITED" as const : "PER_MEDIA_CATALOG_METADATA" as const,
    max_image_dimension: nullableNumber(settings.max_image_dimension),
    max_image_file_size: nullableNumber(settings.max_image_file_size),
    max_image_pixel_count: nullableNumber(settings.max_image_pixel_count),
    image_resize_limit: nullableNumber(settings.image_resize_limit),
    max_total_file_size: nullableNumber(settings.max_total_file_size),
    max_prompt_length: settings.max_prompt_length as number,
    prompt_interpretation: "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED" as const,
    provider_acceptance: "UNPROVEN" as const
  });
}

function snapshotCatalog(input: unknown): Readonly<{ receiver: object; getModel: (...args: never[]) => unknown }> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const getModel = readProperty(input, "getModel");
  const fetchedAt = readProperty(input, "fetched_at");
  const catalogKind = readProperty(input, "catalog_kind");
  const runtimeUsable = readProperty(input, "runtime_usable");
  const hashes = snapshotRecord(readProperty(input, "source_hashes"));
  const metadata = snapshotRecord(readProperty(input, "catalog_metadata"));
  const metadataHashes = snapshotRecord(metadata.source_hashes);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false ||
      metadata.fetched_at !== CATALOG_FETCHED_AT || metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(hashes, SOURCE_HASHES) || !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown, variant: OwnerBananaImageVariant): Readonly<{
  id: string; upstream_id: string; ai_name: string; active: true; default: boolean; fetched_at: string; scope: "image";
  modalities: readonly unknown[]; operations: readonly Readonly<{ id: unknown; output_modality: unknown; derivation: unknown }>[];
  settings: Readonly<Record<string, unknown>>;
}> {
  const fields = readSelectedFields(value, ["id", "upstream_id", "ai_name", "display_name", "description", "active", "default", "type", "scope", "modalities", "operations", "features", "settings", "llm_enrichment", "catalog_kind", "runtime_usable", "fetched_at", "source_hashes"]);
  const settings = snapshotJson(fields.settings);
  const hashes = snapshotRecord(fields.source_hashes);
  const operations = snapshotArray(fields.operations).map((item) => {
    const op = readSelectedFields(item, ["id", "display_name", "output_modality", "derivation"]);
    return Object.freeze({ id: op.id, output_modality: op.output_modality, derivation: op.derivation });
  });
  if (!sameJson(hashes, SOURCE_HASHES) || fields.active !== true || fields.scope !== "image" ||
      fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || fields.runtime_usable !== false ||
      !sameJson(Object.keys(settings as Record<string, unknown>).sort(), Object.keys(MODEL_SETTINGS[variant]).sort())) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({
    id: readString(fields.id), upstream_id: readString(fields.upstream_id), ai_name: readString(fields.ai_name),
    active: true as const, default: readBoolean(fields.default), fetched_at: readString(fields.fetched_at), scope: "image" as const,
    modalities: snapshotArray(fields.modalities), operations, settings: settings as Readonly<Record<string, unknown>>
  });
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
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotRecord(value: unknown): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result[key] = descriptors[key]!.value;
  }
  return result;
}

function snapshotJson(value: unknown, depth = 0): DeepReadonly<unknown> {
  if (depth > 8) fail("PROFILE_BINDING_MISMATCH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("PROFILE_BINDING_MISMATCH"); return value; }
  if (Array.isArray(value)) return Object.freeze(snapshotArray(value).map((item) => snapshotJson(item, depth + 1)));
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
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

function sameJson(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
}
function nullableNumber(value: unknown): number | null { return value === undefined ? null : typeof value === "number" ? value : fail("PROFILE_BINDING_MISMATCH"); }
function readString(value: unknown): string { if (typeof value !== "string") fail("PROFILE_BINDING_MISMATCH"); return value; }
function readBoolean(value: unknown): boolean { if (typeof value !== "boolean") fail("PROFILE_BINDING_MISMATCH"); return value; }
function isVariant(value: unknown): value is OwnerBananaImageVariant { return typeof value === "string" && (VARIANTS as readonly string[]).includes(value); }
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
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerBananaImageSourceProfileError(code); }
