import { types } from "node:util";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient, readOwnerKlingKeyframesUploadReferenceForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerKlingKeyframesUploadContext } from "../adapter/syntx/kling-keyframes-upload-context.js";
import {
  OwnerKlingKeyframesReferenceService, type OwnerKlingKeyframesPairResolution,
  type OwnerKlingKeyframesPairResolveInput
} from "./owner-kling-keyframes-reference-service.js";
import { OWNER_KLING_KEYFRAMES_SOURCE_PINS } from "./owner-kling-keyframes-parameters.js";
import { buildOwnerKlingKeyframesWireSettingsTemplate, type OwnerKlingKeyframesWireSettingsTemplate } from "./owner-kling-keyframes-wire-source.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^kling_keyframes_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const MAX_PENDING = 4;
const MAX_ATTEMPTS = 128;
const MAX_PROMPT_UTF16 = 65_536;
const MAX_PROMPT_UTF8 = 128 * 1024;
const PREPARER_KEY = Symbol("OwnerKlingKeyframesRequestPreparerFactory");
const RESOLVE_PAIR = OwnerKlingKeyframesReferenceService.prototype.resolvePair;
const GET_PRIVATE_REFERENCES = OwnerKlingKeyframesReferenceService.prototype.getPrivateReferences;
const OWNED_PAIR = OwnerKlingKeyframesReferenceService.prototype.isOwnedPairResolution;
const CAPTURE_PAIR = OwnerKlingKeyframesReferenceService.prototype.withCapturedNativePair;
const NATIVE_READER = readOwnerKlingKeyframesUploadReferenceForClient;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadKlingKeyframesImage;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();
const NATIVE_BINDINGS = new WeakMap<object, Readonly<{ preparer: object; candidate: object; client: SyntxChatHttpClient;
  contexts: readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext]; assertLive: () => void }>>();

export interface OwnerKlingKeyframesPreparedCandidate {
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly model_id: "kling_keyframes";
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly prompt_utf16_length: number;
  readonly images: readonly [Readonly<SafeImage>, Readonly<SafeImage>];
  readonly expires_at: number;
}

export interface OwnerKlingKeyframesPrivateRequest {
  readonly prompt: string;
  readonly settings: Readonly<OwnerKlingKeyframesWireSettingsTemplate["settings_template"] & {
    readonly file_urls: readonly [{ readonly type: "image"; readonly url: string }, { readonly type: "image"; readonly url: string }];
  }>;
}

export interface OwnerKlingKeyframesNativeBinding {
  readonly status: "captured";
  readonly model_id: "kling_keyframes";
  readonly dispatch_allowed: false;
}

export interface OwnerKlingKeyframesCandidateBinding {
  readonly candidate: OwnerKlingKeyframesPreparedCandidate;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly image_handles: readonly [string, string];
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly prompt_utf16_length: number;
  readonly images: readonly [Readonly<SafeImage>, Readonly<SafeImage>];
  readonly expires_at: number;
  readonly reference_epoch: number;
  readonly reference_expires_at: number;
}

export interface OwnerKlingKeyframesRequestPreparerOptions {
  readonly referenceService: OwnerKlingKeyframesReferenceService;
  readonly now?: () => number;
}

export interface PrepareOwnerKlingKeyframesRequestInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly parameters: unknown;
  readonly controls: unknown;
  readonly image_handles: readonly [string, string];
}

interface SafeImage { readonly mime_type: string; readonly size: number; readonly sha256: string; readonly width: number; readonly height: number }
interface CandidateState {
  readonly candidate: OwnerKlingKeyframesPreparedCandidate;
  readonly attemptId: string;
  readonly handles: readonly [string, string];
  readonly resolution: OwnerKlingKeyframesPairResolution;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly contexts: readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext];
  readonly request: OwnerKlingKeyframesPrivateRequest;
  readonly binding: OwnerKlingKeyframesCandidateBinding;
  readonly expiresAt: number;
  readonly epoch: number;
  nativeBinding?: OwnerKlingKeyframesNativeBinding;
  expired: boolean;
}
interface Pending { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void; readonly remove: () => void; readonly attemptId: string }
interface PreparerApi {
  prepare(input: unknown, signal?: AbortSignal): Promise<OwnerKlingKeyframesPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerKlingKeyframesCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerKlingKeyframesPrivateRequest;
  getNativeBindingForClient(client: unknown, candidate: unknown): OwnerKlingKeyframesNativeBinding;
  revalidateCandidate(candidate: unknown, signal?: AbortSignal): Promise<OwnerKlingKeyframesCandidateBinding>;
  invalidateAttempt(attemptId: unknown): Promise<void>;
  close(): Promise<void>;
}

export type OwnerKlingKeyframesRequestPreparerErrorCode = "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" |
  "REFERENCE_EXPIRED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "PARAMETERS_INVALID" | "PROMPT_INVALID" |
  "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "REQUEST_ABORTED";

export class OwnerKlingKeyframesRequestPreparerError extends Error {
  constructor(readonly code: OwnerKlingKeyframesRequestPreparerErrorCode) {
    super("The owner Kling Keyframes request could not be prepared safely.");
    this.name = "OwnerKlingKeyframesRequestPreparerError";
  }
}

export class OwnerKlingKeyframesRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api; PREPARERS.add(this); Object.freeze(this);
  }
  prepare(input: unknown, signal?: AbortSignal) { return this.#api.prepare(input, signal); }
  inspectCandidate(candidate: unknown) { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown) { return this.#api.getPrivateRequest(candidate); }
  getNativeBindingForClient(client: unknown, candidate: unknown) { return this.#api.getNativeBindingForClient(client, candidate); }
  revalidateCandidate(candidate: unknown, signal?: AbortSignal) { return this.#api.revalidateCandidate(candidate, signal); }
  invalidateAttempt(attemptId: unknown) { return this.#api.invalidateAttempt(attemptId); }
  close() { return this.#api.close(); }
}
Object.freeze(OwnerKlingKeyframesRequestPreparer.prototype);

export function createOwnerKlingKeyframesRequestPreparer(optionsInput: OwnerKlingKeyframesRequestPreparerOptions | unknown): OwnerKlingKeyframesRequestPreparer {
  const fields = exactRecord(optionsInput, ["referenceService"], ["now"]), service = fields.referenceService;
  if (!service || typeof service !== "object" || types.isProxy(service) || !(service instanceof OwnerKlingKeyframesReferenceService) ||
      Object.getPrototypeOf(service) !== OwnerKlingKeyframesReferenceService.prototype ||
      OwnerKlingKeyframesReferenceService.prototype.resolvePair !== RESOLVE_PAIR ||
      OwnerKlingKeyframesReferenceService.prototype.getPrivateReferences !== GET_PRIVATE_REFERENCES ||
      OwnerKlingKeyframesReferenceService.prototype.isOwnedPairResolution !== OWNED_PAIR ||
      OwnerKlingKeyframesReferenceService.prototype.withCapturedNativePair !== CAPTURE_PAIR ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("SERVICE_BINDING_MISMATCH");
  const referenceService = service as OwnerKlingKeyframesReferenceService;
  const clock = fields.now === undefined ? Date.now : readClock(fields.now);
  const candidates = new Set<CandidateState>(), pending = new Set<Pending>(), epochs = new Map<string, number>(), invalidating = new Set<string>();
  let lastNow: number | undefined, closed = false, closing: Promise<void> | undefined;
  const readNow = () => { const value = clock(); if (lastNow !== undefined && value < lastNow) fail("CLOCK_INVALID"); lastNow = value; return value; };
  const checkState = (candidateInput: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED");
    if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || types.isProxy(candidateInput)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(candidateInput as object);
    if (!state || state.candidate !== candidateInput || !candidates.has(state)) fail("CANDIDATE_UNBOUND");
    if (state.expired || invalidating.has(state.attemptId) || state.epoch !== (epochs.get(state.attemptId) ?? 0) || readNow() >= state.expiresAt ||
        !Reflect.apply(OWNED_PAIR, referenceService, [state.resolution, pairInput(state)])) {
      expire(state); fail("CANDIDATE_EXPIRED");
    }
    return state;
  };
  const expire = (state: CandidateState) => {
    state.expired = true; candidates.delete(state); CANDIDATES.delete(state.candidate);
    if (state.nativeBinding) { NATIVE_BINDINGS.delete(state.nativeBinding); delete state.nativeBinding; }
    if (!invalidating.has(state.attemptId) && !Array.from(candidates).some((entry) => entry.attemptId === state.attemptId) &&
        !Array.from(pending).some((entry) => entry.attemptId === state.attemptId)) epochs.delete(state.attemptId);
  };
  const begin = (attemptId: string, parent?: AbortSignal): Pending => {
    if (closed) fail("SERVICE_CLOSED");
    if (invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    const active = new Set([...Array.from(candidates, (state) => state.attemptId), ...Array.from(pending, (operation) => operation.attemptId)]);
    if (pending.size >= MAX_PENDING || (!active.has(attemptId) && active.size >= MAX_ATTEMPTS)) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation = { controller, done, finish, remove: () => parent?.removeEventListener("abort", abort), attemptId };
    pending.add(operation); return operation;
  };
  const finish = (operation: Pending) => {
    operation.remove(); pending.delete(operation); operation.finish();
    if (!invalidating.has(operation.attemptId) && !Array.from(candidates).some((state) => state.attemptId === operation.attemptId) &&
        !Array.from(pending).some((entry) => entry.attemptId === operation.attemptId)) epochs.delete(operation.attemptId);
  };
  const stopped = (operation: Pending) => { if (closed) fail("SERVICE_CLOSED"); if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); };
  const api: PreparerApi = {
    async prepare(inputInput, signal) {
      const input = snapshotInput(inputInput, signal), rawTemplate = (() => {
        try { return buildOwnerKlingKeyframesWireSettingsTemplate({ parameters: input.parameters, controls: input.controls }); }
        catch { fail("PARAMETERS_INVALID"); }
      })();
      assertPrompt(input.prompt);
      prune();
      const operation = begin(input.attemptId, signal), epoch = epochs.get(input.attemptId) ?? 0;
      try {
        stopped(operation);
        const pair = pairInput(input);
        let resolution: OwnerKlingKeyframesPairResolution;
        try { resolution = await Reflect.apply(RESOLVE_PAIR, referenceService, [pair, operation.controller.signal]) as OwnerKlingKeyframesPairResolution; }
        catch { stopped(operation); fail("REFERENCE_UNAVAILABLE"); }
        stopped(operation);
        if (!Reflect.apply(OWNED_PAIR, referenceService, [resolution!, pair])) fail("REFERENCE_UNAVAILABLE");
        let typedReferences: readonly [{ readonly type: "image"; readonly url: string }, { readonly type: "image"; readonly url: string }];
        try { typedReferences = await Reflect.apply(GET_PRIVATE_REFERENCES, referenceService, [resolution!]) as typeof typedReferences; }
        catch { stopped(operation); fail("REFERENCE_UNAVAILABLE"); }
        stopped(operation);
        const capture = Reflect.apply(CAPTURE_PAIR, referenceService, [resolution!, pair, (client: SyntxChatHttpClient,
          contexts: readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext]) => {
          if (!nativeClient(client)) fail("REFERENCE_UNAVAILABLE");
          const references = contexts.map((context) => NATIVE_READER(client, context));
          if (references.some((reference, index) => !reference || reference.url !== typedReferences[index]?.url || typedReferences[index]?.type !== "image")) {
            fail("REFERENCE_EXPIRED");
          }
          const ordered = dedupeTypedReferences(typedReferences);
          return Object.freeze({ client, contexts, ordered });
        }]) as Readonly<{ client: SyntxChatHttpClient; contexts: readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext];
          ordered: readonly [{ readonly type: "image"; readonly url: string }, { readonly type: "image"; readonly url: string }] }>;
        stopped(operation);
        if (epoch !== (epochs.get(input.attemptId) ?? 0) || readNow() >= resolution!.expires_at) fail("REFERENCE_EXPIRED");
        const settings = deepFreeze({ ...rawTemplate.settings_template, file_urls: capture.ordered });
        const request = deepFreeze({ prompt: input.prompt, settings }) as OwnerKlingKeyframesPrivateRequest;
        const expiresAt = Math.min(readNow() + TTL_MS, resolution!.expires_at);
        if (expiresAt <= readNow()) fail("REFERENCE_EXPIRED");
        const images = Object.freeze(resolution!.images.map((image) => Object.freeze({ mime_type: image.mime_type, size: image.size,
          sha256: image.sha256, width: image.width, height: image.height }))) as unknown as readonly [Readonly<SafeImage>, Readonly<SafeImage>];
        const profileHash = schemaHash({ source_pins: OWNER_KLING_KEYFRAMES_SOURCE_PINS, settings_keys: rawTemplate.source.settings_keys,
          file_urls: "ORDERED_TYPED_IMAGE_OBJECTS" });
        const sourceBinding = deepFreeze({ source_pins: OWNER_KLING_KEYFRAMES_SOURCE_PINS,
          settings_keys: rawTemplate.source.settings_keys, typed_reference_projection: "ORDERED_IMAGE_URL_OBJECTS" as const,
          prompt_bounds_local: Object.freeze({ max_utf16_units: MAX_PROMPT_UTF16, max_utf8_bytes: MAX_PROMPT_UTF8, unicode: "WELL_FORMED_NO_NUL" as const }),
          dispatch_status: "SOURCE_REVIEWED_ONLY_BACKEND_UNPROVEN" as const });
        const intentFingerprint = schemaHash({ model_id: "kling_keyframes", prompt: input.prompt,
          settings: rawTemplate.settings_template, images });
        const requestFingerprint = schemaHash(request);
        const candidate = makeCandidate({ profileHash, sourceBinding, requestFingerprint, intentFingerprint,
          promptLength: input.prompt.length, images, expiresAt });
        const binding = candidateBinding(candidate, input, resolution!, images);
        const state: CandidateState = { candidate, attemptId: input.attemptId, handles: input.image_handles, resolution: resolution!,
          principal: resolution!.principal, client: capture.client, contexts: capture.contexts, request, binding, expiresAt, epoch, expired: false };
        prune(); if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED");
        CANDIDATES.set(candidate, state); candidates.add(state); return candidate;
      } finally { finish(operation); }
    },
    inspectCandidate(candidate) { try { return checkState(candidate).binding; } catch { return undefined; } },
    getPrivateRequest(candidate) { return checkState(candidate).request; },
    getNativeBindingForClient(clientInput, candidate) {
      const state = checkState(candidate);
      if (clientInput !== state.client || !nativeClient(clientInput)) fail("SERVICE_BINDING_MISMATCH");
      if (state.nativeBinding) {
        const existing = NATIVE_BINDINGS.get(state.nativeBinding);
        if (!existing || existing.candidate !== state.candidate || existing.client !== clientInput) fail("CANDIDATE_EXPIRED");
        return state.nativeBinding;
      }
      const binding = Object.freeze({ status: "captured", model_id: "kling_keyframes", dispatch_allowed: false }) as OwnerKlingKeyframesNativeBinding;
      NATIVE_BINDINGS.set(binding, Object.freeze({ preparer: api as object, candidate: state.candidate, client: state.client,
        contexts: state.contexts, assertLive: () => { checkState(state.candidate); } }));
      state.nativeBinding = binding;
      return binding;
    },
    async revalidateCandidate(candidateInput, signal) {
      const state = checkState(candidateInput), operation = begin(state.attemptId, signal);
      try {
        const pair = pairInput(state);
        let current: OwnerKlingKeyframesPairResolution;
        try { current = await Reflect.apply(RESOLVE_PAIR, referenceService, [pair, operation.controller.signal]) as OwnerKlingKeyframesPairResolution; }
        catch { stopped(operation); expire(state); fail("REFERENCE_UNAVAILABLE"); }
        stopped(operation);
        if (!Reflect.apply(OWNED_PAIR, referenceService, [current!, pair]) || !samePair(current!, state.resolution)) { expire(state); fail("REFERENCE_EXPIRED"); }
        let refs: readonly [{ readonly type: "image"; readonly url: string }, { readonly type: "image"; readonly url: string }];
        try { refs = await Reflect.apply(GET_PRIVATE_REFERENCES, referenceService, [current!]) as typeof refs; }
        catch { stopped(operation); expire(state); fail("REFERENCE_UNAVAILABLE"); }
        stopped(operation);
        const captured = Reflect.apply(CAPTURE_PAIR, referenceService, [current!, pair, (client: SyntxChatHttpClient,
          contexts: readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext]) => ({ client, contexts,
          urls: contexts.map((context) => NATIVE_READER(client, context)?.url) })]) as { client: SyntxChatHttpClient;
            contexts: readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext]; urls: readonly (string | undefined)[] };
        stopped(operation);
        if (captured.client !== state.client || captured.contexts[0] !== state.contexts[0] || captured.contexts[1] !== state.contexts[1] ||
            refs.length !== 2 || refs.some((reference, index) => reference.type !== "image" || reference.url !== state.request.settings.file_urls[index]?.url ||
              captured.urls[index] !== reference.url) || readNow() >= state.expiresAt || state.epoch !== (epochs.get(state.attemptId) ?? 0)) {
          expire(state); fail("REFERENCE_EXPIRED");
        }
        return state.binding;
      } finally { finish(operation); }
    },
    async invalidateAttempt(attemptIdInput) {
      if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return;
      invalidating.add(attemptIdInput);
      epochs.set(attemptIdInput, (epochs.get(attemptIdInput) ?? 0) + 1);
      const waits: Promise<void>[] = [];
      for (const state of candidates) if (state.attemptId === attemptIdInput) expire(state);
      for (const operation of pending) if (operation.attemptId === attemptIdInput) { operation.controller.abort(); waits.push(operation.done); }
      await Promise.allSettled(waits);
      invalidating.delete(attemptIdInput);
      if (!Array.from(candidates).some((state) => state.attemptId === attemptIdInput) &&
          !Array.from(pending).some((operation) => operation.attemptId === attemptIdInput)) epochs.delete(attemptIdInput);
    },
    async close() {
      if (closing) return closing; closed = true;
      for (const state of [...candidates]) expire(state);
      for (const operation of pending) operation.controller.abort();
      closing = Promise.allSettled(Array.from(pending, (operation) => operation.done)).then(() => {
        candidates.clear(); pending.clear(); epochs.clear(); invalidating.clear();
      });
      return closing;
    }
  };
  function prune() { const now = readNow(); for (const state of candidates) if (state.expired || state.expiresAt <= now) expire(state); }
  return new OwnerKlingKeyframesRequestPreparer(PREPARER_KEY, api);
}

export function isOwnerKlingKeyframesRequestPreparer(value: unknown): value is OwnerKlingKeyframesRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerKlingKeyframesRequestPreparer.prototype &&
    value instanceof OwnerKlingKeyframesRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}

export function isOwnerKlingKeyframesPreparedCandidate(value: unknown): value is OwnerKlingKeyframesPreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CANDIDATES.get(value as object); return !!state && state.candidate === value && !state.expired;
}

/** Internal native-wrapper seam; only an exact live binding minted for this client can reveal captured contexts. */
export function readOwnerKlingKeyframesNativeBindingForClient(clientInput: unknown, bindingInput: unknown):
  readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext] | null {
  if (!nativeClient(clientInput) || !bindingInput || typeof bindingInput !== "object" || types.isProxy(bindingInput)) return null;
  const binding = NATIVE_BINDINGS.get(bindingInput as object);
  if (!binding || binding.client !== clientInput || !Object.isFrozen(bindingInput)) return null;
  try { binding.assertLive(); } catch { return null; }
  const state = CANDIDATES.get(binding.candidate);
  return state && state.candidate === binding.candidate && state.nativeBinding === bindingInput && !state.expired &&
    state.client === clientInput && state.contexts === binding.contexts
    ? binding.contexts : null;
}

function snapshotInput(value: unknown, signal?: AbortSignal): Readonly<PrepareOwnerKlingKeyframesRequestInput> {
  const fields = exactRecord(value, ["attemptId", "prompt", "parameters", "controls", "image_handles"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.prompt !== "string" ||
      (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal)))) fail("INVALID_REQUEST");
  const handles = snapshotHandles(fields.image_handles);
  return Object.freeze({ attemptId: fields.attemptId, prompt: fields.prompt, parameters: fields.parameters,
    controls: fields.controls, image_handles: handles });
}
function snapshotHandles(value: unknown): readonly [string, string] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>, keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 3 || !keys.includes("0") || !keys.includes("1") || !keys.includes("length") || descriptors["length"]?.value !== 2 ||
      !("value" in (descriptors["0"] ?? {})) || !("value" in (descriptors["1"] ?? {}))) fail("INVALID_REQUEST");
  const first = descriptors["0"]!.value, second = descriptors["1"]!.value;
  if (typeof first !== "string" || !HANDLE.test(first) || typeof second !== "string" || !HANDLE.test(second) || first === second) fail("INVALID_REQUEST");
  return Object.freeze([first, second]);
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = new Set([...required, ...optional]);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
  return copy;
}
function assertPrompt(value: string): void {
  if (value.length === 0 || value.trim().length === 0 || value.length > MAX_PROMPT_UTF16 || Buffer.byteLength(value, "utf8") > MAX_PROMPT_UTF8 ||
      value.includes("\0") || !isWellFormedUnicode(value)) fail("PROMPT_INVALID");
}
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(index + 1); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; index += 1; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function pairInput(value: Readonly<PrepareOwnerKlingKeyframesRequestInput> | CandidateState): OwnerKlingKeyframesPairResolveInput {
  const handles = "image_handles" in value ? value.image_handles : value.handles;
  return Object.freeze({ attempt_id: value.attemptId, image_handles: handles });
}
function dedupeTypedReferences(value: readonly [{ readonly type: "image"; readonly url: string }, { readonly type: "image"; readonly url: string }]):
  readonly [{ readonly type: "image"; readonly url: string }, { readonly type: "image"; readonly url: string }] {
  const kept: { readonly type: "image"; readonly url: string }[] = [], seen = new Set<string>();
  for (const reference of value) {
    if (!reference || reference.type !== "image" || typeof reference.url !== "string" || reference.url.length === 0) fail("REFERENCE_UNAVAILABLE");
    const key = `${reference.type}:${reference.url}`; if (!seen.has(key)) { seen.add(key); kept.push(Object.freeze({ type: "image", url: reference.url })); }
  }
  if (kept.length !== 2) fail("REFERENCE_UNAVAILABLE");
  return Object.freeze(kept) as unknown as readonly [{ readonly type: "image"; readonly url: string }, { readonly type: "image"; readonly url: string }];
}
function samePair(a: OwnerKlingKeyframesPairResolution, b: OwnerKlingKeyframesPairResolution): boolean {
  return a.attempt_id === b.attempt_id && sameGenerationPrincipal(a.principal, b.principal) && a.epoch === b.epoch &&
    a.expires_at === b.expires_at && a.images.every((image, index) => image.image_handle === b.images[index]?.image_handle &&
      image.sha256 === b.images[index]?.sha256 && image.mime_type === b.images[index]?.mime_type && image.size === b.images[index]?.size &&
      image.width === b.images[index]?.width && image.height === b.images[index]?.height);
}
function nativeClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    !Object.hasOwn(value, "uploadKlingKeyframesImage") && SyntxChatHttpClient.prototype.uploadKlingKeyframesImage === NATIVE_UPLOAD;
}
function makeCandidate(input: { profileHash: string; sourceBinding: Readonly<Record<string, unknown>>; requestFingerprint: string;
  intentFingerprint: string; promptLength: number; images: readonly [Readonly<SafeImage>, Readonly<SafeImage>]; expiresAt: number }): OwnerKlingKeyframesPreparedCandidate {
  const candidate = Object.create(null) as OwnerKlingKeyframesPreparedCandidate;
  Object.defineProperties(candidate, { status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
    runtime_usable: { value: false, enumerable: true }, backend_acceptance: { value: "UNPROVEN", enumerable: true }, model_id: { value: "kling_keyframes", enumerable: true },
    profile_schema_hash: { value: input.profileHash, enumerable: true }, source_binding: { value: input.sourceBinding, enumerable: true },
    request_fingerprint: { value: input.requestFingerprint, enumerable: true }, intent_fingerprint: { value: input.intentFingerprint, enumerable: true },
    prompt_utf16_length: { value: input.promptLength, enumerable: true }, images: { value: input.images, enumerable: true }, expires_at: { value: input.expiresAt, enumerable: true } });
  return Object.freeze(candidate);
}
function candidateBinding(candidate: OwnerKlingKeyframesPreparedCandidate, input: Readonly<PrepareOwnerKlingKeyframesRequestInput>,
  resolution: OwnerKlingKeyframesPairResolution, images: readonly [Readonly<SafeImage>, Readonly<SafeImage>]): OwnerKlingKeyframesCandidateBinding {
  return Object.freeze({ candidate, attempt_id: input.attemptId, principal: resolution.principal, image_handles: input.image_handles,
    profile_schema_hash: candidate.profile_schema_hash, source_binding: candidate.source_binding,
    request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint,
    prompt_utf16_length: candidate.prompt_utf16_length, images, expires_at: candidate.expires_at,
    reference_epoch: resolution.epoch, reference_expires_at: resolution.expires_at });
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function readClock(value: unknown): () => number {
  return () => { let now: unknown; try { now = Reflect.apply(value as () => unknown, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("CLOCK_INVALID"); return now as number; };
}
function fail(code: OwnerKlingKeyframesRequestPreparerErrorCode): never { throw new OwnerKlingKeyframesRequestPreparerError(code); }
