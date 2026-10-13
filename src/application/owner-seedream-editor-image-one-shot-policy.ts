import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerSeedreamEditorImagePreparedCandidate,
  isOwnerSeedreamEditorImageRequestPreparer,
  type OwnerSeedreamEditorImageCandidateBinding,
  type OwnerSeedreamEditorImagePreparedCandidate,
  type OwnerSeedreamEditorImageRequestPreparer
} from "./owner-seedream-editor-image-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerSeedreamEditorImageOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const issuedForCandidate = new WeakMap<object, object>();

export interface CreateOwnerSeedreamEditorImageOneShotPermitInput {
  readonly preparer: OwnerSeedreamEditorImageRequestPreparer; readonly candidate: OwnerSeedreamEditorImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef; readonly attemptId: string;
}
/** A local nominal receipt only; it is never a spend, provider, or dispatch grant. */
export interface OwnerSeedreamEditorImageOneShotPermit {
  readonly [BRAND]: true; readonly status: "nominal"; readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string; readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly expires_at: number;
}
export interface RevalidateOwnerSeedreamEditorImageOneShotPermitInput {
  readonly permit: OwnerSeedreamEditorImageOneShotPermit; readonly candidate: OwnerSeedreamEditorImagePreparedCandidate;
  readonly preparer: OwnerSeedreamEditorImageRequestPreparer; readonly principal: GenerationPrincipalRef; readonly attemptId: string;
}
export interface ConsumeOwnerSeedreamEditorImageOneShotPermitInput extends RevalidateOwnerSeedreamEditorImageOneShotPermitInput {}
export interface OwnerSeedreamEditorImageOneShotPermitReceipt {
  readonly status: "consumed"; readonly dispatch_allowed: false; readonly request_fingerprint: string;
}
export type OwnerSeedreamEditorImageOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED"
  | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";
export class OwnerSeedreamEditorImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerSeedreamEditorImageOneShotPolicyErrorCode) {
    super("The Seedream Editor image one-shot policy could not be satisfied safely."); this.name = "OwnerSeedreamEditorImageOneShotPolicyError";
  }
}
interface PermitState {
  readonly permit: OwnerSeedreamEditorImageOneShotPermit; readonly preparer: OwnerSeedreamEditorImageRequestPreparer;
  readonly candidate: OwnerSeedreamEditorImagePreparedCandidate; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string; readonly binding: Readonly<OwnerSeedreamEditorImageCandidateBinding>;
  readonly bindingHash: string; readonly privateRequestHash: string; revalidated: boolean; consumed: boolean;
}

/** Issues one local receipt after verifying a genuine candidate and a fresh actual-reference revalidation. */
export async function createOwnerSeedreamEditorImageOneShotPermit(input: CreateOwnerSeedreamEditorImageOneShotPermitInput | unknown): Promise<OwnerSeedreamEditorImageOneShotPermit> {
  const fields = readInput(input);
  if (issuedForCandidate.has(fields.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const binding = currentBinding(fields.preparer, fields.candidate);
  assertCandidate(fields.candidate, binding, fields.principal, fields.attemptId);
  const privateRequestHash = schemaHash(fields.preparer.getPrivateRequest(fields.candidate));
  const bindingHash = schemaHash(binding);
  try {
    const fresh = await fields.preparer.revalidateCandidate(fields.candidate);
    assertSameBinding(binding, fresh); assertCandidate(fields.candidate, fresh, fields.principal, fields.attemptId);
    if (schemaHash(fields.preparer.getPrivateRequest(fields.candidate)) !== privateRequestHash) fail("CANDIDATE_MISMATCH");
  } catch (error) { if (error instanceof OwnerSeedreamEditorImageOneShotPolicyError) throw error; fail("CANDIDATE_EXPIRED"); }
  const permit = Object.freeze({ [BRAND]: true as const, status: "nominal" as const, dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const, profile_schema_hash: binding.profile_schema_hash,
    request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint, expires_at: binding.expires_at });
  permits.set(permit, { permit, ...fields, binding, bindingHash, privateRequestHash, revalidated: true, consumed: false });
  issuedForCandidate.set(fields.candidate, permit); return permit;
}

/** Refreshes the candidate immediately before the trusted service claims its semantic intent. */
export async function revalidateOwnerSeedreamEditorImageOneShotPermit(input: RevalidateOwnerSeedreamEditorImageOneShotPermitInput | unknown): Promise<void> {
  const { state } = readPermitInput(input); state.revalidated = false;
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    assertSameBinding(state.binding, fresh); assertCandidate(state.candidate, fresh, state.principal, state.attemptId);
    if (schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.privateRequestHash || schemaHash(fresh) !== state.bindingHash) fail("CANDIDATE_MISMATCH");
    assertPermit(state); state.revalidated = true;
  } catch (error) { state.revalidated = false; if (error instanceof OwnerSeedreamEditorImageOneShotPolicyError) throw error; fail("CANDIDATE_EXPIRED"); }
}

/** Burns this local receipt once; a future generation service must still perform account/model preflight and semantic claim. */
export function consumeOwnerSeedreamEditorImageOneShotPermit(input: ConsumeOwnerSeedreamEditorImageOneShotPermitInput | unknown): OwnerSeedreamEditorImageOneShotPermitReceipt {
  const { state } = readPermitInput(input); if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  assertPermit(state); state.consumed = true; state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.binding.request_fingerprint });
}

function readInput(value: unknown): Readonly<CreateOwnerSeedreamEditorImageOneShotPermitInput> {
  const f = exact(value, ["preparer", "candidate", "principal", "attemptId"]);
  const preparer = trustedPreparer(f.preparer), candidate = f.candidate as OwnerSeedreamEditorImagePreparedCandidate;
  if (!isOwnerSeedreamEditorImagePreparedCandidate(candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(f.attemptId), principal = readPrincipal(f.principal, attemptId);
  return Object.freeze({ preparer, candidate, principal, attemptId });
}
function readPermitInput(value: unknown): { state: PermitState } {
  const f = exact(value, ["permit", "candidate", "preparer", "principal", "attemptId"]), preparer = trustedPreparer(f.preparer);
  const candidate = f.candidate as OwnerSeedreamEditorImagePreparedCandidate, permit = f.permit;
  if (!isOwnerSeedreamEditorImagePreparedCandidate(candidate) || !permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permits.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerSeedreamEditorImageOneShotPermit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  const attemptId = readAttempt(f.attemptId), principal = readPrincipal(f.principal, attemptId);
  if (preparer !== state.preparer || candidate !== state.candidate) fail("CANDIDATE_MISMATCH");
  if (attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertCandidate(candidate, currentBinding(preparer, candidate), principal, attemptId); return { state };
}
function trustedPreparer(value: unknown): OwnerSeedreamEditorImageRequestPreparer {
  if (!isOwnerSeedreamEditorImageRequestPreparer(value)) fail("PREPARER_UNTRUSTED"); return value;
}
function currentBinding(preparer: OwnerSeedreamEditorImageRequestPreparer, candidate: OwnerSeedreamEditorImagePreparedCandidate): Readonly<OwnerSeedreamEditorImageCandidateBinding> {
  const value = preparer.inspectCandidate(candidate); if (!value) fail("CANDIDATE_EXPIRED"); return value;
}
function assertCandidate(candidate: OwnerSeedreamEditorImagePreparedCandidate, binding: Readonly<OwnerSeedreamEditorImageCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  const generationBinding = binding.source_binding.generation as Record<string, unknown> | undefined;
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.variant !== binding.variant || candidate.profile_id !== binding.profile_id ||
      candidate.profile_schema_hash !== binding.profile_schema_hash || candidate.request_fingerprint !== binding.request_fingerprint ||
      candidate.intent_fingerprint !== binding.intent_fingerprint || candidate.expires_at !== binding.expires_at ||
      schemaHash(candidate.source_binding) !== schemaHash(binding.source_binding) || schemaHash(candidate.parameters) !== schemaHash(binding.parameters) ||
      schemaHash(candidate.cost_route) !== schemaHash(binding.cost_route) || schemaHash(candidate.cost_inputs) !== schemaHash(binding.cost_inputs) ||
      !candidate.references.some((reference) => reference.role === "original" && reference.sha256 === binding.original_sha256) ||
      (binding.drawing_sha256 !== null && !candidate.references.some((reference) => reference.role === "drawing" && reference.sha256 === binding.drawing_sha256)) ||
      candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      !generationBinding || generationBinding.public_catalog_version !== "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json" ||
      generationBinding.settings_inventory_version !== "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json") fail("CANDIDATE_MISMATCH");
}
function assertSameBinding(a: Readonly<OwnerSeedreamEditorImageCandidateBinding>, b: unknown): void {
  if (!b || typeof b !== "object" || !isDeepEqual(a, b)) fail("CANDIDATE_MISMATCH");
}
function assertPermit(state: PermitState): void {
  const current = currentBinding(state.preparer, state.candidate), privateRequest = state.preparer.getPrivateRequest(state.candidate);
  if (issuedForCandidate.get(state.candidate) !== state.permit || schemaHash(current) !== state.bindingHash ||
      schemaHash(privateRequest) !== state.privateRequestHash || state.permit.profile_schema_hash !== state.binding.profile_schema_hash ||
      state.permit.request_fingerprint !== state.binding.request_fingerprint || state.permit.intent_fingerprint !== state.binding.intent_fingerprint ||
      state.permit.expires_at !== state.binding.expires_at || state.permit.dispatch_allowed !== false || state.permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}
function hasPermitShape(value: OwnerSeedreamEditorImageOneShotPermit): boolean {
  try { const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d); return Object.isFrozen(value) && keys.length === 8 && keys.includes(BRAND) &&
    ["status", "dispatch_allowed", "backend_acceptance", "profile_schema_hash", "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
      const x = d[key]; return !!x && "value" in x && x.enumerable && !x.writable && !x.configurable;
    }) && d[BRAND] !== undefined && "value" in d[BRAND]! && d[BRAND]!.value === true; } catch { return false; }
}
function readPrincipal(value: unknown, attempt: string): Readonly<GenerationPrincipalRef> { let result: Readonly<GenerationPrincipalRef>;
  try { result = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (result.connection_id !== attempt) fail("PRINCIPAL_MISMATCH"); return result; }
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) fail("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(d);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in d[key]!) || !d[key]!.enumerable)) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, unknown>; for (const key of keys) out[key] = d[key]!.value; return out;
}
function isDeepEqual(a: unknown, b: unknown): boolean { return schemaHash(a) === schemaHash(b); }
function fail(code: OwnerSeedreamEditorImageOneShotPolicyErrorCode): never { throw new OwnerSeedreamEditorImageOneShotPolicyError(code); }
