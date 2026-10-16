import { types } from "node:util";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerWan27VideoEditSourceProfile,
  type OwnerWan27VideoEditParametersInput
} from "./owner-wan27-videoedit-parameters.js";
import {
  OwnerWan27VideoEditReferenceService, isOwnerWan27VideoEditReferenceService, type OwnerWan27VideoEditOwnedReferences
} from "./owner-wan27-videoedit-reference-service.js";
import { buildOwnerWan27VideoEditWire, type OwnerWan27VideoEditWireCandidate } from "./owner-wan27-videoedit-wire.js";

const TTL_MS = 15 * 60000;
const MAX_CANDIDATES = 128;
const MAX_PENDING = 4;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const FACTORY = Symbol("Wan27VideoEditRequestPreparerFactory");
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, State>();
const STORE = Object.freeze({
  resolve: OwnerWan27VideoEditReferenceService.prototype.resolveReferences,
  guard: OwnerWan27VideoEditReferenceService.prototype.isOwnedReferences,
  capture: OwnerWan27VideoEditReferenceService.prototype.withCapturedReferences,
  invalidate: OwnerWan27VideoEditReferenceService.prototype.invalidateAttempt
});
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadOwnerWan27VideoEditReference;

export interface OwnerWan27VideoEditRequestInput extends Omit<OwnerWan27VideoEditParametersInput, "source_input_duration_seconds"> {
  readonly attemptId: string;
  readonly reference_handles: readonly string[];
}
export type OwnerWan27VideoEditSourceMetadata = OwnerWan27VideoEditOwnedReferences["references"][number];
export interface OwnerWan27VideoEditPreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: "wan_27_videoedit";
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly sources: readonly OwnerWan27VideoEditSourceMetadata[];
}
export interface OwnerWan27VideoEditCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: "wan_27_videoedit";
  readonly profile_sha256: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
  readonly reference_epoch: number;
  readonly sources: readonly OwnerWan27VideoEditSourceMetadata[];
  readonly cost_parameters: OwnerWan27VideoEditWireCandidate["cost_parameters"];
}
export interface OwnerWan27VideoEditRequestPreparerOptions {
  readonly referenceService: OwnerWan27VideoEditReferenceService;
  readonly now?: () => number;
}
export class OwnerWan27VideoEditRequestPreparerError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
    "CAPACITY_EXCEEDED" | "PARAMETERS_INVALID" | "REFERENCE_UNAVAILABLE" | "CANDIDATE_UNBOUND" |
    "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "REQUEST_ABORTED") {
    super("The owner WAN 2.7 Video Edit request could not be prepared safely.");
    this.name = "OwnerWan27VideoEditRequestPreparerError";
  }
}
interface Capture { readonly client: SyntxChatHttpClient; readonly wire: OwnerWan27VideoEditWireCandidate; }
interface State {
  readonly preparer: OwnerWan27VideoEditRequestPreparer;
  readonly candidate: Readonly<OwnerWan27VideoEditPreparedCandidate>;
  readonly binding: Readonly<OwnerWan27VideoEditCandidateBinding>;
  readonly input: Readonly<OwnerWan27VideoEditRequestInput>;
  readonly resolution: OwnerWan27VideoEditOwnedReferences;
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
  prepare(input: unknown, signal?: AbortSignal): Promise<Readonly<OwnerWan27VideoEditPreparedCandidate>>;
  inspectCandidate(candidate: unknown): Readonly<OwnerWan27VideoEditCandidateBinding> | undefined;
  getPrivateRequest(candidate: unknown): OwnerWan27VideoEditWireCandidate;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<Readonly<OwnerWan27VideoEditCandidateBinding>>;
  withCapturedReferences<T>(candidate: unknown, use: (client: SyntxChatHttpClient, wire: OwnerWan27VideoEditWireCandidate) => T): T;
  isBoundToReferenceService(service: unknown): boolean;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

/** A process-local nominal candidate, not provider generation authority. */
export class OwnerWan27VideoEditRequestPreparer implements Api {
  readonly #api: Api;
  constructor(key?: symbol, api?: Api) {
    if (key !== FACTORY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api; PREPARERS.add(this); Object.freeze(this);
  }
  prepare(input: unknown, signal?: AbortSignal) { return this.#api.prepare(input, signal); }
  inspectCandidate(value: unknown) { return this.#api.inspectCandidate(value); }
  getPrivateRequest(value: unknown) { return this.#api.getPrivateRequest(value); }
  revalidateCandidate(value: unknown, signal?: AbortSignal) { return this.#api.revalidateCandidate(value, signal); }
  withCapturedReferences<T>(value: unknown, use: (client: SyntxChatHttpClient, wire: OwnerWan27VideoEditWireCandidate) => T): T {
    return this.#api.withCapturedReferences(value, use);
  }
  isBoundToReferenceService(value: unknown) { return this.#api.isBoundToReferenceService(value); }
  invalidateAttempt(value: unknown) { return this.#api.invalidateAttempt(value); }
  close() { return this.#api.close(); }
}
Object.freeze(OwnerWan27VideoEditRequestPreparer.prototype);

export function createOwnerWan27VideoEditRequestPreparer(optionsInput: unknown): OwnerWan27VideoEditRequestPreparer {
  const options = exact(optionsInput, ["referenceService"], ["now"]);
  const service = options.referenceService;
  if (!isOwnerWan27VideoEditReferenceService(service) ||
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
  const capture = (resolution: OwnerWan27VideoEditOwnedReferences, input: OwnerWan27VideoEditRequestInput): Capture => {
    if (!Reflect.apply(STORE.guard, service, [resolution])) fail("REFERENCE_UNAVAILABLE");
    let result: Capture | undefined;
    const returned = Reflect.apply(STORE.capture, service, [resolution, (client: SyntxChatHttpClient, refs: unknown) => {
      if (!exactClient(client)) fail("REFERENCE_UNAVAILABLE");
      const wire = buildOwnerWan27VideoEditWire(wireInput(input), refs);
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
          getOwnerWan27VideoEditSourceProfile().source_sha256 !== state.binding.profile_sha256) fail("CANDIDATE_EXPIRED");
      const current = capture(state.resolution, state.input);
      if (current.client !== state.capture.client || schemaHash(current.wire) !== state.wireHash) fail("CANDIDATE_EXPIRED");
      return state;
    } catch { expire(state); fail("CANDIDATE_EXPIRED"); }
  };
  const resolve = async (input: OwnerWan27VideoEditRequestInput, signal: AbortSignal): Promise<OwnerWan27VideoEditOwnedReferences> =>
    Reflect.apply(STORE.resolve, service, [{ attemptId: input.attemptId, model_id: input.model_id,
      reference_handles: input.reference_handles }, signal]) as Promise<OwnerWan27VideoEditOwnedReferences>;
  const api: Api = {
    async prepare(value, signal) {
      const input = snapshotInput(value), operation = begin(input.attemptId, signal);
      try {
        stopped(operation); const start = now();
        const resolution = await resolve(input, operation.controller.signal); stopped(operation);
        validateResolution(resolution, input, service);
        const captured = capture(resolution, input); stopped(operation);
        const expiresAt = Math.min(start + TTL_MS, resolution.expires_at);
        if (!Number.isSafeInteger(expiresAt) || now() >= expiresAt) fail("CANDIDATE_EXPIRED");
        const requestFingerprint = schemaHash({ version: "owner-wan27-videoedit-prepared-request-v1", model_id: input.model_id,
          attempt_id: input.attemptId, principal: resolution.principal, profile_sha256: getOwnerWan27VideoEditSourceProfile().source_sha256,
          wire: captured.wire.wire_fingerprint, sources: resolution.references, reference_epoch: resolution.epoch, expires_at: expiresAt });
        const binding: Readonly<OwnerWan27VideoEditCandidateBinding> = Object.freeze({ attempt_id: input.attemptId,
          principal: snapshotGenerationPrincipal(resolution.principal), model_id: input.model_id,
          profile_sha256: getOwnerWan27VideoEditSourceProfile().source_sha256, request_fingerprint: requestFingerprint,
          intent_fingerprint: captured.wire.intent_fingerprint, expires_at: expiresAt, reference_epoch: resolution.epoch,
          sources: resolution.references, cost_parameters: captured.wire.cost_parameters });
        const candidate: Readonly<OwnerWan27VideoEditPreparedCandidate> = Object.freeze({ status: "blocked", dispatch_allowed: false,
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
    withCapturedReferences<T>(value: unknown, use: (client: SyntxChatHttpClient, wire: OwnerWan27VideoEditWireCandidate) => T): T {
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
      if (typeof value !== "string" || !ATTEMPT.test(value)) return Promise.reject(new OwnerWan27VideoEditRequestPreparerError("INVALID_REQUEST"));
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
  const preparer = new OwnerWan27VideoEditRequestPreparer(FACTORY, api);
  return preparer;
}

export function isOwnerWan27VideoEditRequestPreparer(value: unknown): value is OwnerWan27VideoEditRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && PREPARERS.has(value) &&
    Object.getPrototypeOf(value) === OwnerWan27VideoEditRequestPreparer.prototype && Object.isFrozen(value);
}
export function isOwnerWan27VideoEditPreparedCandidate(value: unknown): value is OwnerWan27VideoEditPreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value);
  return !!state && state.candidate === value && state.preparer.inspectCandidate(value) !== undefined;
}
function snapshotInput(value: unknown): Readonly<OwnerWan27VideoEditRequestInput> {
  const f = exact(value, ["attemptId", "reference_handles", "model_id", "prompt", "resolution", "aspect_ratio", "audio_setting",
    "prompt_extend", "seed", "duration_mode"], ["custom_video_duration"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || f.model_id !== "wan_27_videoedit" ||
      !Array.isArray(f.reference_handles) || types.isProxy(f.reference_handles) ||
      Object.getPrototypeOf(f.reference_handles) !== Array.prototype) fail("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptors(f.reference_handles), n = Object.getOwnPropertyDescriptor(f.reference_handles, "length")?.value;
  if (!Number.isSafeInteger(n) || n < 1 || n > 5 || Reflect.ownKeys(d).length !== n + 1) fail("INVALID_REQUEST");
  const handles: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = d[String(i)];
    if (!x?.enumerable || !Object.hasOwn(x, "value") || typeof x.value !== "string" ||
        !/^wan27_videoedit_reference_[0-9a-f-]{36}$/u.test(x.value)) fail("INVALID_REQUEST");
    handles.push(x.value);
  }
  if (new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  return Object.freeze({ ...f, reference_handles: Object.freeze(handles) }) as unknown as Readonly<OwnerWan27VideoEditRequestInput>;
}
function wireInput(input: OwnerWan27VideoEditRequestInput): Omit<OwnerWan27VideoEditParametersInput, "source_input_duration_seconds"> {
  return Object.freeze({ model_id: input.model_id, prompt: input.prompt, resolution: input.resolution,
    aspect_ratio: input.aspect_ratio, audio_setting: input.audio_setting, prompt_extend: input.prompt_extend,
    seed: input.seed, duration_mode: input.duration_mode,
    ...(Object.hasOwn(input, "custom_video_duration") ? { custom_video_duration: input.custom_video_duration! } : {}) });
}
function validateResolution(value: OwnerWan27VideoEditOwnedReferences, input: OwnerWan27VideoEditRequestInput,
  service: OwnerWan27VideoEditReferenceService): void {
  if (!Reflect.apply(STORE.guard, service, [value]) || value.attempt_id !== input.attemptId || value.model_id !== input.model_id ||
      value.profile_sha256 !== getOwnerWan27VideoEditSourceProfile().source_sha256 || value.generation_permit !== false ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 0 || !Number.isSafeInteger(value.expires_at) ||
      value.principal.connection_id !== input.attemptId || value.references.length !== input.reference_handles.length ||
      value.references.some((ref, index) => ref.reference_handle !== input.reference_handles[index])) fail("REFERENCE_UNAVAILABLE");
}
function exactClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype && !Object.hasOwn(value, "uploadOwnerWan27VideoEditReference") &&
    SyntxChatHttpClient.prototype.uploadOwnerWan27VideoEditReference === NATIVE_UPLOAD;
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
function mapError(error: unknown): OwnerWan27VideoEditRequestPreparerError {
  return error instanceof OwnerWan27VideoEditRequestPreparerError ? error : new OwnerWan27VideoEditRequestPreparerError("REFERENCE_UNAVAILABLE");
}
function fail(code: OwnerWan27VideoEditRequestPreparerError["code"]): never { throw new OwnerWan27VideoEditRequestPreparerError(code); }
