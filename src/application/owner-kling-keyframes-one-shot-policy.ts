import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerKlingKeyframesPreparedCandidate, isOwnerKlingKeyframesRequestPreparer,
  type OwnerKlingKeyframesCandidateBinding, type OwnerKlingKeyframesPreparedCandidate,
  type OwnerKlingKeyframesPrivateRequest, type OwnerKlingKeyframesRequestPreparer
} from "./owner-kling-keyframes-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerKlingKeyframesOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const issued = new WeakSet<object>();
const issuing = new WeakSet<object>();

export interface CreateOwnerKlingKeyframesOneShotPermitInput {
  readonly preparer: OwnerKlingKeyframesRequestPreparer;
  readonly candidate: OwnerKlingKeyframesPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerKlingKeyframesOneShotPermit extends Readonly<{
  status: "nominal";
  dispatch_allowed: false;
  runtime_usable: false;
  backend_acceptance: "UNPROVEN";
  profile_schema_hash: string;
  request_fingerprint: string;
  intent_fingerprint: string;
  expires_at: number;
}> { readonly [BRAND]: true }
export interface OwnerKlingKeyframesOneShotPermitContext extends CreateOwnerKlingKeyframesOneShotPermitInput {
  readonly permit: OwnerKlingKeyframesOneShotPermit;
}
export interface OwnerKlingKeyframesOneShotReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly request_fingerprint: string;
  readonly request: OwnerKlingKeyframesPrivateRequest;
}
export type OwnerKlingKeyframesOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" |
  "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" |
  "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";
export class OwnerKlingKeyframesOneShotPolicyError extends Error {
  constructor(readonly code: OwnerKlingKeyframesOneShotPolicyErrorCode) {
    super("The owner Kling Keyframes one-shot permit could not be satisfied safely.");
    this.name = "OwnerKlingKeyframesOneShotPolicyError";
  }
}
interface PermitState {
  readonly permit: OwnerKlingKeyframesOneShotPermit;
  readonly preparer: OwnerKlingKeyframesRequestPreparer;
  readonly candidate: OwnerKlingKeyframesPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerKlingKeyframesCandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  revalidated: boolean;
  consumed: boolean;
  revalidationRevision: number;
}

/** Mints a local permit after a fresh owner and reference check; no runtime dispatch authority. */
export async function createOwnerKlingKeyframesOneShotPermit(inputInput: CreateOwnerKlingKeyframesOneShotPermitInput | unknown): Promise<OwnerKlingKeyframesOneShotPermit> {
  const input = readInput(inputInput);
  if (issued.has(input.candidate) || issuing.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  issuing.add(input.candidate);
  try {
    const binding = currentBinding(input.preparer, input.candidate);
    assertCandidate(input.candidate, binding, input.principal, input.attemptId);
    const bindingHash = schemaHash(binding), requestHash = schemaHash(input.preparer.getPrivateRequest(input.candidate));
    await input.preparer.revalidateCandidate(input.candidate);
    const fresh = currentBinding(input.preparer, input.candidate);
    assertSameBinding(binding, fresh);
    assertCandidate(input.candidate, fresh, input.principal, input.attemptId);
    if (schemaHash(fresh) !== bindingHash || schemaHash(input.preparer.getPrivateRequest(input.candidate)) !== requestHash) fail("CANDIDATE_MISMATCH");
    const permit = Object.freeze({ [BRAND]: true as const, status: "nominal" as const, dispatch_allowed: false as const,
      runtime_usable: false as const, backend_acceptance: "UNPROVEN" as const,
      profile_schema_hash: binding.profile_schema_hash, request_fingerprint: binding.request_fingerprint,
      intent_fingerprint: binding.intent_fingerprint, expires_at: binding.expires_at });
    permits.set(permit, { permit, ...input, binding, bindingHash, requestHash, revalidated: false, consumed: false, revalidationRevision: 0 });
    issued.add(input.candidate);
    return permit;
  } catch (error) {
    if (error instanceof OwnerKlingKeyframesOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  } finally { issuing.delete(input.candidate); }
}

/** Revokes old approval before awaiting fresh owner/reference validation. */
export async function revalidateOwnerKlingKeyframesOneShotPermit(inputInput: OwnerKlingKeyframesOneShotPermitContext | unknown): Promise<void> {
  const state = readPermitInput(inputInput);
  state.revalidated = false;
  const revision = ++state.revalidationRevision;
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    assertSameBinding(state.binding, fresh);
    assertCandidate(state.candidate, fresh, state.principal, state.attemptId);
    if (schemaHash(fresh) !== state.bindingHash || schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
    assertPermit(state);
    if (!state.consumed && state.revalidationRevision === revision) state.revalidated = true;
  } catch (error) {
    if (state.revalidationRevision === revision) state.revalidated = false;
    if (error instanceof OwnerKlingKeyframesOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Burns authority synchronously before reading and returning the private request. */
export function consumeOwnerKlingKeyframesOneShotPermit(inputInput: OwnerKlingKeyframesOneShotPermitContext | unknown): OwnerKlingKeyframesOneShotReceipt {
  const state = readPermitInput(inputInput);
  if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  state.consumed = true;
  state.revalidated = false;
  state.revalidationRevision += 1;
  const request = state.preparer.getPrivateRequest(state.candidate);
  if (schemaHash(request) !== state.requestHash) fail("CANDIDATE_MISMATCH");
  return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    request_fingerprint: state.binding.request_fingerprint, request });
}

function readInput(value: unknown): Readonly<CreateOwnerKlingKeyframesOneShotPermitInput> {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]);
  const preparer = trusted(fields.preparer), candidate = fields.candidate;
  if (!isOwnerKlingKeyframesPreparedCandidate(candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ preparer, candidate, principal, attemptId });
}
function readPermitInput(value: unknown): PermitState {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  const preparer = trusted(fields.preparer), permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permits.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerKlingKeyframesOneShotPermit)) fail("PERMIT_INVALID");
  if (state.candidate !== fields.candidate || !isOwnerKlingKeyframesPreparedCandidate(fields.candidate)) fail("CANDIDATE_MISMATCH");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  if (state.preparer !== preparer || state.attemptId !== attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertCandidate(state.candidate, currentBinding(preparer, state.candidate), principal, attemptId);
  assertPermit(state);
  return state;
}
function trusted(value: unknown): OwnerKlingKeyframesRequestPreparer {
  if (!isOwnerKlingKeyframesRequestPreparer(value)) fail("PREPARER_UNTRUSTED");
  return value;
}
function currentBinding(preparer: OwnerKlingKeyframesRequestPreparer, candidate: OwnerKlingKeyframesPreparedCandidate): Readonly<OwnerKlingKeyframesCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate);
  if (!binding || binding.candidate !== candidate) fail("CANDIDATE_EXPIRED");
  return binding;
}
function assertCandidate(candidate: OwnerKlingKeyframesPreparedCandidate, binding: Readonly<OwnerKlingKeyframesCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false ||
      candidate.backend_acceptance !== "UNPROVEN" || candidate.model_id !== "kling_keyframes" ||
      candidate.profile_schema_hash !== binding.profile_schema_hash || candidate.request_fingerprint !== binding.request_fingerprint ||
      candidate.intent_fingerprint !== binding.intent_fingerprint || candidate.expires_at !== binding.expires_at ||
      schemaHash(candidate.source_binding) !== schemaHash(binding.source_binding) || candidate.images.length !== binding.images.length ||
      candidate.images.some((image, index) => image.sha256 !== binding.images[index]?.sha256 || image.mime_type !== binding.images[index]?.mime_type ||
        image.size !== binding.images[index]?.size || image.width !== binding.images[index]?.width || image.height !== binding.images[index]?.height) ||
      binding.image_handles.length !== 2 || !Number.isSafeInteger(binding.reference_epoch) || !Number.isSafeInteger(binding.reference_expires_at)) fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(expected: Readonly<OwnerKlingKeyframesCandidateBinding>, actual: unknown): asserts actual is OwnerKlingKeyframesCandidateBinding {
  if (!actual || typeof actual !== "object" || schemaHash(expected) !== schemaHash(actual)) fail("CANDIDATE_MISMATCH");
}
function assertPermit(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate);
  if (!issued.has(state.candidate) || schemaHash(binding) !== state.bindingHash ||
      schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash ||
      state.permit.profile_schema_hash !== state.binding.profile_schema_hash ||
      state.permit.request_fingerprint !== state.binding.request_fingerprint || state.permit.intent_fingerprint !== state.binding.intent_fingerprint ||
      state.permit.expires_at !== state.binding.expires_at || state.permit.dispatch_allowed !== false ||
      state.permit.runtime_usable !== false || state.permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}
function hasPermitShape(value: OwnerKlingKeyframesOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(value) && keys.length === 9 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "runtime_usable", "backend_acceptance", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
        const descriptor = descriptors[key]; return !!descriptor && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
      }) && !!descriptors[BRAND] && "value" in descriptors[BRAND]! && descriptors[BRAND]!.value === true;
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
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const actual = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys) copy[key] = descriptors[key]!.value;
  return copy;
}
function fail(code: OwnerKlingKeyframesOneShotPolicyErrorCode): never { throw new OwnerKlingKeyframesOneShotPolicyError(code); }
