import { createHash } from "node:crypto";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  getOwnerElevenLabsDialoguePrivateRequestForPolicy,
  isOwnerElevenLabsDialogueRequestPreparer,
  type OwnerElevenLabsDialoguePreparedCandidate,
  type OwnerElevenLabsDialoguePrivateRequest,
  type OwnerElevenLabsDialogueRequestPreparer
} from "./owner-elevenlabs-dialogue-request-preparer.js";

const PERMITS = new WeakMap<object, PermitState>();
const POLICIES = new WeakSet<object>();
const MAX_CLAIMS = 128;

export interface OwnerElevenLabsDialogueOneShotPermit {
  readonly status: "nominal";
  readonly attempt_id: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerElevenLabsDialoguePermitInput {
  readonly candidate: OwnerElevenLabsDialoguePreparedCandidate;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
}
export interface OwnerElevenLabsDialogueOneShotPolicyOptions { readonly preparer: OwnerElevenLabsDialogueRequestPreparer; readonly now?: () => number; }
export type OwnerElevenLabsDialogueOneShotPolicyErrorCode = "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED" | "PRINCIPAL_MISMATCH" | "INTENT_ALREADY_CLAIMED" | "CAPACITY_EXCEEDED"
  | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED" | "PERMIT_RELEASED" | "PERMIT_NOT_REVALIDATED"
  | "CANDIDATE_MISMATCH" | "CLOCK_INVALID" | "POLICY_CLOSED" | "ATTEMPT_INVALIDATED";
export class OwnerElevenLabsDialogueOneShotPolicyError extends Error {
  constructor(readonly code: OwnerElevenLabsDialogueOneShotPolicyErrorCode) {
    super("The ElevenLabs dialogue one-shot policy could not be satisfied safely.");
    this.name = "OwnerElevenLabsDialogueOneShotPolicyError";
  }
}
interface PermitState {
  readonly permit: OwnerElevenLabsDialogueOneShotPermit; readonly policy: OwnerElevenLabsDialogueOneShotPolicy;
  readonly candidate: OwnerElevenLabsDialoguePreparedCandidate; readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly requestHash: string; readonly claimKey: string;
  revalidated: boolean; consumed: boolean; released: boolean;
}
export interface OwnerElevenLabsDialogueOneShotReceipt {
  readonly status: "revalidated" | "consumed"; readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN";
  readonly intent_fingerprint: string; readonly private_request?: OwnerElevenLabsDialoguePrivateRequest;
}

/** Dialogue-only one-shot reservation. A consumed permit never authorizes a second POST. */
export class OwnerElevenLabsDialogueOneShotPolicy {
  readonly #preparer: OwnerElevenLabsDialogueRequestPreparer;
  readonly #now: () => number;
  readonly #claims = new Map<string, PermitState>();
  readonly #states = new Set<PermitState>();
  readonly #invalidated = new Set<string>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(input: OwnerElevenLabsDialogueOneShotPolicyOptions | unknown) {
    const row = exactRecord(input, ["preparer"], ["now"]);
    if (!isOwnerElevenLabsDialogueRequestPreparer(row.preparer)) fail("PREPARER_UNTRUSTED");
    if (row.now !== undefined && (typeof row.now !== "function" || types.isProxy(row.now))) fail("INVALID_REQUEST");
    this.#preparer = row.preparer;
    this.#now = row.now === undefined ? Date.now : row.now as () => number;
    POLICIES.add(this);
    Object.freeze(this);
  }

  createPermit(input: OwnerElevenLabsDialoguePermitInput | unknown): OwnerElevenLabsDialogueOneShotPermit {
    this.#assertOpen();
    const fields = context(input);
    if (this.#invalidated.has(fields.attemptId)) fail("ATTEMPT_INVALIDATED");
    const binding = this.#preparer.inspectCandidate(fields.candidate);
    if (!binding) fail("CANDIDATE_UNBOUND");
    if (binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, fields.principal)) fail("PRINCIPAL_MISMATCH");
    const now = this.#readNow();
    if (binding.expires_at <= now) fail("CANDIDATE_EXPIRED");
    const claimKey = hash(JSON.stringify([fields.principal.tenant_id, fields.principal.subject_id, binding.intent_fingerprint]));
    if (this.#claims.has(claimKey)) fail("INTENT_ALREADY_CLAIMED");
    if (this.#claims.size >= MAX_CLAIMS) fail("CAPACITY_EXCEEDED");
    const request = getOwnerElevenLabsDialoguePrivateRequestForPolicy(fields.candidate);
    const permit = Object.freeze({ status: "nominal" as const, attempt_id: fields.attemptId,
      intent_fingerprint: binding.intent_fingerprint, expires_at: binding.expires_at,
      dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const });
    const state: PermitState = { permit, policy: this, candidate: fields.candidate, attemptId: fields.attemptId,
      principal: fields.principal, requestHash: hash(JSON.stringify(request)), claimKey,
      revalidated: false, consumed: false, released: false };
    PERMITS.set(permit, state); this.#claims.set(claimKey, state); this.#states.add(state);
    return permit;
  }

  revalidate(input: OwnerElevenLabsDialoguePermitInput & { readonly permit: OwnerElevenLabsDialogueOneShotPermit } | unknown): OwnerElevenLabsDialogueOneShotReceipt {
    const state = this.#state(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) fail("PERMIT_RELEASED");
    this.#assertCurrent(state);
    state.revalidated = true;
    return Object.freeze({ status: "revalidated", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
      intent_fingerprint: state.permit.intent_fingerprint });
  }

  consume(input: OwnerElevenLabsDialoguePermitInput & { readonly permit: OwnerElevenLabsDialogueOneShotPermit } | unknown): OwnerElevenLabsDialogueOneShotReceipt {
    const state = this.#state(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) fail("PERMIT_RELEASED");
    if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
    this.#assertCurrent(state);
    const request = getOwnerElevenLabsDialoguePrivateRequestForPolicy(state.candidate);
    if (hash(JSON.stringify(request)) !== state.requestHash) fail("CANDIDATE_MISMATCH");
    state.consumed = true;
    return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
      intent_fingerprint: state.permit.intent_fingerprint, private_request: request });
  }

  release(input: OwnerElevenLabsDialoguePermitInput & { readonly permit: OwnerElevenLabsDialogueOneShotPermit } | unknown): void {
    const state = this.#state(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) return;
    state.released = true;
    if (this.#claims.get(state.claimKey) === state) this.#claims.delete(state.claimKey);
  }

  invalidateAttempt(attemptId: string): void {
    if (!/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId)) return;
    this.#invalidated.add(attemptId);
    for (const state of this.#states) if (state.attemptId === attemptId && !state.consumed) {
      state.released = true; if (this.#claims.get(state.claimKey) === state) this.#claims.delete(state.claimKey);
    }
  }
  close(): void { this.#closed = true; this.#claims.clear(); this.#states.clear(); this.#invalidated.clear(); }

  #state(input: unknown): PermitState {
    this.#assertOpen();
    const fields = exactRecord(input, ["candidate", "attemptId", "principal", "permit"]);
    const parsed = context({ candidate: fields.candidate, attemptId: fields.attemptId, principal: fields.principal });
    const state = fields.permit && typeof fields.permit === "object" && !types.isProxy(fields.permit) ? PERMITS.get(fields.permit) : undefined;
    if (!state || state.policy !== this || state.candidate !== parsed.candidate || state.attemptId !== parsed.attemptId ||
        !sameGenerationPrincipal(state.principal, parsed.principal) || state.permit !== fields.permit) fail("PERMIT_INVALID");
    return state;
  }
  #assertCurrent(state: PermitState): void {
    if (this.#invalidated.has(state.attemptId)) fail("ATTEMPT_INVALIDATED");
    const binding = this.#preparer.revalidateCandidate({ candidate: state.candidate, attemptId: state.attemptId, principal: state.principal });
    if (binding.intent_fingerprint !== state.permit.intent_fingerprint || binding.expires_at !== state.permit.expires_at ||
        binding.expires_at <= this.#readNow()) fail("CANDIDATE_MISMATCH");
  }
  #readNow(): number {
    let value: number;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { return fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value; return value;
  }
  #assertOpen(): void { if (this.#closed || !POLICIES.has(this)) fail("POLICY_CLOSED"); }
}

function context(value: unknown): { candidate: OwnerElevenLabsDialoguePreparedCandidate; attemptId: string; principal: Readonly<GenerationPrincipalRef> } {
  const row = exactRecord(value, ["candidate", "attemptId", "principal"]);
  if (!row.candidate || typeof row.candidate !== "object" || types.isProxy(row.candidate) ||
      typeof row.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attemptId)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try {
    principal = snapshotGenerationPrincipal(row.principal as GenerationPrincipalRef);
    if (principal.connection_id !== row.attemptId) fail("INVALID_REQUEST");
  } catch { return fail("INVALID_REQUEST"); }
  return { candidate: row.candidate as OwnerElevenLabsDialoguePreparedCandidate, attemptId: row.attemptId, principal };
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  if ((proto !== Object.prototype && proto !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors) as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function hash(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function fail(code: OwnerElevenLabsDialogueOneShotPolicyErrorCode): never { throw new OwnerElevenLabsDialogueOneShotPolicyError(code); }
