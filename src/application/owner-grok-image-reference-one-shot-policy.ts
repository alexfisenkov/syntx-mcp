import { types } from "node:util";
import { generationPrincipalKey, sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type { OwnerGrokImageReferenceProfileId, OwnerGrokImageReferenceProfileSet } from "../catalog/owner-grok-image-reference-profiles.js";
import {
  getOwnerGrokImageReferenceCandidateBinding,
  type OwnerGrokImageReferencePreparedCandidate
} from "./owner-grok-image-reference-request-preparer.js";

const TTL_MS = 15 * 60_000;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const permitBrand: unique symbol = Symbol("OwnerGrokImageReferenceOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();

export interface CreateOwnerGrokImageReferenceOneShotPermitInput {
  readonly candidate: OwnerGrokImageReferencePreparedCandidate;
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly now?: () => number;
}

export interface OwnerGrokImageReferenceOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "authorized";
  readonly dispatch_allowed: false;
  readonly profile_set_sha256: string;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly variant_id: string;
  readonly request_fingerprint: string;
  readonly reference_order_sha256: string;
  readonly expires_at: number;
}

export interface ConsumeOwnerGrokImageReferenceOneShotPermitInput {
  readonly permit: OwnerGrokImageReferenceOneShotPermit;
  readonly candidate: OwnerGrokImageReferencePreparedCandidate;
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerGrokImageReferenceOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly profile_set_sha256: string;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly request_fingerprint: string;
  readonly reference_order_sha256: string;
}

export type OwnerGrokImageReferenceOneShotPolicyErrorCode =
  | "INVALID_REQUEST"
  | "CANDIDATE_UNBOUND"
  | "PERMIT_INVALID"
  | "PERMIT_EXPIRED"
  | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH"
  | "PERMIT_PROFILE_MISMATCH"
  | "PERMIT_CANDIDATE_MISMATCH"
  | "CLOCK_INVALID";

export class OwnerGrokImageReferenceOneShotPolicyError extends Error {
  constructor(readonly code: OwnerGrokImageReferenceOneShotPolicyErrorCode) {
    super("The owner Grok image-reference one-shot policy could not be satisfied.");
    this.name = "OwnerGrokImageReferenceOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerGrokImageReferenceOneShotPermit;
  readonly candidate: OwnerGrokImageReferencePreparedCandidate;
  readonly profileSet: OwnerGrokImageReferenceProfileSet;
  readonly profileId: OwnerGrokImageReferenceProfileId;
  readonly profileSetSha256: string;
  readonly profileSchemaHash: string;
  readonly catalogVersion: string;
  readonly modelId: string;
  readonly variantId: string;
  readonly requestFingerprint: string;
  readonly referenceOrderSha256: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly principalKey: string;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly now: () => number;
  lastObservedAt: number;
  consumed: boolean;
  expired: boolean;
}

/** Mint a private, synchronous one-shot permit. It does not authorize dispatch. */
export function createOwnerGrokImageReferenceOneShotPermit(
  input: CreateOwnerGrokImageReferenceOneShotPermitInput | unknown
): OwnerGrokImageReferenceOneShotPermit {
  const fields = readExactRecord(input, ["candidate", "profile_set", "profile_id", "principal", "attemptId", "now"],
    ["candidate", "profile_set", "profile_id", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.profile_id !== "string" || (fields.now !== undefined && typeof fields.now !== "function")) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  const now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
  const issuedAt = readClock(now);
  const candidateBinding = getOwnerGrokImageReferenceCandidateBinding(
    fields.candidate, fields.profile_set, fields.profile_id, principal, fields.attemptId
  );
  if (!candidateBinding) fail("CANDIDATE_UNBOUND");
  const profileSet = fields.profile_set as OwnerGrokImageReferenceProfileSet;
  const profileId = fields.profile_id as OwnerGrokImageReferenceProfileId;
  const expiresAt = issuedAt + TTL_MS;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CLOCK_INVALID");
  const permit = Object.freeze({
    [permitBrand]: true as const,
    status: "authorized" as const,
    dispatch_allowed: false as const,
    profile_set_sha256: candidateBinding.profile_set_sha256,
    profile_id: candidateBinding.profile_id,
    profile_schema_hash: candidateBinding.profile_schema_hash,
    catalog_version: candidateBinding.catalog_version,
    model_id: candidateBinding.model_id,
    variant_id: candidateBinding.variant_id,
    request_fingerprint: candidateBinding.request_fingerprint,
    reference_order_sha256: candidateBinding.reference_order_sha256,
    expires_at: expiresAt
  });
  permitStates.set(permit, {
    permit,
    candidate: fields.candidate as OwnerGrokImageReferencePreparedCandidate,
    profileSet,
    profileId,
    profileSetSha256: candidateBinding.profile_set_sha256,
    profileSchemaHash: candidateBinding.profile_schema_hash,
    catalogVersion: candidateBinding.catalog_version,
    modelId: candidateBinding.model_id,
    variantId: candidateBinding.variant_id,
    requestFingerprint: candidateBinding.request_fingerprint,
    referenceOrderSha256: candidateBinding.reference_order_sha256,
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

/** Consume a genuine permit once; no await or external action occurs in this function. */
export function consumeOwnerGrokImageReferenceOneShotPermit(
  input: ConsumeOwnerGrokImageReferenceOneShotPermitInput | unknown
): OwnerGrokImageReferenceOneShotPermitReceipt {
  const fields = readExactRecord(input, ["permit", "candidate", "profile_set", "profile_id", "principal", "attemptId"],
    ["permit", "candidate", "profile_set", "profile_id", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || typeof fields.profile_id !== "string") {
    fail("INVALID_REQUEST");
  }
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !hasPermitBrand(permit) || !Object.isFrozen(permit)) fail("PERMIT_INVALID");
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
  if (fields.profile_set !== state.profileSet || fields.profile_id !== state.profileId ||
      state.profileSet.profile_set_sha256 !== state.profileSetSha256) fail("PERMIT_PROFILE_MISMATCH");
  if (fields.candidate !== state.candidate) fail("PERMIT_CANDIDATE_MISMATCH");
  const candidateBinding = getOwnerGrokImageReferenceCandidateBinding(
    fields.candidate, state.profileSet, state.profileId, principal, fields.attemptId
  );
  if (!candidateBinding || candidateBinding.profile_set_sha256 !== state.profileSetSha256 ||
      candidateBinding.profile_id !== state.profileId || candidateBinding.profile_schema_hash !== state.profileSchemaHash ||
      candidateBinding.catalog_version !== state.catalogVersion || candidateBinding.model_id !== state.modelId ||
      candidateBinding.variant_id !== state.variantId || candidateBinding.request_fingerprint !== state.requestFingerprint ||
      candidateBinding.reference_order_sha256 !== state.referenceOrderSha256 ||
      permit.request_fingerprint !== state.requestFingerprint || permit.reference_order_sha256 !== state.referenceOrderSha256) {
    fail("PERMIT_CANDIDATE_MISMATCH");
  }
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, profile_set_sha256: state.profileSetSha256,
    profile_id: state.profileId, request_fingerprint: state.requestFingerprint, reference_order_sha256: state.referenceOrderSha256 });
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("INVALID_REQUEST"); }
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

function hasPermitBrand(value: object): value is OwnerGrokImageReferenceOneShotPermit {
  if (types.isProxy(value) || !Object.isFrozen(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const stringKeys = keys.filter((key): key is string => typeof key === "string");
  const expected = ["status", "dispatch_allowed", "profile_set_sha256", "profile_id", "profile_schema_hash",
    "catalog_version", "model_id", "variant_id", "request_fingerprint", "reference_order_sha256", "expires_at"];
  const symbols = keys.filter((key): key is symbol => typeof key === "symbol");
  return stringKeys.length === expected.length && expected.every((key) => Object.hasOwn(descriptors, key)) &&
    stringKeys.every((key) => expected.includes(key)) && symbols.length === 1 && symbols[0] === permitBrand &&
    keys.every((key) => {
      const descriptor = descriptors[key as keyof typeof descriptors];
      return descriptor !== undefined && "value" in descriptor;
    }) && Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true && descriptors.status?.value === "authorized" &&
    descriptors.dispatch_allowed?.value === false;
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

function fail(code: OwnerGrokImageReferenceOneShotPolicyErrorCode): never {
  throw new OwnerGrokImageReferenceOneShotPolicyError(code);
}
