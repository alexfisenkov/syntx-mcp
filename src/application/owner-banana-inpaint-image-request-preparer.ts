import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  OwnerBananaInpaintOriginalReferenceService,
  type OwnerBananaInpaintOriginalPrivateResolution
} from "./owner-banana-inpaint-original-reference-service.js";
import {
  OwnerBananaInpaintPaintedCompositeReferenceService,
  type OwnerBananaInpaintPaintedCompositePrivateResolution
} from "./owner-banana-inpaint-painted-composite-reference-service.js";
import {
  OwnerBananaInpaintAuxiliaryImageResolution,
  OwnerBananaInpaintAuxiliaryReferenceService,
  type OwnerBananaInpaintAuxiliaryImageResolution as OwnerBananaAuxiliaryResolution
} from "./owner-banana-inpaint-auxiliary-reference-service.js";
import { getOwnerBananaInpaintAuxiliarySourceProfile } from "./owner-banana-inpaint-auxiliary-source-profile.js";
import {
  getOwnerBananaInpaintImageSourceProfile,
  normalizeOwnerBananaInpaintPrompt,
  OWNER_BANANA_INPAINT_IMAGE_VARIANTS,
  type OwnerBananaInpaintImageVariant,
  type OwnerBananaInpaintImageSourceProfile
} from "./owner-banana-inpaint-image-source-profile.js";
import {
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  type OwnerBananaInpaintOriginalUploadSourceProfile
} from "./owner-banana-inpaint-original-upload-source-profile.js";
import { getOwnerBananaInpaintPaintedCompositeSourceProfile } from "./owner-banana-inpaint-painted-composite-source-profile.js";
import {
  getOwnerBananaInpaintSourceParameters,
  normalizeOwnerBananaInpaintParameters,
  type OwnerBananaInpaintSourceParameters
} from "./owner-banana-inpaint-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL_RESOLVE = OwnerBananaInpaintOriginalReferenceService.prototype.resolveOriginal;
const PAINTED_RESOLVE = OwnerBananaInpaintPaintedCompositeReferenceService.prototype.resolvePaintedComposite;
const AUXILIARY_RESOLVE = OwnerBananaInpaintAuxiliaryReferenceService.prototype.resolveReference;
const AUXILIARY_AUTHENTIC = OwnerBananaInpaintAuxiliaryImageResolution.prototype.isAuthenticResolution;
const BRAND: unique symbol = Symbol("OwnerBananaInpaintImagePreparedCandidate");
const candidateStates = new WeakMap<object, CandidateState>();
const ownerPreparers = new WeakSet<object>();

export interface OwnerBananaInpaintImageTrustedProfileSet {
  readonly originalProfile: Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>;
  readonly paintedProfile: Readonly<ReturnType<typeof getOwnerBananaInpaintPaintedCompositeSourceProfile>>;
  readonly controlsProfile: Readonly<OwnerBananaInpaintSourceParameters>;
  readonly imageProfile: Readonly<OwnerBananaInpaintImageSourceProfile>;
}

export interface OwnerBananaInpaintImageRequestPreparerOptions {
  /** Bound by trusted owner-runtime composition; it is never part of prepare() input. */
  readonly attemptId: string;
  readonly originalReferenceService: OwnerBananaInpaintOriginalReferenceService;
  readonly paintedCompositeReferenceService: OwnerBananaInpaintPaintedCompositeReferenceService;
  readonly auxiliaryReferenceService?: OwnerBananaInpaintAuxiliaryReferenceService;
  readonly profiles: readonly OwnerBananaInpaintImageTrustedProfileSet[];
  readonly now?: () => number;
}

export interface PrepareOwnerBananaInpaintImageRequestInput {
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly prompt: string;
  readonly image_size: string | null;
  readonly original_handle: string;
  readonly painted_handle: string;
  readonly auxiliary_reference_handle: string | null;
}

export interface OwnerBananaInpaintImagePreparedCandidate {
  readonly [BRAND]: true;
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: OwnerBananaInpaintImageSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerBananaInpaintImageSourceProfile["source_binding"];
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly model_type: OwnerBananaInpaintImageVariant;
  readonly ai_name: "banana";
  readonly form_ai_name: "banana_inpaint";
  readonly form_id: "banana-inpaint";
  readonly scope: "tool_image_inpaint";
  readonly image_size: string | null;
  readonly reference_count: number;
  readonly references: readonly Readonly<{
    readonly role: "image" | "mask";
    readonly mime_type: string;
    readonly width: number;
    readonly height: number;
    readonly size: number | null;
    readonly sha256: string;
  }>[];
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
}

export interface OwnerBananaInpaintImageRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly editor: true;
    readonly model_type: OwnerBananaInpaintImageVariant;
    readonly image_size: string | null;
    readonly file_urls: readonly Readonly<{ readonly type: "image" | "mask"; readonly url: string }>[];
  }>;
}

export interface OwnerBananaInpaintImageCandidateBinding {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerBananaInpaintImageSourceProfile["source_binding"];
  readonly original_handle: string;
  readonly painted_handle: string;
  readonly original_sha256: string;
  readonly painted_sha256: string;
  readonly original_epoch: number;
  readonly painted_epoch: number;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly auxiliary_reference_handle: string | null;
  readonly auxiliary_profile_schema_hash: string | null;
  readonly auxiliary_sha256: string | null;
  readonly auxiliary_epoch: number | null;
  readonly auxiliary_expires_at: number | null;
}

export interface OwnerBananaInpaintImageRequestPreparer {
  prepare(input: PrepareOwnerBananaInpaintImageRequestInput | unknown): Promise<OwnerBananaInpaintImagePreparedCandidate>;
  inspectCandidate(candidate: unknown): OwnerBananaInpaintImageCandidateBinding | undefined;
  getPrivateRequest(candidate: unknown): OwnerBananaInpaintImageRequest;
  revalidateCandidate(candidate: unknown): Promise<OwnerBananaInpaintImageCandidateBinding>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}

export type OwnerBananaInpaintImageRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "SERVICE_BINDING_MISMATCH" | "SOURCE_BINDING_MISMATCH"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "PRINCIPAL_MISMATCH" | "GEOMETRY_MISMATCH"
  | "PARAMETERS_INVALID" | "PROMPT_INVALID" | "PROMPT_TOO_LONG" | "AUXILIARY_REFERENCE_NOT_READY" | "AUXILIARY_REFERENCE_UNAVAILABLE"
  | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CLOCK_INVALID" | "SERVICE_CLOSED";

export class OwnerBananaInpaintImageRequestPreparerError extends Error {
  constructor(readonly code: OwnerBananaInpaintImageRequestPreparerErrorCode) {
    super("The Banana Inpaint image request candidate could not be prepared safely.");
    this.name = "OwnerBananaInpaintImageRequestPreparerError";
  }
}

interface PrivateFile {
  readonly type: "image" | "mask";
  readonly url: string;
}

interface PairSnapshot {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly original: Readonly<OwnerBananaInpaintOriginalPrivateResolution>;
  readonly painted: Readonly<OwnerBananaInpaintPaintedCompositePrivateResolution>;
  readonly auxiliary: Readonly<OwnerBananaAuxiliaryResolution> | null;
}

interface CandidateState {
  readonly owner: object;
  readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly profileSet: Readonly<OwnerBananaInpaintImageTrustedProfileSet>;
  readonly originalHandle: string;
  readonly paintedHandle: string;
  readonly auxiliaryHandle: string | null;
  readonly pair: PairSnapshot;
  readonly request: OwnerBananaInpaintImageRequest;
  readonly expiry: number;
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
  readonly epoch: number;
  lastNow: number;
  expired: boolean;
}

/** Creates a trusted, non-dispatchable candidate from the actual owner-owned reference services. */
export function createOwnerBananaInpaintImageRequestPreparer(
  optionsInput: OwnerBananaInpaintImageRequestPreparerOptions | unknown
): OwnerBananaInpaintImageRequestPreparer {
  const options = readOptions(optionsInput);
  assertService(options.originalReferenceService, OwnerBananaInpaintOriginalReferenceService.prototype, "resolveOriginal", ORIGINAL_RESOLVE);
  assertService(options.paintedCompositeReferenceService, OwnerBananaInpaintPaintedCompositeReferenceService.prototype,
    "resolvePaintedComposite", PAINTED_RESOLVE);
  if (options.auxiliaryReferenceService !== undefined) {
    assertService(options.auxiliaryReferenceService, OwnerBananaInpaintAuxiliaryReferenceService.prototype,
      "resolveReference", AUXILIARY_RESOLVE);
  }
  const profiles = bindProfiles(options.profiles);
  const owner = Object.freeze({});
  const candidates = new Set<object>();
  const pending = new Set<Promise<unknown>>();
  let epoch = 0;
  let invalidated = false;
  let closed = false;
  let lastNow = readClock(options.now);

  const assertOpen = (): void => { if (closed) fail("SERVICE_CLOSED"); if (invalidated) fail("CANDIDATE_EXPIRED"); };
  const readCurrent = (): number => {
    const current = readClock(options.now);
    if (current < lastNow) fail("CLOCK_INVALID");
    lastNow = current;
    return current;
  };
  const stateFor = (candidateInput: unknown): CandidateState => {
    if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || isProxy(candidateInput)) fail("CANDIDATE_UNBOUND");
    const state = candidateStates.get(candidateInput as object);
    if (!state || state.owner !== owner || state.candidate !== candidateInput) fail("CANDIDATE_UNBOUND");
    if (closed) fail("SERVICE_CLOSED");
    if (state.epoch !== epoch || state.expired) fail("CANDIDATE_EXPIRED");
    let current: number;
    try { current = readCurrent(); }
    catch (error) { state.expired = true; throw error; }
    if (current >= state.expiry || current < state.lastNow) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
    state.lastNow = current;
    return state;
  };
  const inspectCandidate = (candidateInput: unknown): OwnerBananaInpaintImageCandidateBinding | undefined => {
    if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || isProxy(candidateInput)) return undefined;
    const state = candidateStates.get(candidateInput as object);
    if (!state || state.owner !== owner || state.candidate !== candidateInput || state.expired || state.epoch !== epoch || closed) return undefined;
    let current: number;
    try { current = readCurrent(); }
    catch { state.expired = true; return undefined; }
    if (current < state.lastNow || current >= state.expiry) { state.expired = true; return undefined; }
    state.lastNow = current;
    return bindingOf(state);
  };
  const getPrivateRequest = (candidateInput: unknown): OwnerBananaInpaintImageRequest => stateFor(candidateInput).request;
  const revalidateCandidate = async (candidateInput: unknown): Promise<OwnerBananaInpaintImageCandidateBinding> => {
    const state = stateFor(candidateInput);
    const operationEpoch = epoch;
    const current = await resolvePair(options, profiles.get(state.variant)!, state.variant, state.originalHandle, state.paintedHandle, state.auxiliaryHandle);
    assertOpen();
    if (operationEpoch !== epoch) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
    const after = readCurrent();
    if (state.expiry <= after || !samePair(state.pair, current) || !sameGenerationPrincipal(state.principal, current.principal)) {
      state.expired = true;
      fail("REFERENCE_UNAVAILABLE");
    }
    return bindingOf(state);
  };

  const preparer: OwnerBananaInpaintImageRequestPreparer = Object.freeze({
    prepare(inputInput: PrepareOwnerBananaInpaintImageRequestInput | unknown): Promise<OwnerBananaInpaintImagePreparedCandidate> {
      const operation = (async (): Promise<OwnerBananaInpaintImagePreparedCandidate> => {
      assertOpen();
      const request = readPrepareInput(inputInput);
      const profileSet = profiles.get(request.variant);
      if (!profileSet) fail("PROFILE_BINDING_MISMATCH");
      const profile = profileSet.imageProfile;
      if (request.auxiliary_reference_handle !== null && options.auxiliaryReferenceService === undefined) fail("AUXILIARY_REFERENCE_NOT_READY");
      let normalizedPrompt: ReturnType<typeof normalizeOwnerBananaInpaintPrompt>;
      try { normalizedPrompt = normalizeOwnerBananaInpaintPrompt({ variant: request.variant, prompt: request.prompt }); }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "PROMPT_TOO_LONG") fail("PROMPT_TOO_LONG");
        fail("PROMPT_INVALID");
      }
      let normalizedParameters;
      try { normalizedParameters = normalizeOwnerBananaInpaintParameters({ variant: request.variant, image_size: request.image_size }); }
      catch { fail("PARAMETERS_INVALID"); }
      const before = readCurrent();
      const operationEpoch = epoch;
      const pair = await resolvePair(options, profileSet, request.variant, request.original_handle, request.painted_handle,
        request.auxiliary_reference_handle);
      assertOpen();
      if (operationEpoch !== epoch) fail("REFERENCE_UNAVAILABLE");
      const checkedAt = readCurrent();
      if (pair.original.expires_at <= checkedAt || pair.painted.expires_at <= checkedAt ||
          pair.auxiliary !== null && pair.auxiliary.expires_at <= checkedAt) fail("REFERENCE_EXPIRED");
      const allReferences = [
        { type: "image" as const, url: pair.original.file_url, role: "image" as const, mime_type: pair.original.mime_type,
          width: pair.original.width, height: pair.original.height, size: pair.original.size, sha256: pair.original.sha256 },
        { type: "mask" as const, url: pair.painted.file_url, role: "mask" as const, mime_type: "image/png",
          width: pair.painted.width, height: pair.painted.height, size: null, sha256: pair.painted.painted_sha256 },
        ...(pair.auxiliary === null ? [] : [{ type: "image" as const, url: pair.auxiliary.file_url, role: "image" as const,
          mime_type: pair.auxiliary.mime_type, width: pair.auxiliary.width, height: pair.auxiliary.height,
          size: pair.auxiliary.size, sha256: pair.auxiliary.sha256 }])
      ];
      const files = canonicalizeFiles(allReferences);
      const publicReferences = deepFreeze(files.map((file) => {
        const source = allReferences.find((entry) => entry.type === file.type && entry.url === file.url);
        if (!source) fail("REFERENCE_UNAVAILABLE");
        return { role: source.role, mime_type: source.mime_type, width: source.width, height: source.height,
          size: source.size, sha256: source.sha256 };
      }));
      const body: OwnerBananaInpaintImageRequest = deepFreeze({
        prompt: normalizedPrompt.prompt,
        settings: {
          editor: true as const,
          model_type: request.variant,
          image_size: normalizedParameters.image_size,
          file_urls: files
        }
      });
      const expiry = Math.min(pair.original.expires_at, pair.painted.expires_at,
        ...(pair.auxiliary === null ? [] : [pair.auxiliary.expires_at]));
      if (expiry <= checkedAt) fail("REFERENCE_EXPIRED");
      const requestFingerprint = schemaHash({ attempt_id: options.attemptId, principal: pair.principal, profile_id: profile.profile_id,
        profile_schema_hash: profile.profile_schema_hash, variant: request.variant, original_handle: request.original_handle,
        painted_handle: request.painted_handle, original_sha256: pair.original.sha256, painted_sha256: pair.painted.painted_sha256,
        original_epoch: pair.original.epoch, painted_epoch: pair.painted.epoch,
        auxiliary: pair.auxiliary === null ? null : { handle: pair.auxiliary.reference_handle,
          profile_schema_hash: pair.auxiliary.profile_schema_hash, sha256: pair.auxiliary.sha256,
          epoch: pair.auxiliary.epoch, expires_at: pair.auxiliary.expires_at }, expires_at: expiry, request: body });
      const intentFingerprint = schemaHash({ principal: { tenant_id: pair.principal.tenant_id, subject_id: pair.principal.subject_id },
        profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash, variant: request.variant,
        image_size: normalizedParameters.image_size, prompt: normalizedPrompt.prompt,
        original_sha256: pair.original.sha256, painted_sha256: pair.painted.painted_sha256,
        auxiliary: pair.auxiliary === null ? null : { profile_schema_hash: pair.auxiliary.profile_schema_hash,
          sha256: pair.auxiliary.sha256, size: pair.auxiliary.size }});
      const data: Record<PropertyKey, unknown> = Object.create(null) as Record<PropertyKey, unknown>;
      Object.defineProperties(data, {
        [BRAND]: { value: true }, status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
        backend_acceptance: { value: "UNPROVEN", enumerable: true }, profile_id: { value: profile.profile_id, enumerable: true },
        profile_schema_hash: { value: profile.profile_schema_hash, enumerable: true }, source_binding: { value: profile.source_binding, enumerable: true },
        variant: { value: request.variant, enumerable: true }, model_type: { value: request.variant, enumerable: true },
        ai_name: { value: "banana", enumerable: true }, form_ai_name: { value: "banana_inpaint", enumerable: true },
        form_id: { value: "banana-inpaint", enumerable: true }, scope: { value: "tool_image_inpaint", enumerable: true },
        image_size: { value: normalizedParameters.image_size, enumerable: true }, reference_count: { value: files.length, enumerable: true },
        references: { value: publicReferences, enumerable: true }, expires_at: { value: expiry, enumerable: true },
        request_fingerprint: { value: requestFingerprint, enumerable: true }, intent_fingerprint: { value: intentFingerprint, enumerable: true }
      });
      const candidate = deepFreeze(data) as unknown as OwnerBananaInpaintImagePreparedCandidate;
      candidateStates.set(candidate, { owner, candidate, attemptId: options.attemptId, principal: pair.principal, variant: request.variant,
        profileSet, originalHandle: request.original_handle, paintedHandle: request.painted_handle,
        auxiliaryHandle: request.auxiliary_reference_handle, pair, request: body,
        expiry, requestFingerprint, intentFingerprint, epoch, lastNow: Math.max(before, checkedAt), expired: false });
      candidates.add(candidate);
      return candidate;
      })();
      pending.add(operation);
      void operation.then(() => pending.delete(operation), () => pending.delete(operation));
      return operation;
    },
    inspectCandidate,
    getPrivateRequest,
    revalidateCandidate,
    async invalidateAttempt(attemptId: string): Promise<void> {
      if (attemptId !== options.attemptId || !ATTEMPT.test(attemptId)) return;
      invalidated = true;
      invalidate();
      await Promise.allSettled([...pending]);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      invalidated = true;
      invalidate();
      await Promise.allSettled([...pending]);
    }
  });
  ownerPreparers.add(preparer as object);
  return preparer;

  function invalidate(): void {
    epoch += 1;
    for (const candidate of candidates) {
      const state = candidateStates.get(candidate);
      if (state) state.expired = true;
    }
    candidates.clear();
  }
}

/** Internal nominal check for trusted consumers; it never inspects caller properties. */
export function isOwnerBananaInpaintImageRequestPreparer(value: unknown): value is OwnerBananaInpaintImageRequestPreparer {
  return value !== null && typeof value === "object" && !isProxy(value) && ownerPreparers.has(value);
}

function readOptions(input: unknown): Readonly<OwnerBananaInpaintImageRequestPreparerOptions> {
  const fields = exact(input, ["attemptId", "originalReferenceService", "paintedCompositeReferenceService", "auxiliaryReferenceService", "profiles", "now"],
    ["attemptId", "originalReferenceService", "paintedCompositeReferenceService", "profiles"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) ||
      (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, originalReferenceService: fields.originalReferenceService as OwnerBananaInpaintOriginalReferenceService,
    paintedCompositeReferenceService: fields.paintedCompositeReferenceService as OwnerBananaInpaintPaintedCompositeReferenceService,
    ...(fields.auxiliaryReferenceService === undefined ? {} : { auxiliaryReferenceService: fields.auxiliaryReferenceService as OwnerBananaInpaintAuxiliaryReferenceService }),
    profiles: fields.profiles as readonly OwnerBananaInpaintImageTrustedProfileSet[],
    ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}

function bindProfiles(input: unknown): ReadonlyMap<OwnerBananaInpaintImageVariant, Readonly<OwnerBananaInpaintImageTrustedProfileSet>> {
  if (!Array.isArray(input) || isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length !== OWNER_BANANA_INPAINT_IMAGE_VARIANTS.length) {
    fail("PROFILE_BINDING_MISMATCH");
  }
  const map = new Map<OwnerBananaInpaintImageVariant, Readonly<OwnerBananaInpaintImageTrustedProfileSet>>();
  for (const value of input) {
    const fields = exact(value, ["originalProfile", "paintedProfile", "controlsProfile", "imageProfile"]);
    const original = fields.originalProfile as OwnerBananaInpaintImageTrustedProfileSet["originalProfile"];
    const painted = fields.paintedProfile as OwnerBananaInpaintImageTrustedProfileSet["paintedProfile"];
    const controls = fields.controlsProfile as OwnerBananaInpaintImageTrustedProfileSet["controlsProfile"];
    const image = fields.imageProfile as OwnerBananaInpaintImageTrustedProfileSet["imageProfile"];
    const variant = original?.variant;
    if (!OWNER_BANANA_INPAINT_IMAGE_VARIANTS.includes(variant) || map.has(variant)) fail("PROFILE_BINDING_MISMATCH");
    const expectedPainted = getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, original);
    const expectedControls = getOwnerBananaInpaintSourceParameters(variant, original);
    if (!sameProfile(painted, expectedPainted) || !sameProfile(controls, expectedControls)) fail("PROFILE_BINDING_MISMATCH");
    const expectedImage = getOwnerBananaInpaintImageSourceProfile(variant, original, painted, controls);
    if (!sameProfile(image, expectedImage)) fail("PROFILE_BINDING_MISMATCH");
    map.set(variant, Object.freeze({ originalProfile: original, paintedProfile: painted, controlsProfile: controls, imageProfile: image }));
  }
  if (OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS.some((variant) => !map.has(variant))) fail("PROFILE_BINDING_MISMATCH");
  return map;
}

async function resolvePair(options: Readonly<OwnerBananaInpaintImageRequestPreparerOptions>,
  profileSet: Readonly<OwnerBananaInpaintImageTrustedProfileSet>, variant: OwnerBananaInpaintImageVariant,
  originalHandle: string, paintedHandle: string, auxiliaryHandle: string | null): Promise<PairSnapshot> {
  const profile = profileSet.imageProfile;
  const originalProfile = profile.source_binding.original_upload_profile_schema_hash;
  let paintedRaw: OwnerBananaInpaintPaintedCompositePrivateResolution;
  try {
    paintedRaw = await Reflect.apply(PAINTED_RESOLVE, options.paintedCompositeReferenceService,
      [{ attempt_id: options.attemptId, variant, original_handle: originalHandle, painted_handle: paintedHandle }]) as OwnerBananaInpaintPaintedCompositePrivateResolution;
  } catch { fail("REFERENCE_UNAVAILABLE"); }
  const principal = snapshotPrincipal(paintedRaw.principal);
  let originalRaw: OwnerBananaInpaintOriginalPrivateResolution;
  try {
    originalRaw = await Reflect.apply(ORIGINAL_RESOLVE, options.originalReferenceService, [{ principal, attempt_id: options.attemptId,
      variant, form_id: "banana-inpaint", source_role: "inpaint_original", public_catalog_version: profile.public_catalog_version,
      settings_inventory_version: profile.settings_inventory_version, profile_schema_hash: originalProfile, reference_handle: originalHandle }]) as OwnerBananaInpaintOriginalPrivateResolution;
  } catch { fail("REFERENCE_UNAVAILABLE"); }
  const original = validateOriginal(originalRaw, options.attemptId, variant, originalHandle, profile, principal);
  const painted = validatePainted(paintedRaw, options.attemptId, variant, originalHandle, paintedHandle, profile, principal, original);
  let auxiliary: Readonly<OwnerBananaAuxiliaryResolution> | null = null;
  if (auxiliaryHandle !== null) {
    const auxiliaryService = options.auxiliaryReferenceService;
    if (!auxiliaryService) fail("AUXILIARY_REFERENCE_NOT_READY");
    let raw: unknown;
    try { raw = await Reflect.apply(AUXILIARY_RESOLVE, auxiliaryService, [{ attempt_id: options.attemptId, variant, reference_handle: auxiliaryHandle }]); }
    catch { fail("AUXILIARY_REFERENCE_UNAVAILABLE"); }
    const expectedAuxiliaryProfile = getOwnerBananaInpaintAuxiliarySourceProfile(variant, profileSet.originalProfile);
    auxiliary = validateAuxiliary(raw, options.attemptId, variant, auxiliaryHandle, expectedAuxiliaryProfile, principal);
  }
  return Object.freeze({ principal, original, painted, auxiliary });
}

function validateOriginal(value: OwnerBananaInpaintOriginalPrivateResolution, attemptId: string, variant: OwnerBananaInpaintImageVariant,
  handle: string, profile: Readonly<OwnerBananaInpaintImageSourceProfile>, principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerBananaInpaintOriginalPrivateResolution> {
  if (!value || value.role !== "inpaint_original" || value.wire_type !== "image" || value.attempt_id !== attemptId ||
      value.variant !== variant || value.form_id !== "banana-inpaint" || value.source_role !== "inpaint_original" ||
      value.reference_handle !== handle || !sameGenerationPrincipal(value.principal, principal) ||
      value.public_catalog_version !== profile.public_catalog_version || value.settings_inventory_version !== profile.settings_inventory_version ||
      value.profile_schema_hash !== profile.source_binding.original_upload_profile_schema_hash || value.generation_permit !== false ||
      !isSafeUploadReferenceUrl(value.file_url) || !isSha(value.sha256) || !isSafePositive(value.width) || !isSafePositive(value.height) ||
      !isSafePositive(value.size) || !Number.isSafeInteger(value.epoch) || value.epoch < 0 || !Number.isSafeInteger(value.expires_at)) fail("REFERENCE_UNAVAILABLE");
  return value;
}

function validatePainted(value: OwnerBananaInpaintPaintedCompositePrivateResolution, attemptId: string, variant: OwnerBananaInpaintImageVariant,
  originalHandle: string, paintedHandle: string, profile: Readonly<OwnerBananaInpaintImageSourceProfile>,
  principal: Readonly<GenerationPrincipalRef>, original: Readonly<OwnerBananaInpaintOriginalPrivateResolution>): Readonly<OwnerBananaInpaintPaintedCompositePrivateResolution> {
  if (!value || value.role !== "painted_composite" || value.wire_type !== "mask" || value.attempt_id !== attemptId || value.variant !== variant ||
      value.form_id !== "banana-inpaint" || value.source_role !== "painted_composite" || value.original_handle !== originalHandle ||
      value.painted_handle !== paintedHandle || !sameGenerationPrincipal(value.principal, principal) ||
      value.public_catalog_version !== profile.public_catalog_version || value.settings_inventory_version !== profile.settings_inventory_version ||
      value.profile_schema_hash !== profile.source_binding.painted_composite_profile_schema_hash ||
      value.original_profile_schema_hash !== profile.source_binding.original_upload_profile_schema_hash || value.generation_permit !== false ||
      value.original_sha256 !== original.sha256 || value.original_width !== original.width || value.original_height !== original.height ||
      value.original_epoch !== original.epoch || value.expires_at !== original.expires_at ||
      !isSafeUploadReferenceUrl(value.file_url) || !isSha(value.painted_sha256) || !isSafePositive(value.width) ||
      !isSafePositive(value.height) || !Number.isSafeInteger(value.epoch) || value.epoch < 0 ||
      !Number.isSafeInteger(value.expires_at)) fail("REFERENCE_UNAVAILABLE");
  if (value.width !== original.width || value.height !== original.height) fail("GEOMETRY_MISMATCH");
  return value;
}

function validateAuxiliary(value: unknown, attemptId: string, variant: OwnerBananaInpaintImageVariant, handle: string,
  profile: Readonly<ReturnType<typeof getOwnerBananaInpaintAuxiliarySourceProfile>>,
  principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerBananaAuxiliaryResolution> {
  if (!value || typeof value !== "object" || isProxy(value) || Object.getPrototypeOf(value) !== OwnerBananaInpaintAuxiliaryImageResolution.prototype ||
      Object.hasOwn(value, "isAuthenticResolution") || !Object.isFrozen(value)) fail("AUXILIARY_REFERENCE_UNAVAILABLE");
  const descriptor = Object.getOwnPropertyDescriptor(OwnerBananaInpaintAuxiliaryImageResolution.prototype, "isAuthenticResolution");
  if (!descriptor || !("value" in descriptor) || descriptor.value !== AUXILIARY_AUTHENTIC || typeof AUXILIARY_AUTHENTIC !== "function") {
    fail("SERVICE_BINDING_MISMATCH");
  }
  let authentic = false;
  try { authentic = Reflect.apply(AUXILIARY_AUTHENTIC, value, []) as boolean; } catch { fail("AUXILIARY_REFERENCE_UNAVAILABLE"); }
  const resolution = value as OwnerBananaAuxiliaryResolution;
  if (!authentic || resolution.role !== "auxiliary_image" || resolution.wire_type !== "image" ||
      resolution.source_role !== "auxiliary_image" || resolution.form_id !== "banana-inpaint" ||
      resolution.attempt_id !== attemptId || resolution.variant !== variant || resolution.reference_handle !== handle ||
      !sameGenerationPrincipal(resolution.principal, principal) || resolution.profile_schema_hash !== profile.profile_schema_hash ||
      resolution.public_catalog_version !== profile.public_catalog_version || resolution.settings_inventory_version !== profile.settings_inventory_version ||
      resolution.generation_permit !== false || !profile.local_input_policy.accepted_mime_types.includes(resolution.mime_type as never) ||
      !isSafeUploadReferenceUrl(resolution.file_url) || !isSha(resolution.sha256) || !isSafePositive(resolution.width) ||
      !isSafePositive(resolution.height) || !isSafePositive(resolution.size) || !Number.isSafeInteger(resolution.epoch) ||
      resolution.epoch < 0 || !Number.isSafeInteger(resolution.expires_at)) fail("AUXILIARY_REFERENCE_UNAVAILABLE");
  return resolution;
}

function samePair(left: PairSnapshot, right: PairSnapshot): boolean {
  const sameAuxiliary = left.auxiliary === null || right.auxiliary === null
    ? left.auxiliary === right.auxiliary
    : left.auxiliary.reference_handle === right.auxiliary.reference_handle &&
      left.auxiliary.profile_schema_hash === right.auxiliary.profile_schema_hash && left.auxiliary.sha256 === right.auxiliary.sha256 &&
      left.auxiliary.epoch === right.auxiliary.epoch && left.auxiliary.expires_at === right.auxiliary.expires_at &&
      left.auxiliary.file_url === right.auxiliary.file_url;
  return sameAuxiliary && sameGenerationPrincipal(left.principal, right.principal) && left.original.reference_handle === right.original.reference_handle &&
    left.original.sha256 === right.original.sha256 && left.original.epoch === right.original.epoch && left.original.expires_at === right.original.expires_at &&
    left.original.file_url === right.original.file_url && left.painted.painted_handle === right.painted.painted_handle &&
    left.painted.painted_sha256 === right.painted.painted_sha256 && left.painted.epoch === right.painted.epoch &&
    left.painted.expires_at === right.painted.expires_at && left.painted.file_url === right.painted.file_url;
}

function bindingOf(state: CandidateState): OwnerBananaInpaintImageCandidateBinding {
  const profile = state.profileSet.imageProfile;
  const auxiliary = state.pair.auxiliary;
  return deepFreeze({ attempt_id: state.attemptId, principal: state.principal, variant: state.variant, profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash, source_binding: profile.source_binding,
    original_handle: state.originalHandle, painted_handle: state.paintedHandle, original_sha256: state.pair.original.sha256,
    painted_sha256: state.pair.painted.painted_sha256, original_epoch: state.pair.original.epoch, painted_epoch: state.pair.painted.epoch,
    expires_at: state.expiry, request_fingerprint: state.requestFingerprint, intent_fingerprint: state.intentFingerprint,
    auxiliary_reference_handle: auxiliary?.reference_handle ?? null,
    auxiliary_profile_schema_hash: auxiliary?.profile_schema_hash ?? null,
    auxiliary_sha256: auxiliary?.sha256 ?? null,
    auxiliary_epoch: auxiliary?.epoch ?? null,
    auxiliary_expires_at: auxiliary?.expires_at ?? null });
}

function readPrepareInput(input: unknown): Required<PrepareOwnerBananaInpaintImageRequestInput> {
  const fields = exact(input, ["variant", "prompt", "image_size", "original_handle", "painted_handle", "auxiliary_reference_handle"]);
  if (!OWNER_BANANA_INPAINT_IMAGE_VARIANTS.includes(fields.variant as OwnerBananaInpaintImageVariant) ||
      typeof fields.prompt !== "string" || typeof fields.original_handle !== "string" || typeof fields.painted_handle !== "string" ||
      !(fields.auxiliary_reference_handle === null || typeof fields.auxiliary_reference_handle === "string") ||
      !(fields.image_size === null || typeof fields.image_size === "string")) fail("INVALID_REQUEST");
  return fields as unknown as Required<PrepareOwnerBananaInpaintImageRequestInput>;
}

function assertService(value: unknown, prototype: object, methodName: string, method: unknown): asserts value is object {
  if (!value || typeof value !== "object" || isProxy(value) || Object.getPrototypeOf(value) !== prototype || Object.hasOwn(value, methodName)) fail("SERVICE_BINDING_MISMATCH");
  const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
  if (!descriptor || !("value" in descriptor) || descriptor.value !== method || typeof method !== "function") fail("SERVICE_BINDING_MISMATCH");
}

function snapshotPrincipal(value: unknown): Readonly<GenerationPrincipalRef> {
  try { return snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("PRINCIPAL_MISMATCH"); }
}

function canonicalizeFiles(files: readonly PrivateFile[]): OwnerBananaInpaintImageRequest["settings"]["file_urls"] {
  const seen = new Set<string>();
  const output: PrivateFile[] = [];
  for (const file of files) {
    if (!isSafeUploadReferenceUrl(file.url)) fail("REFERENCE_UNAVAILABLE");
    const key = `${file.type}:${file.url}`;
    if (!seen.has(key)) { seen.add(key); output.push(Object.freeze({ type: file.type, url: file.url })); }
  }
  return Object.freeze(output);
}

function sameProfile(left: unknown, right: unknown): boolean {
  if (!left || typeof left !== "object" || isProxy(left) || !Object.isFrozen(left) || !right || typeof right !== "object") return false;
  try {
    const l = { ...(left as Record<string, unknown>) };
    const r = { ...(right as Record<string, unknown>) };
    const lHash = l.profile_schema_hash; const rHash = r.profile_schema_hash;
    delete l.profile_schema_hash; delete r.profile_schema_hash;
    return lHash === rHash && typeof lHash === "string" && lHash === schemaHash(l) && lHash === schemaHash(r) && isDeepStrictEqual(l, r);
  } catch { return false; }
}

function exact(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
        required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch (error) { if (error instanceof OwnerBananaInpaintImageRequestPreparerError) throw error; fail("INVALID_REQUEST"); }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function readClock(now?: () => number): number {
  let current: number;
  try { current = (now ?? Date.now)(); } catch { fail("CLOCK_INVALID"); }
  if (!Number.isSafeInteger(current) || current < 0) fail("CLOCK_INVALID");
  return current;
}

function isSha(value: unknown): value is `sha256:${string}` { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
function isSafePositive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function fail(code: OwnerBananaInpaintImageRequestPreparerErrorCode): never { throw new OwnerBananaInpaintImageRequestPreparerError(code); }
