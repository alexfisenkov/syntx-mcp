import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  OwnerKling4RequestPreparer, isOwnerKling4RequestPreparer, isOwnerKling4PreparedCandidate,
  type OwnerKling4PreparedCandidate, type OwnerKling4CandidateBinding
} from "./owner-kling4-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const BRAND: unique symbol = Symbol("OwnerKling4OneShotPermit");
const PERMITS = new WeakMap<object, State>();
const ISSUED = new WeakMap<object, object>();
const CLAIMED = new Map<string, object>();
const MAX_CLAIMS = 8192;

export interface OwnerKling4OneShotPermitInput {
  readonly preparer: OwnerKling4RequestPreparer;
  readonly candidate: OwnerKling4PreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerKling4OneShotPermit {
  readonly [BRAND]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: OwnerKling4PreparedCandidate["model_id"];
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
}
export interface OwnerKling4OneShotPermitContext extends OwnerKling4OneShotPermitInput {
  readonly permit: OwnerKling4OneShotPermit;
}
export class OwnerKling4OneShotPolicyError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "PRINCIPAL_MISMATCH" | "CANDIDATE_EXPIRED" |
    "CANDIDATE_ALREADY_ISSUED" | "INTENT_ALREADY_CLAIMED" | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED" |
    "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH" | "CAPACITY_EXCEEDED") {
    super("The owner Kling 4 one-shot receipt could not be satisfied safely.");
    this.name = "OwnerKling4OneShotPolicyError";
  }
}
interface Input extends OwnerKling4OneShotPermitInput { readonly principal: Readonly<GenerationPrincipalRef>; }
interface State extends Input {
  readonly permit: OwnerKling4OneShotPermit;
  readonly binding: Readonly<OwnerKling4CandidateBinding>;
  readonly bindingHash: string;
  readonly requestHash: string;
  readonly semanticKey: string;
  revalidated: boolean;
  consumed: boolean;
}

/** Local reservation only. The generation facade separately checks live entitlement and price twice. */
export async function createOwnerKling4OneShotPermit(value: unknown): Promise<OwnerKling4OneShotPermit> {
  const input = readInput(value);
  if (ISSUED.has(input.candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const binding = currentBinding(input);
  const semanticKey = JSON.stringify([input.principal.tenant_id, input.principal.subject_id, binding.intent_fingerprint]);
  if (CLAIMED.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
  const permit: OwnerKling4OneShotPermit = Object.freeze({ [BRAND]: true as const, status: "nominal", dispatch_allowed: false,
    backend_acceptance: "UNPROVEN", model_id: binding.model_id, profile_sha256: binding.profile_sha256,
    request_fingerprint: binding.request_fingerprint, intent_fingerprint: binding.intent_fingerprint, expires_at: binding.expires_at });
  PERMITS.set(permit, { ...input, permit, binding, semanticKey, bindingHash: schemaHash(binding),
    requestHash: schemaHash(input.preparer.getPrivateRequest(input.candidate)), revalidated: false, consumed: false });
  ISSUED.set(input.candidate, permit);
  return permit;
}

export async function revalidateOwnerKling4OneShotPermit(value: unknown): Promise<void> {
  const state = readContext(value);
  state.revalidated = false;
  assertAvailable(state);
  try {
    const fresh = await state.preparer.revalidateCandidate(state.candidate);
    if (schemaHash(fresh) !== state.bindingHash) fail("CANDIDATE_MISMATCH");
    assertCurrent(state); assertAvailable(state); state.revalidated = true;
  } catch (error) {
    state.revalidated = false;
    if (error instanceof OwnerKling4OneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Synchronous final-boundary claim. Unknown POST outcome must never release it. */
export function consumeOwnerKling4OneShotPermit(value: unknown): Readonly<{
  status: "consumed"; dispatch_allowed: false; request_fingerprint: string;
}> {
  const state = readContext(value);
  if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  assertAvailable(state); assertCurrent(state);
  if (CLAIMED.size >= MAX_CLAIMS) fail("CAPACITY_EXCEEDED");
  CLAIMED.set(state.semanticKey, state.permit); state.consumed = true; state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.binding.request_fingerprint });
}

function readInput(value: unknown): Input {
  const fields = exact(value, ["preparer", "candidate", "principal", "attemptId"]);
  return inputFromFields(fields);
}
function inputFromFields(fields: Record<string, unknown>): Input {
  if (!isOwnerKling4RequestPreparer(fields.preparer) || !isOwnerKling4PreparedCandidate(fields.candidate)) fail("CANDIDATE_UNBOUND");
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== fields.attemptId) fail("PRINCIPAL_MISMATCH");
  return Object.freeze({ preparer: fields.preparer, candidate: fields.candidate, principal, attemptId: fields.attemptId });
}
function currentBinding(input: Input): Readonly<OwnerKling4CandidateBinding> {
  const binding = input.preparer.inspectCandidate(input.candidate);
  if (!binding) fail("CANDIDATE_EXPIRED");
  if (binding.attempt_id !== input.attemptId || !sameGenerationPrincipal(binding.principal, input.principal)) fail("PRINCIPAL_MISMATCH");
  const candidate = input.candidate;
  if (candidate.model_id !== binding.model_id || candidate.profile_sha256 !== binding.profile_sha256 ||
      candidate.request_fingerprint !== binding.request_fingerprint || candidate.intent_fingerprint !== binding.intent_fingerprint ||
      candidate.expires_at !== binding.expires_at || candidate.status !== "blocked" || candidate.dispatch_allowed !== false ||
      candidate.backend_acceptance !== "UNPROVEN" || schemaHash(candidate.sources) !== schemaHash(binding.sources)) fail("CANDIDATE_MISMATCH");
  return binding;
}
function readContext(value: unknown): State {
  const fields = exact(value, ["permit", "preparer", "candidate", "principal", "attemptId"]);
  const input = inputFromFields(fields), permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = PERMITS.get(permit);
  if (!state || state.permit !== permit) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.preparer !== input.preparer || state.candidate !== input.candidate) fail("CANDIDATE_MISMATCH");
  if (state.attemptId !== input.attemptId || !sameGenerationPrincipal(state.principal, input.principal)) fail("PRINCIPAL_MISMATCH");
  currentBinding(input); return state;
}
function assertAvailable(state: State): void {
  if (CLAIMED.has(state.semanticKey)) fail("INTENT_ALREADY_CLAIMED");
}
function assertCurrent(state: State): void {
  if (ISSUED.get(state.candidate) !== state.permit || schemaHash(currentBinding(state)) !== state.bindingHash ||
      schemaHash(state.preparer.getPrivateRequest(state.candidate)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
}
function exact(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (prototype !== Object.prototype && prototype !== null || keys.length !== required.length ||
      keys.some(key => typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        !descriptors[key]!.enumerable)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of required) result[key] = descriptors[key]!.value;
  return result;
}
function fail(code: OwnerKling4OneShotPolicyError["code"]): never { throw new OwnerKling4OneShotPolicyError(code); }
