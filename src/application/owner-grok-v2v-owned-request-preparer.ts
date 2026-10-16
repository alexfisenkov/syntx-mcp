import { createHash } from "node:crypto";
import { types } from "node:util";
import { SyntxChatHttpClient, readOwnerGrokV2vUploadReferenceForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerGrokV2vUploadContext } from "../adapter/syntx/grok-v2v-media-upload.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  OwnerGrokV2vOriginalReferenceService,
  OwnerGrokV2vOriginalReferenceServiceError
} from "./owner-grok-v2v-original-reference-service.js";
import type { OwnerGrokV2vOriginalReferenceResolution } from "./owner-grok-v2v-original-reference-service.js";
import {
  isOwnerGrokV2vMeasuredSettingsCandidate,
  isOwnerGrokV2vNormalizedParameters,
  normalizeOwnerGrokV2vParameters,
  projectOwnerGrokV2vMeasuredSettings,
  OwnerGrokV2vParametersError,
  type OwnerGrokV2vMeasuredSettingsCandidate,
  type OwnerGrokV2vNormalizedParameters
} from "./owner-grok-v2v-parameters.js";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
  type OwnerGrokV2vSourceProfile
} from "./owner-grok-v2v-source-profile.js";

const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const AI_NAME = "grok_video" as const;
const PROFILE = getOwnerGrokV2vSourceProfile(MODEL_ID)!;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^grok_v2v_reference_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const PREPARER_KEY = Symbol("OwnerGrokV2vOwnedRequestPreparerFactory");
const ORIGINAL_RESOLVE = OwnerGrokV2vOriginalReferenceService.prototype.resolveReference;
const ORIGINAL_GUARD = OwnerGrokV2vOriginalReferenceService.prototype.isOwnedReferenceResolution;
const ORIGINAL_CAPTURE = OwnerGrokV2vOriginalReferenceService.prototype.withCapturedNativeReference;
const ORIGINAL_INVALIDATE = OwnerGrokV2vOriginalReferenceService.prototype.invalidateAttempt;
const ORIGINAL_CLOSE = OwnerGrokV2vOriginalReferenceService.prototype.close;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();

export interface OwnerGrokV2vOwnedSourceMetadata {
  readonly wire_type: "video";
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly container: "ISO_BMFF_MP4" | "QUICKTIME_MOV";
  readonly video_codec: string;
  readonly duration_confidence: "CONTAINER_DURATION_SECONDS_LOCAL_POLICY";
  readonly input_confidence: "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE";
}

export interface OwnerGrokV2vOwnedPreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: typeof MODEL_ID;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerGrokV2vSourceProfile["source_pins"];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly sources: readonly OwnerGrokV2vOwnedSourceMetadata[];
  readonly expires_at: number;
}

export interface OwnerGrokV2vOwnedPreparedSettings {
  readonly model_type: typeof MODEL_ID;
  readonly aspect_ratio: null;
  readonly video_duration: number;
  readonly resolution: "480p" | "720p";
  readonly file_urls: readonly Readonly<{ type: "video"; url: string }>[];
}

export interface OwnerGrokV2vOwnedPreparedRequest {
  readonly prompt: string;
  readonly settings: Readonly<OwnerGrokV2vOwnedPreparedSettings>;
  readonly cost_parameters: Readonly<{ video_duration: number; resolution: "480p" | "720p" }>;
}

export interface OwnerGrokV2vOwnedCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: typeof MODEL_ID;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerGrokV2vSourceProfile["source_pins"];
  readonly grok_reference_handle: string;
  readonly prompt_sha256: string;
  readonly prompt_utf8_bytes: number;
  readonly source_sha256: string;
  readonly source_size: number;
  readonly source_mime_type: "video/mp4" | "video/quicktime";
  readonly source_width: number;
  readonly source_height: number;
  readonly source_duration_seconds: number;
  readonly settings: Readonly<Omit<OwnerGrokV2vMeasuredSettingsCandidate["settings_candidate"], "model_type">>;
  readonly cost_parameters: Readonly<OwnerGrokV2vMeasuredSettingsCandidate["cost_parameters_candidate"]>;
  readonly sources: readonly OwnerGrokV2vOwnedSourceMetadata[];
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly reference_expires_at: number;
  readonly reference_epoch: number;
}

export interface OwnerGrokV2vOwnedRequestPreparerOptions {
  readonly referenceService: OwnerGrokV2vOriginalReferenceService;
  readonly now?: () => number;
}

export interface PrepareOwnerGrokV2vOwnedRequestInput {
  readonly attemptId: string;
  readonly request: Readonly<{
    model_id: typeof MODEL_ID;
    prompt: string;
    grok_reference_handle: string;
  }>;
}

interface CapturedOriginal {
  readonly resolution: Readonly<OwnerGrokV2vOriginalReferenceResolution>;
  readonly client: SyntxChatHttpClient;
  readonly nativeContext: OwnerGrokV2vUploadContext;
  readonly url: string;
  readonly sourceMetadata: OwnerGrokV2vOwnedSourceMetadata;
  readonly measuredSettings: OwnerGrokV2vMeasuredSettingsCandidate;
}

interface CandidateState {
  readonly candidate: OwnerGrokV2vOwnedPreparedCandidate;
  readonly attemptId: string;
  readonly handle: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profileHash: string;
  readonly captured: CapturedOriginal;
  readonly privateRequest: OwnerGrokV2vOwnedPreparedRequest;
  readonly binding: Readonly<OwnerGrokV2vOwnedCandidateBinding>;
  readonly expiresAt: number;
  readonly epoch: number;
  expired: boolean;
}

interface PreparerApi {
  prepare(input: unknown): Promise<OwnerGrokV2vOwnedPreparedCandidate>;
  inspectCandidate(candidate: unknown): Readonly<OwnerGrokV2vOwnedCandidateBinding> | undefined;
  getPrivateRequest(candidate: unknown): OwnerGrokV2vOwnedPreparedRequest;
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerGrokV2vOwnedCandidateBinding>>;
  withCapturedNativeReference<T>(candidate: unknown, consume: (client: SyntxChatHttpClient, context: OwnerGrokV2vUploadContext) => T): T;
  isBoundToReferenceService(service: unknown): boolean;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerGrokV2vOwnedRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "PARAMETERS_INVALID"
  | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "CANDIDATE_MISMATCH";

export class OwnerGrokV2vOwnedRequestPreparerError extends Error {
  constructor(readonly code: OwnerGrokV2vOwnedRequestPreparerErrorCode) {
    super("The owner Grok V2V candidate could not be prepared safely.");
    this.name = "OwnerGrokV2vOwnedRequestPreparerError";
  }
}

export class OwnerGrokV2vOwnedRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api;
    PREPARERS.add(this);
    Object.freeze(this);
  }
  prepare(input: unknown): Promise<OwnerGrokV2vOwnedPreparedCandidate> { return this.#api.prepare(input); }
  inspectCandidate(candidate: unknown): Readonly<OwnerGrokV2vOwnedCandidateBinding> | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerGrokV2vOwnedPreparedRequest { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerGrokV2vOwnedCandidateBinding>> { return this.#api.revalidateCandidate(candidate); }
  withCapturedNativeReference<T>(candidate: unknown, consume: (client: SyntxChatHttpClient, context: OwnerGrokV2vUploadContext) => T): T {
    return this.#api.withCapturedNativeReference(candidate, consume);
  }
  isBoundToReferenceService(service: unknown): boolean { return this.#api.isBoundToReferenceService(service); }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerGrokV2vOwnedRequestPreparer.prototype);

export function createOwnerGrokV2vOwnedRequestPreparer(
  optionsInput: OwnerGrokV2vOwnedRequestPreparerOptions | unknown
): OwnerGrokV2vOwnedRequestPreparer {
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
    if (!options.referenceService.isOwnedReferenceResolution(state.captured.resolution, {
      attemptId: state.attemptId, model_id: MODEL_ID, grok_reference_handle: state.handle
    })) {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
    return state;
  };

  const api: PreparerApi = {
    async prepare(inputInput) {
      if (closed) fail("SERVICE_CLOSED");
      const input = snapshotPrepareInput(inputInput);
      let normalized: OwnerGrokV2vNormalizedParameters;
      try { normalized = normalizeOwnerGrokV2vParameters({ model_id: input.request.model_id, prompt: input.request.prompt }); }
      catch (error) { if (error instanceof OwnerGrokV2vParametersError) fail("PARAMETERS_INVALID"); throw error; }
      if (!isOwnerGrokV2vNormalizedParameters(normalized)) fail("PARAMETERS_INVALID");
      const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
      if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.runtime_usable !== false ||
          profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN" ||
          profile.source_pins.public_catalog_version !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION) fail("REFERENCE_UNAVAILABLE");
      const profileHash = schemaHash(profile), epoch = epochs.get(input.attemptId) ?? 0;
      const captured = await resolveAndCapture(options.referenceService, input.attemptId, input.request.grok_reference_handle, profile, profileHash);
      if (closed || epoch !== (epochs.get(input.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
      const principal = captured.resolution.principal;
      const now = readNow(), expiresAt = Math.min(now + TTL_MS, captured.resolution.expires_at);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail("REFERENCE_EXPIRED");
      const measured = captured.measuredSettings;
      const settings: OwnerGrokV2vOwnedPreparedSettings = deepFreeze({
        ...measured.settings_candidate,
        file_urls: [{ type: "video", url: captured.url }]
      });
      const costParameters = deepFreeze({ ...measured.cost_parameters_candidate });
      const privateRequest: OwnerGrokV2vOwnedPreparedRequest = deepFreeze({
        prompt: normalized.intent.prompt,
        settings,
        cost_parameters: costParameters
      });
      const sourceMetadata = captured.sourceMetadata;
      const promptSha256 = createHash("sha256").update(normalized.intent.prompt, "utf8").digest("hex");
      const promptBytes = Buffer.byteLength(normalized.intent.prompt, "utf8");
      const intentFingerprint = schemaHash({
        tenant_id: principal.tenant_id,
        subject_id: principal.subject_id,
        model_id: MODEL_ID,
        profile_schema_hash: profileHash,
        source_catalog_version: OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
        prompt_sha256: promptSha256,
        source_sha256: sourceMetadata.sha256,
        settings_candidate: measured.settings_candidate,
        cost_parameters_candidate: costParameters
      });
      const requestFingerprint = schemaHash(privateRequest);
      const sourceBinding = profile.source_pins;
      const sourceRows = deepFreeze([sourceMetadata]);
      const candidate: OwnerGrokV2vOwnedPreparedCandidate = deepFreeze({
        status: "blocked",
        dispatch_allowed: false,
        runtime_usable: false,
        backend_acceptance: "UNPROVEN",
        model_id: MODEL_ID,
        profile_schema_hash: profileHash,
        source_binding: sourceBinding,
        request_fingerprint: requestFingerprint,
        intent_fingerprint: intentFingerprint,
        sources: sourceRows,
        expires_at: expiresAt
      });
      const binding: Readonly<OwnerGrokV2vOwnedCandidateBinding> = deepFreeze({
        attempt_id: input.attemptId,
        principal,
        model_id: MODEL_ID,
        profile_schema_hash: profileHash,
        source_binding: sourceBinding,
        grok_reference_handle: input.request.grok_reference_handle,
        prompt_sha256: promptSha256,
        prompt_utf8_bytes: promptBytes,
        source_sha256: sourceMetadata.sha256,
        source_size: sourceMetadata.size,
        source_mime_type: sourceMetadata.mime_type,
        source_width: sourceMetadata.width,
        source_height: sourceMetadata.height,
        source_duration_seconds: sourceMetadata.duration_seconds,
        settings: measured.settings_candidate,
        cost_parameters: costParameters,
        sources: sourceRows,
        request_fingerprint: requestFingerprint,
        intent_fingerprint: intentFingerprint,
        expires_at: expiresAt,
        reference_expires_at: captured.resolution.expires_at,
        reference_epoch: captured.resolution.epoch
      });
      prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      const state: CandidateState = {
        candidate, attemptId: input.attemptId, handle: input.request.grok_reference_handle,
        principal, profileHash, captured, privateRequest, binding, expiresAt, epoch, expired: false
      };
      CANDIDATES.set(candidate, state); candidates.add(state);
      return candidate;
    },
    inspectCandidate(value) { try { return stateFor(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return stateFor(value).privateRequest; },
    async revalidateCandidate(value) {
      const state = stateFor(value);
      const fresh = await resolveAndCapture(options.referenceService, state.attemptId, state.handle, PROFILE, state.profileHash);
      if (closed || state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || readNow() >= state.expiresAt) {
        state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
      }
      assertSameCaptured(state.captured, fresh, state.principal, state.attemptId, state.handle);
      if (schemaHash(state.binding) !== schemaHash(stateFor(value).binding) ||
          schemaHash(state.privateRequest) !== schemaHash(stateFor(value).privateRequest)) {
        state.expired = true; candidates.delete(state); fail("CANDIDATE_MISMATCH");
      }
      return state.binding;
    },
    withCapturedNativeReference<T>(value: unknown, consume: (client: SyntxChatHttpClient, context: OwnerGrokV2vUploadContext) => T): T {
      if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
      const state = stateFor(value);
      const result = Reflect.apply(ORIGINAL_CAPTURE, options.referenceService, [state.captured.resolution,
        (client: SyntxChatHttpClient, context: OwnerGrokV2vUploadContext) => {
          const witness = readOwnerGrokV2vUploadReferenceForClient(client, context);
          if (!witness || !sameCapturedWitness(state.captured, client, context, witness)) fail("CANDIDATE_EXPIRED");
          const consumed = consume(client, context);
          if (isThenableWithoutAccessors(consumed)) fail("INVALID_REQUEST");
          return consumed;
        }]);
      stateFor(value);
      return result as T;
    },
    isBoundToReferenceService(service) { return service === options.referenceService; },
    async invalidateAttempt(attemptInput) {
      const attemptId = readAttempt(attemptInput);
      epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
      for (const state of candidates) if (state.attemptId === attemptId) { state.expired = true; candidates.delete(state); }
    },
    async close() { closed = true; for (const state of candidates) state.expired = true; candidates.clear(); epochs.clear(); }
  };
  return new OwnerGrokV2vOwnedRequestPreparer(PREPARER_KEY, api);

  function prune(): void {
    const now = readNow();
    for (const state of candidates) if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); }
  }
}

export function isOwnerGrokV2vOwnedRequestPreparer(value: unknown): value is OwnerGrokV2vOwnedRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === OwnerGrokV2vOwnedRequestPreparer.prototype &&
    value instanceof OwnerGrokV2vOwnedRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}

export function isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService(
  preparer: unknown,
  referenceService: unknown
): preparer is OwnerGrokV2vOwnedRequestPreparer {
  return isOwnerGrokV2vOwnedRequestPreparer(preparer) && preparer.isBoundToReferenceService(referenceService);
}

export function isOwnerGrokV2vOwnedPreparedCandidate(value: unknown): value is OwnerGrokV2vOwnedPreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  return !!state && state.candidate === value && !state.expired;
}

export function readOwnerGrokV2vOwnedCandidateBinding(
  preparer: unknown,
  candidate: unknown,
  referenceService: unknown
): Readonly<OwnerGrokV2vOwnedCandidateBinding> | undefined {
  if (!isOwnerGrokV2vOwnedRequestPreparerBoundToReferenceService(preparer, referenceService) ||
      !isOwnerGrokV2vOwnedPreparedCandidate(candidate)) return undefined;
  return preparer.inspectCandidate(candidate);
}

function resolveAndCapture(
  referenceService: OwnerGrokV2vOriginalReferenceService,
  attemptId: string,
  handle: string,
  profile: OwnerGrokV2vSourceProfile,
  profileHash: string
): Promise<CapturedOriginal> {
  return resolveAndCaptureAsync();

  async function resolveAndCaptureAsync(): Promise<CapturedOriginal> {
    let resolution: Readonly<OwnerGrokV2vOriginalReferenceResolution>;
    const input = Object.freeze({ attemptId, model_id: MODEL_ID, grok_reference_handle: handle });
    try {
      resolution = await Reflect.apply(ORIGINAL_RESOLVE, referenceService, [input]);
    } catch (error) {
      if (error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
      fail("REFERENCE_UNAVAILABLE");
    }
    const principal = validateResolution(referenceService, resolution, input, profile, profileHash);
    let captured: Omit<CapturedOriginal, "resolution" | "sourceMetadata" | "measuredSettings"> | undefined;
    try {
      captured = Reflect.apply(ORIGINAL_CAPTURE, referenceService, [resolution,
        (client: SyntxChatHttpClient, nativeContext: OwnerGrokV2vUploadContext) => {
          const witness = readOwnerGrokV2vUploadReferenceForClient(client, nativeContext);
          if (!witness || !sameUploadWitness(resolution, client, nativeContext, witness)) fail("REFERENCE_EXPIRED");
          return Object.freeze({ client, nativeContext, url: witness.url });
        }]);
    } catch { fail("REFERENCE_EXPIRED"); }
    if (!captured || isThenableWithoutAccessors(captured) || !isSafeUploadReferenceUrl(captured.url) ||
        !isValidClient(captured.client) || !captured.nativeContext) fail("REFERENCE_EXPIRED");
    const sourceMetadata: OwnerGrokV2vOwnedSourceMetadata = deepFreeze({
      wire_type: resolution.wire_type,
      mime_type: resolution.mime_type,
      size: resolution.size,
      sha256: resolution.source_sha256,
      width: resolution.width,
      height: resolution.height,
      duration_seconds: resolution.duration_seconds,
      container: resolution.container,
      video_codec: resolution.video_codec,
      duration_confidence: resolution.duration_confidence,
      input_confidence: resolution.input_confidence
    });
    let measuredSettings: OwnerGrokV2vMeasuredSettingsCandidate;
    try {
      measuredSettings = projectOwnerGrokV2vMeasuredSettings({
        duration_seconds: resolution.duration_seconds, width: resolution.width, height: resolution.height
      });
    } catch (error) {
      if (error instanceof OwnerGrokV2vParametersError) fail("REFERENCE_UNAVAILABLE");
      throw error;
    }
    if (!isOwnerGrokV2vMeasuredSettingsCandidate(measuredSettings) ||
        measuredSettings.source_pins !== profile.source_pins || measuredSettings.input_binding !== "TRUSTED_OWNER_UPLOAD_RECEIPT_REQUIRED" ||
        !sameGenerationPrincipal(principal, resolution.principal)) fail("REFERENCE_UNAVAILABLE");
    return Object.freeze({ resolution, ...captured, sourceMetadata, measuredSettings });
  }
}

function validateResolution(
  referenceService: OwnerGrokV2vOriginalReferenceService,
  resolution: Readonly<OwnerGrokV2vOriginalReferenceResolution>,
  expectedInput: unknown,
  profile: OwnerGrokV2vSourceProfile,
  profileHash: string
): Readonly<GenerationPrincipalRef> {
  if (!resolution || typeof resolution !== "object" || types.isProxy(resolution) ||
      !referenceService.isOwnedReferenceResolution(resolution, expectedInput) ||
      resolution.role !== "grok_v2v_original_reference" || resolution.wire_type !== "video" ||
      resolution.model_id !== MODEL_ID || resolution.ai_name !== AI_NAME ||
      resolution.source_catalog_version !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION ||
      resolution.source_pins !== profile.source_pins || resolution.profile_schema_hash !== profileHash ||
      resolution.generation_permit !== false || !HANDLE.test(resolution.grok_reference_handle) ||
      !/^[a-f0-9]{64}$/u.test(resolution.source_sha256) ||
      (resolution.mime_type !== "video/mp4" && resolution.mime_type !== "video/quicktime") ||
      !isPositiveSafeInteger(resolution.size) || resolution.size > profile.input.max_file_size_bytes ||
      !isPositiveSafeInteger(resolution.width) || !isPositiveSafeInteger(resolution.height) ||
      !Number.isSafeInteger(resolution.width * resolution.height) ||
      !Number.isFinite(resolution.duration_seconds) || resolution.duration_seconds < 1 || resolution.duration_seconds > 8.7 ||
      !Number.isSafeInteger(resolution.expires_at) || resolution.expires_at < 0 ||
      !Number.isSafeInteger(resolution.epoch) || resolution.epoch < 0 ||
      resolution.duration_confidence !== "CONTAINER_DURATION_SECONDS_LOCAL_POLICY" ||
      resolution.input_confidence !== "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE" ||
      (resolution.mime_type === "video/mp4" && resolution.container !== "ISO_BMFF_MP4") ||
      (resolution.mime_type === "video/quicktime" && resolution.container !== "QUICKTIME_MOV") ||
      typeof resolution.filename !== "string" || !resolution.filename ||
      typeof resolution.video_codec !== "string" || !resolution.video_codec) fail("REFERENCE_UNAVAILABLE");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(resolution.principal); } catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== resolution.attempt_id || resolution.attempt_id.length === 0) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function sameUploadWitness(
  resolution: Readonly<OwnerGrokV2vOriginalReferenceResolution>,
  client: SyntxChatHttpClient,
  context: OwnerGrokV2vUploadContext,
  witness: Readonly<OwnerGrokV2vUploadContext & { readonly url: string }>
): boolean {
  return isValidClient(client) && context.status === "OWNER_GROK_V2V_ORIGINAL_UPLOADED" && context.model_id === MODEL_ID &&
    context.ai_name === AI_NAME && context.source_catalog_version === OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION &&
    context.destination === resolution.destination && context.filename === resolution.filename &&
    context.source_mime_type === resolution.mime_type && context.mime_type === resolution.mime_type &&
    context.size === resolution.size && context.sha256 === resolution.source_sha256 && context.metadata === resolution.metadata &&
    witness.status === context.status && witness.model_id === MODEL_ID &&
    witness.ai_name === AI_NAME && witness.source_catalog_version === OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION &&
    witness.destination === resolution.destination && witness.filename === resolution.filename &&
    witness.source_mime_type === resolution.mime_type && witness.mime_type === resolution.mime_type &&
    witness.size === resolution.size && witness.sha256 === resolution.source_sha256 &&
    witness.metadata === resolution.metadata;
}

function assertSameCaptured(
  original: CapturedOriginal,
  current: CapturedOriginal,
  principal: Readonly<GenerationPrincipalRef>,
  attemptId: string,
  handle: string
): void {
  if (current.resolution.attempt_id !== attemptId || current.resolution.grok_reference_handle !== handle ||
      !sameGenerationPrincipal(current.resolution.principal, principal) || current.client !== original.client ||
      current.nativeContext !== original.nativeContext || current.url !== original.url ||
      schemaHash(current.sourceMetadata) !== schemaHash(original.sourceMetadata) ||
      schemaHash(current.measuredSettings.settings_candidate) !== schemaHash(original.measuredSettings.settings_candidate) ||
      schemaHash(current.measuredSettings.cost_parameters_candidate) !== schemaHash(original.measuredSettings.cost_parameters_candidate)) fail("CANDIDATE_MISMATCH");
}

function sameCapturedWitness(
  captured: CapturedOriginal,
  client: SyntxChatHttpClient,
  context: OwnerGrokV2vUploadContext,
  witness: Readonly<OwnerGrokV2vUploadContext & { readonly url: string }>
): boolean {
  return client === captured.client && context === captured.nativeContext && witness.url === captured.url &&
    sameUploadWitness(captured.resolution, client, context, witness);
}

function snapshotPrepareInput(value: unknown): Readonly<PrepareOwnerGrokV2vOwnedRequestInput> {
  const fields = exactRecord(value, ["attemptId", "request"]);
  const attemptId = readAttempt(fields.attemptId);
  const request = exactRecord(fields.request, ["model_id", "prompt", "grok_reference_handle"]);
  if (request.model_id !== MODEL_ID || typeof request.prompt !== "string" || typeof request.grok_reference_handle !== "string" ||
      !HANDLE.test(request.grok_reference_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId, request: Object.freeze({ model_id: MODEL_ID, prompt: request.prompt, grok_reference_handle: request.grok_reference_handle }) });
}

function readOptions(value: unknown): Readonly<OwnerGrokV2vOwnedRequestPreparerOptions> {
  const fields = exactRecord(value, ["referenceService"], ["now"]);
  const service = fields.referenceService;
  if (!isGenuineReferenceService(service) || (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ referenceService: service, ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}

function isGenuineReferenceService(value: unknown): value is OwnerGrokV2vOriginalReferenceService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== OwnerGrokV2vOriginalReferenceService.prototype) return false;
  const originals: Readonly<Record<string, unknown>> = {
    resolveReference: ORIGINAL_RESOLVE,
    isOwnedReferenceResolution: ORIGINAL_GUARD,
    withCapturedNativeReference: ORIGINAL_CAPTURE,
    invalidateAttempt: ORIGINAL_INVALIDATE,
    close: ORIGINAL_CLOSE
  };
  return Object.keys(originals).every((key) => !Object.hasOwn(value, key) && getDataMethod(value, key) === originals[key]);
}

function isValidClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype;
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => {
    let result: unknown;
    try { result = Reflect.apply(value, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("CLOCK_INVALID");
    return result as number;
  };
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
    return copy;
  } catch (error) {
    if (error instanceof OwnerGrokV2vOwnedRequestPreparerError) throw error;
    fail("INVALID_REQUEST");
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isThenableWithoutAccessors(value: unknown): boolean {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return false;
  if (types.isProxy(value)) return true;
  let current = value as object | null;
  try {
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, "then");
      if (descriptor) return !("value" in descriptor) || typeof descriptor.value === "function";
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch { return true; }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
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

function fail(code: OwnerGrokV2vOwnedRequestPreparerErrorCode): never {
  throw new OwnerGrokV2vOwnedRequestPreparerError(code);
}
