import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerFluxImageSourceParameters,
  type OwnerFluxImageModel
} from "./owner-flux-image-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const SOURCE_PARAMETERS = getOwnerFluxImageSourceParameters();
const DEFAULTS = Object.freeze({ "flux-1": true, "flux-pro-1.1": false, "flux-pro-1.1-ultra": false } as const);
const MODEL_SETTINGS = Object.freeze({
  "flux-1": Object.freeze({
    accepted_file_types: Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]),
    allowed_media_types: Object.freeze(["images"]), attach_info_text: null, file_count_limit: 1,
    get_cost_params: Object.freeze([]), max_file_size: 0, max_prompt_length: 0, uploadable: true
  }),
  "flux-pro-1.1": Object.freeze({
    accepted_file_types: Object.freeze([]), allowed_media_types: Object.freeze([]), attach_info_text: null, file_count_limit: 0,
    get_cost_params: Object.freeze([]), max_file_size: 0, max_prompt_length: 0, uploadable: false
  }),
  "flux-pro-1.1-ultra": Object.freeze({
    accepted_file_types: Object.freeze([]), allowed_media_types: Object.freeze([]), attach_info_text: null, file_count_limit: 0,
    get_cost_params: Object.freeze([]), max_file_size: 0, max_prompt_length: 0, uploadable: false
  })
} as const);
const SOURCE_ARTIFACTS = Object.freeze({
  form: Object.freeze({
    module: "flux.js", url: "https://syntx.ai/assets/1791467421/flux.js", build_id: "1791467421", bytes: 10_970,
    sha256: "sha256:80307235518f6f0c80952ce4a5a0834ee373d7294f8dc90e58748d57389de664",
    freshness: "ROOT590_ANONYMOUS_GET_MATCHED_PIN" as const,
    observed_http_date: "Sat, 10 Oct 2026 12:00:42 GMT", parse_diagnostics: 0,
    evidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
  }),
  settings_helper: Object.freeze({
    module: "settings3.js", sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe",
    freshness: "CURRENT_SOURCE_FACTS_JOIN" as const
  }),
  lora_component: Object.freeze({
    module: "LinkLora.vue", sha256: "sha256:1f28ad5b0f171f68288c827fe0725518aab51e24c590f32a5703303f1c5fc2ba",
    freshness: "CURRENT_SOURCE_FACTS_JOIN" as const
  })
});

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerFluxImageSourceProfile {
  readonly profile_id: "flux-image-source-reviewed-v1";
  readonly model_id: OwnerFluxImageModel;
  readonly variant: OwnerFluxImageModel;
  readonly ai_name: "flux";
  readonly model_type: OwnerFluxImageModel;
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
      controls_source: "ROOT591_STATIC_CONTROL_JOIN";
      workflow_policy: "EXPLICIT_LOCAL_CIVITAI_IFF_LORAS_NONEMPTY_OTHERWISE_DEFAULT";
      raw_mapping: "FLUX1_AND_PRO_OMITTED_ULTRA_FALSE_FIXED_SOURCE_CONTROL";
      watcher_defaults: "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN";
      lora_source_url_data_only: true;
      nominal_owned_lora_grant: false;
    }>;
    cost_source: Readonly<{ declared_keys: readonly []; controlled_inputs: readonly []; quote_amount_currency_actual_billing_hardcap: "UNPROVEN" }>;
  }>;
  readonly parameters_source: ReturnType<typeof getOwnerFluxImageSourceParameters>;
  readonly public_settings: Readonly<Record<string, unknown> & {
    get_cost_params: readonly string[];
    max_file_size: number;
    max_prompt_length: number;
    file_count_limit: number;
    uploadable: boolean;
  }>;
  readonly reference_count: Readonly<{ minimum: 0; maximum: 0 | 1 }>;
  readonly media_limits: Readonly<{
    accepted_file_types: readonly string[];
    allowed_media_types: readonly string[];
    file_count_limit: number;
    max_file_size: number;
    file_size_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED";
    max_prompt_length: number;
    prompt_interpretation: "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED";
    uploadable: boolean;
    provider_acceptance: "UNPROVEN";
  }>;
  readonly cost_policy: Readonly<{
    declared_metadata_keys: readonly [];
    controlled_inputs: readonly [];
    quote_or_amount: "UNPROVEN";
    confidence: "SOURCE_METADATA_ONLY_NOT_QUOTE";
  }>;
  readonly effective_defaults: "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerFluxImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata" | "catalog_kind" | "runtime_usable"> {}

export class OwnerFluxImageSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Flux image source profile could not be verified.");
    this.name = "OwnerFluxImageSourceProfileError";
  }
}

/** Returns immutable e551 source metadata for one exact Flux row; it grants no dispatch or upload capability. */
export function getOwnerFluxImageSourceProfile(
  modelInput: unknown,
  catalogInput: OwnerFluxImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerFluxImageSourceProfile> {
  if (!isModel(modelInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: unknown;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [modelInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(model, modelInput);
  if (record.id !== modelInput || record.upstream_id !== modelInput || record.ai_name !== "flux" || record.active !== true ||
      record.fetched_at !== CATALOG_FETCHED_AT || record.scope !== "image" || record.default !== DEFAULTS[modelInput] ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" || record.operations.length !== 1 ||
      record.operations[0]?.id !== "generate-image" || record.operations[0]?.output_modality !== "image" ||
      record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" || !sameJson(record.settings, MODEL_SETTINGS[modelInput])) fail("PROFILE_BINDING_MISMATCH");
  const settings = record.settings;
  const sourceBinding = deepFreeze({
    selected_public_catalog_version: CATALOG_VERSION,
    selected_public_catalog_fetched_at: CATALOG_FETCHED_AT,
    selected_public_source_hashes: SOURCE_HASHES,
    normalized_public_model: record,
    source_artifacts: SOURCE_ARTIFACTS,
    settings_source: {
      controls_source: "ROOT591_STATIC_CONTROL_JOIN" as const,
      workflow_policy: "EXPLICIT_LOCAL_CIVITAI_IFF_LORAS_NONEMPTY_OTHERWISE_DEFAULT" as const,
      raw_mapping: "FLUX1_AND_PRO_OMITTED_ULTRA_FALSE_FIXED_SOURCE_CONTROL" as const,
      watcher_defaults: "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN" as const,
      lora_source_url_data_only: true as const,
      nominal_owned_lora_grant: false as const
    },
    cost_source: { declared_keys: [] as const, controlled_inputs: [] as const, quote_amount_currency_actual_billing_hardcap: "UNPROVEN" as const }
  });
  const base = deepFreeze({
    profile_id: "flux-image-source-reviewed-v1" as const,
    model_id: modelInput, variant: modelInput, ai_name: "flux" as const, model_type: modelInput,
    catalog_default_flag: record.default,
    catalog_default_confidence: "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION" as const,
    operation_id: "generate-image" as const, public_catalog_version: CATALOG_VERSION,
    source_binding: sourceBinding, parameters_source: SOURCE_PARAMETERS,
    public_settings: settings as OwnerFluxImageSourceProfile["public_settings"],
    reference_count: { minimum: 0 as const, maximum: modelInput === "flux-1" ? 1 as const : 0 as const },
    media_limits: {
      accepted_file_types: settings.accepted_file_types as readonly string[],
      allowed_media_types: settings.allowed_media_types as readonly string[],
      file_count_limit: settings.file_count_limit as number, max_file_size: settings.max_file_size as number,
      file_size_interpretation: "ZERO_UNRESOLVED_NOT_UNLIMITED" as const,
      max_prompt_length: settings.max_prompt_length as number, prompt_interpretation: "PUBLIC_ZERO_UNRESOLVED_NOT_UNLIMITED" as const,
      uploadable: settings.uploadable as boolean, provider_acceptance: "UNPROVEN" as const
    },
    cost_policy: { declared_metadata_keys: [] as const, controlled_inputs: [] as const,
      quote_or_amount: "UNPROVEN" as const, confidence: "SOURCE_METADATA_ONLY_NOT_QUOTE" as const },
    effective_defaults: "UNKNOWN_CALLBACK_ORDER_AND_CACHED_UI_NOT_PROVEN" as const,
    dispatch_allowed: false as const, runtime_activation: false as const, backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerFluxImageSourceProfile>;
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
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== CATALOG_FETCHED_AT || catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      runtimeUsable !== false || metadata.fetched_at !== CATALOG_FETCHED_AT || metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(hashes, SOURCE_HASHES) || !sameJson(metadataHashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown, model: OwnerFluxImageModel): Readonly<{
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
  const expectedKeys = Object.keys(MODEL_SETTINGS[model]).sort();
  if (!sameJson(hashes, SOURCE_HASHES) || fields.active !== true || fields.scope !== "image" ||
      fields.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || fields.runtime_usable !== false ||
      !sameJson(Object.keys(settings as Record<string, unknown>).sort(), expectedKeys)) fail("PROFILE_BINDING_MISMATCH");
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
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function snapshotRecord(value: unknown): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Object.create(null) as Record<string, unknown>;
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
function isModel(value: unknown): value is OwnerFluxImageModel { return typeof value === "string" && (SOURCE_PARAMETERS.models as readonly string[]).includes(value); }
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
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerFluxImageSourceProfileError(code); }
