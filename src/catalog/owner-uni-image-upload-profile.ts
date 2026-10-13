import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository } from "./discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "./selected-discovery-catalog.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const CATALOG_METADATA_SHA256 = "sha256:fbd9ebb6cb75ff7d12737dc050d4467f0824cd4fdb575a847cb359258f8971f6";
const MODEL_RECORD_HASHES = Object.freeze({
  "uni-1": "sha256:9c095d9bc71d214d8005b55038a4212f7b19fb3fb9255fe3b8c0e8d24ab7b02d",
  "uni-1.1-modify-image": "sha256:61fab99d9e121bc9e29742a071e328dc4ee2a9c5140472f2d2025fb4ce538796",
  "uni-1.1-remove-background": "sha256:88ac8c582d2ebbb3c65866c38b9638eaef1d1c1df1855ecf096b5c61575fd96c"
} as const);
const MODEL_IDS = Object.freeze(Object.keys(MODEL_RECORD_HASHES) as (keyof typeof MODEL_RECORD_HASHES)[]);
const SOURCE_HASH_KEYS = Object.freeze(["ai", "llm_models", "models"] as const);
const CATALOG_METADATA_KEYS = Object.freeze(["fetched_at", "source_hashes", "sources", "summary", "public_settings_coverage"] as const);
const MODEL_RECORD_KEYS = Object.freeze([
  "id", "upstream_id", "ai_name", "display_name", "description", "active", "default", "type", "scope",
  "modalities", "operations", "features", "settings", "llm_enrichment", "catalog_kind", "runtime_usable",
  "fetched_at", "source_hashes"
] as const);
const PUBLIC_ACCEPTED_FILE_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"] as const);
const LOCAL_ACCEPTED_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"] as const);
const SOURCE_METADATA_MAX_FILE_SIZE = 26_214_400;
const LOCAL_INPUT_MAX_BYTES = 26_214_400;
const LOCAL_INPUT_MAX_BYTES_POLICY = "SELECTED_PUBLIC_METADATA_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" as const;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 50_000;

export interface OwnerUniImageUploadCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "catalog_kind" | "runtime_usable" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

export interface OwnerUniImageUploadSourceMetadata {
  readonly active: true;
  readonly uploadable: true;
  readonly accepted_file_types: typeof PUBLIC_ACCEPTED_FILE_TYPES;
  readonly max_file_size: 26_214_400;
  readonly confidence: "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE";
}

export interface OwnerUniImageUploadLocalInputPolicy {
  readonly accepted_mime_types: typeof LOCAL_ACCEPTED_MIME_TYPES;
  readonly local_max_bytes: 26_214_400;
  readonly local_max_bytes_policy: "SELECTED_PUBLIC_METADATA_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly jpeg_jpg_canonicalization: "image/jpg_TO_image/jpeg";
}

export interface OwnerUniImageUploadProfile {
  readonly profile_id: "owner-uni-image-upload-profile-v1";
  readonly model_id: OwnerUniImageModelId;
  readonly ai_name: "luma_image";
  readonly model_type: OwnerUniImageModelId;
  readonly scope: "image";
  readonly operation_id: "upload-image-reference";
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly catalog_fetched_at: typeof CATALOG_FETCHED_AT;
  readonly catalog_source_hashes: typeof SOURCE_HASHES;
  readonly catalog_metadata_sha256: typeof CATALOG_METADATA_SHA256;
  readonly full_public_record_sha256: (typeof MODEL_RECORD_HASHES)[OwnerUniImageModelId];
  readonly source_metadata: OwnerUniImageUploadSourceMetadata;
  readonly local_input_policy: OwnerUniImageUploadLocalInputPolicy;
  readonly upload_profile_schema_hash: string;
}

export type OwnerUniImageModelId = keyof typeof MODEL_RECORD_HASHES;

export class OwnerUniImageUploadProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The owner Uni image upload profile could not be verified.");
    this.name = "OwnerUniImageUploadProfileError";
  }
}

/** Returns an immutable upload-only binding for one exact full e551 discovery record. */
export function getOwnerUniImageUploadProfile(
  modelInput: unknown,
  catalogInput: OwnerUniImageUploadCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerUniImageUploadProfile> {
  if (!isModel(modelInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let rawModel: unknown;
  try { rawModel = Reflect.apply(catalog.getModel, catalog.receiver, [modelInput]); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotModel(rawModel, modelInput);
  if (record.id !== modelInput || record.upstream_id !== modelInput || record.ai_name !== "luma_image" ||
      record.active !== true || record.scope !== "image" || record.modalities.length !== 1 || record.modalities[0] !== "image" ||
      record.operations.length !== 1 || !sameJson(record.operations[0], {
        id: "generate-image", display_name: "Generate image", output_modality: "image", derivation: "PUBLIC_AI_SCOPE"
      })) fail("PROFILE_BINDING_MISMATCH");

  const settings = snapshotExactRecord(record.settings, [
    "accepted_file_types", "allowed_media_types", "attach_info_text", "file_count_limit", "files_mention",
    "get_cost_params", "max_file_size", "max_prompt_length", "uploadable"
  ]);
  if (!sameJson(settings.accepted_file_types, PUBLIC_ACCEPTED_FILE_TYPES) || settings.uploadable !== true ||
      settings.max_file_size !== SOURCE_METADATA_MAX_FILE_SIZE) fail("PROFILE_BINDING_MISMATCH");

  const sourceMetadata: OwnerUniImageUploadSourceMetadata = deepFreeze({
    active: true,
    uploadable: true,
    accepted_file_types: PUBLIC_ACCEPTED_FILE_TYPES,
    max_file_size: SOURCE_METADATA_MAX_FILE_SIZE,
    confidence: "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE"
  });
  const localInputPolicy: OwnerUniImageUploadLocalInputPolicy = deepFreeze({
    accepted_mime_types: LOCAL_ACCEPTED_MIME_TYPES,
    local_max_bytes: LOCAL_INPUT_MAX_BYTES,
    local_max_bytes_policy: LOCAL_INPUT_MAX_BYTES_POLICY,
    metadata_confidence: "CONTAINER_METADATA_ONLY",
    jpeg_jpg_canonicalization: "image/jpg_TO_image/jpeg"
  });
  const base = deepFreeze({
    profile_id: "owner-uni-image-upload-profile-v1" as const,
    model_id: modelInput,
    ai_name: "luma_image" as const,
    model_type: modelInput,
    scope: "image" as const,
    operation_id: "upload-image-reference" as const,
    catalog_version: CATALOG_VERSION,
    catalog_fetched_at: CATALOG_FETCHED_AT,
    catalog_source_hashes: SOURCE_HASHES,
    catalog_metadata_sha256: CATALOG_METADATA_SHA256,
    full_public_record_sha256: MODEL_RECORD_HASHES[modelInput],
    source_metadata: sourceMetadata,
    local_input_policy: localInputPolicy
  });
  return deepFreeze({ ...base, upload_profile_schema_hash: schemaHash(base) }) as Readonly<OwnerUniImageUploadProfile>;
}

interface CatalogSnapshot { readonly receiver: object; readonly getModel: (...args: never[]) => unknown }

function snapshotCatalog(input: unknown): CatalogSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const getModel = readDataProperty(input, "getModel");
  const catalogKind = readDataProperty(input, "catalog_kind");
  const runtimeUsable = readDataProperty(input, "runtime_usable");
  const fetchedAt = readDataProperty(input, "fetched_at");
  const sourceHashes = snapshotExactRecord(snapshotJson(readDataProperty(input, "source_hashes")), SOURCE_HASH_KEYS);
  const metadata = snapshotExactRecord(snapshotJson(readDataProperty(input, "catalog_metadata")), CATALOG_METADATA_KEYS);
  const metadataHashes = snapshotExactRecord(metadata.source_hashes, SOURCE_HASH_KEYS);
  if (typeof getModel !== "function" || isProxy(getModel) || catalogKind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || runtimeUsable !== false ||
      fetchedAt !== CATALOG_FETCHED_AT || metadata.fetched_at !== CATALOG_FETCHED_AT ||
      metadata.public_settings_coverage !== "ALLOWLISTED_PUBLIC_API_FIELDS" ||
      !sameJson(sourceHashes, SOURCE_HASHES) || !sameJson(metadataHashes, SOURCE_HASHES) ||
      schemaHash(metadata) !== CATALOG_METADATA_SHA256) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input, getModel: getModel as (...args: never[]) => unknown });
}

function snapshotModel(value: unknown, model: OwnerUniImageModelId): Readonly<Record<string, unknown> & {
  readonly id: string; readonly upstream_id: string; readonly ai_name: string; readonly active: true;
  readonly scope: string; readonly modalities: readonly unknown[]; readonly operations: readonly Readonly<Record<string, unknown>>[];
  readonly settings: Readonly<Record<string, unknown>>;
}> {
  const record = snapshotExactRecord(snapshotJson(value), MODEL_RECORD_KEYS);
  if (schemaHash(record) !== MODEL_RECORD_HASHES[model] || record.id !== model || record.upstream_id !== model ||
      record.ai_name !== "luma_image" || record.active !== true || record.fetched_at !== CATALOG_FETCHED_AT ||
      record.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || record.runtime_usable !== false ||
      !sameJson(record.source_hashes, SOURCE_HASHES)) fail("PROFILE_BINDING_MISMATCH");
  const modalities = snapshotArray(record.modalities);
  const operations = snapshotArray(record.operations).map((operation) => snapshotExactRecord(operation,
    ["id", "display_name", "output_modality", "derivation"]));
  const settings = snapshotJson(record.settings);
  return deepFreeze({ ...record, modalities, operations, settings }) as unknown as ReturnType<typeof snapshotModel>;
}

function snapshotJson(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH || isProxy(value)) fail("PROFILE_BINDING_MISMATCH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("PROFILE_BINDING_MISMATCH");
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (keys.length !== value.length + 1 || !lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== value.length) fail("PROFILE_BINDING_MISMATCH");
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
      output.push(snapshotJson(descriptor.value, depth + 1, budget));
    }
    if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) {
      fail("PROFILE_BINDING_MISMATCH");
    }
    return output;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("PROFILE_BINDING_MISMATCH");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
      output[key] = snapshotJson(descriptors[key]!.value, depth + 1, budget);
    }
    return output;
  }
  fail("PROFILE_BINDING_MISMATCH");
}

function snapshotExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("PROFILE_BINDING_MISMATCH");
  const actual = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) fail("PROFILE_BINDING_MISMATCH");
  return value;
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
  fail("INVALID_REQUEST");
}
function sameJson(left: unknown, right: unknown): boolean {
  try { return schemaHash(left) === schemaHash(right); } catch { return false; }
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]!);
    Object.freeze(value);
  }
  return value;
}
function isModel(value: unknown): value is OwnerUniImageModelId {
  return typeof value === "string" && (MODEL_IDS as readonly string[]).includes(value);
}
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerUniImageUploadProfileError(code); }
