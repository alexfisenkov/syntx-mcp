import { types } from "node:util";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerKling4SourceProfile, normalizeOwnerKling4Parameters,
  type NormalizedOwnerKling4Parameters, type OwnerKling4ParameterCandidateInput, type OwnerKling4ParametersModelId
} from "./owner-kling4-parameters.js";
import {
  OwnerKling4ReferenceService, isOwnerKling4ReferenceService, type OwnerKling4OwnedReferences
} from "./owner-kling4-reference-service.js";
import { buildOwnerKling4Wire, type OwnerKling4WireCandidate } from "./owner-kling4-wire.js";

const TTL_MS = 15 * 60000;
const MAX_CANDIDATES = 128;
const MAX_PENDING = 4;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const FACTORY = Symbol("Kling4RequestPreparerFactory");
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, State>();
const STORE = Object.freeze({
  resolve: OwnerKling4ReferenceService.prototype.resolveReferences,
  guard: OwnerKling4ReferenceService.prototype.isOwnedReferences,
  capture: OwnerKling4ReferenceService.prototype.withCapturedReferences,
  invalidate: OwnerKling4ReferenceService.prototype.invalidateAttempt
});
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadOwnerKling4Reference;

export type OwnerKling4SourceMetadata = OwnerKling4OwnedReferences["references"][number];
export interface OwnerKling4PreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: OwnerKling4ParametersModelId;
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly sources: readonly OwnerKling4SourceMetadata[];
}
export interface OwnerKling4CandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerKling4ParametersModelId;
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly reference_epoch: number;
  readonly sources: readonly OwnerKling4SourceMetadata[];
  readonly cost_parameters: OwnerKling4WireCandidate["cost_parameters"];
}
export interface OwnerKling4RequestPreparerOptions {
  readonly referenceService: OwnerKling4ReferenceService;
  readonly now?: () => number;
}
export class OwnerKling4RequestPreparerError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
    "CAPACITY_EXCEEDED" | "PARAMETERS_INVALID" | "REFERENCE_UNAVAILABLE" | "CANDIDATE_UNBOUND" |
    "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "REQUEST_ABORTED") {
    super("The owner Kling 4 request could not be prepared safely.");
    this.name = "OwnerKling4RequestPreparerError";
  }
}
interface Capture { readonly client: SyntxChatHttpClient; readonly wire: OwnerKling4WireCandidate; }
interface State {
  readonly preparer: OwnerKling4RequestPreparer;
  readonly candidate: Readonly<OwnerKling4PreparedCandidate>;
  readonly binding: Readonly<OwnerKling4CandidateBinding>;
  readonly input: Readonly<OwnerKling4ParameterCandidateInput>;
  readonly resolution: OwnerKling4OwnedReferences;
  readonly capture: Capture;
  readonly epoch: number;
  readonly wireHash: string;
  expired: boolean;
}
interface Pending {
  readonly attempt: string; readonly epoch: number; readonly controller: AbortController;
  readonly done: Promise<void>; readonly finish: () => void; readonly remove: () => void;
}
interface Api {
  prepare(input: unknown, signal?: AbortSignal): Promise<Readonly<OwnerKling4PreparedCandidate>>;
  inspectCandidate(candidate: unknown): Readonly<OwnerKling4CandidateBinding> | undefined;
  getPrivateRequest(candidate: unknown): OwnerKling4WireCandidate;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<Readonly<OwnerKling4CandidateBinding>>;
  withCapturedReferences<T>(candidate: unknown, use: (client: SyntxChatHttpClient, wire: OwnerKling4WireCandidate) => T): T;
  isBoundToReferenceService(service: unknown): boolean;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

/** A process-local nominal candidate, not provider generation authority. */
export class OwnerKling4RequestPreparer implements Api {
  readonly #api: Api;
  constructor(key?: symbol, api?: Api) {
    if (key !== FACTORY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api; PREPARERS.add(this); Object.freeze(this);
  }
  prepare(input: unknown, signal?: AbortSignal) { return this.#api.prepare(input, signal); }
  inspectCandidate(value: unknown) { return this.#api.inspectCandidate(value); }
  getPrivateRequest(value: unknown) { return this.#api.getPrivateRequest(value); }
  revalidateCandidate(value: unknown, signal?: AbortSignal) { return this.#api.revalidateCandidate(value, signal); }
  withCapturedReferences<T>(value: unknown, use: (client: SyntxChatHttpClient, wire: OwnerKling4WireCandidate) => T): T {
    return this.#api.withCapturedReferences(value, use);
  }
  isBoundToReferenceService(value: unknown) { return this.#api.isBoundToReferenceService(value); }
  invalidateAttempt(value: unknown) { return this.#api.invalidateAttempt(value); }
  close() { return this.#api.close(); }
}
Object.freeze(OwnerKling4RequestPreparer.prototype);

export function createOwnerKling4RequestPreparer(optionsInput: unknown): OwnerKling4RequestPreparer {
  const options = exact(optionsInput, ["referenceService"], ["now"]);
  const service = options.referenceService;
  if (!isOwnerKling4ReferenceService(service) ||
      (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("SERVICE_BINDING_MISMATCH");
  const clock = options.now as (() => number) | undefined ?? Date.now;
  const states = new Set<State>(), pending = new Set<Pending>();
  const epochs = new Map<string, number>(), invalidations = new Map<string, Promise<void>>();
  let lastNow = -1, closed = false, closing: Promise<void> | undefined;
  const now = () => {
    let value: unknown; try { value = clock(); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) < lastNow) fail("CLOCK_INVALID");
    lastNow = value as number; return lastNow;
  };
  const expire = (state: State) => { state.expired = true; states.delete(state); CANDIDATES.delete(state.candidate); };
  const prune = () => { const time = now(); for (const state of states) if (time >= state.binding.expires_at) expire(state); };
  const begin = (attempt: string, parent?: AbortSignal, allocatesCandidate = true): Pending => {
    if (closed) fail("SERVICE_CLOSED");
    if (invalidations.has(attempt)) fail("REQUEST_ABORTED");
    if (parent !== undefined && (!parent || types.isProxy(parent) || Object.getPrototypeOf(parent) !== AbortSignal.prototype)) fail("INVALID_REQUEST");
    if (parent?.aborted) fail("REQUEST_ABORTED");
    prune();
    if (pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
    if (allocatesCandidate && states.size + pending.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort();
    parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const operation = { attempt, epoch: epochs.get(attempt) ?? 0, controller, done, finish,
      remove: () => parent?.removeEventListener("abort", abort) };
    pending.add(operation); return operation;
  };
  const stopped = (operation: Pending) => {
    if (closed) fail("SERVICE_CLOSED");
    if (operation.controller.signal.aborted || invalidations.has(operation.attempt) ||
        operation.epoch !== (epochs.get(operation.attempt) ?? 0)) fail("REQUEST_ABORTED");
  };
  const finish = (operation: Pending) => { operation.remove(); pending.delete(operation); operation.finish(); };
  const capture = (resolution: OwnerKling4OwnedReferences, input: OwnerKling4ParameterCandidateInput): Capture => {
    if (!Reflect.apply(STORE.guard, service, [resolution])) fail("REFERENCE_UNAVAILABLE");
    let result: Capture | undefined;
    const returned = Reflect.apply(STORE.capture, service, [resolution, (client: SyntxChatHttpClient, refs: unknown) => {
      if (!exactClient(client)) fail("REFERENCE_UNAVAILABLE");
      const wire = buildOwnerKling4Wire(input, refs);
      result = Object.freeze({ client, wire }); return result;
    }]);
    if (!result || result !== returned) fail("REFERENCE_UNAVAILABLE");
    return result;
  };
  const check = (value: unknown): State => {
    if (closed) fail("SERVICE_CLOSED");
    if (!value || typeof value !== "object" || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value);
    if (!state || state.candidate !== value || state.preparer !== preparer || !states.has(state)) fail("CANDIDATE_UNBOUND");
    try {
      if (state.expired || invalidations.has(state.binding.attempt_id) || now() >= state.binding.expires_at ||
          state.epoch !== (epochs.get(state.binding.attempt_id) ?? 0) ||
          getOwnerKling4SourceProfile(state.binding.model_id).source_sha256 !== state.binding.profile_sha256) fail("CANDIDATE_EXPIRED");
      const current = capture(state.resolution, state.input);
      if (current.client !== state.capture.client || schemaHash(current.wire) !== state.wireHash) fail("CANDIDATE_EXPIRED");
      return state;
    } catch { expire(state); fail("CANDIDATE_EXPIRED"); }
  };
  const resolve = async (input: OwnerKling4ParameterCandidateInput, signal: AbortSignal): Promise<OwnerKling4OwnedReferences> =>
    Reflect.apply(STORE.resolve, service, [{ attemptId: input.attemptId, model_id: input.model_id,
      reference_handles: input.reference_handles }, signal]) as Promise<OwnerKling4OwnedReferences>;
  const api: Api = {
    async prepare(value, signal) {
      let normalized: Readonly<NormalizedOwnerKling4Parameters>;
      try { normalized = normalizeOwnerKling4Parameters(value); } catch { fail("PARAMETERS_INVALID"); }
      const input = rawInput(normalized), operation = begin(input.attemptId, signal);
      try {
        stopped(operation); const start = now();
        const resolution = await resolve(input, operation.controller.signal); stopped(operation);
        validateResolution(resolution, input, service);
        const captured = capture(resolution, input); stopped(operation);
        const expiresAt = Math.min(start + TTL_MS, resolution.expires_at);
        if (!Number.isSafeInteger(expiresAt) || now() >= expiresAt) fail("CANDIDATE_EXPIRED");
        const requestFingerprint = schemaHash({ version: "owner-kling4-prepared-request-v1", model_id: input.model_id,
          attempt_id: input.attemptId, principal: resolution.principal, profile_sha256: normalized.profile_sha256,
          wire: captured.wire.wire_fingerprint, sources: resolution.references, reference_epoch: resolution.epoch, expires_at: expiresAt });
        const binding: Readonly<OwnerKling4CandidateBinding> = Object.freeze({ attempt_id: input.attemptId,
          principal: snapshotGenerationPrincipal(resolution.principal), model_id: input.model_id,
          profile_sha256: normalized.profile_sha256, request_fingerprint: requestFingerprint,
          intent_fingerprint: captured.wire.intent_fingerprint, expires_at: expiresAt, reference_epoch: resolution.epoch,
          sources: resolution.references, cost_parameters: captured.wire.cost_parameters });
        const candidate: Readonly<OwnerKling4PreparedCandidate> = Object.freeze({ status: "blocked", dispatch_allowed: false,
          backend_acceptance: "UNPROVEN", model_id: binding.model_id, profile_sha256: binding.profile_sha256,
          request_fingerprint: requestFingerprint, intent_fingerprint: binding.intent_fingerprint, expires_at: expiresAt, sources: binding.sources });
        const state: State = { preparer, candidate, binding, input, resolution, capture: captured, epoch: operation.epoch,
          wireHash: schemaHash(captured.wire), expired: false };
        CANDIDATES.set(candidate, state); states.add(state); return candidate;
      } catch (error) { stopped(operation); throw mapError(error); }
      finally { finish(operation); }
    },
    inspectCandidate(value) { try { return check(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return check(value).capture.wire; },
    async revalidateCandidate(value, signal) {
      const state = check(value), operation = begin(state.binding.attempt_id, signal, false);
      try {
        stopped(operation); const fresh = await resolve(state.input, operation.controller.signal); stopped(operation);
        validateResolution(fresh, state.input, service);
        const current = capture(fresh, state.input);
        if (!sameGenerationPrincipal(fresh.principal, state.binding.principal) || fresh.epoch !== state.resolution.epoch ||
            schemaHash(fresh.references) !== schemaHash(state.binding.sources) || current.client !== state.capture.client ||
            schemaHash(current.wire) !== state.wireHash) fail("CANDIDATE_EXPIRED");
        return check(value).binding;
      } catch (error) { expire(state); stopped(operation); throw mapError(error); }
      finally { finish(operation); }
    },
    withCapturedReferences<T>(value: unknown, use: (client: SyntxChatHttpClient, wire: OwnerKling4WireCandidate) => T): T {
      if (typeof use !== "function" || types.isProxy(use)) fail("INVALID_REQUEST");
      const state = check(value), result = use(state.capture.client, state.capture.wire);
      if (result && typeof result === "object") {
        if (types.isProxy(result)) fail("INVALID_REQUEST");
        const then = Object.getOwnPropertyDescriptor(result, "then");
        if (result instanceof Promise || then && (!Object.hasOwn(then, "value") || typeof then.value === "function")) fail("INVALID_REQUEST");
      }
      return result;
    },
    isBoundToReferenceService(value) { return value === service; },
    invalidateAttempt(value) {
      if (typeof value !== "string" || !ATTEMPT.test(value)) return Promise.reject(new OwnerKling4RequestPreparerError("INVALID_REQUEST"));
      const existing = invalidations.get(value); if (existing) return existing;
      epochs.set(value, (epochs.get(value) ?? 0) + 1);
      for (const state of states) if (state.binding.attempt_id === value) expire(state);
      const waits: Promise<unknown>[] = [];
      for (const operation of pending) if (operation.attempt === value) { operation.controller.abort(); waits.push(operation.done); }
      const invalidate = Promise.resolve().then(() => Reflect.apply(STORE.invalidate, service, [value]));
      const complete = Promise.allSettled([...waits, invalidate]).then(results => {
        const error = results.find(result => result.status === "rejected");
        if (error?.status === "rejected") throw mapError(error.reason);
      }).finally(() => { invalidations.delete(value); epochs.delete(value); });
      invalidations.set(value, complete); return complete;
    },
    close() {
      if (closing) return closing;
      closed = true; for (const state of states) expire(state);
      for (const operation of pending) operation.controller.abort();
      closing = Promise.allSettled([...pending].map(operation => operation.done).concat([...invalidations.values()]))
        .then(() => { states.clear(); epochs.clear(); invalidations.clear(); });
      return closing;
    }
  };
  const preparer = new OwnerKling4RequestPreparer(FACTORY, api);
  return preparer;
}

export function isOwnerKling4RequestPreparer(value: unknown): value is OwnerKling4RequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value) &&
    Object.getPrototypeOf(value) === OwnerKling4RequestPreparer.prototype && Object.isFrozen(value);
}
export function isOwnerKling4PreparedCandidate(value: unknown): value is OwnerKling4PreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value);
  return !!state && state.candidate === value && state.preparer.inspectCandidate(value) !== undefined;
}
function rawInput(value: NormalizedOwnerKling4Parameters): Readonly<OwnerKling4ParameterCandidateInput> {
  return Object.freeze({ attemptId: value.attemptId, model_id: value.model_id, prompt: value.prompt, version: value.version,
    mode: value.mode, aspect_ratio: value.aspect_ratio, video_duration: value.video_duration,
    native_audio: value.native_audio, reference_handles: value.reference_handles });
}
function validateResolution(value: OwnerKling4OwnedReferences, input: OwnerKling4ParameterCandidateInput,
  service: OwnerKling4ReferenceService): void {
  if (!Reflect.apply(STORE.guard, service, [value]) || value.attempt_id !== input.attemptId || value.model_id !== input.model_id ||
      value.profile_sha256 !== getOwnerKling4SourceProfile(input.model_id).source_sha256 || value.generation_permit !== false ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 0 || !Number.isSafeInteger(value.expires_at) ||
      value.principal.connection_id !== input.attemptId || value.references.length !== input.reference_handles.length ||
      value.references.some((ref, index) => ref.reference_handle !== input.reference_handles[index])) fail("REFERENCE_UNAVAILABLE");
}
function exactClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype && !Object.hasOwn(value, "uploadOwnerKling4Reference") &&
    SyntxChatHttpClient.prototype.uploadOwnerKling4Reference === NATIVE_UPLOAD;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (prototype !== Object.prototype && prototype !== null || required.some(key => !Object.hasOwn(descriptors, key)) ||
      keys.some(key => typeof key !== "string" || ![...required, ...optional].includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || !descriptors[key]!.enumerable)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function mapError(error: unknown): OwnerKling4RequestPreparerError {
  return error instanceof OwnerKling4RequestPreparerError ? error : new OwnerKling4RequestPreparerError("REFERENCE_UNAVAILABLE");
}
function fail(code: OwnerKling4RequestPreparerError["code"]): never { throw new OwnerKling4RequestPreparerError(code); }
