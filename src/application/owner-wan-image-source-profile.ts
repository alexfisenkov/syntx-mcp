import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { OWNER_WAN_IMAGE_INPUT_POLICY } from "./owner-wan-image-input-validator.js";
import {
  getOwnerWanImageSourceParameters,
  type OwnerWanImageVariant
} from "./owner-wan-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const CATALOG_SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const SOURCE_PARAMETERS = getOwnerWanImageSourceParameters();
const MIME_TYPES = Object.freeze(["image/png", "image/jpg", "image/jpeg", "image/bmp", "image/webp"] as const);
const CANONICAL_MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "image/bmp", "image/webp"] as const);
const SETTINGS_KEYS = Object.freeze([
  "accepted_file_types", "allowed_media_types", "attach_info_text", "file_count_limit", "files_mention",
  "get_cost_params", "max_dimension", "max_file_size", "max_prompt_length", "max_side", "min_dimension",
  "min_side", "uploadable"
] as const);
const VARIANT_POLICY = Object.freeze({
  wan_25_i2i_preview: Object.freeze({ count: 3, max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000, max_prompt_length: 1_500 }),
  wan_26_image: Object.freeze({ count: 4, max_bytes: 10_485_760, min_dimension: 384, max_dimension: 5_000, max_prompt_length: 1_500 }),
  wan_27_image: Object.freeze({ count: 9, max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000, max_prompt_length: 5_000 }),
  wan_27_image_pro: Object.freeze({ count: 9, max_bytes: 20_971_520, min_dimension: 240, max_dimension: 8_000, max_prompt_length: 5_000 })
} as const);
const FORM_SOURCE = Object.freeze({
  build_id: "1791467421",
  url: "https://syntx.ai/assets/1791467421/wan-image.js",
  bytes: 53_279,
  sha256: "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3",
  evidence: "STATIC_AST_ONLY_NO_VENDOR_EXECUTION" as const
});
const SEED_HELPER_SOURCE = Object.freeze({
  url: "https://syntx.ai/assets/1791467421/RandomSeed.js",
  bytes: 1_656,
  sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b"
});
const PALETTE_HELPER_SOURCE = Object.freeze({
  url: "https://syntx.ai/assets/1791467421/sanitizeHex.js",
  bytes: 168,
  sha256: "sha256:8062897bb3259b540840c65ad99af558a991d106b1b658f3eb1de3e9b06dc348"
});
const PROMPT_SOURCE = Object.freeze({
  url: "https://syntx.ai/assets/1791467421/index14.js",
  bytes: 258_638,
  sha256: "sha256:fbc1b642688cb9cfdd6e6ebe46593662e13ab05187b8e39c0ecd3244552a0928",
  evidence: "SOURCE_UI_CLIPPER_BEHAVIOR_NOT_BACKEND_LIMIT" as const
});
const COST_SOURCE = Object.freeze({
  query_builder: Object.freeze({
    url: "https://syntx.ai/assets/1791467421/cost.js",
    bytes: 2_745,
    sha256: "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223"
  }),
  retained_cost_helper_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
  controlled_state_behavior: "SIZE_OMITTED_BATCH_SIZE_READ_FROM_EXPLICIT_SETTINGS_NOT_A_QUOTE" as const
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface OwnerWanImageSourceProfile {
  readonly profile_id: "wan-image-source-reviewed-v1";
  readonly model_id: OwnerWanImageVariant;
  readonly variant: OwnerWanImageVariant;
  readonly ai_name: "wan_image";
  readonly model_type: OwnerWanImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly parameters_source: ReturnType<typeof getOwnerWanImageSourceParameters>;
  readonly public_settings: Readonly<{
    accepted_file_types: readonly string[];
    allowed_media_types: readonly string[];
    attach_info_text: null;
    file_count_limit: number | Readonly<{ images: number }>;
    files_mention: true;
    get_cost_params: readonly ["size", "batch_size"];
    max_dimension: number;
    max_file_size: number;
    max_prompt_length: number;
    max_side: number;
    min_dimension: number;
    min_side: number;
    uploadable: true;
  }>;
  readonly reference_count: Readonly<{ minimum: number; maximum: number }>;
  readonly mime_policy: Readonly<{
    source_values: readonly string[];
    canonical_values: readonly string[];
    jpg_alias: "image/jpg -> image/jpeg";
    confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE";
  }>;
  readonly input_policy: Readonly<{
    maximum_bytes: number;
    minimum_dimension: number;
    maximum_dimension: number;
    confidence: "LOCAL_STRUCTURAL_GUARD_FROM_SELECTED_PUBLIC_METADATA_NOT_PROVIDER_LIMIT";
    dimensions_confidence: "CONTAINER_METADATA_ONLY_NOT_BROWSER_NATURAL_DIMENSIONS";
  }>;
  readonly prompt_policy: Readonly<{
    required: true;
    admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL";
    maximum_units: number;
    unit: "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT";
    source_behavior: "UI_CLIPS_OVER_BUDGET; LOCAL_NORMALIZER_REJECTS";
    limit_confidence: "SOURCE_UI_BEHAVIOR_NOT_BACKEND_LIMIT";
    local_character_guard: "REJECT_MALFORMED_UNICODE_AND_C0_C1_CONTROLS_EXCEPT_TAB_LF_CR";
    character_guard_confidence: "LOCAL_INPUT_SAFETY_GUARD_NOT_PROVIDER_CONTRACT";
    backend_semantics: "UNPROVEN";
    source: Readonly<typeof PROMPT_SOURCE>;
  }>;
  readonly cost_policy: Readonly<{
    declared_metadata_keys: readonly ["size", "batch_size"];
    controlled_inputs: readonly ["batch_size"];
    size_policy: "OMITTED_NO_RESOLUTION_ALIAS";
    confidence: "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE";
    quote_or_cost_amount: "UNPROVEN";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly output_batch_cardinality: "UNPROVEN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerWanImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

export class OwnerWanImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner WAN image source profile could not be verified.");
    this.name = "OwnerWanImageSourceProfileError";
  }
}

/** Returns a frozen profile only for the exact selected e551 catalog record and source evidence. */
export function getOwnerWanImageSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerWanImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerWanImageSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [variantInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model);
  const policy = VARIANT_POLICY[variantInput];
  const expectedSettings = makeExpectedSettings(policy);
  if (record.id !== variantInput || record.upstream_id !== variantInput || record.ai_name !== "wan_image" ||
      record.active !== true || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" || record.operations.length !== 1 ||
      record.operations[0]?.id !== "generate-image" || record.operations[0]?.output_modality !== "image" ||
      record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" || !sameJson(record.settings, expectedSettings)) {
    fail("PROFILE_BINDING_MISMATCH");
  }
  assertInputPolicyMatches(variantInput, policy);
  const referenceCount = policy.count;
  const sourceBinding = deepFreeze({
    selected_public_catalog_version: CATALOG_VERSION,
    selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
    selected_public_source_hashes: CATALOG_SOURCE_HASHES,
    normalized_public_model: record,
    source_artifacts: {
      form: FORM_SOURCE,
      seed_helper: SEED_HELPER_SOURCE,
      palette_helper: PALETTE_HELPER_SOURCE,
      prompt_input_component: PROMPT_SOURCE,
      cost: COST_SOURCE
    }
  });
  const base = deepFreeze({
    profile_id: "wan-image-source-reviewed-v1" as const,
    model_id: variantInput,
    variant: variantInput,
    ai_name: "wan_image" as const,
    model_type: variantInput,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    public_catalog_version: CATALOG_VERSION,
    source_binding: sourceBinding,
    parameters_source: SOURCE_PARAMETERS,
    public_settings: record.settings as OwnerWanImageSourceProfile["public_settings"],
    reference_count: { minimum: SOURCE_PARAMETERS.reference_limits[variantInput].minimum, maximum: referenceCount },
    mime_policy: {
      source_values: MIME_TYPES,
      canonical_values: CANONICAL_MIME_TYPES,
      jpg_alias: "image/jpg -> image/jpeg" as const,
      confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE" as const
    },
    input_policy: {
      maximum_bytes: policy.max_bytes,
      minimum_dimension: policy.min_dimension,
      maximum_dimension: policy.max_dimension,
      confidence: "LOCAL_STRUCTURAL_GUARD_FROM_SELECTED_PUBLIC_METADATA_NOT_PROVIDER_LIMIT" as const,
      dimensions_confidence: "CONTAINER_METADATA_ONLY_NOT_BROWSER_NATURAL_DIMENSIONS" as const
    },
    prompt_policy: {
      required: true as const,
      admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL" as const,
      maximum_units: policy.max_prompt_length,
      unit: "JS_UTF16_CODE_UNITS_PLUS_LF_COUNT" as const,
      source_behavior: "UI_CLIPS_OVER_BUDGET; LOCAL_NORMALIZER_REJECTS" as const,
      limit_confidence: "SOURCE_UI_BEHAVIOR_NOT_BACKEND_LIMIT" as const,
      local_character_guard: "REJECT_MALFORMED_UNICODE_AND_C0_C1_CONTROLS_EXCEPT_TAB_LF_CR" as const,
      character_guard_confidence: "LOCAL_INPUT_SAFETY_GUARD_NOT_PROVIDER_CONTRACT" as const,
      backend_semantics: "UNPROVEN" as const,
      source: PROMPT_SOURCE
    },
    cost_policy: {
      declared_metadata_keys: ["size", "batch_size"] as const,
      controlled_inputs: ["batch_size"] as const,
      size_policy: "OMITTED_NO_RESOLUTION_ALIAS" as const,
      confidence: "SOURCE_JOINED_CONTROLLED_STATE_NOT_QUOTE" as const,
      quote_or_cost_amount: "UNPROVEN" as const
    },
    effective_defaults: "UNKNOWN" as const,
    output_batch_cardinality: "UNPROVEN" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerWanImageSourceProfile>;
}

function makeExpectedSettings(policy: (typeof VARIANT_POLICY)[OwnerWanImageVariant]): Readonly<Record<string, unknown>> {
  const fileCountLimit = policy.count === 9 ? { images: 9 } : policy.count;
  return deepFreeze({
    accepted_file_types: MIME_TYPES,
    allowed_media_types: ["images"],
    attach_info_text: null,
    file_count_limit: fileCountLimit,
    files_mention: true,
    get_cost_params: ["size", "batch_size"],
    max_dimension: policy.max_dimension,
    max_file_size: policy.max_bytes,
    max_prompt_length: policy.max_prompt_length,
    max_side: policy.max_dimension,
    min_dimension: policy.min_dimension,
    min_side: policy.min_dimension,
    uploadable: true
  });
}

function assertInputPolicyMatches(variant: OwnerWanImageVariant, policy: (typeof VARIANT_POLICY)[OwnerWanImageVariant]): void {
  const limits = OWNER_WAN_IMAGE_INPUT_POLICY.variants[variant];
  if (limits.max_bytes !== policy.max_bytes || limits.min_dimension !== policy.min_dimension ||
      limits.max_dimension !== policy.max_dimension ||
      !sameJson([...OWNER_WAN_IMAGE_INPUT_POLICY.source_mime_types].sort(), [...MIME_TYPES].sort()) ||
      OWNER_WAN_IMAGE_INPUT_POLICY.jpg_alias !== "image/jpg -> image/jpeg") fail("PROFILE_BINDING_MISMATCH");
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
  const getModel = read("getModel");
  const fetchedAt = read("fetched_at");
  const catalogKind = read("catalog_kind");
  const runtimeUsable = read("runtime_usable");
  const hashes = readDataRecord(read("source_hashes"), ["ai", "llm_models", "models"]);
  const metadata = readSelectedFields(read("catalog_metadata"), ["fetched_at", "source_hashes", "public_settings_coverage"]);
  const metadataHashes = readDataRecord(metadata.source_hashes, ["ai", "llm_models", "models"]);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false ||
      metadata.fetched_at !== CATALOG_FETCHED_AT || metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(hashes, CATALOG_SOURCE_HASHES) || !sameJson(metadataHashes, CATALOG_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input as object, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown): Readonly<{
  id: string; upstream_id: string; ai_name: string; active: true; fetched_at: string; scope: "image";
  modalities: readonly unknown[]; operations: readonly Readonly<{ id: unknown; output_modality: unknown; derivation: unknown }>[];
  settings: Readonly<Record<string, unknown>>; source_hashes: Readonly<Record<string, unknown>>;
}> {
  const fields = readSelectedFields(value, ["id", "upstream_id", "ai_name", "active", "scope", "modalities", "operations", "settings", "fetched_at", "source_hashes", "catalog_kind", "runtime_usable"]);
  const settings = readDataRecord(fields.settings, SETTINGS_KEYS);
  const safeSettings = deepFreeze({
    accepted_file_types: snapshotDenseArray(settings.accepted_file_types),
    allowed_media_types: snapshotDenseArray(settings.allowed_media_types),
    attach_info_text: settings.attach_info_text,
    file_count_limit: snapshotFileCountLimit(settings.file_count_limit),
    files_mention: settings.files_mention,
    get_cost_params: snapshotDenseArray(settings.get_cost_params),
    max_dimension: settings.max_dimension,
    max_file_size: settings.max_file_size,
    max_prompt_length: settings.max_prompt_length,
    max_side: settings.max_side,
    min_dimension: settings.min_dimension,
    min_side: settings.min_side,
    uploadable: settings.uploadable
  });
  const hashes = readDataRecord(fields.source_hashes, ["ai", "llm_models", "models"]);
  const operations = snapshotDenseArray(fields.operations).map((operation) => {
    const op = readDataRecord(operation, ["id", "display_name", "output_modality", "derivation"]);
    return Object.freeze({ id: op.id, output_modality: op.output_modality, derivation: op.derivation });
  });
  const active = fields.active;
  const scope = fields.scope;
  if (active !== true || scope !== "image" || fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      fields.runtime_usable !== false || !sameJson(hashes, CATALOG_SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  const record = {
    id: readString(fields.id), upstream_id: readString(fields.upstream_id), ai_name: readString(fields.ai_name),
    active: true as const, fetched_at: readString(fields.fetched_at), scope: "image" as const,
    modalities: snapshotDenseArray(fields.modalities), operations: Object.freeze(operations), settings: safeSettings,
    source_hashes: deepFreeze(hashes)
  };
  return deepFreeze(record);
}

function snapshotFileCountLimit(value: unknown): number | Readonly<{ images: number }> {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  const record = readDataRecord(value, ["images"]);
  if (!Number.isSafeInteger(record.images) || (record.images as number) < 0) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ images: record.images as number });
}

function readDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))];
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== expectedKeys.length || actual.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) {
    fail("PROFILE_BINDING_MISMATCH");
  }
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

function readString(value: unknown): string {
  if (typeof value !== "string") fail("PROFILE_BINDING_MISMATCH");
  return value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isVariant(value: unknown): value is OwnerWanImageVariant {
  return typeof value === "string" && SOURCE_PARAMETERS.variants.includes(value as OwnerWanImageVariant);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never {
  throw new OwnerWanImageSourceProfileError(code);
}
