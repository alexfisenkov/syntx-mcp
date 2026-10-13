import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerRunwayImageSourceParameters,
  type OwnerRunwayImageVariant
} from "./owner-runway-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const MODEL_ID = "runway_frames" as const;
const AI_NAME = "runway-frames" as const;
const MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"] as const);
const EXPECTED_SETTINGS = Object.freeze({
  accepted_file_types: MIME_TYPES,
  allowed_media_types: Object.freeze(["images"] as const),
  attach_info_text: null,
  file_count_limit: 3,
  get_cost_params: Object.freeze([] as const),
  max_file_size: 0,
  max_prompt_length: 0,
  uploadable: true
});
const SOURCE_ARTIFACTS = Object.freeze({
  runway_form: Object.freeze({
    build_id: "1791467421", module: "runway-frames.js", bytes: 3_641,
    sha256: "sha256:1017f19b07dc888fa40ad9bc2d36121975d8c233ef0673bd7a7261b056c25447",
    evidence: "FRESH_ANONYMOUS_GET_STATIC_SOURCE_NOT_EXECUTED" as const
  }),
  settings_helper: Object.freeze({
    build_id: "1791467421", module: "settings3.js", bytes: 4_123,
    sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    helper_call: "settings3.q(image,runway-frames,defaults)" as const,
    evidence: "FRESH_SOURCE_MODULE_HASH_NOT_BACKEND_ACCEPTANCE" as const
  }),
  app_store: Object.freeze({
    build_id: "1791467421", module: "app.js", bytes: 2_445_534,
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
    evidence: "FRESH_ANONYMOUS_GET_STORE_JOIN_NOT_RENDERED_UI" as const
  }),
  settings_inventory: Object.freeze({
    path: "catalog/settings/v2/sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json",
    sha256: "sha256:87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38",
    evidence: "PINNED_PUBLIC_SETTINGS_INVENTORY_NOT_RUNTIME_USABLE" as const
  }),
  fresh_source_facts: Object.freeze({
    path: ".autopilot/2026-10-08-syntx-completion--wip/root-590-remaining-image-source-facts.json",
    evidence: "CURRENT_PUBLIC_STATIC_AST_NOT_RENDERED_UI_OR_PROVIDER" as const
  })
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerRunwayImageSourceProfile {
  readonly profile_id: "runway-frames-source-reviewed-v1";
  readonly model_id: OwnerRunwayImageVariant;
  readonly variant: OwnerRunwayImageVariant;
  readonly ai_name: "runway-frames";
  readonly model_type: OwnerRunwayImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_default: boolean;
  readonly public_default_interpretation: "CATALOG_FLAG_ONLY_NOT_APPLIED_AS_RUNTIME_DEFAULT";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly source_binding: Readonly<{
    selected_public_catalog_version: typeof CATALOG_VERSION;
    selected_public_catalog_fetched_at: string;
    selected_public_source_hashes: typeof SOURCE_HASHES;
    normalized_public_model: Readonly<Record<string, unknown>>;
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_joins: Readonly<{
      form_settings_factory: "RUNWAY_FRAMES_SOURCE_FORM_TO_SETTINGS3_Q";
      image_store_and_sender: "SHARED_IMAGE_STORE_AND_COMMON_SENDER_STATIC_SOURCE_JOIN";
      custom_settings_payload: "NONE_OBSERVED_FOR_RUNWAY_FRAMES_FORM";
      dispatch_and_provider_acceptance: "UNPROVEN";
    }>;
  }>;
  readonly parameters_source: ReturnType<typeof getOwnerRunwayImageSourceParameters>;
  readonly public_settings: Readonly<{
    accepted_file_types: readonly string[];
    allowed_media_types: readonly string[];
    attach_info_text: null;
    file_count_limit: 3;
    get_cost_params: readonly string[];
    max_file_size: 0;
    max_prompt_length: 0;
    uploadable: true;
  }>;
  readonly reference_count: Readonly<{ minimum: 0; maximum: 3 }>;
  readonly reference_count_confidence: "PUBLIC_CATALOG_DECLARED_IMAGE_COUNT_ONLY_OWNED_REFERENCES_UNBOUND";
  readonly fixed_wire: Readonly<{ n: 1; confidence: "STATIC_SOURCE_MAPPING_NOT_BACKEND_ACCEPTANCE" }>;
  readonly local_safety_bounds: Readonly<{
    maximum_image_file_bytes: 33_554_432;
    image_file_confidence: "LOCAL_PROCESS_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
    maximum_prompt_utf8_bytes: 65_536;
    prompt_confidence: "LOCAL_INPUT_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
    dimensions: "SOURCE_LIMIT_UNKNOWN; PROFILE_DOES_NOT_CLAIM_UNBOUNDED_DIMENSIONS";
  }>;
  readonly file_size_metadata: Readonly<{ public_max_file_size: 0; interpretation: "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED" }>;
  readonly prompt_metadata: Readonly<{ public_max_prompt_length: 0; interpretation: "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED"; backend_prompt_limit: "UNPROVEN" }>;
  readonly cost_policy: Readonly<{ declared_metadata_keys: readonly string[]; controlled_inputs: readonly string[]; quote_or_amount: "UNPROVEN"; confidence: "NO_SOURCE_SCALAR_INPUTS_NOT_FREE_PRICE" }>;
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerRunwayImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

export class OwnerRunwayImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Runway Frames source profile could not be verified.");
    this.name = "OwnerRunwayImageSourceProfileError";
  }
}

/** Returns a frozen source-admission profile for the exact selected e551 Runway Frames row. */
export function getOwnerRunwayImageSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerRunwayImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerRunwayImageSourceProfile> {
  if (variantInput !== MODEL_ID) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog, [MODEL_ID]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model);
  if (record.id !== MODEL_ID || record.upstream_id !== MODEL_ID || record.ai_name !== AI_NAME ||
      record.default !== true || record.active !== true || record.fetched_at !== CATALOG_FETCHED_AT ||
      record.scope !== "image" || record.modalities.length !== 1 || record.modalities[0] !== "image" ||
      record.operations.length !== 1 || record.operations[0]?.id !== "generate-image" ||
      record.operations[0]?.output_modality !== "image" || record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" ||
      !sameJson(record.settings, EXPECTED_SETTINGS)) fail("PROFILE_BINDING_MISMATCH");

  const base = deepFreeze({
    profile_id: "runway-frames-source-reviewed-v1" as const,
    model_id: MODEL_ID,
    variant: MODEL_ID,
    ai_name: AI_NAME,
    model_type: MODEL_ID,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    public_default: record.default,
    public_default_interpretation: "CATALOG_FLAG_ONLY_NOT_APPLIED_AS_RUNTIME_DEFAULT" as const,
    public_catalog_version: CATALOG_VERSION,
    source_binding: {
      selected_public_catalog_version: CATALOG_VERSION,
      selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
      selected_public_source_hashes: SOURCE_HASHES,
      normalized_public_model: record,
      source_artifacts: SOURCE_ARTIFACTS,
      source_joins: {
        form_settings_factory: "RUNWAY_FRAMES_SOURCE_FORM_TO_SETTINGS3_Q" as const,
        image_store_and_sender: "SHARED_IMAGE_STORE_AND_COMMON_SENDER_STATIC_SOURCE_JOIN" as const,
        custom_settings_payload: "NONE_OBSERVED_FOR_RUNWAY_FRAMES_FORM" as const,
        dispatch_and_provider_acceptance: "UNPROVEN" as const
      }
    },
    parameters_source: getOwnerRunwayImageSourceParameters(),
    public_settings: record.settings,
    reference_count: { minimum: 0 as const, maximum: 3 as const },
    reference_count_confidence: "PUBLIC_CATALOG_DECLARED_IMAGE_COUNT_ONLY_OWNED_REFERENCES_UNBOUND" as const,
    fixed_wire: getOwnerRunwayImageSourceParameters().fixed_wire,
    local_safety_bounds: getOwnerRunwayImageSourceParameters().local_safety_bounds,
    file_size_metadata: { public_max_file_size: 0 as const, interpretation: "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED" as const },
    prompt_metadata: { public_max_prompt_length: 0 as const, interpretation: "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED" as const, backend_prompt_limit: "UNPROVEN" as const },
    cost_policy: {
      declared_metadata_keys: [], controlled_inputs: [], quote_or_amount: "UNPROVEN" as const,
      confidence: "NO_SOURCE_SCALAR_INPUTS_NOT_FREE_PRICE" as const
    },
    effective_defaults: "UNKNOWN" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerRunwayImageSourceProfile>;
}

function snapshotCatalog(input: unknown): DiscoveryCatalogRepository {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input) ||
      Object.getPrototypeOf(input) !== DiscoveryCatalogRepository.prototype) fail("INVALID_REQUEST");
  const readOwnData = (key: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    return descriptor.value;
  };
  const getModelDescriptor = Object.getOwnPropertyDescriptor(DiscoveryCatalogRepository.prototype, "getModel");
  const getModel = getModelDescriptor && "value" in getModelDescriptor ? getModelDescriptor.value : undefined;
  const hashes = readExactRecord(readOwnData("source_hashes"), ["ai", "llm_models", "models"]);
  const metadata = readSelectedFields(readOwnData("catalog_metadata"), ["fetched_at", "source_hashes", "public_settings_coverage"]);
  const metadataHashes = readExactRecord(metadata.source_hashes, ["ai", "llm_models", "models"]);
  if (typeof getModel !== "function" || isProxy(getModel) || readOwnData("fetched_at") !== CATALOG_FETCHED_AT ||
      readOwnData("catalog_kind") !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || readOwnData("runtime_usable") !== false ||
      metadata.fetched_at !== CATALOG_FETCHED_AT || metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(hashes, SOURCE_HASHES) || !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return input as DiscoveryCatalogRepository;
}

function snapshotModel(value: unknown): Readonly<{
  id: string; upstream_id: string; ai_name: string; active: true; default: boolean; fetched_at: string; scope: "image";
  modalities: readonly unknown[]; operations: readonly Readonly<{ id: unknown; output_modality: unknown; derivation: unknown }>[];
  settings: OwnerRunwayImageSourceProfile["public_settings"];
}> {
  const fields = readSelectedFields(value, ["id", "upstream_id", "ai_name", "active", "default", "scope", "modalities", "operations", "settings", "fetched_at", "source_hashes", "catalog_kind", "runtime_usable"]);
  const settings = readExactRecord(fields.settings, Object.keys(EXPECTED_SETTINGS));
  const safeSettings = deepFreeze({
    accepted_file_types: snapshotDenseArray(settings.accepted_file_types),
    allowed_media_types: snapshotDenseArray(settings.allowed_media_types),
    attach_info_text: settings.attach_info_text,
    file_count_limit: settings.file_count_limit,
    get_cost_params: snapshotDenseArray(settings.get_cost_params),
    max_file_size: settings.max_file_size,
    max_prompt_length: settings.max_prompt_length,
    uploadable: settings.uploadable
  });
  const hashes = readExactRecord(fields.source_hashes, ["ai", "llm_models", "models"]);
  const operations = snapshotDenseArray(fields.operations).map((operation) => {
    const op = readExactRecord(operation, ["id", "display_name", "output_modality", "derivation"]);
    return Object.freeze({ id: op.id, output_modality: op.output_modality, derivation: op.derivation });
  });
  if (fields.active !== true || typeof fields.default !== "boolean" || fields.scope !== "image" ||
      fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || fields.runtime_usable !== false ||
      !sameJson(hashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({
    id: readString(fields.id), upstream_id: readString(fields.upstream_id), ai_name: readString(fields.ai_name),
    active: true as const, default: fields.default, fetched_at: readString(fields.fetched_at), scope: "image" as const,
    modalities: snapshotDenseArray(fields.modalities), operations: Object.freeze(operations),
    settings: safeSettings as OwnerRunwayImageSourceProfile["public_settings"]
  });
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
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
  if (actual.length !== expectedKeys.length || actual.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) fail("PROFILE_BINDING_MISMATCH");
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

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function fail(code: OwnerRunwayImageSourceProfileError["code"]): never {
  throw new OwnerRunwayImageSourceProfileError(code);
}
