import { createHmac, timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";

export const OBSERVED_ESTIMATE_STATE = "OBSERVATION_ONLY" as const;
export const OBSERVED_ESTIMATE_REASON =
  "COST_CONTRACT_UNVERIFIED" as const;

const MINIMUM_HMAC_SECRET_BYTES = 32;
const MAXIMUM_CANONICAL_BYTES = 1_048_576;
const MAXIMUM_CANONICAL_DEPTH = 32;
const MAXIMUM_CANONICAL_NODES = 10_000;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAXIMUM_DECIMAL_TOTAL_LENGTH = 64;
const MAXIMUM_DECIMAL_INTEGER_DIGITS = 32;
const MAXIMUM_DECIMAL_FRACTION_DIGITS = 18;
const SAFE_PARAMETER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_PARAMETER_KEY_PATTERN =
  /(?:^|_)(?:url|uri|token|secret|password|authorization|cookie|api_key|private_key)(?:_|$)/iu;
const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype"
]);

export interface ObservedEstimatePrincipalRef {
  readonly tenant_id: string;
  readonly subject_id: string;
  readonly connection_id: string;
}

export interface ObservedGenerationRequestBindingInput {
  readonly model_id: string;
  readonly operation_id: string;
  readonly catalog_version: string;
  readonly schema_hash: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface CreateObservedGenerationEstimateInput
  extends ObservedGenerationRequestBindingInput {
  readonly principal: ObservedEstimatePrincipalRef;
  readonly cost: string | null;
  readonly discount_cost: string | null;
}

/**
 * Optional typed-codec contract. The future application service must pass a
 * server-derived principal and upstream-observed costs; this module is not
 * exported through the package index and is not connected to an MCP tool.
 */
export interface ObservedRequestBindingOptions {
  readonly allowed_parameter_keys?: readonly string[];
}

export interface ObservedGenerationRequestSnapshot
  extends ObservedGenerationRequestBindingInput {
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly parameter_keys: readonly string[];
}

/**
 * This object is evidence of an account-scoped cost observation, not an
 * authorization or an upstream quote. In particular, it can never start a
 * billable request.
 */
export interface ObservedGenerationEstimate {
  readonly estimate_id: string;
  readonly principal: ObservedEstimatePrincipalRef;
  readonly state: typeof OBSERVED_ESTIMATE_STATE;
  readonly start_eligible: false;
  readonly reason: typeof OBSERVED_ESTIMATE_REASON;
  readonly model_id: string;
  readonly operation_id: string;
  readonly catalog_version: string;
  readonly schema_hash: string;
  readonly parameter_keys: readonly string[];
  readonly request_binding: string;
  readonly cost: string | null;
  readonly discount_cost: string | null;
  /** The observed endpoint did not provide a verified cost unit contract. */
  readonly unit: null;
  /** The observed endpoint did not provide a verified quote expiry contract. */
  readonly expires_at: null;
  readonly observed_at: string;
  /** Local memory-retention policy only; never described as upstream TTL. */
  readonly local_retention_expires_at: string;
}

export type ObservedGenerationEstimateErrorCode =
  | "INVALID_HMAC_SECRET"
  | "INVALID_ESTIMATE_INPUT"
  | "INVALID_CANONICAL_VALUE"
  | "CANONICAL_VALUE_TOO_LARGE";

export class ObservedGenerationEstimateError extends Error {
  constructor(
    readonly code: ObservedGenerationEstimateErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ObservedGenerationEstimateError";
  }
}

export interface ObservedRequestBinding {
  readonly request_binding: string;
  readonly parameter_keys: readonly string[];
}

/**
 * Creates a keyed request binding without returning or retaining canonical
 * parameter values. Callers should discard their input after this function.
 */
export function createObservedRequestBinding(
  input: ObservedGenerationRequestBindingInput,
  secret: Uint8Array,
  options?: ObservedRequestBindingOptions
): ObservedRequestBinding {
  const key = validateHmacSecret(secret);
  const safe = snapshotObservedGenerationRequest(input, options);
  const context: CanonicalizationContext = {
    active: new WeakSet<object>(),
    nodes: 0,
    bytes: 0
  };
  try {
    const canonicalParameters = canonicalizeValue(
      safe.parameters,
      context,
      0
    );
    const canonicalPayload =
      `{"catalog_version":${JSON.stringify(safe.catalog_version)},` +
      `"model_id":${JSON.stringify(safe.model_id)},` +
      `"operation_id":${JSON.stringify(safe.operation_id)},` +
      `"parameters":${canonicalParameters},` +
      `"schema_hash":${JSON.stringify(safe.schema_hash)}}`;
    if (Buffer.byteLength(canonicalPayload, "utf8") > MAXIMUM_CANONICAL_BYTES) {
      throw canonicalTooLargeError();
    }

    const digest = createHmac("sha256", key)
      .update(canonicalPayload, "utf8")
      .digest("hex");
    return Object.freeze({
      request_binding: `hmac-sha256:${digest}`,
      parameter_keys: Object.freeze([...safe.parameter_keys])
    });
  } finally {
    key.fill(0);
  }
}

/**
 * Validates and snapshots a request before any asynchronous upstream read.
 * The returned graph is detached and deeply frozen, so a caller cannot change
 * cost-driving values while an account observation is in flight.
 */
export function snapshotObservedGenerationRequest(
  input: ObservedGenerationRequestBindingInput,
  options?: ObservedRequestBindingOptions
): ObservedGenerationRequestSnapshot {
  const safe = validateBindingInput(input);
  const allowedParameterKeys = validateAllowedParameterKeys(options);
  if (
    allowedParameterKeys &&
    safe.parameter_keys.some((keyName) => !allowedParameterKeys.has(keyName))
  ) {
    throw invalidInputError();
  }
  const context: CanonicalizationContext = {
    active: new WeakSet<object>(),
    nodes: 0,
    bytes: 0
  };
  const canonicalParameters = canonicalizeValue(safe.parameters, context, 0);
  const detachedParameters = JSON.parse(canonicalParameters) as Record<
    string,
    unknown
  >;
  return Object.freeze({
    model_id: safe.model_id,
    operation_id: safe.operation_id,
    catalog_version: safe.catalog_version,
    schema_hash: safe.schema_hash,
    parameters: deepFreezeCanonicalValue(detachedParameters),
    parameter_keys: Object.freeze([...safe.parameter_keys])
  });
}

export function observedRequestBindingMatches(
  expectedBinding: string,
  input: ObservedGenerationRequestBindingInput,
  secret: Uint8Array,
  options?: ObservedRequestBindingOptions
): boolean {
  const expected = decodeBinding(expectedBinding);
  const actual = decodeBinding(
    createObservedRequestBinding(input, secret, options).request_binding
  );
  return timingSafeEqual(expected, actual);
}

export function validateObservedEstimatePrincipal(
  principal: ObservedEstimatePrincipalRef
): ObservedEstimatePrincipalRef {
  const safe = readExactDataRecord(principal, [
    "tenant_id",
    "subject_id",
    "connection_id"
  ]);
  return Object.freeze({
    tenant_id: requireIdentity(safe.tenant_id, 256),
    subject_id: requireIdentity(safe.subject_id, 512),
    connection_id: requireSafeId(safe.connection_id)
  });
}

export function validateObservedEstimateMetadata(input: {
  cost: string | null;
  discount_cost: string | null;
}): Readonly<{
  cost: string | null;
  discount_cost: string | null;
}> {
  const safe = readExactDataRecord(input, ["cost", "discount_cost"]);
  return Object.freeze({
    cost: validateNullableDecimal(safe.cost),
    discount_cost: validateNullableDecimal(safe.discount_cost)
  });
}

export function validateObservedBindingInput(
  input: ObservedGenerationRequestBindingInput
): Readonly<{
  model_id: string;
  operation_id: string;
  catalog_version: string;
  schema_hash: string;
  parameters: Readonly<Record<string, unknown>>;
  parameter_keys: readonly string[];
}> {
  return validateBindingInput(input);
}

export function validateCreateObservedGenerationEstimateInput(
  input: CreateObservedGenerationEstimateInput
): Readonly<{
  principal: ObservedEstimatePrincipalRef;
  binding: Readonly<{
    model_id: string;
    operation_id: string;
    catalog_version: string;
    schema_hash: string;
    parameters: Readonly<Record<string, unknown>>;
    parameter_keys: readonly string[];
  }>;
  metadata: Readonly<{ cost: string | null; discount_cost: string | null }>;
}> {
  const safe = readExactDataRecord(input, [
    "principal",
    "model_id",
    "operation_id",
    "catalog_version",
    "schema_hash",
    "parameters",
    "cost",
    "discount_cost"
  ]);
  return Object.freeze({
    principal: validateObservedEstimatePrincipal(safe.principal as ObservedEstimatePrincipalRef),
    binding: validateBindingInput({
      model_id: safe.model_id as string,
      operation_id: safe.operation_id as string,
      catalog_version: safe.catalog_version as string,
      schema_hash: safe.schema_hash as string,
      parameters: safe.parameters as Readonly<Record<string, unknown>>
    }),
    metadata: validateObservedEstimateMetadata({
      cost: safe.cost as string | null,
      discount_cost: safe.discount_cost as string | null
    })
  });
}

export function validateObservedEstimateId(estimateId: string): string {
  if (!/^estimate_obs_[A-Za-z0-9_-]{20,120}$/.test(estimateId)) {
    throw invalidInputError();
  }
  return estimateId;
}

export function validateLocalRetentionExpiry(value: string): string {
  return requireTimestamp(value);
}

export function copyAndFreezeObservedEstimate(
  estimate: ObservedGenerationEstimate
): ObservedGenerationEstimate {
  return Object.freeze({
    ...estimate,
    principal: Object.freeze({ ...estimate.principal }),
    parameter_keys: Object.freeze([...estimate.parameter_keys])
  });
}

interface CanonicalizationContext {
  readonly active: WeakSet<object>;
  nodes: number;
  bytes: number;
}

function canonicalizeValue(
  value: unknown,
  context: CanonicalizationContext,
  depth: number
): string {
  context.nodes += 1;
  if (
    depth > MAXIMUM_CANONICAL_DEPTH ||
    context.nodes > MAXIMUM_CANONICAL_NODES
  ) {
    throw canonicalTooLargeError();
  }
  if (value === null) {
    addCanonicalBytes(context, 4);
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    const encoded = JSON.stringify(value);
    addCanonicalBytes(context, Buffer.byteLength(encoded, "utf8"));
    return encoded;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidCanonicalValueError();
    }
    const encoded = JSON.stringify(Object.is(value, -0) ? 0 : value);
    addCanonicalBytes(context, Buffer.byteLength(encoded, "utf8"));
    return encoded;
  }
  if (typeof value !== "object") {
    throw invalidCanonicalValueError();
  }
  if (isProxy(value)) {
    throw invalidCanonicalValueError();
  }
  if (context.active.has(value)) {
    throw invalidCanonicalValueError();
  }

  context.active.add(value);
  try {
    if (Array.isArray(value)) {
      return canonicalizeArray(value, context, depth);
    }
    return canonicalizeObject(value, context, depth);
  } finally {
    context.active.delete(value);
  }
}

function deepFreezeCanonicalValue<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeCanonicalValue(child);
    }
    Object.freeze(value);
  }
  return value;
}

function canonicalizeArray(
  value: unknown[],
  context: CanonicalizationContext,
  depth: number
): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw invalidCanonicalValueError();
  }
  if (value.length > MAXIMUM_CANONICAL_NODES) {
    throw canonicalTooLargeError();
  }
  addCanonicalBytes(context, 2 + Math.max(0, value.length - 1));
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw invalidCanonicalValueError();
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_, index) => String(index))
  ]);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => !expectedKeys.has(key as string))
  ) {
    throw invalidCanonicalValueError();
  }

  const parts: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidCanonicalValueError();
    }
    parts.push(canonicalizeValue(descriptor.value, context, depth + 1));
  }
  return `[${parts.join(",")}]`;
}

function canonicalizeObject(
  value: object,
  context: CanonicalizationContext,
  depth: number
): string {
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw invalidCanonicalValueError();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAXIMUM_CANONICAL_NODES) {
    throw canonicalTooLargeError();
  }
  if (keys.some((key) => typeof key === "symbol")) {
    throw invalidCanonicalValueError();
  }
  const stringKeys = (keys as string[]).sort(compareStrings);
  addCanonicalBytes(context, 2 + Math.max(0, stringKeys.length - 1));
  const parts = stringKeys.map((key) => {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw invalidCanonicalValueError();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidCanonicalValueError();
    }
    addCanonicalBytes(
      context,
      Buffer.byteLength(JSON.stringify(key), "utf8") + 1
    );
    return `${JSON.stringify(key)}:${canonicalizeValue(
      descriptor.value,
      context,
      depth + 1
    )}`;
  });
  return `{${parts.join(",")}}`;
}

function validateBindingInput(
  input: ObservedGenerationRequestBindingInput
): Readonly<{
  model_id: string;
  operation_id: string;
  catalog_version: string;
  schema_hash: string;
  parameters: Readonly<Record<string, unknown>>;
  parameter_keys: readonly string[];
}> {
  const safe = readExactDataRecord(input, [
    "model_id",
    "operation_id",
    "catalog_version",
    "schema_hash",
    "parameters"
  ]);
  const parameters = validateParameterRecord(safe.parameters);
  return Object.freeze({
    model_id: requireSafeId(safe.model_id),
    operation_id: requireSafeId(safe.operation_id),
    catalog_version: requireSafeId(safe.catalog_version),
    schema_hash: requireSchemaHash(safe.schema_hash),
    parameters,
    parameter_keys: Object.freeze(sortedParameterKeys(parameters))
  });
}

function sortedParameterKeys(
  parameters: Readonly<Record<string, unknown>>
): string[] {
  const keys = Reflect.ownKeys(parameters);
  if (keys.length > 128 || keys.some((key) => typeof key === "symbol")) {
    throw invalidCanonicalValueError();
  }
  return (keys as string[]).sort(compareStrings).map((key) => {
    if (
      !SAFE_PARAMETER_KEY_PATTERN.test(key) ||
      FORBIDDEN_PARAMETER_KEY_PATTERN.test(key)
    ) {
      throw invalidInputError();
    }
    return key;
  });
}

function validateHmacSecret(secret: Uint8Array): Buffer {
  if (!(secret instanceof Uint8Array) || secret.byteLength < MINIMUM_HMAC_SECRET_BYTES) {
    throw new ObservedGenerationEstimateError(
      "INVALID_HMAC_SECRET",
      "The request-binding secret must contain at least 32 bytes."
    );
  }
  return Buffer.from(secret);
}

function decodeBinding(binding: string): Buffer {
  if (!/^hmac-sha256:[a-f0-9]{64}$/.test(binding)) {
    throw invalidInputError();
  }
  return Buffer.from(binding.slice("hmac-sha256:".length), "hex");
}

function validateNullableDecimal(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length > MAXIMUM_DECIMAL_TOTAL_LENGTH ||
    !DECIMAL_PATTERN.test(value)
  ) {
    throw invalidInputError();
  }
  const [integerPart = "", fractionPart] = value.split(".");
  if (
    integerPart.length > MAXIMUM_DECIMAL_INTEGER_DIGITS ||
    (fractionPart?.length ?? 0) > MAXIMUM_DECIMAL_FRACTION_DIGITS
  ) {
    throw invalidInputError();
  }
  return value;
}

function validateParameterRecord(value: unknown): Readonly<Record<string, unknown>> {
  const parameters = readDataRecord(value);
  if (Array.isArray(parameters)) {
    throw invalidInputError();
  }
  sortedParameterKeys(parameters);
  return parameters;
}

function validateAllowedParameterKeys(
  options: ObservedRequestBindingOptions | undefined
): ReadonlySet<string> | null {
  if (options === undefined) {
    return null;
  }
  const safeOptions = readExactDataRecord(options, ["allowed_parameter_keys"]);
  const allowed = safeOptions.allowed_parameter_keys;
  if (!Array.isArray(allowed) || isProxy(allowed) || Object.getPrototypeOf(allowed) !== Array.prototype) {
    throw invalidInputError();
  }
  const ownKeys = Reflect.ownKeys(allowed);
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length: allowed.length }, (_, index) => String(index))
  ]);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some((key) => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw invalidInputError();
  }
  const keys = new Set<string>();
  for (let index = 0; index < allowed.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(allowed, String(index));
    if (!descriptor || !("value" in descriptor)) {
      throw invalidInputError();
    }
    const key = descriptor.value;
    if (
      typeof key !== "string" ||
      !SAFE_PARAMETER_KEY_PATTERN.test(key) ||
      FORBIDDEN_PARAMETER_KEY_PATTERN.test(key)
    ) {
      throw invalidInputError();
    }
    if (keys.has(key)) {
      throw invalidInputError();
    }
    keys.add(key);
  }
  return keys;
}

function readExactDataRecord(
  value: unknown,
  allowedKeys: readonly string[]
): Readonly<Record<string, unknown>> {
  const record = readDataRecord(value);
  const ownKeys = Reflect.ownKeys(record);
  if (
    ownKeys.length !== allowedKeys.length ||
    ownKeys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))
  ) {
    throw invalidInputError();
  }
  const copy: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalidInputError();
    }
    copy[key] = descriptor.value;
  }
  return Object.freeze(copy);
}

function readDataRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidInputError();
  }
  return value as Record<string, unknown>;
}

function requireSchemaHash(value: unknown): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw invalidInputError();
  }
  return value;
}

function requireSafeId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw invalidInputError();
  }
  return value;
}

function requireIdentity(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalidInputError();
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 35 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw invalidInputError();
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addCanonicalBytes(
  context: CanonicalizationContext,
  additionalBytes: number
): void {
  context.bytes += additionalBytes;
  if (context.bytes > MAXIMUM_CANONICAL_BYTES) {
    throw canonicalTooLargeError();
  }
}

function invalidInputError(): ObservedGenerationEstimateError {
  return new ObservedGenerationEstimateError(
    "INVALID_ESTIMATE_INPUT",
    "The observed generation estimate input is invalid."
  );
}

function invalidCanonicalValueError(): ObservedGenerationEstimateError {
  return new ObservedGenerationEstimateError(
    "INVALID_CANONICAL_VALUE",
    "Generation parameters contain a value that cannot be canonically bound."
  );
}

function canonicalTooLargeError(): ObservedGenerationEstimateError {
  return new ObservedGenerationEstimateError(
    "CANONICAL_VALUE_TOO_LARGE",
    "Generation parameters exceed the canonical binding limit."
  );
}
