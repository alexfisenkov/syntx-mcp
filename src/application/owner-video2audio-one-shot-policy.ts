import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerVideo2AudioPreparedCandidate, isOwnerVideo2AudioRequestPreparer,
  type OwnerVideo2AudioCandidateBinding, type OwnerVideo2AudioPreparedCandidate, type OwnerVideo2AudioRequestPreparer
} from "./owner-video2audio-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PERMIT_BRAND: unique symbol = Symbol("OwnerVideo2AudioOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const issuedForCandidate = new WeakMap<object, object>();
const issuingCandidates = new WeakSet<object>();

export interface CreateOwnerVideo2AudioOneShotPermitInput {
  readonly preparer: OwnerVideo2AudioRequestPreparer;
  readonly candidate: OwnerVideo2AudioPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

/** A once-only local receipt; dispatch_allowed remains false and provider authorization is external. */
export interface OwnerVideo2AudioOneShotPermit {
  readonly [PERMIT_BRAND]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
}

export interface OwnerVideo2AudioOneShotPermitContext extends CreateOwnerVideo2AudioOneShotPermitInput {
  readonly permit: OwnerVideo2AudioOneShotPermit;
}

export interface OwnerVideo2AudioOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerVideo2AudioOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID"
  | "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";

export class OwnerVideo2AudioOneShotPolicyError extends Error {
  constructor(readonly code: OwnerVideo2AudioOneShotPolicyErrorCode) {
    super("The Video2Audio one-shot policy could not be satisfied safely.");
    this.name = "OwnerVideo2AudioOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerVideo2AudioOneShotPermit;
  readonly preparer: OwnerVideo2AudioRequestPreparer;
  readonly candidate: OwnerVideo2AudioPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerVideo2AudioCandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  revalidated: boolean;
  consumed: boolean;
}

/** Trusted generation services call this only after fresh account/model gates and semantic claim. */
export async function createOwnerVideo2AudioOneShotPermit(input: CreateOwnerVideo2AudioOneShotPermitInput | unknown): Promise<OwnerVideo2AudioOneShotPermit> {
  const fields = readCreateInput(input);
  if (issuedForCandidate.has(fields.candidate) || issuingCandidates.has(fields.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const binding = currentBinding(fields.preparer, fields.candidate);
  assertPrincipal(binding, fields.principal, fields.attemptId);
  const bindingHash = schemaHash(binding);
  const requestHash = schemaHash(fields.preparer.getPrivateRequest(fields.candidate));
  issuingCandidates.add(fields.candidate);
  try {
    const fresh = await fields.preparer.revalidateCandidate(fields.candidate);
    assertSameBinding(binding, fresh);
    assertPrincipal(fresh, fields.principal, fields.attemptId);
    if (schemaHash(fields.preparer.getPrivateRequest(fields.candidate)) !== requestHash) fail("CANDIDATE_MISMATCH");
  } catch (error) {
    if (error instanceof OwnerVideo2AudioOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  } finally {
    issuingCandidates.delete(fields.candidate);
  }
  const permit = Object.freeze({ [PERMIT_BRAND]: true as const, status: "nominal" as const, dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const, profile_schema_hash: binding.profile_schema_hash,
    request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint, expires_at: binding.expires_at });
  permits.set(permit, { permit, ...fields, principal: binding.principal, binding, bindingHash, requestHash, revalidated: false, consumed: false });
  issuedForCandidate.set(fields.candidate, permit);
  return permit;
}

/** Must run immediately before consume/POST, after the trusted service's account/model checks and claim. */
export async function revalidateOwnerVideo2AudioOneShotPermit(input: OwnerVideo2AudioOneShotPermitContext | unknown): Promise<void> {
  const state = readPermitInput(input);
  state.revalidated = false;
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    assertSameBinding(state.binding, fresh);
    assertPrincipal(fresh, state.principal, state.attemptId);
    if (schemaHash(fresh) !== state.bindingHash || schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) {
      fail("CANDIDATE_MISMATCH");
    }
    assertPermitShape(state.permit, state.binding);
    state.revalidated = true;
  } catch (error) {
    state.revalidated = false;
    if (error instanceof OwnerVideo2AudioOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Burns this one-shot receipt; the returned receipt deliberately does not grant dispatch authority. */
export function consumeOwnerVideo2AudioOneShotPermit(input: OwnerVideo2AudioOneShotPermitContext | unknown): OwnerVideo2AudioOneShotPermitReceipt {
  const state = readPermitInput(input);
  if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  assertPermitShape(state.permit, state.binding);
  if (schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
  state.consumed = true;
  state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.binding.request_fingerprint });
}

export function isOwnerVideo2AudioOneShotPermit(value: unknown): value is OwnerVideo2AudioOneShotPermit {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const state = permits.get(value as object);
  return !!state && state.permit === value && hasPermitShape(value as OwnerVideo2AudioOneShotPermit);
}

function readCreateInput(value: unknown): Readonly<CreateOwnerVideo2AudioOneShotPermitInput> {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]);
  const preparer = trustedPreparer(fields.preparer);
  if (!isOwnerVideo2AudioPreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId);
  const principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ preparer, candidate: fields.candidate, principal, attemptId });
}

function readPermitInput(value: unknown): PermitState {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  const preparer = trustedPreparer(fields.preparer);
  if (!isOwnerVideo2AudioPreparedCandidate(fields.candidate) || !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) {
    fail("PERMIT_INVALID");
  }
  const state = permits.get(fields.permit as object);
  if (!state || state.permit !== fields.permit || !hasPermitShape(fields.permit as OwnerVideo2AudioOneShotPermit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(fields.attemptId);
  const principal = readPrincipal(fields.principal, attemptId);
  if (state.preparer !== preparer || state.candidate !== fields.candidate || state.attemptId !== attemptId ||
      !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  const binding = currentBinding(preparer, fields.candidate);
  assertPrincipal(binding, principal, attemptId);
  assertSameBinding(state.binding, binding);
  return state;
}

function trustedPreparer(value: unknown): OwnerVideo2AudioRequestPreparer {
  if (!isOwnerVideo2AudioRequestPreparer(value)) fail("PREPARER_UNTRUSTED");
  return value;
}

function currentBinding(preparer: OwnerVideo2AudioRequestPreparer, candidate: OwnerVideo2AudioPreparedCandidate): Readonly<OwnerVideo2AudioCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate);
  if (!binding) fail("CANDIDATE_EXPIRED");
  return binding;
}

function assertPrincipal(binding: Readonly<OwnerVideo2AudioCandidateBinding>, principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal) || principal.connection_id !== attemptId) {
    fail("PRINCIPAL_MISMATCH");
  }
}

function assertSameBinding(before: Readonly<OwnerVideo2AudioCandidateBinding>, after: unknown): asserts after is Readonly<OwnerVideo2AudioCandidateBinding> {
  if (!after || typeof after !== "object" || schemaHash(before) !== schemaHash(after) ||
      before.captured_client !== (after as OwnerVideo2AudioCandidateBinding).captured_client ||
      before.captured_reference !== (after as OwnerVideo2AudioCandidateBinding).captured_reference) fail("CANDIDATE_MISMATCH");
}

function assertPermitShape(permit: OwnerVideo2AudioOneShotPermit, binding: Readonly<OwnerVideo2AudioCandidateBinding>): void {
  if (!hasPermitShape(permit) || issuedForCandidate.get(permitStateCandidate(permit)) !== permit ||
      permit.profile_schema_hash !== binding.profile_schema_hash || permit.request_fingerprint !== binding.request_fingerprint ||
      permit.intent_fingerprint !== binding.intent_fingerprint || permit.expires_at !== binding.expires_at ||
      permit.dispatch_allowed !== false || permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}

function permitStateCandidate(permit: OwnerVideo2AudioOneShotPermit): OwnerVideo2AudioPreparedCandidate {
  const state = permits.get(permit);
  if (!state) fail("PERMIT_INVALID");
  return state.candidate;
}

function hasPermitShape(value: OwnerVideo2AudioOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(value) && keys.length === 8 && keys.includes(PERMIT_BRAND) &&
      ["status", "dispatch_allowed", "backend_acceptance", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
        const descriptor = descriptors[key]; return !!descriptor && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
      }) && descriptors[PERMIT_BRAND] !== undefined && "value" in descriptors[PERMIT_BRAND]! && descriptors[PERMIT_BRAND]!.value === true;
  } catch { return false; }
}

function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function fail(code: OwnerVideo2AudioOneShotPolicyErrorCode): never { throw new OwnerVideo2AudioOneShotPolicyError(code); }
