import { createHash } from "node:crypto";
import { types } from "node:util";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  OwnerVeoOmniReferenceService,
  OwnerVeoOmniReferenceServiceError,
  isOwnerVeoOmniReferenceService,
  type OwnerVeoOmniOwnedReferences
} from "./owner-veo-omni-reference-service.js";
import {
  getOwnerVeoOmniReferenceProfile,
  normalizeOwnerVeoOmniReferenceGenerationInput,
  type OwnerVeoOmniReferenceGenerationInput
} from "./owner-veo-omni-reference-profile.js";
import {
  buildOwnerVeoOmniReferenceWire,
  type OwnerVeoOmniReferenceWireCandidate
} from "./owner-veo-omni-reference-wire.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^veo_omni_reference_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const MAX_PENDING = 4;
const PREPARER_KEY = Symbol("OwnerVeoOmniReferenceRequestPreparerFactory");
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadOwnerVeoOmniReference;
const NATIVE_RESOLVE = OwnerVeoOmniReferenceService.prototype.resolveReferences;
const NATIVE_GUARD = OwnerVeoOmniReferenceService.prototype.isOwnedReferences;
const NATIVE_CAPTURE = OwnerVeoOmniReferenceService.prototype.withCapturedReferences;
const NATIVE_INVALIDATE = OwnerVeoOmniReferenceService.prototype.invalidateAttempt;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();

export type OwnerVeoOmniReferenceSourceMetadata = OwnerVeoOmniOwnedReferences["references"][number];
export type OwnerVeoOmniReferenceCandidateBinding = Readonly<{
  attempt_id: string;
  principal: Readonly<GenerationPrincipalRef>;
  model_id: "veo_omni";
  profile_sha256: string;
  request_fingerprint: string;
  intent_fingerprint: string;
  expires_at: number;
  reference_epoch: number;
  sources: readonly OwnerVeoOmniReferenceSourceMetadata[];
  cost_parameters: OwnerVeoOmniReferenceWireCandidate["cost_parameters"];
}>;

export interface OwnerVeoOmniReferencePreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: "veo_omni";
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly sources: readonly OwnerVeoOmniReferenceSourceMetadata[];
}

export interface OwnerVeoOmniReferenceRequestPreparerOptions {
  readonly referenceService: OwnerVeoOmniReferenceService;
  readonly now?: () => number;
}

export type OwnerVeoOmniReferenceRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED" | "PARAMETERS_INVALID" | "WIRE_INVALID" | "CLOCK_INVALID" | "REQUEST_ABORTED";

export class OwnerVeoOmniReferenceRequestPreparerError extends Error {
  constructor(readonly code: OwnerVeoOmniReferenceRequestPreparerErrorCode) {
    super("The owner Veo Omni reference candidate could not be prepared safely.");
    this.name = "OwnerVeoOmniReferenceRequestPreparerError";
  }
}

interface CapturedReference {
  readonly reference_handle: string;
  readonly kind: "image" | "video";
  readonly url: string;
}

interface CapturedSet {
  readonly client: SyntxChatHttpClient;
  readonly references: readonly CapturedReference[];
  readonly wire: OwnerVeoOmniReferenceWireCandidate;
}

interface CandidateState {
  readonly preparer: OwnerVeoOmniReferenceRequestPreparer;
  readonly candidate: Readonly<OwnerVeoOmniReferencePreparedCandidate>;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profileSha256: string;
  readonly rawInput: Readonly<{
    attemptId: string;
    prompt: string;
    input_type: "image" | "references";
    upscale: 0 | 1 | 2 | 3;
    aspect_ratio: "16:9" | "9:16";
    video_duration: 4 | 6 | 8 | 10;
    reference_handles: readonly string[];
  }>;
  readonly resolution: OwnerVeoOmniOwnedReferences;
  readonly localEpoch: number;
  readonly captured: CapturedSet;
  readonly wireHash: string;
  readonly binding: OwnerVeoOmniReferenceCandidateBinding;
  readonly expiresAt: number;
  expired: boolean;
}

interface PendingOperation {
  readonly attemptId: string;
  readonly epoch: number;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
}

interface PreparerApi {
  prepare(input: unknown, signal?: AbortSignal): Promise<Readonly<OwnerVeoOmniReferencePreparedCandidate>>;
  inspectCandidate(candidate: unknown): OwnerVeoOmniReferenceCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerVeoOmniReferenceWireCandidate;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerVeoOmniReferenceCandidateBinding>;
  withCapturedReferences<T>(candidate: unknown,
    consume: (client: SyntxChatHttpClient, wire: OwnerVeoOmniReferenceWireCandidate) => T): T;
  isBoundToReferenceService(service: unknown): boolean;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

/** A frozen nominal wrapper; callers cannot substitute an ownership implementation. */
export class OwnerVeoOmniReferenceRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api;
    PREPARERS.add(this);
    Object.freeze(this);
  }
  prepare(input: unknown, signal?: AbortSignal): Promise<Readonly<OwnerVeoOmniReferencePreparedCandidate>> { return this.#api.prepare(input, signal); }
  inspectCandidate(candidate: unknown): OwnerVeoOmniReferenceCandidateBinding | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerVeoOmniReferenceWireCandidate { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerVeoOmniReferenceCandidateBinding> {
    return this.#api.revalidateCandidate(candidate, signal);
  }
  withCapturedReferences<T>(candidate: unknown, consume: (client: SyntxChatHttpClient, wire: OwnerVeoOmniReferenceWireCandidate) => T): T {
    return this.#api.withCapturedReferences(candidate, consume);
  }
  isBoundToReferenceService(service: unknown): boolean { return this.#api.isBoundToReferenceService(service); }
  invalidateAttempt(attemptId: unknown): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerVeoOmniReferenceRequestPreparer.prototype);

export function createOwnerVeoOmniReferenceRequestPreparer(
  optionsInput: OwnerVeoOmniReferenceRequestPreparerOptions | unknown
): OwnerVeoOmniReferenceRequestPreparer {
  const options = readOptions(optionsInput);
  const profile = getOwnerVeoOmniReferenceProfile();
  if (profile.identity.model_id !== "veo_omni" || profile.dispatch_allowed !== false ||
      profile.runtime_usable !== false || !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_sha256)) fail("SERVICE_BINDING_MISMATCH");
  const candidates = new Set<CandidateState>();
  const pendingByAttempt = new Map<string, Set<PendingOperation>>();
  const epochs = new Map<string, number>();
  const invalidating = new Set<string>();
  const invalidations = new Map<string, Promise<void>>();
  const allOperations = new Set<Promise<void>>();
  const clock = options.now === undefined ? Date.now : readClock(options.now);
  let lastNow = -1;
  let pendingCount = 0;
  let closed = false;
  let closing: Promise<void> | undefined;

  const readNow = (): number => {
    let value: unknown;
    try { value = clock(); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < lastNow) fail("CLOCK_INVALID");
    lastNow = value as number;
    return lastNow;
  };

  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object);
    if (!state || state.candidate !== value || state.preparer !== preparer) fail("CANDIDATE_UNBOUND");
    if (!candidates.has(state) || state.expired) fail("CANDIDATE_EXPIRED");
    const now = readNow();
    if (now >= state.expiresAt || state.localEpoch !== (epochs.get(state.attemptId) ?? 0)) {
      state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
    }
    try { assertCurrentStoreCapture(options.referenceService, state); }
    catch { state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED"); }
    return state;
  };

  const begin = (attemptId: string, parentSignal?: AbortSignal): PendingOperation => {
    if (closed) fail("SERVICE_CLOSED");
    if (invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    pruneCandidates(candidates, readNow());
    if (pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    if (candidates.size + pendingCount >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort();
    else parentSignal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolveDone) => { finish = resolveDone; });
    const operation: PendingOperation = {
      attemptId,
      epoch: epochs.get(attemptId) ?? 0,
      controller,
      done,
      finish,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abort)
    };
    const pending = pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    pending.add(operation); pendingByAttempt.set(attemptId, pending);
    allOperations.add(done); pendingCount += 1;
    return operation;
  };

  const finish = (operation: PendingOperation): void => {
    operation.removeParentAbort();
    const pending = pendingByAttempt.get(operation.attemptId);
    pending?.delete(operation);
    if (!pending?.size) pendingByAttempt.delete(operation.attemptId);
    allOperations.delete(operation.done);
    pendingCount -= 1;
    operation.finish();
  };

  const throwIfStopped = (operation: PendingOperation): void => {
    if (closed) fail("SERVICE_CLOSED");
    if (operation.controller.signal.aborted || operation.epoch !== (epochs.get(operation.attemptId) ?? 0) || invalidating.has(operation.attemptId)) {
      fail("REQUEST_ABORTED");
    }
  };

  const resolve = async (attemptId: string, handles: readonly string[], signal: AbortSignal): Promise<OwnerVeoOmniOwnedReferences> => {
    try {
      const value = await Reflect.apply(NATIVE_RESOLVE, options.referenceService, [
        Object.freeze({ attemptId, reference_handles: handles }), signal
      ]) as OwnerVeoOmniOwnedReferences;
      return value;
    } catch (error) { throw mapStoreError(error); }
  };

  const captureAndEncode = (resolution: OwnerVeoOmniOwnedReferences,
    rawInput: CandidateState["rawInput"], sources: readonly OwnerVeoOmniReferenceSourceMetadata[]): CapturedSet => {
    if (!Reflect.apply(NATIVE_GUARD, options.referenceService, [resolution])) fail("REFERENCE_UNAVAILABLE");
    let captured: CapturedSet | undefined;
    const returned = Reflect.apply(NATIVE_CAPTURE, options.referenceService, [resolution,
      (client: SyntxChatHttpClient, refs: readonly Readonly<{ reference_handle: string; kind: "image" | "video"; url: string }>[]) => {
        if (!exactNativeClient(client)) fail("REFERENCE_UNAVAILABLE");
        const references = snapshotCapturedReferences(refs, sources);
        const wire = buildOwnerVeoOmniReferenceWire(rawInput, references);
        captured = Object.freeze({ client, references, wire });
        return captured;
      }]);
    if (!captured || returned !== captured || isThenableWithoutAccessors(returned)) fail("REFERENCE_UNAVAILABLE");
    return captured;
  };

  const api: PreparerApi = {
    async prepare(inputInput, signalInput) {
      if (closed) fail("SERVICE_CLOSED");
      const normalized = normalizeInput(inputInput);
      const rawInput = rawInputFromNormalized(normalized);
      const signal = exactSignal(signalInput);
      const operation = begin(normalized.attemptId, signal);
      try {
        const startedAt = readNow();
        throwIfStopped(operation);
        const resolution = await resolve(normalized.attemptId, normalized.reference_handles, operation.controller.signal);
        throwIfStopped(operation);
        const safeSources = validateResolution(resolution, normalized, profile.profile_sha256, options.referenceService);
        const captured = captureAndEncode(resolution, rawInput, safeSources);
        throwIfStopped(operation);
        if (captured.references.length !== safeSources.length) {
          fail("REFERENCE_UNAVAILABLE");
        }
        const now = readNow();
        const expiresAt = Math.min(startedAt + TTL_MS, resolution.expires_at);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail("REFERENCE_EXPIRED");
        const intent = intentFingerprint(rawInput, profile.profile_sha256, safeSources);
        const requestFingerprint = schemaHash({
          version: "owner-veo-omni-reference-request-v1",
          attempt_id: normalized.attemptId,
          principal: resolution.principal,
          client_binding: { attempt_id: normalized.attemptId, connection_id: resolution.principal.connection_id },
          profile_sha256: profile.profile_sha256,
          wire_fingerprint: captured.wire.wire_fingerprint,
          sources: safeSources,
          reference_epoch: resolution.epoch,
          expires_at: expiresAt
        });
        const candidate = makeCandidate({ profileSha256: profile.profile_sha256, requestFingerprint,
          intentFingerprint: intent, expiresAt, sources: safeSources });
        const binding = deepFreeze({ attempt_id: normalized.attemptId, principal: resolution.principal,
          model_id: "veo_omni" as const, profile_sha256: profile.profile_sha256, request_fingerprint: requestFingerprint,
          intent_fingerprint: intent, expires_at: expiresAt, reference_epoch: resolution.epoch,
          sources: safeSources, cost_parameters: captured.wire.cost_parameters });
        pruneCandidates(candidates, readNow());
        if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
        const state: CandidateState = { preparer, candidate, attemptId: normalized.attemptId, principal: resolution.principal,
          profileSha256: profile.profile_sha256, rawInput, resolution, localEpoch: operation.epoch, captured,
          wireHash: schemaHash(captured.wire), binding, expiresAt, expired: false };
        CANDIDATES.set(candidate, state); candidates.add(state);
        return candidate;
      } catch (error) {
        throw mapPreparerError(error);
      } finally { finish(operation); }
    },
    inspectCandidate(value) { try { return stateFor(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return stateFor(value).captured.wire; },
    async revalidateCandidate(value, signalInput) {
      const state = stateFor(value), operation = begin(state.attemptId, exactSignal(signalInput));
      try {
        throwIfStopped(operation);
        const resolution = await resolve(state.attemptId, state.rawInput.reference_handles, operation.controller.signal);
        throwIfStopped(operation);
        const safeSources = validateResolution(resolution, state.rawInput, state.profileSha256, options.referenceService);
        const captured = captureAndEncode(resolution, state.rawInput, safeSources);
        throwIfStopped(operation);
        if (state.resolution.epoch !== resolution.epoch || state.localEpoch !== operation.epoch ||
            !sameGenerationPrincipal(state.principal, resolution.principal) ||
            !sameSourceMetadata(state.binding.sources, safeSources) || captured.client !== state.captured.client ||
            !sameCapturedReferences(state.captured.references, captured.references) ||
            captured.wire.wire_fingerprint !== state.captured.wire.wire_fingerprint ||
            schemaHash(captured.wire) !== state.wireHash || readNow() >= state.expiresAt) {
          state.expired = true; candidates.delete(state); fail("CANDIDATE_EXPIRED");
        }
        assertCurrentStoreCapture(options.referenceService, state);
        return state.binding;
      } catch (error) {
        if (error instanceof OwnerVeoOmniReferenceRequestPreparerError) {
          if (error.code === "REQUEST_ABORTED" || error.code === "SERVICE_CLOSED") throw error;
          state.expired = true; candidates.delete(state);
          throw error;
        }
        state.expired = true; candidates.delete(state); throw mapPreparerError(error);
      } finally { finish(operation); }
    },
    withCapturedReferences<T>(value: unknown, consume: (client: SyntxChatHttpClient, wire: OwnerVeoOmniReferenceWireCandidate) => T): T {
      if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
      const state = stateFor(value);
      const result = consume(state.captured.client, state.captured.wire);
      if (isThenableWithoutAccessors(result)) fail("INVALID_REQUEST");
      return result;
    },
    isBoundToReferenceService(service) { return service === options.referenceService; },
    async invalidateAttempt(attemptInput) {
      const attemptId = readAttempt(attemptInput);
      const prior = invalidations.get(attemptId);
      if (prior) return prior;
      invalidating.add(attemptId);
      epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
      for (const state of candidates) if (state.attemptId === attemptId) { state.expired = true; candidates.delete(state); }
      for (const operation of pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
      const pending = [...(pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
      let invalidation: Promise<void>;
      try { invalidation = Promise.resolve(Reflect.apply(NATIVE_INVALIDATE, options.referenceService, [attemptId])); }
      catch (error) { invalidation = Promise.reject(error); }
      const complete = Promise.allSettled([...pending, invalidation]).then((results) => {
        invalidating.delete(attemptId); invalidations.delete(attemptId);
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw mapPreparerError(failed.reason);
      });
      invalidations.set(attemptId, complete);
      return complete;
    },
    async close() {
      if (closing) return closing;
      closed = true;
      for (const state of candidates) { state.expired = true; candidates.delete(state); }
      const attempts = new Set(pendingByAttempt.keys());
      for (const attemptId of attempts) {
        epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
        invalidating.add(attemptId);
        for (const operation of pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
      }
      const pending = [...allOperations];
      const invalidationsToWait = [...invalidations.values()];
      closing = Promise.allSettled([...pending, ...invalidationsToWait]).then(() => {
        pendingByAttempt.clear(); allOperations.clear(); epochs.clear(); invalidating.clear(); invalidations.clear(); candidates.clear();
      });
      return closing;
    }
  };

  const preparer = new OwnerVeoOmniReferenceRequestPreparer(PREPARER_KEY, api);
  return preparer;

  function pruneCandidates(states: Set<CandidateState>, now: number): void {
    for (const state of states) if (state.expired || state.expiresAt <= now) { state.expired = true; states.delete(state); }
  }
}

export function isOwnerVeoOmniReferenceRequestPreparer(value: unknown): value is OwnerVeoOmniReferenceRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerVeoOmniReferenceRequestPreparer.prototype &&
    value instanceof OwnerVeoOmniReferenceRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}

/** True only for a genuine candidate whose ownership, epoch, client and expiry still bind now. */
export function isOwnerVeoOmniReferencePreparedCandidate(value: unknown): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object);
  if (!state || state.candidate !== value || !isOwnerVeoOmniReferenceRequestPreparer(state.preparer)) return false;
  return state.preparer.inspectCandidate(value) !== undefined;
}

function readOptions(value: unknown): Readonly<OwnerVeoOmniReferenceRequestPreparerOptions> {
  const fields = exactRecord(value, ["referenceService"], ["now"]);
  const service = fields.referenceService;
  if (!(service instanceof OwnerVeoOmniReferenceService) || !isOwnerVeoOmniReferenceService(service) ||
      getPrototypeMethod(service, "resolveReferences") !== NATIVE_RESOLVE || getPrototypeMethod(service, "isOwnedReferences") !== NATIVE_GUARD ||
      getPrototypeMethod(service, "withCapturedReferences") !== NATIVE_CAPTURE || getPrototypeMethod(service, "invalidateAttempt") !== NATIVE_INVALIDATE ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ referenceService: service, ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) fail("INVALID_REQUEST");
  return value;
}

function normalizeInput(value: unknown): OwnerVeoOmniReferenceGenerationInput {
  try { return normalizeOwnerVeoOmniReferenceGenerationInput(value); }
  catch { fail("PARAMETERS_INVALID"); }
}

function rawInputFromNormalized(value: OwnerVeoOmniReferenceGenerationInput): CandidateState["rawInput"] {
  return Object.freeze({ attemptId: value.attemptId, prompt: value.prompt, input_type: value.input_type,
    upscale: value.upscale, aspect_ratio: value.aspect_ratio, video_duration: value.video_duration,
    reference_handles: Object.freeze([...value.reference_handles]) });
}

function validateResolution(value: OwnerVeoOmniOwnedReferences, input: CandidateState["rawInput"], profileHash: string,
  service: OwnerVeoOmniReferenceService): readonly OwnerVeoOmniReferenceSourceMetadata[] {
  if (!Reflect.apply(NATIVE_GUARD, service, [value]) || value.attempt_id !== input.attemptId || value.profile_sha256 !== profileHash ||
      value.generation_permit !== false || value.epoch < 0 || !Number.isSafeInteger(value.epoch) ||
      !Number.isSafeInteger(value.expires_at) || value.expires_at <= 0 ||
      value.principal.connection_id !== input.attemptId || !sameGenerationPrincipal(value.principal, snapshotGenerationPrincipal(value.principal)) ||
      value.references.length !== input.reference_handles.length) fail("REFERENCE_UNAVAILABLE");
  const sources = value.references.map((reference, index) => {
    const handle = input.reference_handles[index];
    if (!handle || !HANDLE_PATTERN.test(handle) || reference.reference_handle !== handle ||
        (reference.kind !== "image" && reference.kind !== "video") ||
        (reference.kind === "image" ? !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(reference.mime_type) :
          !["video/mp4", "video/quicktime"].includes(reference.mime_type)) || !/^[a-f0-9]{64}$/u.test(reference.sha256) ||
        !Number.isSafeInteger(reference.size) || reference.size < 1 || !Number.isSafeInteger(reference.width) || reference.width < 1 ||
        !Number.isSafeInteger(reference.height) || reference.height < 1 ||
        (reference.kind === "image" ? reference.duration_seconds !== null :
          typeof reference.duration_seconds !== "number" || !Number.isFinite(reference.duration_seconds) ||
          reference.duration_seconds <= 0 || reference.duration_seconds > 10.2)) fail("REFERENCE_UNAVAILABLE");
    return Object.freeze({ reference_handle: reference.reference_handle, kind: reference.kind, mime_type: reference.mime_type,
      size: reference.size, sha256: reference.sha256, width: reference.width, height: reference.height,
      duration_seconds: reference.duration_seconds });
  });
  return Object.freeze(sources);
}

function snapshotCapturedReferences(value: unknown, sources: readonly OwnerVeoOmniReferenceSourceMetadata[]): readonly CapturedReference[] {
  if (!Array.isArray(value) || types.isProxy(value)) fail("REFERENCE_UNAVAILABLE");
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("REFERENCE_UNAVAILABLE");
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length !== sources.length || Reflect.ownKeys(descriptors).length !== length + 1) fail("REFERENCE_UNAVAILABLE");
    const captured: CapturedReference[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) fail("REFERENCE_UNAVAILABLE");
      const fields = exactRecord(descriptor.value, ["reference_handle", "kind", "url"]);
      const source = sources[index]!;
      if (fields.reference_handle !== source.reference_handle || fields.kind !== source.kind || typeof fields.url !== "string" ||
          !isSafeUploadReferenceUrl(fields.url)) fail("REFERENCE_UNAVAILABLE");
      captured.push(Object.freeze({ reference_handle: fields.reference_handle as string,
        kind: fields.kind as "image" | "video", url: fields.url }));
    }
    return Object.freeze(captured);
  } catch (error) { if (error instanceof OwnerVeoOmniReferenceRequestPreparerError) throw error; fail("REFERENCE_UNAVAILABLE"); }
}

function assertCurrentStoreCapture(service: OwnerVeoOmniReferenceService, state: CandidateState): void {
  if (!Reflect.apply(NATIVE_GUARD, service, [state.resolution])) fail("CANDIDATE_EXPIRED");
  let current: CapturedSet | undefined;
  const returned = Reflect.apply(NATIVE_CAPTURE, service, [state.resolution,
    (client: SyntxChatHttpClient, refs: unknown) => {
      const references = snapshotCapturedReferences(refs, state.binding.sources);
      current = Object.freeze({ client, references, wire: state.captured.wire });
      return current;
    }]);
  if (!current || returned !== current || current.client !== state.captured.client ||
      !sameCapturedReferences(current.references, state.captured.references) || isThenableWithoutAccessors(returned)) fail("CANDIDATE_EXPIRED");
}

function sameCapturedReferences(a: readonly CapturedReference[], b: readonly CapturedReference[]): boolean {
  return a.length === b.length && a.every((left, index) => {
    const right = b[index];
    return !!right && left.reference_handle === right.reference_handle && left.kind === right.kind && left.url === right.url;
  });
}

function sameSourceMetadata(a: readonly OwnerVeoOmniReferenceSourceMetadata[], b: readonly OwnerVeoOmniReferenceSourceMetadata[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return !!right && left.reference_handle === right.reference_handle && left.kind === right.kind && left.mime_type === right.mime_type &&
      left.size === right.size && left.sha256 === right.sha256 && left.width === right.width && left.height === right.height &&
      left.duration_seconds === right.duration_seconds;
  });
}

function intentFingerprint(input: CandidateState["rawInput"], profileSha256: string,
  sources: readonly OwnerVeoOmniReferenceSourceMetadata[]): string {
  const ordered = sources.map(({ kind, mime_type, size, sha256, width, height, duration_seconds }) =>
    ({ kind, mime_type, size, sha256, width, height, duration_seconds }));
  return fingerprint(["owner-veo-omni-reference-intent-v1", profileSha256,
    { prompt: input.prompt, input_type: input.input_type,
      controls: { upscale: input.upscale, aspect_ratio: input.aspect_ratio, video_duration: input.video_duration },
      ordered_sources: ordered }]);
}

function makeCandidate(input: { profileSha256: string; requestFingerprint: string; intentFingerprint: string;
  expiresAt: number; sources: readonly OwnerVeoOmniReferenceSourceMetadata[] }): Readonly<OwnerVeoOmniReferencePreparedCandidate> {
  const candidate = Object.create(null) as OwnerVeoOmniReferencePreparedCandidate;
  Object.defineProperties(candidate, {
    status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
    backend_acceptance: { value: "UNPROVEN", enumerable: true }, model_id: { value: "veo_omni", enumerable: true },
    profile_sha256: { value: input.profileSha256, enumerable: true }, request_fingerprint: { value: input.requestFingerprint, enumerable: true },
    intent_fingerprint: { value: input.intentFingerprint, enumerable: true }, expires_at: { value: input.expiresAt, enumerable: true },
    sources: { value: input.sources, enumerable: true }
  });
  return Object.freeze(candidate);
}

function isExactServiceClient(client: unknown): client is SyntxChatHttpClient {
  return !!client && typeof client === "object" && !types.isProxy(client) && Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype;
}

function exactNativeClient(client: unknown): client is SyntxChatHttpClient {
  return isExactServiceClient(client) && !Object.hasOwn(client, "uploadOwnerVeoOmniReference") &&
    SyntxChatHttpClient.prototype.uploadOwnerVeoOmniReference === NATIVE_UPLOAD;
}

function getPrototypeMethod(value: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), name);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

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
  } catch (error) { if (error instanceof OwnerVeoOmniReferenceRequestPreparerError) throw error; fail("INVALID_REQUEST"); }
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal) ||
      Object.getPrototypeOf(signal) !== AbortSignal.prototype) fail("INVALID_REQUEST");
  return signal;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as () => number;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function isThenableWithoutAccessors(value: unknown): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "then");
  return !!descriptor && (!Object.hasOwn(descriptor, "value") || typeof descriptor.value === "function");
}

function mapStoreError(error: unknown): OwnerVeoOmniReferenceRequestPreparerError {
  if (error instanceof OwnerVeoOmniReferenceRequestPreparerError) return error;
  if (error instanceof OwnerVeoOmniReferenceServiceError) {
    if (error.code === "SERVICE_CLOSED") return new OwnerVeoOmniReferenceRequestPreparerError("SERVICE_CLOSED");
    if (error.code === "REQUEST_ABORTED") return new OwnerVeoOmniReferenceRequestPreparerError("REQUEST_ABORTED");
    if (error.code === "REFERENCE_EXPIRED") return new OwnerVeoOmniReferenceRequestPreparerError("REFERENCE_EXPIRED");
    if (error.code === "PRINCIPAL_NOT_LINKED") return new OwnerVeoOmniReferenceRequestPreparerError("PRINCIPAL_MISMATCH");
  }
  if (error && typeof error === "object" && "message" in error && error.message === "INVALID_REFERENCE_WIRE") {
    return new OwnerVeoOmniReferenceRequestPreparerError("WIRE_INVALID");
  }
  return new OwnerVeoOmniReferenceRequestPreparerError("REFERENCE_UNAVAILABLE");
}

function mapPreparerError(error: unknown): OwnerVeoOmniReferenceRequestPreparerError {
  return error instanceof OwnerVeoOmniReferenceRequestPreparerError ? error : mapStoreError(error);
}

function fail(code: OwnerVeoOmniReferenceRequestPreparerErrorCode): never {
  throw new OwnerVeoOmniReferenceRequestPreparerError(code);
}
