import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerElevenLabsStsPreparedCandidate, isOwnerElevenLabsStsRequestPreparer,
  type OwnerElevenLabsStsCandidateBinding, type OwnerElevenLabsStsPreparedCandidate,
  type OwnerElevenLabsStsRequestPreparer
} from "./owner-elevenlabs-sts-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerElevenLabsStsOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const issued = new WeakMap<object, object>();
const issuing = new WeakSet<object>();

export interface OwnerElevenLabsStsOneShotInput {
  readonly preparer: OwnerElevenLabsStsRequestPreparer;
  readonly candidate: OwnerElevenLabsStsPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerElevenLabsStsOneShotPermit extends Readonly<{
  status: "nominal"; dispatch_allowed: false; backend_acceptance: "UNPROVEN";
  profile_schema_hash: string; request_fingerprint: string; intent_fingerprint: string; expires_at: number;
}> { readonly [BRAND]: true }
export interface OwnerElevenLabsStsOneShotContext extends OwnerElevenLabsStsOneShotInput { readonly permit: OwnerElevenLabsStsOneShotPermit }
export interface OwnerElevenLabsStsOneShotReceipt { readonly status: "consumed"; readonly dispatch_allowed: false; readonly request_fingerprint: string }
export type OwnerElevenLabsStsOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" |
  "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" |
  "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";
export class OwnerElevenLabsStsOneShotPolicyError extends Error {
  constructor(readonly code: OwnerElevenLabsStsOneShotPolicyErrorCode) {
    super("The owner ElevenLabs STS one-shot receipt could not be satisfied safely.");
    this.name = "OwnerElevenLabsStsOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerElevenLabsStsOneShotPermit;
  readonly preparer: OwnerElevenLabsStsRequestPreparer;
  readonly candidate: OwnerElevenLabsStsPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerElevenLabsStsCandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  revalidated: boolean;
  consumed: boolean;
}

/** Creates a local one-use receipt only for the current source-pinned STS projection. */
export async function createOwnerElevenLabsStsOneShotPermit(inputInput: OwnerElevenLabsStsOneShotInput | unknown): Promise<OwnerElevenLabsStsOneShotPermit> {
  const input = readInput(inputInput);
  if (issued.has(input.candidate) || issuing.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const binding = currentBinding(input.preparer, input.candidate);
  assertCandidate(input.candidate, binding, input.principal, input.attemptId);
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
  issued.set(input.candidate, permit);
  return permit;
}

export async function revalidateOwnerElevenLabsStsOneShotPermit(inputInput: OwnerElevenLabsStsOneShotContext | unknown): Promise<void> {
  const state = readPermitInput(inputInput); state.revalidated = false;
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    assertSameBinding(state.binding, fresh); assertCandidate(state.candidate, fresh, state.principal, state.attemptId);
    if (schemaHash(fresh) !== state.bindingHash || schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
    assertPermit(state); state.revalidated = true;
  } catch (error) {
    state.revalidated = false;
    if (error instanceof OwnerElevenLabsStsOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Synchronously burns one local receipt after fresh revalidation; it never enables dispatch. */
export function consumeOwnerElevenLabsStsOneShotPermit(inputInput: OwnerElevenLabsStsOneShotContext | unknown): OwnerElevenLabsStsOneShotReceipt {
  const state = readPermitInput(inputInput);
  if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  assertPermit(state); state.consumed = true; state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.binding.request_fingerprint });
}

function readInput(value: unknown): Readonly<OwnerElevenLabsStsOneShotInput> {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]), preparer = trusted(fields.preparer);
  if (!isOwnerElevenLabsStsPreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ preparer, candidate: fields.candidate, principal, attemptId });
}
function readPermitInput(value: unknown): PermitState {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]), preparer = trusted(fields.preparer);
  const candidate = fields.candidate as OwnerElevenLabsStsPreparedCandidate, permit = fields.permit;
  if (!isOwnerElevenLabsStsPreparedCandidate(candidate) || !permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permits.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerElevenLabsStsOneShotPermit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  if (state.preparer !== preparer || state.candidate !== candidate) fail("CANDIDATE_MISMATCH");
  if (state.attemptId !== attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertCandidate(candidate, currentBinding(preparer, candidate), principal, attemptId);
  return state;
}
function trusted(value: unknown): OwnerElevenLabsStsRequestPreparer { if (!isOwnerElevenLabsStsRequestPreparer(value)) fail("PREPARER_UNTRUSTED"); return value; }
function currentBinding(preparer: OwnerElevenLabsStsRequestPreparer, candidate: OwnerElevenLabsStsPreparedCandidate): Readonly<OwnerElevenLabsStsCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate); if (!binding) fail("CANDIDATE_EXPIRED"); return binding;
}
function assertCandidate(candidate: OwnerElevenLabsStsPreparedCandidate, binding: Readonly<OwnerElevenLabsStsCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "prepared" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.model_id !== "eleven_multilingual_sts_v2" || candidate.mode !== "speech_to_speech" || candidate.duration_seconds !== binding.duration ||
      candidate.duration_projection_status !== binding.duration_projection_status || candidate.profile_schema_hash !== binding.profile_schema_hash ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint || candidate.expires_at !== binding.expires_at ||
      candidate.source_sha256 !== binding.source_sha256) fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(a: Readonly<OwnerElevenLabsStsCandidateBinding>, b: unknown): void { if (schemaHash(a) !== schemaHash(b)) fail("CANDIDATE_MISMATCH"); }
function assertPermit(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate), request = state.preparer.getPrivateRequest(state.candidate);
  if (issued.get(state.candidate) !== state.permit || schemaHash(binding) !== state.bindingHash || schemaHash(request) !== state.requestHash ||
      state.permit.profile_schema_hash !== state.binding.profile_schema_hash || state.permit.request_fingerprint !== state.binding.request_fingerprint ||
      state.permit.intent_fingerprint !== state.binding.intent_fingerprint || state.permit.expires_at !== state.binding.expires_at ||
      state.permit.dispatch_allowed !== false || state.permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}
function hasPermitShape(value: OwnerElevenLabsStsOneShotPermit): boolean {
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
  const result = Object.create(null) as Record<string, unknown>; for (const key of keys) { if (!Object.hasOwn(descriptors, key)) fail("INVALID_REQUEST"); result[key] = descriptors[key]!.value; } return result;
}
function fail(code: OwnerElevenLabsStsOneShotPolicyErrorCode): never { throw new OwnerElevenLabsStsOneShotPolicyError(code); }
