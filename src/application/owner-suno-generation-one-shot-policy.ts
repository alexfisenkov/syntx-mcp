import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerSunoGenerationPrivateRequestForOneShot,
  isOwnerSunoGenerationRequestPreparer,
  type OwnerSunoGenerationCandidateBinding,
  type OwnerSunoGenerationPreparedCandidate,
  type OwnerSunoGenerationPrivateRequest,
  type OwnerSunoGenerationRequestPreparer
} from "./owner-suno-generation-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MAX_CLAIMS = 128;
const PERMIT_BRAND: unique symbol = Symbol("OwnerSunoGenerationOneShotPermit");
const PERMITS = new WeakMap<object, PermitState>();
const ISSUED_FOR_CANDIDATE = new WeakMap<object, PermitState>();
const POLICIES = new WeakSet<object>();

export interface OwnerSunoGenerationOneShotPermit {
  readonly [PERMIT_BRAND]: true;
  readonly status: "nominal";
  readonly attempt_id: string;
  readonly model_id: OwnerSunoGenerationCandidateBinding["model_id"];
  readonly expires_at: number;
  readonly source_profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerSunoGenerationOneShotContext {
  readonly candidate: OwnerSunoGenerationPreparedCandidate;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
}

export interface OwnerSunoGenerationOneShotPermitContext extends OwnerSunoGenerationOneShotContext {
  readonly permit: OwnerSunoGenerationOneShotPermit;
}

export interface OwnerSunoGenerationOneShotReceipt {
  readonly status: "revalidated" | "consumed";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly intent_fingerprint: string;
  readonly private_request?: OwnerSunoGenerationPrivateRequest;
}

export interface OwnerSunoGenerationOneShotPolicyOptions {
  readonly preparer: OwnerSunoGenerationRequestPreparer;
  readonly now?: () => number;
}

export type OwnerSunoGenerationOneShotPolicyErrorCode =
  | "INVALID_REQUEST"
  | "PREPARER_UNTRUSTED"
  | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH"
  | "INTENT_ALREADY_CLAIMED"
  | "CAPACITY_EXCEEDED"
  | "PERMIT_INVALID"
  | "PERMIT_ALREADY_CONSUMED"
  | "PERMIT_RELEASED"
  | "PERMIT_NOT_REVALIDATED"
  | "CANDIDATE_MISMATCH"
  | "CLOCK_INVALID"
  | "POLICY_CLOSED"
  | "ATTEMPT_INVALIDATED";

export class OwnerSunoGenerationOneShotPolicyError extends Error {
  constructor(readonly code: OwnerSunoGenerationOneShotPolicyErrorCode) {
    super("The Suno generation one-shot policy could not be satisfied safely.");
    this.name = "OwnerSunoGenerationOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerSunoGenerationOneShotPermit;
  readonly policy: OwnerSunoGenerationOneShotPolicy;
  readonly preparer: OwnerSunoGenerationRequestPreparer;
  readonly candidate: OwnerSunoGenerationPreparedCandidate;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<OwnerSunoGenerationCandidateBinding>;
  readonly bindingHash: string;
  readonly semanticKey: string;
  readonly privateRequestHash: string;
  revalidated: boolean;
  consumed: boolean;
  released: boolean;
}

/** Local one-shot reservation only; it is not provider dispatch authority. */
export class OwnerSunoGenerationOneShotPolicy {
  readonly #preparer: OwnerSunoGenerationRequestPreparer;
  readonly #now: () => number;
  readonly #claims = new Map<string, PermitState>();
  readonly #states = new Set<PermitState>();
  readonly #invalidatedAttempts = new Set<string>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(optionsInput: OwnerSunoGenerationOneShotPolicyOptions | unknown) {
    const fields = exactRecord(optionsInput, ["preparer"], ["now"]);
    if (!isOwnerSunoGenerationRequestPreparer(fields.preparer)) fail("PREPARER_UNTRUSTED");
    if (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) invalid();
    this.#preparer = fields.preparer;
    this.#now = fields.now === undefined ? Date.now : fields.now as () => number;
    POLICIES.add(this);
    Object.freeze(this);
  }

  createPermit(input: OwnerSunoGenerationOneShotContext | unknown): OwnerSunoGenerationOneShotPermit {
    this.#assertOpen();
    const context = readContext(input);
    if (this.#invalidatedAttempts.has(context.attemptId)) fail("ATTEMPT_INVALIDATED");
    const binding = this.#readBinding(context.candidate, context.attemptId, context.principal);
    const existing = ISSUED_FOR_CANDIDATE.get(context.candidate);
    if (existing && !existing.released) fail("INTENT_ALREADY_CLAIMED");
    const now = this.#readNow();
    if (binding.expires_at <= now) fail("CANDIDATE_EXPIRED");
    this.#prune(now);
    const semanticKey = JSON.stringify([
      context.principal.tenant_id,
      context.principal.subject_id,
      binding.intent_fingerprint
    ]);
    if (this.#claims.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
    if (this.#claims.size >= MAX_CLAIMS) fail("CAPACITY_EXCEEDED");

    const privateRequestHash = binding.private_request_hash;
    const permit: OwnerSunoGenerationOneShotPermit = Object.freeze({
      [PERMIT_BRAND]: true as const,
      status: "nominal",
      attempt_id: context.attemptId,
      model_id: binding.model_id,
      expires_at: binding.expires_at,
      source_profile_schema_hash: binding.source_profile_schema_hash,
      intent_fingerprint: binding.intent_fingerprint,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    const state: PermitState = {
      permit,
      policy: this,
      preparer: this.#preparer,
      candidate: context.candidate,
      attemptId: context.attemptId,
      principal: context.principal,
      binding,
      bindingHash: schemaHash(binding),
      semanticKey,
      privateRequestHash,
      revalidated: false,
      consumed: false,
      released: false
    };
    PERMITS.set(permit, state);
    ISSUED_FOR_CANDIDATE.set(context.candidate, state);
    this.#claims.set(semanticKey, state);
    this.#states.add(state);
    return permit;
  }

  revalidate(input: OwnerSunoGenerationOneShotPermitContext | unknown): OwnerSunoGenerationOneShotReceipt {
    const state = this.#stateFromInput(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) fail("PERMIT_RELEASED");
    this.#assertCurrent(state);
    state.revalidated = true;
    return Object.freeze({
      status: "revalidated",
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN",
      intent_fingerprint: state.binding.intent_fingerprint
    });
  }

  /** Final synchronous single-consumption boundary; private request is returned once and may still not be dispatched. */
  consume(input: OwnerSunoGenerationOneShotPermitContext | unknown): OwnerSunoGenerationOneShotReceipt {
    const state = this.#stateFromInput(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) fail("PERMIT_RELEASED");
    if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
    this.#assertCurrent(state);
    const privateRequest = getOwnerSunoGenerationPrivateRequestForOneShot(
      state.preparer, state.candidate, state.attemptId, state.principal
    );
    if (schemaHash(privateRequest) !== state.privateRequestHash) fail("CANDIDATE_MISMATCH");
    state.consumed = true;
    state.revalidated = false;
    return Object.freeze({
      status: "consumed",
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN",
      intent_fingerprint: state.binding.intent_fingerprint,
      private_request: privateRequest
    });
  }

  invalidateAttempt(attemptIdInput: unknown): void {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return;
    this.#invalidatedAttempts.add(attemptIdInput);
    for (const state of this.#states) {
      if (state.attemptId === attemptIdInput && !state.consumed) this.#release(state);
    }
  }

  close(): void {
    this.#closed = true;
    for (const state of this.#states) if (!state.consumed) this.#release(state);
  }

  #readBinding(
    candidate: OwnerSunoGenerationPreparedCandidate,
    attemptId: string,
    principal: Readonly<GenerationPrincipalRef>
  ): Readonly<OwnerSunoGenerationCandidateBinding> {
    const current = this.#preparer.revalidateCandidate({ candidate, attemptId, principal });
    if (current.attempt_id !== attemptId || !sameGenerationPrincipal(current.principal, principal) ||
        current.intent_fingerprint !== candidate.intent_fingerprint ||
        current.source_profile_schema_hash !== candidate.source_profile_schema_hash ||
        current.expires_at !== candidate.expires_at || candidate.dispatch_allowed !== false ||
        candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
    return current;
  }

  #stateFromInput(input: unknown): PermitState {
    this.#assertOpen();
    const fields = exactRecord(input, ["permit", "candidate", "attemptId", "principal"]);
    const context = readContext({ candidate: fields.candidate, attemptId: fields.attemptId, principal: fields.principal });
    const permit = fields.permit;
    if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
    const state = PERMITS.get(permit);
    if (!state || state.permit !== permit || state.policy !== this || !hasPermitShape(permit as OwnerSunoGenerationOneShotPermit)) {
      fail("PERMIT_INVALID");
    }
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.preparer !== this.#preparer || context.candidate !== state.candidate) fail("CANDIDATE_MISMATCH");
    if (context.attemptId !== state.attemptId || !sameGenerationPrincipal(context.principal, state.principal)) {
      fail("PRINCIPAL_MISMATCH");
    }
    if (this.#invalidatedAttempts.has(state.attemptId)) fail("ATTEMPT_INVALIDATED");
    if (state.released) fail("PERMIT_RELEASED");
    this.#readBinding(state.candidate, state.attemptId, state.principal);
    return state;
  }

  #assertCurrent(state: PermitState): void {
    const now = this.#readNow();
    if (state.binding.expires_at <= now) fail("CANDIDATE_EXPIRED");
    const current = this.#readBinding(state.candidate, state.attemptId, state.principal);
    if (schemaHash(current) !== state.bindingHash || current.private_request_hash !== state.binding.private_request_hash ||
        current.intent_fingerprint !== state.binding.intent_fingerprint ||
        state.permit.source_profile_schema_hash !== current.source_profile_schema_hash ||
        state.permit.intent_fingerprint !== current.intent_fingerprint ||
        state.permit.expires_at !== current.expires_at ||
        current.private_request_hash !== state.privateRequestHash) fail("CANDIDATE_MISMATCH");
  }

  #prune(now: number): void {
    for (const state of this.#claims.values()) {
      if (!state.consumed && state.binding.expires_at <= now) this.#release(state);
    }
  }

  #release(state: PermitState): void {
    state.released = true;
    state.revalidated = false;
    if (this.#claims.get(state.semanticKey) === state) this.#claims.delete(state.semanticKey);
  }

  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value;
    return value;
  }

  #assertOpen(): void {
    if (this.#closed || !POLICIES.has(this)) fail("POLICY_CLOSED");
  }
}

export function isOwnerSunoGenerationOneShotPolicy(value: unknown): value is OwnerSunoGenerationOneShotPolicy {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && POLICIES.has(value) &&
      Object.getPrototypeOf(value) === OwnerSunoGenerationOneShotPolicy.prototype;
  } catch { return false; }
}

export function isOwnerSunoGenerationOneShotPermit(value: unknown): value is OwnerSunoGenerationOneShotPermit {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value)) return false;
    const state = PERMITS.get(value);
    return !!state && state.permit === value && hasPermitShape(value as OwnerSunoGenerationOneShotPermit);
  } catch { return false; }
}

function readContext(input: unknown): Readonly<OwnerSunoGenerationOneShotContext> {
  const fields = exactRecord(input, ["candidate", "attemptId", "principal"]);
  const attemptId = readAttempt(fields.attemptId);
  const principal = readPrincipal(fields.principal, attemptId);
  if (!fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !Object.isFrozen(fields.candidate)) fail("CANDIDATE_UNBOUND");
  return Object.freeze({
    candidate: fields.candidate as OwnerSunoGenerationPreparedCandidate,
    attemptId,
    principal
  });
}

function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) invalid();
  return value;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length < required.length || keys.length > required.length + optional.length ||
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function hasPermitShape(value: OwnerSunoGenerationOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const expected = [
      "status", "attempt_id", "model_id", "expires_at", "source_profile_schema_hash",
      "intent_fingerprint", "dispatch_allowed", "backend_acceptance"
    ];
    return Object.isFrozen(value) && keys.length === expected.length + 1 && keys.includes(PERMIT_BRAND) &&
      expected.every((key) => {
        const descriptor = descriptors[key];
        return !!descriptor && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
      }) && descriptors[PERMIT_BRAND]?.value === true;
  } catch { return false; }
}

function invalid(): never { return fail("INVALID_REQUEST"); }
function fail(code: OwnerSunoGenerationOneShotPolicyErrorCode): never {
  throw new OwnerSunoGenerationOneShotPolicyError(code);
}
