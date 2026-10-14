import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerTopazAstraOwnedPreparedCandidate, isOwnerTopazAstraOwnedRequestPreparer,
  type OwnerTopazAstraOwnedCandidateBinding, type OwnerTopazAstraOwnedPreparedCandidate,
  type OwnerTopazAstraOwnedRequestPreparer
} from "./owner-topaz-astra-owned-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerTopazAstraOwnedOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const issued = new WeakMap<object, object>();
const issuing = new WeakSet<object>();

export interface OwnerTopazAstraOwnedOneShotPermitInput {
  readonly preparer: OwnerTopazAstraOwnedRequestPreparer;
  readonly candidate: OwnerTopazAstraOwnedPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerTopazAstraOwnedOneShotPermit extends Readonly<{
  status: "nominal"; dispatch_allowed: false; backend_acceptance: "UNPROVEN";
  profile_schema_hash: string; request_fingerprint: string; intent_fingerprint: string; expires_at: number;
}> { readonly [BRAND]: true }
export interface OwnerTopazAstraOwnedOneShotPermitContext extends OwnerTopazAstraOwnedOneShotPermitInput { readonly permit: OwnerTopazAstraOwnedOneShotPermit }
export interface OwnerTopazAstraOwnedOneShotPermitReceipt { readonly status: "consumed"; readonly dispatch_allowed: false; readonly request_fingerprint: string }
export type OwnerTopazAstraOwnedOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" |
  "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" |
  "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH" | "CONTROL_COMBINATION_UNRESOLVED";
export class OwnerTopazAstraOwnedOneShotPolicyError extends Error {
  constructor(readonly code: OwnerTopazAstraOwnedOneShotPolicyErrorCode) {
    super("The owned Topaz Astra one-shot receipt could not be satisfied safely.");
    this.name = "OwnerTopazAstraOwnedOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerTopazAstraOwnedOneShotPermit; readonly preparer: OwnerTopazAstraOwnedRequestPreparer;
  readonly candidate: OwnerTopazAstraOwnedPreparedCandidate; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string; readonly binding: Readonly<OwnerTopazAstraOwnedCandidateBinding>;
  readonly bindingHash: string; readonly requestHash: string; revalidated: boolean; consumed: boolean;
}

/** Local, single-use acknowledgement only; it never authorizes provider dispatch. */
export async function createOwnerTopazAstraOwnedOneShotPermit(inputInput: OwnerTopazAstraOwnedOneShotPermitInput | unknown): Promise<OwnerTopazAstraOwnedOneShotPermit> {
  const input = readInput(inputInput);
  if (issued.has(input.candidate) || issuing.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const binding = currentBinding(input.preparer, input.candidate); assertCandidate(input.candidate, binding, input.principal, input.attemptId);
  if (input.candidate.control_combination_status !== "SOURCE_REVIEWED_EXACT") fail("CONTROL_COMBINATION_UNRESOLVED");
  const bindingHash = schemaHash(binding), requestHash = schemaHash(input.preparer.getPrivateRequest(input.candidate));
  issuing.add(input.candidate);
  try {
    const fresh = await input.preparer.revalidateCandidate(input.candidate);
    assertSameBinding(binding, fresh); assertCandidate(input.candidate, fresh, input.principal, input.attemptId);
    if (schemaHash(input.preparer.getPrivateRequest(input.candidate)) !== requestHash) fail("CANDIDATE_MISMATCH");
  } finally { issuing.delete(input.candidate); }
  const permit = Object.freeze({ [BRAND]: true as const, status: "nominal" as const, dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const, profile_schema_hash: binding.profile_schema_hash,
    request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint, expires_at: binding.expires_at });
  permits.set(permit, { permit, ...input, binding, bindingHash, requestHash, revalidated: true, consumed: false });
  issued.set(input.candidate, permit); return permit;
}

export async function revalidateOwnerTopazAstraOwnedOneShotPermit(inputInput: OwnerTopazAstraOwnedOneShotPermitContext | unknown): Promise<void> {
  const state = readPermitInput(inputInput); state.revalidated = false;
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    assertSameBinding(state.binding, fresh); assertCandidate(state.candidate, fresh, state.principal, state.attemptId);
    if (schemaHash(fresh) !== state.bindingHash || schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
    assertPermit(state); state.revalidated = true;
  } catch (error) {
    state.revalidated = false;
    if (error instanceof OwnerTopazAstraOwnedOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Synchronously burns one receipt after fresh revalidation; dispatch remains forbidden. */
export function consumeOwnerTopazAstraOwnedOneShotPermit(inputInput: OwnerTopazAstraOwnedOneShotPermitContext | unknown): OwnerTopazAstraOwnedOneShotPermitReceipt {
  const state = readPermitInput(inputInput);
  if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  assertPermit(state); state.consumed = true; state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.binding.request_fingerprint });
}

function readInput(value: unknown): Readonly<OwnerTopazAstraOwnedOneShotPermitInput> {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]), preparer = trusted(fields.preparer);
  if (!isOwnerTopazAstraOwnedPreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ preparer, candidate: fields.candidate, principal, attemptId });
}
function readPermitInput(value: unknown): PermitState {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]), preparer = trusted(fields.preparer);
  const candidate = fields.candidate as OwnerTopazAstraOwnedPreparedCandidate, permit = fields.permit;
  if (!isOwnerTopazAstraOwnedPreparedCandidate(candidate) || !permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permits.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerTopazAstraOwnedOneShotPermit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  if (state.preparer !== preparer || state.candidate !== candidate) fail("CANDIDATE_MISMATCH");
  if (state.attemptId !== attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertCandidate(candidate, currentBinding(preparer, candidate), principal, attemptId); return state;
}
function trusted(value: unknown): OwnerTopazAstraOwnedRequestPreparer { if (!isOwnerTopazAstraOwnedRequestPreparer(value)) fail("PREPARER_UNTRUSTED"); return value; }
function currentBinding(preparer: OwnerTopazAstraOwnedRequestPreparer, candidate: OwnerTopazAstraOwnedPreparedCandidate): Readonly<OwnerTopazAstraOwnedCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate); if (!binding) fail("CANDIDATE_EXPIRED"); return binding;
}
function assertCandidate(candidate: OwnerTopazAstraOwnedPreparedCandidate, binding: Readonly<OwnerTopazAstraOwnedCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      (candidate.control_combination_status !== "UNRESOLVED" && candidate.control_combination_status !== "SOURCE_REVIEWED_EXACT") ||
      candidate.model_id !== binding.model_id || candidate.profile_schema_hash !== binding.profile_schema_hash ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint || candidate.expires_at !== binding.expires_at ||
      candidate.original.sha256 !== binding.original_sha256 || candidate.original.size !== binding.original_size || candidate.original.duration_seconds !== binding.duration_seconds ||
      candidate.original.decoded_frame_count !== binding.decoded_frame_count || candidate.source_binding.source_build_id !== "1791904852" ||
      schemaHash(candidate.source_binding) !== schemaHash(binding.source_binding)) fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(a: Readonly<OwnerTopazAstraOwnedCandidateBinding>, b: unknown): void { if (schemaHash(a) !== schemaHash(b)) fail("CANDIDATE_MISMATCH"); }
function assertPermit(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate), request = state.preparer.getPrivateRequest(state.candidate);
  if (issued.get(state.candidate) !== state.permit || schemaHash(binding) !== state.bindingHash || schemaHash(request) !== state.requestHash ||
      state.permit.profile_schema_hash !== state.binding.profile_schema_hash || state.permit.request_fingerprint !== state.binding.request_fingerprint ||
      state.permit.intent_fingerprint !== state.binding.intent_fingerprint || state.permit.expires_at !== state.binding.expires_at ||
      state.permit.dispatch_allowed !== false || state.permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}
function hasPermitShape(value: OwnerTopazAstraOwnedOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(value) && keys.length === 8 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "backend_acceptance", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
        const descriptor = descriptors[key]; return !!descriptor && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
      }) && descriptors[BRAND] !== undefined && "value" in descriptors[BRAND]! && descriptors[BRAND]!.value === true;
  } catch { return false; }
}
function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH"); return principal;
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) => typeof key !== "string" ||
      !keys.includes(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>; for (const key of keys) result[key] = descriptors[key]!.value; return result;
}
function fail(code: OwnerTopazAstraOwnedOneShotPolicyErrorCode): never { throw new OwnerTopazAstraOwnedOneShotPolicyError(code); }
