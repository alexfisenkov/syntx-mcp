import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient, readOwnerWan26I2vUploadReferenceForClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type {
  OwnerWan26I2vAudioUploadContext,
  OwnerWan26I2vImageUploadContext,
  OwnerWan26I2vUploadContext
} from "../adapter/syntx/wan26-i2v-upload-context.js";
import {
  OwnerWan26I2vReferenceService,
  OwnerWan26I2vReferenceServiceError,
  type OwnerWan26I2vNativeReferenceTuple,
  type OwnerWan26I2vReferenceResolution,
  type OwnerWan26I2vReferenceResolveInput
} from "./owner-wan26-i2v-reference-service.js";
import {
  getOwnerWan26I2vGenerationParametersSource,
  normalizeOwnerWan26I2vGenerationParameters,
  OwnerWan26I2vGenerationParametersError,
  type OwnerWan26I2vGenerationIntent,
  type OwnerWan26I2vGenerationModelId,
  type OwnerWan26I2vGenerationParametersNormalized,
  type OwnerWan26I2vGenerationParametersSource
} from "./owner-wan26-i2v-generation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^[A-Za-z0-9_-]{1,160}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const MAX_PENDING = 4;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState | ExpiredCandidateState>();
const NATIVE_BINDINGS = new WeakMap<object, CandidateState>();
const NATIVE_IMAGE_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vImage;
const NATIVE_AUDIO_UPLOAD = SyntxChatHttpClient.prototype.uploadWan26I2vAudio;
const RESOLVE_REFERENCES = OwnerWan26I2vReferenceService.prototype.resolveReferences;
const IS_OWNED_RESOLUTION = OwnerWan26I2vReferenceService.prototype.isOwnedReferenceResolution;
const CAPTURE_REFERENCES = OwnerWan26I2vReferenceService.prototype.withCapturedNativeReferences;
const INVALIDATE_REFERENCES = OwnerWan26I2vReferenceService.prototype.invalidateAttempt;

export type OwnerWan26I2vPreparedInputReference =
  | Readonly<{ media_type: "image"; mime_type: OwnerWan26I2vImageUploadContext["mime_type"]; size: number; sha256: string; width: number; height: number }>
  | Readonly<{ media_type: "audio"; mime_type: OwnerWan26I2vAudioUploadContext["mime_type"]; size: number; sha256: string; duration_seconds: number }>;

export interface OwnerWan26I2vPreparedCandidate {
  readonly status: "prepared";
  readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly profile_schema_hash: string;
  readonly source_pins: OwnerWan26I2vGenerationParametersSource["source_pins"];
  readonly wire_facts: OwnerWan26I2vGenerationParametersSource["wire_facts"];
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly prompt_utf16_length: number;
  readonly image_reference_count: 1;
  readonly audio_reference_count: 0 | 1;
  readonly input_references: readonly OwnerWan26I2vPreparedInputReference[];
  readonly expires_at: number;
}

export interface OwnerWan26I2vPreparedRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: OwnerWan26I2vGenerationModelId;
    readonly resolution: OwnerWan26I2vGenerationIntent["parameters"]["resolution"];
    readonly aspect_ratio: OwnerWan26I2vGenerationIntent["parameters"]["aspect_ratio"];
    readonly video_duration: number;
    readonly prompt_extend: boolean;
    readonly seed: number | null;
    readonly native_audio: boolean;
    readonly shot_type: "single";
    readonly audio_setting: "auto";
    readonly file_urls: readonly Readonly<{ readonly type: "image" | "audio"; readonly url: string }> [];
  }>;
}

export interface OwnerWan26I2vPreparedCandidateBinding {
  readonly candidate: OwnerWan26I2vPreparedCandidate;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly reference_epoch: number;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly expires_at: number;
}

export interface OwnerWan26I2vNativeBindingToken {
  readonly status: "captured";
  readonly dispatch_allowed: false;
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly expires_at: number;
}

export interface OwnerWan26I2vRequestPreparerOptions {
  readonly referenceService: OwnerWan26I2vReferenceService;
  readonly now?: () => number;
}

export interface OwnerWan26I2vPrepareInput {
  readonly attempt_id: string;
  readonly model_id: OwnerWan26I2vGenerationModelId;
  readonly image_handle: string;
  readonly audio_handle: string | null;
  readonly prompt: string;
  readonly parameters: Readonly<{
    resolution: string;
    aspect_ratio: string;
    video_duration: number;
    prompt_extend: boolean;
    seed: number | null;
    native_audio: boolean;
  }>;
}

export interface OwnerWan26I2vRequestPreparer {
  prepare(input: unknown, signal?: AbortSignal): Promise<OwnerWan26I2vPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerWan26I2vPreparedCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerWan26I2vPreparedRequest;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerWan26I2vPreparedCandidateBinding>;
  getNativeBindingForClient(client: unknown, candidate: unknown): OwnerWan26I2vNativeBindingToken;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerWan26I2vRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CLOCK_INVALID"
  | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";

export class OwnerWan26I2vRequestPreparerError extends Error {
  constructor(readonly code: OwnerWan26I2vRequestPreparerErrorCode) {
    super("The owner WAN 2.6 I2V request could not be prepared safely.");
    this.name = "OwnerWan26I2vRequestPreparerError";
  }
}

interface CapturedReferences {
  readonly client: SyntxChatHttpClient;
  readonly contexts: OwnerWan26I2vNativeReferenceTuple;
  readonly inputReferences: readonly OwnerWan26I2vPreparedInputReference[];
  readonly fileUrls: OwnerWan26I2vPreparedRequest["settings"]["file_urls"];
}
interface PendingOperation {
  readonly attemptId: string;
  readonly epoch: number;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParent: () => void;
}
interface CandidateState {
  readonly factory: object;
  readonly preparer: OwnerWan26I2vRequestPreparer;
  readonly candidate: OwnerWan26I2vPreparedCandidate;
  readonly binding: OwnerWan26I2vPreparedCandidateBinding;
  readonly input: OwnerWan26I2vPrepareInput;
  readonly referenceInput: Readonly<OwnerWan26I2vReferenceResolveInput>;
  readonly resolution: OwnerWan26I2vReferenceResolution;
  readonly normalized: OwnerWan26I2vGenerationParametersNormalized;
  readonly request: OwnerWan26I2vPreparedRequest;
  readonly client: SyntxChatHttpClient;
  readonly contexts: OwnerWan26I2vNativeReferenceTuple;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly wireFingerprint: string;
  readonly isLive: () => boolean;
  expired: boolean;
}
interface ExpiredCandidateState { readonly candidate: OwnerWan26I2vPreparedCandidate; readonly expired: true }

/** Creates an owner-bound preparer; it keeps private references in closure state and grants no dispatch permission. */
export function createOwnerWan26I2vRequestPreparer(optionsInput: OwnerWan26I2vRequestPreparerOptions | unknown): OwnerWan26I2vRequestPreparer {
  const options = exactRecord(optionsInput, ["referenceService"], ["now"]);
  if (!isNativeReferenceService(options.referenceService) ||
      (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("SERVICE_BINDING_MISMATCH");
  const referenceService = options.referenceService as OwnerWan26I2vReferenceService;
  const source = getOwnerWan26I2vGenerationParametersSource();
  const profileSchemaHash = schemaHash(source);
  const clock = options.now === undefined ? () => performance.now() : readClock(options.now);
  const candidates = new Set<CandidateState>();
  const factory = Object.freeze({});
  const pending = new Set<PendingOperation>();
  const pendingByAttempt = new Map<string, Set<PendingOperation>>();
  const epochs = new Map<string, number>();
  const invalidating = new Set<string>();
  const invalidations = new Map<string, Promise<void>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  let lastNow = readClockValue(clock);

  const readNow = (): number => {
    const now = readClockValue(clock);
    if (now < lastNow) fail("CLOCK_INVALID");
    lastNow = now;
    return now;
  };

  const assertOperation = (operation: PendingOperation): void => {
    if (closed) fail("SERVICE_CLOSED");
    if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
    if (invalidating.has(operation.attemptId) || operation.epoch !== (epochs.get(operation.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
  };

  const begin = (attemptId: string, parent?: AbortSignal): PendingOperation => {
    if (closed) fail("SERVICE_CLOSED");
    if (invalidating.has(attemptId) || parent?.aborted) fail("REQUEST_ABORTED");
    readNow(); prune();
    if (pending.size >= MAX_PENDING) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = { attemptId, epoch: epochs.get(attemptId) ?? 0, controller, done, finish,
      removeParent: () => parent?.removeEventListener("abort", abort) };
    pending.add(operation);
    const byAttempt = pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    byAttempt.add(operation); pendingByAttempt.set(attemptId, byAttempt);
    return operation;
  };

  const finish = (operation: PendingOperation): void => {
    operation.removeParent(); pending.delete(operation);
    const byAttempt = pendingByAttempt.get(operation.attemptId); byAttempt?.delete(operation);
    if (!byAttempt?.size) pendingByAttempt.delete(operation.attemptId);
    operation.finish(); releaseEpoch(operation.attemptId);
  };

  const runOperation = async <T>(attemptId: string, signal: AbortSignal | undefined,
    work: (operation: PendingOperation) => Promise<T>): Promise<T> => {
    const operation = begin(attemptId, signal);
    try { return await work(operation); }
    finally { finish(operation); }
  };

  const prune = (): void => {
    const now = readNow();
    for (const state of candidates) {
      if (state.expired || state.expiresAt <= now || !isOwnedResolution(referenceService, state.resolution, state.referenceInput)) {
        expireState(state);
      }
    }
    for (const attemptId of epochs.keys()) releaseEpoch(attemptId);
  };

  const isLive = (state: CandidateState): boolean => {
    try {
      const live = !closed && candidates.has(state) && !state.expired && state.epoch === (epochs.get(state.input.attempt_id) ?? 0) &&
        readNow() < state.expiresAt && isOwnedResolution(referenceService, state.resolution, state.referenceInput);
      if (!live) expireState(state);
      return live;
    } catch { expireState(state); return false; }
  };

  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object);
    if (!state || state.candidate !== value) fail("CANDIDATE_UNBOUND");
    if (state.expired) fail("CANDIDATE_EXPIRED");
    if (!("factory" in state) || state.factory !== factory || state.preparer !== api) fail("CANDIDATE_UNBOUND");
    if (!isLive(state)) fail("CANDIDATE_EXPIRED");
    return state;
  };

  const capture = async (resolution: OwnerWan26I2vReferenceResolution, input: Readonly<OwnerWan26I2vReferenceResolveInput>,
    operation: PendingOperation): Promise<CapturedReferences> => {
    try {
      return await Reflect.apply(CAPTURE_REFERENCES, referenceService,
        [resolution, input, (client: SyntxChatHttpClient, contexts: OwnerWan26I2vNativeReferenceTuple) => {
          assertOperation(operation);
          return snapshotCapturedReferences(client, contexts, resolution);
        }, operation.controller.signal]) as CapturedReferences;
    } catch (error) { return mapReferenceError(error); }
  };

  const resolve = async (input: Readonly<OwnerWan26I2vReferenceResolveInput>, operation: PendingOperation): Promise<OwnerWan26I2vReferenceResolution> => {
    assertOperation(operation);
    try {
      const resolution = await Reflect.apply(RESOLVE_REFERENCES, referenceService, [input, operation.controller.signal]) as OwnerWan26I2vReferenceResolution;
      assertOperation(operation);
      assertOwnedResolution(referenceService, resolution, input);
      return resolution;
    } catch (error) { return mapReferenceError(error); }
  };

  const prepare: OwnerWan26I2vRequestPreparer["prepare"] = async (inputValue, signal) => {
    const input = snapshotInput(inputValue);
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
    return runOperation(input.attempt_id, signal, async (operation) => {
      const epoch = operation.epoch;
      const referenceInput = Object.freeze({ attempt_id: input.attempt_id, model_id: input.model_id,
        image_handle: input.image_handle, audio_handle: input.audio_handle });
      const normalized = normalizeIntent(input);
      const resolution = await resolve(referenceInput, operation);
      const captured = await capture(resolution, referenceInput, operation);
      assertOperation(operation);
      assertOwnedResolution(referenceService, resolution, referenceInput);
      if (captured.contexts.length !== (resolution.audio ? 2 : 1)) fail("REFERENCE_UNAVAILABLE");
      const prompt = normalized.intent.prompt;
      const request = buildRequest(normalized, captured, prompt);
      const intentFingerprint = fingerprintIntent(profileSchemaHash, source.source_pins, input, resolution.principal,
        normalized.intent, prompt, captured.inputReferences);
      const wireFingerprint = schemaHash(request);
      const expiresAt = Math.min(readNow() + TTL_MS, resolution.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= readNow()) fail("REFERENCE_EXPIRED");
      prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      const safeReferences = deepFreeze([...captured.inputReferences]) as readonly OwnerWan26I2vPreparedInputReference[];
      const candidate = deepFreeze({ status: "prepared" as const,
        source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT" as const,
        dispatch_allowed: false as const, runtime_usable: false as const, backend_acceptance: "UNPROVEN" as const,
        model_id: input.model_id, profile_schema_hash: profileSchemaHash, source_pins: source.source_pins,
        wire_facts: source.wire_facts, intent_fingerprint: intentFingerprint, request_fingerprint: wireFingerprint,
        prompt_utf16_length: prompt.length, image_reference_count: 1 as const,
        audio_reference_count: resolution.audio ? 1 as const : 0 as const, input_references: safeReferences, expires_at: expiresAt });
      const stateWithoutBinding = { factory, preparer: api, candidate, input, referenceInput, resolution, normalized, request,
        client: captured.client, contexts: captured.contexts, expiresAt, epoch, wireFingerprint, expired: false };
      let state!: CandidateState;
      const isCandidateLive = (): boolean => isLive(state);
      const binding: OwnerWan26I2vPreparedCandidateBinding = deepFreeze({ candidate, attempt_id: input.attempt_id,
        principal: resolution.principal, model_id: input.model_id, reference_epoch: resolution.epoch,
        profile_schema_hash: profileSchemaHash, intent_fingerprint: intentFingerprint,
        request_fingerprint: wireFingerprint, wire_fingerprint: wireFingerprint, expires_at: expiresAt });
      state = { ...stateWithoutBinding, binding, isLive: isCandidateLive };
      CANDIDATES.set(candidate, state); candidates.add(state);
      return candidate;
    });
  };

  const inspectCandidate: OwnerWan26I2vRequestPreparer["inspectCandidate"] = (candidate) => {
    try { return stateFor(candidate).binding; } catch { return undefined; }
  };

  const getPrivateRequest: OwnerWan26I2vRequestPreparer["getPrivateRequest"] = (candidate) => stateFor(candidate).request;

  const revalidateCandidate: OwnerWan26I2vRequestPreparer["revalidateCandidate"] = async (candidate, signal) => {
    const state = stateFor(candidate);
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
    return runOperation(state.input.attempt_id, signal, async (operation) => {
      assertStateOperation(state, operation);
      const resolution = await resolve(state.referenceInput, operation);
      const captured = await capture(resolution, state.referenceInput, operation);
      assertStateOperation(state, operation);
      if (!sameResolution(state.resolution, resolution) || captured.client !== state.client ||
          !sameContexts(captured.contexts, state.contexts)) {
        expireState(state); fail("REFERENCE_UNAVAILABLE");
      }
      const normalized = normalizeIntent(state.input);
      const request = buildRequest(normalized, captured, normalized.intent.prompt);
      const intentFingerprint = fingerprintIntent(profileSchemaHash, source.source_pins, state.input, resolution.principal,
        normalized.intent, normalized.intent.prompt, captured.inputReferences);
      if (intentFingerprint !== state.candidate.intent_fingerprint || schemaHash(request) !== state.wireFingerprint ||
          readNow() >= state.expiresAt) {
        expireState(state); fail("REFERENCE_UNAVAILABLE");
      }
      return state.binding;
    });
  };

  const getNativeBindingForClient: OwnerWan26I2vRequestPreparer["getNativeBindingForClient"] = (clientInput, candidate) => {
    const state = stateFor(candidate);
    if (clientInput !== state.client || !isExactNativeClient(clientInput) || !readCapturedContexts(state.client, state.contexts)) fail("CANDIDATE_UNBOUND");
    let token = NATIVE_TOKENS.get(state);
    if (!token) {
      token = Object.freeze({ status: "captured" as const, dispatch_allowed: false as const, model_id: state.candidate.model_id,
        profile_schema_hash: state.binding.profile_schema_hash, intent_fingerprint: state.binding.intent_fingerprint,
        request_fingerprint: state.binding.request_fingerprint, expires_at: state.binding.expires_at });
      NATIVE_BINDINGS.set(token, state); NATIVE_TOKENS.set(state, token);
    }
    return token;
  };

  const invalidateAttempt: OwnerWan26I2vRequestPreparer["invalidateAttempt"] = async (attemptId) => {
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId) || closed) return;
    const prior = invalidations.get(attemptId); if (prior) return prior;
    invalidating.add(attemptId); epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
    for (const state of candidates) if (state.input.attempt_id === attemptId) expireState(state);
    const operations = [...(pendingByAttempt.get(attemptId) ?? [])];
    for (const operation of operations) operation.controller.abort();
    const invalidation = (async () => {
      try {
        await Promise.allSettled(operations.map((operation) => operation.done));
        try { await Reflect.apply(INVALIDATE_REFERENCES, referenceService, [attemptId]); }
        catch (error) { mapReferenceError(error); }
      } finally { invalidating.delete(attemptId); invalidations.delete(attemptId); releaseEpoch(attemptId); }
    })();
    invalidations.set(attemptId, invalidation);
    return invalidation;
  };

  const close: OwnerWan26I2vRequestPreparer["close"] = () => {
    if (closing) return closing;
    closed = true;
    for (const state of candidates) expireState(state);
    for (const operation of pending) operation.controller.abort();
    const operations = [...pending].map((operation) => operation.done);
    closing = Promise.allSettled([...operations, ...invalidations.values()]).then(() => {
      pendingByAttempt.clear(); epochs.clear(); invalidating.clear(); invalidations.clear();
    });
    return closing;
  };

  const api: OwnerWan26I2vRequestPreparer = Object.freeze({ prepare, inspectCandidate, getPrivateRequest,
    revalidateCandidate, getNativeBindingForClient, invalidateAttempt, close });
  PREPARERS.add(api);
  return api;

  function releaseEpoch(attemptId: string): void {
    if (pendingByAttempt.has(attemptId) || invalidating.has(attemptId)) return;
    for (const state of candidates) if (state.input.attempt_id === attemptId) return;
    epochs.delete(attemptId);
  }

  function expireState(state: CandidateState): void {
    state.expired = true; candidates.delete(state);
    const token = NATIVE_TOKENS.get(state);
    if (token) { NATIVE_BINDINGS.delete(token); NATIVE_TOKENS.delete(state); }
    CANDIDATES.set(state.candidate, Object.freeze({ candidate: state.candidate, expired: true as const }));
  }

  function assertStateOperation(state: CandidateState, operation: PendingOperation): void {
    assertOperation(operation);
    if (!state.isLive() || state.epoch !== operation.epoch || readNow() >= state.expiresAt) {
      expireState(state); fail("CANDIDATE_EXPIRED");
    }
  }
}

const NATIVE_TOKENS = new WeakMap<CandidateState, OwnerWan26I2vNativeBindingToken>();

export function isOwnerWan26I2vRequestPreparer(value: unknown): value is OwnerWan26I2vRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value as object) && Object.isFrozen(value);
}

export function isOwnerWan26I2vPreparedCandidate(value: unknown): value is OwnerWan26I2vPreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  return !!state && state.candidate === value && !state.expired && "isLive" in state && state.isLive();
}

/** Reads the exact stored image-only or image-plus-audio tuple for its minting native client. */
export function readOwnerWan26I2vNativeBindingForClient(clientInput: unknown, tokenInput: unknown): OwnerWan26I2vNativeReferenceTuple | null {
  try {
    if (!isExactNativeClient(clientInput) || !tokenInput || typeof tokenInput !== "object" || types.isProxy(tokenInput)) return null;
    const state = NATIVE_BINDINGS.get(tokenInput);
    if (!state || state.client !== clientInput || NATIVE_TOKENS.get(state) !== tokenInput || !state.isLive() ||
        !isCapturedTupleForModel(clientInput, state.contexts, state.candidate.model_id)) return null;
    const token = tokenInput as OwnerWan26I2vNativeBindingToken;
    if (!Object.isFrozen(token) || token.status !== "captured" || token.dispatch_allowed !== false ||
        token.model_id !== state.candidate.model_id || token.profile_schema_hash !== state.binding.profile_schema_hash ||
        token.intent_fingerprint !== state.binding.intent_fingerprint || token.request_fingerprint !== state.binding.request_fingerprint ||
        token.expires_at !== state.binding.expires_at) return null;
    return state.contexts;
  } catch { return null; }
}

function snapshotCapturedReferences(client: SyntxChatHttpClient, contexts: OwnerWan26I2vNativeReferenceTuple,
  resolution: OwnerWan26I2vReferenceResolution): CapturedReferences {
  if (!isExactNativeClient(client) || !isCapturedTupleForModel(client, contexts, resolution.model_id) ||
      resolution.generation_permit !== false || resolution.audio === null && contexts.length !== 1 ||
      resolution.audio !== null && contexts.length !== 2) fail("REFERENCE_UNAVAILABLE");
  const image = contexts[0];
  const imageMetadata = resolution.image;
  if (!image || image.status !== "uploaded" || image.model_id !== resolution.model_id || image.media_type !== "image" ||
      image.mime_type !== imageMetadata.mime_type || image.size !== imageMetadata.size || image.sha256 !== imageMetadata.sha256 ||
      image.width !== imageMetadata.width || image.height !== imageMetadata.height || imageMetadata.model_id !== resolution.model_id ||
      imageMetadata.generation_permit !== false || !SHA256.test(image.sha256) || !Number.isSafeInteger(image.size) || image.size < 1 ||
      !validImageMime(image.mime_type) || !boundedDimension(image.width) || !boundedDimension(image.height)) fail("REFERENCE_UNAVAILABLE");
  const inputReferences: OwnerWan26I2vPreparedInputReference[] = [Object.freeze({ media_type: "image", mime_type: image.mime_type,
    size: image.size, sha256: image.sha256, width: image.width, height: image.height })];
  const fileUrls: Readonly<{ type: "image" | "audio"; url: string }>[] = [];
  const seen = new Set<string>();
  const append = (type: "image" | "audio", context: OwnerWan26I2vUploadContext): void => {
    const reference = readOwnerWan26I2vUploadReferenceForClient(client, context);
    if (!reference || !isSafeUploadReferenceUrl(reference.url)) fail("REFERENCE_UNAVAILABLE");
    const key = JSON.stringify([type, reference.url]);
    if (!seen.has(key)) { seen.add(key); fileUrls.push(Object.freeze({ type, url: reference.url })); }
  };
  append("image", image);
  const audio = contexts.length === 2 ? contexts[1] as OwnerWan26I2vAudioUploadContext : undefined;
  if (resolution.audio) {
    const metadata = resolution.audio;
    if (!audio || audio.status !== "uploaded" || audio.model_id !== resolution.model_id || audio.media_type !== "audio" ||
        audio.mime_type !== metadata.mime_type || audio.size !== metadata.size || audio.sha256 !== metadata.sha256 ||
        audio.measured_duration_seconds !== metadata.duration_seconds || metadata.model_id !== resolution.model_id ||
        metadata.generation_permit !== false || !SHA256.test(audio.sha256) || !Number.isSafeInteger(audio.size) || audio.size < 1 ||
        !validAudioMime(audio.mime_type) || !Number.isFinite(audio.measured_duration_seconds) ||
        audio.measured_duration_seconds < 3 || audio.measured_duration_seconds > 30) fail("REFERENCE_UNAVAILABLE");
    inputReferences.push(Object.freeze({ media_type: "audio", mime_type: audio.mime_type, size: audio.size,
      sha256: audio.sha256, duration_seconds: audio.measured_duration_seconds }));
    append("audio", audio);
  }
  return Object.freeze({ client, contexts: Object.freeze([...contexts]) as OwnerWan26I2vNativeReferenceTuple,
    inputReferences: Object.freeze(inputReferences), fileUrls: Object.freeze(fileUrls) });
}

function buildRequest(normalized: OwnerWan26I2vGenerationParametersNormalized, captured: CapturedReferences,
  prompt: string): OwnerWan26I2vPreparedRequest {
  const intent = normalized.intent, parameters = intent.parameters;
  return deepFreeze({ prompt, settings: { model_type: intent.model_id, resolution: parameters.resolution,
    aspect_ratio: parameters.aspect_ratio, video_duration: parameters.video_duration, prompt_extend: parameters.prompt_extend,
    seed: parameters.seed, native_audio: parameters.native_audio, shot_type: "single" as const,
    audio_setting: "auto" as const, file_urls: captured.fileUrls } });
}

function fingerprintIntent(profile: string, sourcePins: OwnerWan26I2vGenerationParametersSource["source_pins"],
  input: OwnerWan26I2vPrepareInput, principal: Readonly<GenerationPrincipalRef>, intent: OwnerWan26I2vGenerationIntent,
  prompt: string, references: readonly OwnerWan26I2vPreparedInputReference[]): string {
  return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, attempt_id: input.attempt_id,
    model_id: input.model_id, profile_schema_hash: profile, source_pins: sourcePins, prompt,
    parameters: intent.parameters, fixed_fields: getOwnerWan26I2vGenerationParametersSource().wire_facts.fixed_fields,
    references: references.map((reference) => reference.media_type === "image"
      ? { media_type: reference.media_type, mime_type: reference.mime_type, size: reference.size, sha256: reference.sha256,
        width: reference.width, height: reference.height }
      : { media_type: reference.media_type, mime_type: reference.mime_type, size: reference.size, sha256: reference.sha256,
        duration_seconds: reference.duration_seconds }) });
}

function sameResolution(left: OwnerWan26I2vReferenceResolution, right: OwnerWan26I2vReferenceResolution): boolean {
  return left.model_id === right.model_id && left.attempt_id === right.attempt_id && left.epoch === right.epoch &&
    left.expires_at === right.expires_at && sameGenerationPrincipal(left.principal, right.principal) &&
    left.generation_permit === false && right.generation_permit === false &&
    left.image.image_handle === right.image.image_handle && left.image.model_id === right.image.model_id &&
    left.image.filename === right.image.filename && left.image.mime_type === right.image.mime_type && left.image.size === right.image.size &&
    left.image.sha256 === right.image.sha256 && left.image.width === right.image.width && left.image.height === right.image.height &&
    left.audio?.audio_handle === right.audio?.audio_handle && left.audio?.model_id === right.audio?.model_id &&
    left.audio?.filename === right.audio?.filename && left.audio?.mime_type === right.audio?.mime_type &&
    left.audio?.size === right.audio?.size && left.audio?.sha256 === right.audio?.sha256 &&
    left.audio?.duration_seconds === right.audio?.duration_seconds;
}

function sameContexts(left: OwnerWan26I2vNativeReferenceTuple, right: OwnerWan26I2vNativeReferenceTuple): boolean {
  return left.length === right.length && left.every((context, index) => context === right[index]);
}

function assertOwnedResolution(service: OwnerWan26I2vReferenceService, resolution: OwnerWan26I2vReferenceResolution,
  input: Readonly<OwnerWan26I2vReferenceResolveInput>): void {
  if (!resolution || typeof resolution !== "object" || types.isProxy(resolution) || !Object.isFrozen(resolution) ||
      !isOwnedResolution(service, resolution, input) || resolution.model_id !== input.model_id ||
      resolution.attempt_id !== input.attempt_id || resolution.image.image_handle !== input.image_handle ||
      resolution.image.model_id !== input.model_id || resolution.image.generation_permit !== false ||
      resolution.generation_permit !== false || (input.audio_handle === null ? resolution.audio !== null :
        !resolution.audio || resolution.audio.audio_handle !== input.audio_handle || resolution.audio.model_id !== input.model_id ||
        resolution.audio.generation_permit !== false) || !Number.isSafeInteger(resolution.epoch) || resolution.epoch < 0 ||
      !Number.isFinite(resolution.expires_at) || resolution.expires_at <= 0 || resolution.principal.connection_id !== input.attempt_id) {
    fail("REFERENCE_UNAVAILABLE");
  }
}

function isOwnedResolution(service: OwnerWan26I2vReferenceService, resolution: unknown,
  input: Readonly<OwnerWan26I2vReferenceResolveInput>): resolution is OwnerWan26I2vReferenceResolution {
  try { return Reflect.apply(IS_OWNED_RESOLUTION, service, [resolution, input]) === true; }
  catch { return false; }
}

function snapshotInput(value: unknown): Readonly<OwnerWan26I2vPrepareInput> {
  const f = exactRecord(value, ["attempt_id", "model_id", "image_handle", "audio_handle", "prompt", "parameters"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || !isModelId(f.model_id) ||
      typeof f.image_handle !== "string" || !HANDLE.test(f.image_handle) ||
      (f.audio_handle !== null && (typeof f.audio_handle !== "string" || !HANDLE.test(f.audio_handle))) ||
      typeof f.prompt !== "string") fail("INVALID_REQUEST");
  const parameterFields = exactRecord(f.parameters, ["resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed", "native_audio"]);
  return Object.freeze({ attempt_id: f.attempt_id, model_id: f.model_id, image_handle: f.image_handle,
    audio_handle: f.audio_handle as string | null, prompt: f.prompt,
    parameters: Object.freeze({ resolution: parameterFields.resolution as string, aspect_ratio: parameterFields.aspect_ratio as string,
      video_duration: parameterFields.video_duration as number, prompt_extend: parameterFields.prompt_extend as boolean,
      seed: parameterFields.seed as number | null, native_audio: parameterFields.native_audio as boolean }) });
}

function normalizeIntent(input: Readonly<OwnerWan26I2vPrepareInput>): OwnerWan26I2vGenerationParametersNormalized {
  try { return normalizeOwnerWan26I2vGenerationParameters({ model_id: input.model_id, prompt: input.prompt, parameters: input.parameters }); }
  catch (error) { if (error instanceof OwnerWan26I2vGenerationParametersError) fail("PARAMETERS_INVALID"); return mapReferenceError(error); }
}

function isNativeReferenceService(value: unknown): value is OwnerWan26I2vReferenceService {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) &&
      Object.getPrototypeOf(value) === OwnerWan26I2vReferenceService.prototype && Object.isFrozen(value) &&
      !Object.hasOwn(value, "resolveReferences") && !Object.hasOwn(value, "isOwnedReferenceResolution") &&
      !Object.hasOwn(value, "withCapturedNativeReferences") && !Object.hasOwn(value, "invalidateAttempt") && !Object.hasOwn(value, "close") &&
      OwnerWan26I2vReferenceService.prototype.resolveReferences === RESOLVE_REFERENCES &&
      OwnerWan26I2vReferenceService.prototype.isOwnedReferenceResolution === IS_OWNED_RESOLUTION &&
      OwnerWan26I2vReferenceService.prototype.withCapturedNativeReferences === CAPTURE_REFERENCES &&
      OwnerWan26I2vReferenceService.prototype.invalidateAttempt === INVALIDATE_REFERENCES &&
      Object.getOwnPropertyDescriptor(value, "resolveReferences") === undefined;
  } catch { return false; }
}

function isExactNativeClient(value: unknown): value is SyntxChatHttpClient {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
      !Object.hasOwn(value, "uploadWan26I2vImage") && !Object.hasOwn(value, "uploadWan26I2vAudio") &&
      SyntxChatHttpClient.prototype.uploadWan26I2vImage === NATIVE_IMAGE_UPLOAD &&
      SyntxChatHttpClient.prototype.uploadWan26I2vAudio === NATIVE_AUDIO_UPLOAD &&
      Reflect.get(value, "uploadWan26I2vImage") === NATIVE_IMAGE_UPLOAD && Reflect.get(value, "uploadWan26I2vAudio") === NATIVE_AUDIO_UPLOAD;
  } catch { return false; }
}

function isCapturedTupleForModel(client: unknown, contexts: unknown, modelId: OwnerWan26I2vGenerationModelId): contexts is OwnerWan26I2vNativeReferenceTuple {
  try {
    if (!isExactNativeClient(client) || !Array.isArray(contexts) || types.isProxy(contexts) ||
        (contexts.length !== 1 && contexts.length !== 2) || !Object.isFrozen(contexts)) return false;
    const image = contexts[0];
    if (!image || typeof image !== "object" || types.isProxy(image) || image.status !== "uploaded" ||
        image.model_id !== modelId || image.media_type !== "image" || !readOwnerWan26I2vUploadReferenceForClient(client, image)) return false;
    if (contexts.length === 1) return true;
    const audio = contexts[1];
    return !!audio && typeof audio === "object" && !types.isProxy(audio) && audio.status === "uploaded" &&
      audio.model_id === modelId && audio.media_type === "audio" &&
      readOwnerWan26I2vUploadReferenceForClient(client, audio) !== null;
  } catch { return false; }
}

function readCapturedContexts(client: SyntxChatHttpClient, contexts: OwnerWan26I2vNativeReferenceTuple): boolean {
  try {
    if (!isCapturedTupleForModel(client, contexts, contexts[0].model_id)) return false;
    return contexts.length === 1 ? contexts[0].media_type === "image" :
      contexts[0].media_type === "image" && contexts[1].media_type === "audio" && contexts[1].model_id === contexts[0].model_id;
  } catch { return false; }
}

function validImageMime(value: unknown): value is OwnerWan26I2vImageUploadContext["mime_type"] {
  return value === "image/jpeg" || value === "image/png" || value === "image/bmp" || value === "image/webp";
}
function validAudioMime(value: unknown): value is OwnerWan26I2vAudioUploadContext["mime_type"] {
  return value === "audio/mpeg" || value === "audio/wav";
}
function boundedDimension(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 384 && (value as number) <= 5_000; }
function isModelId(value: unknown): value is OwnerWan26I2vGenerationModelId { return value === "wan_26_i2v" || value === "wan_26_i2v_flash"; }

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...required, ...optional]);
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !Object.hasOwn(descriptors[key]!, "value"))) fail("INVALID_REQUEST");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return fail("INVALID_REQUEST"); }
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let current: unknown; try { current = Reflect.apply(value, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (typeof current !== "number" || !Number.isFinite(current) || current < 0 || current > Number.MAX_SAFE_INTEGER) fail("CLOCK_INVALID");
    return current; };
}
function readClockValue(value: () => number): number { try { return value(); } catch { return fail("CLOCK_INVALID"); } }
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function mapReferenceError(error: unknown): never {
  if (error instanceof OwnerWan26I2vRequestPreparerError) throw error;
  if (error instanceof OwnerWan26I2vGenerationParametersError) fail("PARAMETERS_INVALID");
  if (error instanceof OwnerWan26I2vReferenceServiceError) {
    if (error.code === "REQUEST_ABORTED" || error.code === "SERVICE_CLOSED") fail(error.code === "REQUEST_ABORTED" ? "REQUEST_ABORTED" : "SERVICE_CLOSED");
    if (error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
    if (error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_MISMATCH");
    if (error.code === "CAPACITY_EXCEEDED" || error.code === "SERVICE_BUSY") fail("CAPACITY_EXCEEDED");
  }
  fail("REFERENCE_UNAVAILABLE");
}
function fail(code: OwnerWan26I2vRequestPreparerErrorCode): never { throw new OwnerWan26I2vRequestPreparerError(code); }
