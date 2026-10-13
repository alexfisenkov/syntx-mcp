import { createHash } from "node:crypto";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { schemaHash } from "../domain/generation-contract.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  OwnerElevenLabsVoiceReferenceServiceError,
  OwnerElevenLabsVoiceReferenceService,
  type OwnerElevenLabsVoicePrivateResolution
} from "./owner-elevenlabs-voice-reference-service.js";
import {
  getOwnerElevenLabsGenerationParameterProfile,
  normalizeOwnerElevenLabsGenerationParameters,
  OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
  OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION,
  type OwnerElevenLabsVoiceReference,
  type OwnerElevenLabsNormalizedTtsCandidate,
  type OwnerElevenLabsTtsModel
} from "./owner-elevenlabs-generation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const VOICE_ID = /^[A-Za-z0-9._-]{1,160}$/u;
const MAX_CANDIDATES = 128;
const RESOLVE_VOICE = OwnerElevenLabsVoiceReferenceService.prototype.resolveVoice;
const OWNED_VOICE_GUARD = OwnerElevenLabsVoiceReferenceService.prototype.isOwnedVoiceResolution;
const CANDIDATES = new WeakMap<object, CandidateState>();
const PREPARERS = new WeakSet<object>();

export interface OwnerElevenLabsTtsPreparedCandidate {
  readonly status: "prepared";
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerElevenLabsTtsModel;
  readonly mode: "text_to_speech";
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly voice_epoch: number;
  readonly expires_at: number;
  readonly chars_count: number;
  readonly stability: number;
  readonly similarity_boost: number;
  readonly language_code?: "auto";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly public_catalog_version: typeof OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION;
  readonly intent_fingerprint: string;
  readonly runtime_usable: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface PrepareOwnerElevenLabsTtsInput {
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly request: unknown;
}

export interface InspectOwnerElevenLabsTtsCandidateInput {
  readonly candidate: OwnerElevenLabsTtsPreparedCandidate;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
}

export interface OwnerElevenLabsTtsCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerElevenLabsTtsModel;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly voice_epoch: number;
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
}

export interface OwnerElevenLabsTtsPrivateRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: OwnerElevenLabsTtsModel;
    readonly mode: "text_to_speech";
    readonly voice_id: string;
    readonly chars_count: number;
    readonly stability: number;
    readonly similarity_boost: number;
    readonly file_urls: readonly [];
    readonly language_code?: "auto";
  }>;
}

export type OwnerElevenLabsTtsRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "VOICE_SERVICE_UNTRUSTED" | "VOICE_REFERENCE_UNAVAILABLE" | "VOICE_REFERENCE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "UNSUPPORTED_MODEL_CONTROLS" | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";

export class OwnerElevenLabsTtsRequestPreparerError extends Error {
  constructor(readonly code: OwnerElevenLabsTtsRequestPreparerErrorCode) {
    super("The ElevenLabs TTS request candidate could not be prepared safely.");
    this.name = "OwnerElevenLabsTtsRequestPreparerError";
  }
}

interface CandidateState {
  readonly candidate: OwnerElevenLabsTtsPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly resolution: OwnerElevenLabsVoicePrivateResolution;
  readonly resolver: OwnerElevenLabsVoiceReferenceService;
  readonly privateRequest: OwnerElevenLabsTtsPrivateRequest;
  readonly requestHash: string;
}

export class OwnerElevenLabsTtsRequestPreparer {
  readonly #voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly #now: () => number;
  readonly #active = new Map<object, CandidateState>();
  #lastNow: number | undefined;
  #closed = false;

  constructor(optionsInput: unknown) {
    const fields = exactRecord(optionsInput, ["voiceReferenceService"], ["now"]);
    if (!isVoiceReferenceService(fields.voiceReferenceService) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("VOICE_SERVICE_UNTRUSTED");
    this.#voiceReferenceService = fields.voiceReferenceService;
    this.#now = fields.now === undefined ? Date.now : fields.now as () => number;
    PREPARERS.add(this);
    Object.freeze(this);
  }

  async prepare(input: PrepareOwnerElevenLabsTtsInput | unknown): Promise<OwnerElevenLabsTtsPreparedCandidate> {
    this.#assertOpen();
    const fields = exactRecord(input, ["attemptId", "principal", "request"]);
    const attemptId = readAttempt(fields.attemptId);
    const principal = readPrincipal(fields.principal, attemptId);
    let normalized: OwnerElevenLabsNormalizedTtsCandidate;
    try {
      const value = normalizeOwnerElevenLabsGenerationParameters(fields.request);
      if (value.mode !== "text_to_speech") fail("INVALID_REQUEST");
      normalized = value;
    } catch (error) {
      if (error instanceof OwnerElevenLabsTtsRequestPreparerError) throw error;
      fail("PARAMETERS_INVALID");
    }
    if (!isV4(normalized.model_id) && (normalized.settings_candidate.stability !== 0.5 ||
        normalized.settings_candidate.similarity_boost !== 0.5)) fail("UNSUPPORTED_MODEL_CONTROLS");

    const voiceRef = normalized.settings_candidate.voice_ref;
    if (typeof voiceRef !== "string") fail("INVALID_REQUEST");
    const context = Object.freeze({ attemptId, voice_ref: voiceRef });
    let resolution: OwnerElevenLabsVoicePrivateResolution;
    try {
      resolution = await Reflect.apply(RESOLVE_VOICE, this.#voiceReferenceService, [context]) as OwnerElevenLabsVoicePrivateResolution;
    } catch (error) {
      if (error instanceof OwnerElevenLabsVoiceReferenceServiceError && error.code === "VOICE_REFERENCE_EXPIRED") fail("VOICE_REFERENCE_EXPIRED");
      if (error instanceof OwnerElevenLabsVoiceReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_MISMATCH");
      fail("VOICE_REFERENCE_UNAVAILABLE");
    }

    const now = this.#readNow();
    let snapshot: OwnerElevenLabsVoicePrivateResolution;
    try { snapshot = snapshotResolution(resolution); }
    catch { fail("VOICE_REFERENCE_UNAVAILABLE"); }
    if (!Reflect.apply(OWNED_VOICE_GUARD, this.#voiceReferenceService, [resolution, context]) ||
        snapshot.attempt_id !== attemptId || snapshot.voice_ref !== voiceRef || !sameGenerationPrincipal(snapshot.principal, principal)) {
      fail("VOICE_REFERENCE_UNAVAILABLE");
    }
    if (snapshot.expires_at <= now) fail("VOICE_REFERENCE_EXPIRED");
    this.#prune(now);
    if (this.#active.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");

    const privateSettings = Object.freeze({
      model_type: normalized.settings_candidate.model_type,
      mode: "text_to_speech" as const,
      voice_id: snapshot.voice_id,
      chars_count: normalized.settings_candidate.chars_count,
      stability: normalized.settings_candidate.stability,
      similarity_boost: normalized.settings_candidate.similarity_boost,
      file_urls: Object.freeze([]) as readonly [],
      ...(normalized.settings_candidate.language_code === undefined ? {} : { language_code: normalized.settings_candidate.language_code })
    });
    const privateRequest: OwnerElevenLabsTtsPrivateRequest = Object.freeze({ prompt: normalized.prompt, settings: privateSettings });
    const profile = getOwnerElevenLabsGenerationParameterProfile();
    const profileSchemaHash = schemaHash(profile);
    const intentFingerprint = semanticFingerprint({ principal, model_id: normalized.model_id, prompt: normalized.prompt,
      voice_id: snapshot.voice_id, stability: privateSettings.stability, similarity_boost: privateSettings.similarity_boost,
      language_code: privateSettings.language_code ?? null });
    const candidate: OwnerElevenLabsTtsPreparedCandidate = Object.freeze({
      status: "prepared",
      attempt_id: attemptId,
      principal,
      model_id: normalized.model_id,
      mode: "text_to_speech",
      voice_ref: voiceRef,
      voice_epoch: snapshot.epoch,
      expires_at: snapshot.expires_at,
      chars_count: privateSettings.chars_count,
      stability: privateSettings.stability,
      similarity_boost: privateSettings.similarity_boost,
      ...(privateSettings.language_code === undefined ? {} : { language_code: privateSettings.language_code }),
      profile_id: normalized.profile_id,
      profile_schema_hash: profileSchemaHash,
      public_catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
      settings_inventory_version: OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION,
      intent_fingerprint: intentFingerprint,
      runtime_usable: false,
      generation_allowed: false,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    const state: CandidateState = Object.freeze({ candidate, principal, resolution, resolver: this.#voiceReferenceService,
      privateRequest, requestHash: schemaHash(privateRequest) });
    CANDIDATES.set(candidate, state);
    this.#active.set(candidate, state);
    return candidate;
  }

  inspectCandidate(candidate: unknown): OwnerElevenLabsTtsCandidateBinding | undefined {
    const state = this.#state(candidate);
    if (!state) return undefined;
    return bindingOf(state);
  }

  revalidateCandidate(input: InspectOwnerElevenLabsTtsCandidateInput | unknown): OwnerElevenLabsTtsCandidateBinding {
    this.#assertOpen();
    const fields = exactRecord(input, ["candidate", "attemptId", "principal"]);
    const attemptId = readAttempt(fields.attemptId);
    const principal = readPrincipal(fields.principal, attemptId);
    const state = this.#state(fields.candidate);
    if (!state) fail("CANDIDATE_UNBOUND");
    if (state.candidate.attempt_id !== attemptId || !sameGenerationPrincipal(state.principal, principal) ||
        !sameGenerationPrincipal(state.candidate.principal, principal)) fail("PRINCIPAL_MISMATCH");
    const now = this.#readNow();
    if (state.candidate.expires_at <= now || state.resolution.expires_at <= now) {
      this.#drop(fields.candidate as object);
      fail("CANDIDATE_EXPIRED");
    }
    const context = Object.freeze({ attemptId, voice_ref: state.candidate.voice_ref });
    if (!Reflect.apply(OWNED_VOICE_GUARD, state.resolver, [state.resolution, context]) ||
        state.resolution.epoch !== state.candidate.voice_epoch || state.resolution.voice_id.length === 0 ||
        schemaHash(state.privateRequest) !== state.requestHash || state.candidate.intent_fingerprint !==
          semanticFingerprint({ principal, model_id: state.candidate.model_id, prompt: state.privateRequest.prompt,
            voice_id: state.resolution.voice_id, stability: state.candidate.stability,
            similarity_boost: state.candidate.similarity_boost, language_code: state.candidate.language_code ?? null })) {
      this.#drop(fields.candidate as object);
      fail("VOICE_REFERENCE_UNAVAILABLE");
    }
    return bindingOf(state);
  }

  invalidateAttempt(attemptIdInput: unknown): void {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return;
    for (const [candidate, state] of this.#active) if (state.candidate.attempt_id === attemptIdInput) this.#drop(candidate);
  }

  close(): void {
    this.#closed = true;
    this.#active.clear();
  }

  #state(value: unknown): CandidateState | undefined {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return undefined;
    const state = CANDIDATES.get(value);
    if (!state || state.candidate !== value || this.#active.get(value) !== state) return undefined;
    return state;
  }
  #drop(candidate: object): void { this.#active.delete(candidate); }
  #prune(now: number): void {
    for (const [candidate, state] of this.#active) if (state.candidate.expires_at <= now) this.#drop(candidate);
  }
  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value;
    return value;
  }
  #assertOpen(): void { if (this.#closed || !PREPARERS.has(this)) fail("SERVICE_CLOSED"); }
}

export function isOwnerElevenLabsTtsRequestPreparer(value: unknown): value is OwnerElevenLabsTtsRequestPreparer {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value) &&
    Object.getPrototypeOf(value) === OwnerElevenLabsTtsRequestPreparer.prototype; } catch { return false; }
}

/** Internal-only accessor imported by the one-shot policy; never re-exported from the package barrel. */
export function getOwnerElevenLabsTtsPrivateRequestForPolicy(candidate: unknown): OwnerElevenLabsTtsPrivateRequest {
  if (!candidate || typeof candidate !== "object" || types.isProxy(candidate)) fail("CANDIDATE_UNBOUND");
  const state = CANDIDATES.get(candidate);
  if (!state || state.candidate !== candidate || schemaHash(state.privateRequest) !== state.requestHash) fail("CANDIDATE_UNBOUND");
  return state.privateRequest;
}

function snapshotResolution(value: unknown): OwnerElevenLabsVoicePrivateResolution {
  const fields = exactRecord(value, ["attempt_id", "principal", "voice_ref", "voice_id", "name", "expires_at", "epoch",
    "ownership_confidence", "generation_permit"]);
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  if (typeof fields.attempt_id !== "string" || typeof fields.voice_ref !== "string" ||
      typeof fields.voice_id !== "string" || !VOICE_ID.test(fields.voice_id) ||
      typeof fields.name !== "string" || typeof fields.expires_at !== "number" || !Number.isSafeInteger(fields.expires_at) ||
      typeof fields.epoch !== "number" || !Number.isSafeInteger(fields.epoch) || fields.epoch < 0 ||
      fields.ownership_confidence !== "UNPROVEN" || fields.generation_permit !== false) fail("VOICE_REFERENCE_UNAVAILABLE");
  return Object.freeze({ attempt_id: fields.attempt_id, principal, voice_ref: fields.voice_ref as OwnerElevenLabsVoiceReference, voice_id: fields.voice_id,
    name: fields.name, expires_at: fields.expires_at, epoch: fields.epoch, ownership_confidence: "UNPROVEN", generation_permit: false });
}

function isVoiceReferenceService(value: unknown): value is OwnerElevenLabsVoiceReferenceService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === OwnerElevenLabsVoiceReferenceService.prototype &&
    getDataMethod(value, "resolveVoice") === RESOLVE_VOICE && getDataMethod(value, "isOwnedVoiceResolution") === OWNED_VOICE_GUARD; }
  catch { return false; }
}
function isV4(model: OwnerElevenLabsTtsModel): boolean { return model === "eleven_v4" || model === "eleven_v4_turbo"; }
function semanticFingerprint(input: { principal: Readonly<GenerationPrincipalRef>; model_id: OwnerElevenLabsTtsModel; prompt: string;
  voice_id: string; stability: number; similarity_boost: number; language_code: "auto" | null }): string {
  const value = JSON.stringify(["owner-elevenlabs-tts-semantic-v1", input.principal.tenant_id, input.principal.subject_id,
    input.model_id, input.prompt, input.voice_id, input.stability, input.similarity_boost, input.language_code]);
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
function bindingOf(state: CandidateState): OwnerElevenLabsTtsCandidateBinding {
  return Object.freeze({ attempt_id: state.candidate.attempt_id, principal: state.principal,
    model_id: state.candidate.model_id, voice_ref: state.candidate.voice_ref, voice_epoch: state.candidate.voice_epoch,
    expires_at: state.candidate.expires_at, intent_fingerprint: state.candidate.intent_fingerprint,
    profile_schema_hash: state.candidate.profile_schema_hash });
}
function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { return fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" ||
      (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function fail(code: OwnerElevenLabsTtsRequestPreparerErrorCode): never { throw new OwnerElevenLabsTtsRequestPreparerError(code); }
