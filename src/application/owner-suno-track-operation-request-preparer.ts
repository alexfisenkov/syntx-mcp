import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerSunoTrackOperationParameterSource,
  normalizeOwnerSunoTrackOperationParameters,
  type OwnerSunoNormalizedTrackOperationParameters,
  type OwnerSunoTrackOperationModel,
  type OwnerSunoTrackOperationParameterSource,
  type OwnerSunoTrackOperationSettingsCandidate
} from "./owner-suno-track-operation-parameters.js";
import {
  OwnerSunoTrackContextStore,
  OwnerSunoTrackContextStoreError,
  type OwnerSunoTrackContextProjection
} from "./owner-suno-track-context.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const BRAND: unique symbol = Symbol("OwnerSunoTrackOperationPreparedCandidate");
const CANDIDATES = new WeakMap<object, CandidateState>();
const PREPARERS = new WeakSet<object>();

export interface OwnerSunoTrackOperationPreparedCandidate {
  readonly [BRAND]: true;
  readonly status: "prepared";
  readonly attempt_id: string;
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly mode: OwnerSunoNormalizedTrackOperationParameters["mode"];
  readonly source_profile_id: OwnerSunoTrackOperationParameterSource["profile_id"];
  readonly source_profile_schema_hash: string;
  readonly source_pins: OwnerSunoTrackOperationParameterSource["source_pins"];
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface PrepareOwnerSunoTrackOperationRequestInput {
  readonly attemptId: string;
  readonly normalized: OwnerSunoNormalizedTrackOperationParameters;
}

export interface OwnerSunoTrackOperationPrivateRequest {
  readonly ai_name: "suno";
  readonly prompt: string;
  readonly settings: OwnerSunoTrackOperationSettingsCandidate & Readonly<{
    source_clip_id: string;
    source_task_id: string;
  }>;
}

export interface OwnerSunoTrackOperationCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly mode: OwnerSunoNormalizedTrackOperationParameters["mode"];
  readonly source_profile_id: OwnerSunoTrackOperationParameterSource["profile_id"];
  readonly source_profile_schema_hash: string;
  readonly source_pins: OwnerSunoTrackOperationParameterSource["source_pins"];
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly private_request_hash: string;
  readonly track_context_fingerprint: string;
}

export interface OwnerSunoTrackOperationRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly trackContextStore: OwnerSunoTrackContextStore;
  readonly now?: () => number;
}

export type OwnerSunoTrackOperationRequestPreparerErrorCode =
  | "INVALID_REQUEST"
  | "LINK_SERVICE_UNTRUSTED"
  | "TRACK_CONTEXT_STORE_UNTRUSTED"
  | "PRINCIPAL_NOT_LINKED"
  | "NORMALIZED_CANDIDATE_INVALID"
  | "SOURCE_EVIDENCE_UNAVAILABLE"
  | "SOURCE_EVIDENCE_CHANGED"
  | "TRACK_CONTEXT_UNAVAILABLE"
  | "TRACK_CONTEXT_EXPIRED"
  | "TRACK_MODEL_MISMATCH"
  | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH"
  | "ATTEMPT_INVALIDATED"
  | "CLOCK_INVALID"
  | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED"
  | "PRIVATE_REQUEST_ALREADY_CONSUMED";

export class OwnerSunoTrackOperationRequestPreparerError extends Error {
  constructor(readonly code: OwnerSunoTrackOperationRequestPreparerErrorCode) {
    super("The owner Suno track-operation candidate could not be prepared safely.");
    this.name = "OwnerSunoTrackOperationRequestPreparerError";
  }
}

interface CandidateState {
  readonly candidate: OwnerSunoTrackOperationPreparedCandidate;
  readonly owner: object;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly trackHandle: string;
  readonly trackContextFingerprint: string;
  readonly sourceProfileSchemaHash: string;
  readonly expiresAt: number;
  readonly intentFingerprint: string;
  privateRequest: OwnerSunoTrackOperationPrivateRequest | null;
  privateRequestHash: string;
  lastNow: number;
}

/** Private, source-bound preparation. Auth services and track store are borrowed and never closed here. */
export class OwnerSunoTrackOperationRequestPreparer {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: PerUserLinkService;
  readonly #trackContextStore: OwnerSunoTrackContextStore;
  readonly #now: () => number;
  readonly #owner = Object.freeze({});
  readonly #active = new Map<object, CandidateState>();
  readonly #invalidatedAttempts = new Set<string>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(optionsInput: OwnerSunoTrackOperationRequestPreparerOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "trackContextStore"], ["now"]);
    if (!isPerUserLinkService(fields.linkService)) fail("LINK_SERVICE_UNTRUSTED");
    if (!isTrackContextStore(fields.trackContextStore)) fail("TRACK_CONTEXT_STORE_UNTRUSTED");
    if (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) invalid();
    this.#binding = readBinding(fields.binding);
    this.#linkService = fields.linkService;
    this.#trackContextStore = fields.trackContextStore;
    this.#now = fields.now === undefined ? Date.now : fields.now as () => number;
    PREPARERS.add(this);
    Object.freeze(this);
  }

  async prepare(inputInput: PrepareOwnerSunoTrackOperationRequestInput | unknown): Promise<OwnerSunoTrackOperationPreparedCandidate> {
    this.#assertOpen();
    const input = exactRecord(inputInput, ["attemptId", "normalized"]);
    const attemptId = readAttempt(input.attemptId);
    if (this.#invalidatedAttempts.has(attemptId)) fail("ATTEMPT_INVALIDATED");
    const normalized = validateNormalizedCandidate(input.normalized);
    if (this.#active.size >= MAX_CANDIDATES) this.#prune();
    if (this.#active.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");

    let principal: Readonly<GenerationPrincipalRef>;
    try {
      principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    } catch (error) {
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRINCIPAL_NOT_LINKED");
    }
    this.#assertOpen();
    if (this.#invalidatedAttempts.has(attemptId)) fail("ATTEMPT_INVALIDATED");

    let trackContext: Readonly<OwnerSunoTrackContextProjection>;
    try {
      trackContext = this.#trackContextStore.resolve({
        binding: this.#binding, attemptId, principal, trackHandle: normalized.track_handle
      });
    } catch (error) {
      if (error instanceof OwnerSunoTrackContextStoreError && error.code === "TRACK_CONTEXT_EXPIRED") fail("TRACK_CONTEXT_EXPIRED");
      fail("TRACK_CONTEXT_UNAVAILABLE");
    }
    if (trackContext.model_id !== normalized.model_id) fail("TRACK_MODEL_MISMATCH");

    const now = this.#readNow();
    if (this.#active.size >= MAX_CANDIDATES) {
      this.#prune(now);
      if (this.#active.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
    }
    const sourceProfile = getSourceProfile();
    if (normalized.profile_id !== sourceProfile.profile_id ||
        !isDeepStrictEqual(normalized.source_pins, sourceProfile.source_pins)) fail("SOURCE_EVIDENCE_CHANGED");
    const sourceProfileSchemaHash = schemaHash(sourceProfile);
    const trackContextFingerprint = fingerprintTrackContext(trackContext);
    const privateRequest = buildPrivateRequest(normalized, trackContext);
    const privateRequestHash = schemaHash(privateRequest);
    const intentFingerprint = fingerprintIntent(principal, normalized, sourceProfileSchemaHash, trackContext);
    const expiresAt = Math.min(now + TTL_MS, trackContext.expires_at);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail("TRACK_CONTEXT_EXPIRED");
    const candidate: OwnerSunoTrackOperationPreparedCandidate = Object.freeze({
      [BRAND]: true as const,
      status: "prepared",
      attempt_id: attemptId,
      model_id: normalized.model_id,
      mode: normalized.mode,
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
      candidate, owner: this.#owner, attemptId, principal, trackHandle: normalized.track_handle,
      trackContextFingerprint, sourceProfileSchemaHash, expiresAt, intentFingerprint,
      privateRequest, privateRequestHash, lastNow: now
    };
    CANDIDATES.set(candidate, state);
    this.#active.set(candidate, state);
    return candidate;
  }

  inspectCandidate(candidate: unknown): OwnerSunoTrackOperationCandidateBinding | undefined {
    this.#assertOpen();
    const state = this.#state(candidate, false);
    return state ? bindingOf(state) : undefined;
  }

  revalidateCandidate(input: unknown): OwnerSunoTrackOperationCandidateBinding {
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
    const currentTrack = this.#resolveTrack(state.trackHandle, state.attemptId, state.principal);
    if (currentTrack.model_id !== state.candidate.model_id ||
        fingerprintTrackContext(currentTrack) !== state.trackContextFingerprint ||
        currentTrack.expires_at < state.expiresAt) {
      this.#drop(state);
      fail("CANDIDATE_UNBOUND");
    }
    if (!state.privateRequest || schemaHash(state.privateRequest) !== state.privateRequestHash ||
        state.privateRequest.settings.model_type !== state.candidate.model_id ||
        state.privateRequest.settings.mode !== state.candidate.mode ||
        state.privateRequest.settings.source_clip_id !== currentTrack.clip_id ||
        state.privateRequest.settings.source_task_id !== currentTrack.task_id ||
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
    for (const state of this.#active.values()) if (state.attemptId === attemptIdInput) this.#drop(state);
  }

  close(): void {
    this.#closed = true;
    for (const state of this.#active.values()) this.#drop(state);
    this.#active.clear();
    this.#invalidatedAttempts.clear();
  }

  /** Internal synchronous take called only after a genuine one-shot permit was revalidated. */
  consumePrivateRequestForOneShot(input: unknown): OwnerSunoTrackOperationPrivateRequest {
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
    const currentTrack = this.#resolveTrack(state.trackHandle, attemptId, principal);
    if (fingerprintTrackContext(currentTrack) !== state.trackContextFingerprint ||
        currentTrack.model_id !== state.candidate.model_id ||
        currentTrack.expires_at < state.expiresAt) fail("CANDIDATE_UNBOUND");
    const request = state.privateRequest;
    if (!request || schemaHash(request) !== state.privateRequestHash) fail("PRIVATE_REQUEST_ALREADY_CONSUMED");
    state.privateRequest = null;
    state.privateRequestHash = "";
    this.#active.delete(state.candidate);
    return request;
  }

  #resolveTrack(trackHandle: string, attemptId: string, principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerSunoTrackContextProjection> {
    try {
      return this.#trackContextStore.resolve({ binding: this.#binding, attemptId, principal, trackHandle });
    } catch (error) {
      if (error instanceof OwnerSunoTrackContextStoreError && error.code === "TRACK_CONTEXT_EXPIRED") fail("TRACK_CONTEXT_EXPIRED");
      fail("TRACK_CONTEXT_UNAVAILABLE");
    }
  }

  #state(value: unknown, throwOnFailure: true): CandidateState;
  #state(value: unknown, throwOnFailure: false): CandidateState | undefined;
  #state(value: unknown, throwOnFailure: boolean): CandidateState | undefined {
    if (!value || typeof value !== "object" || types.isProxy(value)) {
      if (throwOnFailure) fail("CANDIDATE_UNBOUND");
      return undefined;
    }
    const state = CANDIDATES.get(value);
    if (!state || state.owner !== this.#owner || state.candidate !== value || this.#active.get(value) !== state || !Object.isFrozen(value)) {
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
    for (const state of this.#active.values()) if (state.expiresAt <= now) this.#drop(state);
  }

  #readNow(): number {
    let value: number;
    try { value = this.#now(); } catch { return fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value;
    return value;
  }

  #assertOpen(): void { if (this.#closed || !PREPARERS.has(this)) fail("SERVICE_CLOSED"); }
}

export function isOwnerSunoTrackOperationRequestPreparer(value: unknown): value is OwnerSunoTrackOperationRequestPreparer {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value) &&
      Object.getPrototypeOf(value) === OwnerSunoTrackOperationRequestPreparer.prototype;
  } catch { return false; }
}

export function isOwnerSunoTrackOperationPreparedCandidate(value: unknown): value is OwnerSunoTrackOperationPreparedCandidate {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = CANDIDATES.get(value);
    return !!state && state.candidate === value && state.privateRequest !== null;
  } catch { return false; }
}

export function getOwnerSunoTrackOperationPrivateRequestForOneShot(
  preparerInput: unknown,
  candidate: unknown,
  attemptIdInput: unknown,
  principalInput: unknown
): OwnerSunoTrackOperationPrivateRequest {
  if (!isOwnerSunoTrackOperationRequestPreparer(preparerInput)) fail("SERVICE_CLOSED");
  return preparerInput.consumePrivateRequestForOneShot({ candidate, attemptId: attemptIdInput, principal: principalInput });
}

function validateNormalizedCandidate(input: unknown): OwnerSunoNormalizedTrackOperationParameters {
  const fields = exactRecord(input, [
    "profile_id", "model_id", "mode", "track_handle", "prompt", "settings_candidate", "cost_parameters",
    "source_pins", "runtime_usable", "dispatch_allowed", "backend_acceptance"
  ], ["continuation_measure"]);
  const isExtend = fields.mode === "extend";
  if (isExtend !== Object.hasOwn(fields, "continuation_measure")) fail("NORMALIZED_CANDIDATE_INVALID");
  const settingsKeys = ["model_type", "mode", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title",
    ...(isExtend ? ["continue_at"] : [])];
  const settings = exactRecord(fields.settings_candidate, settingsKeys);
  exactRecord(fields.cost_parameters, []);
  const request = {
    model_id: fields.model_id,
    mode: fields.mode,
    track_handle: fields.track_handle,
    prompt: fields.prompt,
    is_custom_mode: settings.is_custom_mode,
    is_instrumental: settings.is_instrumental,
    negative_tags: settings.negative_tags,
    styles: settings.styles,
    title: settings.title,
    ...(isExtend ? { continue_at: settings.continue_at } : {})
  };
  let expected: OwnerSunoNormalizedTrackOperationParameters;
  try { expected = normalizeOwnerSunoTrackOperationParameters(request); }
  catch { fail("NORMALIZED_CANDIDATE_INVALID"); }
  const pins = exactRecord(fields.source_pins, ["public_catalog_version", "public_models_sha256", "settings_inventory_version",
    "form", "settings_helper", "cost_helper", "cost_service"]);
  const snapshot = {
    profile_id: fields.profile_id,
    model_id: fields.model_id,
    mode: fields.mode,
    track_handle: fields.track_handle,
    prompt: fields.prompt,
    settings_candidate: {
      model_type: settings.model_type,
      mode: settings.mode,
      is_custom_mode: settings.is_custom_mode,
      is_instrumental: settings.is_instrumental,
      negative_tags: settings.negative_tags,
      styles: settings.styles,
      title: settings.title,
      ...(isExtend ? { continue_at: settings.continue_at } : {})
    },
    cost_parameters: {},
    ...(isExtend ? { continuation_measure: fields.continuation_measure } : {}),
    source_pins: {
      public_catalog_version: pins.public_catalog_version,
      public_models_sha256: pins.public_models_sha256,
      settings_inventory_version: pins.settings_inventory_version,
      form: { ...exactRecord(pins.form, ["build_id", "module", "bytes", "sha256"]) },
      settings_helper: { ...exactRecord(pins.settings_helper, ["module", "bytes", "sha256"]) },
      cost_helper: { ...exactRecord(pins.cost_helper, ["module", "bytes", "sha256"]) },
      cost_service: { ...exactRecord(pins.cost_service, ["module", "bytes", "sha256"]) }
    },
    runtime_usable: fields.runtime_usable,
    dispatch_allowed: fields.dispatch_allowed,
    backend_acceptance: fields.backend_acceptance
  };
  if (!isDeepStrictEqual(snapshot, expected)) fail("NORMALIZED_CANDIDATE_INVALID");
  return expected;
}

function buildPrivateRequest(
  normalized: OwnerSunoNormalizedTrackOperationParameters,
  track: Readonly<OwnerSunoTrackContextProjection>
): OwnerSunoTrackOperationPrivateRequest {
  return Object.freeze({
    ai_name: "suno" as const,
    prompt: normalized.prompt,
    settings: Object.freeze({
      ...normalized.settings_candidate,
      source_clip_id: track.clip_id,
      source_task_id: track.task_id
    })
  });
}

function fingerprintIntent(
  principal: Readonly<GenerationPrincipalRef>,
  normalized: OwnerSunoNormalizedTrackOperationParameters,
  sourceProfileSchemaHash: string,
  track: Readonly<OwnerSunoTrackContextProjection>
): string {
  return createHash("sha256").update(JSON.stringify([
    "owner-suno-track-operation-intent-v1",
    principal.tenant_id,
    principal.subject_id,
    sourceProfileSchemaHash,
    normalized.source_pins.public_catalog_version,
    normalized.source_pins.settings_inventory_version,
    normalized.source_pins.form.sha256,
    normalized.source_pins.settings_helper.sha256,
    normalized.source_pins.cost_helper.sha256,
    normalized.source_pins.cost_service.sha256,
    normalized.model_id,
    normalized.mode,
    normalized.prompt,
    normalized.settings_candidate.is_custom_mode,
    normalized.settings_candidate.is_instrumental,
    normalized.settings_candidate.negative_tags,
    normalized.settings_candidate.styles,
    normalized.settings_candidate.title,
    normalized.mode === "extend" ? normalized.settings_candidate.continue_at : null,
    track.model_id,
    track.clip_id,
    track.task_id,
    track.source_profile_schema_hash
  ]), "utf8").digest("hex");
}

function fingerprintTrackContext(track: Readonly<OwnerSunoTrackContextProjection>): string {
  return schemaHash({
    attempt_id: track.attempt_id,
    principal: track.principal,
    model_id: track.model_id,
    chat_uuid: track.chat_uuid,
    message_id: track.message_id,
    message_object_id: track.message_object_id,
    owner_echo_message_id: track.owner_echo_message_id,
    intent_fingerprint: track.intent_fingerprint,
    source_profile_schema_hash: track.source_profile_schema_hash,
    clip_id: track.clip_id,
    task_id: track.task_id,
    expires_at: track.expires_at
  });
}

function getSourceProfile(): OwnerSunoTrackOperationParameterSource {
  try { return getOwnerSunoTrackOperationParameterSource(); }
  catch { return fail("SOURCE_EVIDENCE_UNAVAILABLE"); }
}

function bindingOf(state: CandidateState): OwnerSunoTrackOperationCandidateBinding {
  return Object.freeze({
    attempt_id: state.attemptId,
    principal: state.principal,
    model_id: state.candidate.model_id,
    mode: state.candidate.mode,
    source_profile_id: state.candidate.source_profile_id,
    source_profile_schema_hash: state.sourceProfileSchemaHash,
    source_pins: state.candidate.source_pins,
    expires_at: state.expiresAt,
    intent_fingerprint: state.intentFingerprint,
    private_request_hash: state.privateRequestHash,
    track_context_fingerprint: state.trackContextFingerprint
  });
}

function isPerUserLinkService(value: unknown): value is PerUserLinkService {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) &&
      Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
      getDataMethod(value, "getStatus") === PerUserLinkService.prototype.getStatus;
  } catch { return false; }
}

function isTrackContextStore(value: unknown): value is OwnerSunoTrackContextStore {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) ||
        Object.getPrototypeOf(value) !== OwnerSunoTrackContextStore.prototype ||
        getDataMethod(value, "resolve") !== OwnerSunoTrackContextStore.prototype.resolve) return false;
    Reflect.apply(OwnerSunoTrackContextStore.prototype.resolve, value, [null]);
    return false;
  } catch (error) {
    return error instanceof OwnerSunoTrackContextStoreError && error.code === "INVALID_REQUEST";
  }
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
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("PRINCIPAL_MISMATCH");
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

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, any> {
  if (!isPlainRecord(value)) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length < required.length || keys.length > required.length + optional.length ||
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, any>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function invalid(): never { return fail("INVALID_REQUEST"); }
function fail(code: OwnerSunoTrackOperationRequestPreparerErrorCode): never {
  throw new OwnerSunoTrackOperationRequestPreparerError(code);
}
