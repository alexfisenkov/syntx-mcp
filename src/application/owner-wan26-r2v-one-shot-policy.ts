import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerWan26R2vPreparedCandidate, isOwnerWan26R2vRequestPreparer,
  type OwnerWan26R2vPreparedCandidate, type OwnerWan26R2vPreparedCandidateBinding,
  type OwnerWan26R2vPreparedRequest, type OwnerWan26R2vRequestPreparer
} from "./owner-wan26-r2v-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerWan26R2vOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const issuedCandidates = new WeakSet<object>();
const issuingCandidates = new WeakSet<object>();

export interface OwnerWan26R2vOneShotPermitInput {
  readonly preparer: OwnerWan26R2vRequestPreparer;
  readonly candidate: OwnerWan26R2vPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerWan26R2vOneShotPermit extends Readonly<{
  status: "nominal";
  dispatch_allowed: false;
  backend_acceptance: "UNPROVEN";
  source_readiness: "PARTIAL_SOURCE_EXPLICIT_SETTINGS";
  prompt_readiness: "CURRENT_PROMPT_RULES_NOT_ESTABLISHED";
  settings_readiness: "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED";
  model_id: "wan_26_r2v" | "wan_26_r2v_flash";
  profile_schema_hash: string;
  request_fingerprint: string;
  intent_fingerprint: string;
  expires_at: number;
}> { readonly [BRAND]: true }
export interface OwnerWan26R2vOneShotPermitContext extends OwnerWan26R2vOneShotPermitInput {
  readonly permit: OwnerWan26R2vOneShotPermit;
}
export interface OwnerWan26R2vOneShotReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly request_fingerprint: string;
  readonly request: OwnerWan26R2vPreparedRequest;
}
export type OwnerWan26R2vOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED"
  | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";
export class OwnerWan26R2vOneShotPolicyError extends Error {
  constructor(readonly code: OwnerWan26R2vOneShotPolicyErrorCode) {
    super("The owner WAN 2.6 R2V one-shot permit could not be satisfied safely.");
    this.name = "OwnerWan26R2vOneShotPolicyError";
  }
}
interface PermitState {
  readonly permit: OwnerWan26R2vOneShotPermit;
  readonly preparer: OwnerWan26R2vRequestPreparer;
  readonly candidate: OwnerWan26R2vPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerWan26R2vPreparedCandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  revalidated: boolean;
  revalidating: boolean;
  consumed: boolean;
}

/** A process-local nominal token for one real candidate; it grants no dispatch or provider acceptance. */
export async function createOwnerWan26R2vOneShotPermit(inputInput: OwnerWan26R2vOneShotPermitInput | unknown): Promise<OwnerWan26R2vOneShotPermit> {
  const input = readInput(inputInput);
  if (issuedCandidates.has(input.candidate) || issuingCandidates.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  issuingCandidates.add(input.candidate);
  try {
    const binding = await input.preparer.revalidateCandidate(input.candidate);
    const current = currentBinding(input.preparer, input.candidate);
    assertCandidate(input.candidate, current, input.principal, input.attemptId);
    if (schemaHash(binding) !== schemaHash(current)) fail("CANDIDATE_MISMATCH");
    const request = input.preparer.getPrivateRequest(input.candidate);
    const requestHash = schemaHash(request);
    if (requestHash !== current.private_request_fingerprint || request.settings.model_type !== current.model_id) fail("CANDIDATE_MISMATCH");
    const permit: OwnerWan26R2vOneShotPermit = Object.freeze({ [BRAND]: true as const,
      status: "nominal" as const, dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const,
      source_readiness: input.candidate.source_readiness, prompt_readiness: input.candidate.prompt_readiness,
      settings_readiness: input.candidate.settings_readiness, model_id: current.model_id,
      profile_schema_hash: current.profile_schema_hash, request_fingerprint: current.request_fingerprint,
      intent_fingerprint: current.intent_fingerprint, expires_at: current.expires_at });
    permits.set(permit, { permit, ...input, binding: current, bindingHash: schemaHash(current), requestHash,
      revalidated: false, revalidating: false, consumed: false });
    issuedCandidates.add(input.candidate);
    return permit;
  } finally { issuingCandidates.delete(input.candidate); }
}

export async function revalidateOwnerWan26R2vOneShotPermit(inputInput: OwnerWan26R2vOneShotPermitContext | unknown,
  signal?: AbortSignal): Promise<void> {
  const state = readPermitInput(inputInput);
  if (state.revalidating) fail("PERMIT_NOT_REVALIDATED");
  state.revalidated = false;
  state.revalidating = true;
  try {
    const binding = await state.preparer.revalidateCandidate(state.candidate, signal);
    const current = currentBinding(state.preparer, state.candidate);
    const request = state.preparer.getPrivateRequest(state.candidate);
    assertCandidate(state.candidate, current, state.principal, state.attemptId);
    if (schemaHash(binding) !== schemaHash(current) || schemaHash(current) !== state.bindingHash ||
        schemaHash(request) !== state.requestHash || state.requestHash !== current.private_request_fingerprint) fail("CANDIDATE_MISMATCH");
    assertPermit(state);
    state.revalidated = true;
  } finally { state.revalidating = false; }
}

/** Synchronously burns the permit before returning its private request to the immediate native dispatch. */
export function consumeOwnerWan26R2vOneShotPermit(inputInput: OwnerWan26R2vOneShotPermitContext | unknown): OwnerWan26R2vOneShotReceipt {
  const state = readPermitInput(inputInput);
  if (!state.revalidated || state.revalidating) fail("PERMIT_NOT_REVALIDATED");
  assertPermit(state);
  const request = state.preparer.getPrivateRequest(state.candidate);
  if (schemaHash(request) !== state.requestHash || state.requestHash !== state.binding.private_request_fingerprint) fail("CANDIDATE_MISMATCH");
  state.consumed = true;
  state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    request_fingerprint: state.binding.request_fingerprint, request });
}

function readInput(value: unknown): Readonly<OwnerWan26R2vOneShotPermitInput & { principal: Readonly<GenerationPrincipalRef> }> {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]);
  if (!isOwnerWan26R2vRequestPreparer(fields.preparer)) fail("PREPARER_UNTRUSTED");
  if (!isOwnerWan26R2vPreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal as GenerationPrincipalRef, attemptId);
  return Object.freeze({ preparer: fields.preparer, candidate: fields.candidate, principal, attemptId });
}
function readPermitInput(value: unknown): PermitState {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  if (!isOwnerWan26R2vRequestPreparer(fields.preparer)) fail("PREPARER_UNTRUSTED");
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permits.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerWan26R2vOneShotPermit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.preparer !== fields.preparer || state.candidate !== fields.candidate) fail("CANDIDATE_MISMATCH");
  if (!isOwnerWan26R2vPreparedCandidate(fields.candidate)) fail("CANDIDATE_EXPIRED");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal as GenerationPrincipalRef, attemptId);
  if (state.attemptId !== attemptId || !sameGenerationPrincipal(state.principal, principal)) fail("PRINCIPAL_MISMATCH");
  const binding = currentBinding(state.preparer, state.candidate);
  assertCandidate(state.candidate, binding, state.principal, state.attemptId);
  return state;
}
function currentBinding(preparer: OwnerWan26R2vRequestPreparer, candidate: OwnerWan26R2vPreparedCandidate): Readonly<OwnerWan26R2vPreparedCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate);
  if (!binding) fail("CANDIDATE_EXPIRED");
  return binding;
}
function assertCandidate(candidate: OwnerWan26R2vPreparedCandidate, binding: Readonly<OwnerWan26R2vPreparedCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "prepared" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.source_readiness !== "PARTIAL_SOURCE_EXPLICIT_SETTINGS" ||
      candidate.prompt_readiness !== "CURRENT_PROMPT_RULES_NOT_ESTABLISHED" ||
      candidate.settings_readiness !== "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED" ||
      (candidate.model_id !== "wan_26_r2v" && candidate.model_id !== "wan_26_r2v_flash") ||
      candidate.model_id !== binding.model_id || candidate.profile_schema_hash !== binding.profile_schema_hash ||
      candidate.intent_fingerprint !== binding.intent_fingerprint || candidate.request_fingerprint !== binding.request_fingerprint ||
      candidate.expires_at !== binding.expires_at) fail("CANDIDATE_MISMATCH");
}
function assertPermit(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate);
  const request = state.preparer.getPrivateRequest(state.candidate);
  if (!issuedCandidates.has(state.candidate) || schemaHash(binding) !== state.bindingHash || schemaHash(request) !== state.requestHash ||
      state.requestHash !== binding.private_request_fingerprint || state.permit.model_id !== binding.model_id ||
      state.permit.profile_schema_hash !== binding.profile_schema_hash || state.permit.request_fingerprint !== binding.request_fingerprint ||
      state.permit.intent_fingerprint !== binding.intent_fingerprint || state.permit.expires_at !== binding.expires_at ||
      state.permit.source_readiness !== state.candidate.source_readiness ||
      state.permit.prompt_readiness !== state.candidate.prompt_readiness || state.permit.settings_readiness !== state.candidate.settings_readiness ||
      state.permit.dispatch_allowed !== false || state.permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}
function hasPermitShape(value: OwnerWan26R2vOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(value) && keys.length === 12 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "backend_acceptance", "source_readiness", "prompt_readiness", "settings_readiness",
        "model_id", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
          const descriptor = descriptors[key]; return !!descriptor && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
        }) && !!descriptors[BRAND] && "value" in descriptors[BRAND]! && descriptors[BRAND]!.value === true;
  } catch { return false; }
}
function readPrincipal(value: GenerationPrincipalRef, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length ||
        actual.some((key) => typeof key !== "string" || !keys.includes(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
    const output = Object.create(null) as Record<string, any>;
    for (const key of keys) output[key] = descriptors[key]!.value;
    return output;
  } catch { return fail("INVALID_REQUEST"); }
}
function fail(code: OwnerWan26R2vOneShotPolicyErrorCode): never { throw new OwnerWan26R2vOneShotPolicyError(code); }
