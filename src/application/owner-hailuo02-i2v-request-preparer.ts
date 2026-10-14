import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readOwnerHailuo02I2vUploadReferenceForClient } from "../adapter/syntx/hailuo02-i2v-upload-context.js";
import { OwnerHailuo02I2vImageReferenceService, type OwnerHailuo02I2vImageResolution } from "./owner-hailuo02-i2v-image-reference-service.js";
import { normalizeOwnerHailuo02I2vParameters, type OwnerHailuo02I2vNormalizedParameters } from "./owner-hailuo02-i2v-parameters.js";
import { OWNER_HAILUO02_I2V_SOURCE_PROFILE, OWNER_HAILUO02_I2V_SOURCE_PINS } from "./owner-hailuo02-i2v-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^h02img_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_CANDIDATES = 128;
const PREPARER_KEY = Symbol("OwnerHailuo02I2vRequestPreparerFactory");
const RESOLVE = OwnerHailuo02I2vImageReferenceService.prototype.resolveReference;
const GUARD = OwnerHailuo02I2vImageReferenceService.prototype.isOwnedResolution;
const CAPTURE = OwnerHailuo02I2vImageReferenceService.prototype.withCapturedNativeImage;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();

export interface OwnerHailuo02I2vPreparedCandidate {
  readonly status: "blocked"; readonly dispatch_allowed: false; readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN"; readonly model_id: "hailuo-02";
  readonly profile_schema_hash: string; readonly source_binding: Readonly<Record<string, unknown>>;
  readonly request_fingerprint: string; readonly intent_fingerprint: string;
  readonly prompt_utf16_length: number; readonly image: Readonly<{ mime_type: string; size: number; sha256: string; width: number; height: number }>;
  readonly expires_at: number;
}
export interface OwnerHailuo02I2vPreparedRequest { readonly prompt: string; readonly settings: Readonly<{
  readonly model_type: "hailuo-02"; readonly resolution: string; readonly video_duration: number;
  readonly file_urls: readonly Readonly<{ readonly type: "image"; readonly url: string }>[];
}> }
export interface OwnerHailuo02I2vCandidateBinding {
  readonly attempt_id: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly image_handle: string;
  readonly profile_schema_hash: string; readonly source_binding: Readonly<Record<string, unknown>>;
  readonly image_sha256: string; readonly image_epoch: number; readonly image_expires_at: number;
  readonly expires_at: number; readonly request_fingerprint: string; readonly intent_fingerprint: string;
  readonly intent: Readonly<{ prompt: string; resolution: string; video_duration: number }>;
}
export interface OwnerHailuo02I2vRequestPreparerOptions { readonly imageReferenceService: OwnerHailuo02I2vImageReferenceService; readonly now?: () => number }
export interface PrepareOwnerHailuo02I2vRequestInput {
  readonly attemptId: string; readonly model_id: "hailuo-02"; readonly prompt: string;
  readonly resolution: string; readonly video_duration: number; readonly image_handle: string;
}
interface CandidateState {
  readonly candidate: OwnerHailuo02I2vPreparedCandidate; readonly attemptId: string; readonly handle: string;
  readonly resolution: OwnerHailuo02I2vImageResolution; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly normalized: OwnerHailuo02I2vNormalizedParameters; readonly request: OwnerHailuo02I2vPreparedRequest;
  readonly binding: OwnerHailuo02I2vCandidateBinding; readonly client: SyntxChatHttpClient; readonly nativeReference: unknown;
  readonly expiresAt: number; readonly epoch: number; expired: boolean;
}
interface PreparerApi {
  prepare(input: unknown): Promise<OwnerHailuo02I2vPreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerHailuo02I2vCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerHailuo02I2vPreparedRequest;
  revalidateCandidate(candidate: unknown): Promise<OwnerHailuo02I2vCandidateBinding>;
  invalidateAttempt(attemptId: string): Promise<void>; close(): Promise<void>;
}
export type OwnerHailuo02I2vRequestPreparerErrorCode = "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" |
  "REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" |
  "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";
export class OwnerHailuo02I2vRequestPreparerError extends Error {
  constructor(readonly code: OwnerHailuo02I2vRequestPreparerErrorCode) { super("The owned Hailuo-02 I2V request could not be prepared safely."); this.name = "OwnerHailuo02I2vRequestPreparerError"; }
}
export class OwnerHailuo02I2vRequestPreparer implements PreparerApi {
  readonly #api: PreparerApi;
  constructor(key?: symbol, api?: PreparerApi) { if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH"); this.#api = api; PREPARERS.add(this); Object.freeze(this); }
  prepare(input: unknown) { return this.#api.prepare(input); }
  inspectCandidate(candidate: unknown) { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown) { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown) { return this.#api.revalidateCandidate(candidate); }
  invalidateAttempt(attemptId: string) { return this.#api.invalidateAttempt(attemptId); }
  close() { return this.#api.close(); }
}
Object.freeze(OwnerHailuo02I2vRequestPreparer.prototype);

export function createOwnerHailuo02I2vRequestPreparer(optionsInput: OwnerHailuo02I2vRequestPreparerOptions | unknown): OwnerHailuo02I2vRequestPreparer {
  const f = exact(optionsInput, ["imageReferenceService"], ["now"]), service = f.imageReferenceService;
  if (!(service instanceof OwnerHailuo02I2vImageReferenceService) || Object.getPrototypeOf(service) !== OwnerHailuo02I2vImageReferenceService.prototype ||
      OwnerHailuo02I2vImageReferenceService.prototype.resolveReference !== RESOLVE ||
      OwnerHailuo02I2vImageReferenceService.prototype.isOwnedResolution !== GUARD ||
      OwnerHailuo02I2vImageReferenceService.prototype.withCapturedNativeImage !== CAPTURE ||
      (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("SERVICE_BINDING_MISMATCH");
  const imageService = service as OwnerHailuo02I2vImageReferenceService;
  const clock = f.now === undefined ? Date.now : readClock(f.now), candidates = new Set<CandidateState>(), epochs = new Map<string, number>();
  let lastNow = clock(), closed = false;
  const readNow = () => { const n = clock(); if (n < lastNow) fail("CLOCK_INVALID"); lastNow = n; return n; };
  const stateFor = (value: unknown): CandidateState => {
    if (closed) fail("SERVICE_CLOSED"); if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = CANDIDATES.get(value as object), isLocal = !!state && candidates.has(state), now = readNow();
    if (!state || !isLocal || state.candidate !== value || state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || now >= state.expiresAt ||
        !imageService.isOwnedResolution(state.resolution, { attempt_id: state.attemptId, image_handle: state.handle })) {
      if (state && isLocal) { state.expired = true; candidates.delete(state); } fail("CANDIDATE_EXPIRED");
    }
    return state;
  };
  const api: PreparerApi = {
    async prepare(inputInput) {
      if (closed) fail("SERVICE_CLOSED"); const input = snapshotInput(inputInput);
      let normalized: OwnerHailuo02I2vNormalizedParameters;
      try { normalized = normalizeOwnerHailuo02I2vParameters({ model_id: input.model_id, prompt: input.prompt, resolution: input.resolution,
        video_duration: input.video_duration, image_handle: input.image_handle }); } catch { fail("PARAMETERS_INVALID"); }
      const epoch = epochs.get(input.attemptId) ?? 0, resolveInput = Object.freeze({ attempt_id: input.attemptId, image_handle: input.image_handle });
      let resolution: OwnerHailuo02I2vImageResolution;
      try { resolution = await Reflect.apply(RESOLVE, imageService, [resolveInput]) as OwnerHailuo02I2vImageResolution; }
      catch (error) { if (error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED"); fail("REFERENCE_UNAVAILABLE"); }
      if (closed || epoch !== (epochs.get(input.attemptId) ?? 0)) fail("CANDIDATE_EXPIRED");
      assertResolution(resolution!, input, imageService);
      const captured = Reflect.apply(CAPTURE, imageService, [resolution!, resolveInput,
        (client: SyntxChatHttpClient, nativeReference: unknown) => {
          if (!(client instanceof SyntxChatHttpClient)) fail("REFERENCE_UNAVAILABLE");
          const details = readOwnerHailuo02I2vUploadReferenceForClient(client, nativeReference);
          if (!details || !isSafeUploadReferenceUrl(details.url)) fail("REFERENCE_UNAVAILABLE");
          return Object.freeze({ client, nativeReference, url: details.url });
        }]) as Readonly<{ client: SyntxChatHttpClient; nativeReference: unknown; url: string }>;
      const now = readNow(), expiresAt = Math.min(now + TTL_MS, resolution!.expires_at);
      if (expiresAt <= now) fail("REFERENCE_EXPIRED");
      const settings = deepFreeze({ model_type: "hailuo-02" as const, resolution: normalized!.intent.resolution,
        video_duration: normalized!.intent.video_duration, file_urls: [{ type: "image" as const, url: captured.url }] });
      const request = deepFreeze({ prompt: normalized!.intent.prompt, settings });
      const profileHash = schemaHash(OWNER_HAILUO02_I2V_SOURCE_PROFILE);
      const sourceBinding = deepFreeze({ source_pins: OWNER_HAILUO02_I2V_SOURCE_PINS,
        settings_keys: OWNER_HAILUO02_I2V_SOURCE_PROFILE.wire.settings_keys,
        sender_projection: "PINNED_VIDEO_SENDER_SHALLOW_COPIES_SETTINGS_NO_N_INSERTION" as const,
        dispatch_status: "SOURCE_REVIEWED_ONLY_BACKEND_UNPROVEN" as const });
      const intentFingerprint = schemaHash({ tenant_id: resolution!.principal.tenant_id, subject_id: resolution!.principal.subject_id,
        model_id: "hailuo-02", profile_schema_hash: profileHash, prompt: normalized!.intent.prompt,
        resolution: normalized!.intent.resolution, video_duration: normalized!.intent.video_duration,
        image: { sha256: resolution!.sha256, mime_type: resolution!.mime_type, size: resolution!.size } });
      const requestFingerprint = schemaHash(request);
      const candidate = makeCandidate({ profileHash, sourceBinding, requestFingerprint, intentFingerprint, normalized: normalized!, resolution: resolution!, expiresAt });
      const binding = deepFreeze({ attempt_id: input.attemptId, principal: resolution!.principal, image_handle: input.image_handle,
        profile_schema_hash: profileHash, source_binding: sourceBinding, image_sha256: resolution!.sha256, image_epoch: resolution!.epoch,
        image_expires_at: resolution!.expires_at, expires_at: expiresAt, request_fingerprint: requestFingerprint,
        intent_fingerprint: intentFingerprint, intent: normalized!.intent });
      const state: CandidateState = { candidate, attemptId: input.attemptId, handle: input.image_handle, resolution: resolution!, principal: resolution!.principal,
        normalized: normalized!, request, binding, client: captured.client, nativeReference: captured.nativeReference,
        expiresAt, epoch, expired: false };
      prune(); if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED"); CANDIDATES.set(candidate, state); candidates.add(state); return candidate;
    },
    inspectCandidate(value) { try { return stateFor(value).binding; } catch { return undefined; } },
    getPrivateRequest(value) { return stateFor(value).request; },
    async revalidateCandidate(value) {
      const state = stateFor(value), resolveInput = Object.freeze({ attempt_id: state.attemptId, image_handle: state.handle });
      let current: OwnerHailuo02I2vImageResolution;
      try { current = await Reflect.apply(RESOLVE, imageService, [resolveInput]) as OwnerHailuo02I2vImageResolution; }
      catch { state.expired = true; fail("REFERENCE_UNAVAILABLE"); }
      if (closed || state.epoch !== (epochs.get(state.attemptId) ?? 0) || !imageService.isOwnedResolution(current!, resolveInput) || !sameResolution(current!, state.resolution) ||
          current!.epoch !== state.resolution.epoch || readNow() >= state.expiresAt) { state.expired = true; fail("REFERENCE_EXPIRED"); }
      const capturedAgain = Reflect.apply(CAPTURE, imageService, [current!, resolveInput,
        (client: SyntxChatHttpClient, nativeReference: unknown) => ({ client, nativeReference })]) as { client: SyntxChatHttpClient; nativeReference: unknown };
      if (capturedAgain.client !== state.client || capturedAgain.nativeReference !== state.nativeReference) { state.expired = true; fail("REFERENCE_UNAVAILABLE"); }
      return state.binding;
    },
    async invalidateAttempt(attemptId) { if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) return;
      epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1); for (const state of candidates) if (state.attemptId === attemptId) { state.expired = true; candidates.delete(state); }
      await imageService.invalidateAttempt(attemptId); },
    async close() { if (closed) return; closed = true; for (const state of candidates) state.expired = true; candidates.clear(); epochs.clear(); }
  };
  function prune() { const now = readNow(); for (const state of candidates) if (state.expired || state.expiresAt <= now) { state.expired = true; candidates.delete(state); } }
  return new OwnerHailuo02I2vRequestPreparer(PREPARER_KEY, api);
}
export function isOwnerHailuo02I2vRequestPreparer(value: unknown): value is OwnerHailuo02I2vRequestPreparer {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === OwnerHailuo02I2vRequestPreparer.prototype &&
    value instanceof OwnerHailuo02I2vRequestPreparer && PREPARERS.has(value as object) && Object.isFrozen(value);
}
export function isOwnerHailuo02I2vPreparedCandidate(value: unknown): value is OwnerHailuo02I2vPreparedCandidate {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false; const state = CANDIDATES.get(value as object); return !!state && state.candidate === value && !state.expired;
}
function assertResolution(r: OwnerHailuo02I2vImageResolution, input: Readonly<PrepareOwnerHailuo02I2vRequestInput>, service: OwnerHailuo02I2vImageReferenceService): void {
  if (r.role !== "hailuo02_i2v_image" || r.wire_type !== "image" || r.attempt_id !== input.attemptId || r.image_handle !== input.image_handle ||
      r.generation_permit !== false || r.principal.connection_id !== input.attemptId || !/^[a-f0-9]{64}$/u.test(r.sha256) ||
      !Number.isSafeInteger(r.size) || r.size < 1 || !Number.isSafeInteger(r.epoch) || !Number.isSafeInteger(r.expires_at) ||
      !service.isOwnedResolution(r, { attempt_id: input.attemptId, image_handle: input.image_handle })) fail("REFERENCE_UNAVAILABLE");
}
function sameResolution(a: OwnerHailuo02I2vImageResolution, b: OwnerHailuo02I2vImageResolution) {
  return sameGenerationPrincipal(a.principal, b.principal) && a.attempt_id === b.attempt_id && a.image_handle === b.image_handle &&
    a.mime_type === b.mime_type && a.size === b.size && a.sha256 === b.sha256 && a.width === b.width && a.height === b.height &&
    a.expires_at === b.expires_at && a.epoch === b.epoch;
}
function makeCandidate(input: { profileHash: string; sourceBinding: Readonly<Record<string, unknown>>; requestFingerprint: string; intentFingerprint: string;
  normalized: OwnerHailuo02I2vNormalizedParameters; resolution: OwnerHailuo02I2vImageResolution; expiresAt: number }): OwnerHailuo02I2vPreparedCandidate {
  const c = Object.create(null) as OwnerHailuo02I2vPreparedCandidate;
  Object.defineProperties(c, { status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
    runtime_usable: { value: false, enumerable: true }, backend_acceptance: { value: "UNPROVEN", enumerable: true }, model_id: { value: "hailuo-02", enumerable: true },
    profile_schema_hash: { value: input.profileHash, enumerable: true }, source_binding: { value: input.sourceBinding, enumerable: true },
    request_fingerprint: { value: input.requestFingerprint, enumerable: true }, intent_fingerprint: { value: input.intentFingerprint, enumerable: true },
    prompt_utf16_length: { value: input.normalized.intent.prompt.length, enumerable: true },
    image: { value: Object.freeze({ mime_type: input.resolution.mime_type, size: input.resolution.size, sha256: input.resolution.sha256,
      width: input.resolution.width, height: input.resolution.height }), enumerable: true }, expires_at: { value: input.expiresAt, enumerable: true } });
  return Object.freeze(c);
}
function snapshotInput(value: unknown): Readonly<PrepareOwnerHailuo02I2vRequestInput> {
  const f = exact(value, ["attemptId", "model_id", "prompt", "resolution", "video_duration", "image_handle"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || f.model_id !== "hailuo-02" || typeof f.prompt !== "string" ||
      typeof f.resolution !== "string" || typeof f.video_duration !== "number" || typeof f.image_handle !== "string" || !HANDLE.test(f.image_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, model_id: "hailuo-02", prompt: f.prompt, resolution: f.resolution,
    video_duration: f.video_duration, image_handle: f.image_handle });
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d), allowed = new Set([...required, ...optional]);
  if ((proto !== Object.prototype && proto !== null) || required.some(k => !Object.hasOwn(d, k)) || keys.some(k => typeof k !== "string" || !allowed.has(k) || !d[k]!.enumerable || !("value" in d[k]!))) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) out[k] = d[k]!.value; return out;
}
function deepFreeze<T>(value: T): T { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; for (const k of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[k]); return Object.freeze(value); }
function readClock(value: unknown): () => number { if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST"); return () => {
  let n: unknown; try { n = Reflect.apply(value, undefined, []); } catch { fail("CLOCK_INVALID"); }
  if (!Number.isSafeInteger(n) || (n as number) < 0) fail("CLOCK_INVALID"); return n as number; }; }
function fail(code: OwnerHailuo02I2vRequestPreparerErrorCode): never { throw new OwnerHailuo02I2vRequestPreparerError(code); }
