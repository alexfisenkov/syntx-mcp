import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerHailuo02I2vPreparedCandidate, isOwnerHailuo02I2vRequestPreparer,
  type OwnerHailuo02I2vCandidateBinding, type OwnerHailuo02I2vPreparedCandidate,
  type OwnerHailuo02I2vPreparedRequest, type OwnerHailuo02I2vRequestPreparer
} from "./owner-hailuo02-i2v-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerHailuo02I2vOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const issued = new WeakSet<object>();
const issuing = new WeakSet<object>();

export interface OwnerHailuo02I2vOneShotPermitInput {
  readonly preparer: OwnerHailuo02I2vRequestPreparer; readonly candidate: OwnerHailuo02I2vPreparedCandidate;
  readonly principal: GenerationPrincipalRef; readonly attemptId: string;
}
export interface OwnerHailuo02I2vOneShotPermit extends Readonly<{
  status: "nominal"; dispatch_allowed: false; runtime_usable: false; backend_acceptance: "UNPROVEN";
  profile_schema_hash: string; request_fingerprint: string; intent_fingerprint: string; expires_at: number;
}> { readonly [BRAND]: true }
export interface OwnerHailuo02I2vOneShotPermitContext extends OwnerHailuo02I2vOneShotPermitInput { readonly permit: OwnerHailuo02I2vOneShotPermit }
export interface OwnerHailuo02I2vOneShotReceipt {
  readonly status: "consumed"; readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
  readonly request_fingerprint: string; readonly request: OwnerHailuo02I2vPreparedRequest;
}
export type OwnerHailuo02I2vOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" |
  "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" |
  "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";
export class OwnerHailuo02I2vOneShotPolicyError extends Error {
  constructor(readonly code: OwnerHailuo02I2vOneShotPolicyErrorCode) { super("The owned Hailuo-02 I2V one-shot receipt could not be satisfied safely."); this.name = "OwnerHailuo02I2vOneShotPolicyError"; }
}
interface PermitState {
  readonly permit: OwnerHailuo02I2vOneShotPermit; readonly preparer: OwnerHailuo02I2vRequestPreparer;
  readonly candidate: OwnerHailuo02I2vPreparedCandidate; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string; readonly binding: Readonly<OwnerHailuo02I2vCandidateBinding>;
  readonly bindingHash: string; readonly requestHash: string; revalidated: boolean; consumed: boolean;
}

/** A local, single-use receipt only. It never grants runtime or provider dispatch authority. */
export async function createOwnerHailuo02I2vOneShotPermit(inputInput: OwnerHailuo02I2vOneShotPermitInput | unknown): Promise<OwnerHailuo02I2vOneShotPermit> {
  const input = readInput(inputInput);
  if (issued.has(input.candidate) || issuing.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const binding = currentBinding(input.preparer, input.candidate); assertCandidate(input.candidate, binding, input.principal, input.attemptId);
  const bindingHash = schemaHash(binding), requestHash = schemaHash(input.preparer.getPrivateRequest(input.candidate)); issuing.add(input.candidate);
  try {
    const permit = Object.freeze({ [BRAND]: true as const, status: "nominal" as const, dispatch_allowed: false as const,
      runtime_usable: false as const, backend_acceptance: "UNPROVEN" as const, profile_schema_hash: binding.profile_schema_hash,
      request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint, expires_at: binding.expires_at });
    permits.set(permit, { permit, ...input, binding, bindingHash, requestHash, revalidated: false, consumed: false });
    issued.add(input.candidate); return permit;
  } finally { issuing.delete(input.candidate); }
}

export async function revalidateOwnerHailuo02I2vOneShotPermit(inputInput: OwnerHailuo02I2vOneShotPermitContext | unknown): Promise<void> {
  const state = readPermitInput(inputInput); state.revalidated = false;
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate); assertSameBinding(state.binding, fresh);
    assertCandidate(state.candidate, fresh, state.principal, state.attemptId);
    if (schemaHash(fresh) !== state.bindingHash || schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
    assertPermit(state); state.revalidated = true;
  } catch (error) { state.revalidated = false; if (error instanceof OwnerHailuo02I2vOneShotPolicyError) throw error; fail("CANDIDATE_EXPIRED"); }
}

/** Synchronously burns the permit and returns its private request for one immediate caller-owned POST. */
export function consumeOwnerHailuo02I2vOneShotPermit(inputInput: OwnerHailuo02I2vOneShotPermitContext | unknown): OwnerHailuo02I2vOneShotReceipt {
  const state = readPermitInput(inputInput); if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED"); assertPermit(state);
  state.consumed = true; state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    request_fingerprint: state.binding.request_fingerprint, request: state.preparer.getPrivateRequest(state.candidate) });
}

function readInput(value: unknown): Readonly<OwnerHailuo02I2vOneShotPermitInput> {
  const f = exact(value, ["preparer", "candidate", "principal", "attemptId"]), preparer = trusted(f.preparer);
  if (!isOwnerHailuo02I2vPreparedCandidate(f.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(f.attemptId), principal = readPrincipal(f.principal, attemptId);
  return Object.freeze({ preparer, candidate: f.candidate, principal, attemptId });
}
function readPermitInput(value: unknown): PermitState {
  const f = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]), preparer = trusted(f.preparer), permit = f.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permits.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerHailuo02I2vOneShotPermit)) fail("PERMIT_INVALID");
  if (state.candidate !== f.candidate) fail("CANDIDATE_MISMATCH");
  if (!isOwnerHailuo02I2vPreparedCandidate(f.candidate)) fail("CANDIDATE_EXPIRED");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(f.attemptId), principal = readPrincipal(f.principal, attemptId);
  if (state.preparer !== preparer || state.attemptId !== attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertCandidate(state.candidate, currentBinding(preparer, state.candidate), principal, attemptId); return state;
}
function trusted(value: unknown): OwnerHailuo02I2vRequestPreparer { if (!isOwnerHailuo02I2vRequestPreparer(value)) fail("PREPARER_UNTRUSTED"); return value; }
function currentBinding(preparer: OwnerHailuo02I2vRequestPreparer, candidate: OwnerHailuo02I2vPreparedCandidate): Readonly<OwnerHailuo02I2vCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate); if (!binding) fail("CANDIDATE_EXPIRED"); return binding;
}
function assertCandidate(candidate: OwnerHailuo02I2vPreparedCandidate, binding: Readonly<OwnerHailuo02I2vCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.model_id !== "hailuo-02" || candidate.profile_schema_hash !== binding.profile_schema_hash ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.expires_at !== binding.expires_at || candidate.image.sha256 !== binding.image_sha256 ||
      schemaHash(candidate.source_binding) !== schemaHash(binding.source_binding)) fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(a: Readonly<OwnerHailuo02I2vCandidateBinding>, b: unknown) { if (schemaHash(a) !== schemaHash(b)) fail("CANDIDATE_MISMATCH"); }
function assertPermit(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate), request = state.preparer.getPrivateRequest(state.candidate);
  if (issued.has(state.candidate) !== true || schemaHash(binding) !== state.bindingHash || schemaHash(request) !== state.requestHash ||
      state.permit.profile_schema_hash !== state.binding.profile_schema_hash || state.permit.request_fingerprint !== state.binding.request_fingerprint ||
      state.permit.intent_fingerprint !== state.binding.intent_fingerprint || state.permit.expires_at !== state.binding.expires_at ||
      state.permit.dispatch_allowed !== false || state.permit.runtime_usable !== false || state.permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}
function hasPermitShape(value: OwnerHailuo02I2vOneShotPermit): boolean {
  try { const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
    return Object.isFrozen(value) && keys.length === 9 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "runtime_usable", "backend_acceptance", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"].every(k => {
        const x = d[k]; return !!x && "value" in x && x.enumerable && !x.writable && !x.configurable;
      }) && !!d[BRAND] && "value" in d[BRAND]! && d[BRAND]!.value === true;
  } catch { return false; }
}
function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let p: Readonly<GenerationPrincipalRef>; try { p = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (p.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH"); return p;
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(d);
  if ((proto !== Object.prototype && proto !== null) || actual.length !== keys.length || actual.some(k => typeof k !== "string" || !keys.includes(k) || !d[k]!.enumerable || !("value" in d[k]!))) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, unknown>; for (const key of keys) out[key] = d[key]!.value; return out;
}
function fail(code: OwnerHailuo02I2vOneShotPolicyErrorCode): never { throw new OwnerHailuo02I2vOneShotPolicyError(code); }
