import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION } from "./owner-flux3-video-source-profile.js";
import {
  isOwnerFlux3VideoOwnedPreparedCandidate,
  isOwnerFlux3VideoOwnedRequestPreparer,
  OwnerFlux3VideoOwnedRequestPreparer,
  type OwnerFlux3VideoOwnedCandidateBinding,
  type OwnerFlux3VideoOwnedPreparedCandidate
} from "./owner-flux3-video-owned-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerFlux3VideoOwnedOneShotPermit");
const PERMITS = new WeakMap<object, PermitState>();
const ISSUED = new WeakMap<object, object>();
const ISSUING = new WeakSet<object>();
const CLAIMED_INTENTS = new Map<string, object>();
const MAX_CLAIMED_INTENTS = 8_192;

export interface OwnerFlux3VideoOwnedOneShotPermitInput {
  readonly preparer: OwnerFlux3VideoOwnedRequestPreparer;
  readonly candidate: OwnerFlux3VideoOwnedPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerFlux3VideoOwnedOneShotPermit extends Readonly<{
  status: "nominal";
  dispatch_allowed: false;
  backend_acceptance: "UNPROVEN";
  model_id: "flux3_i2v" | "flux3_v2v";
  profile_schema_hash: string;
  request_fingerprint: string;
  intent_fingerprint: string;
  expires_at: number;
}> { readonly [BRAND]: true }
export interface OwnerFlux3VideoOwnedOneShotPermitContext extends OwnerFlux3VideoOwnedOneShotPermitInput {
  readonly permit: OwnerFlux3VideoOwnedOneShotPermit;
}
export interface OwnerFlux3VideoOwnedOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerFlux3VideoOwnedOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "INTENT_ALREADY_CLAIMED" | "CAPACITY_EXCEEDED"
  | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";

export class OwnerFlux3VideoOwnedOneShotPolicyError extends Error {
  constructor(readonly code: OwnerFlux3VideoOwnedOneShotPolicyErrorCode) {
    super("The owned Flux3 video one-shot receipt could not be satisfied safely.");
    this.name = "OwnerFlux3VideoOwnedOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerFlux3VideoOwnedOneShotPermit;
  readonly preparer: OwnerFlux3VideoOwnedRequestPreparer;
  readonly candidate: OwnerFlux3VideoOwnedPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly semanticKey: string;
  revalidated: boolean;
  consumed: boolean;
}

/** Issues a process-local receipt only; it never authorizes provider generation. */
export async function createOwnerFlux3VideoOwnedOneShotPermit(
  inputInput: OwnerFlux3VideoOwnedOneShotPermitInput | unknown
): Promise<OwnerFlux3VideoOwnedOneShotPermit> {
  const input = readInput(inputInput);
  if (ISSUED.has(input.candidate) || ISSUING.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const binding = currentBinding(input.preparer, input.candidate);
  assertCandidate(input.candidate, binding, input.principal, input.attemptId);
  const semanticKey = semanticKeyFor(input.principal, input.candidate.intent_fingerprint);
  if (CLAIMED_INTENTS.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
  const bindingHash = schemaHash(binding), requestHash = schemaHash(input.preparer.getPrivateRequest(input.candidate));
  ISSUING.add(input.candidate);
  try {
    if (CLAIMED_INTENTS.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
    const permit: OwnerFlux3VideoOwnedOneShotPermit = Object.freeze({
      [BRAND]: true as const,
      status: "nominal",
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN",
      model_id: input.candidate.model_id,
      profile_schema_hash: binding.profile_schema_hash,
      request_fingerprint: binding.request_fingerprint,
      intent_fingerprint: binding.intent_fingerprint,
      expires_at: binding.expires_at
    });
    PERMITS.set(permit, { permit, ...input, binding, bindingHash, requestHash, semanticKey, revalidated: false, consumed: false });
    ISSUED.set(input.candidate, permit);
    return permit;
  } finally { ISSUING.delete(input.candidate); }
}

export async function revalidateOwnerFlux3VideoOwnedOneShotPermit(
  inputInput: OwnerFlux3VideoOwnedOneShotPermitContext | unknown
): Promise<void> {
  const state = readPermitInput(inputInput);
  state.revalidated = false;
  assertIntentAvailable(state);
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    assertIntentAvailable(state);
    assertSameBinding(state.binding, fresh);
    assertCandidate(state.candidate, fresh, state.principal, state.attemptId);
    if (schemaHash(fresh) !== state.bindingHash ||
        schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
    assertPermit(state);
    state.revalidated = true;
  } catch (error) {
    state.revalidated = false;
    if (error instanceof OwnerFlux3VideoOwnedOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Claims the owner semantic intent synchronously at the final native-dispatch boundary. */
export function consumeOwnerFlux3VideoOwnedOneShotPermit(
  inputInput: OwnerFlux3VideoOwnedOneShotPermitContext | unknown
): OwnerFlux3VideoOwnedOneShotPermitReceipt {
  const state = readPermitInput(inputInput);
  if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  assertIntentAvailable(state);
  assertPermit(state);
  if (!CLAIMED_INTENTS.has(state.semanticKey) && CLAIMED_INTENTS.size >= MAX_CLAIMED_INTENTS) fail("CAPACITY_EXCEEDED");
  CLAIMED_INTENTS.set(state.semanticKey, state.permit);
  state.consumed = true;
  state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.binding.request_fingerprint });
}

function readInput(value: unknown): Readonly<OwnerFlux3VideoOwnedOneShotPermitInput> {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]), preparer = trusted(fields.preparer);
  if (!isOwnerFlux3VideoOwnedPreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ preparer, candidate: fields.candidate, principal, attemptId });
}

function readPermitInput(value: unknown): PermitState {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  const preparer = trusted(fields.preparer), candidate = fields.candidate as OwnerFlux3VideoOwnedPreparedCandidate, permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = PERMITS.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerFlux3VideoOwnedOneShotPermit)) fail("PERMIT_INVALID");
  if (state.candidate !== candidate || !isOwnerFlux3VideoOwnedPreparedCandidate(candidate)) fail("CANDIDATE_EXPIRED");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  if (state.preparer !== preparer || state.candidate !== candidate) fail("CANDIDATE_MISMATCH");
  if (state.attemptId !== attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertCandidate(candidate, currentBinding(preparer, candidate), principal, attemptId);
  return state;
}

function trusted(value: unknown): OwnerFlux3VideoOwnedRequestPreparer {
  if (!isOwnerFlux3VideoOwnedRequestPreparer(value) || !genuinePreparer(value)) fail("PREPARER_UNTRUSTED");
  return value;
}
function genuinePreparer(value: OwnerFlux3VideoOwnedRequestPreparer): boolean {
  return ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "withCapturedNativeReferences",
    "isBoundToReferenceService", "invalidateAttempt", "close"].every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(OwnerFlux3VideoOwnedRequestPreparer.prototype, name);
    return !!descriptor && "value" in descriptor && typeof descriptor.value === "function" && Object.getOwnPropertyDescriptor(value, name) === undefined;
  });
}
function currentBinding(preparer: OwnerFlux3VideoOwnedRequestPreparer,
  candidate: OwnerFlux3VideoOwnedPreparedCandidate): Readonly<OwnerFlux3VideoOwnedCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate);
  if (!binding) fail("CANDIDATE_EXPIRED");
  return binding;
}
function assertCandidate(candidate: OwnerFlux3VideoOwnedPreparedCandidate,
  binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>, principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false ||
      candidate.backend_acceptance !== "UNPROVEN" || candidate.control_combination_status !== binding.control_combination_status ||
      candidate.model_id !== binding.model_id || candidate.profile_schema_hash !== binding.profile_schema_hash ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.expires_at !== binding.expires_at || schemaHash(candidate.sources) !== schemaHash(binding.sources) ||
      candidate.model_id !== "flux3_i2v" && candidate.model_id !== "flux3_v2v" ||
      binding.source_binding.public_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION) fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(a: Readonly<OwnerFlux3VideoOwnedCandidateBinding>, b: unknown): void {
  if (schemaHash(a) !== schemaHash(b)) fail("CANDIDATE_MISMATCH");
}
function assertPermit(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate), request = state.preparer.getPrivateRequest(state.candidate);
  const claim = CLAIMED_INTENTS.get(state.semanticKey);
  if ((claim !== undefined && claim !== state.permit) || ISSUED.get(state.candidate) !== state.permit ||
      schemaHash(binding) !== state.bindingHash || schemaHash(request) !== state.requestHash ||
      state.permit.model_id !== state.binding.model_id || state.permit.profile_schema_hash !== state.binding.profile_schema_hash ||
      state.permit.request_fingerprint !== state.binding.request_fingerprint || state.permit.intent_fingerprint !== state.binding.intent_fingerprint ||
      state.permit.expires_at !== state.binding.expires_at || state.permit.dispatch_allowed !== false || state.permit.backend_acceptance !== "UNPROVEN") {
    fail("CANDIDATE_MISMATCH");
  }
}
function assertIntentAvailable(state: PermitState): void {
  const claim = CLAIMED_INTENTS.get(state.semanticKey);
  if (claim !== undefined && claim !== state.permit) fail("INTENT_ALREADY_CLAIMED");
}
function semanticKeyFor(principal: Readonly<GenerationPrincipalRef>, intent: string): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id, intent]);
}
function hasPermitShape(value: OwnerFlux3VideoOwnedOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(value) && keys.length === 9 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "backend_acceptance", "model_id", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
        const descriptor = descriptors[key];
        return !!descriptor && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
      }) && descriptors[BRAND] !== undefined && "value" in descriptors[BRAND]! && descriptors[BRAND]!.value === true;
  } catch { return false; }
}
function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) => typeof key !== "string" ||
      !keys.includes(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}
function fail(code: OwnerFlux3VideoOwnedOneShotPolicyErrorCode): never { throw new OwnerFlux3VideoOwnedOneShotPolicyError(code); }
