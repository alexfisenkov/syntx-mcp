import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2,
  type GenerationContractV2,
  type GenerationContractV2JsonValue
} from "../domain/generation-contract-v2.js";
import { validateGenerationParametersV2, GenerationContractValidationErrorV2 } from "./generation-contract-validator-v2.js";
import { OwnerMediaReferenceStore, OwnerMediaReferenceStoreError } from "./owner-media-reference-store.js";

const WAN_I2V_MODEL_ID = "wan_26_i2v";
const OPERATION_ID = "generate-video";
const REFERENCE_FIELD = "file_urls";
// V2 validates provider-upload-id syntax. This fixed sentinel only validates
// the closed array schema; the real owner handle is resolved separately below.
const VALIDATION_ONLY_REFERENCE_ID = "validation-reference-only";
const OWNER_REFERENCE_HANDLE = /^reference_[0-9a-f-]{36}$/u;
const SAFE_VARIANT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export type OwnerReferenceCandidateStatus = "needs_wire_contract" | "unreviewed";

export interface PrepareOwnerReferenceRequestInput {
  readonly candidate_status: OwnerReferenceCandidateStatus;
  readonly registry: GenerationContractRegistryV2;
  readonly catalog: GenerationContractCatalogPort;
  readonly store: OwnerMediaReferenceStore;
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly variant_id: string;
  readonly reference_handle: string;
  readonly parameters: unknown;
}

const preparedCandidateBrand: unique symbol = Symbol("OwnerReferencePreparedCandidate");

/** Internal prepared artifact; branded so it cannot satisfy the dispatch DTO by structure. */
export interface OwnerReferencePreparedCandidate {
  readonly [preparedCandidateBrand]: true;
  readonly dispatch_allowed: false;
  readonly confidence: "PREPARED_REFERENCE_CANDIDATE";
  readonly registry_sha256: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly operation_id: typeof OPERATION_ID;
  readonly variant_id: string;
  readonly schema_hash: string;
  readonly request: Readonly<{
    prompt: string;
    settings: Readonly<Record<string, GenerationContractV2JsonValue>>;
  }>;
}

export type OwnerReferencePrepareErrorCode =
  | "INVALID_REQUEST"
  | "CANDIDATE_NOT_PREPARED"
  | "CATALOG_BINDING_MISMATCH"
  | "CONTRACT_SHAPE_UNSUPPORTED"
  | "PARAMETERS_INVALID"
  | "REFERENCE_UNAVAILABLE";

export class OwnerReferencePrepareError extends Error {
  constructor(readonly code: OwnerReferencePrepareErrorCode) {
    super("The owner reference candidate could not be prepared safely.");
    this.name = "OwnerReferencePrepareError";
  }
}

/**
 * Prepares one blocked WAN i2v candidate. This is intentionally not a
 * PreparedSyntxMediaRequest and carries an unconditional dispatch denial.
 */
export async function prepareOwnerReferenceRequest(
  input: PrepareOwnerReferenceRequestInput | unknown
): Promise<OwnerReferencePreparedCandidate> {
  const request = snapshotInput(input);
  const registry = parseRegistry(request.registry);
  if (request.candidate_status !== "needs_wire_contract" && request.candidate_status !== "unreviewed") {
    fail("CANDIDATE_NOT_PREPARED");
  }
  if (!SAFE_VARIANT_ID.test(request.variant_id) || !OWNER_REFERENCE_HANDLE.test(request.reference_handle)) {
    fail("INVALID_REQUEST");
  }

  const contract = selectCandidate(registry, request.variant_id);
  const model = resolveCurrentModel(request.catalog, contract, registry);
  assertCandidateSourceBinding(contract, registry);
  assertOneImageWireShape(contract);
  const parameters = snapshotClosedParameters(request.parameters, contract);
  const validatorParameters: Record<string, unknown> = {
    ...parameters,
    // The V2 validator's media_reference node checks provider-ID syntax, while
    // reference_ handles are a separate private namespace resolved below.
    [REFERENCE_FIELD]: [VALIDATION_ONLY_REFERENCE_ID]
  };
  let normalized: Readonly<Record<string, GenerationContractV2JsonValue>>;
  try {
    normalized = validateGenerationParametersV2(contract, validatorParameters);
  } catch (error) {
    if (error instanceof GenerationContractValidationErrorV2) fail("PARAMETERS_INVALID");
    fail("PARAMETERS_INVALID");
  }
  const promptField = contract.wire.prompt_field;
  const prompt = promptField === null ? undefined : normalized[promptField];
  if (typeof prompt !== "string" || prompt.trim().length === 0) fail("PARAMETERS_INVALID");

  const settings: Record<string, GenerationContractV2JsonValue> = structuredClone(contract.wire.fixed_settings);
  if (Object.hasOwn(settings, REFERENCE_FIELD)) fail("CONTRACT_SHAPE_UNSUPPORTED");
  for (const [parameterField, wireField] of Object.entries(contract.wire.settings_fields)) {
    const value = normalized[parameterField];
    if (value === undefined || parameterField === promptField || parameterField === REFERENCE_FIELD) {
      fail("CONTRACT_SHAPE_UNSUPPORTED");
    }
    settings[wireField] = value;
  }
  settings.model_type = model.upstream_id;

  let resolved: Readonly<{ file_urls: readonly string[] }>;
  try {
    resolved = await request.store.resolveImageReferences({
      binding: request.binding,
      attemptId: request.attemptId,
      linkService: request.linkService,
      contract: {
        schema_hash: contract.schema_hash,
        catalog_version: ownerReferenceRegistryVersion(registry),
        model_id: contract.model_id,
        model_type: model.upstream_id,
        operation_id: OPERATION_ID,
        modality: "video",
        variant_id: contract.variant_id
      },
      reference_handles: [request.reference_handle]
    });
  } catch (error) {
    if (error instanceof OwnerMediaReferenceStoreError) fail("REFERENCE_UNAVAILABLE");
    fail("REFERENCE_UNAVAILABLE");
  }
  if (!Array.isArray(resolved.file_urls) || types.isProxy(resolved.file_urls) ||
      resolved.file_urls.length !== 1 || typeof resolved.file_urls[0] !== "string" ||
      !isSafeUploadReferenceUrl(resolved.file_urls[0])) {
    fail("REFERENCE_UNAVAILABLE");
  }
  settings[REFERENCE_FIELD] = [resolved.file_urls[0]];
  const frozenSettings = deepFreeze(settings);
  return Object.freeze({
    [preparedCandidateBrand]: true as const,
    dispatch_allowed: false as const,
    confidence: "PREPARED_REFERENCE_CANDIDATE" as const,
    registry_sha256: registry.registry_sha256,
    catalog_version: registry.catalog_version,
    model_id: contract.model_id,
    operation_id: OPERATION_ID,
    variant_id: contract.variant_id,
    schema_hash: contract.schema_hash,
    request: Object.freeze({ prompt, settings: frozenSettings })
  });
}

function snapshotInput(input: unknown) {
  const fields = readPlainDataRecord(input, [
    "candidate_status", "registry", "catalog", "store", "binding", "attemptId", "linkService",
    "variant_id", "reference_handle", "parameters"
  ]);
  if ((fields.candidate_status !== "needs_wire_contract" && fields.candidate_status !== "unreviewed") ||
      typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      typeof fields.variant_id !== "string" || typeof fields.reference_handle !== "string" ||
      !fields.catalog || typeof fields.catalog !== "object" || types.isProxy(fields.catalog) ||
      !fields.store || typeof fields.store !== "object" || types.isProxy(fields.store) ||
      !fields.linkService || typeof fields.linkService !== "object" || types.isProxy(fields.linkService)) {
    fail("INVALID_REQUEST");
  }
  const bindingFields = readPlainDataRecord(fields.binding, ["tenant_id", "subject"]);
  const principal = snapshotGenerationPrincipal({
    tenant_id: bindingFields.tenant_id as string,
    subject_id: bindingFields.subject as string,
    connection_id: fields.attemptId
  });
  return {
    candidate_status: fields.candidate_status,
    registry: fields.registry as GenerationContractRegistryV2,
    catalog: fields.catalog as GenerationContractCatalogPort,
    store: fields.store as OwnerMediaReferenceStore,
    binding: Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id }),
    attemptId: fields.attemptId,
    linkService: fields.linkService as Pick<PerUserLinkService, "getStatus">,
    variant_id: fields.variant_id,
    reference_handle: fields.reference_handle,
    parameters: fields.parameters
  };
}

function parseRegistry(value: GenerationContractRegistryV2): GenerationContractRegistryV2 {
  try {
    if (types.isProxy(value)) fail("CANDIDATE_NOT_PREPARED");
    return generationContractRegistryV2Schema.parse(value);
  } catch {
    fail("CANDIDATE_NOT_PREPARED");
  }
}

function selectCandidate(registry: GenerationContractRegistryV2, variantId: string): GenerationContractV2 {
  const matches = registry.contracts.filter((contract) =>
    contract.model_id === WAN_I2V_MODEL_ID && contract.operation_id === OPERATION_ID && contract.variant_id === variantId
  );
  if (matches.length !== 1) fail("CANDIDATE_NOT_PREPARED");
  const contract = matches[0]!;
  if (contract.status !== "blocked") fail("CANDIDATE_NOT_PREPARED");
  return contract;
}

function resolveCurrentModel(
  catalog: GenerationContractCatalogPort,
  contract: GenerationContractV2,
  registry: GenerationContractRegistryV2
) {
  let model: ReturnType<GenerationContractCatalogPort["getModel"]>;
  try { model = catalog.getModel(WAN_I2V_MODEL_ID); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  const operation = model.operations.find((item) => item.id === OPERATION_ID);
  if (model.active !== true || model.id !== WAN_I2V_MODEL_ID || model.id !== contract.model_id ||
      model.ai_name !== contract.ai_name || model.upstream_id !== contract.model_type ||
      !operation || operation.output_modality !== "video" ||
      catalogVersionFor(model) !== registry.catalog_version || !sameSourceHashes(model.source_hashes, registry.source_hashes)) {
    fail("CATALOG_BINDING_MISMATCH");
  }
  return model;
}

function assertCandidateSourceBinding(contract: GenerationContractV2, registry: GenerationContractRegistryV2): void {
  const catalogBound = contract.provenance.references.some((reference) =>
    reference.kind === "public_catalog" && reference.sha256 !== undefined &&
    Object.values(registry.source_hashes).includes(reference.sha256)
  );
  const settingsBound = contract.provenance.settings_source_sha256 !== null &&
    contract.provenance.references.some((reference) =>
      (reference.kind === "frontend_static" || reference.kind === "official_contract") &&
      reference.sha256 === contract.provenance.settings_source_sha256
    );
  if (!catalogBound || !settingsBound) fail("CATALOG_BINDING_MISMATCH");
}

function assertOneImageWireShape(contract: GenerationContractV2): void {
  const fileUrls = contract.parameters.properties[REFERENCE_FIELD];
  const prompt = contract.wire.prompt_field;
  if (contract.operation_id !== OPERATION_ID || contract.modality !== "video" || contract.route !== "video" ||
      contract.wire.dispatch_action !== OPERATION_ID || contract.wire.input_kind !== "prompt_and_media" ||
      prompt === null || !contract.parameters.required.includes(REFERENCE_FIELD) ||
      contract.wire.media_reference_fields[REFERENCE_FIELD] !== "image" ||
      Object.keys(contract.wire.media_reference_fields).length !== 1 ||
      !fileUrls || fileUrls.type !== "array" || fileUrls.min_items !== 1 || fileUrls.max_items !== 1 ||
      fileUrls.default !== undefined || fileUrls.items.type !== "media_reference" ||
      fileUrls.items.modality !== "image" || fileUrls.items.source !== "uploaded_file_id" ||
      Object.keys(contract.wire.fixed_settings).length !== 0 ||
      contract.wire.settings_fields[REFERENCE_FIELD] !== undefined) {
    fail("CONTRACT_SHAPE_UNSUPPORTED");
  }
  const promptNode = contract.parameters.properties[prompt];
  if (!promptNode || promptNode.type !== "string" || !contract.parameters.required.includes(prompt)) {
    fail("CONTRACT_SHAPE_UNSUPPORTED");
  }
  for (const [key, node] of Object.entries(contract.parameters.properties)) {
    if (key === REFERENCE_FIELD) continue;
    if (node.type !== "string" && node.type !== "number" && node.type !== "integer" && node.type !== "boolean") {
      fail("CONTRACT_SHAPE_UNSUPPORTED");
    }
    if (!contract.parameters.required.includes(key) || "default" in node) fail("CONTRACT_SHAPE_UNSUPPORTED");
  }
  const expectedSettingsFields = Object.keys(contract.parameters.properties).filter((key) => key !== prompt && key !== REFERENCE_FIELD);
  if (Object.keys(contract.wire.settings_fields).length !== expectedSettingsFields.length ||
      expectedSettingsFields.some((key) => !Object.hasOwn(contract.wire.settings_fields, key))) {
    fail("CONTRACT_SHAPE_UNSUPPORTED");
  }
}

function snapshotClosedParameters(value: unknown, contract: GenerationContractV2): Record<string, unknown> {
  const allowed = Object.keys(contract.parameters.properties).filter((key) => key !== REFERENCE_FIELD);
  const parameters = readPlainDataRecord(value, allowed);
  if (Object.hasOwn(parameters, REFERENCE_FIELD) || Object.hasOwn(parameters, "reference_handle") ||
      Object.keys(parameters).length !== allowed.length || allowed.some((key) => !Object.hasOwn(parameters, key))) {
    fail("PARAMETERS_INVALID");
  }
  return parameters;
}

function ownerReferenceRegistryVersion(registry: GenerationContractRegistryV2): string {
  // The store's catalog binding is this exact registry pin, not a caller value.
  return `sha256-${registry.registry_sha256.slice("sha256:".length)}.json`;
}

function catalogVersionFor(model: ReturnType<GenerationContractCatalogPort["getModel"]>): string {
  return `${model.fetched_at}.${model.source_hashes.models.slice(7, 19)}`;
}

function sameSourceHashes(
  left: { readonly ai: string; readonly llm_models: string; readonly models: string },
  right: { readonly ai: string; readonly llm_models: string; readonly models: string }
): boolean {
  return left.ai === right.ai && left.llm_models === right.llm_models && left.models === right.models;
}

function readPlainDataRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
    fail("INVALID_REQUEST");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !("value" in descriptors[key]!)) fail("INVALID_REQUEST");
    result[key] = descriptors[key]!.value;
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function fail(code: OwnerReferencePrepareErrorCode): never {
  throw new OwnerReferencePrepareError(code);
}
