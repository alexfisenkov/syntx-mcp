import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";
import { generationPrincipalKey, sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationContractRegistryV2, GenerationContractV2JsonValue } from "../domain/generation-contract-v2.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  isOwnerImageReferencePreparedCandidateForPrincipal,
  getOwnerImageReferenceCandidateStoreBinding,
  type OwnerImageReferencePreparedCandidate
} from "./owner-image-reference-request-preparer.js";

const TTL_MS = 15 * 60_000;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const CANDIDATE_VARIANT_ID = "banana21-image-1k-minimal-square-reference-candidate";
const CANDIDATE_BRAND_DESCRIPTION = "OwnerImageReferencePreparedCandidate";
const PERMIT_BRAND_DESCRIPTION = "OwnerImageReferenceOneShotPermit";

const permitBrand: unique symbol = Symbol(PERMIT_BRAND_DESCRIPTION);
const permitStates = new WeakMap<object, PermitState>();

export interface CreateOwnerImageReferenceOneShotPermitInput {
  readonly candidate: OwnerImageReferencePreparedCandidate;
  readonly registry: GenerationContractRegistryV2;
  readonly catalog: GenerationContractCatalogPort;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  /** Injectable clock seam for deterministic local tests. Runtime callers omit it. */
  readonly now?: () => number;
}

export interface OwnerImageReferenceOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "authorized";
  readonly dispatch_allowed: false;
  readonly candidate_schema_hash: string;
  readonly expires_at: number;
}

export interface ConsumeOwnerImageReferenceOneShotPermitInput {
  readonly permit: OwnerImageReferenceOneShotPermit;
  readonly candidate: OwnerImageReferencePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerImageReferenceOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly candidate_schema_hash: string;
}

export type OwnerImageReferenceOneShotPolicyErrorCode =
  | "INVALID_REQUEST"
  | "CANDIDATE_UNBOUND"
  | "PERMIT_INVALID"
  | "PERMIT_EXPIRED"
  | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH"
  | "CANDIDATE_MISMATCH"
  | "CLOCK_INVALID";

export class OwnerImageReferenceOneShotPolicyError extends Error {
  constructor(readonly code: OwnerImageReferenceOneShotPolicyErrorCode) {
    super("The owner image-reference one-shot policy could not be satisfied.");
    this.name = "OwnerImageReferenceOneShotPolicyError";
  }
}

interface PermitState {
  readonly candidate: OwnerImageReferencePreparedCandidate;
  readonly candidateSchemaHash: string;
  readonly payloadFingerprint: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly principalKey: string;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly now: () => number;
  lastObservedAt: number;
  consumed: boolean;
  expired: boolean;
}

interface CandidatePayload {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly confidence: "PREPARED_REFERENCE_CANDIDATE";
  readonly backend_acceptance: "unproven";
  readonly registry_sha256: string;
  readonly catalog_version: string;
  readonly model_id: "banana-2.1";
  readonly model_type: "banana-2.1";
  readonly operation_id: "generate-image";
  readonly route: "design";
  readonly base_variant_id: "banana21-image-1k-minimal-square";
  readonly base_schema_hash: string;
  readonly candidate_variant_id: typeof CANDIDATE_VARIANT_ID;
  readonly candidate_schema_hash: string;
  readonly request: OwnerImageReferencePreparedCandidate["request"];
}

/** Create an in-memory, owner/attempt/candidate-bound permit with a fixed 15-minute TTL. */
export function createOwnerImageReferenceOneShotPermit(
  input: CreateOwnerImageReferenceOneShotPermitInput | unknown
): OwnerImageReferenceOneShotPermit {
  const fields = readExactRecord(input, ["candidate", "registry", "catalog", "principal", "attemptId", "now"],
    ["candidate", "registry", "catalog", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      !fields.catalog || typeof fields.catalog !== "object" || types.isProxy(fields.catalog) ||
      (fields.now !== undefined && typeof fields.now !== "function")) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  const now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
  const issuedAt = readClock(now);
  const registry = fields.registry as GenerationContractRegistryV2;
  let candidateSchemaHash: string;
  let payloadFingerprint: string;
  try {
    candidateSchemaHash = validateCandidate(
      fields.candidate, registry, fields.catalog as GenerationContractCatalogPort, principal, fields.attemptId
    );
    payloadFingerprint = fingerprintCandidate(fields.candidate as OwnerImageReferencePreparedCandidate);
  } catch {
    fail("CANDIDATE_UNBOUND");
  }
  const expiresAt = issuedAt + TTL_MS;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CLOCK_INVALID");

  const permit = Object.freeze({
    [permitBrand]: true as const,
    status: "authorized" as const,
    dispatch_allowed: false as const,
    candidate_schema_hash: candidateSchemaHash,
    expires_at: expiresAt
  });
  permitStates.set(permit, {
    candidate: fields.candidate as OwnerImageReferencePreparedCandidate,
    candidateSchemaHash,
    payloadFingerprint,
    principal,
    principalKey: generationPrincipalKey(principal),
    attemptId: fields.attemptId,
    expiresAt,
    now,
    lastObservedAt: issuedAt,
    consumed: false,
    expired: false
  });
  return permit;
}

/** Synchronously consumes a genuine permit before any future external dispatch can begin. */
export function consumeOwnerImageReferenceOneShotPermit(
  input: ConsumeOwnerImageReferenceOneShotPermitInput | unknown
): OwnerImageReferenceOneShotPermitReceipt {
  const fields = readExactRecord(input, ["permit", "candidate", "principal", "attemptId"],
    ["permit", "candidate", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId)) fail("INVALID_REQUEST");
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || !hasPermitBrand(permit) || !Object.isFrozen(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.expired) fail("PERMIT_EXPIRED");
  const now = readClock(state.now);
  if (now < state.lastObservedAt) {
    state.expired = true;
    fail("CLOCK_INVALID");
  }
  state.lastObservedAt = now;
  if (now >= state.expiresAt) {
    state.expired = true;
    fail("PERMIT_EXPIRED");
  }
  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  if (fields.attemptId !== state.attemptId || generationPrincipalKey(principal) !== state.principalKey ||
      !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate || !isCandidatePayloadUnchanged(fields.candidate, state)) {
    fail("CANDIDATE_MISMATCH");
  }

  // No await occurs between the consumed check and this state change.
  state.consumed = true;
  return Object.freeze({
    status: "consumed",
    dispatch_allowed: false,
    candidate_schema_hash: state.candidateSchemaHash
  });
}

function validateCandidate(
  value: unknown,
  registry: GenerationContractRegistryV2,
  catalog: GenerationContractCatalogPort,
  principal: Readonly<GenerationPrincipalRef>,
  attemptId: string
): string {
  if (!isOwnerImageReferencePreparedCandidateForPrincipal(value, principal, attemptId)) fail("CANDIDATE_UNBOUND");
  const candidate = readCandidate(value);
  const binding = getOwnerImageReferenceCandidateStoreBinding(registry, catalog);
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false ||
      candidate.confidence !== "PREPARED_REFERENCE_CANDIDATE" || candidate.backend_acceptance !== "unproven" ||
      candidate.registry_sha256 !== registry.registry_sha256 || candidate.catalog_version !== registry.catalog_version ||
      candidate.model_id !== "banana-2.1" || candidate.model_type !== "banana-2.1" ||
      candidate.operation_id !== "generate-image" || candidate.route !== "design" ||
      candidate.base_variant_id !== "banana21-image-1k-minimal-square" ||
      candidate.base_schema_hash !== "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d" ||
      candidate.candidate_variant_id !== CANDIDATE_VARIANT_ID || candidate.candidate_schema_hash !== binding.schema_hash ||
      binding.model_id !== candidate.model_id || binding.model_type !== candidate.model_type ||
      binding.operation_id !== candidate.operation_id || binding.modality !== "image" ||
      binding.variant_id !== candidate.candidate_variant_id || typeof candidate.request.prompt !== "string" ||
      candidate.request.prompt.trim().length === 0 || !hasExactSettings(candidate.request.settings)) {
    fail("CANDIDATE_UNBOUND");
  }
  return binding.schema_hash;
}

function readCandidate(value: unknown): CandidatePayload {
  const expected = [
    "status", "dispatch_allowed", "confidence", "backend_acceptance", "registry_sha256", "catalog_version",
    "model_id", "model_type", "operation_id", "route", "base_variant_id", "base_schema_hash",
    "candidate_variant_id", "candidate_schema_hash", "request"
  ];
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value)) fail("CANDIDATE_UNBOUND");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const stringKeys = keys.filter((key): key is string => typeof key === "string");
  const symbols = keys.filter((key): key is symbol => typeof key === "symbol");
  if (stringKeys.length !== expected.length || expected.some((key) => !Object.hasOwn(descriptors, key)) ||
      stringKeys.some((key) => !expected.includes(key)) || symbols.length !== 1 ||
      symbols[0]!.description !== CANDIDATE_BRAND_DESCRIPTION ||
      keys.some((key) => !("value" in Object.getOwnPropertyDescriptor(value, key)!)) ||
      Object.getOwnPropertyDescriptor(value, symbols[0]!)?.value !== true) fail("CANDIDATE_UNBOUND");
  const request = descriptors.request!.value;
  if (!request || typeof request !== "object" || types.isProxy(request) || !Object.isFrozen(request)) fail("CANDIDATE_UNBOUND");
  const requestFields = readExactRecord(request, ["prompt", "settings"], ["prompt", "settings"]);
  if (typeof requestFields.prompt !== "string" || !requestFields.settings || typeof requestFields.settings !== "object" ||
      types.isProxy(requestFields.settings) || !Object.isFrozen(requestFields.settings)) fail("CANDIDATE_UNBOUND");
  const settings = requestFields.settings as Record<string, unknown>;
  const fileUrls = settings.file_urls;
  if (!Array.isArray(fileUrls) || types.isProxy(fileUrls) || !Object.isFrozen(fileUrls) || fileUrls.length !== 1 ||
      !fileUrls[0] || typeof fileUrls[0] !== "object" || types.isProxy(fileUrls[0]) || !Object.isFrozen(fileUrls[0])) fail("CANDIDATE_UNBOUND");
  const file = readExactRecord(fileUrls[0], ["type", "url"], ["type", "url"]);
  if (file.type !== "image" || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url)) fail("CANDIDATE_UNBOUND");
  return value as OwnerImageReferencePreparedCandidate as CandidatePayload;
}

function hasExactSettings(value: Readonly<Record<string, GenerationContractV2JsonValue>>): boolean {
  const settings = readExactRecord(value, ["aspect_ratio", "image_size", "n", "thinking_level", "model_type", "file_urls"],
    ["aspect_ratio", "image_size", "n", "thinking_level", "model_type", "file_urls"]);
  const fileUrls = settings.file_urls;
  return settings.aspect_ratio === "1:1" && settings.image_size === "1K" && settings.n === 1 &&
    settings.thinking_level === "minimal" && settings.model_type === "banana-2.1" &&
    Array.isArray(fileUrls) && fileUrls.length === 1;
}

function fingerprintCandidate(candidate: CandidatePayload): string {
  return schemaHash({
    status: candidate.status,
    dispatch_allowed: candidate.dispatch_allowed,
    confidence: candidate.confidence,
    backend_acceptance: candidate.backend_acceptance,
    registry_sha256: candidate.registry_sha256,
    catalog_version: candidate.catalog_version,
    model_id: candidate.model_id,
    model_type: candidate.model_type,
    operation_id: candidate.operation_id,
    route: candidate.route,
    base_variant_id: candidate.base_variant_id,
    base_schema_hash: candidate.base_schema_hash,
    candidate_variant_id: candidate.candidate_variant_id,
    candidate_schema_hash: candidate.candidate_schema_hash,
    request: candidate.request
  });
}

function isCandidatePayloadUnchanged(value: unknown, state: PermitState): boolean {
  try {
    return fingerprintCandidate(readCandidate(value)) === state.payloadFingerprint;
  } catch {
    return false;
  }
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try {
    principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef);
  } catch {
    fail("INVALID_REQUEST");
  }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function readClock(now: () => number): number {
  let value: number;
  try { value = now(); }
  catch { fail("CLOCK_INVALID"); }
  if (!Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}

function hasPermitBrand(value: object): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, permitBrand);
  if (descriptor && "value" in descriptor) return descriptor.value === true;
  const symbols = Object.getOwnPropertySymbols(value);
  return symbols.length === 1 && symbols[0]!.description === PERMIT_BRAND_DESCRIPTION &&
    Object.getOwnPropertyDescriptor(value, symbols[0]!)?.value === true;
}

function readExactRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function fail(code: OwnerImageReferenceOneShotPolicyErrorCode): never {
  throw new OwnerImageReferenceOneShotPolicyError(code);
}
