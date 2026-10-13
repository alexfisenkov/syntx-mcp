import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerGptImageSourceParameters,
  type OwnerGptImageVariant
} from "./owner-gpt-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const VARIANTS = getOwnerGptImageSourceParameters().variants;
const MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png"] as const);
const VARIANT_POLICY = Object.freeze({
  "gpt-image-1": Object.freeze({ file_count: 5, cost_keys: Object.freeze([]), max_file_size: 0, public_default: false }),
  "gpt-image-1.5": Object.freeze({ file_count: 10, cost_keys: Object.freeze([]), max_file_size: 0, public_default: true }),
  "gpt-image-2": Object.freeze({ file_count: 10, cost_keys: Object.freeze(["quality", "details_quality"]), max_file_size: 0, public_default: true }),
  "gpt-image-2.5-flare": Object.freeze({ file_count: 16, cost_keys: Object.freeze(["quality", "details_quality", "ref_count"]), max_file_size: 33_554_432, public_default: false }),
  "gpt-image-2.5-sunburst": Object.freeze({ file_count: 16, cost_keys: Object.freeze(["quality", "details_quality", "ref_count"]), max_file_size: 33_554_432, public_default: false })
} as const);
const FORM_SOURCE = Object.freeze({
  build_id: "1791467421", url: "https://syntx.ai/assets/1791467421/sora-images.js", bytes: 5_740,
  sha256: "sha256:b30879e1d8171abf2dcab0dd490fbf561fab85495f022c8215b414d17178a966",
  observed_http_date: "Sat, 10 Oct 2026 08:46:40 GMT", evidence: "STATIC_SOURCE_AND_MODEL_CHANGE_WATCHER_NOT_RENDERED_UI" as const
});
const HELPER_SOURCE = Object.freeze({
  build_id: "1791467421", url: "https://syntx.ai/assets/1791467421/settings3.js", bytes: 4_123,
  sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
  observed_http_date: "Sat, 10 Oct 2026 08:46:40 GMT", helper_factory: "settings3.u(image,sora-images,formSettings)" as const,
  evidence: "STATIC_STORE_IDENTITY_AND_RESET_WATCHER_NOT_BACKEND_ACCEPTANCE" as const
});
const APP_SOURCE = Object.freeze({
  build_id: "1791467421", sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
  evidence: "RETAINED_APP_BUNDLE_NOT_REFETCHED" as const
});
const ROOT_FACTS = Object.freeze({
  path: ".autopilot/2026-10-08-syntx-completion--wip/root-546-banana-gpt-fresh-source-facts.json",
  sha256: "sha256:b675a8be1e7b727e65fa2491bd34b40bd711963ba52de1f1000e615594dac4e6",
  evidence: "FRESH_ANONYMOUS_SOURCE_FETCH_NO_AUTH_UPLOAD_OR_GENERATION" as const
});
const COST_PROMPT_JOIN = Object.freeze({
  path: ".autopilot/2026-10-08-syntx-completion--wip/root-549-banana-gpt-cost-prompt-join.json",
  sha256: "sha256:2071b4f224d77bd96cc298eeeb2567a12d13ea38ee9808cf891d7382928eee2a",
  evidence: "STATIC_AST_RETAINED_PUBLIC_RAM_NO_NEW_FETCH_VENDOR_EXECUTION_OR_RAW_SAVE" as const
});
const COST2_SOURCE = Object.freeze({
  sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
  evidence: "RETAINED_HELPER_PINNED_BY_COST_PROMPT_JOIN" as const
});
const COST_QUERY_SOURCE = Object.freeze({
  sha256: "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223",
  evidence: "RETAINED_QUERY_HELPER_PINNED_BY_COST_PROMPT_JOIN" as const
});
const PROMPT_SOURCE = Object.freeze({
  sha256: "sha256:fbc1b642688cb9cfdd6e6ebe46593662e13ab05187b8e39c0ecd3244552a0928",
  evidence: "RETAINED_SHARED_PROMPT_COMPONENT_PINNED_BY_COST_PROMPT_JOIN" as const
});

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface OwnerGptImageSourceProfile {
  readonly profile_id: "gpt-image-family-source-reviewed-v1";
  readonly model_id: OwnerGptImageVariant;
  readonly variant: OwnerGptImageVariant;
  readonly ai_name: "sora-images";
  readonly model_type: OwnerGptImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_default: boolean;
  readonly public_default_interpretation: "CATALOG_FLAG_ONLY_NOT_APPLIED_AS_RUNTIME_DEFAULT";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly parameters_source: ReturnType<typeof getOwnerGptImageSourceParameters>;
  readonly public_settings: Readonly<{
    accepted_file_types: readonly string[];
    allowed_media_types: readonly string[];
    attach_info_text: null;
    file_count_limit: number;
    get_cost_params: readonly string[];
    max_file_size: number;
    max_prompt_length: number;
    uploadable: true;
  }>;
  readonly reference_count: Readonly<{ minimum: 0; maximum: number }>;
  readonly reference_count_confidence: "PUBLIC_CATALOG_DECLARED_LIMIT_NOT_PROVIDER_ACCEPTANCE_OR_OWNED_REFERENCES";
  readonly file_size_metadata: Readonly<{ public_max_file_size: number; interpretation: "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED" }>;
  readonly prompt_metadata: Readonly<{
    public_max_prompt_length: number;
    interpretation: "METADATA_ONLY_NOT_PROVIDER_LIMIT";
    shared_ui_max_length_behavior: "MAX_LENGTH_ZERO_DISABLES_SHARED_CLIPPER";
    backend_prompt_limit: "UNPROVEN";
  }>;
  readonly cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly cost_boundary: Readonly<{
    reference_count_zero: "OMIT_REF_COUNT_AS_UNDEFINED";
    reference_count_positive: "USE_EXPLICIT_LOCAL_IMAGE_REFERENCE_COUNT";
    quote_amount_currency_actual_billing_hardcap: "UNPROVEN";
  }>;
  readonly family_wire_join: "GPT_IMAGE_2_ONLY_POSITIVE_JOIN; OTHER_VARIANTS_NOT_JOINED";
  readonly effective_defaults: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerGptImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

export class OwnerGptImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner GPT Image source profile could not be verified.");
    this.name = "OwnerGptImageSourceProfileError";
  }
}

/** Returns a frozen profile only for the exact selected e551 catalog row and pinned source evidence. */
export function getOwnerGptImageSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerGptImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerGptImageSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [variantInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model);
  const policy = VARIANT_POLICY[variantInput];
  const expectedSettings = makeExpectedSettings(policy);
  if (record.id !== variantInput || record.upstream_id !== variantInput || record.ai_name !== "sora-images" ||
      record.default !== policy.public_default ||
      record.active !== true || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" || record.operations.length !== 1 ||
      record.operations[0]?.id !== "generate-image" || record.operations[0]?.output_modality !== "image" ||
      record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" || !sameJson(record.settings, expectedSettings)) {
    fail("PROFILE_BINDING_MISMATCH");
  }

  const sourceBinding = deepFreeze({
    selected_public_catalog_version: CATALOG_VERSION,
    selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
    selected_public_source_hashes: SOURCE_HASHES,
    normalized_public_model: record,
    source_artifacts: {
      form: FORM_SOURCE, settings_helper: HELPER_SOURCE, app_bundle: APP_SOURCE,
      cost2_helper: COST2_SOURCE, cost_query_helper: COST_QUERY_SOURCE, shared_prompt_component: PROMPT_SOURCE,
      fresh_source_facts: ROOT_FACTS, cost_prompt_join_facts: COST_PROMPT_JOIN
    },
    source_joins: {
      family_form_branch: "ALL_FIVE_VARIANTS_SOURCE_MAPPED",
      model_change_and_settings_store: "ALL_FIVE_VARIANTS_WITH_INACTIVE_FIELDS_RESET_TO_UNDEFINED",
      positive_standard_sender_join: "GPT_IMAGE_2_ONLY",
      other_variant_sender_join: "UNPROVEN",
      reference_upload_and_history: "UNPROVEN",
      provider_namespace_and_acceptance: "UNPROVEN",
      cost_join: "SOURCE_KEYS_AND_SELECTED_SETTINGS_PLUS_POSITIVE_REFERENCE_COUNT_OVERRIDE"
    }
  });
  const base = deepFreeze({
    profile_id: "gpt-image-family-source-reviewed-v1" as const,
    model_id: variantInput, variant: variantInput, ai_name: "sora-images" as const, model_type: variantInput,
    scope: "image" as const, operation_id: "generate-image" as const, public_default: record.default, public_catalog_version: CATALOG_VERSION,
    public_default_interpretation: "CATALOG_FLAG_ONLY_NOT_APPLIED_AS_RUNTIME_DEFAULT" as const,
    source_binding: sourceBinding, parameters_source: getOwnerGptImageSourceParameters(),
    public_settings: record.settings as OwnerGptImageSourceProfile["public_settings"],
    reference_count: { minimum: 0 as const, maximum: policy.file_count },
    reference_count_confidence: "PUBLIC_CATALOG_DECLARED_LIMIT_NOT_PROVIDER_ACCEPTANCE_OR_OWNED_REFERENCES" as const,
    file_size_metadata: {
      public_max_file_size: record.settings.max_file_size,
      interpretation: "PUBLIC_METADATA_ONLY_ZERO_SEMANTICS_UNRESOLVED_NOT_UNLIMITED" as const
    },
    prompt_metadata: {
      public_max_prompt_length: record.settings.max_prompt_length,
      interpretation: "METADATA_ONLY_NOT_PROVIDER_LIMIT" as const,
      shared_ui_max_length_behavior: "MAX_LENGTH_ZERO_DISABLES_SHARED_CLIPPER" as const,
      backend_prompt_limit: "UNPROVEN" as const
    },
    cost_input_confidence: "SOURCE_JOINED_CONTROLLED_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
    cost_boundary: {
      reference_count_zero: "OMIT_REF_COUNT_AS_UNDEFINED" as const,
      reference_count_positive: "USE_EXPLICIT_LOCAL_IMAGE_REFERENCE_COUNT" as const,
      quote_amount_currency_actual_billing_hardcap: "UNPROVEN" as const
    },
    family_wire_join: "GPT_IMAGE_2_ONLY_POSITIVE_JOIN; OTHER_VARIANTS_NOT_JOINED" as const,
    effective_defaults: "UNKNOWN" as const, dispatch_allowed: false as const, runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerGptImageSourceProfile>;
}

function makeExpectedSettings(policy: (typeof VARIANT_POLICY)[OwnerGptImageVariant]): Readonly<Record<string, unknown>> {
  return deepFreeze({
    accepted_file_types: MIME_TYPES, allowed_media_types: ["images"], attach_info_text: null,
    file_count_limit: policy.file_count, get_cost_params: policy.cost_keys,
    max_file_size: policy.max_file_size, max_prompt_length: 0, uploadable: true
  });
}

function snapshotCatalog(input: unknown): Readonly<{ receiver: object; getModel: (...args: never[]) => unknown }> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const read = (key: string): unknown => {
    let current: object | null = input;
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  };
  const getModel = read("getModel");
  const hashes = readDataRecord(read("source_hashes"), ["ai", "llm_models", "models"]);
  const metadata = readSelectedFields(read("catalog_metadata"), ["fetched_at", "source_hashes", "public_settings_coverage"]);
  const metadataHashes = readDataRecord(metadata.source_hashes, ["ai", "llm_models", "models"]);
  if (typeof getModel !== "function" || isProxy(getModel) || read("fetched_at") !== CATALOG_FETCHED_AT ||
      read("catalog_kind") !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || read("runtime_usable") !== false ||
      metadata.fetched_at !== CATALOG_FETCHED_AT || metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(hashes, SOURCE_HASHES) || !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown): Readonly<{
  id: string; upstream_id: string; ai_name: string; active: true; fetched_at: string; scope: "image";
  default: boolean;
  modalities: readonly unknown[]; operations: readonly Readonly<{ id: unknown; output_modality: unknown; derivation: unknown }>[];
  settings: Readonly<OwnerGptImageSourceProfile["public_settings"]>;
}> {
  const fields = readSelectedFields(value, ["id", "upstream_id", "ai_name", "active", "default", "scope", "modalities", "operations", "settings", "fetched_at", "source_hashes", "catalog_kind", "runtime_usable"]);
  const settings = readDataRecord(fields.settings, ["accepted_file_types", "allowed_media_types", "attach_info_text", "file_count_limit", "get_cost_params", "max_file_size", "max_prompt_length", "uploadable"]);
  const safeSettings = deepFreeze({
    accepted_file_types: snapshotDenseArray(settings.accepted_file_types), allowed_media_types: snapshotDenseArray(settings.allowed_media_types),
    attach_info_text: settings.attach_info_text, file_count_limit: settings.file_count_limit,
    get_cost_params: snapshotDenseArray(settings.get_cost_params), max_file_size: settings.max_file_size,
    max_prompt_length: settings.max_prompt_length, uploadable: settings.uploadable
  });
  const hashes = readDataRecord(fields.source_hashes, ["ai", "llm_models", "models"]);
  const operations = snapshotDenseArray(fields.operations).map((operation) => {
    const op = readDataRecord(operation, ["id", "display_name", "output_modality", "derivation"]);
    return Object.freeze({ id: op.id, output_modality: op.output_modality, derivation: op.derivation });
  });
  if (fields.active !== true || typeof fields.default !== "boolean" || fields.scope !== "image" || fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      fields.runtime_usable !== false || !sameJson(hashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({
    id: readString(fields.id), upstream_id: readString(fields.upstream_id), ai_name: readString(fields.ai_name),
    active: true as const, default: fields.default, fetched_at: readString(fields.fetched_at), scope: "image" as const,
    modalities: snapshotDenseArray(fields.modalities), operations: Object.freeze(operations),
    settings: safeSettings as OwnerGptImageSourceProfile["public_settings"]
  });
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

function isVariant(value: unknown): value is OwnerGptImageVariant {
  return typeof value === "string" && VARIANTS.includes(value as OwnerGptImageVariant);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never {
  throw new OwnerGptImageSourceProfileError(code);
}
