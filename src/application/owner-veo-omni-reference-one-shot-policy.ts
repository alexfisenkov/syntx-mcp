import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerVeoOmniReferencePreparedCandidate,
  isOwnerVeoOmniReferenceRequestPreparer,
  OwnerVeoOmniReferenceRequestPreparer,
  type OwnerVeoOmniReferenceCandidateBinding,
  type OwnerVeoOmniReferencePreparedCandidate
} from "./owner-veo-omni-reference-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerVeoOmniReferenceOneShotPermit");
const PERMITS = new WeakMap<object, PermitState>();
const ISSUED = new WeakMap<object, object>();
const ISSUING = new WeakSet<object>();
const CLAIMED_INTENTS = new Map<string, object>();
const MAX_CLAIMED_INTENTS = 8_192;

export interface OwnerVeoOmniReferenceOneShotPermitInput {
  readonly preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly candidate: OwnerVeoOmniReferencePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerVeoOmniReferenceOneShotPermit extends Readonly<{
  status: "nominal";
  dispatch_allowed: false;
  backend_acceptance: "UNPROVEN";
  model_id: "veo_omni";
  profile_sha256: string;
  request_fingerprint: string;
  intent_fingerprint: string;
  expires_at: number;
}> { readonly [BRAND]: true }
export interface OwnerVeoOmniReferenceOneShotPermitContext extends OwnerVeoOmniReferenceOneShotPermitInput {
  readonly permit: OwnerVeoOmniReferenceOneShotPermit;
}
export interface OwnerVeoOmniReferenceOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}
export type OwnerVeoOmniReferenceOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "INTENT_ALREADY_CLAIMED" | "CAPACITY_EXCEEDED"
  | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";

export class OwnerVeoOmniReferenceOneShotPolicyError extends Error {
  constructor(readonly code: OwnerVeoOmniReferenceOneShotPolicyErrorCode) {
    super("The owner Veo Omni one-shot receipt could not be satisfied safely.");
    this.name = "OwnerVeoOmniReferenceOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerVeoOmniReferenceOneShotPermit;
  readonly preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly candidate: OwnerVeoOmniReferencePreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerVeoOmniReferenceCandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly semanticKey: string;
  revalidated: boolean;
  consumed: boolean;
}

/** Issues a process-local receipt only; it never authorizes provider generation. */
export async function createOwnerVeoOmniReferenceOneShotPermit(
  inputInput: OwnerVeoOmniReferenceOneShotPermitInput | unknown
): Promise<OwnerVeoOmniReferenceOneShotPermit> {
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
    const permit: OwnerVeoOmniReferenceOneShotPermit = Object.freeze({
      [BRAND]: true as const,
      status: "nominal",
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN",
      model_id: "veo_omni",
      profile_sha256: binding.profile_sha256,
      request_fingerprint: binding.request_fingerprint,
      intent_fingerprint: binding.intent_fingerprint,
      expires_at: binding.expires_at
    });
    PERMITS.set(permit, { permit, ...input, binding, bindingHash, requestHash, semanticKey, revalidated: false, consumed: false });
    ISSUED.set(input.candidate, permit);
    return permit;
  } finally { ISSUING.delete(input.candidate); }
}

export async function revalidateOwnerVeoOmniReferenceOneShotPermit(
  inputInput: OwnerVeoOmniReferenceOneShotPermitContext | unknown
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
    if (error instanceof OwnerVeoOmniReferenceOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Claims the owner semantic intent synchronously at the final native-dispatch boundary. */
export function consumeOwnerVeoOmniReferenceOneShotPermit(
  inputInput: OwnerVeoOmniReferenceOneShotPermitContext | unknown
): OwnerVeoOmniReferenceOneShotPermitReceipt {
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

function readInput(value: unknown): Readonly<OwnerVeoOmniReferenceOneShotPermitInput> {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]), preparer = trusted(fields.preparer);
  if (!isOwnerVeoOmniReferencePreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ preparer, candidate: fields.candidate as OwnerVeoOmniReferencePreparedCandidate, principal, attemptId });
}
function readPermitInput(value: unknown): PermitState {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  const preparer = trusted(fields.preparer), candidate = fields.candidate as OwnerVeoOmniReferencePreparedCandidate, permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = PERMITS.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerVeoOmniReferenceOneShotPermit)) fail("PERMIT_INVALID");
  if (state.candidate !== candidate || !isOwnerVeoOmniReferencePreparedCandidate(candidate)) fail("CANDIDATE_EXPIRED");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  if (state.preparer !== preparer || state.candidate !== candidate) fail("CANDIDATE_MISMATCH");
  if (state.attemptId !== attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertCandidate(candidate, currentBinding(preparer, candidate), principal, attemptId);
  return state;
}
function trusted(value: unknown): OwnerVeoOmniReferenceRequestPreparer {
  if (!isOwnerVeoOmniReferenceRequestPreparer(value) || !genuinePreparer(value)) fail("PREPARER_UNTRUSTED");
  return value;
}
function genuinePreparer(value: OwnerVeoOmniReferenceRequestPreparer): boolean {
  return ["prepare", "inspectCandidate", "getPrivateRequest", "revalidateCandidate", "withCapturedReferences",
    "isBoundToReferenceService", "invalidateAttempt", "close"].every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(OwnerVeoOmniReferenceRequestPreparer.prototype, name);
    return !!descriptor && "value" in descriptor && typeof descriptor.value === "function" && Object.getOwnPropertyDescriptor(value, name) === undefined;
  });
}
function currentBinding(preparer: OwnerVeoOmniReferenceRequestPreparer,
  candidate: OwnerVeoOmniReferencePreparedCandidate): Readonly<OwnerVeoOmniReferenceCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate);
  if (!binding) fail("CANDIDATE_EXPIRED");
  return binding;
}
function assertCandidate(candidate: OwnerVeoOmniReferencePreparedCandidate,
  binding: Readonly<OwnerVeoOmniReferenceCandidateBinding>, principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.model_id !== "veo_omni" || candidate.profile_sha256 !== binding.profile_sha256 ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.expires_at !== binding.expires_at || schemaHash(candidate.sources) !== schemaHash(binding.sources)) fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(a: Readonly<OwnerVeoOmniReferenceCandidateBinding>, b: unknown): void {
  if (schemaHash(a) !== schemaHash(b)) fail("CANDIDATE_MISMATCH");
}
function assertPermit(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate), request = state.preparer.getPrivateRequest(state.candidate);
  const claim = CLAIMED_INTENTS.get(state.semanticKey);
  if ((claim !== undefined && claim !== state.permit) || ISSUED.get(state.candidate) !== state.permit ||
      schemaHash(binding) !== state.bindingHash || schemaHash(request) !== state.requestHash ||
      state.permit.model_id !== state.binding.model_id || state.permit.profile_sha256 !== state.binding.profile_sha256 ||
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
function hasPermitShape(value: OwnerVeoOmniReferenceOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(value) && keys.length === 9 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "backend_acceptance", "model_id", "profile_sha256", "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
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
function fail(code: OwnerVeoOmniReferenceOneShotPolicyErrorCode): never { throw new OwnerVeoOmniReferenceOneShotPolicyError(code); }
