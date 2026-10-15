import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  isOwnerWan26I2vPreparedCandidate,
  isOwnerWan26I2vRequestPreparer,
  type OwnerWan26I2vPreparedCandidate,
  type OwnerWan26I2vPreparedCandidateBinding,
  type OwnerWan26I2vPreparedRequest,
  type OwnerWan26I2vRequestPreparer
} from "./owner-wan26-i2v-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MAX_SEMANTIC_CLAIMS = 128;
const BRAND: unique symbol = Symbol("OwnerWan26I2vOneShotPermit");
const PERMITS = new WeakMap<object, PermitState>();
const REGISTRIES = new WeakMap<object, SemanticRegistry>();

export interface OwnerWan26I2vOneShotPermitInput {
  readonly preparer: OwnerWan26I2vRequestPreparer;
  readonly candidate: OwnerWan26I2vPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerWan26I2vOneShotPermit extends Readonly<{
  status: "nominal";
  dispatch_allowed: false;
  runtime_usable: false;
  backend_acceptance: "UNPROVEN";
  model_id: OwnerWan26I2vPreparedCandidate["model_id"];
  profile_schema_hash: string;
  request_fingerprint: string;
  intent_fingerprint: string;
  expires_at: number;
}> { readonly [BRAND]: true }

export interface OwnerWan26I2vOneShotPermitContext extends OwnerWan26I2vOneShotPermitInput {
  readonly permit: OwnerWan26I2vOneShotPermit;
}

export interface OwnerWan26I2vOneShotReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly request_fingerprint: string;
  readonly request: OwnerWan26I2vPreparedRequest;
}

export type OwnerWan26I2vOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH"
  | "CANDIDATE_ALREADY_ISSUED" | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED"
  | "CANDIDATE_MISMATCH" | "CAPACITY_EXCEEDED";

export class OwnerWan26I2vOneShotPolicyError extends Error {
  constructor(readonly code: OwnerWan26I2vOneShotPolicyErrorCode) {
    super("The owner WAN 2.6 I2V one-shot permit could not be satisfied safely.");
    this.name = "OwnerWan26I2vOneShotPolicyError";
  }
}

interface SemanticClaim {
  readonly key: string;
  candidate: OwnerWan26I2vPreparedCandidate | undefined;
  state: "pending" | "issued" | "consumed";
}
interface SemanticRegistry { readonly claims: Map<string, SemanticClaim> }
interface PermitState {
  readonly permit: OwnerWan26I2vOneShotPermit;
  readonly preparer: OwnerWan26I2vRequestPreparer;
  readonly candidate: OwnerWan26I2vPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly claim: SemanticClaim;
  revalidated: boolean;
  revalidating: boolean;
  consumed: boolean;
}

/** Creates a local single-use gate. It is not provider permission or a generation dispatch. */
export async function createOwnerWan26I2vOneShotPermit(inputValue: OwnerWan26I2vOneShotPermitInput | unknown): Promise<OwnerWan26I2vOneShotPermit> {
  const input = readInput(inputValue), binding = currentBinding(input.preparer, input.candidate);
  assertCandidate(input.candidate, binding, input.principal, input.attemptId);
  const registry = registryFor(input.preparer);
  pruneClaims(registry);
  const key = semanticKey(binding);
  if (registry.claims.has(key)) fail("CANDIDATE_ALREADY_ISSUED");
  if (registry.claims.size >= MAX_SEMANTIC_CLAIMS) fail("CAPACITY_EXCEEDED");
  const claim: SemanticClaim = { key, candidate: input.candidate, state: "pending" };
  registry.claims.set(key, claim);
  const bindingHash = schemaHash(binding);
  try {
    await input.preparer.revalidateCandidate(input.candidate);
    const fresh = currentBinding(input.preparer, input.candidate);
    assertSameBinding(binding, fresh); assertCandidate(input.candidate, fresh, input.principal, input.attemptId);
    const request = input.preparer.getPrivateRequest(input.candidate), requestHash = schemaHash(request);
    if (requestHash !== fresh.wire_fingerprint || requestHash !== input.candidate.request_fingerprint || registry.claims.get(key) !== claim) {
      fail("CANDIDATE_MISMATCH");
    }
    const permit: OwnerWan26I2vOneShotPermit = Object.freeze({ [BRAND]: true as const, status: "nominal" as const,
      dispatch_allowed: false as const, runtime_usable: false as const, backend_acceptance: "UNPROVEN" as const,
      model_id: fresh.model_id, profile_schema_hash: fresh.profile_schema_hash, request_fingerprint: fresh.request_fingerprint,
      intent_fingerprint: fresh.intent_fingerprint, expires_at: fresh.expires_at });
    PERMITS.set(permit, { permit, ...input, binding: fresh, bindingHash, requestHash, claim,
      revalidated: false, revalidating: false, consumed: false });
    claim.state = "issued";
    return permit;
  } catch (error) {
    if (registry.claims.get(key) === claim && claim.state === "pending") registry.claims.delete(key);
    if (error instanceof OwnerWan26I2vOneShotPolicyError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "CANDIDATE_EXPIRED") fail("CANDIDATE_EXPIRED");
    fail("CANDIDATE_EXPIRED");
  }
}

export async function revalidateOwnerWan26I2vOneShotPermit(inputValue: OwnerWan26I2vOneShotPermitContext | unknown): Promise<void> {
  const state = readPermit(inputValue);
  if (state.revalidating) fail("PERMIT_NOT_REVALIDATED");
  state.revalidated = false; state.revalidating = true;
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    assertSameBinding(state.binding, fresh); assertCandidate(state.candidate, fresh, state.principal, state.attemptId);
    const requestHash = schemaHash(state.preparer.getPrivateRequest(state.candidate));
    if (requestHash !== state.requestHash || state.claim.state !== "issued" || state.claim.candidate !== state.candidate) fail("CANDIDATE_MISMATCH");
    assertPermitMetadata(state); state.revalidated = true;
  } catch (error) {
    state.revalidated = false;
    if (error instanceof OwnerWan26I2vOneShotPolicyError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "CANDIDATE_EXPIRED") fail("CANDIDATE_EXPIRED");
    fail("CANDIDATE_EXPIRED");
  } finally { state.revalidating = false; }
}

/** Burns the local permit before reading and returning its private URL-bearing request. */
export function consumeOwnerWan26I2vOneShotPermit(inputValue: OwnerWan26I2vOneShotPermitContext | unknown): OwnerWan26I2vOneShotReceipt {
  const state = readPermit(inputValue);
  if (!state.revalidated || state.revalidating) fail("PERMIT_NOT_REVALIDATED");
  assertPermitBinding(state);
  state.consumed = true; state.revalidated = false;
  state.claim.state = "consumed";
  state.claim.candidate = undefined;
  const request = state.preparer.getPrivateRequest(state.candidate);
  if (schemaHash(request) !== state.requestHash) fail("CANDIDATE_MISMATCH");
  return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    request_fingerprint: state.binding.request_fingerprint, request });
}

function readInput(value: unknown): Readonly<OwnerWan26I2vOneShotPermitInput> {
  const fields = exactRecord(value, ["preparer", "candidate", "principal", "attemptId"]);
  if (!isOwnerWan26I2vRequestPreparer(fields.preparer)) fail("PREPARER_UNTRUSTED");
  if (!isOwnerWan26I2vPreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ preparer: fields.preparer, candidate: fields.candidate, principal, attemptId });
}

function readPermit(value: unknown): PermitState {
  const fields = exactRecord(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  if (!isOwnerWan26I2vRequestPreparer(fields.preparer)) fail("PREPARER_UNTRUSTED");
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = PERMITS.get(permit as object);
  if (!state || state.permit !== permit || !hasPermitShape(permit as OwnerWan26I2vOneShotPermit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.preparer !== fields.preparer || state.candidate !== fields.candidate) fail("CANDIDATE_MISMATCH");
  if (!isOwnerWan26I2vPreparedCandidate(fields.candidate)) fail("CANDIDATE_EXPIRED");
  const attemptId = readAttempt(fields.attemptId), principal = readPrincipal(fields.principal, attemptId);
  if (state.attemptId !== attemptId || !sameGenerationPrincipal(state.principal, principal)) fail("PRINCIPAL_MISMATCH");
  const current = currentBinding(state.preparer, state.candidate);
  assertCandidate(state.candidate, current, state.principal, state.attemptId);
  if (state.claim.state !== "issued" || state.claim.candidate !== state.candidate) fail("CANDIDATE_MISMATCH");
  return state;
}

function currentBinding(preparer: OwnerWan26I2vRequestPreparer,
  candidate: OwnerWan26I2vPreparedCandidate): Readonly<OwnerWan26I2vPreparedCandidateBinding> {
  const binding = preparer.inspectCandidate(candidate);
  if (!binding || binding.candidate !== candidate) fail("CANDIDATE_EXPIRED");
  return binding;
}

function assertCandidate(candidate: OwnerWan26I2vPreparedCandidate, binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (candidate.status !== "prepared" || candidate.dispatch_allowed !== false || candidate.runtime_usable !== false ||
      candidate.backend_acceptance !== "UNPROVEN" || candidate.model_id !== binding.model_id ||
      candidate.profile_schema_hash !== binding.profile_schema_hash || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.request_fingerprint !== binding.wire_fingerprint ||
      candidate.expires_at !== binding.expires_at || binding.reference_epoch < 0 || !Number.isSafeInteger(binding.reference_epoch)) {
    fail("CANDIDATE_MISMATCH");
  }
}

function assertSameBinding(left: Readonly<OwnerWan26I2vPreparedCandidateBinding>,
  right: Readonly<OwnerWan26I2vPreparedCandidateBinding>): void {
  if (schemaHash(left) !== schemaHash(right)) fail("CANDIDATE_MISMATCH");
}

function assertPermitMetadata(state: PermitState): void {
  if (state.permit.model_id !== state.binding.model_id || state.permit.profile_schema_hash !== state.binding.profile_schema_hash ||
      state.permit.request_fingerprint !== state.binding.request_fingerprint ||
      state.permit.intent_fingerprint !== state.binding.intent_fingerprint || state.permit.expires_at !== state.binding.expires_at ||
      state.permit.dispatch_allowed !== false || state.permit.runtime_usable !== false || state.permit.backend_acceptance !== "UNPROVEN") {
    fail("CANDIDATE_MISMATCH");
  }
}

function assertPermitBinding(state: PermitState): void {
  const binding = currentBinding(state.preparer, state.candidate);
  assertCandidate(state.candidate, binding, state.principal, state.attemptId);
  if (schemaHash(binding) !== state.bindingHash || binding.request_fingerprint !== state.binding.request_fingerprint ||
      binding.intent_fingerprint !== state.binding.intent_fingerprint || binding.expires_at !== state.binding.expires_at) fail("CANDIDATE_MISMATCH");
  assertPermitMetadata(state);
}

function registryFor(preparer: OwnerWan26I2vRequestPreparer): SemanticRegistry {
  let registry = REGISTRIES.get(preparer as object);
  if (!registry) { registry = { claims: new Map() }; REGISTRIES.set(preparer as object, registry); }
  return registry;
}

function pruneClaims(registry: SemanticRegistry): void {
  for (const [key, claim] of registry.claims) {
    if (claim.state === "consumed") continue;
    if (!claim.candidate || !isOwnerWan26I2vPreparedCandidate(claim.candidate)) registry.claims.delete(key);
  }
}

function semanticKey(binding: Readonly<OwnerWan26I2vPreparedCandidateBinding>): string {
  return JSON.stringify([binding.principal.tenant_id, binding.principal.subject_id, binding.principal.connection_id,
    binding.attempt_id, binding.model_id, binding.intent_fingerprint]);
}

function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}

function hasPermitShape(value: OwnerWan26I2vOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(value) && keys.length === 10 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "runtime_usable", "backend_acceptance", "model_id", "profile_schema_hash",
        "request_fingerprint", "intent_fingerprint", "expires_at"].every((key) => {
        const descriptor = descriptors[key];
        return !!descriptor && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
      }) && !!descriptors[BRAND] && "value" in descriptors[BRAND]! && descriptors[BRAND]!.value === true;
  } catch { return false; }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || own.length !== keys.length ||
        own.some((key) => typeof key !== "string" || !keys.includes(key) || !descriptors[key]!.enumerable || !Object.hasOwn(descriptors[key]!, "value"))) {
      fail("INVALID_REQUEST");
    }
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of own as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return fail("INVALID_REQUEST"); }
}

function fail(code: OwnerWan26I2vOneShotPolicyErrorCode): never { throw new OwnerWan26I2vOneShotPolicyError(code); }
