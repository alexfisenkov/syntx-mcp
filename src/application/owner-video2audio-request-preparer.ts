import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  SyntxChatHttpClient, isOwnerVideo2AudioOriginalReferenceForClient,
  readOwnerVideo2AudioOriginalReferenceForClient, type OwnerVideo2AudioOriginalReference
} from "../adapter/syntx/chat-http-client.js";
import { OwnerVideo2AudioOriginalReferenceService,
  type OwnerVideo2AudioOriginalResolution } from "./owner-video2audio-original-reference-service.js";
import { normalizeOwnerVideo2AudioPrompt, validateOwnerVideo2AudioTrustedUploadDuration } from "./owner-video2audio-input-parameters.js";
import { isAuthenticOwnerVideo2AudioSourceProfile, type OwnerVideo2AudioSourceProfile } from "./owner-video2audio-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const MAX_PENDING = 4;
const MAX_ATTEMPTS = 128;
const PREPARER_KEY = Symbol("OwnerVideo2AudioRequestPreparerFactory");
const ORIGINAL_RESOLVE = OwnerVideo2AudioOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_GUARD = OwnerVideo2AudioOriginalReferenceService.prototype.isOwnedOriginalResolution;
const ORIGINAL_WITH_CAPTURE = OwnerVideo2AudioOriginalReferenceService.prototype.withCapturedNativeOriginal;
const PREPARERS = new WeakSet<object>();
const OWNER_APIS = new WeakMap<object, PreparerApi>();
const CANDIDATES = new WeakMap<object, CandidateState>();

export interface OwnerVideo2AudioPreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: "video2audio";
  readonly operation_id: "generate-audio";
  readonly profile_id: OwnerVideo2AudioSourceProfile["profileId"];
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<{ public_catalog_version: string; settings_inventory_version: string; form_sha256: string }>;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly prompt_utf16_length: number;
  readonly original: Readonly<{ mime_type: "video/mp4"; size: number; sha256: string; duration_seconds: number }>;
  readonly expires_at: number;
}

export interface OwnerVideo2AudioPreparedRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    model_type: "video2audio";
    mode: "generate";
    duration: number;
    negative_prompt: "";
    seed: 0;
    file_urls: readonly Readonly<{ type: "video"; url: string }>[];
  }>;
}

export interface OwnerVideo2AudioCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly original_handle: string;
  readonly profile_id: OwnerVideo2AudioSourceProfile["profileId"];
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<{ public_catalog_version: string; settings_inventory_version: string; form_sha256: string }>;
  readonly original_sha256: string;
  readonly original_size: number;
  readonly duration_seconds: number;
  readonly original_epoch: number;
  readonly original_expires_at: number;
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly prompt: string;
  readonly captured_client: SyntxChatHttpClient;
  readonly captured_reference: OwnerVideo2AudioOriginalReference;
}

export interface PrepareOwnerVideo2AudioRequestInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly video_original_handle: string;
}

export interface OwnerVideo2AudioRequestPreparerOptions {
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly originalReferenceService: OwnerVideo2AudioOriginalReferenceService;
  readonly now?: () => number;
}

interface PreparerApi {
  prepare(input: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerVideo2AudioCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerVideo2AudioPreparedRequest;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioCandidateBinding>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

interface CandidateState {
  readonly owner: object;
  readonly candidate: OwnerVideo2AudioPreparedCandidate;
  readonly attemptId: string;
  readonly handle: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly original: OwnerVideo2AudioOriginalResolution;
  readonly client: SyntxChatHttpClient;
  readonly reference: OwnerVideo2AudioOriginalReference;
  readonly prompt: string;
  readonly request: OwnerVideo2AudioPreparedRequest;
  readonly binding: OwnerVideo2AudioCandidateBinding;
  readonly expiresAt: number;
  epoch: number;
  lastNow: number;
  expired: boolean;
}

interface ActiveOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeAbort: () => void;
  readonly epoch: number;
}

export type OwnerVideo2AudioRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" | "PROMPT_INVALID" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "CLOCK_INVALID" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "REQUEST_ABORTED";

export class OwnerVideo2AudioRequestPreparerError extends Error {
  constructor(readonly code: OwnerVideo2AudioRequestPreparerErrorCode) {
    super("The Video2Audio request candidate could not be prepared safely.");
    this.name = "OwnerVideo2AudioRequestPreparerError";
  }
}

/** Genuine factory-issued preparer; a candidate is not a generation or payment permit. */
export class OwnerVideo2AudioRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api;
    PREPARERS.add(this);
    Object.freeze(this);
  }
  prepare(input: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioPreparedCandidate> { return this.#api.prepare(input, signal); }
  inspectCandidate(candidate: unknown): OwnerVideo2AudioCandidateBinding | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerVideo2AudioPreparedRequest { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioCandidateBinding> { return this.#api.revalidateCandidate(candidate, signal); }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerVideo2AudioRequestPreparer.prototype);

/** Creates a no-dispatch preparer bound to one authentic source profile and original-reference service. */
export function createOwnerVideo2AudioRequestPreparer(optionsInput: OwnerVideo2AudioRequestPreparerOptions | unknown): OwnerVideo2AudioRequestPreparer {
  const options = readOptions(optionsInput);
  const owner = Object.freeze({});
  const candidates = new Set<CandidateState>();
  const pending = new Set<ActiveOperation>();
  const pendingByAttempt = new Map<string, Set<ActiveOperation>>();
  const epochs = new Map<string, number>();
  const invalidating = new Set<string>();
  const clock = options.now === undefined ? Date.now : readClock(options.now);
  let lastNow = clock(), closed = false, closing: Promise<void> | undefined;
  const readNow = (): number => {
    const value = clock();
    if (value < lastNow) fail("CLOCK_INVALID");
    lastNow = value;
    return value;
  };
  const assertOpen = (): void => { if (closed) fail("SERVICE_CLOSED"); };
  const stateFor = (value: unknown): CandidateState => {
    assertOpen();
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object);
    if (!state || state.owner !== owner || state.candidate !== value) fail("CANDIDATE_UNBOUND");
    const now = readNow();
    if (state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || now >= state.expiresAt) {
      state.expired = true;
      candidates.delete(state);
      fail("CANDIDATE_EXPIRED");
    }
    const originalContext = Object.freeze({ attempt_id: state.attemptId, video_original_handle: state.handle });
    if (!Reflect.apply(ORIGINAL_GUARD, options.originalReferenceService, [state.original, originalContext]) ||
        !isOwnerVideo2AudioOriginalReferenceForClient(state.client, options.profile, state.reference)) {
      state.expired = true;
      candidates.delete(state);
      fail("CANDIDATE_EXPIRED");
    }
    state.lastNow = now;
    return state;
  };
  const begin = (attemptId: string, signal?: AbortSignal): ActiveOperation => {
    assertOpen();
    if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
    if (signal?.aborted || invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    if (pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
    if (!epochs.has(attemptId) && epochs.size >= MAX_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: ActiveOperation = { controller, done, finish,
      removeAbort: () => signal?.removeEventListener("abort", abort), epoch: epochs.get(attemptId) ?? 0 };
    return operation;
  };
  const track = <T>(attemptId: string, operation: ActiveOperation, work: () => Promise<T>): Promise<T> => {
    pending.add(operation);
    const operations = pendingByAttempt.get(attemptId) ?? new Set<ActiveOperation>();
    operations.add(operation); pendingByAttempt.set(attemptId, operations);
    const promise = Promise.resolve().then(work);
    return promise.finally(() => {
      pending.delete(operation); operations.delete(operation);
      if (operations.size === 0) pendingByAttempt.delete(attemptId);
      operation.removeAbort(); operation.finish();
    });
  };
  const resolveOriginal = async (attemptId: string, handle: string, signal: AbortSignal): Promise<{
    readonly resolution: OwnerVideo2AudioOriginalResolution;
    readonly client: SyntxChatHttpClient;
    readonly reference: OwnerVideo2AudioOriginalReference;
    readonly url: string;
  }> => {
    const context = Object.freeze({ attempt_id: attemptId, video_original_handle: handle });
    let resolution: OwnerVideo2AudioOriginalResolution;
    try { resolution = await Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [context, signal]); }
    catch (error) {
      if (signal.aborted) fail("REQUEST_ABORTED");
      if (error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
      fail("REFERENCE_UNAVAILABLE");
    }
    if (!Reflect.apply(ORIGINAL_GUARD, options.originalReferenceService, [resolution!, context]) ||
        resolution!.attempt_id !== attemptId || resolution!.video_original_handle !== handle ||
        resolution!.source_profile_id !== options.profile.profileId || resolution!.profile_schema_hash !== options.profile.profileSchemaHash ||
        resolution!.generation_permit !== false || resolution!.wire_type !== "video" || resolution!.mime_type !== "video/mp4" ||
        resolution!.principal.connection_id !== attemptId) fail("REFERENCE_UNAVAILABLE");
    let captured: { readonly client: SyntxChatHttpClient; readonly reference: OwnerVideo2AudioOriginalReference; readonly url: string };
    try {
      captured = Reflect.apply(ORIGINAL_WITH_CAPTURE, options.originalReferenceService, [resolution!, context,
        (client: SyntxChatHttpClient, reference: OwnerVideo2AudioOriginalReference) => {
          if (!(client instanceof SyntxChatHttpClient) || !isOwnerVideo2AudioOriginalReferenceForClient(client, options.profile, reference)) fail("REFERENCE_UNAVAILABLE");
          const details = readOwnerVideo2AudioOriginalReferenceForClient(client, options.profile, reference);
          if (!details || details.profile_schema_hash !== options.profile.profileSchemaHash || details.sha256 !== resolution!.sha256 ||
              details.mime_type !== "video/mp4" || details.size !== resolution!.size ||
              details.duration_seconds !== resolution!.duration_seconds || !isSafeUploadReferenceUrl(details.url)) fail("REFERENCE_UNAVAILABLE");
          validateOwnerVideo2AudioTrustedUploadDuration(details.duration_seconds, options.profile);
          return Object.freeze({ client, reference, url: details.url });
        }]);
    } catch (error) {
      if (error instanceof OwnerVideo2AudioRequestPreparerError) throw error;
      if (signal.aborted) fail("REQUEST_ABORTED");
      if (error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
      fail("REFERENCE_UNAVAILABLE");
    }
    return Object.freeze({ resolution: resolution!, ...captured! });
  };
  const bindingFor = (state: CandidateState): OwnerVideo2AudioCandidateBinding => state.binding;
  const api: PreparerApi & { readonly profile: OwnerVideo2AudioSourceProfile;
    readonly originalService: OwnerVideo2AudioOriginalReferenceService } = {
    profile: options.profile,
    originalService: options.originalReferenceService,
    async prepare(inputInput, signal) {
      assertOpen();
      const input = readPrepareInput(inputInput, signal);
      if (invalidating.has(input.attemptId)) fail("CANDIDATE_EXPIRED");
      const operation = begin(input.attemptId, signal);
      return track(input.attemptId, operation, async () => {
        const startedAt = readNow();
        if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
        const prompt = normalizeOwnerVideo2AudioPrompt(input.prompt, options.profile);
        let current: Awaited<ReturnType<typeof resolveOriginal>>;
        try { current = await resolveOriginal(input.attemptId, input.handle, operation.controller.signal); }
        catch (error) { if (error instanceof Error && "code" in error && error.code === "PROMPT_INVALID") throw error; throw error; }
        assertOpen();
        if (operation.controller.signal.aborted || operation.epoch !== (epochs.get(input.attemptId) ?? 0) || invalidating.has(input.attemptId)) fail("REQUEST_ABORTED");
        const issuedAt = readNow();
        const expiresAt = Math.min(issuedAt + TTL_MS, current.resolution.expires_at);
        if (expiresAt <= issuedAt) fail("REFERENCE_EXPIRED");
        const request: OwnerVideo2AudioPreparedRequest = deepFreeze({ prompt, settings: {
          model_type: "video2audio", mode: "generate", duration: current.resolution.duration_seconds,
          negative_prompt: "", seed: 0, file_urls: [Object.freeze({ type: "video" as const, url: current.url })]
        } });
        const intentFingerprint = schemaHash({ tenant_id: current.resolution.principal.tenant_id,
          subject_id: current.resolution.principal.subject_id, model_id: "video2audio", operation_id: "generate-audio",
          profile_schema_hash: options.profile.profileSchemaHash, prompt, original_sha256: current.resolution.sha256,
          original_size: current.resolution.size, duration_seconds: current.resolution.duration_seconds,
          settings: { model_type: "video2audio", mode: "generate", negative_prompt: "", seed: 0 } });
        const requestFingerprint = schemaHash(request);
        const sourceBinding = Object.freeze({ public_catalog_version: options.profile.source.source_pins.public_catalog_version,
          settings_inventory_version: options.profile.source.source_pins.settings_inventory_version,
          form_sha256: options.profile.source.source_pins.form_sha256 });
        const publicCandidate = makeCandidate({ profile: options.profile, intentFingerprint, requestFingerprint, prompt,
          original: current.resolution, expiresAt });
        const binding = privateBinding({ attemptId: input.attemptId, principal: current.resolution.principal,
          originalHandle: input.handle, profile: options.profile, sourceBinding, original: current.resolution,
          expiresAt, intentFingerprint, requestFingerprint, prompt, client: current.client, reference: current.reference });
        const now = readNow();
        const state: CandidateState = { owner, candidate: publicCandidate, attemptId: input.attemptId, handle: input.handle,
          principal: current.resolution.principal, original: current.resolution, client: current.client, reference: current.reference,
          prompt, request, binding, expiresAt, epoch: operation.epoch, lastNow: now, expired: false };
        if (operation.controller.signal.aborted || operation.epoch !== (epochs.get(input.attemptId) ?? 0) || invalidating.has(input.attemptId)) fail("REQUEST_ABORTED");
        if (candidates.size >= MAX_CANDIDATES) pruneCandidates(candidates, readNow());
        if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
        candidates.add(state); CANDIDATES.set(publicCandidate, state);
        if (startedAt > now) fail("CLOCK_INVALID");
        return publicCandidate;
      });
    },
    inspectCandidate(candidate) {
      try { const state = stateFor(candidate); return bindingFor(state); } catch { return undefined; }
    },
    getPrivateRequest(candidate) { return stateFor(candidate).request; },
    async revalidateCandidate(candidate, signal) {
      const state = stateFor(candidate);
      const operation = begin(state.attemptId, signal);
      return track(state.attemptId, operation, async () => {
        if (operation.controller.signal.aborted || operation.epoch !== state.epoch || invalidating.has(state.attemptId)) fail("CANDIDATE_EXPIRED");
        const current = await resolveOriginal(state.attemptId, state.handle, operation.controller.signal);
        assertOpen();
        if (operation.controller.signal.aborted || !sameGenerationPrincipal(current.resolution.principal, state.principal) ||
            current.resolution.attempt_id !== state.original.attempt_id || current.resolution.source_profile_id !== state.original.source_profile_id ||
            current.resolution.profile_schema_hash !== state.original.profile_schema_hash || current.resolution.epoch !== state.original.epoch ||
            current.resolution.expires_at !== state.original.expires_at || current.resolution.sha256 !== state.original.sha256 ||
            current.resolution.size !== state.original.size || current.resolution.duration_seconds !== state.original.duration_seconds ||
            current.client !== state.client || current.reference !== state.reference || current.url !== state.request.settings.file_urls[0]?.url ||
            state.expiresAt <= readNow() || current.resolution.expires_at <= readNow() ||
            operation.epoch !== (epochs.get(state.attemptId) ?? 0) || invalidating.has(state.attemptId)) {
          state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
        }
        return state.binding;
      });
    },
    async invalidateAttempt(attemptInput) {
      const attemptId = readAttempt(attemptInput);
      invalidating.add(attemptId);
      epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
      for (const state of candidates) if (state.attemptId === attemptId) { state.expired = true; candidates.delete(state); }
      const active = [...(pendingByAttempt.get(attemptId) ?? [])];
      for (const operation of active) operation.controller.abort();
      await Promise.allSettled(active.map((operation) => operation.done));
      invalidating.delete(attemptId);
    },
    close() {
      if (closing) return closing;
      closed = true;
      for (const state of candidates) { state.expired = true; candidates.delete(state); }
      const active = [...pending];
      for (const operation of active) operation.controller.abort();
      closing = Promise.allSettled(active.map((operation) => operation.done)).then(() => {
        epochs.clear(); invalidating.clear(); pendingByAttempt.clear();
      });
      return closing;
    }
  };
  OWNER_APIS.set(owner, api);
  return new OwnerVideo2AudioRequestPreparer(PREPARER_KEY, api);
}

export function isOwnerVideo2AudioRequestPreparer(value: unknown): value is OwnerVideo2AudioRequestPreparer {
  return value !== null && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value);
}

export function isOwnerVideo2AudioPreparedCandidate(value: unknown): value is OwnerVideo2AudioPreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  if (!state || state.candidate !== value || state.expired) return false;
  try { return !!OWNER_APIS.get(state.owner)?.inspectCandidate(value); } catch { return false; }
}

function readOptions(value: unknown): OwnerVideo2AudioRequestPreparerOptions {
  const fields = exactRecord(value, ["profile", "originalReferenceService"], ["now"]);
  const service = fields.originalReferenceService;
  if (!isAuthenticOwnerVideo2AudioSourceProfile(fields.profile) || !(service instanceof OwnerVideo2AudioOriginalReferenceService) ||
      Object.getPrototypeOf(service) !== OwnerVideo2AudioOriginalReferenceService.prototype ||
      Object.getOwnPropertyDescriptor(OwnerVideo2AudioOriginalReferenceService.prototype, "resolveOriginal")?.value !== ORIGINAL_RESOLVE ||
      Object.getOwnPropertyDescriptor(OwnerVideo2AudioOriginalReferenceService.prototype, "isOwnedOriginalResolution")?.value !== ORIGINAL_GUARD ||
      Object.getOwnPropertyDescriptor(OwnerVideo2AudioOriginalReferenceService.prototype, "withCapturedNativeOriginal")?.value !== ORIGINAL_WITH_CAPTURE ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ profile: fields.profile, originalReferenceService: service, ...(fields.now === undefined ? {} : { now: readClock(fields.now) }) }) as OwnerVideo2AudioRequestPreparerOptions;
}

function readPrepareInput(value: unknown, signal?: AbortSignal): Readonly<{ attemptId: string; prompt: string; handle: string }> {
  const fields = exactRecord(value, ["attemptId", "prompt", "video_original_handle"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.prompt !== "string" ||
      typeof fields.video_original_handle !== "string" || !/^video2audio_original_[0-9a-f-]{36}$/u.test(fields.video_original_handle) ||
      (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, prompt: fields.prompt, handle: fields.video_original_handle });
}

function makeCandidate(input: { profile: OwnerVideo2AudioSourceProfile; intentFingerprint: string; requestFingerprint: string;
  prompt: string; original: OwnerVideo2AudioOriginalResolution; expiresAt: number }): OwnerVideo2AudioPreparedCandidate {
  const candidate = Object.create(null) as OwnerVideo2AudioPreparedCandidate;
  Object.defineProperties(candidate, {
    status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
    runtime_usable: { value: false, enumerable: true }, backend_acceptance: { value: "UNPROVEN", enumerable: true },
    model_id: { value: "video2audio", enumerable: true }, operation_id: { value: "generate-audio", enumerable: true },
    profile_id: { value: input.profile.profileId, enumerable: true }, profile_schema_hash: { value: input.profile.profileSchemaHash, enumerable: true },
    source_binding: { value: Object.freeze({ public_catalog_version: input.profile.source.source_pins.public_catalog_version,
      settings_inventory_version: input.profile.source.source_pins.settings_inventory_version,
      form_sha256: input.profile.source.source_pins.form_sha256 }), enumerable: true },
    intent_fingerprint: { value: input.intentFingerprint, enumerable: true }, request_fingerprint: { value: input.requestFingerprint, enumerable: true },
    prompt_utf16_length: { value: input.prompt.length, enumerable: true },
    original: { value: Object.freeze({ mime_type: "video/mp4", size: input.original.size, sha256: input.original.sha256,
      duration_seconds: input.original.duration_seconds }), enumerable: true }, expires_at: { value: input.expiresAt, enumerable: true }
  });
  return Object.freeze(candidate);
}

function privateBinding(input: { attemptId: string; principal: Readonly<GenerationPrincipalRef>; originalHandle: string;
  profile: OwnerVideo2AudioSourceProfile; sourceBinding: OwnerVideo2AudioCandidateBinding["source_binding"];
  original: OwnerVideo2AudioOriginalResolution; expiresAt: number; intentFingerprint: string; requestFingerprint: string;
  prompt: string; client: SyntxChatHttpClient; reference: OwnerVideo2AudioOriginalReference }): OwnerVideo2AudioCandidateBinding {
  const binding = Object.create(null) as OwnerVideo2AudioCandidateBinding;
  Object.defineProperties(binding, {
    attempt_id: { value: input.attemptId, enumerable: true }, principal: { value: input.principal, enumerable: true },
    original_handle: { value: input.originalHandle, enumerable: true }, profile_id: { value: input.profile.profileId, enumerable: true },
    profile_schema_hash: { value: input.profile.profileSchemaHash, enumerable: true }, source_binding: { value: input.sourceBinding, enumerable: true },
    original_sha256: { value: input.original.sha256, enumerable: true }, original_size: { value: input.original.size, enumerable: true },
    duration_seconds: { value: input.original.duration_seconds, enumerable: true }, original_epoch: { value: input.original.epoch, enumerable: true },
    original_expires_at: { value: input.original.expires_at, enumerable: true }, expires_at: { value: input.expiresAt, enumerable: true },
    intent_fingerprint: { value: input.intentFingerprint, enumerable: true }, request_fingerprint: { value: input.requestFingerprint, enumerable: true },
    prompt: { value: input.prompt, enumerable: true }, captured_client: { value: input.client, enumerable: false },
    captured_reference: { value: input.reference, enumerable: false }
  });
  return Object.freeze(binding);
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const allowed = new Set([...required, ...optional]), keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.length < required.length ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key as string] = descriptors[key as string]!.value;
  return result;
}

function pruneCandidates(candidates: Set<CandidateState>, now: number): void {
  for (const state of candidates) if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); }
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value as object)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { const now = Reflect.apply(value, undefined, []); if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) fail("CLOCK_INVALID"); return now; };
}

function fail(code: OwnerVideo2AudioRequestPreparerErrorCode): never { throw new OwnerVideo2AudioRequestPreparerError(code); }
