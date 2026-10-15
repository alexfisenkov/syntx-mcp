import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient, readOwnerKlingMotionControlUploadReferenceForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerKlingMotionControlImageUploadContext, OwnerKlingMotionControlVideoUploadContext } from "../adapter/syntx/kling-motion-control-upload-context.js";
import type { OwnerKlingMotionControlPresetVideoContext } from "./owner-kling-motion-control-preset-reference-service.js";
import { OwnerKlingMotionControlPresetReferenceService, readOwnerKlingMotionControlPresetVideoReferenceForClient } from "./owner-kling-motion-control-preset-reference-service.js";
import type { OwnerKlingMotionControlPresetVideoResolution } from "./owner-kling-motion-control-preset-reference-service.js";
import type { OwnerKlingMotionControlImageResolution } from "./owner-kling-motion-control-reference-service.js";
import { OwnerKlingMotionControlReferenceService, type OwnerKlingMotionControlOwnPairResolution } from "./owner-kling-motion-control-reference-service.js";
import { getOwnerKlingMotionControlParametersSource, normalizeOwnerKlingMotionControlParameters } from "./owner-kling-motion-control-parameters.js";
import { buildOwnerKlingMotionControlWireSettingsTemplate } from "./owner-kling-motion-control-wire-source.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PREPARERS = new WeakSet<object>();
const CANDIDATES = new WeakMap<object, CandidateState>();
const BINDINGS = new WeakMap<object, NativeState>();
const NATIVE_IMAGE = SyntxChatHttpClient.prototype.uploadKlingMotionControlImage;
const NATIVE_VIDEO = SyntxChatHttpClient.prototype.uploadKlingMotionControlVideo;
const NATIVE_READER = readOwnerKlingMotionControlUploadReferenceForClient;
const RESOLVE = OwnerKlingMotionControlReferenceService.prototype.resolveOwnPair;
const OWNED = OwnerKlingMotionControlReferenceService.prototype.isOwnedOwnPairResolution;
const CAPTURE = OwnerKlingMotionControlReferenceService.prototype.withNativeOwnPair;
const RESOLVE_IMAGE = OwnerKlingMotionControlReferenceService.prototype.resolveImage;
const OWNED_IMAGE = OwnerKlingMotionControlReferenceService.prototype.isOwnedImageResolution;
const CAPTURE_IMAGE = OwnerKlingMotionControlReferenceService.prototype.withNativeImage;
const PRESET_RESOLVE = OwnerKlingMotionControlPresetReferenceService.prototype.resolvePresetVideo;
const PRESET_CAPTURE = OwnerKlingMotionControlPresetReferenceService.prototype.withNativePresetVideo;
const PRESET_READER = readOwnerKlingMotionControlPresetVideoReferenceForClient;

export interface OwnerKlingMotionControlPreparedCandidate {
  readonly status: "prepared"; readonly dispatch_allowed: false; readonly runtime_usable: false; readonly backend_acceptance: "UNPROVEN";
  readonly model_id: "kling_motion_control"; readonly reference_source: "owned_video" | "service_preset"; readonly profile_schema_hash: string;
  readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly expires_at: number;
  readonly image: Readonly<{ sha256: string; mime_type: string; size: number }>;
  readonly video: Readonly<{ sha256: string; mime_type: string; size: number; duration_seconds: number }>;
}
export interface OwnerKlingMotionControlPrivateRequest {
  readonly attempt_id: string; readonly model_id: "kling_motion_control"; readonly prompt: string;
  readonly settings: Readonly<{ model_type: "kling_motion_control"; version: string; mode: string; gen_type: string;
    native_audio: boolean; video_duration: number; file_urls: readonly [{ type: "image"; url: string }, { type: "video"; url: string }] }>;
}
export interface OwnerKlingMotionControlCandidateBinding {
  readonly candidate: OwnerKlingMotionControlPreparedCandidate; readonly attempt_id: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_schema_hash: string; readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly expires_at: number;
  readonly reference_epoch: number; readonly reference_expires_at: number; readonly video_reference_epoch?: number; readonly video_reference_expires_at?: number;
}
export interface OwnerKlingMotionControlRequestPreparerOptions { readonly referenceService: OwnerKlingMotionControlReferenceService; readonly presetReferenceService?: OwnerKlingMotionControlPresetReferenceService; readonly now?: () => number }
export type OwnerKlingMotionControlRequestPreparerErrorCode = "INVALID_REQUEST" | "SERVICE_BINDING_MISMATCH" | "REFERENCE_UNAVAILABLE" |
  "REFERENCE_EXPIRED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "PARAMETERS_INVALID" | "PROMPT_INVALID" | "CLOCK_INVALID" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED";
export class OwnerKlingMotionControlRequestPreparerError extends Error {
  constructor(readonly code: OwnerKlingMotionControlRequestPreparerErrorCode) { super("The owner Kling Motion Control request could not be prepared safely."); this.name = "OwnerKlingMotionControlRequestPreparerError"; }
}
type NativePresetVideoContext = OwnerKlingMotionControlPresetVideoContext & { readonly media_type?: never };
type NativeContexts = readonly [OwnerKlingMotionControlImageUploadContext, OwnerKlingMotionControlVideoUploadContext] | readonly [OwnerKlingMotionControlImageUploadContext, NativePresetVideoContext];
interface CandidateState { readonly candidate: OwnerKlingMotionControlPreparedCandidate; readonly binding: OwnerKlingMotionControlCandidateBinding;
  readonly request: OwnerKlingMotionControlPrivateRequest; readonly contexts: NativeContexts; readonly client: SyntxChatHttpClient;
  readonly source: "owned_video" | "service_preset"; readonly ownResolution?: OwnerKlingMotionControlOwnPairResolution;
  readonly imageResolution?: OwnerKlingMotionControlImageResolution; readonly presetResolution?: OwnerKlingMotionControlPresetVideoResolution;
  readonly imageInput: {attempt_id:string;image_handle:string}; readonly presetInput?: {attempt_id:string;preset_video_handle:string};
  readonly pairInput?: {attempt_id:string;image_handle:string;video_handle:string}; expired: boolean }
interface NativeState { readonly preparer: object; readonly candidate: object; readonly client: SyntxChatHttpClient;
  readonly contexts: NativeContexts; readonly assertLive: () => void }
interface Pending { readonly attempt: string; readonly epoch: number; readonly controller: AbortController; readonly done: Promise<void>; finish(): void; remove(): void }
interface Api { prepare(input: unknown, signal?: AbortSignal): Promise<OwnerKlingMotionControlPreparedCandidate>; inspectCandidate(v: unknown): OwnerKlingMotionControlCandidateBinding | undefined;
  getPrivateRequest(v: unknown): OwnerKlingMotionControlPrivateRequest; revalidateCandidate(v: unknown): Promise<OwnerKlingMotionControlCandidateBinding>;
  getNativeBindingForClient(client: unknown, candidate: unknown): object; invalidateAttempt(attempt: unknown): Promise<void>; close(): Promise<void> }
export class OwnerKlingMotionControlRequestPreparer implements Api {
  readonly #api: Api;
  constructor(key?: symbol, api?: Api) { if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH"); this.#api = api; PREPARERS.add(this); Object.freeze(this); }
  prepare(v: unknown, signal?: AbortSignal) { return this.#api.prepare(v, signal); } inspectCandidate(v: unknown) { return this.#api.inspectCandidate(v); }
  getPrivateRequest(v: unknown) { return this.#api.getPrivateRequest(v); } revalidateCandidate(v: unknown) { return this.#api.revalidateCandidate(v); }
  getNativeBindingForClient(c: unknown, v: unknown) { return this.#api.getNativeBindingForClient(c, v); }
  invalidateAttempt(v: unknown) { return this.#api.invalidateAttempt(v); } close() { return this.#api.close(); }
}
const PREPARER_KEY = Symbol("OwnerKlingMotionControlRequestPreparerFactory");
Object.freeze(OwnerKlingMotionControlRequestPreparer.prototype);

export function createOwnerKlingMotionControlRequestPreparer(optionsInput: OwnerKlingMotionControlRequestPreparerOptions | unknown): OwnerKlingMotionControlRequestPreparer {
  const options = exact(optionsInput, ["referenceService", "presetReferenceService", "now"], ["referenceService"]);
  const refs = options.referenceService;
  if (!(refs instanceof OwnerKlingMotionControlReferenceService) || Object.getPrototypeOf(refs) !== OwnerKlingMotionControlReferenceService.prototype ||
      OwnerKlingMotionControlReferenceService.prototype.resolveOwnPair !== RESOLVE || OwnerKlingMotionControlReferenceService.prototype.isOwnedOwnPairResolution !== OWNED ||
      OwnerKlingMotionControlReferenceService.prototype.withNativeOwnPair !== CAPTURE ||
      (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("SERVICE_BINDING_MISMATCH");
  const presetRefs = options.presetReferenceService;
  if (presetRefs !== undefined && (!(presetRefs instanceof OwnerKlingMotionControlPresetReferenceService) || Object.getPrototypeOf(presetRefs) !== OwnerKlingMotionControlPresetReferenceService.prototype ||
      OwnerKlingMotionControlPresetReferenceService.prototype.resolvePresetVideo !== PRESET_RESOLVE ||
      OwnerKlingMotionControlPresetReferenceService.prototype.withNativePresetVideo !== PRESET_CAPTURE)) fail("SERVICE_BINDING_MISMATCH");
  const now = (options.now as (() => number) | undefined) ?? Date.now, states = new Set<CandidateState>(), pending = new Set<Pending>();
  const epochs = new Map<string, number>(), invalidating = new Set<string>();
  let closed = false, last = -1, closing: Promise<void> | undefined;
  const time = () => { const n = now(); if (!Number.isSafeInteger(n) || n < 0 || n < last) fail("CLOCK_INVALID"); last = n; return n; };
  const live = (state: CandidateState) => {
    if (closed || state.expired || !states.has(state) || time() >= state.candidate.expires_at) return false;
    if (state.source === "owned_video") return !!state.ownResolution && !!state.pairInput && Reflect.apply(OWNED, refs, [state.ownResolution, state.pairInput]);
    if (!presetRefs || !state.imageResolution || !state.presetResolution || !state.presetInput || !Reflect.apply(OWNED_IMAGE, refs, [state.imageResolution, state.imageInput])) return false;
    return !!NATIVE_READER(state.client, state.contexts[0]) && !!PRESET_READER(state.client, state.contexts[1]);
  };
  const stateFor = (v: unknown): CandidateState => { if (!v || typeof v !== "object" || types.isProxy(v)) fail("CANDIDATE_UNBOUND"); const s = CANDIDATES.get(v);
    if (!s || s.candidate !== v || !live(s)) fail("CANDIDATE_EXPIRED"); return s; };
  const prune = () => { for (const s of states) if (!live(s)) { states.delete(s); CANDIDATES.delete(s.candidate); s.expired = true; } };
  const begin = (attempt: string, parent?: AbortSignal): Pending => {
    if (closed) fail("SERVICE_CLOSED"); if (invalidating.has(attempt)) fail("REFERENCE_EXPIRED");
    if (pending.size >= 4 || states.size + pending.size >= 128) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const op: Pending = { attempt, epoch: epochs.get(attempt) ?? 0, controller, done, finish, remove: () => parent?.removeEventListener("abort", abort) };
    pending.add(op); return op;
  };
  const stop = (op: Pending) => { if (closed) fail("SERVICE_CLOSED"); if (op.controller.signal.aborted || invalidating.has(op.attempt) || op.epoch !== (epochs.get(op.attempt) ?? 0)) fail("REFERENCE_EXPIRED"); };
  const finish = (op: Pending) => { pending.delete(op); op.remove(); op.finish(); };
  const api: Api = {
    async prepare(inputInput, signal) {
      if (closed) fail("SERVICE_CLOSED"); const input = snapshotInput(inputInput, signal);
      prune();
      const op = begin(input.attempt_id, signal);
      try {
      let template; try { template = buildOwnerKlingMotionControlWireSettingsTemplate({ parameters: input.parameters, ...(input.prompt === undefined ? {} : { prompt: input.prompt }) }); }
      catch { fail("PARAMETERS_INVALID"); }
      const parameters = input.parameters as Record<string, unknown>;
      const pairInput = input.source === "owned_video" ? { attempt_id: input.attempt_id, image_handle: input.image_handle!, video_handle: input.video_handle! } : undefined;
      const imageInput = { attempt_id: input.attempt_id, image_handle: input.image_handle };
      let resolution: OwnerKlingMotionControlOwnPairResolution | undefined;
      let imageResolution: OwnerKlingMotionControlImageResolution | undefined, presetResolution: OwnerKlingMotionControlPresetVideoResolution | undefined;
      let duration: number, videoSha: string, videoMime: string, videoSize: number, presetVariant: "audio" | "noaudio" | undefined;
      let captured: { client: SyntxChatHttpClient; contexts: NativeContexts; urls: readonly [{type:"image";url:string},{type:"video";url:string}] } | undefined;
      stop(op);
      if (input.source === "owned_video") {
        resolution = await Reflect.apply(RESOLVE, refs, [pairInput, op.controller.signal]) as OwnerKlingMotionControlOwnPairResolution;
        stop(op);
        if (closed || !Reflect.apply(OWNED, refs, [resolution, pairInput])) fail("REFERENCE_UNAVAILABLE");
        duration = resolution.video.duration_seconds; videoSha = resolution.video.sha256; videoMime = resolution.video.mime_type; videoSize = resolution.video.size;
        captured = Reflect.apply(CAPTURE, refs, [resolution, pairInput,
          (client: SyntxChatHttpClient, contexts: readonly [OwnerKlingMotionControlImageUploadContext, OwnerKlingMotionControlVideoUploadContext]) => {
            if (!nativeClient(client)) fail("REFERENCE_UNAVAILABLE"); const image = NATIVE_READER(client, contexts[0]), video = NATIVE_READER(client, contexts[1]);
            if (!image || !video || contexts[0].media_type !== "image" || contexts[1].media_type !== "video") fail("REFERENCE_EXPIRED");
            return { client, contexts, urls: Object.freeze([Object.freeze({ type: "image" as const, url: image.url }), Object.freeze({ type: "video" as const, url: video.url })]) };
          }]) as typeof captured;
      } else {
        if (!presetRefs || !input.preset_video_handle) fail("REFERENCE_UNAVAILABLE");
        const presetInput = { attempt_id: input.attempt_id, preset_video_handle: input.preset_video_handle };
        imageResolution = await Reflect.apply(RESOLVE_IMAGE, refs, [imageInput, op.controller.signal]) as OwnerKlingMotionControlImageResolution;
        stop(op);
        presetResolution = await Reflect.apply(PRESET_RESOLVE, presetRefs, [presetInput, op.controller.signal]) as OwnerKlingMotionControlPresetVideoResolution;
        stop(op);
        if (!Reflect.apply(OWNED_IMAGE, refs, [imageResolution, imageInput]) || presetResolution.attempt_id !== input.attempt_id ||
            !sameGenerationPrincipal(imageResolution.principal, presetResolution.principal)) fail("REFERENCE_UNAVAILABLE");
        duration = presetResolution.preset_video.duration_seconds; videoSha = presetResolution.preset_video.sha256; videoMime = presetResolution.preset_video.mime_type;
        videoSize = presetResolution.preset_video.size; presetVariant = presetResolution.preset_video.variant;
        captured = Reflect.apply(CAPTURE_IMAGE, refs, [imageResolution, imageInput, (client: SyntxChatHttpClient, context: OwnerKlingMotionControlImageUploadContext) => {
          if (!nativeClient(client)) fail("REFERENCE_UNAVAILABLE"); const imageRef = NATIVE_READER(client, context);
          if (!imageRef || context.media_type !== "image") fail("REFERENCE_EXPIRED");
          return Reflect.apply(PRESET_CAPTURE, presetRefs, [presetResolution, presetInput, (presetClient: SyntxChatHttpClient, presetContext: OwnerKlingMotionControlPresetVideoContext) => {
            const selected = PRESET_READER(presetClient, presetContext);
            if (presetClient !== client || !selected || selected.sha256 !== videoSha || selected.duration_seconds !== duration || selected.variant !== presetVariant ||
                selected.uri.length === 0 || videoMime !== "video/mp4" && videoMime !== "video/quicktime") fail("REFERENCE_EXPIRED");
            return { client, contexts: Object.freeze([context, presetContext]) as NativeContexts,
              urls: Object.freeze([Object.freeze({ type: "image" as const, url: imageRef.url }), Object.freeze({ type: "video" as const, url: selected.uri })]) };
          }]);
        }]) as NonNullable<typeof captured>;
      }
      if (!captured) fail("REFERENCE_UNAVAILABLE");
      const max = parameters.gen_type === "mci" ? 10 : 30;
      if (duration < 3 || duration > max) fail("REFERENCE_EXPIRED");
      const rounded = Math.round(duration); if (parameters.video_duration !== rounded) fail("PARAMETERS_INVALID");
      const prompt = input.prompt ?? "";
      const request = deepFreeze({ attempt_id: input.attempt_id, model_id: "kling_motion_control" as const, prompt,
        settings: { ...template.settings_template, file_urls: captured.urls } }) as OwnerKlingMotionControlPrivateRequest;
      const principal = snapshotGenerationPrincipal((resolution ?? imageResolution!).principal);
      const videoExpires = resolution?.expires_at ?? presetResolution!.expires_at;
      const expires = Math.min(time() + 900_000, resolution?.expires_at ?? imageResolution!.expires_at, videoExpires);
      const imageSha = resolution?.image.sha256 ?? imageResolution!.image.sha256, imageMime = resolution?.image.mime_type ?? imageResolution!.image.mime_type, imageSize = resolution?.image.size ?? imageResolution!.image.size;
      const semantic = schemaHash({ principal, model_id: request.model_id, source: input.source, ...(presetVariant ? { preset_variant: presetVariant } : {}), prompt,
        parameters: template.settings_template, image_sha256: imageSha, video_sha256: videoSha, raw_duration: duration });
      const profile = schemaHash({ source_pins: getOwnerKlingMotionControlParametersSource().source_pins, settings: ["model_type", "version", "mode", "gen_type", "native_audio", "video_duration", "file_urls"] });
      const requestFingerprint = schemaHash(request);
      const candidate = Object.freeze({ status: "prepared" as const, dispatch_allowed: false as const, runtime_usable: false as const,
        backend_acceptance: "UNPROVEN" as const, model_id: "kling_motion_control" as const, reference_source: input.source,
        profile_schema_hash: profile, request_fingerprint: requestFingerprint, intent_fingerprint: semantic, expires_at: expires,
        image: Object.freeze({ sha256: imageSha, mime_type: imageMime, size: imageSize }),
        video: Object.freeze({ sha256: videoSha, mime_type: videoMime, size: videoSize, duration_seconds: duration }) });
      const binding = Object.freeze({ candidate, attempt_id: input.attempt_id, principal, profile_schema_hash: profile, request_fingerprint: requestFingerprint,
        intent_fingerprint: semantic, expires_at: expires, reference_epoch: resolution?.epoch ?? imageResolution!.epoch,
        reference_expires_at: resolution?.expires_at ?? imageResolution!.expires_at,
        ...(presetResolution ? { video_reference_epoch: presetResolution.epoch, video_reference_expires_at: presetResolution.expires_at } : {}) });
      const state: CandidateState = { candidate, binding, request, contexts: captured.contexts, client: captured.client, source: input.source,
        ...(resolution ? { ownResolution: resolution } : {}), ...(imageResolution ? { imageResolution } : {}), ...(presetResolution ? { presetResolution } : {}),
        imageInput, ...(input.preset_video_handle ? { presetInput: { attempt_id: input.attempt_id, preset_video_handle: input.preset_video_handle } } : {}),
        ...(pairInput ? { pairInput } : {}), expired: false };
      stop(op);
      if (op.epoch !== (epochs.get(op.attempt) ?? 0)) fail("REFERENCE_EXPIRED");
      states.add(state); CANDIDATES.set(candidate, state); return candidate;
      } finally { finish(op); }
    },
    inspectCandidate(v) { try { return stateFor(v).binding; } catch { return undefined; } },
    getPrivateRequest(v) { return stateFor(v).request; },
    async revalidateCandidate(v) {
      const s = stateFor(v);
      if (s.source === "owned_video") {
        const fresh = await Reflect.apply(RESOLVE, refs, [s.pairInput]) as OwnerKlingMotionControlOwnPairResolution;
        const old = s.ownResolution!;
        if (closed || !Reflect.apply(OWNED, refs, [old, s.pairInput]) || !sameGenerationPrincipal(s.binding.principal, fresh.principal) ||
          fresh.epoch !== old.epoch || fresh.image.sha256 !== old.image.sha256 || fresh.video.sha256 !== old.video.sha256 || fresh.video.duration_seconds !== old.video.duration_seconds) {
          s.expired = true; fail("CANDIDATE_EXPIRED");
        }
      } else {
        if (!presetRefs || !s.presetInput) { s.expired = true; fail("CANDIDATE_EXPIRED"); }
        const [image, preset] = await Promise.all([
          Reflect.apply(RESOLVE_IMAGE, refs, [s.imageInput]) as Promise<OwnerKlingMotionControlImageResolution>,
          Reflect.apply(PRESET_RESOLVE, presetRefs, [s.presetInput]) as Promise<OwnerKlingMotionControlPresetVideoResolution>
        ]);
        const oldImage = s.imageResolution!, oldPreset = s.presetResolution!;
        let capturedFresh = false;
        try {
          Reflect.apply(CAPTURE_IMAGE, refs, [image, s.imageInput, (imageClient: SyntxChatHttpClient, imageContext: OwnerKlingMotionControlImageUploadContext) => {
            const imageRef = NATIVE_READER(imageClient, imageContext);
            return Reflect.apply(PRESET_CAPTURE, presetRefs, [preset, s.presetInput, (presetClient: SyntxChatHttpClient, presetContext: OwnerKlingMotionControlPresetVideoContext) => {
              const presetRef = PRESET_READER(presetClient, presetContext);
              capturedFresh = imageClient === s.client && presetClient === imageClient && !!imageRef && !!presetRef;
            }]);
          }]);
        } catch { capturedFresh = false; }
        if (closed || !Reflect.apply(OWNED_IMAGE, refs, [oldImage, s.imageInput]) || !sameGenerationPrincipal(s.binding.principal, image.principal) ||
          !sameGenerationPrincipal(s.binding.principal, preset.principal) || image.epoch !== oldImage.epoch || preset.epoch !== oldPreset.epoch ||
          image.image.sha256 !== oldImage.image.sha256 || image.image.mime_type !== oldImage.image.mime_type ||
          preset.preset_video.sha256 !== oldPreset.preset_video.sha256 || preset.preset_video.duration_seconds !== oldPreset.preset_video.duration_seconds ||
          preset.preset_video.mime_type !== oldPreset.preset_video.mime_type || preset.preset_video.variant !== oldPreset.preset_video.variant ||
          !capturedFresh || !NATIVE_READER(s.client, s.contexts[0]) || !PRESET_READER(s.client, s.contexts[1])) { s.expired = true; fail("CANDIDATE_EXPIRED"); }
      }
      return s.binding;
    },
    getNativeBindingForClient(client, candidate) { const s = stateFor(candidate); if (client !== s.client) fail("CANDIDATE_UNBOUND"); let token = nativeTokens.get(s); if (!token) { token = Object.freeze({ status: "captured", model_id: "kling_motion_control", dispatch_allowed: false });
        nativeTokens.set(s, token); BINDINGS.set(token, { preparer, candidate: s.candidate, client: s.client, contexts: s.contexts, assertLive: () => { if (!live(s)) fail("CANDIDATE_EXPIRED"); } }); } return token; },
    async invalidateAttempt(attempt) {
      if (typeof attempt !== "string") return; invalidating.add(attempt); epochs.set(attempt, (epochs.get(attempt) ?? 0) + 1);
      for (const s of states) if (s.binding.attempt_id === attempt) { s.expired = true; states.delete(s); CANDIDATES.delete(s.candidate); }
      const own = [...pending].filter((op) => op.attempt === attempt); for (const op of own) op.controller.abort();
      await Promise.allSettled(own.map((op) => op.done));
      await Promise.all([refs.invalidateAttempt(attempt), ...(presetRefs ? [presetRefs.invalidateAttempt(attempt)] : [])]); invalidating.delete(attempt);
    },
    async close() {
      if (closing) return closing; closed = true;
      for (const s of states) { s.expired = true; CANDIDATES.delete(s.candidate); } states.clear();
      const own = [...pending]; for (const op of own) op.controller.abort();
      closing = Promise.allSettled(own.map((op) => op.done)).then(() => undefined); return closing;
    }
  };
  const preparer = new OwnerKlingMotionControlRequestPreparer(PREPARER_KEY, api); return preparer;
}
const nativeTokens = new WeakMap<CandidateState, object>();
export function isOwnerKlingMotionControlRequestPreparer(v: unknown): v is OwnerKlingMotionControlRequestPreparer { return !!v && typeof v === "object" && PREPARERS.has(v as object); }
export function isOwnerKlingMotionControlPreparedCandidate(v: unknown): v is OwnerKlingMotionControlPreparedCandidate { return !!v && typeof v === "object" && CANDIDATES.has(v as object); }
/** Pre-dispatch only: capture this exact pair into native operation state before consuming the permit; later result GETs use that retained state, not this candidate. */
export function readOwnerKlingMotionControlNativeBindingForClient(client: unknown, binding: unknown): NativeContexts | null {
  if (!client || typeof client !== "object" || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
      SyntxChatHttpClient.prototype.uploadKlingMotionControlImage !== NATIVE_IMAGE || SyntxChatHttpClient.prototype.uploadKlingMotionControlVideo !== NATIVE_VIDEO ||
      !binding || typeof binding !== "object" || types.isProxy(binding)) return null;
  const state = BINDINGS.get(binding as object); if (!state || state.client !== client) return null;
  try {
    state.assertLive();
    if (!NATIVE_READER(state.client, state.contexts[0])) return null;
    if ("media_type" in state.contexts[1] && state.contexts[1].media_type === "video") return NATIVE_READER(state.client, state.contexts[1]) ? state.contexts : null;
    return PRESET_READER(state.client, state.contexts[1]) ? state.contexts : null;
  } catch { return null; }
}
function snapshotInput(v: unknown, signal?: AbortSignal): {attempt_id:string;source:"owned_video"|"service_preset";image_handle:string;video_handle?:string;preset_video_handle?:string;parameters:unknown;prompt?:string} {
  if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(v); } catch { return fail("INVALID_REQUEST"); }
  const sourceDescriptor = descriptors.reference_source;
  if (!sourceDescriptor || !("value" in sourceDescriptor)) fail("INVALID_REQUEST");
  const source = sourceDescriptor.value;
  const common = ["attempt_id", "model_id", "reference_source", "image_handle", "parameters", "prompt"];
  const f = source === "owned_video"
    ? exact(v, [...common, "video_handle"], ["attempt_id", "model_id", "reference_source", "image_handle", "video_handle", "parameters"])
    : source === "service_preset"
      ? exact(v, [...common, "preset_video_handle"], ["attempt_id", "model_id", "reference_source", "image_handle", "preset_video_handle", "parameters"])
      : fail("INVALID_REQUEST");
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || f.model_id !== "kling_motion_control" || f.reference_source !== source ||
      typeof f.image_handle !== "string" || (source === "owned_video" ? typeof f.video_handle !== "string" : typeof f.preset_video_handle !== "string") ||
      (f.prompt !== undefined && typeof f.prompt !== "string")) fail("INVALID_REQUEST");
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
  const prompt = f.prompt as string | undefined; if (prompt !== undefined && (Buffer.byteLength(prompt, "utf8") > 128 * 1024 || prompt.includes("\0") || !wellFormed(prompt))) fail("PROMPT_INVALID");
  let normalized; try { normalized = normalizeOwnerKlingMotionControlParameters(f.parameters); } catch { fail("PARAMETERS_INVALID"); }
  const intent = normalized.intent;
  const parameters = Object.freeze({ model_id: intent.model_id, version: intent.version, mode: intent.mode, gen_type: intent.gen_type,
    native_audio: intent.native_audio, video_duration: intent.video_duration });
  return { attempt_id: f.attempt_id, source, image_handle: f.image_handle, ...(source === "owned_video" ? { video_handle: f.video_handle as string } : { preset_video_handle: f.preset_video_handle as string }),
    parameters, ...(prompt === undefined ? {} : { prompt }) };
}
function nativeClient(v: unknown): v is SyntxChatHttpClient { return !!v && typeof v === "object" && !types.isProxy(v) && Object.getPrototypeOf(v) === SyntxChatHttpClient.prototype &&
  SyntxChatHttpClient.prototype.uploadKlingMotionControlImage === NATIVE_IMAGE && SyntxChatHttpClient.prototype.uploadKlingMotionControlVideo === NATIVE_VIDEO; }
function exact(v: unknown, keys: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) fail("INVALID_REQUEST"); let p: object|null; let ds: PropertyDescriptorMap;
  try { p=Object.getPrototypeOf(v); ds=Object.getOwnPropertyDescriptors(v); } catch { return fail("INVALID_REQUEST"); }
  const own=Reflect.ownKeys(ds); if ((p!==Object.prototype&&p!==null)||own.some(k=>typeof k!=="string"||!keys.includes(k))||required.some(k=>!own.includes(k))) fail("INVALID_REQUEST");
  const out=Object.create(null) as Record<string,unknown>; for(const k of own){const d=ds[k as string];if(!d||!d.enumerable||!Object.hasOwn(d,"value"))fail("INVALID_REQUEST");out[k as string]=d.value;} return out;
}
function deepFreeze<T>(v:T):T { if(v&&typeof v==="object"){for(const x of Object.values(v as Record<string,unknown>))deepFreeze(x);if(!Object.isFrozen(v))Object.freeze(v);}return v; }
function wellFormed(v:string):boolean { for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=v.charCodeAt(i+1);if(!(n>=0xdc00&&n<=0xdfff))return false;i++;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true; }
function fail(c: OwnerKlingMotionControlRequestPreparerErrorCode): never { throw new OwnerKlingMotionControlRequestPreparerError(c); }
