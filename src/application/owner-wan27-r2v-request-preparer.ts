import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import {
  readOwnerWan27R2vUploadReferenceForClient,
  type OwnerWan27R2vUploadContext
} from "../adapter/syntx/wan27-r2v-upload-context.js";
import {
  OwnerWan27R2vGenerationParametersError,
  getOwnerWan27R2vGenerationParametersSource,
  normalizeOwnerWan27R2vGenerationParameters,
  type OwnerWan27R2vGenerationNormalizedIntent,
  type OwnerWan27R2vGenerationParameters,
  type OwnerWan27R2vGenerationSourceContract
} from "./owner-wan27-r2v-generation-parameters.js";
import {
  isOwnerWan27R2vReferenceService,
  OwnerWan27R2vReferenceServiceError,
  OwnerWan27R2vReferenceService,
  type OwnerWan27R2vReferenceManifest,
} from "./owner-wan27-r2v-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const MAX_PENDING = 4;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();
const LINK_GET_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLVE_MANIFEST = OwnerWan27R2vReferenceService.prototype.resolveManifest;
const IS_OWNED_MANIFEST = OwnerWan27R2vReferenceService.prototype.isOwnedManifest;
const CAPTURE_REFERENCES = OwnerWan27R2vReferenceService.prototype.withCapturedNativeReferences;
const INVALIDATE_REFERENCES = OwnerWan27R2vReferenceService.prototype.invalidateAttempt;

export interface OwnerWan27R2vPreparedInputReference {
  readonly media_type: "image" | "selected_video";
  readonly mime_type: OwnerWan27R2vUploadContext["mime_type"];
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly source_sha256?: string;
  readonly selected_duration_seconds?: number;
  readonly video_duration_seconds?: number;
}

export interface OwnerWan27R2vPreparedCandidate {
  readonly status: "prepared";
  readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: "wan_27_r2v";
  readonly profile_schema_hash: string;
  readonly source_pins: OwnerWan27R2vGenerationSourceContract["source_pins"];
  readonly wire_facts: OwnerWan27R2vGenerationSourceContract["wire_facts"];
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly prompt_utf16_length: number;
  readonly image_reference_count: number;
  readonly selected_video_reference_count: number;
  readonly input_references: readonly OwnerWan27R2vPreparedInputReference[];
  readonly expires_at: number;
}

export interface OwnerWan27R2vPreparedRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: "wan_27_r2v";
    readonly resolution: OwnerWan27R2vGenerationParameters["resolution"];
    readonly aspect_ratio: OwnerWan27R2vGenerationParameters["aspect_ratio"];
    readonly video_duration: number;
    readonly prompt_extend: boolean;
    readonly seed: number | null;
    readonly native_audio: false;
    readonly shot_type: "single";
    readonly audio_setting: "auto";
    readonly duration: number;
    readonly file_urls: readonly Readonly<{ readonly type: "image" | "video"; readonly url: string }> [];
  }>;
}

export interface OwnerWan27R2vPreparedCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly manifest_handle: string;
  readonly manifest_epoch: number;
  readonly profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  /** Private URL-bearing request hash; it is never copied onto the public candidate. */
  readonly wire_fingerprint: string;
  readonly expires_at: number;
  readonly input_references: readonly OwnerWan27R2vPreparedInputReference[];
}

export interface OwnerWan27R2vRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly referenceService: OwnerWan27R2vReferenceService;
  readonly now?: () => number;
}

export interface OwnerWan27R2vPrepareInput {
  readonly attemptId: string;
  readonly manifest_handle: string;
  readonly model_id: "wan_27_r2v";
  readonly prompt?: string;
  readonly parameters: OwnerWan27R2vGenerationParameters;
}

export interface OwnerWan27R2vRequestPreparer {
  prepare(input: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerWan27R2vPreparedCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerWan27R2vPreparedRequest;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vPreparedCandidateBinding>;
  withCapturedNativeReferences<T>(candidate: unknown,
    consume: (client: SyntxChatHttpClient, contexts: readonly OwnerWan27R2vUploadContext[], request: OwnerWan27R2vPreparedRequest) => T | Promise<T>,
    signal?: AbortSignal): Promise<T>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerWan27R2vRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED" | "PARAMETERS_INVALID" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CLOCK_INVALID"
  | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";

export class OwnerWan27R2vRequestPreparerError extends Error {
  constructor(readonly code: OwnerWan27R2vRequestPreparerErrorCode) {
    super("The owner WAN 2.7 R2V request could not be prepared safely.");
    this.name = "OwnerWan27R2vRequestPreparerError";
  }
}

interface CandidateState {
  readonly factory: object;
  readonly candidate: OwnerWan27R2vPreparedCandidate;
  readonly attemptId: string;
  readonly manifestHandle: string;
  readonly manifest: OwnerWan27R2vReferenceManifest;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly parametersInput: OwnerWan27R2vPrepareInput;
  readonly normalized: OwnerWan27R2vGenerationNormalizedIntent;
  readonly request: OwnerWan27R2vPreparedRequest;
  readonly client: SyntxChatHttpClient;
  readonly contexts: readonly OwnerWan27R2vUploadContext[];
  readonly binding: OwnerWan27R2vPreparedCandidateBinding;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly wireFingerprint: string;
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

interface CapturedReferences {
  readonly client: SyntxChatHttpClient;
  readonly contexts: readonly OwnerWan27R2vUploadContext[];
  readonly inputReferences: readonly OwnerWan27R2vPreparedInputReference[];
  readonly fileUrls: readonly Readonly<{ readonly type: "image" | "video"; readonly url: string }>[];
  readonly roundedSelectedDurations: readonly number[];
  readonly promptTokens: readonly Readonly<{ readonly url: string; readonly semantic_token: string }>[];
}

export function createOwnerWan27R2vRequestPreparer(optionsInput: OwnerWan27R2vRequestPreparerOptions | unknown): OwnerWan27R2vRequestPreparer {
  const fields = exactRecord(optionsInput, ["binding", "linkService", "referenceService"], ["now"]);
  if (!isLinkService(fields.linkService) || !isOwnerWan27R2vReferenceService(fields.referenceService) ||
      !isNativeReferenceService(fields.referenceService) ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  const binding = snapshotBinding(fields.binding);
  const linkService = fields.linkService as PerUserLinkService;
  const referenceService = fields.referenceService as OwnerWan27R2vReferenceService;
  const source = getOwnerWan27R2vGenerationParametersSource();
  const profileHash = schemaHash(source);
  const clock = fields.now === undefined ? Date.now : readClock(fields.now);
  const candidates = new Set<CandidateState>();
  const factory = Object.freeze({});
  const epochs = new Map<string, number>();
  const pending = new Set<PendingOperation>();
  const pendingByAttempt = new Map<string, Set<PendingOperation>>();
  const invalidating = new Set<string>();
  let closed = false;
  let closing: Promise<void> | undefined;
  let lastNow = clock();

  const readNow = (): number => {
    const now = clock();
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
    if (invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    if (parent?.aborted) fail("REQUEST_ABORTED");
    readNow();
    if (pending.size >= MAX_PENDING) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = {
      attemptId, epoch: epochs.get(attemptId) ?? 0, controller, done, finish,
      removeParent: () => parent?.removeEventListener("abort", abort)
    };
    pending.add(operation);
    const set = pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    set.add(operation); pendingByAttempt.set(attemptId, set);
    return operation;
  };

  const finish = (operation: PendingOperation): void => {
    operation.removeParent(); pending.delete(operation);
    const set = pendingByAttempt.get(operation.attemptId); set?.delete(operation);
    if (!set?.size) pendingByAttempt.delete(operation.attemptId);
    operation.finish();
  };

  const runOperation = async <T>(attemptId: string, signal: AbortSignal | undefined, work: (operation: PendingOperation) => Promise<T>): Promise<T> => {
    const operation = begin(attemptId, signal);
    try { return await work(operation); }
    finally { finish(operation); }
  };

  const prune = (): void => {
    const now = readNow();
    for (const state of candidates) if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); }
    for (const attemptId of epochs.keys()) if (!pendingByAttempt.has(attemptId) && !candidatesHasAttempt(attemptId)) epochs.delete(attemptId);
  };

  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object);
    if (!state || state.candidate !== value || state.factory !== factory) fail("CANDIDATE_UNBOUND");
    if (!candidates.has(state)) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
    if (state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || readNow() >= state.expiresAt ||
        !referenceService.isOwnedManifest(state.manifest)) {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
    return state;
  };

  const makeBinding = (state: Omit<CandidateState, "binding" | "expired">): OwnerWan27R2vPreparedCandidateBinding => deepFreeze({
    attempt_id: state.attemptId, principal: state.principal, manifest_handle: state.manifestHandle,
    manifest_epoch: state.manifest.epoch, profile_schema_hash: profileHash,
    intent_fingerprint: state.candidate.intent_fingerprint, request_fingerprint: state.candidate.request_fingerprint,
    wire_fingerprint: state.wireFingerprint, expires_at: state.expiresAt, input_references: state.candidate.input_references
  });

  const capture = async (manifest: OwnerWan27R2vReferenceManifest, operation: PendingOperation): Promise<CapturedReferences> => {
    try {
      return await referenceService.withCapturedNativeReferences(manifest, (client, contexts) => {
        assertOperation(operation);
        if (!(client instanceof SyntxChatHttpClient) || !Array.isArray(contexts) || contexts.length !== manifest.total_reference_count ||
            contexts.length < 1 || contexts.length > 6 || !Array.isArray(manifest.references) || manifest.references.length !== contexts.length) {
          fail("REFERENCE_UNAVAILABLE");
        }
        const inputReferences: OwnerWan27R2vPreparedInputReference[] = [];
        const fileUrls: Readonly<{ type: "image" | "video"; url: string }>[] = [];
        const seenUrls = new Set<string>();
        const durations: number[] = [], promptTokens: Readonly<{ readonly url: string; readonly semantic_token: string }>[] = [];
        let imageCount = 0, videoCount = 0, selectedSum = 0;
        for (let index = 0; index < contexts.length; index += 1) {
          const context = contexts[index]!;
          const metadata = manifest.references[index]!;
          if (!context || typeof context !== "object" || types.isProxy(context) || context.status !== "uploaded" || context.model_id !== "wan_27_r2v" ||
              context.sha256 !== metadata.sha256 || context.mime_type !== metadata.mime_type || context.size !== metadata.size ||
              context.width !== metadata.width || context.height !== metadata.height) fail("REFERENCE_UNAVAILABLE");
          const fileType = context.media_type === "image" ? "image" : context.media_type === "selected_video" ? "video" : undefined;
          if (!fileType || metadata.media_type !== context.media_type) fail("REFERENCE_UNAVAILABLE");
          const ownedUrl = readOwnerWan27R2vUploadReferenceForClient(client, context);
          if (!ownedUrl || !isSafeUploadReferenceUrl(ownedUrl.url)) fail("REFERENCE_UNAVAILABLE");
          const entry: OwnerWan27R2vPreparedInputReference = context.media_type === "image"
            ? Object.freeze({ media_type: "image", mime_type: context.mime_type, size: context.size, sha256: context.sha256, width: context.width, height: context.height })
            : (() => {
              const video = context as Extract<OwnerWan27R2vUploadContext, { media_type: "selected_video" }>;
              if (video.mime_type !== "video/mp4" || !/^sha256:[a-f0-9]{64}$/u.test(`sha256:${video.source_sha256}`) ||
                  !Number.isFinite(video.selected_duration_seconds) || video.selected_duration_seconds <= 0 ||
                  !Number.isFinite(video.video_duration_seconds) || video.video_duration_seconds <= 0 ||
                  video.source_sha256 !== metadata.source_sha256 || metadata.video_duration_seconds !== video.video_duration_seconds) fail("REFERENCE_UNAVAILABLE");
              const selected = video.selected_duration_seconds;
              const roundedSelected = round2(selected);
              durations.push(roundedSelected); selectedSum += selected; videoCount++;
              return Object.freeze({ media_type: "selected_video", mime_type: video.mime_type, size: video.size, sha256: video.sha256,
                width: video.width, height: video.height, source_sha256: video.source_sha256,
                selected_duration_seconds: selected, video_duration_seconds: video.video_duration_seconds });
            })();
          if (context.media_type === "image") imageCount++;
          inputReferences.push(entry);
          const semanticToken = schemaHash({ media_type: entry.media_type, sha256: entry.sha256,
            ...(entry.media_type === "selected_video" ? { source_sha256: entry.source_sha256,
              selected_duration_seconds: entry.selected_duration_seconds } : {}) });
          promptTokens.push(Object.freeze({ url: ownedUrl.url, semantic_token: semanticToken }));
          const urlKey = JSON.stringify([fileType, ownedUrl.url]);
          if (!seenUrls.has(urlKey)) { seenUrls.add(urlKey); fileUrls.push(Object.freeze({ type: fileType, url: ownedUrl.url })); }
        }
        if (imageCount + videoCount !== contexts.length || videoCount !== manifest.video_reference_count || imageCount > 6 ||
            (videoCount > 0 && contexts.length > 5) ||
            (videoCount === 0 && selectedSum !== 0) || selectedSum > 5.000001) fail("REFERENCE_UNAVAILABLE");
        return Object.freeze({ client, contexts: Object.freeze([...contexts]), inputReferences: Object.freeze(inputReferences),
          fileUrls: Object.freeze(fileUrls), roundedSelectedDurations: Object.freeze(durations), promptTokens: Object.freeze(promptTokens) });
      }, operation.controller.signal);
    } catch (error) { return mapReferenceError(error); }
  };

  const prepare: OwnerWan27R2vRequestPreparer["prepare"] = async (input, signal) => {
    const requestInput = snapshotInput(input);
    return runOperation(requestInput.attemptId, signal, async (operation) => {
      const epoch = operation.epoch;
      const principal = await resolvePrincipal(requestInput.attemptId);
      assertOperation(operation);
      const manifest = await resolveManifest(requestInput.attemptId, requestInput.manifest_handle, operation);
      const normalized = await normalizeIntent(requestInput, manifest, operation);
      const captured = await capture(manifest, operation);
      assertOperation(operation);
      const currentPrincipal = await resolvePrincipal(requestInput.attemptId);
      assertOperation(operation);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) fail("PRINCIPAL_NOT_LINKED");
      const currentManifest = await resolveManifest(requestInput.attemptId, requestInput.manifest_handle, operation);
      if (currentManifest !== manifest) fail("REFERENCE_UNAVAILABLE");
      const normalizedPrompt = normalized.intent.prompt ?? "";
      const duration = round2(captured.roundedSelectedDurations.reduce((sum, value) => sum + value, 0));
      const parameters = normalized.intent.parameters;
      const preparedRequest = deepFreeze({ prompt: normalizedPrompt, settings: {
        model_type: "wan_27_r2v" as const, resolution: parameters.resolution, aspect_ratio: parameters.aspect_ratio,
        video_duration: parameters.video_duration, prompt_extend: parameters.prompt_extend, seed: parameters.seed,
        native_audio: false as const, shot_type: "single" as const, audio_setting: "auto" as const, duration,
        file_urls: captured.fileUrls
      } }) as OwnerWan27R2vPreparedRequest;
      const semanticReferences = captured.inputReferences.map((reference) => ({ media_type: reference.media_type,
        mime_type: reference.mime_type, size: reference.size, sha256: reference.sha256, width: reference.width, height: reference.height,
        ...(reference.media_type === "selected_video" ? { source_sha256: reference.source_sha256,
          selected_duration_seconds: reference.selected_duration_seconds, video_duration_seconds: reference.video_duration_seconds } : {}) }));
      const intentFingerprint = schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
        model_id: requestInput.model_id, profile_schema_hash: profileHash, source_pins: source.source_pins,
        prompt: semanticPrompt(normalizedPrompt, captured.promptTokens), parameters, fixed_fields: source.wire_facts.fixed_fields, derived_duration: duration,
        references: semanticReferences });
      const wireFingerprint = schemaHash(preparedRequest);
      const expiresAt = Math.min(readNow() + TTL_MS, manifest.expires_at);
      if (expiresAt <= readNow()) fail("REFERENCE_EXPIRED");
      prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      const safeReferences = deepFreeze(semanticReferences) as readonly OwnerWan27R2vPreparedInputReference[];
      const candidate = deepFreeze({ status: "prepared" as const, source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT" as const,
        dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const, model_id: "wan_27_r2v" as const,
        profile_schema_hash: profileHash, source_pins: source.source_pins, wire_facts: source.wire_facts,
        intent_fingerprint: intentFingerprint, request_fingerprint: wireFingerprint,
        prompt_utf16_length: normalizedPrompt.length, image_reference_count: normalized.reference_context.image_reference_count,
        selected_video_reference_count: normalized.reference_context.selected_video_reference_count,
        input_references: safeReferences, expires_at: expiresAt });
      const stateWithoutBinding = { factory, candidate, attemptId: requestInput.attemptId, manifestHandle: requestInput.manifest_handle, manifest,
        principal, parametersInput: requestInput, normalized, request: preparedRequest, client: captured.client,
        contexts: captured.contexts, expiresAt, epoch, wireFingerprint, expired: false };
      const state = { ...stateWithoutBinding, binding: makeBinding(stateWithoutBinding) } satisfies CandidateState;
      CANDIDATES.set(candidate, state); candidates.add(state);
      return candidate;
    });
  };

  const inspectCandidate: OwnerWan27R2vRequestPreparer["inspectCandidate"] = (candidate) => {
    try { return stateFor(candidate).binding; } catch { return undefined; }
  };

  const getPrivateRequest: OwnerWan27R2vRequestPreparer["getPrivateRequest"] = (candidate) => stateFor(candidate).request;

  const revalidateCandidate: OwnerWan27R2vRequestPreparer["revalidateCandidate"] = async (candidate, signal) => {
    const state = stateFor(candidate);
    return runOperation(state.attemptId, signal, async (operation) => {
      assertStateOperation(state, operation);
      const principal = await resolvePrincipal(state.attemptId);
      assertStateOperation(state, operation);
      if (!sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_NOT_LINKED");
      const manifest = await resolveManifest(state.attemptId, state.manifestHandle, operation);
      if (manifest !== state.manifest || manifest.epoch !== state.manifest.epoch) fail("REFERENCE_UNAVAILABLE");
      const normalized = await normalizeIntent(state.parametersInput, manifest, operation);
      const captured = await capture(manifest, operation);
      assertStateOperation(state, operation);
      const currentPrincipal = await resolvePrincipal(state.attemptId);
      assertStateOperation(state, operation);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) fail("PRINCIPAL_NOT_LINKED");
      const currentManifest = await resolveManifest(state.attemptId, state.manifestHandle, operation);
      if (currentManifest !== state.manifest) fail("REFERENCE_UNAVAILABLE");
      const semanticReferences = captured.inputReferences.map((reference) => ({ media_type: reference.media_type,
        mime_type: reference.mime_type, size: reference.size, sha256: reference.sha256, width: reference.width, height: reference.height,
        ...(reference.media_type === "selected_video" ? { source_sha256: reference.source_sha256,
          selected_duration_seconds: reference.selected_duration_seconds, video_duration_seconds: reference.video_duration_seconds } : {}) }));
      const prompt = normalized.intent.prompt ?? "";
      const derivedDuration = round2(captured.roundedSelectedDurations.reduce((sum, value) => sum + value, 0));
      const fingerprint = schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
        model_id: "wan_27_r2v", profile_schema_hash: profileHash, source_pins: source.source_pins,
        prompt: semanticPrompt(prompt, captured.promptTokens), parameters: normalized.intent.parameters,
        fixed_fields: source.wire_facts.fixed_fields, derived_duration: derivedDuration,
        references: semanticReferences });
      const request = buildRequest(normalized, captured, prompt, derivedDuration);
      if (fingerprint !== state.candidate.intent_fingerprint || schemaHash(request) !== state.wireFingerprint ||
          captured.client !== state.client || captured.contexts.length !== state.contexts.length ||
          captured.contexts.some((context, index) => context !== state.contexts[index]) || readNow() >= state.expiresAt) {
        state.expired = true; candidates.delete(state); fail("REFERENCE_UNAVAILABLE");
      }
      return state.binding;
    });
  };

  const withCapturedNativeReferences: OwnerWan27R2vRequestPreparer["withCapturedNativeReferences"] = async (candidate, consume, signal) => {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    await revalidateCandidate(candidate, signal);
    const state = stateFor(candidate);
    return runOperation(state.attemptId, signal, async (operation) => {
      assertStateOperation(state, operation);
      const captured = await capture(state.manifest, operation);
      assertStateOperation(state, operation);
      if (captured.client !== state.client || captured.contexts.length !== state.contexts.length ||
          captured.contexts.some((context, index) => context !== state.contexts[index]) ||
          schemaHash(buildRequest(state.normalized, captured, state.request.prompt,
            round2(captured.roundedSelectedDurations.reduce((sum, value) => sum + value, 0)))) !== state.wireFingerprint) {
        state.expired = true; candidates.delete(state); fail("REFERENCE_UNAVAILABLE");
      }
      const result = await Reflect.apply(consume, undefined, [captured.client, captured.contexts, state.request]);
      assertStateOperation(state, operation);
      const currentPrincipal = await resolvePrincipal(state.attemptId);
      assertStateOperation(state, operation);
      if (!sameGenerationPrincipal(currentPrincipal, state.principal)) fail("PRINCIPAL_NOT_LINKED");
      const currentManifest = await resolveManifest(state.attemptId, state.manifestHandle, operation);
      if (currentManifest !== state.manifest || !referenceService.isOwnedManifest(state.manifest)) fail("REFERENCE_UNAVAILABLE");
      const after = await capture(state.manifest, operation);
      assertStateOperation(state, operation);
      if (after.client !== state.client || after.contexts.length !== state.contexts.length ||
          after.contexts.some((context, index) => context !== state.contexts[index]) ||
          schemaHash(buildRequest(state.normalized, after, state.request.prompt,
            round2(after.roundedSelectedDurations.reduce((sum, value) => sum + value, 0)))) !== state.wireFingerprint) {
        state.expired = true; candidates.delete(state); fail("REFERENCE_UNAVAILABLE");
      }
      return result;
    });
  };

  const invalidateAttempt: OwnerWan27R2vRequestPreparer["invalidateAttempt"] = async (attemptId) => {
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId) || closed) return;
    epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
    invalidating.add(attemptId);
    for (const state of candidates) if (state.attemptId === attemptId) { state.expired = true; candidates.delete(state); }
    const operations = [...(pendingByAttempt.get(attemptId) ?? [])];
    for (const operation of operations) operation.controller.abort();
    await Promise.allSettled(operations.map((operation) => operation.done));
    await Reflect.apply(INVALIDATE_REFERENCES, referenceService, [attemptId]);
    invalidating.delete(attemptId);
    if (!pendingByAttempt.has(attemptId) && !candidatesHasAttempt(attemptId)) epochs.delete(attemptId);
  };

  const close: OwnerWan27R2vRequestPreparer["close"] = () => {
    if (closing) return closing;
    closed = true;
    for (const state of candidates) state.expired = true;
    candidates.clear();
    for (const operation of pending) operation.controller.abort();
    const operations = [...pending].map((operation) => operation.done);
    closing = Promise.allSettled(operations).then(() => { epochs.clear(); pendingByAttempt.clear(); invalidating.clear(); });
    return closing;
  };

  const api: OwnerWan27R2vRequestPreparer = Object.freeze({ prepare, inspectCandidate, getPrivateRequest,
    revalidateCandidate, withCapturedNativeReferences, invalidateAttempt, close });
  PREPARERS.add(api);
  return api;

  function candidatesHasAttempt(attemptId: string): boolean { for (const state of candidates) if (state.attemptId === attemptId) return true; return false; }
  async function resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return await resolveOwnerReferencePrincipal({ binding, attemptId, linkService }); }
    catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); return mapReferenceError(error); }
  }
  async function resolveManifest(attemptId: string, handle: string, operation: PendingOperation): Promise<OwnerWan27R2vReferenceManifest> {
    assertOperation(operation);
    try {
      const manifest = await Reflect.apply(RESOLVE_MANIFEST, referenceService, [{ attemptId, manifest_handle: handle }, operation.controller.signal]) as OwnerWan27R2vReferenceManifest;
      assertOperation(operation);
      if (!referenceService.isOwnedManifest(manifest) || manifest.attempt_id !== attemptId || manifest.manifest_handle !== handle ||
          manifest.generation_permit !== false) fail("REFERENCE_UNAVAILABLE");
      return manifest;
    } catch (error) { return mapReferenceError(error); }
  }
  async function normalizeIntent(request: OwnerWan27R2vPrepareInput, manifest: OwnerWan27R2vReferenceManifest,
    operation: PendingOperation): Promise<OwnerWan27R2vGenerationNormalizedIntent> {
    assertOperation(operation);
    try {
      const normalized = await normalizeOwnerWan27R2vGenerationParameters({ model_id: request.model_id,
        ...(request.prompt === undefined ? {} : { prompt: request.prompt }), parameters: request.parameters },
      { referenceService, manifest }, operation.controller.signal);
      assertOperation(operation);
      return normalized;
    } catch (error) {
      if (error instanceof OwnerWan27R2vGenerationParametersError) {
        fail(error.code === "INVALID_PARAMETERS" ? "PARAMETERS_INVALID" : "REFERENCE_UNAVAILABLE");
      }
      return mapReferenceError(error);
    }
  }
  function assertStateOperation(state: CandidateState, operation: PendingOperation): void {
    assertOperation(operation);
    if (state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || readNow() >= state.expiresAt) {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
  }
  function stateForAttemptExists(attemptId: string): boolean { return candidatesHasAttempt(attemptId); }
  void stateForAttemptExists;
}

export function isOwnerWan27R2vRequestPreparer(value: unknown): value is OwnerWan27R2vRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value as object) && Object.isFrozen(value);
}

export function isOwnerWan27R2vPreparedCandidate(value: unknown): value is OwnerWan27R2vPreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  return !!state && state.candidate === value && !state.expired;
}

function buildRequest(normalized: OwnerWan27R2vGenerationNormalizedIntent, captured: CapturedReferences, prompt: string, duration: number): OwnerWan27R2vPreparedRequest {
  const parameters = normalized.intent.parameters;
  return deepFreeze({ prompt, settings: { model_type: "wan_27_r2v" as const, resolution: parameters.resolution,
    aspect_ratio: parameters.aspect_ratio, video_duration: parameters.video_duration, prompt_extend: parameters.prompt_extend,
    seed: parameters.seed, native_audio: false as const, shot_type: "single" as const, audio_setting: "auto" as const,
    duration, file_urls: captured.fileUrls } }) as OwnerWan27R2vPreparedRequest;
}

function semanticPrompt(prompt: string, ownedTokens: readonly Readonly<{ readonly url: string; readonly semantic_token: string }>[]): string {
  return prompt.replace(/<<<(https?:\/\/[^>]+?)>>>/gu, (full, url: string) => {
    const owned = ownedTokens.find((entry) => entry.url === url);
    return owned ? `<<<owned-reference:${owned.semantic_token}>>>` : full;
  });
}

function snapshotInput(value: unknown): OwnerWan27R2vPrepareInput {
  const fields = exactRecord(value, ["attemptId", "manifest_handle", "model_id", "parameters"], ["prompt"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.manifest_handle !== "string" ||
      !/^wan27ref_[A-Za-z0-9_-]{20,120}$/u.test(fields.manifest_handle) || fields.model_id !== "wan_27_r2v" ||
      (Object.hasOwn(fields, "prompt") && typeof fields.prompt !== "string")) fail("INVALID_REQUEST");
  const parameters = exactRecord(fields.parameters, ["resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed", "native_audio"]);
  return Object.freeze({ attemptId: fields.attemptId, manifest_handle: fields.manifest_handle, model_id: "wan_27_r2v",
    ...(Object.hasOwn(fields, "prompt") ? { prompt: fields.prompt as string } : {}),
    parameters: Object.freeze({ resolution: parameters.resolution, aspect_ratio: parameters.aspect_ratio,
      video_duration: parameters.video_duration, prompt_extend: parameters.prompt_extend, seed: parameters.seed, native_audio: parameters.native_audio }) as OwnerWan27R2vGenerationParameters });
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const allowed = new Set([...required, ...optional]);
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !Object.hasOwn(descriptors[key]!, "value"))) fail("INVALID_REQUEST");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
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
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
        PerUserLinkService.prototype.getStatus !== LINK_GET_STATUS || Object.hasOwn(value, "getStatus")) return false;
    const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
    return !!descriptor && "value" in descriptor && descriptor.value === LINK_GET_STATUS;
  } catch { return false; }
}

function isNativeReferenceService(value: OwnerWan27R2vReferenceService): boolean {
  return Object.getPrototypeOf(value) === OwnerWan27R2vReferenceService.prototype &&
    OwnerWan27R2vReferenceService.prototype.resolveManifest === RESOLVE_MANIFEST &&
    OwnerWan27R2vReferenceService.prototype.isOwnedManifest === IS_OWNED_MANIFEST &&
    OwnerWan27R2vReferenceService.prototype.withCapturedNativeReferences === CAPTURE_REFERENCES &&
    OwnerWan27R2vReferenceService.prototype.invalidateAttempt === INVALIDATE_REFERENCES;
}

function mapReferenceError(error: unknown): never {
  if (error instanceof OwnerWan27R2vRequestPreparerError) throw error;
  if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
  if (error instanceof OwnerWan27R2vReferenceServiceError) {
    if (error.code === "REQUEST_ABORTED") fail("REQUEST_ABORTED");
    if (error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
    if (error.code === "MANIFEST_EXPIRED") fail("REFERENCE_EXPIRED");
    if (error.code === "SERVICE_CLOSED") fail("SERVICE_CLOSED");
    fail("REFERENCE_UNAVAILABLE");
  }
  fail("REFERENCE_UNAVAILABLE");
}

function readClock(input: unknown): () => number {
  if (typeof input !== "function" || types.isProxy(input)) fail("INVALID_REQUEST");
  return () => {
    let value: unknown; try { value = Reflect.apply(input, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0) fail("CLOCK_INVALID");
    return value as number;
  };
}

function round2(value: number): number {
  if (!Number.isFinite(value) || value < 0) fail("REFERENCE_UNAVAILABLE");
  const rounded = Math.round(value * 100) / 100;
  if (!Number.isFinite(rounded) || !Number.isSafeInteger(Math.round(rounded * 100))) fail("REFERENCE_UNAVAILABLE");
  return rounded;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function fail(code: OwnerWan27R2vRequestPreparerErrorCode): never { throw new OwnerWan27R2vRequestPreparerError(code); }
