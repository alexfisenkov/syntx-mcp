import { types } from "node:util";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isOwnerKlingMotionControlPreparedCandidate, isOwnerKlingMotionControlRequestPreparer, type OwnerKlingMotionControlCandidateBinding,
  type OwnerKlingMotionControlPreparedCandidate, type OwnerKlingMotionControlPrivateRequest, type OwnerKlingMotionControlRequestPreparer } from "./owner-kling-motion-control-request-preparer.js";

const permits = new WeakMap<object, PermitState>();
const issued = new WeakSet<object>();
const issuing = new WeakSet<object>();
const issuedIntents = new Set<string>();
const issuingIntents = new Set<string>();
export interface CreateOwnerKlingMotionControlOneShotPermitInput { readonly preparer: OwnerKlingMotionControlRequestPreparer;
  readonly candidate: OwnerKlingMotionControlPreparedCandidate; readonly principal: object; readonly attemptId: string }
export interface OwnerKlingMotionControlOneShotPermit { readonly status: "nominal"; readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
  readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly expires_at: number }
export interface OwnerKlingMotionControlOneShotPermitContext extends CreateOwnerKlingMotionControlOneShotPermitInput { readonly permit: OwnerKlingMotionControlOneShotPermit }
export interface OwnerKlingMotionControlOneShotReceipt { readonly status: "consumed"; readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
  readonly request_fingerprint: string; readonly request: OwnerKlingMotionControlPrivateRequest }
export type OwnerKlingMotionControlOneShotPolicyErrorCode = "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" |
  "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";
export class OwnerKlingMotionControlOneShotPolicyError extends Error { constructor(readonly code: OwnerKlingMotionControlOneShotPolicyErrorCode) {
  super("The owner Kling Motion Control one-shot permit could not be satisfied safely."); this.name = "OwnerKlingMotionControlOneShotPolicyError"; } }
interface PermitState { readonly permit: OwnerKlingMotionControlOneShotPermit; readonly preparer: OwnerKlingMotionControlRequestPreparer;
  readonly candidate: OwnerKlingMotionControlPreparedCandidate; readonly principal: ReturnType<typeof snapshotGenerationPrincipal>; readonly attempt: string;
  readonly binding: OwnerKlingMotionControlCandidateBinding; consumed: boolean; revalidated: boolean }

export async function createOwnerKlingMotionControlOneShotPermit(value: CreateOwnerKlingMotionControlOneShotPermitInput | unknown): Promise<OwnerKlingMotionControlOneShotPermit> {
  const input = readInput(value), intentKey = JSON.stringify([input.attempt, input.principal.tenant_id, input.principal.subject_id,
    input.principal.connection_id, input.candidate.intent_fingerprint]);
  if (issued.has(input.candidate) || issuing.has(input.candidate) || issuedIntents.has(intentKey) || issuingIntents.has(intentKey)) fail("CANDIDATE_ALREADY_ISSUED");
  issuing.add(input.candidate); issuingIntents.add(intentKey);
  try {
    const binding = bindingFor(input.preparer, input.candidate); assertOwner(binding, input);
    try { await input.preparer.revalidateCandidate(input.candidate); } catch { fail("CANDIDATE_EXPIRED"); }
    const current = bindingFor(input.preparer, input.candidate); assertSame(binding, current); assertOwner(current, input);
    const permit = Object.freeze({ status: "nominal" as const, dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const,
      request_fingerprint: current.request_fingerprint, intent_fingerprint: current.intent_fingerprint, expires_at: current.expires_at });
    permits.set(permit, { permit, ...input, binding: current, consumed: false, revalidated: true }); issued.add(input.candidate); issuedIntents.add(intentKey); return permit;
  } finally { issuing.delete(input.candidate); issuingIntents.delete(intentKey); }
}
export async function revalidateOwnerKlingMotionControlOneShotPermit(value: OwnerKlingMotionControlOneShotPermitContext | unknown): Promise<void> {
  const state = readPermit(value); state.revalidated = false;
  try { const fresh = await state.preparer.revalidateCandidate(state.candidate); assertSame(state.binding, fresh); assertOwner(fresh, state); state.revalidated = true; }
  catch (e) { if (e instanceof OwnerKlingMotionControlOneShotPolicyError) throw e; fail("CANDIDATE_EXPIRED"); }
}
/** Burns the local permit synchronously before handing the exact private request to a future native dispatcher. */
export function consumeOwnerKlingMotionControlOneShotPermit(value: OwnerKlingMotionControlOneShotPermitContext | unknown): OwnerKlingMotionControlOneShotReceipt {
  const state = readPermit(value); if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED"); state.consumed = true; state.revalidated = false;
  const request = state.preparer.getPrivateRequest(state.candidate);
  return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN", request_fingerprint: state.binding.request_fingerprint, request });
}
function readInput(v: unknown): Omit<PermitState,"permit"|"binding"|"consumed"|"revalidated"> {
  const f = exact(v,["preparer","candidate","principal","attemptId"]); if(!isOwnerKlingMotionControlRequestPreparer(f.preparer))fail("PREPARER_UNTRUSTED");
  if(!isOwnerKlingMotionControlPreparedCandidate(f.candidate))fail("CANDIDATE_UNBOUND"); bindingFor(f.preparer,f.candidate);
  if(typeof f.attemptId!=="string")fail("PRINCIPAL_MISMATCH"); let principal; try { principal=snapshotGenerationPrincipal(f.principal as never); } catch { fail("PRINCIPAL_MISMATCH"); }
  return {preparer:f.preparer,candidate:f.candidate,principal,attempt:f.attemptId};
}
function readPermit(v: unknown): PermitState {
  const f=exact(v,["permit","preparer","candidate","principal","attemptId"]); const p=f.permit;
  if(!p||typeof p!=="object"||types.isProxy(p))fail("PERMIT_INVALID"); const s=permits.get(p as object); if(!s||s.permit!==p)fail("PERMIT_INVALID");
  if(s.consumed)fail("PERMIT_ALREADY_CONSUMED"); const input=readInput({preparer:f.preparer,candidate:f.candidate,principal:f.principal,attemptId:f.attemptId});
  if(input.preparer!==s.preparer||input.candidate!==s.candidate||input.attempt!==s.attempt||!sameGenerationPrincipal(input.principal,s.principal))fail("PRINCIPAL_MISMATCH");
  assertOwner(bindingFor(s.preparer,s.candidate),s); if(s.permit.expires_at!==s.binding.expires_at)fail("CANDIDATE_MISMATCH"); return s;
}
function bindingFor(p: OwnerKlingMotionControlRequestPreparer,c: OwnerKlingMotionControlPreparedCandidate): OwnerKlingMotionControlCandidateBinding {
  const b=p.inspectCandidate(c); if(!b||b.candidate!==c)fail("CANDIDATE_EXPIRED"); return b;
}
function assertOwner(b: OwnerKlingMotionControlCandidateBinding,i:{candidate:OwnerKlingMotionControlPreparedCandidate;principal:ReturnType<typeof snapshotGenerationPrincipal>;attempt:string}):void {
  if(b.attempt_id!==i.attempt||!sameGenerationPrincipal(b.principal,i.principal))fail("PRINCIPAL_MISMATCH");
  if(b.candidate!==i.candidate||b.profile_schema_hash!==i.candidate.profile_schema_hash||b.request_fingerprint!==i.candidate.request_fingerprint||
    b.intent_fingerprint!==i.candidate.intent_fingerprint||b.expires_at!==i.candidate.expires_at||i.candidate.dispatch_allowed!==false)fail("CANDIDATE_MISMATCH");
}
function assertSame(a:unknown,b:unknown):void { if(!a||!b||typeof a!=="object"||typeof b!=="object")fail("CANDIDATE_MISMATCH");
  const aa=a as OwnerKlingMotionControlCandidateBinding,bb=b as OwnerKlingMotionControlCandidateBinding;
  if(aa.candidate!==bb.candidate||aa.attempt_id!==bb.attempt_id||aa.request_fingerprint!==bb.request_fingerprint||aa.intent_fingerprint!==bb.intent_fingerprint||aa.expires_at!==bb.expires_at)fail("CANDIDATE_MISMATCH"); }
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v)||types.isProxy(v))fail("CANDIDATE_UNBOUND");
  let ds:PropertyDescriptorMap;try{ds=Object.getOwnPropertyDescriptors(v);}catch{ return fail("CANDIDATE_UNBOUND"); } const own=Reflect.ownKeys(ds);
  if(own.length!==keys.length||own.some(k=>typeof k!=="string"||!keys.includes(k)||!Object.hasOwn(ds[k as string]! ,"value")))fail("CANDIDATE_UNBOUND");
  const out=Object.create(null) as Record<string,unknown>;for(const k of keys)out[k]=ds[k]!.value;return out;}
function fail(code:OwnerKlingMotionControlOneShotPolicyErrorCode):never{throw new OwnerKlingMotionControlOneShotPolicyError(code);}
