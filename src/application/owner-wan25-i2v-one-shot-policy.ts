import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isOwnerWan25I2vPreparedCandidate, isOwnerWan25I2vRequestPreparer, type OwnerWan25I2vPreparedCandidate,
  type OwnerWan25I2vPreparedCandidateBinding, type OwnerWan25I2vPreparedRequest, type OwnerWan25I2vRequestPreparer } from "./owner-wan25-i2v-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerWan25I2vOneShotPermit");
const PERMITS = new WeakMap<object, PermitState>();
const CLAIMS = new WeakSet<object>();
export interface OwnerWan25I2vOneShotPermitInput { readonly preparer: OwnerWan25I2vRequestPreparer; readonly candidate: OwnerWan25I2vPreparedCandidate;
  readonly principal: GenerationPrincipalRef; readonly attemptId: string }
export interface OwnerWan25I2vOneShotPermit extends Readonly<{ status: "nominal"; dispatch_allowed: false; runtime_usable: false;
  backend_acceptance: "UNPROVEN"; model_id: typeof MODEL_ID; profile_schema_hash: string; request_fingerprint: string;
  intent_fingerprint: string; expires_at: number }> { readonly [BRAND]: true }
const MODEL_ID = "wan_25_i2v_preview" as const;
export interface OwnerWan25I2vOneShotPermitContext extends OwnerWan25I2vOneShotPermitInput { readonly permit: OwnerWan25I2vOneShotPermit }
export interface OwnerWan25I2vOneShotReceipt { readonly status: "consumed"; readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN"; readonly request_fingerprint: string; readonly request: OwnerWan25I2vPreparedRequest }
export type OwnerWan25I2vOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" |
  "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" |
  "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";
export class OwnerWan25I2vOneShotPolicyError extends Error {
  constructor(readonly code: OwnerWan25I2vOneShotPolicyErrorCode) { super("The owner WAN 2.5 I2V preview one-shot permit could not be satisfied safely."); this.name = "OwnerWan25I2vOneShotPolicyError"; }
}
interface PermitState { readonly permit: OwnerWan25I2vOneShotPermit; readonly input: Readonly<OwnerWan25I2vOneShotPermitInput>;
  readonly binding: OwnerWan25I2vPreparedCandidateBinding; readonly requestHash: string; revalidated: boolean; revalidating: boolean; consumed: boolean }

/** Local replay-prevention gate only. It never authorizes or performs provider dispatch. */
export async function createOwnerWan25I2vOneShotPermit(inputValue: OwnerWan25I2vOneShotPermitInput | unknown): Promise<OwnerWan25I2vOneShotPermit> {
  const input = readInput(inputValue), binding = bindingFor(input.preparer, input.candidate); assertCandidate(input, binding);
  if (CLAIMS.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED"); CLAIMS.add(input.candidate);
  try {
    await input.preparer.revalidateCandidate(input.candidate);
    const fresh = bindingFor(input.preparer, input.candidate); assertSameBinding(binding, fresh); assertCandidate(input, fresh);
    const requestHash = schemaHash(input.preparer.getPrivateRequest(input.candidate));
    if (requestHash !== fresh.wire_fingerprint || requestHash !== input.candidate.request_fingerprint) fail("CANDIDATE_MISMATCH");
    const permit: OwnerWan25I2vOneShotPermit = Object.freeze({ [BRAND]: true as const, status: "nominal", dispatch_allowed: false,
      runtime_usable: false, backend_acceptance: "UNPROVEN", model_id: MODEL_ID, profile_schema_hash: fresh.profile_schema_hash,
      request_fingerprint: fresh.request_fingerprint, intent_fingerprint: fresh.intent_fingerprint, expires_at: fresh.expires_at });
    PERMITS.set(permit, { permit, input, binding: fresh, requestHash, revalidated: false, revalidating: false, consumed: false }); return permit;
  } catch (error) { CLAIMS.delete(input.candidate); if (error instanceof OwnerWan25I2vOneShotPolicyError) throw error; fail("CANDIDATE_EXPIRED"); }
}

export async function revalidateOwnerWan25I2vOneShotPermit(value: OwnerWan25I2vOneShotPermitContext | unknown): Promise<void> {
  const state = readPermit(value); if (state.revalidating) fail("PERMIT_NOT_REVALIDATED"); state.revalidating = true; state.revalidated = false;
  try {
    const fresh = await state.input.preparer.revalidateCandidate(state.input.candidate); assertSameBinding(state.binding, fresh);
    assertCandidate(state.input, bindingFor(state.input.preparer, state.input.candidate));
    const requestHash = schemaHash(state.input.preparer.getPrivateRequest(state.input.candidate));
    if (requestHash !== state.requestHash || state.consumed) fail("CANDIDATE_MISMATCH"); state.revalidated = true;
  } catch (error) { if (error instanceof OwnerWan25I2vOneShotPolicyError) throw error; fail("CANDIDATE_EXPIRED"); }
  finally { state.revalidating = false; }
}

/** Burns the permit before returning its private URL-bearing request; dispatch remains explicitly false. */
export function consumeOwnerWan25I2vOneShotPermit(value: OwnerWan25I2vOneShotPermitContext | unknown): OwnerWan25I2vOneShotReceipt {
  const state = readPermit(value); if (!state.revalidated || state.revalidating) fail("PERMIT_NOT_REVALIDATED");
  assertSameBinding(state.binding, bindingFor(state.input.preparer, state.input.candidate)); state.consumed = true; state.revalidated = false;
  const request = state.input.preparer.getPrivateRequest(state.input.candidate);
  if (schemaHash(request) !== state.requestHash) fail("CANDIDATE_MISMATCH");
  return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    request_fingerprint: state.binding.request_fingerprint, request });
}

function readInput(value: unknown): Readonly<OwnerWan25I2vOneShotPermitInput> {
  const f = exactRecord(value, ["preparer", "candidate", "principal", "attemptId"]);
  if (!isOwnerWan25I2vRequestPreparer(f.preparer)) fail("PREPARER_UNTRUSTED");
  if (!isOwnerWan25I2vPreparedCandidate(f.candidate)) fail("CANDIDATE_UNBOUND");
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(f.principal as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== f.attemptId) fail("PRINCIPAL_MISMATCH");
  return Object.freeze({ preparer: f.preparer, candidate: f.candidate, principal, attemptId: f.attemptId });
}
function readPermit(value: unknown): PermitState {
  const f = exactRecord(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  if (!isOwnerWan25I2vRequestPreparer(f.preparer)) fail("PREPARER_UNTRUSTED");
  if (!f.permit || typeof f.permit !== "object" || types.isProxy(f.permit)) fail("PERMIT_INVALID");
  const state = PERMITS.get(f.permit as object); if (!state || state.permit !== f.permit || !permitShape(f.permit as OwnerWan25I2vOneShotPermit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const input = readInput({ preparer: f.preparer, candidate: f.candidate, principal: f.principal, attemptId: f.attemptId });
  if (input.preparer !== state.input.preparer || input.candidate !== state.input.candidate || input.attemptId !== state.input.attemptId ||
      !sameGenerationPrincipal(input.principal, state.input.principal)) fail("CANDIDATE_MISMATCH");
  assertCandidate(state.input, bindingFor(state.input.preparer, state.input.candidate)); return state;
}
function bindingFor(preparer: OwnerWan25I2vRequestPreparer, candidate: OwnerWan25I2vPreparedCandidate): OwnerWan25I2vPreparedCandidateBinding {
  const binding = preparer.inspectCandidate(candidate); if (!binding || binding.candidate !== candidate) fail("CANDIDATE_EXPIRED"); return binding;
}
function assertCandidate(input: Readonly<OwnerWan25I2vOneShotPermitInput>, binding: OwnerWan25I2vPreparedCandidateBinding): void {
  const c = input.candidate; if (binding.attempt_id !== input.attemptId || !sameGenerationPrincipal(binding.principal, input.principal)) fail("PRINCIPAL_MISMATCH");
  if (c.model_id !== MODEL_ID || c.status !== "prepared" || c.dispatch_allowed !== false || c.runtime_usable !== false || c.backend_acceptance !== "UNPROVEN" ||
      c.profile_schema_hash !== binding.profile_schema_hash || c.request_fingerprint !== binding.request_fingerprint ||
      c.intent_fingerprint !== binding.intent_fingerprint || c.expires_at !== binding.expires_at) fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(a: OwnerWan25I2vPreparedCandidateBinding, b: OwnerWan25I2vPreparedCandidateBinding): void {
  if (schemaHash(a) !== schemaHash(b)) fail("CANDIDATE_MISMATCH");
}
function permitShape(value: OwnerWan25I2vOneShotPermit): boolean { try { const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds);
  return Object.isFrozen(value) && keys.length === 10 && keys.includes(BRAND) && ds[BRAND]?.value === true &&
    ["status", "dispatch_allowed", "runtime_usable", "backend_acceptance", "model_id", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"]
      .every((k) => !!ds[k] && "value" in ds[k]! && ds[k]!.enumerable && !ds[k]!.writable && !ds[k]!.configurable); } catch { return false; } }
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let p: object | null; let ds: PropertyDescriptorMap; try { p = Object.getPrototypeOf(value); ds = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const own = Reflect.ownKeys(ds); if ((p !== Object.prototype && p !== null) || own.length !== keys.length || own.some((k) => typeof k !== "string" || !keys.includes(k) ||
    !("value" in ds[k]!) || !ds[k]!.enumerable)) fail("INVALID_REQUEST"); const out = Object.create(null) as Record<string, unknown>;
  for (const key of own as string[]) out[key] = ds[key]!.value; return out; }
function fail(code: OwnerWan25I2vOneShotPolicyErrorCode): never { throw new OwnerWan25I2vOneShotPolicyError(code); }
