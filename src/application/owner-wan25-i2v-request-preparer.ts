import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readOwnerWan25I2vUploadReferenceForClient } from "../adapter/syntx/wan25-i2v-upload-context.js";
import { isOwnerWan25I2vReferenceService, OwnerWan25I2vReferenceService, OwnerWan25I2vReferenceServiceError,
  type OwnerWan25I2vNativeReferenceTuple, type OwnerWan25I2vReferenceResolution, type OwnerWan25I2vReferenceResolveInput } from "./owner-wan25-i2v-reference-service.js";
import { getOwnerWan25I2vGenerationParametersSource, normalizeOwnerWan25I2vGenerationParameters,
  type OwnerWan25I2vGenerationParametersNormalized } from "./owner-wan25-i2v-generation-parameters.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^[A-Za-z0-9_-]{1,160}$/u;
const TTL_MS = 15 * 60_000;
const CANDIDATES = new WeakMap<object, CandidateState>();
const PREPARERS = new WeakSet<object>();
const NATIVE_BINDINGS = new WeakMap<object, CandidateState>();

export type OwnerWan25I2vPreparedInputReference = Readonly<{ media_type: "image"; mime_type: string; size: number; sha256: string; width: number; height: number }>;
export interface OwnerWan25I2vPreparedCandidate {
  readonly status: "prepared"; readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT";
  readonly dispatch_allowed: false; readonly runtime_usable: false; readonly backend_acceptance: "UNPROVEN";
  readonly model_id: typeof MODEL_ID; readonly profile_schema_hash: string;
  readonly source_pins: ReturnType<typeof getOwnerWan25I2vGenerationParametersSource>["source_pins"];
  readonly intent_fingerprint: string; readonly request_fingerprint: string; readonly prompt_utf16_length: number;
  readonly image_reference_count: 1; readonly audio_reference_count: 0; readonly input_references: readonly OwnerWan25I2vPreparedInputReference[];
  readonly native_audio_status: "UNPROVEN_NOT_ENABLED"; readonly audio_gap: "OPTIONAL_AUDIO_UI_NOT_JOINED_TO_NATIVE_CONTEXT"; readonly expires_at: number;
}
export interface OwnerWan25I2vPreparedRequest {
  readonly prompt: string; readonly settings: Readonly<{ model_type: typeof MODEL_ID; resolution: string; aspect_ratio: string;
    video_duration: 5 | 10; prompt_extend: boolean; seed: number | null; native_audio: false; shot_type: "single";
    audio_setting: "auto"; file_urls: readonly Readonly<{ type: "image"; url: string }>[] }>;
}
export interface OwnerWan25I2vPreparedCandidateBinding {
  readonly candidate: OwnerWan25I2vPreparedCandidate; readonly attempt_id: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: typeof MODEL_ID; readonly reference_epoch: number; readonly profile_schema_hash: string;
  readonly intent_fingerprint: string; readonly request_fingerprint: string; readonly wire_fingerprint: string; readonly expires_at: number;
  readonly audio_reference_count: 0; readonly runtime_usable: false; readonly dispatch_allowed: false;
}
export interface OwnerWan25I2vNativeBindingToken {
  readonly status: "captured"; readonly dispatch_allowed: false; readonly model_id: typeof MODEL_ID;
  readonly profile_schema_hash: string; readonly intent_fingerprint: string; readonly request_fingerprint: string; readonly expires_at: number;
}
export interface OwnerWan25I2vPrepareInput { readonly attempt_id: string; readonly model_id: typeof MODEL_ID; readonly image_handle: string;
  readonly audio_handle: null; readonly prompt: string; readonly parameters: Readonly<{ resolution: string; aspect_ratio: string;
    video_duration: number; prompt_extend: boolean; seed: number | null }> }
export interface OwnerWan25I2vRequestPreparer {
  prepare(input: unknown, signal?: AbortSignal): Promise<OwnerWan25I2vPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerWan25I2vPreparedCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerWan25I2vPreparedRequest;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerWan25I2vPreparedCandidateBinding>;
  getNativeBindingForClient(client: unknown, candidate: unknown): OwnerWan25I2vNativeBindingToken;
  invalidateAttempt(attemptId: string): Promise<void>; close(): Promise<void>;
}
export interface OwnerWan25I2vRequestPreparerOptions { readonly referenceService: OwnerWan25I2vReferenceService; readonly now?: () => number }
export type OwnerWan25I2vRequestPreparerErrorCode = "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REQUEST_ABORTED" |
  "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "CANDIDATE_UNBOUND" |
  "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";
export class OwnerWan25I2vRequestPreparerError extends Error {
  constructor(readonly code: OwnerWan25I2vRequestPreparerErrorCode) { super("The owner WAN 2.5 I2V preview request could not be prepared safely."); this.name = "OwnerWan25I2vRequestPreparerError"; }
}
interface Captured { readonly client: SyntxChatHttpClient; readonly contexts: OwnerWan25I2vNativeReferenceTuple; readonly url: string }
interface CandidateState { readonly api: OwnerWan25I2vRequestPreparer; readonly candidate: OwnerWan25I2vPreparedCandidate;
  readonly input: Readonly<OwnerWan25I2vPrepareInput>; readonly resolveInput: Readonly<OwnerWan25I2vReferenceResolveInput>;
  readonly resolution: OwnerWan25I2vReferenceResolution; readonly normalized: OwnerWan25I2vGenerationParametersNormalized;
  readonly captured: Captured; readonly request: OwnerWan25I2vPreparedRequest; readonly binding: OwnerWan25I2vPreparedCandidateBinding;
  readonly expiresAt: number; expired: boolean; token?: OwnerWan25I2vNativeBindingToken }

/** Builds a local-only request candidate from source-pinned explicit settings and a genuine native upload context. */
export function createOwnerWan25I2vRequestPreparer(optionsInput: OwnerWan25I2vRequestPreparerOptions | unknown): OwnerWan25I2vRequestPreparer {
  const opts = exactRecord(optionsInput, ["referenceService"], ["now"]);
  if (!isOwnerWan25I2vReferenceService(opts.referenceService) || (opts.now !== undefined && (typeof opts.now !== "function" || types.isProxy(opts.now)))) fail("SERVICE_BINDING_MISMATCH");
  const service = opts.referenceService as OwnerWan25I2vReferenceService;
  const clock = opts.now === undefined ? () => performance.now() : opts.now as () => number;
  const source = getOwnerWan25I2vGenerationParametersSource(), profileHash = schemaHash(source);
  const candidates = new Set<CandidateState>(); let closed = false; let lastNow = -1;
  const now = (): number => { let value: unknown; try { value = Reflect.apply(clock, undefined, []); } catch { return fail("CLOCK_INVALID"); }
    if (typeof value !== "number" || !Number.isFinite(value) || value < lastNow || value > Number.MAX_SAFE_INTEGER) fail("CLOCK_INVALID"); lastNow = value; return value; };
  const live = (state: CandidateState): boolean => !closed && !state.expired && CANDIDATES.get(state.candidate) === state &&
    now() < state.expiresAt && service.isOwnedReferenceResolution(state.resolution, state.resolveInput);
  const pruneCandidates = (): void => { for (const state of candidates) if (!live(state)) expire(state); };
  const stateFor = (value: unknown): CandidateState => { if (closed) fail("SERVICE_CLOSED"); if (!value || typeof value !== "object" || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object); if (!state || state.candidate !== value || state.api !== api) fail("CANDIDATE_UNBOUND");
    if (!live(state)) { expire(state); fail("CANDIDATE_EXPIRED"); } return state; };
  const resolveAndCapture = async (resolveInput: Readonly<OwnerWan25I2vReferenceResolveInput>, resolution?: OwnerWan25I2vReferenceResolution, signal?: AbortSignal): Promise<{resolution: OwnerWan25I2vReferenceResolution; captured: Captured}> => {
    try {
      const current = resolution ?? await service.resolveReferences(resolveInput, signal);
      if (!service.isOwnedReferenceResolution(current, resolveInput)) fail("REFERENCE_UNAVAILABLE");
      const captured = await service.withCapturedNativeReferences(current, resolveInput, (client, contexts) => {
        if (!Array.isArray(contexts) || contexts.length !== 1) fail("REFERENCE_UNAVAILABLE");
        const ref = readOwnerWan25I2vUploadReferenceForClient(client, contexts[0]);
        if (!ref || !isSafeReference(ref.url)) fail("REFERENCE_UNAVAILABLE");
        return Object.freeze({ client, contexts, url: ref.url });
      }, signal);
      return { resolution: current, captured };
    } catch (error) { if (error instanceof OwnerWan25I2vRequestPreparerError) throw error; if (error instanceof OwnerWan25I2vReferenceServiceError) mapReferenceError(error); fail("REFERENCE_UNAVAILABLE"); }
  };
  const prepare: OwnerWan25I2vRequestPreparer["prepare"] = async (inputValue, signal) => {
    if (closed) fail("SERVICE_CLOSED"); if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
    if (signal?.aborted) fail("REQUEST_ABORTED"); const input = snapshotInput(inputValue);
    try {
      const normalized = normalizeOwnerWan25I2vGenerationParameters({ model_id: input.model_id, prompt: input.prompt, parameters: input.parameters });
      const refInput = Object.freeze({ attempt_id: input.attempt_id, model_id: MODEL_ID, image_handle: input.image_handle, audio_handle: null });
      const { resolution, captured } = await resolveAndCapture(refInput, undefined, signal);
      if (signal?.aborted) fail("REQUEST_ABORTED");
      const request = buildRequest(normalized, captured.url), requestFingerprint = schemaHash(request);
      const intentFingerprint = schemaHash({ source: source.source_pins, normalized: normalized.intent, principal: resolution.principal,
        attempt_id: input.attempt_id, references: safeMetadata(resolution) });
      const expiresAt = Math.min(now() + TTL_MS, resolution.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) fail("REFERENCE_EXPIRED");
      pruneCandidates();
      if (candidates.size >= 128) fail("CAPACITY_EXCEEDED");
      const candidate: OwnerWan25I2vPreparedCandidate = Object.freeze({ status: "prepared", source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT",
        dispatch_allowed: false, runtime_usable: false, backend_acceptance: "UNPROVEN", model_id: MODEL_ID, profile_schema_hash: profileHash,
        source_pins: source.source_pins, intent_fingerprint: intentFingerprint, request_fingerprint: requestFingerprint,
        prompt_utf16_length: normalized.intent.prompt.length, image_reference_count: 1, audio_reference_count: 0,
        input_references: Object.freeze([safeMetadata(resolution)]), native_audio_status: "UNPROVEN_NOT_ENABLED",
        audio_gap: "OPTIONAL_AUDIO_UI_NOT_JOINED_TO_NATIVE_CONTEXT", expires_at: expiresAt });
      const state = {} as CandidateState;
      const binding: OwnerWan25I2vPreparedCandidateBinding = Object.freeze({ candidate, attempt_id: input.attempt_id, principal: resolution.principal,
        model_id: MODEL_ID, reference_epoch: resolution.epoch, profile_schema_hash: profileHash, intent_fingerprint: intentFingerprint,
        request_fingerprint: requestFingerprint, wire_fingerprint: requestFingerprint, expires_at: expiresAt,
        audio_reference_count: 0, runtime_usable: false, dispatch_allowed: false });
      Object.assign(state, { api, candidate, input, resolveInput: refInput, resolution, normalized, captured, request, binding, expiresAt, expired: false });
      CANDIDATES.set(candidate, state); candidates.add(state); return candidate;
    } catch (error) { if (error instanceof OwnerWan25I2vRequestPreparerError) throw error; if (error && typeof error === "object" && "code" in error && error.code === "INVALID_PARAMETERS") fail("PARAMETERS_INVALID"); throw error; }
  };
  const inspectCandidate: OwnerWan25I2vRequestPreparer["inspectCandidate"] = (candidate) => { try { return stateFor(candidate).binding; } catch { return undefined; } };
  const getPrivateRequest: OwnerWan25I2vRequestPreparer["getPrivateRequest"] = (candidate) => stateFor(candidate).request;
  const revalidateCandidate: OwnerWan25I2vRequestPreparer["revalidateCandidate"] = async (candidate, signal) => {
    const state = stateFor(candidate); if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const { resolution, captured } = await resolveAndCapture(state.resolveInput, undefined, signal);
    if (captured.client !== state.captured.client || captured.contexts[0] !== state.captured.contexts[0] || captured.url !== state.captured.url ||
        !sameGenerationPrincipal(resolution.principal, state.resolution.principal) || resolution.epoch !== state.resolution.epoch) { expire(state); fail("REFERENCE_UNAVAILABLE"); }
    const nextRequest = buildRequest(normalizeOwnerWan25I2vGenerationParameters({ model_id: state.input.model_id, prompt: state.input.prompt, parameters: state.input.parameters }), captured.url);
    if (schemaHash(nextRequest) !== state.binding.wire_fingerprint || now() >= state.expiresAt) { expire(state); fail("CANDIDATE_EXPIRED"); }
    return state.binding;
  };
  const getNativeBindingForClient: OwnerWan25I2vRequestPreparer["getNativeBindingForClient"] = (client, candidate) => {
    const state = stateFor(candidate); if (client !== state.captured.client || !readOwnerWan25I2vUploadReferenceForClient(client, state.captured.contexts[0])) fail("CANDIDATE_UNBOUND");
    if (!state.token) { state.token = Object.freeze({ status: "captured", dispatch_allowed: false, model_id: MODEL_ID,
      profile_schema_hash: profileHash, intent_fingerprint: state.binding.intent_fingerprint,
      request_fingerprint: state.binding.request_fingerprint, expires_at: state.expiresAt }); NATIVE_BINDINGS.set(state.token, state); }
    return state.token;
  };
  const invalidateAttempt: OwnerWan25I2vRequestPreparer["invalidateAttempt"] = async (attemptId) => {
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) return;
    for (const state of candidates) if (state.input.attempt_id === attemptId) expire(state);
    await service.invalidateAttempt(attemptId);
  };
  const close: OwnerWan25I2vRequestPreparer["close"] = async () => { if (closed) return; closed = true; for (const state of candidates) expire(state); candidates.clear(); };
  const api: OwnerWan25I2vRequestPreparer = Object.freeze({ prepare, inspectCandidate, getPrivateRequest, revalidateCandidate,
    getNativeBindingForClient, invalidateAttempt, close }); PREPARERS.add(api); return api;
  function expire(state: CandidateState): void { state.expired = true; candidates.delete(state); if (state.token) NATIVE_BINDINGS.delete(state.token); }
}

export function isOwnerWan25I2vRequestPreparer(value: unknown): value is OwnerWan25I2vRequestPreparer { return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value as object); }
export function isOwnerWan25I2vPreparedCandidate(value: unknown): value is OwnerWan25I2vPreparedCandidate { return !!value && typeof value === "object" && !types.isProxy(value) && CANDIDATES.has(value as object); }
export function readOwnerWan25I2vNativeBindingForClient(client: unknown, token: unknown): OwnerWan25I2vNativeReferenceTuple | null {
  try { if (!token || typeof token !== "object" || types.isProxy(token)) return null; const state = NATIVE_BINDINGS.get(token as object);
    if (!state || state.token !== token || client !== state.captured.client || !Object.isFrozen(token) || !state.api.inspectCandidate(state.candidate)) return null;
    const context = state.captured.contexts[0]; return readOwnerWan25I2vUploadReferenceForClient(client, context) ? Object.freeze([context]) : null; } catch { return null; }
}

function buildRequest(normalized: OwnerWan25I2vGenerationParametersNormalized, url: string): OwnerWan25I2vPreparedRequest {
  return Object.freeze({ prompt: normalized.intent.prompt, settings: Object.freeze({ ...normalized.wire_candidate.settings,
    file_urls: Object.freeze([Object.freeze({ type: "image" as const, url })]) }) });
}
function safeMetadata(resolution: OwnerWan25I2vReferenceResolution): OwnerWan25I2vPreparedInputReference { return Object.freeze({ media_type: "image",
  mime_type: resolution.image.mime_type, size: resolution.image.size, sha256: resolution.image.sha256, width: resolution.image.width, height: resolution.image.height }); }
function snapshotInput(value: unknown): Readonly<OwnerWan25I2vPrepareInput> { const f = exactRecord(value, ["attempt_id", "model_id", "image_handle", "audio_handle", "prompt", "parameters"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || f.model_id !== MODEL_ID || typeof f.image_handle !== "string" ||
      !HANDLE.test(f.image_handle)) fail("INVALID_REQUEST"); if (f.audio_handle !== null) fail("AUDIO_REFERENCE_NOT_READY");
  if (typeof f.prompt !== "string") fail("PARAMETERS_INVALID"); const normalized = normalizeOwnerWan25I2vGenerationParameters({ model_id: MODEL_ID, prompt: f.prompt, parameters: f.parameters });
  return Object.freeze({ attempt_id: f.attempt_id, model_id: MODEL_ID, image_handle: f.image_handle, audio_handle: null,
    prompt: normalized.intent.prompt, parameters: normalized.intent.parameters }); }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let p: object | null; let ds: PropertyDescriptorMap; try { p = Object.getPrototypeOf(value); ds = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(ds), allowed = [...required, ...optional]; if ((p !== Object.prototype && p !== null) || required.some((k) => !Object.hasOwn(ds, k)) ||
    keys.some((k) => typeof k !== "string" || !allowed.includes(k) || !("value" in ds[k]!) || ds[k]!.enumerable !== true)) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) out[k] = ds[k]!.value; return out;
}
function isSafeReference(url: string): boolean { try { const u = new URL(url); return u.protocol === "https:" && isAllowedHost(u.hostname) && !u.username && !u.password && !u.hash; } catch { return false; } }
function isAllowedHost(host: string): boolean { return host === "r2.syntx.ai" || host.endsWith(".r2.syntx.ai"); }
function mapReferenceError(error: OwnerWan25I2vReferenceServiceError): never { if (error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED"); if (error.code === "REQUEST_ABORTED") fail("REQUEST_ABORTED"); fail("REFERENCE_UNAVAILABLE"); }
function fail(code: OwnerWan25I2vRequestPreparerErrorCode | "AUDIO_REFERENCE_NOT_READY"): never { throw new OwnerWan25I2vRequestPreparerError(code as OwnerWan25I2vRequestPreparerErrorCode); }
