import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { getOwnerGrokT2iSourceParameters, type OwnerGrokT2iModel } from "./owner-grok-t2i-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const MODEL_RECORD_HASHES = Object.freeze({
  grok_t2i: "sha256:907e7763ec4d7f29a1b076bfc3eacb63505b177a3734da8ab35f525d9bc794ea",
  grok_t2i_pro: "sha256:e580faab3470ebc62eeaacad867f28a20b06fd07872f577a96255db17c2a6cf5",
  grok_imagine_2: "sha256:475201e9ecd7cd80cc0406eb4542fe7677e464aa92bc5a3e018d08cee6c9aa39",
  grok_imagine_quality: "sha256:dcfc23cf05a050a8975049eb7d3f9299bfd43f4eaa5f7ac7d83c7ec422db3d4c"
} as const);
const MODEL_RECORD_KEYS = Object.freeze([
  "id", "upstream_id", "ai_name", "display_name", "description", "active", "default", "type", "scope",
  "modalities", "operations", "features", "settings", "llm_enrichment", "catalog_kind", "runtime_usable",
  "fetched_at", "source_hashes"
] as const);
const SOURCE_HASH_KEYS = Object.freeze(["ai", "llm_models", "models"] as const);
const SOURCE_PARAMETERS = getOwnerGrokT2iSourceParameters();
const SOURCE_FORM = Object.freeze({
  module: "grok-image.js", build_id: "1791467421",
  sha256: SOURCE_PARAMETERS.source_pins.form_sha256,
  evidence: "ROOT750_PINNED_STATIC_FORM_NOT_RENDERED_UI" as const,
  source_execution: false as const
});
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerGrokT2iCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata" | "catalog_kind" | "runtime_usable"> {}

export interface OwnerGrokT2iSourceProfile {
  readonly profile_id: "owner-grok-t2i-source-profile-v1";
  readonly model_id: OwnerGrokT2iModel;
  readonly ai_name: "grok_image";
  readonly model_type: OwnerGrokT2iModel;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly catalog_default_flag: boolean;
  readonly catalog_default_confidence: "PUBLIC_CATALOG_FLAG_ONLY_NOT_RUNTIME_SELECTION";
  readonly source_binding: Readonly<{
    selected_public_catalog_version: typeof CATALOG_VERSION;
    selected_public_catalog_fetched_at: string;
    selected_public_source_hashes: typeof SOURCE_HASHES;
    full_public_record_sha256: string;
    full_public_record_verified: true;
    source_form: typeof SOURCE_FORM;
    source_control_confidence: "PINNED_STATIC_FORM_SOURCE_NOT_RENDERED_UI_OR_WIRE_PROOF";
    source_execution: false;
  }>;
  readonly parameters_source: ReturnType<typeof getOwnerGrokT2iSourceParameters>;
  readonly public_settings: Readonly<Record<string, unknown> & {
    readonly file_count_limit: number;
    readonly max_file_size: number;
    readonly max_prompt_length: number;
    readonly get_cost_params: readonly string[];
    readonly uploadable: boolean;
  }>;
  readonly reference_selector: Readonly<{
    readonly minimum: 0;
    readonly maximum: 0 | 3 | 5;
    readonly confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION";
    readonly owned_references_bound: false;
    readonly permission: "SOURCE_SELECTOR_ONLY_NOT_UPLOAD_PERMISSION";
  }>;
  readonly public_input_metadata: Readonly<{
    readonly accepted_file_types: readonly string[];
    readonly allowed_media_types: readonly string[];
    readonly file_count_limit: number;
    readonly file_count_interpretation: "PUBLIC_METADATA_NOT_REFERENCE_SELECTOR_OR_UPLOAD_AUTHORITY";
    readonly max_file_size: number;
    readonly max_file_size_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP";
    readonly max_prompt_length: number;
    readonly prompt_interpretation: "PUBLIC_METADATA_NOT_EFFECTIVE_UI_OR_PROVIDER_LIMIT";
    readonly uploadable: boolean;
    readonly upload_interpretation: "PUBLIC_METADATA_ONLY_NOT_OWNER_UPLOAD_PERMISSION";
  }>;
  readonly cost_inputs: null;
  readonly cost_projection_status: "NOT_JOINED";
  readonly effective_defaults: "SOURCE_CANDIDATES_ONLY_NOT_RUNTIME_DEFAULTS";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerGrokT2iSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Grok T2I source profile could not be verified.");
    this.name = "OwnerGrokT2iSourceProfileError";
  }
}

/** Returns one immutable source profile for the exact selected e551 row; it grants no upload or dispatch authority. */
export function getOwnerGrokT2iSourceProfile(
  modelInput: unknown,
  catalogInput: OwnerGrokT2iCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerGrokT2iSourceProfile> {
  if (!isModel(modelInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [modelInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model, modelInput);
  if (record.id !== modelInput || record.upstream_id !== modelInput || record.ai_name !== "grok_image" ||
      record.active !== true || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" || record.operations.length !== 1 ||
      !sameJson(record.operations[0], { id: "generate-image", display_name: "Generate image", output_modality: "image", derivation: "PUBLIC_AI_SCOPE" }) ||
      schemaHash(record) !== MODEL_RECORD_HASHES[modelInput]) fail("PROFILE_BINDING_MISMATCH");

  const selectorMaximum = SOURCE_PARAMETERS.models_by_id[modelInput].reference_count_selector_maximum;
  const base = deepFreeze({
    profile_id: "owner-grok-t2i-source-profile-v1" as const,
    model_id: modelInput,
    ai_name: "grok_image" as const,
    model_type: modelInput,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    public_catalog_version: CATALOG_VERSION,
    catalog_default_flag: record.default,
    catalog_default_confidence: "PUBLIC_CATALOG_FLAG_ONLY_NOT_RUNTIME_SELECTION" as const,
    source_binding: {
      selected_public_catalog_version: CATALOG_VERSION,
      selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
      selected_public_source_hashes: SOURCE_HASHES,
      full_public_record_sha256: MODEL_RECORD_HASHES[modelInput],
      full_public_record_verified: true as const,
      source_form: SOURCE_FORM,
      source_control_confidence: "PINNED_STATIC_FORM_SOURCE_NOT_RENDERED_UI_OR_WIRE_PROOF" as const,
      source_execution: false as const
    },
    parameters_source: SOURCE_PARAMETERS,
    public_settings: record.settings,
    reference_selector: {
      minimum: 0 as const,
      maximum: selectorMaximum,
      confidence: SOURCE_PARAMETERS.models_by_id[modelInput].reference_count_confidence,
      owned_references_bound: false as const,
      permission: "SOURCE_SELECTOR_ONLY_NOT_UPLOAD_PERMISSION" as const
    },
    public_input_metadata: {
      accepted_file_types: record.settings.accepted_file_types,
      allowed_media_types: record.settings.allowed_media_types,
      file_count_limit: record.settings.file_count_limit,
      file_count_interpretation: "PUBLIC_METADATA_NOT_REFERENCE_SELECTOR_OR_UPLOAD_AUTHORITY" as const,
      max_file_size: record.settings.max_file_size,
      max_file_size_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED_OR_PROVIDER_CAP" as const,
      max_prompt_length: record.settings.max_prompt_length,
      prompt_interpretation: "PUBLIC_METADATA_NOT_EFFECTIVE_UI_OR_PROVIDER_LIMIT" as const,
      uploadable: record.settings.uploadable,
      upload_interpretation: "PUBLIC_METADATA_ONLY_NOT_OWNER_UPLOAD_PERMISSION" as const
    },
    cost_inputs: null,
    cost_projection_status: "NOT_JOINED" as const,
    effective_defaults: "SOURCE_CANDIDATES_ONLY_NOT_RUNTIME_DEFAULTS" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerGrokT2iSourceProfile>;
}

function snapshotCatalog(input: unknown): Readonly<{ receiver: object; getModel: (...args: never[]) => unknown }> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const getModel = readProperty(input, "getModel");
  const fetchedAt = readProperty(input, "fetched_at");
  const catalogKind = readProperty(input, "catalog_kind");
  const runtimeUsable = readProperty(input, "runtime_usable");
  const hashes = snapshotExactRecord(snapshotJson(readProperty(input, "source_hashes")), SOURCE_HASH_KEYS);
  const metadataSnapshot = snapshotJson(readProperty(input, "catalog_metadata"));
  const metadata = snapshotExactRecord(metadataSnapshot, [
    "fetched_at", "source_hashes", "sources", "summary", "public_settings_coverage"
  ]);
  const metadataHashes = snapshotExactRecord(metadata.source_hashes, SOURCE_HASH_KEYS);
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT ||
      catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false ||
      metadata.fetched_at !== CATALOG_FETCHED_AT || metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(hashes, SOURCE_HASHES) || !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown, model: OwnerGrokT2iModel): Readonly<Record<string, unknown> & {
  readonly id: string; readonly upstream_id: string; readonly ai_name: string; readonly active: true; readonly default: boolean;
  readonly fetched_at: string; readonly scope: "image"; readonly modalities: readonly unknown[];
  readonly operations: readonly Readonly<Record<string, unknown>>[]; readonly settings: OwnerGrokT2iSourceProfile["public_settings"];
}> {
  const copiedRecord = snapshotJson(value);
  const record = snapshotExactRecord(copiedRecord, MODEL_RECORD_KEYS);
  const expected = MODEL_RECORD_HASHES[model];
  if (schemaHash(record) !== expected) fail("PROFILE_BINDING_MISMATCH");
  if (record.id !== model || record.upstream_id !== model || record.ai_name !== "grok_image" || record.active !== true ||
      typeof record.default !== "boolean" || record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" ||
      record.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || record.runtime_usable !== false ||
      !sameJson(record.source_hashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  const modalities = snapshotArray(record.modalities);
  const operations = snapshotArray(record.operations).map((item) => snapshotExactRecord(item, ["id", "display_name", "output_modality", "derivation"]));
  const settings = snapshotJson(record.settings);
  const expectedSettingKeys = [
    "accepted_file_types", "allowed_media_types", "attach_info_text", "file_count_limit", "get_cost_params",
    "max_file_size", "max_prompt_length", "uploadable",
    ...(model === "grok_imagine_2" || model === "grok_imagine_quality" ? ["files_mention"] : [])
  ].sort();
  if (!sameJson(modalities, ["image"]) || !sameJson(Object.keys(settings as Record<string, unknown>).sort(), [
    ...expectedSettingKeys
  ])) fail("PROFILE_BINDING_MISMATCH");
  return deepFreeze({ ...record, modalities, operations, settings }) as ReturnType<typeof snapshotModel>;
}

function snapshotExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result = Object.create(null) as Record<string, unknown>;
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
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result[key] = snapshotJson(descriptors[key]!.value, depth + 1, budget);
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
function isModel(value: unknown): value is OwnerGrokT2iModel {
  return typeof value === "string" && (SOURCE_PARAMETERS.models as readonly string[]).includes(value);
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
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never {
  throw new OwnerGrokT2iSourceProfileError(code);
}
