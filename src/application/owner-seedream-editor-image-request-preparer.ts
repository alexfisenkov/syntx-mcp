import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerSeedreamEditorGenerationSourceProfile
} from "./owner-seedream-editor-generation-source-profile.js";
import {
  OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND,
  normalizeOwnerSeedreamEditorGenerationParameters,
  type OwnerSeedreamEditorGenerationParameters
} from "./owner-seedream-editor-generation-parameters.js";
import {
  projectOwnerSeedreamEditorCostParameters,
  type OwnerSeedreamEditorCostParameters
} from "./owner-seedream-editor-parameters.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  getOwnerSeedreamEditorOriginalUploadSourceProfile } from "./owner-seedream-editor-original-upload-source-profile.js";
import { getOwnerSeedreamEditorDrawingSourceProfile } from "./owner-seedream-editor-drawing-source-profile.js";
import { OwnerSeedreamEditorOriginalReferenceService, type OwnerSeedreamEditorOriginalPrivateResolution,
  type OwnerSeedreamEditorOriginalResolverContext } from "./owner-seedream-editor-original-reference-service.js";
import { OwnerSeedreamEditorDrawingReferenceService, type OwnerSeedreamEditorDrawingPrivateResolution,
  type OwnerSeedreamEditorDrawingResolverContext } from "./owner-seedream-editor-drawing-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000, MAX_CANDIDATES = 128, MAX_PENDING = 4;
const ORIGINAL_RESOLVE = OwnerSeedreamEditorOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_GUARD = OwnerSeedreamEditorOriginalReferenceService.prototype.isOwnedOriginalResolution;
const DRAWING_RESOLVE = OwnerSeedreamEditorDrawingReferenceService.prototype.resolveDrawing;
const DRAWING_GUARD = OwnerSeedreamEditorDrawingReferenceService.prototype.isOwnedDrawingResolution;
const BRAND: unique symbol = Symbol("OwnerSeedreamEditorImagePreparedCandidate");
const PREPARER_KEY = Symbol("OwnerSeedreamEditorImageRequestPreparerFactory");
const states = new WeakMap<object, CandidateState>();
const preparers = new WeakSet<object>();

export interface OwnerSeedreamEditorImageRequest {
  readonly prompt: string;
  readonly settings: Readonly<{ n: 1; stream: false; model_type: OwnerSeedreamImageVariant;
    aspect_ratio: string; resolution: string; file_urls: readonly Readonly<{ type: "image"; url: string }>[] }>;
}
export interface OwnerSeedreamEditorImageCandidateBinding {
  readonly attempt_id: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerSeedreamImageVariant; readonly profile_id: "seedream-editor-generation-source-profile-v1";
  readonly profile_schema_hash: string; readonly source_binding: Readonly<Record<string, unknown>>;
  readonly original_handle: string; readonly drawing_handle: string | null;
  readonly original_sha256: string; readonly drawing_sha256: string | null;
  readonly original_epoch: number; readonly drawing_epoch: number | null;
  readonly expires_at: number; readonly request_fingerprint: string; readonly intent_fingerprint: string;
  readonly parameters: Readonly<OwnerSeedreamEditorGenerationParameters["parameters"]>;
  readonly cost_route: Readonly<{ family: "seedream"; variant: OwnerSeedreamImageVariant }>;
  readonly cost_inputs: OwnerSeedreamEditorCostParameters;
}
export interface OwnerSeedreamEditorImagePreparedCandidate {
  readonly [BRAND]: true; readonly status: "blocked"; readonly dispatch_allowed: false;
  readonly source_readiness: "SOURCE_JOINED_GENUINE_EDITOR_REFERENCES_AND_EXPLICIT_CONTROLS";
  readonly backend_acceptance: "UNPROVEN"; readonly profile_id: "seedream-editor-generation-source-profile-v1";
  readonly profile_schema_hash: string; readonly source_binding: Readonly<Record<string, unknown>>;
  readonly variant: OwnerSeedreamImageVariant; readonly parameters: Readonly<OwnerSeedreamEditorGenerationParameters["parameters"]>;
  readonly cost_route: Readonly<{ family: "seedream"; variant: OwnerSeedreamImageVariant }>;
  readonly cost_inputs: OwnerSeedreamEditorCostParameters; readonly expires_at: number;
  readonly request_fingerprint: string; readonly intent_fingerprint: string;
  readonly references: readonly Readonly<{ role: "original" | "drawing"; mime_type: string; width: number; height: number; size: number; sha256: string }>[];
}
export interface PrepareOwnerSeedreamEditorImageRequestInput {
  readonly attemptId: string; readonly variant: OwnerSeedreamImageVariant; readonly prompt: string;
  readonly parameters: unknown; readonly original_handle: string; readonly drawing_handle: string | null; readonly signal?: AbortSignal;
}
export interface OwnerSeedreamEditorImageRequestPreparerOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly originalReferenceService: OwnerSeedreamEditorOriginalReferenceService;
  readonly drawingReferenceService: OwnerSeedreamEditorDrawingReferenceService; readonly now?: () => number;
}
interface OwnerSeedreamEditorImageRequestPreparerApi {
  prepare(input: PrepareOwnerSeedreamEditorImageRequestInput | unknown): Promise<OwnerSeedreamEditorImagePreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerSeedreamEditorImageCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerSeedreamEditorImageRequest;
  revalidateCandidate(candidate: unknown): Promise<OwnerSeedreamEditorImageCandidateBinding>;
  invalidateAttempt(attemptId: string): Promise<void>; close(): Promise<void>;
}
export type OwnerSeedreamEditorImageRequestPreparerErrorCode = "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "SERVICE_BINDING_MISMATCH"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" | "PARAMETERS_INVALID" | "PROMPT_INVALID"
  | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "REQUEST_ABORTED";
export class OwnerSeedreamEditorImageRequestPreparerError extends Error {
  constructor(readonly code: OwnerSeedreamEditorImageRequestPreparerErrorCode) {
    super("The Seedream Editor image request candidate could not be prepared safely."); this.name = "OwnerSeedreamEditorImageRequestPreparerError";
  }
}

/** Genuine factory-issued service wrapper; callers cannot construct an authentic instance. */
export class OwnerSeedreamEditorImageRequestPreparer implements OwnerSeedreamEditorImageRequestPreparerApi {
  readonly #api: OwnerSeedreamEditorImageRequestPreparerApi;
  constructor(key?: symbol, api?: OwnerSeedreamEditorImageRequestPreparerApi) {
    if (key !== PREPARER_KEY || !api) fail("SERVICE_BINDING_MISMATCH");
    this.#api = api; preparers.add(this); Object.freeze(this);
  }
  prepare(input: PrepareOwnerSeedreamEditorImageRequestInput | unknown): Promise<OwnerSeedreamEditorImagePreparedCandidate> { return this.#api.prepare(input); }
  inspectCandidate(candidate: unknown): OwnerSeedreamEditorImageCandidateBinding | undefined { return this.#api.inspectCandidate(candidate); }
  getPrivateRequest(candidate: unknown): OwnerSeedreamEditorImageRequest { return this.#api.getPrivateRequest(candidate); }
  revalidateCandidate(candidate: unknown): Promise<OwnerSeedreamEditorImageCandidateBinding> { return this.#api.revalidateCandidate(candidate); }
  invalidateAttempt(attemptId: string): Promise<void> { return this.#api.invalidateAttempt(attemptId); }
  close(): Promise<void> { return this.#api.close(); }
}
Object.freeze(OwnerSeedreamEditorImageRequestPreparer.prototype);

interface CandidateState {
  readonly owner: object; readonly candidate: OwnerSeedreamEditorImagePreparedCandidate; readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly originalHandle: string; readonly drawingHandle: string | null;
  readonly variant: OwnerSeedreamImageVariant; readonly original: OwnerSeedreamEditorOriginalPrivateResolution;
  readonly drawing: OwnerSeedreamEditorDrawingPrivateResolution | null; readonly request: OwnerSeedreamEditorImageRequest; readonly prompt: string;
  readonly binding: OwnerSeedreamEditorImageCandidateBinding; readonly expiry: number; epoch: number; lastNow: number; expired: boolean;
}
interface SnapInput { attemptId: string; variant: OwnerSeedreamImageVariant; prompt: string; parameters: Readonly<OwnerSeedreamEditorGenerationParameters>;
  originalHandle: string; drawingHandle: string | null; signal?: AbortSignal; }

/** Private, nominal preparation for the source-backed Editor flow; it does not authorize provider dispatch. */
export function createOwnerSeedreamEditorImageRequestPreparer(optionsInput: OwnerSeedreamEditorImageRequestPreparerOptions | unknown): OwnerSeedreamEditorImageRequestPreparer {
  const options = readOptions(optionsInput);
  assertService(options.originalReferenceService, OwnerSeedreamEditorOriginalReferenceService, "resolveOriginal", ORIGINAL_RESOLVE);
  assertService(options.drawingReferenceService, OwnerSeedreamEditorDrawingReferenceService, "resolveDrawing", DRAWING_RESOLVE);
  const catalog = loadSelectedDiscoveryCatalog(OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION).discoveryCatalog;
  const settings = loadMaplessSettingsInventoryVersion(OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
  const profiles = new Map(OWNER_SEEDREAM_IMAGE_VARIANTS.map((variant) => {
    const original = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
      settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
    return [variant, getOwnerSeedreamEditorGenerationSourceProfile(variant, original)] as const;
  }));
  const owner = Object.freeze({}), candidates = new Set<object>(), pending = new Set<Promise<unknown>>();
  const epochs = new Map<string, number>(), invalidating = new Set<string>();
  let closed = false, lastNow = readClock(options.now), closing: Promise<void> | undefined;
  const readNow = (): number => { const value = readClock(options.now); if (value < lastNow) fail("CLOCK_INVALID"); lastNow = value; return value; };
  const assertOpen = (): void => { if (closed) fail("SERVICE_CLOSED"); };
  const stateFor = (value: unknown): CandidateState => {
    if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("CANDIDATE_UNBOUND");
    const state = states.get(value as object);
    if (!state || state.owner !== owner || state.candidate !== value) fail("CANDIDATE_UNBOUND");
    assertOpen();
    const now = readNow();
    if (state.expired || state.epoch !== (epochs.get(state.attemptId) ?? 0) || now < state.lastNow || now >= state.expiry) {
      state.expired = true; fail("CANDIDATE_EXPIRED");
    }
    state.lastNow = now; return state;
  };
  const resolveCurrent = async (input: Pick<SnapInput, "attemptId" | "variant" | "originalHandle" | "drawingHandle" | "signal">,
    principal: Readonly<GenerationPrincipalRef>): Promise<{ original: OwnerSeedreamEditorOriginalPrivateResolution; drawing: OwnerSeedreamEditorDrawingPrivateResolution | null }> => {
    const originalProfile = getOwnerSeedreamEditorOriginalUploadSourceProfile(input.variant, catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
      settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
    let drawing: OwnerSeedreamEditorDrawingPrivateResolution | null = null;
    if (input.drawingHandle !== null) {
      const drawingProfile = getOwnerSeedreamEditorDrawingSourceProfile(input.variant, originalProfile);
      const context: OwnerSeedreamEditorDrawingResolverContext = Object.freeze({ principal, attempt_id: input.attemptId, variant: input.variant,
        original_handle: input.originalHandle, drawing_handle: input.drawingHandle });
      drawing = await waitForResolution(Reflect.apply(DRAWING_RESOLVE, options.drawingReferenceService, [context]), input.signal);
      if (!Reflect.apply(DRAWING_GUARD, options.drawingReferenceService, [drawing, context]) ||
          drawing.original_profile_schema_hash !== originalProfile.profile_schema_hash || drawing.variant !== input.variant ||
          drawing.drawing_profile_schema_hash !== drawingProfile.profile_schema_hash ||
          !isDeepStrictEqual(drawing.source_bindings, drawingProfile.source_binding) ||
          drawing.original_handle !== input.originalHandle || drawing.drawing_handle !== input.drawingHandle ||
          drawing.wire_role !== "image" || drawing.extra_role !== "image" || drawing.generation_permit !== false) fail("REFERENCE_UNAVAILABLE");
    }
    const context: OwnerSeedreamEditorOriginalResolverContext = Object.freeze({ principal, attempt_id: input.attemptId,
      variant: input.variant, form_id: "seedream-editor", source_role: "editor_original",
      public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
      profile_schema_hash: drawing?.original_profile_schema_hash ?? originalProfile.profile_schema_hash, reference_handle: input.originalHandle });
    const original = await waitForResolution(Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [context]), input.signal);
    if (!Reflect.apply(ORIGINAL_GUARD, options.originalReferenceService, [original, context]) || original.variant !== input.variant ||
        original.reference_handle !== input.originalHandle || original.generation_permit !== false || !isSafeUploadReferenceUrl(original.file_url)) fail("REFERENCE_UNAVAILABLE");
    if (drawing && (drawing.original_sha256 !== original.original_sha256 || drawing.original_epoch !== original.epoch ||
      drawing.original_file_url !== original.file_url || drawing.original_expires_at !== original.expires_at)) fail("REFERENCE_UNAVAILABLE");
    return { original, drawing };
  };
  const getBinding = (state: CandidateState): OwnerSeedreamEditorImageCandidateBinding => state.binding;
  const api: OwnerSeedreamEditorImageRequestPreparerApi = Object.freeze({
    async prepare(inputInput: PrepareOwnerSeedreamEditorImageRequestInput | unknown) {
      assertOpen(); const input = snapshotInput(inputInput);
      if (input.signal?.aborted) fail("REQUEST_ABORTED");
      if (invalidating.has(input.attemptId)) fail("CANDIDATE_EXPIRED");
      if (pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
      if (candidates.size >= MAX_CANDIDATES) { pruneCandidates(); if (candidates.size >= MAX_CANDIDATES) fail("CAPACITY_EXCEEDED"); }
      const opEpoch = epochs.get(input.attemptId) ?? 0;
      const operation = (async () => {
        const principal = await principalFor(input.attemptId);
        assertOpen();
        const before = readNow(); const current = await resolveCurrent(input, principal); assertOpen();
        if ((epochs.get(input.attemptId) ?? 0) !== opEpoch || invalidating.has(input.attemptId)) fail("REFERENCE_EXPIRED");
        const afterPrincipal = await principalFor(input.attemptId);
        if (!sameGenerationPrincipal(principal, afterPrincipal)) fail("PRINCIPAL_MISMATCH");
        const issued = readNow();
        const expiry = Math.min(issued + TTL_MS, current.original.expires_at, ...(current.drawing ? [current.drawing.expires_at] : []));
        if (expiry <= readNow()) fail("REFERENCE_EXPIRED");
        const profile = profiles.get(input.variant)!;
        if (profile.source_binding.public_catalog_version !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION ||
            profile.source_binding.settings_inventory_version !== OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION ||
            current.original.profile_schema_hash !== profile.source_binding.original_upload_profile_schema_hash) fail("PROFILE_BINDING_MISMATCH");
        const parameters = input.parameters.parameters;
        const costInputs = projectOwnerSeedreamEditorCostParameters({ variant: input.variant, parameters, can_reset: current.drawing !== null });
        const files: Readonly<{ type: "image"; url: string }>[] = [];
        const seen = new Set<string>();
        for (const url of [current.original.file_url, ...(current.drawing ? [current.drawing.drawing_file_url] : [])]) {
          const key = `image\u0000${url}`; if (seen.has(key)) continue; seen.add(key); files.push(Object.freeze({ type: "image", url }));
        }
        const request: OwnerSeedreamEditorImageRequest = deepFreeze({ prompt: input.prompt, settings: { n: 1, stream: false,
          model_type: input.variant, aspect_ratio: parameters.aspect_ratio, resolution: parameters.resolution, file_urls: files } });
        const intentFingerprint = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, variant: input.variant,
          prompt: input.prompt, parameters, source_profile_schema_hash: profile.profile_schema_hash,
          drawing_profile_schema_hash: current.drawing?.drawing_profile_schema_hash ?? null,
          original_sha256: current.original.original_sha256, drawing_sha256: current.drawing?.drawing_sha256 ?? null });
        const requestFingerprint = schemaHash(request);
        const sourceBinding = deepFreeze({ generation: profile.source_binding, drawing: current.drawing?.source_bindings ?? null });
        const costRoute = Object.freeze({ family: "seedream" as const, variant: input.variant });
        const binding = deepFreeze({ attempt_id: input.attemptId, principal, variant: input.variant, profile_id: profile.profile_id,
          profile_schema_hash: profile.profile_schema_hash, source_binding: sourceBinding, original_handle: input.originalHandle,
          drawing_handle: input.drawingHandle, original_sha256: current.original.original_sha256,
          drawing_sha256: current.drawing?.drawing_sha256 ?? null, original_epoch: current.original.epoch,
          drawing_epoch: current.drawing?.drawing_epoch ?? null, expires_at: expiry, request_fingerprint: requestFingerprint,
          intent_fingerprint: intentFingerprint, parameters, cost_route: costRoute, cost_inputs: costInputs }) as OwnerSeedreamEditorImageCandidateBinding;
        const candidate = Object.create(null) as OwnerSeedreamEditorImagePreparedCandidate;
        Object.defineProperties(candidate, { [BRAND]: { value: true }, status: { value: "blocked", enumerable: true },
          dispatch_allowed: { value: false, enumerable: true }, source_readiness: { value: "SOURCE_JOINED_GENUINE_EDITOR_REFERENCES_AND_EXPLICIT_CONTROLS", enumerable: true },
          backend_acceptance: { value: "UNPROVEN", enumerable: true }, profile_id: { value: profile.profile_id, enumerable: true },
          profile_schema_hash: { value: profile.profile_schema_hash, enumerable: true }, source_binding: { value: sourceBinding, enumerable: true },
          variant: { value: input.variant, enumerable: true }, parameters: { value: binding.parameters, enumerable: true },
          cost_route: { value: costRoute, enumerable: true },
          cost_inputs: { value: binding.cost_inputs, enumerable: true }, expires_at: { value: binding.expires_at, enumerable: true },
          request_fingerprint: { value: binding.request_fingerprint, enumerable: true }, intent_fingerprint: { value: binding.intent_fingerprint, enumerable: true },
          references: { value: deepFreeze([{ role: "original", mime_type: current.original.original_mime_type, width: current.original.width,
            height: current.original.height, size: current.original.size, sha256: current.original.original_sha256 }, ...(current.drawing ? [{ role: "drawing" as const,
              mime_type: current.drawing.drawing_mime_type, width: current.drawing.drawing_width, height: current.drawing.drawing_height,
              size: current.drawing.drawing_size, sha256: current.drawing.drawing_sha256 }] : [])]), enumerable: true } });
        Object.freeze(candidate);
        const state: CandidateState = { owner, candidate, attemptId: input.attemptId, principal, originalHandle: input.originalHandle,
          drawingHandle: input.drawingHandle, variant: input.variant, original: current.original, drawing: current.drawing, request, prompt: input.prompt, binding,
          expiry, epoch: opEpoch, lastNow: Math.max(before, readNow()), expired: false };
        states.set(candidate, state); candidates.add(candidate); return candidate;
      })();
      pending.add(operation);
      try { return await operation; } finally { pending.delete(operation); }
    },
    inspectCandidate(value: unknown) { try { return getBinding(stateFor(value)); } catch { return undefined; } },
    getPrivateRequest(value: unknown) { return stateFor(value).request; },
    async revalidateCandidate(value: unknown) {
      const state = stateFor(value); const epoch = epochs.get(state.attemptId) ?? 0;
      const beforePrincipal = await principalFor(state.attemptId);
      if (!sameGenerationPrincipal(beforePrincipal, state.principal)) { state.expired = true; fail("PRINCIPAL_MISMATCH"); }
      const input = { attemptId: state.attemptId, variant: state.variant, originalHandle: state.originalHandle,
        drawingHandle: state.drawingHandle, parameters: { variant: state.variant, prompt: state.prompt, parameters: state.binding.parameters },
        prompt: state.prompt } as SnapInput;
      let fresh: { original: OwnerSeedreamEditorOriginalPrivateResolution; drawing: OwnerSeedreamEditorDrawingPrivateResolution | null };
      try { fresh = await resolveCurrent(input, beforePrincipal); } catch (error) { state.expired = true; throw error; }
      assertOpen();
      if ((epochs.get(state.attemptId) ?? 0) !== epoch || state.epoch !== epoch) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
      const afterPrincipal = await principalFor(state.attemptId);
      if (!sameGenerationPrincipal(beforePrincipal, afterPrincipal) || !samePair(state, fresh)) { state.expired = true; fail("REFERENCE_UNAVAILABLE"); }
      if (readNow() >= state.expiry) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
      return getBinding(state);
    },
    async invalidateAttempt(attemptInput: string) {
      const attempt = readAttempt(attemptInput); invalidating.add(attempt); epochs.set(attempt, (epochs.get(attempt) ?? 0) + 1);
      for (const candidate of candidates) { const state = states.get(candidate)!; if (state.attemptId === attempt) { state.expired = true; candidates.delete(candidate); } }
      await Promise.allSettled([...pending]); invalidating.delete(attempt);
    },
    close() { if (closing) return closing; closed = true; for (const candidate of candidates) states.get(candidate)!.expired = true;
      candidates.clear(); closing = Promise.allSettled([...pending]).then(() => { epochs.clear(); invalidating.clear(); }); return closing; }
  });
  return new OwnerSeedreamEditorImageRequestPreparer(PREPARER_KEY, api);

  async function principalFor(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return await resolveOwnerReferencePrincipal({ binding: options.binding, attemptId, linkService: options.linkService }); }
    catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_MISMATCH"); fail("PRINCIPAL_MISMATCH"); }
  }
  function pruneCandidates(): void { const now = readNow(); for (const candidate of candidates) { const state = states.get(candidate)!;
    if (state.expired || state.expiry <= now) { state.expired = true; candidates.delete(candidate); } } }
}

export function isOwnerSeedreamEditorImageRequestPreparer(value: unknown): value is OwnerSeedreamEditorImageRequestPreparer {
  return !!value && typeof value === "object" && !isProxy(value) && Object.getPrototypeOf(value) === OwnerSeedreamEditorImageRequestPreparer.prototype &&
    value instanceof OwnerSeedreamEditorImageRequestPreparer && preparers.has(value as object) && Object.isFrozen(value);
}

export function isOwnerSeedreamEditorImagePreparedCandidate(value: unknown): value is OwnerSeedreamEditorImagePreparedCandidate {
  if (!value || typeof value !== "object" || isProxy(value)) return false;
  const state = states.get(value as object); return !!state && state.candidate === value && Object.isFrozen(value);
}

function readOptions(value: unknown): Readonly<OwnerSeedreamEditorImageRequestPreparerOptions> {
  const f = exact(value, ["binding", "linkService", "originalReferenceService", "drawingReferenceService"], ["now"]);
  if (!f.originalReferenceService || !f.drawingReferenceService || !f.linkService || typeof f.linkService !== "object" || isProxy(f.linkService) ||
      (f.now !== undefined && (typeof f.now !== "function" || isProxy(f.now)))) fail("SERVICE_BINDING_MISMATCH");
  const binding = exact(f.binding, ["tenant_id", "subject"]);
  if (typeof binding.tenant_id !== "string" || typeof binding.subject !== "string") fail("SERVICE_BINDING_MISMATCH");
  return Object.freeze({ binding: Object.freeze({ tenant_id: binding.tenant_id, subject: binding.subject }),
    linkService: f.linkService as Pick<PerUserLinkService, "getStatus">,
    originalReferenceService: f.originalReferenceService as OwnerSeedreamEditorOriginalReferenceService,
    drawingReferenceService: f.drawingReferenceService as OwnerSeedreamEditorDrawingReferenceService,
    ...(f.now === undefined ? {} : { now: f.now as () => number }) });
}
function assertService<T extends object>(value: unknown, constructor: new (...args: never[]) => T, method: string, captured: Function): asserts value is T {
  if (!value || typeof value !== "object" || isProxy(value) || Object.getPrototypeOf(value) !== constructor.prototype || !(value instanceof constructor)) fail("SERVICE_BINDING_MISMATCH");
  const d = Object.getOwnPropertyDescriptor(constructor.prototype, method);
  if (!d || !("value" in d) || d.value !== captured) fail("SERVICE_BINDING_MISMATCH");
}
function snapshotInput(value: unknown): SnapInput {
  const f = exact(value, ["attemptId", "variant", "prompt", "parameters", "original_handle", "drawing_handle"], ["signal"]);
  const attemptId = readAttempt(f.attemptId);
  if (typeof f.variant !== "string" || !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(f.variant as OwnerSeedreamImageVariant) ||
      typeof f.original_handle !== "string" || !/^seedream_editor_original_[0-9a-f-]{36}$/u.test(f.original_handle) ||
      (f.drawing_handle !== null && (typeof f.drawing_handle !== "string" || !/^seedream_editor_drawing_[0-9a-f-]{36}$/u.test(f.drawing_handle)))) fail("INVALID_REQUEST");
  if (f.signal !== undefined && (isProxy(f.signal) || !(f.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  if (typeof f.prompt !== "string" || !wellFormedUnicode(f.prompt) || f.prompt.trim().length === 0 ||
      Buffer.byteLength(f.prompt, "utf8") > OWNER_SEEDREAM_EDITOR_GENERATION_PROMPT_LOCAL_BOUND.max_utf8_bytes) fail("PROMPT_INVALID");
  let normalized: Readonly<OwnerSeedreamEditorGenerationParameters>;
  try { normalized = normalizeOwnerSeedreamEditorGenerationParameters({ variant: f.variant, prompt: f.prompt, parameters: f.parameters }); }
  catch { fail("PARAMETERS_INVALID"); }
  return Object.freeze({ attemptId, variant: normalized.variant, prompt: normalized.prompt, parameters: normalized,
    originalHandle: f.original_handle, drawingHandle: f.drawing_handle as string | null, ...(f.signal === undefined ? {} : { signal: f.signal as AbortSignal }) });
}
function samePair(state: CandidateState, value: { original: OwnerSeedreamEditorOriginalPrivateResolution; drawing: OwnerSeedreamEditorDrawingPrivateResolution | null }): boolean {
  return isDeepStrictEqual(state.original, value.original) && isDeepStrictEqual(state.drawing, value.drawing);
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function readClock(value?: () => number): number { let result: unknown; try { result = value === undefined ? Date.now() : Reflect.apply(value, undefined, []); }
  catch { fail("CLOCK_INVALID"); } if (!Number.isSafeInteger(result) || (result as number) < 0) fail("CLOCK_INVALID"); return result as number; }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) fail("INVALID_REQUEST");
  const desc = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(desc);
  if (keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) ||
      required.some((key) => !Object.hasOwn(desc, key))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key)!; if (!("value" in descriptor) || !descriptor.enumerable || typeof key !== "string") fail("INVALID_REQUEST"); result[key] = descriptor.value; }
  return result;
}
async function waitForResolution<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) fail("REQUEST_ABORTED");
  const result = await promise;
  if (signal?.aborted) fail("REQUEST_ABORTED");
  return result;
}
function wellFormedUnicode(value: string): boolean { for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff) { const n = value.charCodeAt(i + 1); if (n < 0xdc00 || n > 0xdfff) return false; i += 1; }
  else if (c >= 0xdc00 && c <= 0xdfff) return false; } return true; }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
function fail(code: OwnerSeedreamEditorImageRequestPreparerErrorCode): never { throw new OwnerSeedreamEditorImageRequestPreparerError(code); }
