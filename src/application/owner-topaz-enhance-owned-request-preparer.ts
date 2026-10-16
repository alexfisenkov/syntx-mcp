import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  SyntxChatHttpClient,
  readOwnerTopazEnhanceOriginalUploadForClient
} from "../adapter/syntx/chat-http-client.js";
import type { OwnerTopazEnhanceOriginalUploadContext } from "../adapter/syntx/topaz-enhance-original-upload.js";
import {
  OwnerTopazEnhanceOriginalReferenceService,
  type OwnerTopazEnhanceOriginalResolution
} from "./owner-topaz-enhance-original-reference-service.js";
import {
  normalizeOwnerTopazEnhanceParameters,
  projectOwnerTopazEnhanceWireSettings,
  OwnerTopazEnhanceParametersError,
  type OwnerTopazEnhanceParameterValues
} from "./owner-topaz-enhance-parameters.js";
import {
  getOwnerTopazEnhanceSourceProfile,
  OWNER_TOPAZ_ENHANCE_MODEL_ID,
  type OwnerTopazEnhanceSourceProfile
} from "./owner-topaz-enhance-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^topaz_enhance_original_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const PREPARER_KEY = Symbol("OwnerTopazEnhanceOwnedRequestPreparerFactory");
const ORIGINAL_RESOLVE = OwnerTopazEnhanceOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_GUARD = OwnerTopazEnhanceOriginalReferenceService.prototype.isOwnedOriginalResolution;
const ORIGINAL_CAPTURE = OwnerTopazEnhanceOriginalReferenceService.prototype.withCapturedNativeOriginal;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();

export const OWNER_TOPAZ_ENHANCE_CONTROL_COMBINATION_STATUS =
  "SOURCE_ENUMS_EXPLICIT_CONDITIONAL_COMBINATIONS_UNPROVEN" as const;

export interface OwnerTopazEnhanceOwnedPreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerTopazEnhanceSourceProfile["source_pins"];
  readonly control_combination_status: typeof OWNER_TOPAZ_ENHANCE_CONTROL_COMBINATION_STATUS;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly original: Readonly<{
    mime_type: "video/mp4";
    size: number;
    sha256: string;
    width: number;
    height: number;
    duration_seconds: number;
    frame_count: number;
  }>;
  readonly expires_at: number;
}

export interface OwnerTopazEnhanceOwnedPreparedRequest {
  readonly settings: Readonly<{
    model_type: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
    resolution: "1" | "2" | "4";
    video_duration: number;
    width: number;
    height: number;
    parameters: Readonly<OwnerTopazEnhanceParameterValues & { readonly blend: 0; readonly promode: 0 }>;
    file_urls: readonly Readonly<{ type: "video"; url: string }>[];
  }>;
}

export interface OwnerTopazEnhanceOwnedCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly original_handle: string;
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerTopazEnhanceSourceProfile["source_pins"];
  readonly original_sha256: string;
  readonly original_size: number;
  readonly mime_type: "video/mp4";
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly frame_count: number;
  readonly original_epoch: number;
  readonly original_expires_at: number;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly control_combination_status: typeof OWNER_TOPAZ_ENHANCE_CONTROL_COMBINATION_STATUS;
  readonly parameters: Readonly<OwnerTopazEnhanceParameterValues>;
}

export interface OwnerTopazEnhanceOwnedRequestPreparerOptions {
  readonly originalReferenceService: OwnerTopazEnhanceOriginalReferenceService;
  readonly now?: () => number;
}
export interface PrepareOwnerTopazEnhanceOwnedRequestInput {
  readonly attemptId: string;
  readonly topaz_original_handle: string;
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly parameters: OwnerTopazEnhanceParameterValues;
}

interface CandidateState {
  readonly candidate: OwnerTopazEnhanceOwnedPreparedCandidate;
  readonly attemptId: string;
  readonly handle: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly original: OwnerTopazEnhanceOriginalResolution;
  readonly client: SyntxChatHttpClient;
  readonly nativeReference: OwnerTopazEnhanceOriginalUploadContext;
  readonly url: string;
  readonly parameters: Readonly<OwnerTopazEnhanceParameterValues>;
  readonly request: OwnerTopazEnhanceOwnedPreparedRequest;
  readonly binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding>;
  readonly expiresAt: number;
  readonly epoch: number;
  expired: boolean;
}
interface PreparerApi {
  prepare(input: unknown): Promise<OwnerTopazEnhanceOwnedPreparedCandidate>;
  inspectCandidate(candidate: unknown): Readonly<OwnerTopazEnhanceOwnedCandidateBinding> | undefined;
  getPrivateRequest(candidate: unknown): OwnerTopazEnhanceOwnedPreparedRequest;
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerTopazEnhanceOwnedCandidateBinding>>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerTopazEnhanceOwnedRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";
export class OwnerTopazEnhanceOwnedRequestPreparerError extends Error {
  constructor(readonly code: OwnerTopazEnhanceOwnedRequestPreparerErrorCode) {
    super("The owned Topaz Enhance request candidate could not be prepared safely.");
    this.name = "OwnerTopazEnhanceOwnedRequestPreparerError";
  }
}

export class OwnerTopazEnhanceOwnedRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api;
    PREPARERS.add(this);
    Object.freeze(this);
  }
  prepare(input: unknown): Promise<OwnerTopazEnhanceOwnedPreparedCandidate> { return this.#api.prepare(input); }
  inspectCandidate(candidate: unknown): Readonly<OwnerTopazEnhanceOwnedCandidateBinding> | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerTopazEnhanceOwnedPreparedRequest { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown): Promise<Readonly<OwnerTopazEnhanceOwnedCandidateBinding>> { return this.#api.revalidateCandidate(candidate); }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerTopazEnhanceOwnedRequestPreparer.prototype);

export function createOwnerTopazEnhanceOwnedRequestPreparer(optionsInput: OwnerTopazEnhanceOwnedRequestPreparerOptions | unknown): OwnerTopazEnhanceOwnedRequestPreparer {
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
      state.expired = true;
      candidates.delete(state);
      fail("CANDIDATE_EXPIRED");
    }
    const context = Object.freeze({ attempt_id: state.attemptId, topaz_original_handle: state.handle });
    if (!Reflect.apply(ORIGINAL_GUARD, options.originalReferenceService, [state.original, context]) ||
        !sameNativeOriginal(state.client, state.nativeReference, state.original, state.url)) {
      state.expired = true;
      candidates.delete(state);
      fail("CANDIDATE_EXPIRED");
    }
    return state;
  };
  const api: PreparerApi = {
    async prepare(inputInput) {
      if (closed) fail("SERVICE_CLOSED");
      const input = snapshotInput(inputInput);
      let normalized;
      try { normalized = normalizeOwnerTopazEnhanceParameters({ model_id: input.modelId, parameters: input.parameters }); }
      catch (error) { if (error instanceof OwnerTopazEnhanceParametersError) fail("PARAMETERS_INVALID"); throw error; }
      const context = Object.freeze({ attempt_id: input.attemptId, topaz_original_handle: input.handle });
      const epoch = epochs.get(input.attemptId) ?? 0;
      let original: OwnerTopazEnhanceOriginalResolution;
      try { original = await Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [context]); }
      catch (error) { translateReferenceError(error); }
      if (closed || epoch !== (epochs.get(input.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
      assertOriginal(original!, context, input.modelId);
      const captured = capture(options.originalReferenceService, original!, context);
      const current = await resolveAgain(options.originalReferenceService, context);
      if (closed || epoch !== (epochs.get(input.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
      assertSameOriginal(original!, current, context);
      const recaptured = capture(options.originalReferenceService, current, context);
      if (captured.client !== recaptured.client || captured.nativeReference !== recaptured.nativeReference || captured.url !== recaptured.url) fail("REFERENCE_UNAVAILABLE");
      const profile = getOwnerTopazEnhanceSourceProfile(input.modelId);
      if (!profile || original!.profile_schema_hash !== schemaHash(profile) ||
          original!.source_catalog_version !== profile.source_pins.public_catalog_version) fail("REFERENCE_UNAVAILABLE");
      const now = readNow(), expiresAt = Math.min(now + TTL_MS, original!.expires_at);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail("REFERENCE_EXPIRED");
      const wireSettings = projectOwnerTopazEnhanceWireSettings(normalized, {
        width: original!.width, height: original!.height, duration_seconds: original!.duration_seconds
      });
      const request: OwnerTopazEnhanceOwnedPreparedRequest = deepFreeze({
        settings: {
          ...wireSettings,
          file_urls: [{ type: "video" as const, url: captured.url }]
        }
      });
      const sourceBinding = profile.source_pins;
      const intentFingerprint = schemaHash({
        tenant_id: original!.principal.tenant_id,
        subject_id: original!.principal.subject_id,
        model_id: input.modelId,
        profile_schema_hash: original!.profile_schema_hash,
        source_catalog_version: original!.source_catalog_version,
        original_sha256: original!.sha256,
        source_size: original!.size,
        mime_type: original!.mime_type,
        width: original!.width,
        height: original!.height,
        duration_seconds: original!.duration_seconds,
        frame_count: original!.frame_count,
        parameters: normalized.parameters
      });
      const requestFingerprint = schemaHash(request);
      const candidate = makeCandidate({ sourceBinding, profileHash: original!.profile_schema_hash,
        requestFingerprint, intentFingerprint, original: original!, expiresAt });
      const binding: Readonly<OwnerTopazEnhanceOwnedCandidateBinding> = deepFreeze({
        attempt_id: input.attemptId,
        principal: original!.principal,
        original_handle: input.handle,
        model_id: input.modelId,
        profile_schema_hash: original!.profile_schema_hash,
        source_binding: sourceBinding,
        original_sha256: original!.sha256,
        original_size: original!.size,
        mime_type: original!.mime_type,
        width: original!.width,
        height: original!.height,
        duration_seconds: original!.duration_seconds,
        frame_count: original!.frame_count,
        original_epoch: original!.epoch,
        original_expires_at: original!.expires_at,
        expires_at: expiresAt,
        request_fingerprint: requestFingerprint,
        intent_fingerprint: intentFingerprint,
        control_combination_status: OWNER_TOPAZ_ENHANCE_CONTROL_COMBINATION_STATUS,
        parameters: normalized.parameters
      });
      if (candidates.size >= MAX_CANDIDATES) prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      const state: CandidateState = {
        candidate, attemptId: input.attemptId, handle: input.handle, principal: original!.principal, original: original!,
        client: captured.client, nativeReference: captured.nativeReference, url: captured.url,
        parameters: normalized.parameters, request, binding, expiresAt, epoch, expired: false
      };
      CANDIDATES.set(candidate, state);
      candidates.add(state);
      return candidate;
    },
    inspectCandidate(value) { try { return stateFor(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return stateFor(value).request; },
    async revalidateCandidate(value) {
      const state = stateFor(value), context = Object.freeze({ attempt_id: state.attemptId, topaz_original_handle: state.handle });
      const current = await resolveAgain(options.originalReferenceService, context);
      if (closed || state.epoch !== (epochs.get(state.attemptId) ?? 0)) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
      assertSameOriginal(state.original, current, context);
      const captured = capture(options.originalReferenceService, current, context);
      if (captured.client !== state.client || captured.nativeReference !== state.nativeReference || captured.url !== state.url ||
          readNow() >= state.expiresAt || schemaHash(state.request) !== state.candidate.request_fingerprint) {
        state.expired = true;
        fail("REFERENCE_EXPIRED");
      }
      return state.binding;
    },
    async invalidateAttempt(attemptInput) {
      const attempt = readAttempt(attemptInput);
      epochs.set(attempt, (epochs.get(attempt) ?? 0) + 1);
      for (const state of candidates) if (state.attemptId === attempt) { state.expired = true; candidates.delete(state); }
    },
    async close() { closed = true; for (const state of candidates) state.expired = true; candidates.clear(); epochs.clear(); }
  };
  return new OwnerTopazEnhanceOwnedRequestPreparer(PREPARER_KEY, api);

  function prune(): void {
    const now = readNow();
    for (const state of candidates) if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); }
  }
}

export function isOwnerTopazEnhanceOwnedRequestPreparer(value: unknown): value is OwnerTopazEnhanceOwnedRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === OwnerTopazEnhanceOwnedRequestPreparer.prototype &&
    value instanceof OwnerTopazEnhanceOwnedRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}

export function isOwnerTopazEnhanceOwnedPreparedCandidate(value: unknown): value is OwnerTopazEnhanceOwnedPreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  return !!state && state.candidate === value && !state.expired;
}

function readOptions(value: unknown): Readonly<OwnerTopazEnhanceOwnedRequestPreparerOptions> {
  const fields = exact(value, ["originalReferenceService"], ["now"]), service = fields.originalReferenceService;
  if (!(service instanceof OwnerTopazEnhanceOriginalReferenceService) || Object.getPrototypeOf(service) !== OwnerTopazEnhanceOriginalReferenceService.prototype ||
      Object.getOwnPropertyDescriptor(OwnerTopazEnhanceOriginalReferenceService.prototype, "resolveOriginal")?.value !== ORIGINAL_RESOLVE ||
      Object.getOwnPropertyDescriptor(OwnerTopazEnhanceOriginalReferenceService.prototype, "isOwnedOriginalResolution")?.value !== ORIGINAL_GUARD ||
      Object.getOwnPropertyDescriptor(OwnerTopazEnhanceOriginalReferenceService.prototype, "withCapturedNativeOriginal")?.value !== ORIGINAL_CAPTURE ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ originalReferenceService: service, ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}

function snapshotInput(value: unknown): Readonly<{ attemptId: string; handle: string; modelId: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID; parameters: unknown }> {
  const fields = exact(value, ["attemptId", "topaz_original_handle", "model_id", "parameters"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.topaz_original_handle !== "string" ||
      !HANDLE.test(fields.topaz_original_handle) || fields.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, handle: fields.topaz_original_handle, modelId: OWNER_TOPAZ_ENHANCE_MODEL_ID, parameters: fields.parameters });
}

function assertOriginal(original: OwnerTopazEnhanceOriginalResolution,
  context: Readonly<{ attempt_id: string; topaz_original_handle: string }>, modelId: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID): void {
  const profile = getOwnerTopazEnhanceSourceProfile(modelId);
  if (!profile || original.role !== "topaz_enhance_original" || original.wire_type !== "video" || original.attempt_id !== context.attempt_id ||
      original.topaz_original_handle !== context.topaz_original_handle || original.model_id !== modelId || original.ai_name !== "topaz_ai" ||
      original.source_catalog_version !== profile.source_pins.public_catalog_version || original.generation_permit !== false ||
      original.principal.connection_id !== context.attempt_id || !/^[a-f0-9]{64}$/u.test(original.sha256) ||
      original.mime_type !== "video/mp4" || !isPositiveSafeInteger(original.size) || !isPositiveSafeInteger(original.width) ||
      !isPositiveSafeInteger(original.height) || !isPositiveSafeInteger(original.frame_count) ||
      !Number.isFinite(original.duration_seconds) || original.duration_seconds < 2 || original.duration_seconds > 26.25 ||
      !Number.isSafeInteger(original.epoch) || original.epoch < 0 || !Number.isSafeInteger(original.expires_at) || original.expires_at < 1 ||
      original.profile_schema_hash !== schemaHash(profile)) fail("REFERENCE_UNAVAILABLE");
  try { snapshotGenerationPrincipal(original.principal); } catch { fail("PRINCIPAL_MISMATCH"); }
}

function assertSameOriginal(a: OwnerTopazEnhanceOriginalResolution, b: OwnerTopazEnhanceOriginalResolution,
  context: Readonly<{ attempt_id: string; topaz_original_handle: string }>): void {
  assertOriginal(b, context, OWNER_TOPAZ_ENHANCE_MODEL_ID);
  if (!sameGenerationPrincipal(a.principal, b.principal) || a.role !== b.role || a.wire_type !== b.wire_type || a.attempt_id !== b.attempt_id ||
      a.model_id !== b.model_id || a.ai_name !== b.ai_name || a.source_catalog_version !== b.source_catalog_version ||
      a.profile_schema_hash !== b.profile_schema_hash || a.topaz_original_handle !== b.topaz_original_handle || a.sha256 !== b.sha256 ||
      a.mime_type !== b.mime_type || a.size !== b.size || a.width !== b.width || a.height !== b.height ||
      a.duration_seconds !== b.duration_seconds || a.frame_count !== b.frame_count || a.destination !== b.destination ||
      a.expires_at !== b.expires_at || a.epoch !== b.epoch || a.generation_permit !== b.generation_permit) fail("REFERENCE_EXPIRED");
}

function capture(service: OwnerTopazEnhanceOriginalReferenceService, original: OwnerTopazEnhanceOriginalResolution,
  context: Readonly<{ attempt_id: string; topaz_original_handle: string }>): Readonly<{
    client: SyntxChatHttpClient; nativeReference: OwnerTopazEnhanceOriginalUploadContext; url: string;
  }> {
  try {
    return Reflect.apply(ORIGINAL_CAPTURE, service, [original, context,
      (client: SyntxChatHttpClient, nativeReference: OwnerTopazEnhanceOriginalUploadContext) => {
        if (!client || typeof client !== "object" || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype) fail("REFERENCE_UNAVAILABLE");
        const witness = readOwnerTopazEnhanceOriginalUploadForClient(client, nativeReference);
        if (!witness || witness.model_id !== original.model_id || witness.ai_name !== original.ai_name ||
            witness.source_catalog_version !== original.source_catalog_version || witness.destination !== original.destination ||
            witness.source_sha256 !== original.sha256 || witness.source_size !== original.size || witness.source_mime_type !== original.mime_type ||
            witness.width !== original.width || witness.height !== original.height || witness.duration_seconds !== original.duration_seconds ||
            witness.frame_count !== original.frame_count || !isSafeUploadReferenceUrl(witness.url)) fail("REFERENCE_UNAVAILABLE");
        return Object.freeze({ client, nativeReference, url: witness.url });
      }]) as Readonly<{ client: SyntxChatHttpClient; nativeReference: OwnerTopazEnhanceOriginalUploadContext; url: string }>;
  } catch (error) { translateReferenceError(error); }
}

async function resolveAgain(service: OwnerTopazEnhanceOriginalReferenceService,
  context: Readonly<{ attempt_id: string; topaz_original_handle: string }>): Promise<OwnerTopazEnhanceOriginalResolution> {
  try { return await Reflect.apply(ORIGINAL_RESOLVE, service, [context]); }
  catch (error) { translateReferenceError(error); }
}

function sameNativeOriginal(client: SyntxChatHttpClient, nativeReference: OwnerTopazEnhanceOriginalUploadContext,
  original: OwnerTopazEnhanceOriginalResolution, url: string): boolean {
  const witness = readOwnerTopazEnhanceOriginalUploadForClient(client, nativeReference);
  return !!witness && witness.model_id === original.model_id && witness.source_sha256 === original.sha256 &&
    witness.ai_name === original.ai_name && witness.source_catalog_version === original.source_catalog_version &&
    witness.source_size === original.size && witness.source_mime_type === original.mime_type && witness.width === original.width &&
    witness.height === original.height && witness.duration_seconds === original.duration_seconds && witness.frame_count === original.frame_count &&
    witness.destination === original.destination && witness.url === url && isSafeUploadReferenceUrl(witness.url);
}

function makeCandidate(input: {
  sourceBinding: OwnerTopazEnhanceSourceProfile["source_pins"];
  profileHash: string;
  requestFingerprint: string;
  intentFingerprint: string;
  original: OwnerTopazEnhanceOriginalResolution;
  expiresAt: number;
}): OwnerTopazEnhanceOwnedPreparedCandidate {
  const candidate = Object.create(null) as OwnerTopazEnhanceOwnedPreparedCandidate;
  Object.defineProperties(candidate, {
    status: { value: "blocked", enumerable: true },
    dispatch_allowed: { value: false, enumerable: true },
    runtime_usable: { value: false, enumerable: true },
    backend_acceptance: { value: "UNPROVEN", enumerable: true },
    model_id: { value: OWNER_TOPAZ_ENHANCE_MODEL_ID, enumerable: true },
    profile_schema_hash: { value: input.profileHash, enumerable: true },
    source_binding: { value: input.sourceBinding, enumerable: true },
    control_combination_status: { value: OWNER_TOPAZ_ENHANCE_CONTROL_COMBINATION_STATUS, enumerable: true },
    request_fingerprint: { value: input.requestFingerprint, enumerable: true },
    intent_fingerprint: { value: input.intentFingerprint, enumerable: true },
    original: { value: Object.freeze({ mime_type: input.original.mime_type, size: input.original.size, sha256: input.original.sha256,
      width: input.original.width, height: input.original.height, duration_seconds: input.original.duration_seconds, frame_count: input.original.frame_count }), enumerable: true },
    expires_at: { value: input.expiresAt, enumerable: true }
  });
  return Object.freeze(candidate);
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  const allowed = new Set([...required, ...optional]);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isPositiveSafeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function readAttempt(value: string): string { if (!ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => {
    let now: unknown;
    try { now = Reflect.apply(value, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) fail("CLOCK_INVALID");
    return now;
  };
}
function translateReferenceError(error: unknown): never {
  if (error instanceof OwnerTopazEnhanceOwnedRequestPreparerError) throw error;
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
    if (error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_MISMATCH");
  }
  if (error instanceof OwnerTopazEnhanceParametersError) fail("PARAMETERS_INVALID");
  fail("REFERENCE_UNAVAILABLE");
}
function fail(code: OwnerTopazEnhanceOwnedRequestPreparerErrorCode): never { throw new OwnerTopazEnhanceOwnedRequestPreparerError(code); }
