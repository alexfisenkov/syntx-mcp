import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerWan26R2vImageUploadContext } from "../adapter/syntx/wan26-r2v-upload-context.js";
import { readOwnerWan26R2vUploadReferenceForClient } from "../adapter/syntx/wan26-r2v-upload-context.js";
import type { OwnerWan26R2vSelectedVideoUploadContext } from "../adapter/syntx/wan26-r2v-video-upload-context.js";
import { readOwnerWan26R2vVideoUploadReferenceForClient } from "../adapter/syntx/wan26-r2v-video-upload-context.js";
import {
  OwnerWan26R2vReferenceService,
  OwnerWan26R2vReferenceServiceError,
  type OwnerWan26R2vReferenceManifest
} from "./owner-wan26-r2v-reference-service.js";
import {
  getOwnerWan26R2vGenerationParametersSource,
  normalizeOwnerWan26R2vGenerationParameters,
  type OwnerWan26R2vGenerationModelId,
  type OwnerWan26R2vGenerationParameters
} from "./owner-wan26-r2v-generation-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const MAX_ATTEMPTS = 128;
const MAX_PENDING = 4;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();
const LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLVE = OwnerWan26R2vReferenceService.prototype.resolveManifest;
const OWNED = OwnerWan26R2vReferenceService.prototype.isOwnedManifest;
const CAPTURE = OwnerWan26R2vReferenceService.prototype.withCapturedNativeReferences;
const INVALIDATE = OwnerWan26R2vReferenceService.prototype.invalidateAttempt;
const ABORT_SIGNAL_PROTO = AbortSignal.prototype;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(ABORT_SIGNAL_PROTO, "aborted")?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

export interface OwnerWan26R2vPreparedInputReference {
  readonly media_type: "image" | "selected_video";
  readonly mime_type: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly source_sha256?: string;
  readonly selected_duration_seconds?: number;
  readonly video_duration_seconds?: number;
}

export interface OwnerWan26R2vPreparedCandidate {
  readonly status: "prepared";
  readonly source_readiness: "PARTIAL_SOURCE_EXPLICIT_SETTINGS";
  readonly prompt_readiness: "CURRENT_PROMPT_RULES_NOT_ESTABLISHED";
  readonly settings_readiness: "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: OwnerWan26R2vGenerationModelId;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly prompt_utf16_length: number;
  readonly image_reference_count: number;
  readonly video_reference_count: number;
  readonly input_references: readonly OwnerWan26R2vPreparedInputReference[];
  readonly expires_at: number;
}

export interface OwnerWan26R2vPreparedRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: OwnerWan26R2vGenerationModelId;
    readonly resolution: OwnerWan26R2vGenerationParameters["resolution"];
    readonly aspect_ratio: OwnerWan26R2vGenerationParameters["aspect_ratio"];
    readonly video_duration: OwnerWan26R2vGenerationParameters["video_duration"];
    readonly seed: number | null;
    readonly duration: number;
    readonly file_urls: readonly Readonly<{ readonly type: "image" | "video"; readonly url: string }>[];
    readonly native_audio?: boolean;
  }>;
}

export interface OwnerWan26R2vPreparedCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerWan26R2vGenerationModelId;
  readonly reference_handles: readonly string[];
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  /** Hashes the private URL-bearing request; neither URLs nor prompt are exposed. */
  readonly private_request_fingerprint: string;
  readonly expires_at: number;
  readonly input_references: readonly OwnerWan26R2vPreparedInputReference[];
}

export interface OwnerWan26R2vRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly referenceService: OwnerWan26R2vReferenceService;
  readonly now?: () => number;
}

export interface OwnerWan26R2vPrepareInput {
  readonly attemptId: string;
  readonly model_id: OwnerWan26R2vGenerationModelId;
  readonly prompt: string;
  readonly parameters: OwnerWan26R2vGenerationParameters;
  readonly reference_handles: readonly string[];
}

export interface OwnerWan26R2vRequestPreparer {
  prepare(input: unknown, signal?: AbortSignal): Promise<OwnerWan26R2vPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerWan26R2vPreparedCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerWan26R2vPreparedRequest;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerWan26R2vPreparedCandidateBinding>;
  withCapturedNativeReferences<T>(candidate: unknown,
    consume: (client: SyntxChatHttpClient, contexts: readonly (OwnerWan26R2vImageUploadContext | OwnerWan26R2vSelectedVideoUploadContext)[], request: OwnerWan26R2vPreparedRequest) => T | Promise<T>,
    signal?: AbortSignal): Promise<T>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerWan26R2vRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "PARAMETERS_INVALID" | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";

export class OwnerWan26R2vRequestPreparerError extends Error {
  constructor(readonly code: OwnerWan26R2vRequestPreparerErrorCode) {
    super("The owner WAN 2.6 R2V request could not be prepared safely.");
    this.name = "OwnerWan26R2vRequestPreparerError";
  }
}

interface CandidateState {
  readonly factory: object;
  readonly candidate: OwnerWan26R2vPreparedCandidate;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly modelId: OwnerWan26R2vGenerationModelId;
  readonly handles: readonly string[];
  readonly manifest: OwnerWan26R2vReferenceManifest;
  readonly requestInput: OwnerWan26R2vPrepareInput;
  readonly request: OwnerWan26R2vPreparedRequest;
  readonly client: SyntxChatHttpClient;
  readonly contexts: readonly (OwnerWan26R2vImageUploadContext | OwnerWan26R2vSelectedVideoUploadContext)[];
  readonly binding: OwnerWan26R2vPreparedCandidateBinding;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly isLive: () => boolean;
  expired: boolean;
}

interface PendingOperation {
  readonly attemptId: string;
  readonly epoch: number;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParent: () => void;
}

interface Captured {
  readonly client: SyntxChatHttpClient;
  readonly contexts: readonly (OwnerWan26R2vImageUploadContext | OwnerWan26R2vSelectedVideoUploadContext)[];
  readonly inputReferences: readonly OwnerWan26R2vPreparedInputReference[];
  readonly fileUrls: readonly Readonly<{ readonly type: "image" | "video"; readonly url: string }>[];
  readonly selectedDuration: number;
}

export function createOwnerWan26R2vRequestPreparer(optionsInput: OwnerWan26R2vRequestPreparerOptions | unknown): OwnerWan26R2vRequestPreparer {
  const fields = exactRecord(optionsInput, ["binding", "linkService", "referenceService"], ["now"]);
  if (!isLinkService(fields.linkService) || !isReferenceService(fields.referenceService) ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  const binding = snapshotBinding(fields.binding);
  const linkService = fields.linkService as PerUserLinkService;
  const referenceService = fields.referenceService as OwnerWan26R2vReferenceService;
  const source = getOwnerWan26R2vGenerationParametersSource();
  const profileHash = schemaHash(source);
  const clock = fields.now === undefined ? () => performance.now() : readClock(fields.now);
  const candidates = new Set<CandidateState>();
  const factory = Object.freeze({});
  const epochs = new Map<string, number>();
  const pending = new Set<PendingOperation>();
  const pendingByAttempt = new Map<string, Set<PendingOperation>>();
  const invalidating = new Set<string>();
  const invalidations = new Map<string, Promise<void>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  let lastNow = clock();

  const readNow = (): number => {
    const now = clock();
    if (!Number.isFinite(now) || now < lastNow || now > Number.MAX_SAFE_INTEGER) fail("CLOCK_INVALID");
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
    if (parent !== undefined && !isAbortSignal(parent)) fail("INVALID_REQUEST");
    if (invalidating.has(attemptId) || (parent !== undefined && isAborted(parent))) fail("REQUEST_ABORTED");
    readNow();
    if (pending.size >= MAX_PENDING) fail("CAPACITY_EXCEEDED");
    prune();
    const tracked = trackedAttempts();
    if (!tracked.has(attemptId) && tracked.size >= MAX_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (parent) Reflect.apply(ADD_EVENT_LISTENER, parent, ["abort", abort, { once: true }]);
    let done!: () => void;
    const promise = new Promise<void>((resolve) => { done = resolve; });
    const operation: PendingOperation = { attemptId, epoch: epochs.get(attemptId) ?? 0, controller,
      done: promise, finish: done, removeParent: () => { if (parent) Reflect.apply(REMOVE_EVENT_LISTENER, parent, ["abort", abort]); } };
    pending.add(operation);
    const attemptSet = pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    attemptSet.add(operation);
    pendingByAttempt.set(attemptId, attemptSet);
    return operation;
  };
  const finish = (operation: PendingOperation): void => {
    operation.removeParent();
    pending.delete(operation);
    const attemptSet = pendingByAttempt.get(operation.attemptId);
    attemptSet?.delete(operation);
    if (!attemptSet?.size) pendingByAttempt.delete(operation.attemptId);
    operation.finish();
    releaseAttemptIfIdle(operation.attemptId);
  };
  const runOperation = async <T>(attemptId: string, signal: AbortSignal | undefined,
    work: (operation: PendingOperation) => Promise<T>): Promise<T> => {
    const operation = begin(attemptId, signal);
    try { return await work(operation); } finally { finish(operation); }
  };
  const prune = (): void => {
    const now = readNow();
    for (const state of candidates) {
      if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); }
    }
    for (const attemptId of epochs.keys()) releaseAttemptIfIdle(attemptId);
  };
  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object);
    if (!state || state.candidate !== value || state.factory !== factory) fail("CANDIDATE_UNBOUND");
    if (!candidates.has(state)) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
    if (!state.isLive()) {
      state.expired = true;
      candidates.delete(state);
      fail("CANDIDATE_EXPIRED");
    }
    return state;
  };

  const capture = async (manifest: OwnerWan26R2vReferenceManifest, operation: PendingOperation): Promise<Captured> => {
    try {
      return await referenceService.withCapturedNativeReferences(manifest, (client, contexts) => {
        assertOperation(operation);
        if (!(client instanceof SyntxChatHttpClient) || contexts.length !== manifest.total_reference_count ||
            contexts.length < 1 || contexts.length > 5 || contexts.length !== manifest.references.length) fail("REFERENCE_UNAVAILABLE");
        const inputReferences: OwnerWan26R2vPreparedInputReference[] = [];
        const fileUrls: Readonly<{ type: "image" | "video"; url: string }>[] = [];
        const seen = new Set<string>();
        let images = 0, videos = 0, selectedDuration = 0;
        for (let index = 0; index < contexts.length; index += 1) {
          const context = contexts[index]!;
          const metadata = manifest.references[index]!;
          if (!context || typeof context !== "object" || types.isProxy(context) || context.status !== "uploaded" ||
              context.model_id !== manifest.model_id || metadata.model_id !== manifest.model_id || context.sha256 !== metadata.sha256 || context.mime_type !== metadata.mime_type ||
              context.size !== metadata.size || context.width !== metadata.width || context.height !== metadata.height ||
              context.media_type !== metadata.media_type) fail("REFERENCE_UNAVAILABLE");
          const type = context.media_type === "image" ? "image" : context.media_type === "selected_video" ? "video" : undefined;
          const owned = type === "image" ? readOwnerWan26R2vUploadReferenceForClient(client, context) :
            type === "video" ? readOwnerWan26R2vVideoUploadReferenceForClient(client, context) : null;
          if (!type || !owned || !isSafeUploadReferenceUrl(owned.url)) fail("REFERENCE_UNAVAILABLE");
          const entry: OwnerWan26R2vPreparedInputReference = context.media_type === "image"
            ? Object.freeze({ media_type: "image", mime_type: context.mime_type, size: context.size,
              sha256: context.sha256, width: context.width, height: context.height })
            : (() => {
              const video = context as OwnerWan26R2vSelectedVideoUploadContext;
              const perVideoLimit = 5 / contexts.length;
              if (video.mime_type !== "video/mp4" || !/^[a-f0-9]{64}$/u.test(video.source_sha256) ||
                  !Number.isFinite(video.selected_duration_seconds) || video.selected_duration_seconds <= 0 ||
                  !Number.isFinite(video.video_duration_seconds) || video.video_duration_seconds <= 0 ||
                  video.selected_duration_seconds > perVideoLimit + 0.000001 || video.video_duration_seconds > perVideoLimit + 0.000001 ||
                  metadata.source_sha256 !== video.source_sha256 || metadata.selected_duration_seconds !== video.selected_duration_seconds ||
                  metadata.video_duration_seconds !== video.video_duration_seconds) fail("REFERENCE_UNAVAILABLE");
              selectedDuration += video.selected_duration_seconds;
              videos += 1;
              return Object.freeze({ media_type: "selected_video", mime_type: video.mime_type, size: video.size,
                sha256: video.sha256, width: video.width, height: video.height, source_sha256: video.source_sha256,
                selected_duration_seconds: video.selected_duration_seconds, video_duration_seconds: video.video_duration_seconds });
            })();
          if (context.media_type === "image") images += 1;
          inputReferences.push(entry);
          const key = JSON.stringify([type, owned.url]);
          if (!seen.has(key)) { seen.add(key); fileUrls.push(Object.freeze({ type, url: owned.url })); }
        }
        if (images !== manifest.image_count || videos !== manifest.video_count || images > 2 || videos > 3 ||
            images + videos !== contexts.length || contexts.length > 5 || selectedDuration > 5.000001) fail("REFERENCE_UNAVAILABLE");
        return Object.freeze({ client, contexts: Object.freeze([...contexts]), inputReferences: Object.freeze(inputReferences),
          fileUrls: Object.freeze(fileUrls), selectedDuration: round2(selectedDuration) });
      }, operation.controller.signal);
    } catch (error) { return mapReferenceError(error); }
  };

  const prepare: OwnerWan26R2vRequestPreparer["prepare"] = async (input, signal) => {
    const requestInput = snapshotInput(input);
    return runOperation(requestInput.attemptId, signal, async (operation) => {
      const principal = await resolvePrincipal(requestInput.attemptId);
      assertOperation(operation);
      const manifest = await resolveManifest(requestInput, operation);
      const normalized = normalizeParameters(requestInput);
      const captured = await capture(manifest, operation);
      assertOperation(operation);
      const currentPrincipal = await resolvePrincipal(requestInput.attemptId);
      assertOperation(operation);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) fail("PRINCIPAL_NOT_LINKED");
      const currentManifest = await resolveManifest(requestInput, operation);
      if (!sameManifest(manifest, currentManifest) || !referenceService.isOwnedManifest(manifest)) fail("REFERENCE_UNAVAILABLE");
      const intent = normalized.intent;
      const duration = captured.selectedDuration;
      const preparedRequest = deepFreeze({ prompt: intent.prompt, settings: {
        model_type: requestInput.model_id, resolution: intent.parameters.resolution, aspect_ratio: intent.parameters.aspect_ratio,
        video_duration: intent.parameters.video_duration, seed: intent.parameters.seed, duration, file_urls: captured.fileUrls,
        ...(requestInput.model_id === "wan_26_r2v_flash" ? { native_audio: intent.parameters.native_audio } : {})
      } }) as OwnerWan26R2vPreparedRequest;
      const safeReferences = deepFreeze(captured.inputReferences) as readonly OwnerWan26R2vPreparedInputReference[];
      const intentFingerprint = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id,
        model_id: requestInput.model_id, profile_schema_hash: profileHash, prompt: intent.prompt,
        parameters: intent.parameters, references: safeReferences });
      const privateFingerprint = schemaHash(preparedRequest);
      const expiresAt = Math.min(readNow() + TTL_MS, manifest.expires_at);
      if (expiresAt <= readNow()) fail("REFERENCE_EXPIRED");
      prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      const candidate = deepFreeze({ status: "prepared" as const, source_readiness: "PARTIAL_SOURCE_EXPLICIT_SETTINGS" as const,
        prompt_readiness: "CURRENT_PROMPT_RULES_NOT_ESTABLISHED" as const,
        settings_readiness: "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED" as const, dispatch_allowed: false as const,
        backend_acceptance: "UNPROVEN" as const, model_id: requestInput.model_id, profile_schema_hash: profileHash,
        intent_fingerprint: intentFingerprint, request_fingerprint: privateFingerprint, prompt_utf16_length: intent.prompt.length,
        image_reference_count: manifest.image_count, video_reference_count: manifest.video_count,
        input_references: safeReferences, expires_at: expiresAt });
      const partial = { factory, candidate, attemptId: requestInput.attemptId, principal, modelId: requestInput.model_id,
        handles: requestInput.reference_handles, manifest, requestInput, request: preparedRequest, client: captured.client,
        contexts: captured.contexts, expiresAt, epoch: operation.epoch, expired: false };
      let state!: CandidateState;
      const isLive = (): boolean => !closed && !state.expired && candidates.has(state) &&
        state.epoch === (epochs.get(state.attemptId) ?? 0) && readNow() < state.expiresAt &&
        referenceService.isOwnedManifest(state.manifest);
      state = { ...partial, isLive, binding: makeBinding(partial, privateFingerprint) };
      CANDIDATES.set(candidate, state);
      candidates.add(state);
      return candidate;
    });
  };

  const inspectCandidate: OwnerWan26R2vRequestPreparer["inspectCandidate"] = (candidate) => {
    try { return stateFor(candidate).binding; } catch { return undefined; }
  };
  const getPrivateRequest: OwnerWan26R2vRequestPreparer["getPrivateRequest"] = (candidate) => stateFor(candidate).request;
  const revalidateCandidate: OwnerWan26R2vRequestPreparer["revalidateCandidate"] = async (candidate, signal) => {
    const state = stateFor(candidate);
    return runOperation(state.attemptId, signal, async (operation) => {
      assertState(state, operation);
      const principal = await resolvePrincipal(state.attemptId);
      assertState(state, operation);
      if (!sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_NOT_LINKED");
      const manifest = await resolveManifest(state.requestInput, operation);
      if (!sameManifest(state.manifest, manifest)) fail("REFERENCE_UNAVAILABLE");
      const captured = await capture(manifest, operation);
      assertState(state, operation);
      const currentPrincipal = await resolvePrincipal(state.attemptId);
      assertState(state, operation);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) fail("PRINCIPAL_NOT_LINKED");
      const currentManifest = await resolveManifest(state.requestInput, operation);
      if (!sameManifest(state.manifest, currentManifest) || !referenceService.isOwnedManifest(state.manifest)) fail("REFERENCE_UNAVAILABLE");
      if (captured.client !== state.client || !sameContexts(captured.contexts, state.contexts) ||
          schemaHash(buildRequest(state, captured)) !== state.binding.private_request_fingerprint || readNow() >= state.expiresAt) {
        state.expired = true;
        candidates.delete(state);
        fail("REFERENCE_UNAVAILABLE");
      }
      return state.binding;
    });
  };
  const withCapturedNativeReferences: OwnerWan26R2vRequestPreparer["withCapturedNativeReferences"] = async (candidate, consume, signal) => {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    await revalidateCandidate(candidate, signal);
    const state = stateFor(candidate);
    return runOperation(state.attemptId, signal, async (operation) => {
      assertState(state, operation);
      const captured = await capture(state.manifest, operation);
      assertState(state, operation);
      if (captured.client !== state.client || !sameContexts(captured.contexts, state.contexts) ||
          schemaHash(buildRequest(state, captured)) !== state.binding.private_request_fingerprint) {
        state.expired = true;
        candidates.delete(state);
        fail("REFERENCE_UNAVAILABLE");
      }
      const result = await Reflect.apply(consume, undefined, [captured.client, captured.contexts, state.request]);
      assertState(state, operation);
      const principal = await resolvePrincipal(state.attemptId);
      assertState(state, operation);
      if (!sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_NOT_LINKED");
      const manifest = await resolveManifest(state.requestInput, operation);
      if (!sameManifest(state.manifest, manifest) || !referenceService.isOwnedManifest(state.manifest)) fail("REFERENCE_UNAVAILABLE");
      const after = await capture(state.manifest, operation);
      assertState(state, operation);
      if (after.client !== state.client || !sameContexts(after.contexts, state.contexts) ||
          schemaHash(buildRequest(state, after)) !== state.binding.private_request_fingerprint) fail("REFERENCE_UNAVAILABLE");
      return result;
    });
  };
  const invalidateAttempt: OwnerWan26R2vRequestPreparer["invalidateAttempt"] = (attemptId) => {
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId) || closed) return Promise.resolve();
    const existing = invalidations.get(attemptId);
    if (existing) return existing;
    if (!trackedAttempts().has(attemptId)) return Promise.resolve();
    epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
    invalidating.add(attemptId);
    for (const state of candidates) if (state.attemptId === attemptId) { state.expired = true; candidates.delete(state); }
    const operations = [...(pendingByAttempt.get(attemptId) ?? [])];
    for (const operation of operations) operation.controller.abort();
    let invalidation!: Promise<void>;
    invalidation = (async () => {
      try {
        await Promise.allSettled(operations.map((operation) => operation.done));
        await Reflect.apply(INVALIDATE, referenceService, [attemptId]);
      } finally {
        if (invalidations.get(attemptId) === invalidation) {
          invalidations.delete(attemptId);
          invalidating.delete(attemptId);
          releaseAttemptIfIdle(attemptId);
        }
      }
    })();
    invalidations.set(attemptId, invalidation);
    return invalidation;
  };
  const close: OwnerWan26R2vRequestPreparer["close"] = () => {
    if (closing) return closing;
    closed = true;
    for (const state of candidates) state.expired = true;
    candidates.clear();
    for (const operation of pending) operation.controller.abort();
    closing = Promise.allSettled([
      ...[...pending].map((operation) => operation.done),
      ...invalidations.values()
    ]).then(() => {
      epochs.clear(); pendingByAttempt.clear(); invalidating.clear(); invalidations.clear();
    });
    return closing;
  };
  const api: OwnerWan26R2vRequestPreparer = Object.freeze({ prepare, inspectCandidate, getPrivateRequest,
    revalidateCandidate, withCapturedNativeReferences, invalidateAttempt, close });
  PREPARERS.add(api);
  return api;

  function trackedAttempts(): Set<string> {
    return new Set([
      ...[...candidates].map((state) => state.attemptId),
      ...pendingByAttempt.keys(),
      ...epochs.keys(),
      ...invalidating,
      ...invalidations.keys()
    ]);
  }
  function releaseAttemptIfIdle(attemptId: string): void {
    if (!hasAttempt(attemptId) && !pendingByAttempt.has(attemptId) && !invalidating.has(attemptId) && !invalidations.has(attemptId)) {
      epochs.delete(attemptId);
    }
  }
  function hasAttempt(attemptId: string): boolean { for (const state of candidates) if (state.attemptId === attemptId) return true; return false; }
  async function resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return await resolveOwnerReferencePrincipal({ binding, attemptId, linkService }); }
    catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); return mapReferenceError(error); }
  }
  async function resolveManifest(input: OwnerWan26R2vPrepareInput, operation: PendingOperation): Promise<OwnerWan26R2vReferenceManifest> {
    assertOperation(operation);
    try {
      const manifest = await Reflect.apply(RESOLVE, referenceService,
        [{ attempt_id: input.attemptId, model_id: input.model_id, reference_handles: input.reference_handles }, operation.controller.signal]) as OwnerWan26R2vReferenceManifest;
      assertOperation(operation);
      if (!referenceService.isOwnedManifest(manifest) || manifest.model_id !== input.model_id || manifest.generation_permit !== false ||
          manifest.total_reference_count !== input.reference_handles.length || manifest.expires_at <= readNow()) fail("REFERENCE_UNAVAILABLE");
      return manifest;
    } catch (error) { return mapReferenceError(error); }
  }
  function normalizeParameters(input: OwnerWan26R2vPrepareInput): ReturnType<typeof normalizeOwnerWan26R2vGenerationParameters> {
    try { return normalizeOwnerWan26R2vGenerationParameters({ model_id: input.model_id, prompt: input.prompt, parameters: input.parameters }); }
    catch { fail("PARAMETERS_INVALID"); }
  }
  function assertState(state: CandidateState, operation: PendingOperation): void {
    assertOperation(operation);
    if (state.expired || state.epoch !== operation.epoch || state.epoch !== (epochs.get(state.attemptId) ?? 0) ||
        readNow() >= state.expiresAt || !referenceService.isOwnedManifest(state.manifest)) fail("CANDIDATE_EXPIRED");
  }
  function makeBinding(state: Omit<CandidateState, "binding" | "expired" | "isLive">, privateFingerprint: string): OwnerWan26R2vPreparedCandidateBinding {
    return deepFreeze({ attempt_id: state.attemptId, principal: state.principal, model_id: state.modelId,
      reference_handles: state.handles, profile_schema_hash: profileHash,
      intent_fingerprint: state.candidate.intent_fingerprint, request_fingerprint: state.candidate.request_fingerprint,
      private_request_fingerprint: privateFingerprint, expires_at: state.expiresAt,
      input_references: state.candidate.input_references });
  }
  function buildRequest(state: CandidateState, captured: Captured): OwnerWan26R2vPreparedRequest {
    return deepFreeze({ prompt: state.requestInput.prompt, settings: {
      model_type: state.modelId, resolution: state.request.settings.resolution,
      aspect_ratio: state.request.settings.aspect_ratio, video_duration: state.request.settings.video_duration,
      seed: state.request.settings.seed, duration: captured.selectedDuration, file_urls: captured.fileUrls,
      ...(state.modelId === "wan_26_r2v_flash" ? { native_audio: state.request.settings.native_audio! } : {})
    } }) as OwnerWan26R2vPreparedRequest;
  }
}

export function isOwnerWan26R2vRequestPreparer(value: unknown): value is OwnerWan26R2vRequestPreparer {
  return !!value && typeof value === "object" && PREPARERS.has(value as object);
}

export function isOwnerWan26R2vPreparedCandidate(value: unknown): value is OwnerWan26R2vPreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  if (!state || state.candidate !== value || !state.factory || typeof state.factory !== "object") return false;
  try { return state.isLive(); } catch { return false; }
}

function snapshotInput(value: unknown): OwnerWan26R2vPrepareInput {
  const fields = exactRecord(value, ["attemptId", "model_id", "prompt", "parameters", "reference_handles"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) ||
      (fields.model_id !== "wan_26_r2v" && fields.model_id !== "wan_26_r2v_flash") || typeof fields.prompt !== "string") fail("INVALID_REQUEST");
  const handles = readStringArray(fields.reference_handles);
  const modelId = fields.model_id as OwnerWan26R2vGenerationModelId;
  const parameterKeys = modelId === "wan_26_r2v"
    ? ["resolution", "aspect_ratio", "video_duration", "seed"]
    : ["resolution", "aspect_ratio", "video_duration", "seed", "native_audio"];
  const parameterFields = exactRecord(fields.parameters, parameterKeys);
  const parameters = Object.freeze({ resolution: parameterFields.resolution, aspect_ratio: parameterFields.aspect_ratio,
    video_duration: parameterFields.video_duration, seed: parameterFields.seed,
    ...(modelId === "wan_26_r2v_flash" ? { native_audio: parameterFields.native_audio } : {}) }) as OwnerWan26R2vGenerationParameters;
  return Object.freeze({ attemptId: fields.attemptId, model_id: modelId, prompt: fields.prompt, parameters, reference_handles: handles });
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 1 || length > 5 || Reflect.ownKeys(descriptors).length !== length + 1) fail("INVALID_REQUEST");
    const result: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true ||
          typeof descriptor.value !== "string" || !/^wan26ref_[A-Za-z0-9_-]{20,120}$/u.test(descriptor.value)) fail("INVALID_REQUEST");
      result.push(descriptor.value);
    }
    if (new Set(result).size !== result.length) fail("INVALID_REQUEST");
    return Object.freeze(result);
  } catch (error) { if (error instanceof OwnerWan26R2vRequestPreparerError) throw error; return fail("INVALID_REQUEST"); }
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...required, ...optional]);
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return fail("INVALID_REQUEST"); }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function isLinkService(value: unknown): value is PerUserLinkService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    PerUserLinkService.prototype.getStatus === LINK_STATUS && !Object.hasOwn(value, "getStatus"); }
  catch { return false; }
}

function isReferenceService(value: unknown): value is OwnerWan26R2vReferenceService {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerWan26R2vReferenceService.prototype &&
    OwnerWan26R2vReferenceService.prototype.resolveManifest === RESOLVE && OwnerWan26R2vReferenceService.prototype.isOwnedManifest === OWNED &&
    OwnerWan26R2vReferenceService.prototype.withCapturedNativeReferences === CAPTURE &&
    OwnerWan26R2vReferenceService.prototype.invalidateAttempt === INVALIDATE; }
  catch { return false; }
}

function sameManifest(a: OwnerWan26R2vReferenceManifest, b: OwnerWan26R2vReferenceManifest): boolean {
  return a.model_id === b.model_id && a.image_count === b.image_count && a.video_count === b.video_count &&
    a.total_reference_count === b.total_reference_count && a.expires_at === b.expires_at && a.references.length === b.references.length &&
    a.references.every((item, index) => schemaHash(item) === schemaHash(b.references[index]));
}

function sameContexts(a: readonly object[], b: readonly object[]): boolean {
  return a.length === b.length && a.every((context, index) => context === b[index]);
}

function mapReferenceError(error: unknown): never {
  if (error instanceof OwnerWan26R2vRequestPreparerError) throw error;
  if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
  if (error instanceof OwnerWan26R2vReferenceServiceError) {
    if (error.code === "REQUEST_ABORTED") fail("REQUEST_ABORTED");
    if (error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
    if (error.code === "SERVICE_CLOSED") fail("SERVICE_CLOSED");
    if (error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
  }
  fail("REFERENCE_UNAVAILABLE");
}

function readClock(input: unknown): () => number {
  if (typeof input !== "function" || types.isProxy(input)) fail("INVALID_REQUEST");
  return () => { let value: unknown; try { value = Reflect.apply(input, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail("CLOCK_INVALID"); return value; };
}

function isAbortSignal(value: unknown): value is AbortSignal {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === ABORT_SIGNAL_PROTO &&
      typeof ABORTED_GETTER === "function";
  } catch { return false; }
}

function isAborted(signal: AbortSignal): boolean {
  try { return Reflect.apply(ABORTED_GETTER!, signal, []) as boolean; }
  catch { return true; }
}

function round2(value: number): number {
  if (!Number.isFinite(value) || value < 0) fail("REFERENCE_UNAVAILABLE");
  const result = Math.round(value * 100) / 100;
  if (!Number.isFinite(result)) fail("REFERENCE_UNAVAILABLE");
  return result;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function fail(code: OwnerWan26R2vRequestPreparerErrorCode): never { throw new OwnerWan26R2vRequestPreparerError(code); }
