import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { SyntxChatHttpClient, readOwnerElevenLabsStsOriginalUploadForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerElevenLabsStsOriginalUploadReference } from "../adapter/syntx/owner-elevenlabs-sts-original-upload.js";
import { OwnerElevenLabsStsOriginalReferenceService, type OwnerElevenLabsStsOriginalResolution } from "./owner-elevenlabs-sts-original-reference-service.js";
import { OWNER_ELEVENLABS_STS_MODEL_ID, OWNER_ELEVENLABS_STS_MODE, getOwnerElevenLabsStsParameterProfile } from "./owner-elevenlabs-sts-parameters.js";
import { OwnerElevenLabsVoiceReferenceService, type OwnerElevenLabsVoicePrivateResolution } from "./owner-elevenlabs-voice-reference-service.js";
import type { OwnerElevenLabsVoiceReference } from "./owner-elevenlabs-generation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL_HANDLE = /^elevenlabs_sts_original_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VOICE_REF = /^owner_elevenlabs_voice_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VOICE_ID = /^[A-Za-z0-9._-]{1,160}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const SOURCE_DURATION_PROJECTION = Object.freeze({
  build_id: "1791904852",
  file: "elevenlabs.js",
  bytes: 32_647,
  sha256: "f0bddc3b37e1cd44a32e60b6cdb4401670a2ffb5244a568b1a867d210e660c6c",
  assignment_chars: Object.freeze([24_518, 24_551] as const),
  assignment: "e.settings.duration = Math.round(t)",
  file_watch: "Q(()=>P.files.length,()=>{…},{deep:!0,immediate:!0})",
  enclosing_predicate: "NONE_OBSERVED",
  status: "CURRENT_AST_WATCHER_CLOSED"
} as const);
const ORIGINAL_RESOLVE = OwnerElevenLabsStsOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_GUARD = OwnerElevenLabsStsOriginalReferenceService.prototype.isOwnedOriginalResolution;
const ORIGINAL_CAPTURE = OwnerElevenLabsStsOriginalReferenceService.prototype.withCapturedNativeOriginal;
const VOICE_RESOLVE = OwnerElevenLabsVoiceReferenceService.prototype.resolveVoice;
const VOICE_GUARD = OwnerElevenLabsVoiceReferenceService.prototype.isOwnedVoiceResolution;
const CANDIDATES = new WeakMap<object, CandidateState>();
const PREPARERS = new WeakSet<object>();

export interface OwnerElevenLabsStsPrivateRequest {
  readonly prompt: "";
  readonly settings: Readonly<{
    readonly model_type: typeof OWNER_ELEVENLABS_STS_MODEL_ID;
    readonly mode: typeof OWNER_ELEVENLABS_STS_MODE;
    readonly voice_id: string;
    readonly duration: number;
    readonly file_urls: readonly Readonly<{ readonly type: "audio"; readonly url: string }>[];
  }>;
}

/** Safe to return to a local owner caller: no principal, references, IDs, or URLs. */
export interface OwnerElevenLabsStsPreparedCandidate {
  readonly status: "prepared";
  readonly model_id: typeof OWNER_ELEVENLABS_STS_MODEL_ID;
  readonly mode: typeof OWNER_ELEVENLABS_STS_MODE;
  readonly duration_seconds: number;
  readonly duration_projection_status: "SOURCE_VERIFIED";
  readonly source_sha256: string;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerElevenLabsStsCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly audio_original_handle: string;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
  readonly source_sha256: string;
  readonly source_size: number;
  readonly measured_duration_seconds: number;
  readonly duration: number;
  readonly duration_projection_status: "SOURCE_VERIFIED";
  readonly original_epoch: number;
  readonly original_expires_at: number;
  readonly voice_epoch: number;
  readonly voice_expires_at: number;
  readonly profile_schema_hash: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
}

export interface OwnerElevenLabsStsRequestPreparerOptions {
  readonly originalReferenceService: OwnerElevenLabsStsOriginalReferenceService;
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly now?: () => number;
}

export interface PrepareOwnerElevenLabsStsRequestInput {
  readonly attemptId: string;
  readonly audio_original_handle: string;
  readonly voice_ref: OwnerElevenLabsVoiceReference;
}

interface CapturedOriginal {
  readonly client: SyntxChatHttpClient;
  readonly reference: OwnerElevenLabsStsOriginalUploadReference;
  readonly url: string;
}
interface CandidateState {
  readonly candidate: OwnerElevenLabsStsPreparedCandidate;
  readonly binding: Readonly<OwnerElevenLabsStsCandidateBinding>;
  readonly originalResolution: OwnerElevenLabsStsOriginalResolution;
  readonly voiceResolution: OwnerElevenLabsVoicePrivateResolution;
  readonly captured: CapturedOriginal;
  readonly request: OwnerElevenLabsStsPrivateRequest;
  expired: boolean;
}
interface PreparerApi {
  prepare(input: unknown): Promise<OwnerElevenLabsStsPreparedCandidate>;
  inspectCandidate(candidate: unknown): Readonly<OwnerElevenLabsStsCandidateBinding> | undefined;
  getPrivateRequest(candidate: unknown): OwnerElevenLabsStsPrivateRequest;
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerElevenLabsStsCandidateBinding>>;
  /** Captured private source survives expiry/close for a later GET-only recovery join. */
  withCapturedNativeOriginal<T>(candidate: unknown, consume: (client: SyntxChatHttpClient,
    reference: OwnerElevenLabsStsOriginalUploadReference, url: string) => T): T;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}
const PREPARER_KEY = Symbol("OwnerElevenLabsStsRequestPreparerFactory");

export type OwnerElevenLabsStsRequestPreparerErrorCode = "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" |
  "REFERENCE_EXPIRED" | "VOICE_REFERENCE_UNAVAILABLE" | "VOICE_REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" |
  "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";
export class OwnerElevenLabsStsRequestPreparerError extends Error {
  constructor(readonly code: OwnerElevenLabsStsRequestPreparerErrorCode) {
    super("The owner ElevenLabs STS request candidate could not be prepared safely.");
    this.name = "OwnerElevenLabsStsRequestPreparerError";
  }
}

/** A private request projector; it never creates a generation permit or dispatch authority. */
export class OwnerElevenLabsStsRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api; PREPARERS.add(this); Object.freeze(this);
  }
  prepare(input: unknown): Promise<OwnerElevenLabsStsPreparedCandidate> { return this.#api.prepare(input); }
  inspectCandidate(candidate: unknown): Readonly<OwnerElevenLabsStsCandidateBinding> | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerElevenLabsStsPrivateRequest { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerElevenLabsStsCandidateBinding>> { return this.#api.revalidateCandidate(candidate); }
  withCapturedNativeOriginal<T>(candidate: unknown, consume: (client: SyntxChatHttpClient, reference: OwnerElevenLabsStsOriginalUploadReference, url: string) => T): T {
    return this.#api.withCapturedNativeOriginal(candidate, consume);
  }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerElevenLabsStsRequestPreparer.prototype);

export function createOwnerElevenLabsStsRequestPreparer(optionsInput: OwnerElevenLabsStsRequestPreparerOptions | unknown): OwnerElevenLabsStsRequestPreparer {
  const options = readOptions(optionsInput), candidates = new Set<CandidateState>(), epochs = new Map<string, number>();
  const clock = options.now === undefined ? Date.now : readClock(options.now);
  let lastNow = clock(), closed = false;
  const readNow = (): number => { const value = clock(); if (!Number.isSafeInteger(value) || value < lastNow) fail("CLOCK_INVALID"); lastNow = value; return value; };
  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    const state = candidateState(value), now = readNow();
    if (!state || state.expired || state.binding.expires_at <= now || state.binding.original_epoch !== (epochs.get(state.binding.attempt_id) ?? 0)) {
      if (state) { state.expired = true; candidates.delete(state); }
      fail("CANDIDATE_EXPIRED");
    }
    if (!guardOriginal(state.originalResolution, state.binding, options.originalReferenceService) ||
        !guardVoice(state.voiceResolution, state.binding, options.voiceReferenceService)) {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
    return state;
  };

  const api: PreparerApi = {
    async prepare(inputInput) {
      if (closed) fail("SERVICE_CLOSED");
      const input = snapshotInput(inputInput), epoch = epochs.get(input.attemptId) ?? 0;
      const originalContext = Object.freeze({ attempt_id: input.attemptId, audio_original_handle: input.originalHandle });
      const voiceContext = Object.freeze({ attemptId: input.attemptId, voice_ref: input.voiceRef });
      let original: OwnerElevenLabsStsOriginalResolution;
      try { original = await Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [originalContext]) as OwnerElevenLabsStsOriginalResolution; }
      catch (error) { if (hasCode(error, "REFERENCE_EXPIRED")) fail("REFERENCE_EXPIRED"); fail("REFERENCE_UNAVAILABLE"); }
      let voice: OwnerElevenLabsVoicePrivateResolution;
      try { voice = await Reflect.apply(VOICE_RESOLVE, options.voiceReferenceService, [voiceContext]) as OwnerElevenLabsVoicePrivateResolution; }
      catch (error) { if (hasCode(error, "VOICE_REFERENCE_EXPIRED")) fail("VOICE_REFERENCE_EXPIRED"); fail("VOICE_REFERENCE_UNAVAILABLE"); }
      if (closed || epoch !== (epochs.get(input.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
      const principal = assertJoined(original!, voice!, input);
      if (!Reflect.apply(ORIGINAL_GUARD, options.originalReferenceService, [original!, originalContext]) ||
          !Reflect.apply(VOICE_GUARD, options.voiceReferenceService, [voice!, voiceContext])) fail("REFERENCE_UNAVAILABLE");
      const captured = Reflect.apply(ORIGINAL_CAPTURE, options.originalReferenceService, [original!, originalContext,
        (client: SyntxChatHttpClient, reference: OwnerElevenLabsStsOriginalUploadReference) => {
          if (!(client instanceof SyntxChatHttpClient) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype) fail("REFERENCE_UNAVAILABLE");
          const witness = readOwnerElevenLabsStsOriginalUploadForClient(client, reference);
          if (!witness || witness.model_type !== OWNER_ELEVENLABS_STS_MODEL_ID || witness.source_sha256 !== original!.sha256 ||
              witness.size !== original!.size || witness.mime_type !== original!.mime_type || witness.duration_seconds !== original!.duration_seconds ||
              !isSafeUploadReferenceUrl(witness.url)) fail("REFERENCE_UNAVAILABLE");
          return Object.freeze({ client, reference, url: witness.url });
        }]) as CapturedOriginal;
      const duration = Math.round(original!.duration_seconds);
      if (!Number.isSafeInteger(duration) || duration < 5 || duration > 300) fail("REFERENCE_UNAVAILABLE");
      const now = readNow(), expiresAt = Math.min(now + TTL_MS, original!.expires_at, voice!.expires_at);
      if (expiresAt <= now) fail("REFERENCE_EXPIRED");
      const request: OwnerElevenLabsStsPrivateRequest = deepFreeze({ prompt: "", settings: {
        model_type: OWNER_ELEVENLABS_STS_MODEL_ID, mode: OWNER_ELEVENLABS_STS_MODE, voice_id: voice!.voice_id,
        duration, file_urls: [{ type: "audio", url: captured.url }]
      } });
      const profileHash = schemaHash({ parameters: getOwnerElevenLabsStsParameterProfile(), duration_projection: SOURCE_DURATION_PROJECTION });
      const intentFingerprint = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id,
        source_sha256: original!.sha256, voice_id: voice!.voice_id, model_id: OWNER_ELEVENLABS_STS_MODEL_ID,
        mode: OWNER_ELEVENLABS_STS_MODE, duration });
      const requestFingerprint = schemaHash(request);
      const binding = deepFreeze({ attempt_id: input.attemptId, principal, audio_original_handle: input.originalHandle,
        voice_ref: input.voiceRef, source_sha256: original!.sha256, source_size: original!.size,
        measured_duration_seconds: original!.duration_seconds, duration, duration_projection_status: "SOURCE_VERIFIED" as const, original_epoch: original!.epoch,
        original_expires_at: original!.expires_at, voice_epoch: voice!.epoch, voice_expires_at: voice!.expires_at,
        profile_schema_hash: profileHash, request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint,
        expires_at: expiresAt });
      const candidate: OwnerElevenLabsStsPreparedCandidate = Object.freeze({ status: "prepared", model_id: OWNER_ELEVENLABS_STS_MODEL_ID,
        mode: OWNER_ELEVENLABS_STS_MODE, duration_seconds: duration, duration_projection_status: "SOURCE_VERIFIED", source_sha256: original!.sha256,
        profile_schema_hash: profileHash, request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint,
        expires_at: expiresAt, runtime_usable: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
      const state: CandidateState = { candidate, binding, originalResolution: original!, voiceResolution: voice!, captured, request, expired: false };
      if (candidates.size >= MAX_CANDIDATES) prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      CANDIDATES.set(candidate, state); candidates.add(state); return candidate;
    },
    inspectCandidate(value) { try { return stateFor(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return stateFor(value).request; },
    async revalidateCandidate(value) {
      const state = stateFor(value), input = state.binding;
      const originalContext = Object.freeze({ attempt_id: input.attempt_id, audio_original_handle: input.audio_original_handle });
      const voiceContext = Object.freeze({ attemptId: input.attempt_id, voice_ref: input.voice_ref });
      let original: OwnerElevenLabsStsOriginalResolution;
      try { original = await Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [originalContext]) as OwnerElevenLabsStsOriginalResolution; }
      catch { state.expired = true; fail("REFERENCE_UNAVAILABLE"); }
      let voice: OwnerElevenLabsVoicePrivateResolution;
      try { voice = await Reflect.apply(VOICE_RESOLVE, options.voiceReferenceService, [voiceContext]) as OwnerElevenLabsVoicePrivateResolution; }
      catch { state.expired = true; fail("VOICE_REFERENCE_UNAVAILABLE"); }
      if (closed || state.expired || state.binding.original_epoch !== (epochs.get(input.attempt_id) ?? 0)) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
      try {
        const current = assertJoined(original!, voice!, { attemptId: input.attempt_id, originalHandle: input.audio_original_handle, voiceRef: input.voice_ref });
        if (!sameGenerationPrincipal(current, input.principal) || original!.sha256 !== input.source_sha256 || original!.size !== input.source_size ||
            original!.duration_seconds !== input.measured_duration_seconds || original!.epoch !== input.original_epoch || original!.expires_at !== input.original_expires_at ||
            voice!.epoch !== input.voice_epoch || voice!.expires_at !== input.voice_expires_at || voice!.voice_id !== state.request.settings.voice_id ||
            Math.round(original!.duration_seconds) !== input.duration || readNow() >= input.expires_at ||
            !Reflect.apply(ORIGINAL_GUARD, options.originalReferenceService, [original!, originalContext]) ||
            !Reflect.apply(VOICE_GUARD, options.voiceReferenceService, [voice!, voiceContext])) fail("CANDIDATE_EXPIRED");
        const currentCapture = Reflect.apply(ORIGINAL_CAPTURE, options.originalReferenceService, [original!, originalContext,
          (client: SyntxChatHttpClient, reference: OwnerElevenLabsStsOriginalUploadReference) => ({ client, reference })]) as Pick<CapturedOriginal, "client" | "reference">;
        if (currentCapture.client !== state.captured.client || currentCapture.reference !== state.captured.reference) fail("REFERENCE_UNAVAILABLE");
        return input;
      } catch (error) { state.expired = true; if (error instanceof OwnerElevenLabsStsRequestPreparerError) throw error; fail("CANDIDATE_EXPIRED"); }
    },
    withCapturedNativeOriginal(value, consume) {
      if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
      const state = candidateState(value);
      if (!state || state.candidate !== value) fail("CANDIDATE_UNBOUND");
      const witness = readOwnerElevenLabsStsOriginalUploadForClient(state.captured.client, state.captured.reference);
      if (!witness || witness.url !== state.captured.url || witness.source_sha256 !== state.binding.source_sha256 ||
          witness.model_type !== OWNER_ELEVENLABS_STS_MODEL_ID) fail("REFERENCE_UNAVAILABLE");
      return consume(state.captured.client, state.captured.reference, state.captured.url);
    },
    async invalidateAttempt(attemptIdInput) {
      const attempt = readAttempt(attemptIdInput); epochs.set(attempt, (epochs.get(attempt) ?? 0) + 1);
      for (const state of candidates) if (state.binding.attempt_id === attempt) { state.expired = true; candidates.delete(state); }
    },
    async close() { closed = true; for (const state of candidates) state.expired = true; candidates.clear(); epochs.clear(); }
  };
  return new OwnerElevenLabsStsRequestPreparer(PREPARER_KEY, api);

  function prune(): void { const now = readNow(); for (const state of candidates) if (state.expired || state.binding.expires_at <= now) { state.expired = true; candidates.delete(state); } }
}

export function isOwnerElevenLabsStsRequestPreparer(value: unknown): value is OwnerElevenLabsStsRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerElevenLabsStsRequestPreparer.prototype &&
    value instanceof OwnerElevenLabsStsRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}
export function isOwnerElevenLabsStsPreparedCandidate(value: unknown): value is OwnerElevenLabsStsPreparedCandidate {
  const state = candidateState(value); return !!state && state.candidate === value && !state.expired;
}

function readOptions(value: unknown): Readonly<OwnerElevenLabsStsRequestPreparerOptions> {
  const fields = exact(value, ["originalReferenceService", "voiceReferenceService"], ["now"]);
  const original = fields.originalReferenceService, voice = fields.voiceReferenceService;
  if (!isExactService(original, OwnerElevenLabsStsOriginalReferenceService, ["resolveOriginal", "isOwnedOriginalResolution", "withCapturedNativeOriginal"]) ||
      !isExactService(voice, OwnerElevenLabsVoiceReferenceService, ["resolveVoice", "isOwnedVoiceResolution"]) ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ originalReferenceService: original as OwnerElevenLabsStsOriginalReferenceService,
    voiceReferenceService: voice as OwnerElevenLabsVoiceReferenceService, ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}
function isExactService(value: unknown, type: Function, methods: readonly string[]): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && value instanceof (type as new (...args: never[]) => object) &&
    Object.getPrototypeOf(value) === type.prototype && methods.every((name) => {
      const expected = Object.getOwnPropertyDescriptor(type.prototype, name)?.value;
      const captured = type === OwnerElevenLabsStsOriginalReferenceService
        ? ({ resolveOriginal: ORIGINAL_RESOLVE, isOwnedOriginalResolution: ORIGINAL_GUARD, withCapturedNativeOriginal: ORIGINAL_CAPTURE } as Record<string, unknown>)[name]
        : ({ resolveVoice: VOICE_RESOLVE, isOwnedVoiceResolution: VOICE_GUARD } as Record<string, unknown>)[name];
      return typeof expected === "function" && expected === captured && Object.getOwnPropertyDescriptor(value, name) === undefined;
    });
}
function snapshotInput(value: unknown): Readonly<{ attemptId: string; originalHandle: string; voiceRef: OwnerElevenLabsVoiceReference }> {
  const fields = exact(value, ["attemptId", "audio_original_handle", "voice_ref"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.audio_original_handle !== "string" ||
      !ORIGINAL_HANDLE.test(fields.audio_original_handle) || typeof fields.voice_ref !== "string" || !VOICE_REF.test(fields.voice_ref)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, originalHandle: fields.audio_original_handle,
    voiceRef: fields.voice_ref as OwnerElevenLabsVoiceReference });
}
function assertJoined(original: OwnerElevenLabsStsOriginalResolution, voice: OwnerElevenLabsVoicePrivateResolution,
  input: Readonly<{ attemptId: string; originalHandle: string; voiceRef: string }>): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(original.principal); } catch { fail("PRINCIPAL_MISMATCH"); }
  const originalOk = original.role === "elevenlabs_sts_original" && original.wire_type === "audio" && original.model_type === OWNER_ELEVENLABS_STS_MODEL_ID &&
    original.generation_permit === false && original.attempt_id === input.attemptId && original.audio_original_handle === input.originalHandle &&
    principal.connection_id === input.attemptId && /^[a-f0-9]{64}$/u.test(original.sha256) && original.mime_type === "audio/mpeg" &&
    Number.isSafeInteger(original.size) && original.size >= 16 && Number.isFinite(original.duration_seconds) && original.duration_seconds >= 5 && original.duration_seconds <= 300 &&
    Number.isSafeInteger(original.epoch) && original.epoch >= 0 && Number.isSafeInteger(original.expires_at);
  let voicePrincipal: Readonly<GenerationPrincipalRef>;
  try { voicePrincipal = snapshotGenerationPrincipal(voice.principal); } catch { fail("PRINCIPAL_MISMATCH"); }
  const voiceOk = voice.attempt_id === input.attemptId && voice.voice_ref === input.voiceRef && VOICE_ID.test(voice.voice_id) &&
    voice.generation_permit === false && voice.ownership_confidence === "UNPROVEN" && voicePrincipal.connection_id === input.attemptId &&
    Number.isSafeInteger(voice.epoch) && voice.epoch >= 0 && Number.isSafeInteger(voice.expires_at);
  if (!originalOk || !voiceOk || !sameGenerationPrincipal(principal!, voicePrincipal!)) fail("PRINCIPAL_MISMATCH");
  return principal!;
}
function guardOriginal(value: unknown, binding: OwnerElevenLabsStsCandidateBinding, service: OwnerElevenLabsStsOriginalReferenceService): boolean {
  return Reflect.apply(ORIGINAL_GUARD, service, [value, { attempt_id: binding.attempt_id, audio_original_handle: binding.audio_original_handle }]) === true;
}
function guardVoice(value: unknown, binding: OwnerElevenLabsStsCandidateBinding, service: OwnerElevenLabsVoiceReferenceService): boolean {
  return Reflect.apply(VOICE_GUARD, service, [value, { attemptId: binding.attempt_id, voice_ref: binding.voice_ref }]) === true;
}
function candidateState(value: unknown): CandidateState | undefined { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value) ? CANDIDATES.get(value as object) : undefined; }
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if ((proto !== Object.prototype && proto !== null) || keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) || required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) result[key] = descriptors[key]!.value; return result;
}
function readClock(value: unknown): () => number { return () => { const now = (value as () => number)(); if (!Number.isSafeInteger(now) || now < 0) fail("CLOCK_INVALID"); return now; }; }
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]); return Object.freeze(value); }
function hasCode(error: unknown, code: string): boolean { return !!error && typeof error === "object" && "code" in error && error.code === code; }
function fail(code: OwnerElevenLabsStsRequestPreparerErrorCode): never { throw new OwnerElevenLabsStsRequestPreparerError(code); }
