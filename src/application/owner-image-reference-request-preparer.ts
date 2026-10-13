import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";
import { schemaHash } from "../domain/generation-contract.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2,
  type GenerationContractV2JsonValue
} from "../domain/generation-contract-v2.js";
import { validateGenerationParametersV2 } from "./generation-contract-validator-v2.js";
import { OwnerMediaReferenceStore, OwnerMediaReferenceStoreError, type OwnerMediaReferenceContractBinding } from "./owner-media-reference-store.js";

const MODEL_ID = "banana-2.1";
const MODEL_TYPE = "banana-2.1";
const AI_NAME = "banana";
const OPERATION_ID = "generate-image" as const;
const ROUTE = "design" as const;
const BASE_VARIANT_ID = "banana21-image-1k-minimal-square";
const BASE_SCHEMA_HASH = "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d";
const REGISTRY_SHA256 = "sha256:2f8cf81a41efece59008a919924975cbd2e379569784565b7643f2a225a017fd";
const CANDIDATE_VARIANT_ID = "banana21-image-1k-minimal-square-reference-candidate";
const OWNER_REFERENCE_HANDLE = /^reference_[0-9a-f-]{36}$/u;
const PRIVATE_OWNER_URL_MARKER = "<private-owner-resolved-image-url>";

const preparedCandidateBrand: unique symbol = Symbol("OwnerImageReferencePreparedCandidate");
const preparedCandidatePrincipals = new WeakMap<object, Readonly<{
  principal: Readonly<GenerationPrincipalRef>;
  attemptId: string;
}>>();

export interface PrepareOwnerImageReferenceRequestInput {
  readonly registry: GenerationContractRegistryV2;
  readonly catalog: GenerationContractCatalogPort;
  readonly store: OwnerMediaReferenceStore;
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly reference_handle: string;
  readonly parameters: unknown;
}

/** Private, branded artifact. It cannot satisfy the executable generation DTO. */
export interface OwnerImageReferencePreparedCandidate {
  readonly [preparedCandidateBrand]: true;
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly confidence: "PREPARED_REFERENCE_CANDIDATE";
  readonly backend_acceptance: "unproven";
  readonly registry_sha256: string;
  readonly catalog_version: string;
  readonly model_id: typeof MODEL_ID;
  readonly model_type: typeof MODEL_TYPE;
  readonly operation_id: typeof OPERATION_ID;
  readonly route: typeof ROUTE;
  readonly base_variant_id: typeof BASE_VARIANT_ID;
  readonly base_schema_hash: typeof BASE_SCHEMA_HASH;
  readonly candidate_variant_id: typeof CANDIDATE_VARIANT_ID;
  readonly candidate_schema_hash: string;
  readonly request: Readonly<{
    prompt: string;
    settings: Readonly<Record<string, GenerationContractV2JsonValue>>;
  }>;
}

export type OwnerImageReferencePrepareErrorCode =
  | "INVALID_REQUEST"
  | "SOURCE_BINDING_MISMATCH"
  | "CONTRACT_SHAPE_UNSUPPORTED"
  | "PARAMETERS_INVALID"
  | "REFERENCE_UNAVAILABLE";

export class OwnerImageReferencePrepareError extends Error {
  constructor(readonly code: OwnerImageReferencePrepareErrorCode) {
    super("The owner image-reference candidate could not be prepared safely.");
    this.name = "OwnerImageReferencePrepareError";
  }
}

/**
 * Returns the exact private store binding for future owner upload work. The
 * candidate hash is distinct from, and never written back into, the live base.
 */
export function getOwnerImageReferenceCandidateStoreBinding(
  registryInput: GenerationContractRegistryV2 | unknown,
  catalogInput: GenerationContractCatalogPort | unknown
): OwnerMediaReferenceContractBinding {
  const { registry, contract } = resolveSource(registryInput, catalogInput);
  assertBaseProfile(contract);
  const catalogVersion = `sha256-${registry.registry_sha256.slice("sha256:".length)}.json`;
  const candidateSchemaHash = schemaHash({
    schema_version: "OWNER_IMAGE_REFERENCE_CANDIDATE_V1",
    registry_sha256: registry.registry_sha256,
    catalog_version: catalogVersion,
    model_id: MODEL_ID,
    model_type: MODEL_TYPE,
    ai_name: AI_NAME,
    operation_id: OPERATION_ID,
    route: ROUTE,
    modality: "image",
    base_variant_id: BASE_VARIANT_ID,
    base_schema_hash: BASE_SCHEMA_HASH,
    candidate_variant_id: CANDIDATE_VARIANT_ID,
    wire_delta: {
      settings_field: "file_urls",
      cardinality: 1,
      entry: { type: "image", url: PRIVATE_OWNER_URL_MARKER }
    }
  });
  return Object.freeze({
    schema_hash: candidateSchemaHash,
    catalog_version: catalogVersion,
    model_id: MODEL_ID,
    model_type: MODEL_TYPE,
    operation_id: OPERATION_ID,
    modality: "image",
    variant_id: CANDIDATE_VARIANT_ID
  });
}

/** Prepare one privately resolved image URL as a non-dispatchable candidate. */
export async function prepareOwnerImageReferenceRequest(
  input: PrepareOwnerImageReferenceRequestInput | unknown
): Promise<OwnerImageReferencePreparedCandidate> {
  const request = snapshotInput(input);
  const { registry, contract } = resolveSource(request.registry, request.catalog);
  assertBaseProfile(contract);
  const storeBinding = getOwnerImageReferenceCandidateStoreBinding(registry, request.catalog);
  const parameters = snapshotPromptParameters(request.parameters);
  let normalized: Readonly<Record<string, GenerationContractV2JsonValue>>;
  try {
    normalized = validateGenerationParametersV2(contract, parameters);
  } catch {
    fail("PARAMETERS_INVALID");
  }
  const prompt = normalized.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0 ||
      !Array.isArray(normalized.file_urls) || normalized.file_urls.length !== 0) {
    fail("PARAMETERS_INVALID");
  }

  let resolved: Readonly<{ file_urls: readonly string[] }>;
  try {
    resolved = await request.store.resolveImageReferences({
      binding: request.binding,
      attemptId: request.attemptId,
      linkService: request.linkService,
      contract: storeBinding,
      reference_handles: [request.reference_handle]
    });
  } catch (error) {
    if (error instanceof OwnerMediaReferenceStoreError) fail("REFERENCE_UNAVAILABLE");
    fail("REFERENCE_UNAVAILABLE");
  }
  if (!resolved || typeof resolved !== "object" || types.isProxy(resolved) ||
      !Array.isArray(resolved.file_urls) || types.isProxy(resolved.file_urls) ||
      resolved.file_urls.length !== 1 || typeof resolved.file_urls[0] !== "string" ||
      !isSafeUploadReferenceUrl(resolved.file_urls[0])) {
    fail("REFERENCE_UNAVAILABLE");
  }
  const resolvedPrincipal = snapshotGenerationPrincipal({
    tenant_id: request.binding.tenant_id,
    subject_id: request.binding.subject,
    connection_id: request.attemptId
  });

  const settings: Record<string, GenerationContractV2JsonValue> = structuredClone(contract.wire.fixed_settings);
  for (const [parameterField, wireField] of Object.entries(contract.wire.settings_fields)) {
    if (parameterField === "file_urls") continue;
    const value = normalized[parameterField];
    if (value === undefined || parameterField === contract.wire.prompt_field) fail("CONTRACT_SHAPE_UNSUPPORTED");
    settings[wireField] = value;
  }
  settings.model_type = MODEL_TYPE;
  settings.file_urls = [{ type: "image", url: resolved.file_urls[0] }];
  const frozenSettings = deepFreeze(settings);

  const candidate = Object.freeze({
    [preparedCandidateBrand]: true as const,
    status: "blocked" as const,
    dispatch_allowed: false as const,
    confidence: "PREPARED_REFERENCE_CANDIDATE" as const,
    backend_acceptance: "unproven" as const,
    registry_sha256: registry.registry_sha256,
    catalog_version: registry.catalog_version,
    model_id: MODEL_ID,
    model_type: MODEL_TYPE,
    operation_id: OPERATION_ID,
    route: ROUTE,
    base_variant_id: BASE_VARIANT_ID,
    base_schema_hash: BASE_SCHEMA_HASH,
    candidate_variant_id: CANDIDATE_VARIANT_ID,
    candidate_schema_hash: storeBinding.schema_hash,
    request: Object.freeze({ prompt, settings: frozenSettings })
  });
  preparedCandidatePrincipals.set(candidate, Object.freeze({
    principal: resolvedPrincipal,
    attemptId: request.attemptId
  }));
  return candidate;
}

/** Safe internal authenticity/scope check for the one-shot reference policy. */
export function isOwnerImageReferencePreparedCandidateForPrincipal(
  candidate: unknown,
  principalInput: unknown,
  attemptId: unknown
): candidate is OwnerImageReferencePreparedCandidate {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate) ||
      !Object.isFrozen(candidate) || typeof attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId)) {
    return false;
  }
  const issued = preparedCandidatePrincipals.get(candidate);
  if (!issued || issued.attemptId !== attemptId || !issued.principal.connection_id ||
      issued.principal.connection_id !== attemptId) return false;
  try {
    const principal = snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef);
    return sameGenerationPrincipal(issued.principal, principal) &&
      (candidate as OwnerImageReferencePreparedCandidate).dispatch_allowed === false &&
      (candidate as OwnerImageReferencePreparedCandidate).status === "blocked";
  } catch {
    return false;
  }
}

function snapshotInput(input: unknown) {
  const fields = readExactRecord(input, [
    "registry", "catalog", "store", "binding", "attemptId", "linkService", "reference_handle", "parameters"
  ]);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      typeof fields.reference_handle !== "string" || !OWNER_REFERENCE_HANDLE.test(fields.reference_handle) ||
      !fields.catalog || typeof fields.catalog !== "object" || types.isProxy(fields.catalog) ||
      !fields.store || typeof fields.store !== "object" || types.isProxy(fields.store) ||
      !fields.linkService || typeof fields.linkService !== "object" || types.isProxy(fields.linkService)) {
    fail("INVALID_REQUEST");
  }
  const bindingFields = readExactRecord(fields.binding, ["tenant_id", "subject"]);
  if (typeof bindingFields.tenant_id !== "string" || typeof bindingFields.subject !== "string") fail("INVALID_REQUEST");
  return {
    registry: fields.registry as GenerationContractRegistryV2,
    catalog: fields.catalog as GenerationContractCatalogPort,
    store: fields.store as OwnerMediaReferenceStore,
    binding: Object.freeze({ tenant_id: bindingFields.tenant_id, subject: bindingFields.subject }),
    attemptId: fields.attemptId,
    linkService: fields.linkService as Pick<PerUserLinkService, "getStatus">,
    reference_handle: fields.reference_handle,
    parameters: fields.parameters
  };
}

function resolveSource(
  registryInput: GenerationContractRegistryV2 | unknown,
  catalogInput: GenerationContractCatalogPort | unknown
): { registry: GenerationContractRegistryV2; contract: GenerationContractV2 } {
  let registry: GenerationContractRegistryV2;
  try {
    if (types.isProxy(registryInput)) fail("SOURCE_BINDING_MISMATCH");
    registry = generationContractRegistryV2Schema.parse(registryInput);
  } catch {
    fail("SOURCE_BINDING_MISMATCH");
  }
  if (registry.registry_sha256 !== REGISTRY_SHA256 || !catalogInput || typeof catalogInput !== "object" ||
      types.isProxy(catalogInput)) fail("SOURCE_BINDING_MISMATCH");
  const matches = registry.contracts.filter((item) => item.variant_id === BASE_VARIANT_ID);
  if (matches.length !== 1) fail("SOURCE_BINDING_MISMATCH");
  let model: ReturnType<GenerationContractCatalogPort["getModel"]>;
  try {
    const getModel = findMethod(catalogInput, "getModel");
    if (typeof getModel !== "function") fail("SOURCE_BINDING_MISMATCH");
    model = Reflect.apply(getModel, catalogInput, [MODEL_ID]) as ReturnType<GenerationContractCatalogPort["getModel"]>;
  } catch {
    fail("SOURCE_BINDING_MISMATCH");
  }
  const contract = matches[0]!;
  const modelFields = readDataProperties(model, ["active", "id", "upstream_id", "ai_name", "operations", "fetched_at", "source_hashes"]);
  const operations = modelFields.operations;
  if (!Array.isArray(operations) || types.isProxy(operations)) fail("SOURCE_BINDING_MISMATCH");
  const operation = findOperation(operations);
  const sourceHashes = modelFields.source_hashes;
  if (!sourceHashes || typeof sourceHashes !== "object" || types.isProxy(sourceHashes)) fail("SOURCE_BINDING_MISMATCH");
  const hashFields = readDataProperties(sourceHashes, ["ai", "llm_models", "models"]);
  if (modelFields.active !== true || modelFields.id !== MODEL_ID || modelFields.upstream_id !== MODEL_TYPE || modelFields.ai_name !== AI_NAME ||
      !operation || operation.output_modality !== "image" || typeof modelFields.fetched_at !== "string" ||
      typeof hashFields.models !== "string" || `${modelFields.fetched_at}.${hashFields.models.slice(7, 19)}` !== registry.catalog_version ||
      !sameSourceHashes(hashFields as { ai: string; llm_models: string; models: string }, registry.source_hashes)) fail("SOURCE_BINDING_MISMATCH");
  return { registry, contract };
}

function assertBaseProfile(contract: GenerationContractV2): void {
  const fileUrls = contract.parameters.properties.file_urls;
  const prompt = contract.parameters.properties.prompt;
  if (contract.status !== "live_verified" || contract.schema_hash !== BASE_SCHEMA_HASH ||
      contract.model_id !== MODEL_ID || contract.model_type !== MODEL_TYPE || contract.ai_name !== AI_NAME ||
      contract.operation_id !== OPERATION_ID || contract.modality !== "image" || contract.route !== ROUTE ||
      contract.wire.dispatch_action !== OPERATION_ID || contract.wire.input_kind !== "prompt" ||
      contract.wire.prompt_field !== "prompt" || contract.wire.media_reference_fields.file_urls !== undefined ||
      Object.keys(contract.wire.media_reference_fields).length !== 0 ||
      contract.wire.settings_fields.file_urls !== "file_urls" || Object.keys(contract.wire.settings_fields).length !== 1 ||
      JSON.stringify(contract.wire.fixed_settings) !== JSON.stringify({ aspect_ratio: "1:1", image_size: "1K", n: 1, thinking_level: "minimal" }) ||
      !contract.parameters.required.includes("prompt") || !prompt || prompt.type !== "string" ||
      !fileUrls || fileUrls.type !== "array" || fileUrls.min_items !== 0 || fileUrls.max_items !== 0 ||
      !Array.isArray(fileUrls.default) || fileUrls.default.length !== 0 || fileUrls.items.type !== "string") {
    fail("CONTRACT_SHAPE_UNSUPPORTED");
  }
}

function snapshotPromptParameters(value: unknown): Record<string, unknown> {
  const fields = readExactRecord(value, ["prompt"]);
  if (Object.keys(fields).length !== 1 || typeof fields.prompt !== "string") fail("PARAMETERS_INVALID");
  return fields;
}

function readExactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expectedKeys.length || keys.some((key) =>
    typeof key !== "string" || !expectedKeys.includes(key) || !("value" in descriptors[key]!)
  )) fail("INVALID_REQUEST");
  const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) record[key] = descriptors[key]!.value;
  return record;
}

function sameSourceHashes(
  left: { readonly ai: string; readonly llm_models: string; readonly models: string },
  right: { readonly ai: string; readonly llm_models: string; readonly models: string }
): boolean {
  return left.ai === right.ai && left.llm_models === right.llm_models && left.models === right.models;
}

function findMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function readDataProperties(target: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!target || typeof target !== "object" || Array.isArray(target) || types.isProxy(target)) fail("SOURCE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || !("value" in descriptor)) fail("SOURCE_BINDING_MISMATCH");
    result[key] = descriptor.value;
  }
  return result;
}

function findOperation(operations: readonly unknown[]): { readonly output_modality?: unknown } | undefined {
  for (const item of operations) {
    const fields = readDataProperties(item, ["id", "output_modality"]);
    if (fields.id === OPERATION_ID) return fields as { readonly output_modality?: unknown };
  }
  return undefined;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function fail(code: OwnerImageReferencePrepareErrorCode): never {
  throw new OwnerImageReferencePrepareError(code);
}
