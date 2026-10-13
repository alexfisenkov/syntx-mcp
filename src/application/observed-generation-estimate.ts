import { isProxy } from "node:util/types";
import {
  OBSERVED_ESTIMATE_REASON,
  OBSERVED_ESTIMATE_STATE,
  snapshotObservedGenerationRequest,
  validateLocalRetentionExpiry,
  validateObservedEstimateMetadata,
  validateObservedEstimateId,
  validateObservedEstimatePrincipal,
  type CreateObservedGenerationEstimateInput,
  type ObservedEstimatePrincipalRef,
  type ObservedGenerationEstimate
} from "../domain/observed-generation-estimate.js";

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_PARAMETER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const FORBIDDEN_PARAMETER_KEY_PATTERN =
  /(?:^|_)(?:url|uri|token|secret|password|authorization|cookie|api_key|private_key)(?:_|$)/iu;
const FORBIDDEN_COST_PARAMETER_KEY_PATTERN =
  /prompt|text|auth|token|secret|password|cookie|api.?key|private.?key|url|uri|file|result|hint/iu;
const REQUEST_BINDING_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/u;
const ENUM_VALUE_PATTERN = /^[^\u0000-\u001f\u007f]{1,128}$/u;

export type ObservedCostParameter = string | number | boolean;

export type ObservedCostParameterSpec =
  | Readonly<{
      key: string;
      kind: "boolean";
    }>
  | Readonly<{
      key: string;
      kind: "integer" | "number";
      minimum: number;
      maximum: number;
    }>
  | Readonly<{
      key: string;
      kind: "enum";
      values: readonly string[];
    }>;

/** Tool-callable input. Identity, cost, timestamps and schema data are absent. */
export interface ObserveGenerationRequest {
  readonly model_id: string;
  readonly operation_id: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ObservedGenerationCodecDescriptor {
  readonly model_id: string;
  readonly operation_id: string;
  readonly catalog_version: string;
  readonly schema_hash: string;
  readonly allowed_parameter_keys: readonly string[];
  /** Reviewed, required cost inputs. Defaults must be normalized upstream. */
  readonly cost_parameter_specs: readonly ObservedCostParameterSpec[];
  readonly cost_ai_name: string;
  readonly cost_model_type: string;
}

export interface ObservedGenerationCodecRegistry {
  resolve(
    modelId: string,
    operationId: string
  ): ObservedGenerationCodecDescriptor | null;
}

export interface AccountCostObservationRequest {
  readonly ai_name: string;
  readonly model_type: string;
  readonly cost_parameters: Readonly<Record<string, ObservedCostParameter>>;
}

export interface AccountCostObservation {
  readonly cost: string | null;
  readonly discount_cost: string | null;
}

export interface AccountCostObserver {
  observeAccountCost(
    request: AccountCostObservationRequest,
    signal?: AbortSignal
  ): Promise<AccountCostObservation>;
}

export interface ObservedGenerationEstimateWriter {
  /** The callback must succeed before the candidate becomes visible. */
  createValidated(
    input: CreateObservedGenerationEstimateInput,
    validateBeforeCommit: (candidate: ObservedGenerationEstimate) => void
  ): void;
}

export type PublicObservedGenerationEstimate = Omit<
  ObservedGenerationEstimate,
  "principal"
>;

export type ObservedGenerationEstimateServiceErrorCode =
  | "INVALID_OBSERVATION_REQUEST"
  | "OBSERVED_CODEC_NOT_FOUND"
  | "INVALID_OBSERVED_CODEC"
  | "INVALID_COST_PARAMETER_VALUE"
  | "MISSING_COST_PARAMETER_VALUE"
  | "CODEC_REGISTRY_UNAVAILABLE"
  | "COST_OBSERVATION_FAILED"
  | "OBSERVATION_STORE_FAILED";

export class ObservedGenerationEstimateServiceError extends Error {
  constructor(
    readonly code: ObservedGenerationEstimateServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ObservedGenerationEstimateServiceError";
  }
}

/**
 * Request-scoped application service. Its principal is supplied by the server
 * composition root, never by tool input. The account reader, not the caller,
 * supplies cost evidence and time remains owned by the store clock.
 */
export class ObservedGenerationEstimateService {
  readonly #principal: ObservedEstimatePrincipalRef;
  readonly #codecs: ObservedGenerationCodecRegistry;
  readonly #costObserver: AccountCostObserver;
  readonly #writer: ObservedGenerationEstimateWriter;

  constructor(options: {
    principal: ObservedEstimatePrincipalRef;
    codecs: ObservedGenerationCodecRegistry;
    costObserver: AccountCostObserver;
    writer: ObservedGenerationEstimateWriter;
  }) {
    const safe = readExactDataRecord(options, [
      "principal",
      "codecs",
      "costObserver",
      "writer"
    ]);
    this.#principal = validateObservedEstimatePrincipal(
      safe.principal as ObservedEstimatePrincipalRef
    );
    this.#codecs = requireMethod<ObservedGenerationCodecRegistry>(
      safe.codecs,
      "resolve"
    );
    this.#costObserver = requireMethod<AccountCostObserver>(
      safe.costObserver,
      "observeAccountCost"
    );
    this.#writer = requireMethod<ObservedGenerationEstimateWriter>(
      safe.writer,
      "createValidated"
    );
  }

  async observe(
    input: ObserveGenerationRequest,
    signal?: AbortSignal
  ): Promise<PublicObservedGenerationEstimate> {
    const raw = readExactDataRecord(input, [
      "model_id",
      "operation_id",
      "parameters"
    ]);
    const modelId = requireSafeId(raw.model_id);
    const operationId = requireSafeId(raw.operation_id);
    let codecCandidate: ObservedGenerationCodecDescriptor | null;
    try {
      codecCandidate = this.#codecs.resolve(modelId, operationId);
    } catch {
      throw dependencyError(
        "CODEC_REGISTRY_UNAVAILABLE",
        "The observation codec registry is unavailable."
      );
    }
    const codec = validateCodec(codecCandidate, modelId, operationId);
    const snapshot = snapshotObservedGenerationRequest(
      {
        model_id: codec.model_id,
        operation_id: codec.operation_id,
        catalog_version: codec.catalog_version,
        schema_hash: codec.schema_hash,
        parameters: raw.parameters as Readonly<Record<string, unknown>>
      },
      { allowed_parameter_keys: codec.allowed_parameter_keys }
    );
    const costParameters = selectCostParameters(
      snapshot.parameters,
      codec.cost_parameter_specs
    );
    let observed: Readonly<{ cost: string | null; discount_cost: string | null }>;
    try {
      observed = validateObservedEstimateMetadata(
        await this.#costObserver.observeAccountCost(
          Object.freeze({
            ai_name: codec.cost_ai_name,
            model_type: codec.cost_model_type,
            cost_parameters: costParameters
          }),
          signal
        )
      );
    } catch {
      throw dependencyError(
        "COST_OBSERVATION_FAILED",
        "The account cost observation could not be completed."
      );
    }
    let stored: ObservedGenerationEstimate | undefined;
    let validationCalls = 0;
    try {
      this.#writer.createValidated(
        {
          principal: this.#principal,
          model_id: snapshot.model_id,
          operation_id: snapshot.operation_id,
          catalog_version: snapshot.catalog_version,
          schema_hash: snapshot.schema_hash,
          parameters: snapshot.parameters,
          cost: observed.cost,
          discount_cost: observed.discount_cost
        },
        (candidate) => {
          validationCalls += 1;
          if (validationCalls !== 1) throw invalidRequest();
          stored = validateStoredObservation(candidate, {
            principal: this.#principal,
            snapshot,
            cost: observed.cost,
            discount_cost: observed.discount_cost
          });
        }
      );
      if (validationCalls !== 1 || stored === undefined) throw invalidRequest();
    } catch {
      throw dependencyError(
        "OBSERVATION_STORE_FAILED",
        "The observation evidence could not be stored safely."
      );
    }
    return publicEstimate(stored);
  }
}

function validateCodec(
  value: ObservedGenerationCodecDescriptor | null,
  expectedModelId: string,
  expectedOperationId: string
): ObservedGenerationCodecDescriptor {
  if (value === null) {
    throw new ObservedGenerationEstimateServiceError(
      "OBSERVED_CODEC_NOT_FOUND",
      "No reviewed observation codec exists for this model operation."
    );
  }
  let raw: Readonly<Record<string, unknown>>;
  try {
    raw = readExactDataRecord(value, [
      "model_id",
      "operation_id",
      "catalog_version",
      "schema_hash",
      "allowed_parameter_keys",
      "cost_parameter_specs",
      "cost_ai_name",
      "cost_model_type"
    ]);
    const modelId = requireSafeId(raw.model_id);
    const operationId = requireSafeId(raw.operation_id);
    const catalogVersion = requireSafeId(raw.catalog_version);
    const schemaHash = requireHash(raw.schema_hash);
    const allowedParameterKeys = requireParameterKeyArray(
      raw.allowed_parameter_keys
    );
    const costParameterSpecs = requireCostParameterSpecs(
      raw.cost_parameter_specs,
      allowedParameterKeys
    );
    if (
      modelId !== expectedModelId ||
      operationId !== expectedOperationId
    ) {
      throw invalidCodec();
    }
    return Object.freeze({
      model_id: modelId,
      operation_id: operationId,
      catalog_version: catalogVersion,
      schema_hash: schemaHash,
      allowed_parameter_keys: allowedParameterKeys,
      cost_parameter_specs: costParameterSpecs,
      cost_ai_name: requireSafeId(raw.cost_ai_name),
      cost_model_type: requireSafeId(raw.cost_model_type)
    });
  } catch (error) {
    if (
      error instanceof ObservedGenerationEstimateServiceError &&
      error.code === "INVALID_OBSERVED_CODEC"
    ) {
      throw error;
    }
    throw invalidCodec();
  }
}

function selectCostParameters(
  parameters: Readonly<Record<string, unknown>>,
  specs: readonly ObservedCostParameterSpec[]
): Readonly<Record<string, ObservedCostParameter>> {
  const selected: Record<string, ObservedCostParameter> = {};
  for (const spec of specs) {
    if (!Object.hasOwn(parameters, spec.key)) {
      throw new ObservedGenerationEstimateServiceError(
        "MISSING_COST_PARAMETER_VALUE",
        "A reviewed cost-driving parameter is missing."
      );
    }
    const value = parameters[spec.key];
    if (!matchesCostParameterSpec(value, spec)) {
      throw new ObservedGenerationEstimateServiceError(
        "INVALID_COST_PARAMETER_VALUE",
        "A cost-driving parameter has an unsupported value."
      );
    }
    selected[spec.key] = value;
  }
  return Object.freeze(selected);
}

function matchesCostParameterSpec(
  value: unknown,
  spec: ObservedCostParameterSpec
): value is ObservedCostParameter {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= spec.minimum &&
        value <= spec.maximum
      );
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= spec.minimum &&
        value <= spec.maximum
      );
    case "enum":
      return typeof value === "string" && spec.values.includes(value);
  }
}

function publicEstimate(
  estimate: ObservedGenerationEstimate
): PublicObservedGenerationEstimate {
  return Object.freeze({
    estimate_id: estimate.estimate_id,
    state: estimate.state,
    start_eligible: estimate.start_eligible,
    reason: estimate.reason,
    model_id: estimate.model_id,
    operation_id: estimate.operation_id,
    catalog_version: estimate.catalog_version,
    schema_hash: estimate.schema_hash,
    parameter_keys: Object.freeze([...estimate.parameter_keys]),
    request_binding: estimate.request_binding,
    cost: estimate.cost,
    discount_cost: estimate.discount_cost,
    unit: estimate.unit,
    expires_at: estimate.expires_at,
    observed_at: estimate.observed_at,
    local_retention_expires_at: estimate.local_retention_expires_at
  });
}

function validateStoredObservation(
  value: ObservedGenerationEstimate,
  expected: Readonly<{
    principal: ObservedEstimatePrincipalRef;
    snapshot: Readonly<{
      model_id: string;
      operation_id: string;
      catalog_version: string;
      schema_hash: string;
      parameter_keys: readonly string[];
    }>;
    cost: string | null;
    discount_cost: string | null;
  }>
): ObservedGenerationEstimate {
  const raw = readExactDataRecord(value, [
    "estimate_id",
    "principal",
    "state",
    "start_eligible",
    "reason",
    "model_id",
    "operation_id",
    "catalog_version",
    "schema_hash",
    "parameter_keys",
    "request_binding",
    "cost",
    "discount_cost",
    "unit",
    "expires_at",
    "observed_at",
    "local_retention_expires_at"
  ]);
  const principal = validateObservedEstimatePrincipal(
    raw.principal as ObservedEstimatePrincipalRef
  );
  const parameterKeys = requireParameterKeyArray(raw.parameter_keys);
  const metadata = validateObservedEstimateMetadata({
    cost: raw.cost as string | null,
    discount_cost: raw.discount_cost as string | null
  });
  const observedAt = requireTimestamp(raw.observed_at);
  const localRetentionExpiresAt = validateLocalRetentionExpiry(
    raw.local_retention_expires_at as string
  );
  if (
    principal.tenant_id !== expected.principal.tenant_id ||
    principal.subject_id !== expected.principal.subject_id ||
    principal.connection_id !== expected.principal.connection_id ||
    raw.state !== OBSERVED_ESTIMATE_STATE ||
    raw.start_eligible !== false ||
    raw.reason !== OBSERVED_ESTIMATE_REASON ||
    raw.model_id !== expected.snapshot.model_id ||
    raw.operation_id !== expected.snapshot.operation_id ||
    raw.catalog_version !== expected.snapshot.catalog_version ||
    raw.schema_hash !== expected.snapshot.schema_hash ||
    parameterKeys.length !== expected.snapshot.parameter_keys.length ||
    parameterKeys.some(
      (key, index) => key !== expected.snapshot.parameter_keys[index]
    ) ||
    typeof raw.request_binding !== "string" ||
    !REQUEST_BINDING_PATTERN.test(raw.request_binding) ||
    metadata.cost !== expected.cost ||
    metadata.discount_cost !== expected.discount_cost ||
    raw.unit !== null ||
    raw.expires_at !== null ||
    Date.parse(localRetentionExpiresAt) <= Date.parse(observedAt)
  ) {
    throw invalidRequest();
  }
  return Object.freeze({
    estimate_id: validateObservedEstimateId(raw.estimate_id as string),
    principal,
    state: OBSERVED_ESTIMATE_STATE,
    start_eligible: false,
    reason: OBSERVED_ESTIMATE_REASON,
    model_id: expected.snapshot.model_id,
    operation_id: expected.snapshot.operation_id,
    catalog_version: expected.snapshot.catalog_version,
    schema_hash: expected.snapshot.schema_hash,
    parameter_keys: parameterKeys,
    request_binding: raw.request_binding,
    cost: metadata.cost,
    discount_cost: metadata.discount_cost,
    unit: null,
    expires_at: null,
    observed_at: observedAt,
    local_retention_expires_at: localRetentionExpiresAt
  });
}

function readExactDataRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidRequest();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  ) {
    throw invalidRequest();
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidRequest();
    }
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

function requireMethod<T>(value: unknown, method: keyof T): T {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    isProxy(value) ||
    !hasDataFunction(value, method)
  ) {
    throw invalidRequest();
  }
  return value as T;
}

function hasDataFunction(value: object, method: PropertyKey): boolean {
  let cursor: object | null = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, method);
    if (descriptor) {
      return "value" in descriptor && typeof descriptor.value === "function";
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return false;
}

function requireSafeId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw invalidRequest();
  }
  return value;
}

function requireHash(value: unknown): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw invalidCodec();
  }
  return value;
}

function requireParameterKeyArray(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 128
  ) {
    throw invalidCodec();
  }
  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index))
  ]);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw invalidCodec();
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw invalidCodec();
    const key = descriptor.value;
    if (
      typeof key !== "string" ||
      !SAFE_PARAMETER_KEY_PATTERN.test(key) ||
      FORBIDDEN_PARAMETER_KEY_PATTERN.test(key) ||
      seen.has(key)
    ) {
      throw invalidCodec();
    }
    seen.add(key);
    result.push(key);
  }
  return Object.freeze(result);
}

function requireCostParameterSpecs(
  value: unknown,
  allowedParameterKeys: readonly string[]
): readonly ObservedCostParameterSpec[] {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 32
  ) {
    throw invalidCodec();
  }
  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index))
  ]);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw invalidCodec();
  }

  const result: ObservedCostParameterSpec[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw invalidCodec();
    const spec = requireCostParameterSpec(descriptor.value);
    if (
      !allowedParameterKeys.includes(spec.key) ||
      FORBIDDEN_COST_PARAMETER_KEY_PATTERN.test(spec.key) ||
      seen.has(spec.key)
    ) {
      throw invalidCodec();
    }
    seen.add(spec.key);
    result.push(spec);
  }
  return Object.freeze(result);
}

function requireCostParameterSpec(value: unknown): ObservedCostParameterSpec {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidCodec();
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (!kindDescriptor || !("value" in kindDescriptor)) throw invalidCodec();
  const kind = kindDescriptor.value;
  if (kind === "boolean") {
    const raw = readExactDataRecord(value, ["key", "kind"]);
    return Object.freeze({ key: requireCostKey(raw.key), kind });
  }
  if (kind === "integer" || kind === "number") {
    const raw = readExactDataRecord(value, [
      "key",
      "kind",
      "minimum",
      "maximum"
    ]);
    const minimum = requireCostBoundary(raw.minimum, kind === "integer");
    const maximum = requireCostBoundary(raw.maximum, kind === "integer");
    if (minimum > maximum) throw invalidCodec();
    return Object.freeze({
      key: requireCostKey(raw.key),
      kind,
      minimum,
      maximum
    });
  }
  if (kind === "enum") {
    const raw = readExactDataRecord(value, ["key", "kind", "values"]);
    return Object.freeze({
      key: requireCostKey(raw.key),
      kind,
      values: requireEnumValues(raw.values)
    });
  }
  throw invalidCodec();
}

function requireCostKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    !SAFE_PARAMETER_KEY_PATTERN.test(value) ||
    FORBIDDEN_PARAMETER_KEY_PATTERN.test(value)
  ) {
    throw invalidCodec();
  }
  return value;
}

function requireCostBoundary(value: unknown, integer: boolean): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1_000_000_000 ||
    (integer && !Number.isInteger(value))
  ) {
    throw invalidCodec();
  }
  return value;
}

function requireEnumValues(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > 128
  ) {
    throw invalidCodec();
  }
  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index))
  ]);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw invalidCodec();
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw invalidCodec();
    const item = descriptor.value;
    if (
      typeof item !== "string" ||
      !ENUM_VALUE_PATTERN.test(item) ||
      seen.has(item)
    ) {
      throw invalidCodec();
    }
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function requireTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw invalidRequest();
  }
  return value;
}

function invalidRequest(): ObservedGenerationEstimateServiceError {
  return new ObservedGenerationEstimateServiceError(
    "INVALID_OBSERVATION_REQUEST",
    "The observation request or server context is invalid."
  );
}

function invalidCodec(): ObservedGenerationEstimateServiceError {
  return new ObservedGenerationEstimateServiceError(
    "INVALID_OBSERVED_CODEC",
    "The reviewed observation codec is invalid."
  );
}

function dependencyError(
  code:
    | "CODEC_REGISTRY_UNAVAILABLE"
    | "COST_OBSERVATION_FAILED"
    | "OBSERVATION_STORE_FAILED",
  message: string
): ObservedGenerationEstimateServiceError {
  return new ObservedGenerationEstimateServiceError(code, message);
}
