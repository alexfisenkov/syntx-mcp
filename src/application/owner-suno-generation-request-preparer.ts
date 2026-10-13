import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  OwnerSunoGenerationParametersError,
  getOwnerSunoGenerationParameterSource,
  normalizeOwnerSunoGenerationParameters,
  type OwnerSunoGenerationModel,
  type OwnerSunoGenerationParameterSource,
  type OwnerSunoGenerationSettingsCandidate,
  type OwnerSunoNormalizedGenerationParameters
} from "./owner-suno-generation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const BRAND: unique symbol = Symbol("OwnerSunoGenerationPreparedCandidate");
const CANDIDATES = new WeakMap<object, CandidateState>();
const PREPARERS = new WeakSet<object>();

export interface OwnerSunoGenerationPreparedCandidate {
  readonly [BRAND]: true;
  readonly status: "prepared";
  readonly attempt_id: string;
  readonly model_id: OwnerSunoGenerationModel;
  readonly mode: "generate";
  readonly source_profile_id: "owner-suno-generate-parameters-source-v1";
  readonly source_profile_schema_hash: string;
  readonly source_pins: OwnerSunoGenerationParameterSource["source_pins"];
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface PrepareOwnerSunoGenerationRequestInput {
  readonly attemptId: string;
  readonly normalized: OwnerSunoNormalizedGenerationParameters;
}

export interface OwnerSunoGenerationPrivateRequest {
  readonly ai_name: "suno";
  readonly prompt: string;
  readonly settings: OwnerSunoGenerationSettingsCandidate;
}

export interface OwnerSunoGenerationCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerSunoGenerationModel;
  readonly mode: "generate";
  readonly source_profile_id: "owner-suno-generate-parameters-source-v1";
  readonly source_profile_schema_hash: string;
  readonly source_pins: OwnerSunoGenerationParameterSource["source_pins"];
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly private_request_hash: string;
}

export interface OwnerSunoGenerationRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly now?: () => number;
}

export type OwnerSunoGenerationRequestPreparerErrorCode =
  | "INVALID_REQUEST"
  | "LINK_SERVICE_UNTRUSTED"
  | "PRINCIPAL_NOT_LINKED"
  | "NORMALIZED_CANDIDATE_INVALID"
  | "SOURCE_EVIDENCE_UNAVAILABLE"
  | "SOURCE_EVIDENCE_CHANGED"
  | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH"
  | "ATTEMPT_INVALIDATED"
  | "CLOCK_INVALID"
  | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED"
  | "PRIVATE_REQUEST_ALREADY_CONSUMED";

export class OwnerSunoGenerationRequestPreparerError extends Error {
  constructor(readonly code: OwnerSunoGenerationRequestPreparerErrorCode) {
    super("The Suno generate candidate could not be prepared safely.");
    this.name = "OwnerSunoGenerationRequestPreparerError";
  }
}

interface CandidateState {
  readonly candidate: OwnerSunoGenerationPreparedCandidate;
  readonly owner: object;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly sourceProfileSchemaHash: string;
  readonly expiresAt: number;
  readonly intentFingerprint: string;
  privateRequest: OwnerSunoGenerationPrivateRequest | null;
  privateRequestHash: string;
  lastNow: number;
}

/** Source-bound private preparation only; it borrows and never closes the owner link service. */
export class OwnerSunoGenerationRequestPreparer {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: PerUserLinkService;
  readonly #now: () => number;
  readonly #owner = Object.freeze({});
  readonly #active = new Map<object, CandidateState>();
  readonly #invalidatedAttempts = new Set<string>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(optionsInput: OwnerSunoGenerationRequestPreparerOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService"], "INVALID_REQUEST", ["now"]);
    if (!isPerUserLinkService(fields.linkService)) fail("LINK_SERVICE_UNTRUSTED");
    if (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now))) invalid();
    this.#binding = readBinding(fields.binding);
    this.#linkService = fields.linkService;
    this.#now = fields.now === undefined ? Date.now : fields.now as () => number;
    PREPARERS.add(this);
    Object.freeze(this);
  }

  async prepare(inputInput: PrepareOwnerSunoGenerationRequestInput | unknown): Promise<OwnerSunoGenerationPreparedCandidate> {
    this.#assertOpen();
    const input = exactRecord(inputInput, ["attemptId", "normalized"]);
    const attemptId = readAttempt(input.attemptId);
    if (this.#invalidatedAttempts.has(attemptId)) fail("ATTEMPT_INVALIDATED");
    const normalized = validateNormalizedCandidate(input.normalized);
    if (this.#active.size >= MAX_CANDIDATES) this.#prune();
    if (this.#active.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");

    let principal: Readonly<GenerationPrincipalRef>;
    try {
      principal = await resolveOwnerReferencePrincipal({
        binding: this.#binding,
        attemptId,
        linkService: this.#linkService
      });
    } catch (error) {
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRINCIPAL_NOT_LINKED");
    }
    this.#assertOpen();
    if (this.#invalidatedAttempts.has(attemptId)) fail("ATTEMPT_INVALIDATED");
    const now = this.#readNow();
    if (this.#active.size >= MAX_CANDIDATES) {
      this.#prune(now);
      if (this.#active.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
    }

    const sourceProfile = getSourceProfile();
    if (normalized.profile_id !== sourceProfile.profile_id ||
        !isDeepStrictEqual(normalized.source_pins, sourceProfile.source_pins)) fail("SOURCE_EVIDENCE_CHANGED");
    const sourceProfileSchemaHash = schemaHash(sourceProfile);
    const privateRequest = buildPrivateRequest(normalized);
    const privateRequestHash = schemaHash(privateRequest);
    const intentFingerprint = fingerprintIntent(principal, normalized, sourceProfileSchemaHash);
    const expiresAt = now + TTL_MS;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail("CLOCK_INVALID");
    const candidate: OwnerSunoGenerationPreparedCandidate = Object.freeze({
      [BRAND]: true as const,
      status: "prepared",
      attempt_id: attemptId,
      model_id: normalized.model_id,
      mode: "generate",
      source_profile_id: sourceProfile.profile_id,
      source_profile_schema_hash: sourceProfileSchemaHash,
      source_pins: sourceProfile.source_pins,
      expires_at: expiresAt,
      intent_fingerprint: intentFingerprint,
      runtime_usable: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    const state: CandidateState = {
      candidate,
      owner: this.#owner,
      attemptId,
      principal,
      sourceProfileSchemaHash,
      expiresAt,
      intentFingerprint,
      privateRequest,
      privateRequestHash,
      lastNow: now
    };
    CANDIDATES.set(candidate, state);
    this.#active.set(candidate, state);
    return candidate;
  }

  inspectCandidate(candidate: unknown): OwnerSunoGenerationCandidateBinding | undefined {
    this.#assertOpen();
    const state = this.#state(candidate, false);
    return state ? bindingOf(state) : undefined;
  }

  revalidateCandidate(input: unknown): OwnerSunoGenerationCandidateBinding {
    this.#assertOpen();
    const fields = exactRecord(input, ["candidate", "attemptId", "principal"]);
    const attemptId = readAttempt(fields.attemptId);
    const principal = readPrincipal(fields.principal, attemptId);
    const state = this.#state(fields.candidate, true);
    if (state.attemptId !== attemptId || !sameGenerationPrincipal(state.principal, principal)) fail("PRINCIPAL_MISMATCH");
    if (this.#invalidatedAttempts.has(attemptId)) fail("ATTEMPT_INVALIDATED");
    const now = this.#readNow();
    if (state.expiresAt <= now || state.lastNow > now) {
      this.#drop(state);
      fail("CANDIDATE_EXPIRED");
    }
    const sourceProfile = getSourceProfile();
    if (schemaHash(sourceProfile) !== state.sourceProfileSchemaHash ||
        !isDeepStrictEqual(sourceProfile.source_pins, state.candidate.source_pins)) {
      this.#drop(state);
      fail("SOURCE_EVIDENCE_CHANGED");
    }
    if (!state.privateRequest ||
        schemaHash(state.privateRequest) !== state.privateRequestHash ||
        state.privateRequest.settings.model_type !== state.candidate.model_id ||
        state.privateRequest.settings.mode !== state.candidate.mode ||
        state.candidate.intent_fingerprint !== state.intentFingerprint ||
        state.candidate.source_profile_schema_hash !== state.sourceProfileSchemaHash ||
        !isDeepStrictEqual(sourceProfile.source_pins, state.candidate.source_pins)) {
      this.#drop(state);
      fail("CANDIDATE_UNBOUND");
    }
    state.lastNow = now;
    return bindingOf(state);
  }

  invalidateAttempt(attemptIdInput: unknown): void {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return;
    this.#invalidatedAttempts.add(attemptIdInput);
    for (const state of this.#active.values()) {
      if (state.attemptId === attemptIdInput) this.#drop(state);
    }
  }

  close(): void {
    this.#closed = true;
    for (const state of this.#active.values()) this.#drop(state);
    this.#active.clear();
    this.#invalidatedAttempts.clear();
  }

  /** Internal synchronous take used only after the one-shot policy has revalidated the permit. */
  consumePrivateRequestForOneShot(input: unknown): OwnerSunoGenerationPrivateRequest {
    this.#assertOpen();
    const fields = exactRecord(input, ["candidate", "attemptId", "principal"]);
    const attemptId = readAttempt(fields.attemptId);
    const principal = readPrincipal(fields.principal, attemptId);
    const state = this.#state(fields.candidate, true);
    if (state.attemptId !== attemptId || !sameGenerationPrincipal(state.principal, principal)) fail("PRINCIPAL_MISMATCH");
    if (this.#invalidatedAttempts.has(attemptId)) fail("ATTEMPT_INVALIDATED");
    const now = this.#readNow();
    if (state.expiresAt <= now || state.lastNow > now) fail("CANDIDATE_EXPIRED");
    const sourceProfile = getSourceProfile();
    if (schemaHash(sourceProfile) !== state.sourceProfileSchemaHash) fail("SOURCE_EVIDENCE_CHANGED");
    const request = state.privateRequest;
    if (!request || schemaHash(request) !== state.privateRequestHash) fail("PRIVATE_REQUEST_ALREADY_CONSUMED");
    state.privateRequest = null;
    state.privateRequestHash = "";
    this.#active.delete(state.candidate);
    return request;
  }

  #state(value: unknown, throwOnFailure: true): CandidateState;
  #state(value: unknown, throwOnFailure: false): CandidateState | undefined;
  #state(value: unknown, throwOnFailure: boolean): CandidateState | undefined {
    if (!value || typeof value !== "object" || isProxy(value)) {
      if (throwOnFailure) fail("CANDIDATE_UNBOUND");
      return undefined;
    }
    const state = CANDIDATES.get(value);
    if (!state || state.owner !== this.#owner || state.candidate !== value || this.#active.get(value) !== state ||
        !Object.isFrozen(value)) {
      if (throwOnFailure) fail("CANDIDATE_UNBOUND");
      return undefined;
    }
    const now = this.#readNow();
    if (state.expiresAt <= now || state.lastNow > now || !state.privateRequest) {
      this.#drop(state);
      if (throwOnFailure) fail("CANDIDATE_EXPIRED");
      return undefined;
    }
    return state;
  }

  #drop(state: CandidateState): void {
    state.privateRequest = null;
    state.privateRequestHash = "";
    this.#active.delete(state.candidate);
  }

  #prune(nowInput?: number): void {
    const now = nowInput ?? this.#readNow();
    for (const state of this.#active.values()) {
      if (state.expiresAt <= now) this.#drop(state);
    }
  }

  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value;
    return value;
  }

  #assertOpen(): void {
    if (this.#closed || !PREPARERS.has(this)) fail("SERVICE_CLOSED");
  }
}

export function isOwnerSunoGenerationRequestPreparer(value: unknown): value is OwnerSunoGenerationRequestPreparer {
  try {
    return !!value && typeof value === "object" && !isProxy(value) && PREPARERS.has(value) &&
      Object.getPrototypeOf(value) === OwnerSunoGenerationRequestPreparer.prototype;
  } catch { return false; }
}

export function isOwnerSunoGenerationPreparedCandidate(value: unknown): value is OwnerSunoGenerationPreparedCandidate {
  try {
    if (!value || typeof value !== "object" || isProxy(value) || !Object.isFrozen(value)) return false;
    const state = CANDIDATES.get(value);
    return !!state && state.candidate === value && state.privateRequest !== null;
  } catch { return false; }
}

export function getOwnerSunoGenerationPrivateRequestForOneShot(
  preparerInput: unknown,
  candidate: unknown,
  attemptIdInput: unknown,
  principalInput: unknown
): OwnerSunoGenerationPrivateRequest {
  if (!isOwnerSunoGenerationRequestPreparer(preparerInput)) fail("LINK_SERVICE_UNTRUSTED");
  return preparerInput.consumePrivateRequestForOneShot({
    candidate,
    attemptId: attemptIdInput,
    principal: principalInput
  });
}

function validateNormalizedCandidate(input: unknown): OwnerSunoNormalizedGenerationParameters {
  const fields = exactRecord(input, [
    "profile_id", "model_id", "mode", "prompt", "settings_candidate", "source_pins",
    "runtime_usable", "dispatch_allowed", "backend_acceptance"
  ], "NORMALIZED_CANDIDATE_INVALID");
  const settings = exactRecord(fields.settings_candidate, [
    "model_type", "mode", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title"
  ], "NORMALIZED_CANDIDATE_INVALID");
  const pins = exactRecord(fields.source_pins, [
    "public_catalog_version", "public_models_sha256", "settings_inventory_version", "build_id",
    "form_module", "form_bytes", "form_sha256"
  ], "NORMALIZED_CANDIDATE_INVALID");
  const request = {
    model_id: fields.model_id,
    mode: fields.mode,
    prompt: fields.prompt,
    is_custom_mode: settings.is_custom_mode,
    is_instrumental: settings.is_instrumental,
    negative_tags: settings.negative_tags,
    styles: settings.styles,
    title: settings.title
  };
  let expected: OwnerSunoNormalizedGenerationParameters;
  try { expected = normalizeOwnerSunoGenerationParameters(request); }
  catch (error) {
    if (error instanceof OwnerSunoGenerationParametersError && error.code === "SOURCE_EVIDENCE_UNAVAILABLE") {
      fail("SOURCE_EVIDENCE_UNAVAILABLE");
    }
    fail("NORMALIZED_CANDIDATE_INVALID");
  }
  const snapshot = {
    profile_id: fields.profile_id,
    model_id: fields.model_id,
    mode: fields.mode,
    prompt: fields.prompt,
    settings_candidate: {
      model_type: settings.model_type,
      mode: settings.mode,
      is_custom_mode: settings.is_custom_mode,
      is_instrumental: settings.is_instrumental,
      negative_tags: settings.negative_tags,
      styles: settings.styles,
      title: settings.title
    },
    source_pins: {
      public_catalog_version: pins.public_catalog_version,
      public_models_sha256: pins.public_models_sha256,
      settings_inventory_version: pins.settings_inventory_version,
      build_id: pins.build_id,
      form_module: pins.form_module,
      form_bytes: pins.form_bytes,
      form_sha256: pins.form_sha256
    },
    runtime_usable: fields.runtime_usable,
    dispatch_allowed: fields.dispatch_allowed,
    backend_acceptance: fields.backend_acceptance
  };
  if (!isDeepStrictEqual(snapshot, expected)) fail("NORMALIZED_CANDIDATE_INVALID");
  return expected;
}

function buildPrivateRequest(normalized: OwnerSunoNormalizedGenerationParameters): OwnerSunoGenerationPrivateRequest {
  const settings = Object.freeze({
    model_type: normalized.model_id,
    mode: "generate" as const,
    is_custom_mode: normalized.settings_candidate.is_custom_mode,
    is_instrumental: normalized.settings_candidate.is_instrumental,
    negative_tags: normalized.settings_candidate.negative_tags,
    styles: normalized.settings_candidate.styles,
    title: normalized.settings_candidate.title
  });
  return Object.freeze({ ai_name: "suno" as const, prompt: normalized.prompt, settings });
}

function fingerprintIntent(
  principal: Readonly<GenerationPrincipalRef>,
  normalized: OwnerSunoNormalizedGenerationParameters,
  sourceProfileSchemaHash: string
): string {
  const intent = normalized.settings_candidate;
  const value = [
    "owner-suno-generate-intent-v1",
    principal.tenant_id,
    principal.subject_id,
    sourceProfileSchemaHash,
    normalized.source_pins.public_catalog_version,
    normalized.source_pins.settings_inventory_version,
    normalized.source_pins.form_sha256,
    normalized.model_id,
    normalized.mode,
    normalized.prompt,
    intent.is_custom_mode,
    intent.is_instrumental,
    intent.negative_tags,
    intent.styles,
    intent.title
  ];
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function getSourceProfile(): OwnerSunoGenerationParameterSource {
  try { return getOwnerSunoGenerationParameterSource(); }
  catch { return fail("SOURCE_EVIDENCE_UNAVAILABLE"); }
}

function bindingOf(state: CandidateState): OwnerSunoGenerationCandidateBinding {
  return Object.freeze({
    attempt_id: state.attemptId,
    principal: state.principal,
    model_id: state.candidate.model_id,
    mode: "generate",
    source_profile_id: state.candidate.source_profile_id,
    source_profile_schema_hash: state.sourceProfileSchemaHash,
    source_pins: state.candidate.source_pins,
    expires_at: state.expiresAt,
    intent_fingerprint: state.intentFingerprint,
    private_request_hash: state.privateRequestHash
  });
}

function isPerUserLinkService(value: unknown): value is PerUserLinkService {
  try {
    return !!value && typeof value === "object" && !isProxy(value) &&
      Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
      getDataMethod(value, "getStatus") === PerUserLinkService.prototype.getStatus;
  } catch { return false; }
}

function getDataMethod(value: object, key: string): unknown {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function readBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id.trim() || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject.trim() || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
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

function exactRecord(
  value: unknown,
  required: readonly string[],
  errorCode: OwnerSunoGenerationRequestPreparerErrorCode = "INVALID_REQUEST",
  optional: readonly string[] = []
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(errorCode);
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail(errorCode); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length < required.length || keys.length > required.length + optional.length ||
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail(errorCode);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function fail(code: OwnerSunoGenerationRequestPreparerErrorCode): never {
  throw new OwnerSunoGenerationRequestPreparerError(code);
}
function invalid(): never { return fail("INVALID_REQUEST"); }
