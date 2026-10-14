import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { SyntxChatHttpClient, readOwnerTopazAstraOriginalUploadForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerTopazAstraOriginalUploadContext } from "../adapter/syntx/topaz-astra-original-upload.js";
import { OwnerTopazAstraOriginalReferenceService, type OwnerTopazAstraOriginalResolution } from "./owner-topaz-astra-original-reference-service.js";
import { normalizeOwnerTopazAstraParameters, type OwnerTopazAstraParameters } from "./owner-topaz-astra-parameters.js";
import { getOwnerTopazAstraSourceProfile, type OwnerTopazAstraModelId } from "./owner-topaz-astra-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^topaz_astra_original_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const PREPARER_KEY = Symbol("OwnerTopazAstraOwnedRequestPreparerFactory");
const ORIGINAL_RESOLVE = OwnerTopazAstraOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_GUARD = OwnerTopazAstraOriginalReferenceService.prototype.isOwnedOriginalResolution;
const ORIGINAL_CAPTURE = OwnerTopazAstraOriginalReferenceService.prototype.withCapturedNativeOriginal;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();

export interface OwnerTopazAstraOwnedPreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: OwnerTopazAstraModelId;
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<{ public_catalog_version: string; settings_inventory_version: string; source_build_id: "1791904852" }>;
  readonly control_combination_status: "UNRESOLVED" | "SOURCE_REVIEWED_EXACT";
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly prompt_utf16_length: number;
  readonly original: Readonly<{ mime_type: "video/mp4" | "video/quicktime"; size: number; sha256: string; duration_seconds: number; decoded_frame_count: number }>;
  readonly expires_at: number;
}

export interface OwnerTopazAstraOwnedPreparedRequest {
  readonly prompt?: string;
  readonly settings: Readonly<{
    n: 1; model_type: OwnerTopazAstraModelId; resolution: string; frame_rate: number; slowmo: number | null;
    creativity?: string; video_duration: number; file_urls: readonly Readonly<{ type: "video"; url: string }>[];
  }>;
}

export interface OwnerTopazAstraOwnedCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly original_handle: string;
  readonly model_id: OwnerTopazAstraModelId;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerTopazAstraOwnedPreparedCandidate["source_binding"];
  readonly original_sha256: string;
  readonly original_size: number;
  readonly duration_seconds: number;
  readonly decoded_frame_count: number;
  readonly original_epoch: number;
  readonly original_expires_at: number;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly parameters: Readonly<{ resolution: string; frame_rate: number; slowmo: number | null; creativity?: string }>;
}

export interface OwnerTopazAstraOwnedRequestPreparerOptions {
  readonly originalReferenceService: OwnerTopazAstraOriginalReferenceService;
  readonly now?: () => number;
}
export interface PrepareOwnerTopazAstraOwnedRequestInput {
  readonly attemptId: string;
  readonly topaz_original_handle: string;
  readonly model_id: OwnerTopazAstraModelId;
  readonly prompt?: string;
  readonly parameters: OwnerTopazAstraParameters["parameters"];
}

interface CandidateState {
  readonly candidate: OwnerTopazAstraOwnedPreparedCandidate;
  readonly attemptId: string;
  readonly handle: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly original: OwnerTopazAstraOriginalResolution;
  readonly client: SyntxChatHttpClient;
  readonly reference: OwnerTopazAstraOriginalUploadContext;
  readonly parameters: OwnerTopazAstraParameters;
  readonly request: OwnerTopazAstraOwnedPreparedRequest;
  readonly binding: OwnerTopazAstraOwnedCandidateBinding;
  readonly expiresAt: number;
  readonly epoch: number;
  expired: boolean;
}
interface PreparerApi {
  prepare(input: unknown): Promise<OwnerTopazAstraOwnedPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerTopazAstraOwnedCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerTopazAstraOwnedPreparedRequest;
  revalidateCandidate(candidate: unknown): Promise<OwnerTopazAstraOwnedCandidateBinding>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerTopazAstraOwnedRequestPreparerErrorCode = "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" |
  "REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" |
  "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";
export class OwnerTopazAstraOwnedRequestPreparerError extends Error {
  constructor(readonly code: OwnerTopazAstraOwnedRequestPreparerErrorCode) {
    super("The owned Topaz Astra request candidate could not be prepared safely.");
    this.name = "OwnerTopazAstraOwnedRequestPreparerError";
  }
}

/** A nominal, owner-bound candidate only; unresolved source combinations keep dispatch closed. */
export class OwnerTopazAstraOwnedRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api; PREPARERS.add(this); Object.freeze(this);
  }
  prepare(input: unknown): Promise<OwnerTopazAstraOwnedPreparedCandidate> { return this.#api.prepare(input); }
  inspectCandidate(candidate: unknown): OwnerTopazAstraOwnedCandidateBinding | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerTopazAstraOwnedPreparedRequest { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown): Promise<OwnerTopazAstraOwnedCandidateBinding> { return this.#api.revalidateCandidate(candidate); }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerTopazAstraOwnedRequestPreparer.prototype);

export function createOwnerTopazAstraOwnedRequestPreparer(optionsInput: OwnerTopazAstraOwnedRequestPreparerOptions | unknown): OwnerTopazAstraOwnedRequestPreparer {
  const options = readOptions(optionsInput), candidates = new Set<CandidateState>(), epochs = new Map<string, number>();
  const clock = options.now === undefined ? Date.now : readClock(options.now);
  let lastNow = clock(), closed = false;
  const readNow = (): number => { const value = clock(); if (value < lastNow) fail("CLOCK_INVALID"); lastNow = value; return value; };
  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object), now = readNow();
    if (!state || state.candidate !== value || state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || now >= state.expiresAt) {
      if (state) { state.expired = true; candidates.delete(state); }
      fail("CANDIDATE_EXPIRED");
    }
    const context = Object.freeze({ attempt_id: state.attemptId, topaz_original_handle: state.handle });
    if (!Reflect.apply(ORIGINAL_GUARD, options.originalReferenceService, [state.original, context]) ||
        !isSameNativeReference(state.client, state.reference, state.original)) {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
    return state;
  };
  const api: PreparerApi = {
    async prepare(inputInput) {
      if (closed) fail("SERVICE_CLOSED");
      const input = snapshotInput(inputInput), normalized = normalizeOwnerTopazAstraParameters({ model_id: input.modelId, prompt: input.prompt ?? "", parameters: input.controls });
      const context = Object.freeze({ attempt_id: input.attemptId, topaz_original_handle: input.handle });
      const epoch = epochs.get(input.attemptId) ?? 0;
      let original: OwnerTopazAstraOriginalResolution;
      try { original = await Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [context]); }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED"); fail("REFERENCE_UNAVAILABLE"); }
      if (closed || epoch !== (epochs.get(input.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
      assertOriginal(original!, context, input.modelId);
      const captured = Reflect.apply(ORIGINAL_CAPTURE, options.originalReferenceService, [original!, context,
        (client: SyntxChatHttpClient, reference: OwnerTopazAstraOriginalUploadContext) => {
          if (!(client instanceof SyntxChatHttpClient)) fail("REFERENCE_UNAVAILABLE");
          const details = readOwnerTopazAstraOriginalUploadForClient(client, reference);
          if (!details || details.model_id !== input.modelId || details.source_sha256 !== original!.sha256 ||
              details.source_size !== original!.size || details.source_mime_type !== original!.mime_type ||
              details.duration_seconds !== original!.duration_seconds || details.decoded_frame_count !== original!.decoded_frame_count ||
              !isSafeUploadReferenceUrl(details.url)) fail("REFERENCE_UNAVAILABLE");
          return Object.freeze({ client, reference, url: details.url });
        }]) as Readonly<{ client: SyntxChatHttpClient; reference: OwnerTopazAstraOriginalUploadContext; url: string }>;
      const profile = getOwnerTopazAstraSourceProfile(input.modelId);
      if (!profile || original!.profile_schema_hash !== schemaHash(profile) || original!.duration_seconds <= 0 ||
          original!.duration_seconds > profile.input.max_video_duration_seconds || original!.decoded_frame_count > profile.input.max_frame_count) fail("REFERENCE_UNAVAILABLE");
      const issuedAt = readNow(), expiresAt = Math.min(issuedAt + TTL_MS, original!.expires_at);
      if (expiresAt <= issuedAt) fail("REFERENCE_EXPIRED");
      const supportsCreativity = input.modelId === "slc-1" || input.modelId === "slp-2.5";
      const effectiveParameters = Object.freeze({ resolution: normalized.parameters.resolution, frame_rate: normalized.parameters.frame_rate,
        slowmo: normalized.parameters.slowmo, ...(supportsCreativity ? { creativity: normalized.parameters.creativity } : {}) });
      const settings = Object.freeze({ n: 1 as const, model_type: input.modelId, resolution: normalized.parameters.resolution,
        frame_rate: normalized.parameters.frame_rate, slowmo: normalized.parameters.slowmo,
        ...(supportsCreativity ? { creativity: normalized.parameters.creativity } : {}),
        video_duration: Math.round(original!.duration_seconds), file_urls: Object.freeze([Object.freeze({ type: "video" as const, url: captured.url })]) });
      const request: OwnerTopazAstraOwnedPreparedRequest = deepFreeze({ ...(normalized.prompt ? { prompt: normalized.prompt } : {}), settings });
      const profileHash = schemaHash(profile);
      const sourceBinding = Object.freeze({ public_catalog_version: profile.source_pins.public_catalog_version,
        settings_inventory_version: profile.source_pins.settings_inventory_version, source_build_id: profile.source_pins.source_build_id });
      const intentFingerprint = schemaHash({ tenant_id: original!.principal.tenant_id, subject_id: original!.principal.subject_id,
        model_id: input.modelId, profile_schema_hash: profileHash, source_sha256: original!.sha256,
        prompt: normalized.prompt, parameters: effectiveParameters });
      const requestFingerprint = schemaHash(request);
      const candidate = makeCandidate({ modelId: input.modelId, profileHash, sourceBinding, intentFingerprint, requestFingerprint,
        promptLength: normalized.prompt.length, original: original!, expiresAt, controlCombinationStatus: "UNRESOLVED" });
      const binding = deepFreeze({ attempt_id: input.attemptId, principal: original!.principal, original_handle: input.handle,
        model_id: input.modelId, profile_schema_hash: profileHash, source_binding: sourceBinding,
        original_sha256: original!.sha256, original_size: original!.size, duration_seconds: original!.duration_seconds,
        decoded_frame_count: original!.decoded_frame_count, original_epoch: original!.epoch, original_expires_at: original!.expires_at,
        expires_at: expiresAt, request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint, parameters: effectiveParameters });
      const state: CandidateState = { candidate, attemptId: input.attemptId, handle: input.handle, principal: original!.principal,
        original: original!, client: captured.client, reference: captured.reference, parameters: normalized, request, binding,
        expiresAt, epoch, expired: false };
      if (candidates.size >= MAX_CANDIDATES) prune();
      if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
      CANDIDATES.set(candidate, state); candidates.add(state); return candidate;
    },
    inspectCandidate(value) { try { return stateFor(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return stateFor(value).request; },
    async revalidateCandidate(value) {
      const state = stateFor(value), context = Object.freeze({ attempt_id: state.attemptId, topaz_original_handle: state.handle });
      let current: OwnerTopazAstraOriginalResolution;
      try { current = await Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [context]); }
      catch { state.expired = true; fail("REFERENCE_UNAVAILABLE"); }
      if (closed || state.epoch !== (epochs.get(state.attemptId) ?? 0)) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
      if (!sameGenerationPrincipal(current!.principal, state.principal) || current!.sha256 !== state.original.sha256 ||
          current!.size !== state.original.size || current!.mime_type !== state.original.mime_type || current!.duration_seconds !== state.original.duration_seconds ||
          current!.decoded_frame_count !== state.original.decoded_frame_count || current!.epoch !== state.original.epoch ||
          current!.expires_at !== state.original.expires_at || current!.profile_schema_hash !== state.original.profile_schema_hash ||
          readNow() >= state.expiresAt) { state.expired = true; fail("REFERENCE_EXPIRED"); }
      const confirmed = Reflect.apply(ORIGINAL_CAPTURE, options.originalReferenceService, [current!, context,
        (client: SyntxChatHttpClient, reference: OwnerTopazAstraOriginalUploadContext) => ({ client, reference })]) as Readonly<{ client: SyntxChatHttpClient; reference: OwnerTopazAstraOriginalUploadContext }>;
      if (confirmed.client !== state.client || confirmed.reference !== state.reference || !isSameNativeReference(state.client, state.reference, current!)) {
        state.expired = true; fail("REFERENCE_UNAVAILABLE");
      }
      return state.binding;
    },
    async invalidateAttempt(attemptInput) {
      const attempt = readAttempt(attemptInput); epochs.set(attempt, (epochs.get(attempt) ?? 0) + 1);
      for (const state of candidates) if (state.attemptId === attempt) { state.expired = true; candidates.delete(state); }
    },
    async close() { closed = true; for (const state of candidates) state.expired = true; candidates.clear(); epochs.clear(); }
  };
  return new OwnerTopazAstraOwnedRequestPreparer(PREPARER_KEY, api);

  function prune(): void { const now = readNow(); for (const state of candidates) if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); } }
}

export function isOwnerTopazAstraOwnedRequestPreparer(value: unknown): value is OwnerTopazAstraOwnedRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerTopazAstraOwnedRequestPreparer.prototype &&
    value instanceof OwnerTopazAstraOwnedRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}
export function isOwnerTopazAstraOwnedPreparedCandidate(value: unknown): value is OwnerTopazAstraOwnedPreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object); return !!state && state.candidate === value && !state.expired;
}

function readOptions(value: unknown): Readonly<OwnerTopazAstraOwnedRequestPreparerOptions> {
  const fields = exact(value, ["originalReferenceService"], ["now"]), service = fields.originalReferenceService;
  if (!(service instanceof OwnerTopazAstraOriginalReferenceService) || Object.getPrototypeOf(service) !== OwnerTopazAstraOriginalReferenceService.prototype ||
      Object.getOwnPropertyDescriptor(OwnerTopazAstraOriginalReferenceService.prototype, "resolveOriginal")?.value !== ORIGINAL_RESOLVE ||
      Object.getOwnPropertyDescriptor(OwnerTopazAstraOriginalReferenceService.prototype, "isOwnedOriginalResolution")?.value !== ORIGINAL_GUARD ||
      Object.getOwnPropertyDescriptor(OwnerTopazAstraOriginalReferenceService.prototype, "withCapturedNativeOriginal")?.value !== ORIGINAL_CAPTURE ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ originalReferenceService: service, ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}
function snapshotInput(value: unknown): Readonly<{ attemptId: string; handle: string; modelId: OwnerTopazAstraModelId; prompt?: string; controls: unknown }> {
  const fields = exact(value, ["attemptId", "topaz_original_handle", "model_id", "parameters"], ["prompt"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.topaz_original_handle !== "string" ||
      !HANDLE.test(fields.topaz_original_handle) || typeof fields.model_id !== "string" || !getOwnerTopazAstraSourceProfile(fields.model_id) ||
      (fields.prompt !== undefined && typeof fields.prompt !== "string")) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, handle: fields.topaz_original_handle,
    modelId: fields.model_id as OwnerTopazAstraModelId, ...(fields.prompt === undefined ? {} : { prompt: fields.prompt }), controls: fields.parameters });
}
function assertOriginal(original: OwnerTopazAstraOriginalResolution, context: Readonly<{ attempt_id: string; topaz_original_handle: string }>, modelId: OwnerTopazAstraModelId): void {
  const profile = getOwnerTopazAstraSourceProfile(modelId);
  if (original.role !== "topaz_astra_original" || original.wire_type !== "video" || original.attempt_id !== context.attempt_id ||
      original.topaz_original_handle !== context.topaz_original_handle || original.model_id !== modelId || original.generation_permit !== false ||
      original.principal.connection_id !== context.attempt_id || !/^[a-f0-9]{64}$/u.test(original.sha256) ||
      !Number.isSafeInteger(original.size) || original.size < 1 || !Number.isSafeInteger(original.epoch) || !Number.isSafeInteger(original.expires_at) ||
      !profile || original.profile_schema_hash !== schemaHash(profile) || !Number.isFinite(original.duration_seconds) || original.duration_seconds <= 0 ||
      !Number.isSafeInteger(original.decoded_frame_count) || original.decoded_frame_count < 1) fail("REFERENCE_UNAVAILABLE");
}
function isSameNativeReference(client: SyntxChatHttpClient, reference: OwnerTopazAstraOriginalUploadContext, original: OwnerTopazAstraOriginalResolution): boolean {
  const details = readOwnerTopazAstraOriginalUploadForClient(client, reference);
  return !!details && details.model_id === original.model_id && details.source_sha256 === original.sha256 && details.source_size === original.size &&
    details.source_mime_type === original.mime_type && details.duration_seconds === original.duration_seconds &&
    details.decoded_frame_count === original.decoded_frame_count && isSafeUploadReferenceUrl(details.url);
}
function makeCandidate(input: { modelId: OwnerTopazAstraModelId; profileHash: string; sourceBinding: OwnerTopazAstraOwnedPreparedCandidate["source_binding"];
  intentFingerprint: string; requestFingerprint: string; promptLength: number; original: OwnerTopazAstraOriginalResolution; expiresAt: number;
  controlCombinationStatus: OwnerTopazAstraOwnedPreparedCandidate["control_combination_status"] }): OwnerTopazAstraOwnedPreparedCandidate {
  const candidate = Object.create(null) as OwnerTopazAstraOwnedPreparedCandidate;
  Object.defineProperties(candidate, { status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
    runtime_usable: { value: false, enumerable: true }, backend_acceptance: { value: "UNPROVEN", enumerable: true }, model_id: { value: input.modelId, enumerable: true },
    profile_schema_hash: { value: input.profileHash, enumerable: true }, source_binding: { value: input.sourceBinding, enumerable: true },
    control_combination_status: { value: input.controlCombinationStatus, enumerable: true }, request_fingerprint: { value: input.requestFingerprint, enumerable: true },
    intent_fingerprint: { value: input.intentFingerprint, enumerable: true }, prompt_utf16_length: { value: input.promptLength, enumerable: true },
    original: { value: Object.freeze({ mime_type: input.original.mime_type, size: input.original.size, sha256: input.original.sha256,
      duration_seconds: input.original.duration_seconds, decoded_frame_count: input.original.decoded_frame_count }), enumerable: true },
    expires_at: { value: input.expiresAt, enumerable: true } });
  return Object.freeze(candidate);
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors), allowed = new Set([...required, ...optional]);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) result[key] = descriptors[key]!.value; return result;
}
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]); return Object.freeze(value); }
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function readClock(value: unknown): () => number { if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST"); return () => {
  const now = Reflect.apply(value, undefined, []); if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) fail("CLOCK_INVALID"); return now; }; }
function fail(code: OwnerTopazAstraOwnedRequestPreparerErrorCode): never { throw new OwnerTopazAstraOwnedRequestPreparerError(code); }
