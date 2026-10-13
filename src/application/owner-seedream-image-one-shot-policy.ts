import { isProxy } from "node:util/types";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  getOwnerSeedreamImageSourceProfile,
  type OwnerSeedreamImageCatalogPort
} from "./owner-seedream-image-source-profile.js";
import type { OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";
import {
  getOwnerSeedreamImagePreparedCandidateState,
  isOwnerSeedreamImagePreparedCandidateForPrincipal,
  observeOwnerSeedreamImageCandidateClock,
  type OwnerSeedreamImagePreparedCandidate
} from "./owner-seedream-image-request-preparer.js";

const TTL_MS = 15 * 60_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const permitBrand: unique symbol = Symbol("OwnerSeedreamImageOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const issuedForCandidate = new WeakMap<object, object>();

export interface CreateOwnerSeedreamImageOneShotPermitInput {
  readonly candidate: OwnerSeedreamImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: OwnerSeedreamImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}
export interface OwnerSeedreamImageOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly model_id: OwnerSeedreamImageVariant;
  readonly ai_name: "seedream";
  readonly public_catalog_version: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
}
export interface ConsumeOwnerSeedreamImageOneShotPermitInput {
  readonly permit: OwnerSeedreamImageOneShotPermit;
  readonly candidate: OwnerSeedreamImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerSeedreamImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}
export type OwnerSeedreamImageOneShotPolicyErrorCode = "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "CANDIDATE_ALREADY_ISSUED" | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED"
  | "PERMIT_ALREADY_CONSUMED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";
export class OwnerSeedreamImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerSeedreamImageOneShotPolicyErrorCode) {
    super("The owner Seedream image one-shot policy could not be satisfied.");
    this.name = "OwnerSeedreamImageOneShotPolicyError";
  }
}
interface PermitState {
  readonly permit: OwnerSeedreamImageOneShotPermit;
  readonly candidate: OwnerSeedreamImagePreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly catalog: OwnerSeedreamImageCatalogPort;
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly candidate_expires_at: number;
  readonly expires_at: number;
  readonly now: () => number;
  last_now: number;
  expired: boolean;
  consumed: boolean;
}

/** Issues an in-process nominal permit for one exact candidate; it grants no plan, cost, or provider approval. */
export function createOwnerSeedreamImageOneShotPermit(input: CreateOwnerSeedreamImageOneShotPermitInput | unknown): OwnerSeedreamImageOneShotPermit {
  const fields = exact(input, ["candidate", "principal", "attemptId", "catalog", "catalog_version", "now"],
    ["candidate", "principal", "attemptId", "catalog", "catalog_version"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.catalog_version !== "string" ||
      !fields.catalog || typeof fields.catalog !== "object" || (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now)))) fail("INVALID_REQUEST");
  const attemptId = fields.attemptId;
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const now = (fields.now as (() => number) | undefined) ?? Date.now;
  const issuedAt = readClock(now);
  const candidate = fields.candidate;
  if (!isOwnerSeedreamImagePreparedCandidateForPrincipal(candidate, principal, attemptId, issuedAt)) fail("CANDIDATE_UNBOUND");
  const internal = getOwnerSeedreamImagePreparedCandidateState(candidate);
  if (!internal || internal.attempt_id !== attemptId || !sameGenerationPrincipal(internal.principal, principal)) fail("CANDIDATE_UNBOUND");
  let profile: ReturnType<typeof getOwnerSeedreamImageSourceProfile>;
  try { profile = getOwnerSeedreamImageSourceProfile(candidate.variant, fields.catalog as OwnerSeedreamImageCatalogPort, fields.catalog_version); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.profile_schema_hash !== profile.profile_schema_hash || candidate.model_id !== profile.model_id ||
      candidate.ai_name !== profile.ai_name || candidate.profile_id !== profile.profile_id ||
      fields.catalog_version !== profile.public_catalog_version) fail("CATALOG_BINDING_MISMATCH");
  if (issuedForCandidate.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  if (!observeOwnerSeedreamImageCandidateClock(candidate, issuedAt)) fail("CANDIDATE_EXPIRED");
  const expiry = Math.min(internal.expires_at, issuedAt + TTL_MS);
  if (!Number.isSafeInteger(expiry) || expiry <= issuedAt) fail("CANDIDATE_EXPIRED");
  const permit: OwnerSeedreamImageOneShotPermit = Object.freeze({ [permitBrand]: true as const, status: "nominal" as const,
    dispatch_allowed: false as const, profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
    variant: profile.variant, model_id: profile.model_id, ai_name: profile.ai_name, public_catalog_version: profile.public_catalog_version,
    catalog_version: fields.catalog_version, request_fingerprint: internal.request_fingerprint,
    intent_fingerprint: internal.intent_fingerprint, expires_at: expiry });
  permitStates.set(permit, { permit, candidate, principal, attemptId, catalog: fields.catalog as OwnerSeedreamImageCatalogPort,
    catalog_version: fields.catalog_version, profile_schema_hash: profile.profile_schema_hash,
    request_fingerprint: internal.request_fingerprint, intent_fingerprint: internal.intent_fingerprint,
    candidate_expires_at: internal.expires_at, expires_at: expiry, now, last_now: issuedAt, expired: false, consumed: false });
  issuedForCandidate.set(candidate, permit);
  return permit;
}

/** Consumes synchronously once, immediately before a future single native POST. */
export function consumeOwnerSeedreamImageOneShotPermit(input: ConsumeOwnerSeedreamImageOneShotPermitInput | unknown): OwnerSeedreamImageOneShotPermitReceipt {
  const fields = exact(input, ["permit", "candidate", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) fail("INVALID_REQUEST");
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !hasPermitBrand(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.expired) fail("PERMIT_EXPIRED");
  const now = readClock(state.now);
  if (now < state.last_now) { state.expired = true; observeOwnerSeedreamImageCandidateClock(state.candidate, now); fail("CLOCK_INVALID"); }
  state.last_now = now;
  if (now >= state.expires_at) { state.expired = true; observeOwnerSeedreamImageCandidateClock(state.candidate, now); fail("PERMIT_EXPIRED"); }
  if (!observeOwnerSeedreamImageCandidateClock(state.candidate, now) ||
      !isOwnerSeedreamImagePreparedCandidateForPrincipal(state.candidate, state.principal, state.attemptId, now)) fail("CANDIDATE_EXPIRED");
  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  if (fields.attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate || permit !== issuedForCandidate.get(state.candidate)) fail("CANDIDATE_MISMATCH");
  const internal = getOwnerSeedreamImagePreparedCandidateState(state.candidate);
  if (!internal || internal.expires_at !== state.candidate_expires_at || internal.request_fingerprint !== state.request_fingerprint ||
      internal.intent_fingerprint !== state.intent_fingerprint) fail("CANDIDATE_MISMATCH");
  let profile: ReturnType<typeof getOwnerSeedreamImageSourceProfile>;
  try { profile = getOwnerSeedreamImageSourceProfile(state.candidate.variant, state.catalog, state.catalog_version); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (profile.profile_schema_hash !== state.profile_schema_hash || permit.profile_schema_hash !== state.profile_schema_hash ||
      permit.request_fingerprint !== state.request_fingerprint || permit.intent_fingerprint !== state.intent_fingerprint ||
      permit.expires_at !== state.expires_at) fail("CATALOG_BINDING_MISMATCH");
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.request_fingerprint });
}

function snapshotPrincipal(value: unknown, attemptId: unknown): Readonly<GenerationPrincipalRef> {
  if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.length > required.length + optional.length ||
      keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readClock(now: () => number): number {
  let value: unknown;
  try { value = now(); } catch { fail("CLOCK_INVALID"); }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}
function hasPermitBrand(value: object): value is OwnerSeedreamImageOneShotPermit {
  return Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true;
}
function fail(code: OwnerSeedreamImageOneShotPolicyErrorCode): never { throw new OwnerSeedreamImageOneShotPolicyError(code); }
