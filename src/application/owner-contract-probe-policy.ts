import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import { GenerationContractExecutorV2, type GenerationContractV2Request, type PreparedSyntxMediaRequestV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import { serializeGenerationContractRegistryV2, type GenerationContractRegistryV2, type GenerationContractV2 } from "../domain/generation-contract-v2.js";
import type { ModelAccessResult } from "./model-access.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import { createReviewedContractPreflight } from "./reviewed-contract-preflight.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import type { PreparedSyntxMediaRequest } from "../adapter/syntx/upstream-adapter.js";
import type { OwnerContractMediaContractContext } from "./owner-contract-media.js";
import { OwnerGenerationPreflightError } from "./owner-generation-preflight.js";
import { loadGenerationContractRegistryV2 } from "../catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { validateGenerationParametersV2 } from "./generation-contract-validator-v2.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REGISTRY_VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_PERMIT_TTL_MS = 15 * 60 * 1000;
const MAX_OPERATOR_PROMPT_BYTES = 512;
const POLICY_BRAND: unique symbol = Symbol("owner-reviewed-contract-probe");
const CALL_POLICY_BRAND: unique symbol = Symbol("owner-reviewed-contract-call");
const IDEOGRAM_LANDSCAPE_REGISTRY_VERSION = "sha256-a4d42d4b977836face88a757a5632cc6096997b37e3749b7a31a80cb24cdfa2e.json";
const IDEOGRAM_LANDSCAPE_MODEL_ID = "ideogram";
const IDEOGRAM_LANDSCAPE_VARIANT_ID = "ideogram-image-generate-aspect-ratio-source-reviewed";
const IDEOGRAM_LANDSCAPE_SCHEMA_HASH = "sha256:31e1603ba0668f57860b1d688b7c74bd3b8c54da117180a779f67f4a6363320c";
const IDEOGRAM_LANDSCAPE_PROMPT = "A quiet rolling green landscape at golden hour, distant blue hills beneath a wide open sky, simple watercolor illustration, no text.";

export interface OwnerReviewedContractProbePolicy {
  readonly [POLICY_BRAND]: true;
}

/** A caller-bound, one-dispatch permit for one reviewed V2 request. */
export interface OwnerReviewedContractCallPolicy {
  readonly [CALL_POLICY_BRAND]: true;
}

export type OwnerReviewedContractMediaPolicy = OwnerReviewedContractProbePolicy | OwnerReviewedContractCallPolicy;

export interface OwnerReviewedContractProbeBinding {
  readonly attempt_id: string;
  readonly registry_version: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly operation_id: "generate-image" | "generate-video";
  readonly variant_id: string;
  readonly schema_hash: string;
  readonly modality: "image" | "video";
  readonly ai_name: string;
  readonly model_type: string;
  readonly status: "reviewed";
  readonly mime_types: readonly string[];
}

export interface CreateOwnerReviewedContractProbePolicyInput {
  readonly registryVersion: string;
  readonly attemptId: string;
  readonly modelId: string;
  readonly operationId: "generate-image" | "generate-video";
  readonly variantId: string;
  readonly schemaHash: string;
  /** Fixed operator-owned tuple and benign prompt; never an MCP argument. */
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly expiresInMs?: number;
}

export type OwnerContractProbePolicyErrorCode =
  | "PROBE_POLICY_INVALID"
  | "PROBE_CONTRACT_NOT_REVIEWED"
  | "PROBE_PREPARATION_FAILED"
  | "PROBE_AUTHORIZATION_UNAVAILABLE"
  | "PROBE_MODEL_ACCESS_UNAVAILABLE";

export type OwnerContractProbePolicyDiagnosticCode =
  | "MODEL_ACCESS_READ_FAILED"
  | "MODEL_ACCESS_RESPONSE_INVALID"
  | "MODEL_ACCESS_DENIED"
  | "MODEL_ACCESS_PARAMETER_KEYS_MISMATCH"
  | "MODEL_ACCESS_BINDING_MISMATCH"
  | "PREPARED_CALL_MISMATCH";

export class OwnerContractProbePolicyError extends Error {
  constructor(readonly code: OwnerContractProbePolicyErrorCode, readonly diagnostic_code?: OwnerContractProbePolicyDiagnosticCode) {
    super("The reviewed owner contract probe is unavailable.");
    this.name = "OwnerContractProbePolicyError";
  }
}

interface PolicyState {
  readonly kind: "fixed_probe" | "per_call";
  readonly binding: OwnerReviewedContractProbeBinding;
  readonly contract: OwnerContractMediaContractContext;
  readonly executor: GenerationContractExecutorV2;
  readonly request: GenerationContractV2Request;
  readonly expectedPrepared: PreparedSyntxMediaRequestV2;
  readonly costParameters?: Readonly<Record<string, SyntxCostParameter>>;
  readonly expiresAt: number;
  consumed: boolean;
}

const states = new WeakMap<object, PolicyState>();

/** Loads one immutable registry and the current selected catalog; no request value selects a model. */
export function createOwnerReviewedContractProbePolicy(
  input: CreateOwnerReviewedContractProbePolicyInput
): OwnerReviewedContractProbePolicy {
  if (!validFactoryInput(input)) throw policyError("PROBE_POLICY_INVALID");
  const expiresInMs = input.expiresInMs ?? MAX_PERMIT_TTL_MS;
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs < 1 || expiresInMs > MAX_PERMIT_TTL_MS) {
    throw policyError("PROBE_POLICY_INVALID");
  }

  let registry;
  let catalog;
  try {
    registry = loadGenerationContractRegistryV2(input.registryVersion);
    catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  } catch {
    throw policyError("PROBE_POLICY_INVALID");
  }
  const executor = new GenerationContractExecutorV2(registry, catalog);
  const contract = executor.getContract(input.modelId, input.operationId, input.variantId);
  if (input.registryVersion === IDEOGRAM_LANDSCAPE_REGISTRY_VERSION &&
      !isExactIdeogramLandscapeInput(input, contract)) throw policyError("PROBE_CONTRACT_NOT_REVIEWED");
  if (contract === null || contract.status !== "reviewed" || contract.schema_hash !== input.schemaHash ||
      contract.variant_id !== input.variantId || contract.operation_id !== input.operationId ||
      contract.modality !== (input.operationId === "generate-image" ? "image" : "video") ||
      !isBenignFixedInput(contract, input.parameters)) {
    throw policyError("PROBE_CONTRACT_NOT_REVIEWED");
  }

  const request: GenerationContractV2Request = Object.freeze({
    model_id: input.modelId,
    operation_id: input.operationId,
    catalog_version: registry.catalog_version,
    variant_id: input.variantId,
    parameters: deepFreeze(structuredClone(input.parameters))
  });
  let expectedPrepared: PreparedSyntxMediaRequestV2;
  try { expectedPrepared = executor.prepare(request); }
  catch { throw policyError("PROBE_PREPARATION_FAILED"); }

  const binding: OwnerReviewedContractProbeBinding = Object.freeze({
    attempt_id: input.attemptId,
    registry_version: input.registryVersion,
    catalog_version: registry.catalog_version,
    model_id: contract.model_id,
    operation_id: input.operationId,
    variant_id: contract.variant_id,
    schema_hash: contract.schema_hash,
    modality: contract.modality,
    ai_name: contract.ai_name,
    model_type: contract.model_type,
    status: "reviewed",
    mime_types: Object.freeze([...contract.output.mime_types])
  });
  const context: OwnerContractMediaContractContext = Object.freeze({
    model_id: binding.model_id,
    operation_id: binding.operation_id,
    modality: binding.modality,
    ai_name: binding.ai_name,
    model_type: binding.model_type,
    variant_id: binding.variant_id,
    schema_hash: binding.schema_hash,
    status: "reviewed",
    mime_types: binding.mime_types,
    registry_version: binding.registry_version,
    catalog_version: binding.catalog_version
  });
  const policy = Object.freeze({}) as OwnerReviewedContractProbePolicy;
  states.set(policy, {
    kind: "fixed_probe",
    binding,
    contract: context,
    executor,
    request,
    expectedPrepared,
    expiresAt: Date.now() + expiresInMs,
    consumed: false
  });
  return policy;
}

export interface CreateOwnerReviewedContractCallPolicyInput {
  readonly registry: GenerationContractRegistryV2;
  readonly registryVersion: string;
  readonly executor: GenerationContractExecutorV2;
  readonly attemptId: string;
  readonly modelId: string;
  readonly operationId: "generate-image" | "generate-video";
  readonly variantId: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Existing callers may supply a source-owned exact projection. */
  readonly costParameters?: Readonly<Record<string, SyntxCostParameter>>;
  /** Alternatively, project these trusted fields from the reviewed contract input. */
  readonly costParameterFields?: readonly string[];
  readonly expiresInMs?: number;
}

/** Mint a per-call reviewed capability; it never changes the registry contract status. */
export function createOwnerReviewedContractCallPolicy(
  input: CreateOwnerReviewedContractCallPolicyInput
): OwnerReviewedContractCallPolicy {
  if (!validCallFactoryInput(input)) throw policyError("PROBE_POLICY_INVALID");
  const expiresInMs = input.expiresInMs ?? MAX_PERMIT_TTL_MS;
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs < 1 || expiresInMs > MAX_PERMIT_TTL_MS) {
    throw policyError("PROBE_POLICY_INVALID");
  }
  const contract = input.executor.getContract(input.modelId, input.operationId, input.variantId);
  const registryContract = input.registry.contracts.find((candidate) => candidate.model_id === input.modelId &&
    candidate.operation_id === input.operationId && candidate.variant_id === input.variantId);
  if (contract === null || registryContract === undefined || contract.status !== "reviewed" ||
      registryVersionFor(input.registry) !== input.registryVersion ||
      !isDeepStrictEqual(contract, registryContract) || contract.schema_hash === undefined ||
      contract.operation_id !== input.operationId || contract.variant_id !== input.variantId ||
      (contract.modality !== "image" && contract.modality !== "video") ||
      contract.provenance.settings_source_sha256 === null ||
      containsMediaReferenceSchema(contract.parameters) || containsExternalReference(input.parameters)) {
    throw policyError("PROBE_CONTRACT_NOT_REVIEWED");
  }

  let validatedParameters: Readonly<Record<string, unknown>>;
  try { validatedParameters = validateGenerationParametersV2(contract, input.parameters); }
  catch { throw policyError("PROBE_CONTRACT_NOT_REVIEWED"); }
  const costParameters = projectCostParameters(contract, input.parameters, validatedParameters,
    input.costParameters, input.costParameterFields);
  if (costParameters === null || (contract.cost_parameter_bindings === undefined &&
      !isExactCostParameterProjection(input.parameters, costParameters))) {
    throw policyError("PROBE_CONTRACT_NOT_REVIEWED");
  }

  const request: GenerationContractV2Request = Object.freeze({
    model_id: input.modelId,
    operation_id: input.operationId,
    catalog_version: input.registry.catalog_version,
    variant_id: input.variantId,
    parameters: deepFreeze(structuredClone(input.parameters))
  });
  let expectedPrepared: PreparedSyntxMediaRequestV2;
  try { expectedPrepared = input.executor.prepare(request); }
  catch { throw policyError("PROBE_PREPARATION_FAILED"); }

  const binding: OwnerReviewedContractProbeBinding = Object.freeze({
    attempt_id: input.attemptId,
    registry_version: input.registryVersion,
    catalog_version: input.registry.catalog_version,
    model_id: contract.model_id,
    operation_id: input.operationId,
    variant_id: contract.variant_id,
    schema_hash: contract.schema_hash,
    modality: contract.modality,
    ai_name: contract.ai_name,
    model_type: contract.model_type,
    status: "reviewed",
    mime_types: Object.freeze([...contract.output.mime_types])
  });
  const context: OwnerContractMediaContractContext = Object.freeze({
    model_id: binding.model_id,
    operation_id: binding.operation_id,
    modality: binding.modality,
    ai_name: binding.ai_name,
    model_type: binding.model_type,
    variant_id: binding.variant_id,
    schema_hash: binding.schema_hash,
    status: "reviewed",
    mime_types: binding.mime_types,
    registry_version: binding.registry_version,
    catalog_version: binding.catalog_version
  });
  const policy = Object.freeze({}) as OwnerReviewedContractCallPolicy;
  states.set(policy, {
    kind: "per_call", binding, contract: context, executor: input.executor, request, expectedPrepared,
    costParameters,
    expiresAt: Date.now() + expiresInMs, consumed: false
  });
  return policy;
}

function isExactIdeogramLandscapeInput(
  input: CreateOwnerReviewedContractProbePolicyInput,
  contract: ReturnType<GenerationContractExecutorV2["getContract"]>
): boolean {
  return input.modelId === IDEOGRAM_LANDSCAPE_MODEL_ID && input.operationId === "generate-image" &&
    input.variantId === IDEOGRAM_LANDSCAPE_VARIANT_ID && input.schemaHash === IDEOGRAM_LANDSCAPE_SCHEMA_HASH &&
    contract?.status === "reviewed" && contract.model_id === IDEOGRAM_LANDSCAPE_MODEL_ID &&
    contract.operation_id === "generate-image" && contract.variant_id === IDEOGRAM_LANDSCAPE_VARIANT_ID &&
    contract.schema_hash === IDEOGRAM_LANDSCAPE_SCHEMA_HASH &&
    input.parameters.prompt === IDEOGRAM_LANDSCAPE_PROMPT && input.parameters.aspect_ratio === "16:9" &&
    Object.keys(input.parameters).length === 2;
}

export function getOwnerReviewedContractProbeBinding(policy: OwnerReviewedContractProbePolicy): OwnerReviewedContractProbeBinding | null {
  const state = readState(policy);
  return state === null || state.kind !== "fixed_probe" ? null : state.binding;
}

export function getOwnerReviewedContractProbeContract(policy: OwnerReviewedContractProbePolicy): OwnerContractMediaContractContext | null {
  const state = readState(policy);
  return state === null || state.kind !== "fixed_probe" ? null : state.contract;
}

/** Pure v2 prepare, then fresh exact-attempt subscription and account model-access reads. */
export async function prepareOwnerReviewedContractProbe(
  policy: OwnerReviewedContractProbePolicy,
  attemptId: string,
  resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>,
  resolveModelAccess: (attemptId: string, modelId: string, signal?: AbortSignal) => Promise<ModelAccessResult>,
  signal?: AbortSignal
): Promise<PreparedSyntxMediaRequestV2> {
  const state = readAvailableState(policy, attemptId);
  if (state === null || state.kind !== "fixed_probe") throw policyError("PROBE_AUTHORIZATION_UNAVAILABLE");
  const preflight = createReviewedContractPreflight({ executor: state.executor, resolveSubscription });
  let prepared: PreparedSyntxMediaRequest;
  try { prepared = await preflight(attemptId, state.request, signal); }
  catch (error) {
    if (error instanceof OwnerGenerationPreflightError) throw error;
    throw policyError("PROBE_AUTHORIZATION_UNAVAILABLE");
  }
  let access: ModelAccessResult;
  try { access = await resolveModelAccess(attemptId, state.binding.model_id, signal); }
  catch { throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE"); }
  if (!validModelAccess(access, state.binding) || !samePreparedRequest(prepared, state.expectedPrepared)) {
    throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE");
  }
  return prepared as PreparedSyntxMediaRequestV2;
}

/** Fresh subscription and model-access reads for one dynamic request. No amount or billing cap is inferred. */
export async function prepareOwnerReviewedContractCall(
  policy: OwnerReviewedContractCallPolicy,
  attemptId: string,
  resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>,
  resolveModelAccess: (attemptId: string, modelId: string, costParameters: Readonly<Record<string, SyntxCostParameter>>, signal?: AbortSignal) => Promise<ModelAccessResult>,
  signal?: AbortSignal
): Promise<PreparedSyntxMediaRequestV2> {
  const state = readAvailableState(policy, attemptId);
  if (state === null || state.kind !== "per_call") throw policyError("PROBE_AUTHORIZATION_UNAVAILABLE");
  return prepareCallState(state, attemptId, resolveSubscription, resolveModelAccess, signal);
}

/** Repeat the same fresh account checks after chat creation and immediately before POST. */
export async function revalidateOwnerReviewedContractCall(
  policy: OwnerReviewedContractCallPolicy,
  attemptId: string,
  resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>,
  resolveModelAccess: (attemptId: string, modelId: string, costParameters: Readonly<Record<string, SyntxCostParameter>>, signal?: AbortSignal) => Promise<ModelAccessResult>,
  signal?: AbortSignal
): Promise<void> {
  const state = readState(policy);
  if (state === null || state.kind !== "per_call" || state.binding.attempt_id !== attemptId ||
      Date.now() >= state.expiresAt) throw policyError("PROBE_AUTHORIZATION_UNAVAILABLE");
  await prepareCallState(state, attemptId, resolveSubscription, resolveModelAccess, signal);
}

/** Atomic one-shot claim; must run before the service creates a chat. */
export function consumeOwnerReviewedContractProbePolicy(
  policy: OwnerReviewedContractMediaPolicy,
  attemptId: string,
  contract: OwnerContractMediaContractContext,
  prepared: PreparedSyntxMediaRequest
): boolean {
  const state = readAvailableState(policy, attemptId);
  if (state === null || !matchesBinding(state.binding, attemptId, contract) ||
      !samePreparedRequest(prepared, state.expectedPrepared)) return false;
  state.consumed = true;
  return true;
}

export function ownerReviewedContractProbePolicyAllowsDispatch(
  policy: OwnerReviewedContractMediaPolicy | undefined,
  attemptId: string,
  contract: OwnerContractMediaContractContext,
  prepared: PreparedSyntxMediaRequest
): boolean {
  const state = readAvailableState(policy, attemptId);
  return state !== null && matchesBinding(state.binding, attemptId, contract) &&
    samePreparedRequest(prepared, state.expectedPrepared);
}

/** Store and GET-only recovery validation; an expired consumed permit cannot authorize another dispatch. */
export function ownerReviewedContractProbePolicyBindsRecovery(
  policy: OwnerReviewedContractMediaPolicy | undefined,
  attemptId: string,
  contract: OwnerContractMediaContractContext
): boolean {
  const state = readState(policy);
  return state !== null && state.consumed && matchesBinding(state.binding, attemptId, contract);
}

function readAvailableState(policy: unknown, attemptId: string): PolicyState | null {
  const state = readState(policy);
  return state !== null && state.binding.attempt_id === attemptId && !state.consumed && Date.now() < state.expiresAt ? state : null;
}

async function prepareCallState(
  state: PolicyState,
  attemptId: string,
  resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>,
  resolveModelAccess: (attemptId: string, modelId: string, costParameters: Readonly<Record<string, SyntxCostParameter>>, signal?: AbortSignal) => Promise<ModelAccessResult>,
  signal?: AbortSignal
): Promise<PreparedSyntxMediaRequestV2> {
  if (state.binding.attempt_id !== attemptId) throw policyError("PROBE_AUTHORIZATION_UNAVAILABLE");
  let prepared: PreparedSyntxMediaRequest;
  try {
    prepared = await createReviewedContractPreflight({ executor: state.executor, resolveSubscription })(attemptId, state.request, signal);
  } catch (error) {
    if (error instanceof OwnerGenerationPreflightError) throw error;
    throw policyError("PROBE_AUTHORIZATION_UNAVAILABLE");
  }
  let access: ModelAccessResult;
  const costParameters = state.costParameters ?? Object.freeze({});
  try { access = await resolveModelAccess(attemptId, state.binding.model_id, costParameters, signal); }
  catch { throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE", "MODEL_ACCESS_READ_FAILED"); }
  if (!isPlainDataRecord(access)) throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE", "MODEL_ACCESS_RESPONSE_INVALID");
  if (access.access !== true) throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE", "MODEL_ACCESS_DENIED");
  if (!Array.isArray(access.parameter_keys) ||
      !sameStrings(access.parameter_keys, Object.keys(costParameters).sort())) {
    throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE", "MODEL_ACCESS_PARAMETER_KEYS_MISMATCH");
  }
  if (!validModelAccess(access as ModelAccessResult, state.binding)) {
    throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE", "MODEL_ACCESS_BINDING_MISMATCH");
  }
  if (!samePreparedRequest(prepared, state.expectedPrepared)) {
    throw policyError("PROBE_MODEL_ACCESS_UNAVAILABLE", "PREPARED_CALL_MISMATCH");
  }
  return state.expectedPrepared;
}

function readState(policy: unknown): PolicyState | null {
  return policy !== null && typeof policy === "object" ? states.get(policy) ?? null : null;
}

function matchesBinding(binding: OwnerReviewedContractProbeBinding, attemptId: string, contract: OwnerContractMediaContractContext): boolean {
  return binding.attempt_id === attemptId && contract.status === "reviewed" &&
    binding.model_id === contract.model_id && binding.operation_id === contract.operation_id &&
    binding.variant_id === contract.variant_id && binding.schema_hash === contract.schema_hash &&
    binding.modality === contract.modality && binding.ai_name === contract.ai_name &&
    binding.model_type === contract.model_type && binding.mime_types.length === contract.mime_types.length &&
    binding.mime_types.every((mime, index) => mime === contract.mime_types[index]) &&
    binding.registry_version === contract.registry_version && binding.catalog_version === contract.catalog_version;
}

function validFactoryInput(input: CreateOwnerReviewedContractProbePolicyInput): boolean {
  return isPlainDataRecord(input) && ATTEMPT_PATTERN.test(input.attemptId) &&
    REGISTRY_VERSION_PATTERN.test(input.registryVersion) && HASH_PATTERN.test(input.schemaHash) &&
    typeof input.modelId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(input.modelId) &&
    (input.operationId === "generate-image" || input.operationId === "generate-video") &&
    typeof input.variantId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(input.variantId) &&
    isPlainDataRecord(input.parameters);
}

function validCallFactoryInput(input: CreateOwnerReviewedContractCallPolicyInput): boolean {
  if (!isPlainDataRecord(input) || !ATTEMPT_PATTERN.test(input.attemptId) ||
      !REGISTRY_VERSION_PATTERN.test(input.registryVersion) || !(input.executor instanceof GenerationContractExecutorV2) ||
      !input.registry || typeof input.registry !== "object" || input.registry.schema_version !== "2.0.0" ||
      typeof input.modelId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(input.modelId) ||
      input.operationId !== "generate-image" && input.operationId !== "generate-video" ||
      typeof input.variantId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(input.variantId) ||
      !isPlainDataRecord(input.parameters) ||
      (input.costParameters !== undefined && !isPlainDataRecord(input.costParameters)) ||
      (input.costParameterFields !== undefined && (!Array.isArray(input.costParameterFields) || input.costParameterFields.length < 1 ||
        input.costParameterFields.length > 8 || input.costParameterFields.some((field) => typeof field !== "string"))) ||
      (input.costParameters === undefined) === (input.costParameterFields === undefined)) return false;
  const allowed = new Set(["registry", "registryVersion", "executor", "attemptId", "modelId", "operationId", "variantId", "parameters", "costParameters", "costParameterFields", "expiresInMs"]);
  return Reflect.ownKeys(input).every((key) => typeof key === "string" && allowed.has(key));
}

function projectCostParameters(
  contract: GenerationContractV2,
  callerParameters: Readonly<Record<string, unknown>>,
  validatedParameters: Readonly<Record<string, unknown>>,
  supplied: Readonly<Record<string, SyntxCostParameter>> | undefined,
  fields: readonly string[] | undefined
): Readonly<Record<string, SyntxCostParameter>> | null {
  const bindings = contract.cost_parameter_bindings;
  if (bindings !== undefined) {
    const expected: Record<string, SyntxCostParameter> = Object.create(null) as Record<string, SyntxCostParameter>;
    for (const [costKey, binding] of Object.entries(bindings)) {
      const value = binding.kind === "literal" ? binding.value : validatedParameters[binding.parameter];
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" ||
          typeof value === "number" && !Number.isFinite(value)) return null;
      expected[costKey] = value;
    }
    const expectedKeys = Object.keys(expected).sort();
    if (supplied !== undefined && !isExactCostParameterMap(supplied, expected)) return null;
    if (fields !== undefined && (new Set(fields).size !== fields.length ||
        !sameStrings([...fields].sort(), expectedKeys))) return null;
    return Object.freeze(expected);
  }

  const contractParameters = contract.parameters;
  if (supplied !== undefined) return Object.freeze({ ...supplied });
  if (fields === undefined || !isPlainDataRecord(contractParameters) ||
      !isPlainDataRecord(contractParameters.properties)) return null;
  const keys = [...fields];
  if (keys.length < 1 || keys.length > 8 || new Set(keys).size !== keys.length ||
      keys.some((key) => !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(key) || key === "ai_name" || key === "model_type")) return null;
  const projected: Record<string, SyntxCostParameter> = Object.create(null) as Record<string, SyntxCostParameter>;
  for (const key of keys) {
    const property = contractParameters.properties[key];
    const value = callerParameters[key];
    if (!isPlainDataRecord(property) || !Object.hasOwn(callerParameters, key) ||
        (property.type !== "string" && property.type !== "integer" && property.type !== "number" && property.type !== "boolean") ||
        (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") ||
        (typeof value === "number" && !Number.isFinite(value)) ||
        (Array.isArray(property.enum) && !property.enum.some((candidate) => Object.is(candidate, value)))) return null;
    projected[key] = value;
  }
  return Object.freeze(projected);
}

function isExactCostParameterProjection(
  parameters: Readonly<Record<string, unknown>>,
  costParameters: Readonly<Record<string, SyntxCostParameter>>
): boolean {
  const keys = Object.keys(costParameters);
  return keys.length <= 8 && keys.every((key) => key !== "ai_name" && key !== "model_type" &&
    Object.hasOwn(parameters, key) && Object.is(parameters[key], costParameters[key]));
}

function isExactCostParameterMap(
  supplied: Readonly<Record<string, SyntxCostParameter>>,
  expected: Readonly<Record<string, SyntxCostParameter>>
): boolean {
  const suppliedKeys = Object.keys(supplied).sort();
  const expectedKeys = Object.keys(expected).sort();
  return sameStrings(suppliedKeys, expectedKeys) && expectedKeys.every((key) =>
    Object.hasOwn(supplied, key) && Object.is(supplied[key], expected[key]));
}

function registryVersionFor(registry: GenerationContractRegistryV2): string {
  return `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
}

function isBenignFixedInput(contract: { readonly wire: { readonly prompt_field: string | null }; readonly parameters: unknown }, parameters: Readonly<Record<string, unknown>>): boolean {
  const promptField = contract.wire.prompt_field;
  const prompt = promptField === null ? undefined : parameters[promptField];
  if (typeof prompt !== "string" || prompt.trim().length === 0 || Buffer.byteLength(prompt, "utf8") > MAX_OPERATOR_PROMPT_BYTES ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)) return false;
  return !containsMediaReferenceSchema(contract.parameters) && !containsExternalReference(parameters);
}

function containsMediaReferenceSchema(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsMediaReferenceSchema);
  if (!isPlainDataRecord(value)) return false;
  return value.type === "media_reference" || Object.values(value).some(containsMediaReferenceSchema);
}

function containsExternalReference(value: unknown): boolean {
  if (typeof value === "string") return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
  if (Array.isArray(value)) return value.some(containsExternalReference);
  if (!isPlainDataRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase();
    return (normalized === "url" || normalized.endsWith("_url") || normalized.endsWith("_urls")) &&
      child !== null && child !== "" && !(Array.isArray(child) && child.length === 0) || containsExternalReference(child);
  });
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(value, key)?.enumerable === true && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}

function validModelAccess(access: ModelAccessResult, binding: OwnerReviewedContractProbeBinding): boolean {
  return isPlainDataRecord(access) && access.catalog_kind === "OFFICIAL_PUBLIC_API_SNAPSHOT" &&
    access.account_read_live === true && access.parameters_redacted === true && access.access === true &&
    access.model_id === binding.model_id && access.ai_name === binding.ai_name &&
    access.model_type === binding.model_type && access.catalog_version === binding.catalog_version;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function samePreparedRequest(left: PreparedSyntxMediaRequest, right: PreparedSyntxMediaRequestV2): boolean {
  const metadata = (left as PreparedSyntxMediaRequestV2).contract_metadata;
  return left.ai_name === right.ai_name && left.modality === right.modality &&
    left.schema_hash === right.schema_hash && left.prompt === right.prompt &&
    isDeepStrictEqual(left.settings, right.settings) && metadata?.schema_version === "2.0.0" &&
    metadata.operation_id === right.contract_metadata.operation_id &&
    metadata.variant_id === right.contract_metadata.variant_id;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function policyError(code: OwnerContractProbePolicyErrorCode, diagnosticCode?: OwnerContractProbePolicyDiagnosticCode): OwnerContractProbePolicyError {
  return new OwnerContractProbePolicyError(code, diagnosticCode);
}
