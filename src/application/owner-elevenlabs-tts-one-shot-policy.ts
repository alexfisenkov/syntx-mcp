import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { schemaHash } from "../domain/generation-contract.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  getOwnerElevenLabsGenerationParameterProfile,
  OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
  OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION
} from "./owner-elevenlabs-generation-parameters.js";
import {
  getOwnerElevenLabsTtsPrivateRequestForPolicy,
  isOwnerElevenLabsTtsRequestPreparer,
  type OwnerElevenLabsTtsCandidateBinding,
  type OwnerElevenLabsTtsPreparedCandidate,
  type OwnerElevenLabsTtsPrivateRequest,
  type OwnerElevenLabsTtsRequestPreparer
} from "./owner-elevenlabs-tts-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MAX_CLAIMS = 128;
const PERMIT_BRAND: unique symbol = Symbol("OwnerElevenLabsTtsOneShotPermit");
const PERMITS = new WeakMap<object, PermitState>();
const ISSUED_FOR_CANDIDATE = new WeakMap<object, PermitState>();
const POLICIES = new WeakSet<object>();

export interface OwnerElevenLabsTtsOneShotPermit {
  readonly [PERMIT_BRAND]: true;
  readonly status: "nominal";
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly voice_epoch: number;
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
  readonly public_catalog_version: typeof OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface CreateOwnerElevenLabsTtsOneShotPermitInput {
  readonly candidate: OwnerElevenLabsTtsPreparedCandidate;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
}

export interface RevalidateOwnerElevenLabsTtsOneShotPermitInput extends CreateOwnerElevenLabsTtsOneShotPermitInput {
  readonly permit: OwnerElevenLabsTtsOneShotPermit;
}

export interface OwnerElevenLabsTtsOneShotReceipt {
  readonly status: "revalidated" | "consumed";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly intent_fingerprint: string;
  readonly private_request?: OwnerElevenLabsTtsPrivateRequest;
}

export interface OwnerElevenLabsTtsOneShotPolicyOptions {
  readonly preparer: OwnerElevenLabsTtsRequestPreparer;
  readonly now?: () => number;
}

export type OwnerElevenLabsTtsOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "INTENT_ALREADY_CLAIMED" | "CAPACITY_EXCEEDED" | "PERMIT_INVALID"
  | "PERMIT_ALREADY_CONSUMED" | "PERMIT_RELEASED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH"
  | "CLOCK_INVALID" | "POLICY_CLOSED" | "ATTEMPT_INVALIDATED";

export class OwnerElevenLabsTtsOneShotPolicyError extends Error {
  constructor(readonly code: OwnerElevenLabsTtsOneShotPolicyErrorCode) {
    super("The ElevenLabs TTS one-shot policy could not be satisfied safely.");
    this.name = "OwnerElevenLabsTtsOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerElevenLabsTtsOneShotPermit;
  readonly policy: OwnerElevenLabsTtsOneShotPolicy;
  readonly preparer: OwnerElevenLabsTtsRequestPreparer;
  readonly candidate: OwnerElevenLabsTtsPreparedCandidate;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<OwnerElevenLabsTtsCandidateBinding>;
  readonly bindingHash: string;
  readonly privateRequestHash: string;
  readonly semanticKey: string;
  revalidated: boolean;
  consumed: boolean;
  released: boolean;
}

/** A nominal local permit only. It never implies provider acceptance or actual dispatch authority. */
export class OwnerElevenLabsTtsOneShotPolicy {
  readonly #preparer: OwnerElevenLabsTtsRequestPreparer;
  readonly #now: () => number;
  readonly #claims = new Map<string, PermitState>();
  readonly #states = new Set<PermitState>();
  readonly #invalidatedAttempts = new Set<string>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(optionsInput: unknown) {
    const fields = exactRecord(optionsInput, ["preparer"], ["now"]);
    if (!isOwnerElevenLabsTtsRequestPreparer(fields.preparer)) fail("PREPARER_UNTRUSTED");
    if (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) fail("INVALID_REQUEST");
    this.#preparer = fields.preparer;
    this.#now = fields.now === undefined ? Date.now : fields.now as () => number;
    POLICIES.add(this);
    Object.freeze(this);
  }

  createPermit(input: CreateOwnerElevenLabsTtsOneShotPermitInput | unknown): OwnerElevenLabsTtsOneShotPermit {
    this.#assertOpen();
    const fields = readContext(input);
    if (this.#invalidatedAttempts.has(fields.attemptId)) fail("ATTEMPT_INVALIDATED");
    const binding = this.#readBinding(fields.candidate, fields.attemptId, fields.principal);
    const existing = ISSUED_FOR_CANDIDATE.get(fields.candidate);
    if (existing && !existing.released) fail("INTENT_ALREADY_CLAIMED");
    const semanticKey = JSON.stringify([fields.principal.tenant_id, fields.principal.subject_id, binding.intent_fingerprint]);
    if (this.#claims.has(semanticKey)) fail("INTENT_ALREADY_CLAIMED");
    if (this.#claims.size >= MAX_CLAIMS) fail("CAPACITY_EXCEEDED");
    const privateRequest = getOwnerElevenLabsTtsPrivateRequestForPolicy(fields.candidate);
    const now = this.#readNow();
    if (binding.expires_at <= now) fail("CANDIDATE_EXPIRED");
    const permit: OwnerElevenLabsTtsOneShotPermit = Object.freeze({
      [PERMIT_BRAND]: true as const,
      status: "nominal",
      attempt_id: fields.attemptId,
      principal: fields.principal,
      voice_epoch: binding.voice_epoch,
      expires_at: binding.expires_at,
      intent_fingerprint: binding.intent_fingerprint,
      profile_schema_hash: binding.profile_schema_hash,
      public_catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
      settings_inventory_version: OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    const state: PermitState = {
      permit, policy: this, preparer: this.#preparer, candidate: fields.candidate, attemptId: fields.attemptId,
      principal: fields.principal, binding, bindingHash: schemaHash(binding), privateRequestHash: schemaHash(privateRequest),
      semanticKey, revalidated: false, consumed: false, released: false
    };
    PERMITS.set(permit, state);
    ISSUED_FOR_CANDIDATE.set(fields.candidate, state);
    this.#claims.set(semanticKey, state);
    this.#states.add(state);
    return permit;
  }

  revalidate(input: RevalidateOwnerElevenLabsTtsOneShotPermitInput | unknown): OwnerElevenLabsTtsOneShotReceipt {
    const state = this.#stateFromInput(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) fail("PERMIT_RELEASED");
    this.#assertCurrent(state);
    state.revalidated = true;
    return Object.freeze({ status: "revalidated", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
      intent_fingerprint: state.binding.intent_fingerprint });
  }

  /** Sync final check + one-time private payload extraction for a future caller immediately before its POST. */
  consume(input: RevalidateOwnerElevenLabsTtsOneShotPermitInput | unknown): OwnerElevenLabsTtsOneShotReceipt {
    const state = this.#stateFromInput(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) fail("PERMIT_RELEASED");
    if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
    this.#assertCurrent(state);
    const privateRequest = getOwnerElevenLabsTtsPrivateRequestForPolicy(state.candidate);
    if (schemaHash(privateRequest) !== state.privateRequestHash) fail("CANDIDATE_MISMATCH");
    state.consumed = true;
    return Object.freeze({ status: "consumed", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
      intent_fingerprint: state.binding.intent_fingerprint, private_request: privateRequest });
  }

  /** Release a semantic reservation only for a known pre-dispatch failure. */
  release(input: RevalidateOwnerElevenLabsTtsOneShotPermitInput | unknown): void {
    const state = this.#stateFromInput(input);
    if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
    if (state.released) return;
    state.released = true;
    if (this.#claims.get(state.semanticKey) === state) this.#claims.delete(state.semanticKey);
  }

  invalidateAttempt(attemptIdInput: unknown): void {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return;
    this.#invalidatedAttempts.add(attemptIdInput);
    for (const state of this.#states) {
      if (state.attemptId === attemptIdInput && !state.consumed) {
        state.released = true;
        if (this.#claims.get(state.semanticKey) === state) this.#claims.delete(state.semanticKey);
      }
    }
  }

  close(): void {
    this.#closed = true;
    this.#claims.clear();
    this.#states.clear();
    this.#invalidatedAttempts.clear();
  }

  #readBinding(candidate: OwnerElevenLabsTtsPreparedCandidate, attemptId: string,
    principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerElevenLabsTtsCandidateBinding> {
    const current = this.#preparer.revalidateCandidate({ candidate, attemptId, principal });
    if (current.attempt_id !== attemptId || !sameGenerationPrincipal(current.principal, principal) ||
        current.profile_schema_hash !== schemaHash(getOwnerElevenLabsGenerationParameterProfile()) ||
        current.intent_fingerprint !== candidate.intent_fingerprint || current.expires_at !== candidate.expires_at ||
        candidate.public_catalog_version !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION ||
        candidate.settings_inventory_version !== OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION ||
        candidate.dispatch_allowed !== false || candidate.generation_allowed !== false || candidate.backend_acceptance !== "UNPROVEN") {
      fail("CANDIDATE_MISMATCH");
    }
    return current;
  }

  #stateFromInput(input: unknown): PermitState {
    this.#assertOpen();
    const fields = exactRecord(input, ["permit", "candidate", "attemptId", "principal"]);
    const context = readContext({ candidate: fields.candidate, attemptId: fields.attemptId, principal: fields.principal });
    const permit = fields.permit as OwnerElevenLabsTtsOneShotPermit;
    if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
    const state = PERMITS.get(permit);
    if (!state || state.policy !== this || state.preparer !== this.#preparer || state.permit !== permit) fail("PERMIT_INVALID");
    if (state.candidate !== context.candidate || state.attemptId !== context.attemptId ||
        !sameGenerationPrincipal(state.principal, context.principal) ||
        this.#claims.get(state.semanticKey) !== state || ISSUED_FOR_CANDIDATE.get(state.candidate) !== state) fail("CANDIDATE_MISMATCH");
    if (permit.status !== "nominal" || permit.attempt_id !== state.attemptId ||
        !sameGenerationPrincipal(permit.principal, state.principal) || permit.voice_epoch !== state.binding.voice_epoch ||
        permit.expires_at !== state.binding.expires_at || permit.dispatch_allowed !== false || permit.backend_acceptance !== "UNPROVEN" ||
        permit.intent_fingerprint !== state.binding.intent_fingerprint || permit.profile_schema_hash !== state.binding.profile_schema_hash ||
        permit.public_catalog_version !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION ||
        permit.settings_inventory_version !== OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION) fail("PERMIT_INVALID");
    return state;
  }

  #assertCurrent(state: PermitState): void {
    if (this.#invalidatedAttempts.has(state.attemptId)) fail("ATTEMPT_INVALIDATED");
    if (state.policy !== this || this.#claims.get(state.semanticKey) !== state || state.released) fail("PERMIT_INVALID");
    if (state.binding.expires_at <= this.#readNow()) fail("CANDIDATE_EXPIRED");
    const current = this.#readBinding(state.candidate, state.attemptId, state.principal);
    if (schemaHash(current) !== state.bindingHash ||
        schemaHash(getOwnerElevenLabsTtsPrivateRequestForPolicy(state.candidate)) !== state.privateRequestHash) fail("CANDIDATE_MISMATCH");
  }

  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value;
    return value;
  }
  #assertOpen(): void { if (this.#closed || !POLICIES.has(this)) fail("POLICY_CLOSED"); }
}

function readContext(input: unknown): { candidate: OwnerElevenLabsTtsPreparedCandidate; attemptId: string; principal: Readonly<GenerationPrincipalRef> } {
  const fields = exactRecord(input, ["candidate", "attemptId", "principal"]);
  if (!fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) || !Object.isFrozen(fields.candidate)) {
    fail("CANDIDATE_UNBOUND");
  }
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) fail("INVALID_REQUEST");
  const principal = readPrincipal(fields.principal, fields.attemptId);
  return { candidate: fields.candidate as OwnerElevenLabsTtsPreparedCandidate, attemptId: fields.attemptId, principal };
}
function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length < required.length || keys.some((key) => typeof key !== "string" ||
      (!required.includes(key) && !optional.includes(key)) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function fail(code: OwnerElevenLabsTtsOneShotPolicyErrorCode): never { throw new OwnerElevenLabsTtsOneShotPolicyError(code); }
