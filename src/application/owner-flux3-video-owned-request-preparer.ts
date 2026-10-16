import { createHash } from "node:crypto";
import { types } from "node:util";
import { SyntxChatHttpClient, readOwnerFlux3UploadReferenceForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerFlux3UploadContext } from "../adapter/syntx/flux3-media-upload.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  OwnerFlux3MediaReferenceService,
  OwnerFlux3MediaReferenceServiceError,
  type OwnerFlux3MediaReferenceResolution
} from "./owner-flux3-media-reference-service.js";
import {
  normalizeOwnerFlux3VideoParameters,
  projectOwnerFlux3VideoWireSettings,
  OwnerFlux3VideoParametersError,
  type OwnerFlux3VideoParameters,
  type OwnerFlux3VideoParameterValues,
  type OwnerFlux3VideoWireSettings
} from "./owner-flux3-video-parameters.js";
import {
  getOwnerFlux3VideoSourceProfile,
  OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION,
  type OwnerFlux3VideoModelId,
  type OwnerFlux3VideoSourceProfile
} from "./owner-flux3-video-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^flux3_media_reference_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const MAX_PROMPT_UTF8_BYTES = 64 * 1024;
const PREPARER_KEY = Symbol("OwnerFlux3VideoOwnedRequestPreparerFactory");
const ORIGINAL_RESOLVE = OwnerFlux3MediaReferenceService.prototype.resolveReference;
const ORIGINAL_GUARD = OwnerFlux3MediaReferenceService.prototype.isOwnedReferenceResolution;
const ORIGINAL_CAPTURE = OwnerFlux3MediaReferenceService.prototype.withCapturedNativeReference;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();

export const OWNER_FLUX3_VIDEO_CONTROL_COMBINATION_STATUS =
  "SOURCE_ENUMS_EXPLICIT_CONDITIONAL_COMBINATIONS_UNPROVEN" as const;

export interface OwnerFlux3VideoOwnedSourceMetadata {
  readonly wire_type: "image" | "video";
  readonly mime_type: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number | null;
  readonly input_confidence: string;
}

export interface OwnerFlux3VideoOwnedPreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: OwnerFlux3VideoModelId;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerFlux3VideoSourceProfile["source_pins"];
  readonly control_combination_status: typeof OWNER_FLUX3_VIDEO_CONTROL_COMBINATION_STATUS;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly sources: readonly OwnerFlux3VideoOwnedSourceMetadata[];
  readonly expires_at: number;
}

export interface OwnerFlux3VideoOwnedPreparedSettings extends OwnerFlux3VideoWireSettings {
  readonly file_urls: readonly Readonly<{ type: "image" | "video"; url: string }> [];
}
export interface OwnerFlux3VideoOwnedPreparedRequest {
  readonly prompt: string;
  readonly settings: Readonly<OwnerFlux3VideoOwnedPreparedSettings>;
}

export interface OwnerFlux3VideoOwnedCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerFlux3VideoModelId;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerFlux3VideoSourceProfile["source_pins"];
  readonly prompt_sha256: string;
  readonly prompt_utf8_bytes: number;
  readonly parameters: Readonly<OwnerFlux3VideoParameterValues>;
  readonly sources: readonly OwnerFlux3VideoOwnedSourceMetadata[];
  readonly source_sha256s: readonly string[];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly control_combination_status: typeof OWNER_FLUX3_VIDEO_CONTROL_COMBINATION_STATUS;
}

export interface OwnerFlux3VideoOwnedRequestPreparerOptions {
  readonly referenceService: OwnerFlux3MediaReferenceService;
  readonly now?: () => number;
}

export interface PrepareOwnerFlux3VideoOwnedRequestInput {
  readonly attemptId: string;
  readonly request: Readonly<{
    model_id: OwnerFlux3VideoModelId;
    prompt: string;
    flux3_reference_handles: readonly string[];
    parameters: OwnerFlux3VideoParameterValues;
  }>;
}

interface CapturedReference {
  readonly handle: string;
  readonly resolution: OwnerFlux3MediaReferenceResolution;
  readonly client: SyntxChatHttpClient;
  readonly nativeContext: OwnerFlux3UploadContext;
  readonly url: string;
  readonly metadata: OwnerFlux3VideoOwnedSourceMetadata;
}

interface CandidateState {
  readonly candidate: OwnerFlux3VideoOwnedPreparedCandidate;
  readonly attemptId: string;
  readonly handles: readonly string[];
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profileHash: string;
  readonly modelId: OwnerFlux3VideoModelId;
  readonly sources: readonly CapturedReference[];
  readonly capturedSources: readonly CapturedReference[];
  readonly request: OwnerFlux3VideoOwnedPreparedRequest;
  readonly binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding>;
  readonly expiresAt: number;
  readonly epoch: number;
  expired: boolean;
}

interface PreparerApi {
  prepare(input: unknown): Promise<OwnerFlux3VideoOwnedPreparedCandidate>;
  inspectCandidate(candidate: unknown): Readonly<OwnerFlux3VideoOwnedCandidateBinding> | undefined;
  getPrivateRequest(candidate: unknown): OwnerFlux3VideoOwnedPreparedRequest;
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerFlux3VideoOwnedCandidateBinding>>;
  withCapturedNativeReferences<T>(candidate: unknown, consume: (client: SyntxChatHttpClient, contexts: readonly OwnerFlux3UploadContext[]) => T): T;
  isBoundToReferenceService(service: unknown): boolean;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerFlux3VideoOwnedRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "PARAMETERS_INVALID"
  | "PROMPT_LOCAL_LIMIT_EXCEEDED" | "REFERENCE_COUNT_INVALID" | "REFERENCE_URL_IDENTITY_CONFLICT"
  | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";

export class OwnerFlux3VideoOwnedRequestPreparerError extends Error {
  constructor(readonly code: OwnerFlux3VideoOwnedRequestPreparerErrorCode) {
    super("The owner Flux3 video candidate could not be prepared safely.");
    this.name = "OwnerFlux3VideoOwnedRequestPreparerError";
  }
}

export class OwnerFlux3VideoOwnedRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api;
    PREPARERS.add(this);
    Object.freeze(this);
  }
  prepare(input: unknown): Promise<OwnerFlux3VideoOwnedPreparedCandidate> { return this.#api.prepare(input); }
  inspectCandidate(candidate: unknown): Readonly<OwnerFlux3VideoOwnedCandidateBinding> | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerFlux3VideoOwnedPreparedRequest { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerFlux3VideoOwnedCandidateBinding>> { return this.#api.revalidateCandidate(candidate); }
  withCapturedNativeReferences<T>(candidate: unknown, consume: (client: SyntxChatHttpClient, contexts: readonly OwnerFlux3UploadContext[]) => T): T {
    return this.#api.withCapturedNativeReferences(candidate, consume);
  }
  isBoundToReferenceService(service: unknown): boolean { return this.#api.isBoundToReferenceService(service); }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerFlux3VideoOwnedRequestPreparer.prototype);

export function createOwnerFlux3VideoOwnedRequestPreparer(
  optionsInput: OwnerFlux3VideoOwnedRequestPreparerOptions | unknown
): OwnerFlux3VideoOwnedRequestPreparer {
  const options = readOptions(optionsInput), candidates = new Set<CandidateState>(), epochs = new Map<string, number>();
  const clock = options.now === undefined ? Date.now : readClock(options.now);
  let lastNow = -1, closed = false;
  const readNow = (): number => {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || value < lastNow) fail("CLOCK_INVALID");
    lastNow = value;
    return value;
  };

  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object);
    if (!state || !candidates.has(state)) fail("CANDIDATE_UNBOUND");
    const now = readNow();
    if (state.candidate !== value || state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || now >= state.expiresAt) {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
    try {
      assertCapturedSources(options.referenceService, state.capturedSources, state.attemptId, state.principal, state.modelId);
    } catch {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
    return state;
  };

  const api: PreparerApi = {
    async prepare(inputInput) {
      if (closed) fail("SERVICE_CLOSED");
      const input = snapshotPrepareInput(inputInput);
      let normalized: OwnerFlux3VideoParameters;
      try { normalized = normalizeOwnerFlux3VideoParameters({ model_id: input.request.model_id, parameters: input.request.parameters }); }
      catch (error) { if (error instanceof OwnerFlux3VideoParametersError) fail("PARAMETERS_INVALID"); throw error; }
      const promptBytes = Buffer.byteLength(input.request.prompt, "utf8");
      if (promptBytes > MAX_PROMPT_UTF8_BYTES) fail("PROMPT_LOCAL_LIMIT_EXCEEDED");
      const profile = getOwnerFlux3VideoSourceProfile(input.request.model_id);
      if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.runtime_usable !== false ||
          profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN") fail("REFERENCE_UNAVAILABLE");
      const profileHash = schemaHash(profile), epoch = epochs.get(input.attemptId) ?? 0;
      const resolved: CapturedReference[] = [];
      for (const handle of input.request.flux3_reference_handles) {
        resolved.push(await resolveReference(options.referenceService, input.attemptId, input.request.model_id, handle));
      }
      const principal = resolved[0]!.resolution.principal;
      if (resolved.some((source) => !sameGenerationPrincipal(source.resolution.principal, principal))) fail("PRINCIPAL_MISMATCH");
      const sources = deduplicateReferences(resolved);
      const current = await resolveAndCaptureAll(options.referenceService, input.attemptId, input.request.model_id, input.request.flux3_reference_handles);
      if (closed || epoch !== (epochs.get(input.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
      const currentSources = deduplicateReferences(current);
      assertSameCapturedSources(sources, currentSources, principal, input.attemptId, input.request.model_id);
      const now = readNow(), expiresAt = Math.min(now + TTL_MS,
        ...resolved.map((source) => source.resolution.expires_at), ...current.map((source) => source.resolution.expires_at));
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail("REFERENCE_EXPIRED");
      const wireSettings = projectOwnerFlux3VideoWireSettings(normalized);
      const request: OwnerFlux3VideoOwnedPreparedRequest = deepFreeze({
        prompt: input.request.prompt,
        settings: { ...wireSettings, file_urls: sources.map((source) => ({ type: source.metadata.wire_type, url: source.url })) }
      });
      const sourceBinding = profile.source_pins;
      const sourceMetadata = deepFreeze(sources.map((source) => source.metadata));
      const sourceSha256s = Object.freeze(sources.map((source) => source.metadata.sha256));
      const promptSha256 = createHash("sha256").update(input.request.prompt, "utf8").digest("hex");
      const intentFingerprint = schemaHash({
        tenant_id: principal.tenant_id,
        subject_id: principal.subject_id,
        model_id: input.request.model_id,
        profile_schema_hash: profileHash,
        source_catalog_version: OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION,
        prompt: input.request.prompt,
        parameters: normalized.parameters,
        ordered_source_sha256s: sourceSha256s
      });
      const requestFingerprint = schemaHash(request);
      const candidate = makeCandidate({ modelId: input.request.model_id, profileHash, sourceBinding,
        requestFingerprint, intentFingerprint, sources: sourceMetadata, expiresAt });
      const binding: Readonly<OwnerFlux3VideoOwnedCandidateBinding> = deepFreeze({
        attempt_id: input.attemptId,
        principal,
        model_id: input.request.model_id,
        profile_schema_hash: profileHash,
        source_binding: sourceBinding,
        prompt_sha256: promptSha256,
        prompt_utf8_bytes: promptBytes,
        parameters: normalized.parameters,
        sources: sourceMetadata,
        source_sha256s: sourceSha256s,
        request_fingerprint: requestFingerprint,
        intent_fingerprint: intentFingerprint,
        expires_at: expiresAt,
        control_combination_status: OWNER_FLUX3_VIDEO_CONTROL_COMBINATION_STATUS
      });
      prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      const state: CandidateState = {
        candidate, attemptId: input.attemptId, handles: input.request.flux3_reference_handles,
        principal, profileHash, modelId: input.request.model_id, sources, capturedSources: Object.freeze([...resolved]),
        request, binding, expiresAt, epoch, expired: false
      };
      CANDIDATES.set(candidate, state); candidates.add(state);
      return candidate;
    },
    inspectCandidate(value) { try { return stateFor(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return stateFor(value).request; },
    withCapturedNativeReferences<T>(value: unknown, consume: (client: SyntxChatHttpClient, contexts: readonly OwnerFlux3UploadContext[]) => T): T {
      if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
      const state = stateFor(value), contexts: OwnerFlux3UploadContext[] = [];
      let capturedClient: SyntxChatHttpClient | undefined;
      const captureAt = (index: number): unknown => {
        if (index >= state.capturedSources.length) {
          const result = consume(capturedClient!, Object.freeze([...contexts]));
          if (isThenableWithoutAccessors(result)) fail("INVALID_REQUEST");
          return result;
        }
        const source = state.capturedSources[index]!;
        return Reflect.apply(ORIGINAL_CAPTURE, options.referenceService, [source.resolution,
          (client: SyntxChatHttpClient, context: OwnerFlux3UploadContext) => {
            const witness = readOwnerFlux3UploadReferenceForClient(client, context);
            if (!witness || !matchesUploadContext(witness, source.resolution) || !isSafeUploadReferenceUrl(witness.url) ||
                client !== source.client || context !== source.nativeContext || witness.url !== source.url ||
                (capturedClient !== undefined && capturedClient !== client)) fail("REFERENCE_EXPIRED");
            capturedClient = client;
            contexts.push(context);
            return captureAt(index + 1);
          }]);
      };
      return captureAt(0) as T;
    },
    isBoundToReferenceService(service) { return service === options.referenceService; },
    async revalidateCandidate(value) {
      const state = stateFor(value);
      const current = await resolveAndCaptureAll(options.referenceService, state.attemptId, state.modelId, state.handles);
      if (closed || state.epoch !== (epochs.get(state.attemptId) ?? 0) || readNow() >= state.expiresAt) {
        state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
      }
      const deduplicated = deduplicateReferences(current);
      assertSameCapturedSources(state.sources, deduplicated, state.principal, state.attemptId, state.modelId);
      if (schemaHash(state.request) !== state.candidate.request_fingerprint || schemaHash(state.request) !== state.binding.request_fingerprint) {
        state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
      }
      assertCapturedSources(options.referenceService, state.capturedSources, state.attemptId, state.principal, state.modelId);
      return state.binding;
    },
    async invalidateAttempt(attemptInput) {
      const attemptId = readAttempt(attemptInput);
      epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
      for (const state of candidates) if (state.attemptId === attemptId) { state.expired = true; candidates.delete(state); }
    },
    async close() { closed = true; for (const state of candidates) state.expired = true; candidates.clear(); epochs.clear(); }
  };
  return new OwnerFlux3VideoOwnedRequestPreparer(PREPARER_KEY, api);

  function prune(): void {
    const now = readNow();
    for (const state of candidates) if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); }
  }
}

export function isOwnerFlux3VideoOwnedRequestPreparer(value: unknown): value is OwnerFlux3VideoOwnedRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerFlux3VideoOwnedRequestPreparer.prototype &&
    value instanceof OwnerFlux3VideoOwnedRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}

export function isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService(
  preparer: unknown,
  referenceService: unknown
): preparer is OwnerFlux3VideoOwnedRequestPreparer {
  return isOwnerFlux3VideoOwnedRequestPreparer(preparer) && preparer.isBoundToReferenceService(referenceService);
}

export function readOwnerFlux3VideoOwnedCandidateBinding(
  preparer: unknown,
  candidate: unknown,
  referenceService: unknown
): Readonly<OwnerFlux3VideoOwnedCandidateBinding> | undefined {
  if (!isOwnerFlux3VideoOwnedRequestPreparerBoundToReferenceService(preparer, referenceService) ||
      !isOwnerFlux3VideoOwnedPreparedCandidate(candidate)) return undefined;
  return preparer.inspectCandidate(candidate);
}

export function isOwnerFlux3VideoOwnedPreparedCandidate(value: unknown): value is OwnerFlux3VideoOwnedPreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  return !!state && state.candidate === value && !state.expired;
}

function readOptions(value: unknown): Readonly<OwnerFlux3VideoOwnedRequestPreparerOptions> {
  const fields = exactRecord(value, ["referenceService"], ["now"]), service = fields.referenceService;
  if (!(service instanceof OwnerFlux3MediaReferenceService) || types.isProxy(service) ||
      Object.getPrototypeOf(service) !== OwnerFlux3MediaReferenceService.prototype ||
      getDataMethod(service, "resolveReference") !== ORIGINAL_RESOLVE ||
      getDataMethod(service, "isOwnedReferenceResolution") !== ORIGINAL_GUARD ||
      getDataMethod(service, "withCapturedNativeReference") !== ORIGINAL_CAPTURE ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ referenceService: service, ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}

function snapshotPrepareInput(value: unknown): Readonly<PrepareOwnerFlux3VideoOwnedRequestInput> {
  const fields = exactRecord(value, ["attemptId", "request"]), attemptId = readAttempt(fields.attemptId);
  const request = exactRecord(fields.request, ["model_id", "prompt", "flux3_reference_handles", "parameters"]);
  if (request.model_id !== "flux3_i2v" && request.model_id !== "flux3_v2v") invalid();
  if (typeof request.prompt !== "string") invalid();
  const promptBytes = Buffer.byteLength(request.prompt, "utf8");
  if (promptBytes > MAX_PROMPT_UTF8_BYTES) fail("PROMPT_LOCAL_LIMIT_EXCEEDED");
  const handles = readHandles(request.flux3_reference_handles, request.model_id);
  const parameters = exactRecord(request.parameters, ["resolution", "video_duration", "generate_audio"]);
  return Object.freeze({ attemptId, request: Object.freeze({
    model_id: request.model_id,
    prompt: request.prompt,
    flux3_reference_handles: Object.freeze(handles),
    parameters: parameters as unknown as OwnerFlux3VideoParameterValues
  }) });
}

function readHandles(value: unknown, modelId: OwnerFlux3VideoModelId): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = value.length, limit = modelId === "flux3_i2v" ? 10 : 1;
  if (length < 1 || length > limit || Reflect.ownKeys(descriptors).length !== length + 1) fail("REFERENCE_COUNT_INVALID");
  const handles: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !HANDLE.test(descriptor.value)) invalid();
    handles.push(descriptor.value);
  }
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)) ||
      (key !== "length" && Number(key) >= length))) invalid();
  return handles;
}

async function resolveReference(service: OwnerFlux3MediaReferenceService, attemptId: string, modelId: OwnerFlux3VideoModelId, handle: string): Promise<CapturedReference> {
  let resolution: OwnerFlux3MediaReferenceResolution;
  try { resolution = await Reflect.apply(ORIGINAL_RESOLVE, service, [{ attemptId, model_id: modelId, flux3_reference_handle: handle }]); }
  catch (error) { translateReferenceError(error); }
  assertResolution(service, resolution!, attemptId, modelId, handle);
  return captureReference(service, resolution!, attemptId, modelId, handle);
}

function captureReference(service: OwnerFlux3MediaReferenceService, resolution: OwnerFlux3MediaReferenceResolution,
  attemptId: string, modelId: OwnerFlux3VideoModelId, handle: string): CapturedReference {
  assertResolution(service, resolution, attemptId, modelId, handle);
  try {
    return Reflect.apply(ORIGINAL_CAPTURE, service, [resolution,
      (client: SyntxChatHttpClient, context: OwnerFlux3UploadContext) => {
        if (!client || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype) fail("REFERENCE_UNAVAILABLE");
        const witness = readOwnerFlux3UploadReferenceForClient(client, context);
        if (!witness || !matchesUploadContext(witness, resolution) || !isSafeUploadReferenceUrl(witness.url)) fail("REFERENCE_UNAVAILABLE");
        return Object.freeze({ resolution, handle, client, nativeContext: context, url: witness.url,
          metadata: metadataFromResolution(resolution) });
      }]) as CapturedReference;
  } catch (error) { translateReferenceError(error); }
}

function assertResolution(service: OwnerFlux3MediaReferenceService, value: OwnerFlux3MediaReferenceResolution,
  attemptId: string, modelId: OwnerFlux3VideoModelId, handle: string): void {
  const profile = getOwnerFlux3VideoSourceProfile(modelId);
  if (!profile || !Reflect.apply(ORIGINAL_GUARD, service, [value]) || value.role !== "flux3_media_reference" ||
      value.attempt_id !== attemptId || value.flux3_reference_handle !== handle || value.model_id !== modelId ||
      value.ai_name !== "flux3_video" || value.source_catalog_version !== OWNER_FLUX3_VIDEO_PUBLIC_CATALOG_VERSION ||
      value.profile_schema_hash !== schemaHash(profile) || schemaHash(value.source_pins) !== schemaHash(profile.source_pins) ||
      value.generation_permit !== false || !samePrincipal(value.principal, attemptId) ||
      !/^[a-f0-9]{64}$/u.test(value.sha256) || !positiveSafeInteger(value.size) || !positiveSafeInteger(value.width) ||
      !positiveSafeInteger(value.height) || !Number.isSafeInteger(value.epoch) || value.epoch < 0 ||
      !Number.isSafeInteger(value.expires_at) || value.expires_at <= 0 ||
      !safeMetadata(value, modelId)) fail("REFERENCE_UNAVAILABLE");
}

function safeMetadata(value: OwnerFlux3MediaReferenceResolution, modelId: OwnerFlux3VideoModelId): boolean {
  const profile = getOwnerFlux3VideoSourceProfile(modelId);
  if (!profile || value.size > profile.input.max_file_size_bytes) return false;
  if (modelId === "flux3_i2v") return value.wire_type === "image" &&
    (value.mime_type === "image/jpeg" || value.mime_type === "image/png" || value.mime_type === "image/webp") &&
    value.duration_seconds === null && value.input_confidence === "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED";
  return value.wire_type === "video" && value.mime_type === "video/mp4" &&
    typeof value.duration_seconds === "number" && Number.isFinite(value.duration_seconds) && value.duration_seconds > 0 &&
    value.input_confidence === "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE";
}

function matchesUploadContext(witness: OwnerFlux3UploadContext & Readonly<{ url: string }>,
  resolution: OwnerFlux3MediaReferenceResolution): boolean {
  if (witness.model_id !== resolution.model_id || witness.ai_name !== resolution.ai_name ||
      witness.source_catalog_version !== resolution.source_catalog_version || witness.destination !== resolution.destination ||
      witness.source_mime_type !== resolution.mime_type || witness.mime_type !== resolution.mime_type ||
      witness.size !== resolution.size || witness.sha256 !== resolution.sha256) return false;
  if (resolution.wire_type === "image") return witness.status === "OWNER_FLUX3_I2V_IMAGE_UPLOADED" &&
    witness.width === resolution.width && witness.height === resolution.height &&
    "metadata_confidence" in witness && witness.metadata_confidence === resolution.input_confidence;
  return witness.status === "OWNER_FLUX3_V2V_ORIGINAL_UPLOADED" && "metadata" in witness &&
    witness.metadata.video.width === resolution.width && witness.metadata.video.height === resolution.height &&
    witness.metadata.video.duration_seconds === resolution.duration_seconds && witness.metadata.inspection === resolution.input_confidence;
}

function deduplicateReferences(values: readonly CapturedReference[]): readonly CapturedReference[] {
  const ordered: CapturedReference[] = [], seen = new Map<string, CapturedReference>();
  for (const value of values) {
    const key = `${value.metadata.wire_type}\0${value.url}`, previous = seen.get(key);
    if (!previous) { seen.set(key, value); ordered.push(value); continue; }
    if (previous.metadata.sha256 !== value.metadata.sha256 || previous.metadata.size !== value.metadata.size ||
        previous.metadata.mime_type !== value.metadata.mime_type || previous.metadata.width !== value.metadata.width ||
        previous.metadata.height !== value.metadata.height || previous.metadata.duration_seconds !== value.metadata.duration_seconds) {
      fail("REFERENCE_URL_IDENTITY_CONFLICT");
    }
  }
  return Object.freeze(ordered);
}

function assertCapturedSources(service: OwnerFlux3MediaReferenceService, sources: readonly CapturedReference[], attemptId: string,
  principal: Readonly<GenerationPrincipalRef>, modelId: OwnerFlux3VideoModelId): void {
  for (const source of sources) {
    assertResolution(service, source.resolution, attemptId, modelId, source.handle);
    const current = captureReference(service, source.resolution, attemptId, modelId, source.handle);
    if (current.client !== source.client || current.nativeContext !== source.nativeContext || current.url !== source.url ||
        !sameGenerationPrincipal(current.resolution.principal, principal)) fail("REFERENCE_EXPIRED");
  }
}

async function resolveAndCaptureAll(service: OwnerFlux3MediaReferenceService, attemptId: string, modelId: OwnerFlux3VideoModelId,
  handles: readonly string[]): Promise<readonly CapturedReference[]> {
  const result: CapturedReference[] = [];
  for (const handle of handles) result.push(await resolveReference(service, attemptId, modelId, handle));
  return Object.freeze(result);
}

function assertSameCapturedSources(a: readonly CapturedReference[], b: readonly CapturedReference[], principal: Readonly<GenerationPrincipalRef>,
  attemptId: string, modelId: OwnerFlux3VideoModelId): void {
  if (a.length !== b.length) fail("REFERENCE_EXPIRED");
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index]!, right = b[index]!;
    if (left.handle !== right.handle || left.client !== right.client || left.nativeContext !== right.nativeContext || left.url !== right.url ||
        !sameGenerationPrincipal(left.resolution.principal, principal) || !sameGenerationPrincipal(right.resolution.principal, principal) ||
        schemaHash(left.metadata) !== schemaHash(right.metadata) || left.resolution.attempt_id !== attemptId ||
        right.resolution.attempt_id !== attemptId || left.resolution.model_id !== modelId || right.resolution.model_id !== modelId ||
        left.resolution.epoch !== right.resolution.epoch || left.resolution.expires_at !== right.resolution.expires_at) fail("REFERENCE_EXPIRED");
  }
}

function metadataFromResolution(value: OwnerFlux3MediaReferenceResolution): OwnerFlux3VideoOwnedSourceMetadata {
  return Object.freeze({ wire_type: value.wire_type, mime_type: value.mime_type, size: value.size,
    sha256: value.sha256, width: value.width, height: value.height, duration_seconds: value.duration_seconds,
    input_confidence: value.input_confidence });
}

function makeCandidate(input: { modelId: OwnerFlux3VideoModelId; profileHash: string; sourceBinding: OwnerFlux3VideoSourceProfile["source_pins"];
  requestFingerprint: string; intentFingerprint: string; sources: readonly OwnerFlux3VideoOwnedSourceMetadata[]; expiresAt: number }): OwnerFlux3VideoOwnedPreparedCandidate {
  const candidate = Object.create(null) as OwnerFlux3VideoOwnedPreparedCandidate;
  Object.defineProperties(candidate, {
    status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
    runtime_usable: { value: false, enumerable: true }, backend_acceptance: { value: "UNPROVEN", enumerable: true },
    model_id: { value: input.modelId, enumerable: true }, profile_schema_hash: { value: input.profileHash, enumerable: true },
    source_binding: { value: input.sourceBinding, enumerable: true },
    control_combination_status: { value: OWNER_FLUX3_VIDEO_CONTROL_COMBINATION_STATUS, enumerable: true },
    request_fingerprint: { value: input.requestFingerprint, enumerable: true }, intent_fingerprint: { value: input.intentFingerprint, enumerable: true },
    sources: { value: input.sources, enumerable: true }, expires_at: { value: input.expiresAt, enumerable: true }
  });
  return Object.freeze(candidate);
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function samePrincipal(value: unknown, attemptId: string): boolean {
  try { return snapshotPrincipal(value, attemptId).connection_id === attemptId; } catch { return false; }
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) invalid(); return value; }
function positiveSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const allowed = new Set([...required, ...optional]);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) invalid();
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) invalid();
  return () => { let now: unknown; try { now = Reflect.apply(value, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("CLOCK_INVALID"); return now as number; };
}
function isThenableWithoutAccessors(value: unknown): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  if (types.isProxy(value)) return true;
  let current = value as object | null;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "then");
    if (descriptor) return !("value" in descriptor) || typeof descriptor.value === "function";
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) { const descriptor = Object.getOwnPropertyDescriptor(current, key); if (descriptor) return "value" in descriptor ? descriptor.value : undefined; current = Object.getPrototypeOf(current) as object | null; }
  return undefined;
}
function translateReferenceError(error: unknown): never {
  if (error instanceof OwnerFlux3VideoOwnedRequestPreparerError) throw error;
  if (error instanceof OwnerFlux3MediaReferenceServiceError) {
    if (error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
    if (error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_MISMATCH");
  }
  fail("REFERENCE_UNAVAILABLE");
}
function invalid(): never { throw new OwnerFlux3VideoOwnedRequestPreparerError("INVALID_REQUEST"); }
function fail(code: OwnerFlux3VideoOwnedRequestPreparerErrorCode): never { throw new OwnerFlux3VideoOwnedRequestPreparerError(code); }
