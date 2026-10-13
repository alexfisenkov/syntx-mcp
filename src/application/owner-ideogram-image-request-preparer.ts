import { isDeepStrictEqual, types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  normalizeOwnerIdeogramImageParameters,
  type OwnerIdeogramImageMode,
  type OwnerIdeogramImageModelId,
  type OwnerIdeogramImageNormalizedParameters
} from "./owner-ideogram-image-parameters.js";
import {
  OwnerIdeogramImageUploadService,
  OwnerIdeogramImageUploadServiceError,
  type OwnerIdeogramPrivateImageReferenceResolution
} from "./owner-ideogram-image-upload-service.js";
import {
  OwnerIdeogramImageMaskUploadService,
  OwnerIdeogramImageMaskUploadServiceError,
  type OwnerIdeogramPrivateMaskResolution
} from "./owner-ideogram-image-mask-upload-service.js";
import {
  getOwnerIdeogramImageSourceProfile,
  type OwnerIdeogramImageCatalogPort,
  type OwnerIdeogramImageSourceProfile
} from "./owner-ideogram-image-source-profile.js";

const TTL_MS = 15 * 60_000;
const MAX_ASSET_SETS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^ideogram_image_[0-9a-f-]{36}$/u;
const MASK_HANDLE = /^ideogram_mask_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const WIRE_SOURCE_BINDING = Object.freeze({
  custom_settings_sender_sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
  ordered_file_url_canonicalizer_sha256: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706",
  confidence: "STATIC_SOURCE_HELPER_JOIN_NOT_PROVIDER_ACCEPTANCE"
} as const);
const ASSET_SET_BRAND: unique symbol = Symbol("OwnerIdeogramImageAssetSet");
const CANDIDATE_BRAND: unique symbol = Symbol("OwnerIdeogramImagePreparedCandidate");
const assetSets = new WeakMap<object, AssetSetState>();
const revokedAssetSets = new WeakSet<object>();
const candidates = new WeakMap<object, CandidateState>();
const revokedCandidates = new WeakSet<object>();

export interface OwnerIdeogramImageAssetBindingIssuerOptions {
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalog_version: string;
  readonly maskService?: OwnerIdeogramImageMaskUploadService;
  readonly now?: () => number;
}
export interface OwnerIdeogramImageAssetBindingIssueInput {
  readonly principal: GenerationPrincipalRef;
  readonly attempt_id: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly reference_handles: readonly string[];
  readonly mask_handle?: string;
  readonly prompt: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}
export interface OwnerIdeogramImageAssetSet {
  readonly [ASSET_SET_BRAND]: true;
  readonly status: "nominal";
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly reference_count: number;
  readonly mask_present: boolean;
  readonly mask_binding?: OwnerIdeogramImageMaskBinding;
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly expires_at: number;
  readonly generation_permit: false;
  readonly references: readonly Readonly<{
    mime_type: string;
    width: number;
    height: number;
    size: number;
    sha256: string;
    metadata_confidence: "CONTAINER_METADATA_ONLY";
  }>[];
}
export interface OwnerIdeogramImageMaskBinding {
  readonly role: "mask";
  readonly mask_handle: string;
  readonly base_reference_handle: string;
  readonly base_sha256: `sha256:${string}`;
  readonly pair_sha256: `sha256:${string}`;
  readonly normal_sha256: `sha256:${string}`;
  readonly inverse_sha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly geometry_verified: false;
  readonly expires_at: number;
  readonly epoch: number;
  readonly base_epoch: number;
  readonly confidence_scope: "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE";
}
export interface OwnerIdeogramImageAssetBindingIssuer {
  issue(input: OwnerIdeogramImageAssetBindingIssueInput | unknown): Promise<OwnerIdeogramImageAssetSet>;
  invalidateAttempt(attemptId: string): Promise<void>;
  close(): Promise<void>;
}
export interface OwnerIdeogramImagePreparedCandidate {
  readonly [CANDIDATE_BRAND]: true;
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly source_wire_binding: typeof WIRE_SOURCE_BINDING;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly ai_name: "ideogram";
  readonly model_type: OwnerIdeogramImageModelId;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly prompt: string | null;
  readonly prompt_policy: "required" | "disabled";
  readonly native_wire_status: "SOURCE_MAPPED" | "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE";
  readonly request_prompt_confidence: "SOURCE_REQUIRED_PROMPT" | "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE";
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly reference_count: number;
  readonly mask_present: boolean;
  readonly mask_binding?: OwnerIdeogramImageMaskBinding;
  readonly references: OwnerIdeogramImageAssetSet["references"];
  readonly source_json_mapping: Readonly<Record<string, unknown>>;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly cost_input_confidence: string;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly request: Readonly<{ prompt: string; settings: Readonly<Record<string, unknown>> }>;
}
export type OwnerIdeogramImageRequestPreparerErrorCode =
  | "INVALID_REQUEST" | "MODEL_BINDING_MISMATCH" | "PRINCIPAL_MISMATCH" | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "REQUEST_ABORTED"
  | "CLOCK_INVALID" | "PARAMETERS_INVALID" | "CANDIDATE_INVALID" | "CANDIDATE_EXPIRED";

export class OwnerIdeogramImageRequestPreparerError extends Error {
  constructor(readonly code: OwnerIdeogramImageRequestPreparerErrorCode) {
    super("The owner Ideogram image request could not be bound safely.");
    this.name = "OwnerIdeogramImageRequestPreparerError";
  }
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}
interface AssetSetState {
  readonly set: OwnerIdeogramImageAssetSet;
  readonly uploader: OwnerIdeogramImageUploadService;
  readonly maskService?: OwnerIdeogramImageMaskUploadService;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly profile: Readonly<OwnerIdeogramImageSourceProfile>;
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalogVersion: string;
  readonly handles: readonly string[];
  readonly resolutions: readonly Readonly<OwnerIdeogramPrivateImageReferenceResolution>[];
  readonly maskHandle?: string;
  readonly maskResolution?: Readonly<OwnerIdeogramPrivateMaskResolution>;
  readonly maskBinding?: OwnerIdeogramImageMaskBinding;
  readonly normalized: OwnerIdeogramImageNormalizedParameters;
  readonly prompt: string | null;
  readonly expiresAt: number;
  readonly epoch: number;
  lastNow: number;
  expired: boolean;
}
export interface OwnerIdeogramImagePreparedCandidateState {
  readonly candidate: OwnerIdeogramImagePreparedCandidate;
  readonly assetSet: OwnerIdeogramImageAssetSet;
  readonly maskService?: OwnerIdeogramImageMaskUploadService;
  readonly maskHandle?: string;
  readonly maskResolution?: Readonly<OwnerIdeogramPrivateMaskResolution>;
  readonly maskBinding?: OwnerIdeogramImageMaskBinding;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly promptIntent: string | null;
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
  readonly expiresAt: number;
  readonly request: Readonly<{ prompt: string; settings: Readonly<Record<string, unknown>> }>;
  readonly normalized: OwnerIdeogramImageNormalizedParameters;
  readonly profile: Readonly<OwnerIdeogramImageSourceProfile>;
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalogVersion: string;
  readonly now: () => number;
  lastNow: number;
  expired: boolean;
}
type CandidateState = OwnerIdeogramImagePreparedCandidateState;

/** Binds real 683 image handles and an optional 725 role-mask handle; it never issues a generation permit. */
export function createOwnerIdeogramImageAssetBindingIssuer(
  uploaderInput: OwnerIdeogramImageUploadService | unknown,
  optionsInput: OwnerIdeogramImageAssetBindingIssuerOptions | unknown
): OwnerIdeogramImageAssetBindingIssuer {
  const uploader = snapshotUploader(uploaderInput);
  const options = snapshotOptions(optionsInput);
  let closed = false;
  let pendingCount = 0;
  let lastNow: number | undefined;
  const epochs = new Map<string, number>();
  const activeSets = new Map<string, Set<object>>();
  const pendingByAttempt = new Map<string, Set<PendingOperation>>();
  const allOperations = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;

  return Object.freeze({
    async issue(inputInput: OwnerIdeogramImageAssetBindingIssueInput | unknown): Promise<OwnerIdeogramImageAssetSet> {
      const input = snapshotIssueInput(inputInput);
      if (closed) fail("SERVICE_CLOSED");
      const profile = getProfile(input.model_id, input.mode, options.catalog, options.catalog_version);
      const now = readClock(options.now, lastNow); lastNow = now;
      const maskPresent = input.mask_handle !== undefined;
      const normalized = normalizeIntent(input, maskPresent);
      if (maskPresent && (!options.maskService || input.model_id !== "ideogram_45" || input.mode !== "precise_edit")) {
        fail("REFERENCE_UNAVAILABLE");
      }
      pruneActiveSets(activeSets, revokedAssetSets, now);
      if (pendingCount >= MAX_PENDING || activeSetCount(activeSets) >= MAX_ASSET_SETS) fail("SERVICE_BUSY");
      if (!activeSets.has(input.attempt_id) && activeSets.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
      if (now > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CLOCK_INVALID");
      const epoch = epochs.get(input.attempt_id) ?? 0;
      const operation = beginOperation(input.attempt_id, input.signal, epoch, pendingByAttempt, allOperations);
      pendingCount += 1;
      try {
        const resolutions: OwnerIdeogramPrivateImageReferenceResolution[] = [];
        for (const handle of input.reference_handles) {
          throwIfUnavailable(closed, operation.controller.signal);
          let resolution: OwnerIdeogramPrivateImageReferenceResolution;
          try {
            resolution = await uploader.resolveImageReference({ attemptId: input.attempt_id,
              model_id: input.model_id, mode: input.mode, reference_handle: handle });
          } catch (error) {
            if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
            if (error instanceof OwnerIdeogramImageUploadServiceError && error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
            fail("REFERENCE_UNAVAILABLE");
          }
          throwIfUnavailable(closed, operation.controller.signal);
          const resolutionNow = readClock(options.now, lastNow); lastNow = resolutionNow;
          assertResolution(resolution, { principal: input.principal, attemptId: input.attempt_id,
            modelId: input.model_id, mode: input.mode, profile, now: resolutionNow });
          if (resolutions.some((existing) => existing.file_url === resolution.file_url)) fail("REFERENCE_UNAVAILABLE");
          resolutions.push(resolution);
        }
        let maskResolution: OwnerIdeogramPrivateMaskResolution | undefined;
        let maskBinding: OwnerIdeogramImageMaskBinding | undefined;
        if (maskPresent) {
          const base = resolutions[0];
          const baseHandle = input.reference_handles[0];
          if (!base || !baseHandle || !options.maskService || !input.mask_handle) fail("REFERENCE_UNAVAILABLE");
          throwIfUnavailable(closed, operation.controller.signal);
          try {
            maskResolution = await options.maskService.resolveMask({ attemptId: input.attempt_id, mask_handle: input.mask_handle,
              base_reference_handle: baseHandle, signal: operation.controller.signal });
          } catch (error) {
            if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
            if (error instanceof OwnerIdeogramImageMaskUploadServiceError &&
                (error.code === "MASK_HANDLE_EXPIRED" || error.code === "BASE_REFERENCE_EXPIRED")) fail("REFERENCE_EXPIRED");
            fail("REFERENCE_UNAVAILABLE");
          }
          throwIfUnavailable(closed, operation.controller.signal);
          const maskNow = readClock(options.now, lastNow); lastNow = maskNow;
          assertMaskResolution(maskResolution, { principal: input.principal, attemptId: input.attempt_id,
            baseHandle, base, maskHandle: input.mask_handle, profile, now: maskNow });
          maskBinding = snapshotMaskBinding(maskResolution);
        }
        const checkedNow = readClock(options.now, lastNow); lastNow = checkedNow;
        if (closed || operation.controller.signal.aborted || (epochs.get(input.attempt_id) ?? 0) !== epoch) fail("REQUEST_ABORTED");
        const currentProfile = getProfile(input.model_id, input.mode, options.catalog, options.catalog_version);
        if (currentProfile.profile_schema_hash !== profile.profile_schema_hash) fail("MODEL_BINDING_MISMATCH");
        const expiry = Math.min(now + TTL_MS, ...resolutions.map((reference) => reference.expires_at),
          ...(maskResolution ? [maskResolution.expires_at] : []));
        if (expiry <= checkedNow) fail("REFERENCE_EXPIRED");
        const referenceMetadata = Object.freeze(resolutions.map((reference) => Object.freeze({
          mime_type: reference.mime_type, width: reference.width, height: reference.height,
          size: reference.size, sha256: reference.sha256, metadata_confidence: "CONTAINER_METADATA_ONLY" as const
        })));
        const setData = Object.create(null) as Record<PropertyKey, unknown>;
        Object.defineProperties(setData, {
          [ASSET_SET_BRAND]: { value: true }, status: { value: "nominal", enumerable: true },
          model_id: { value: input.model_id, enumerable: true }, mode: { value: input.mode, enumerable: true },
          reference_count: { value: resolutions.length, enumerable: true }, mask_present: { value: maskPresent, enumerable: true },
          profile_id: { value: profile.profile_id, enumerable: true }, profile_schema_hash: { value: profile.profile_schema_hash, enumerable: true },
          catalog_version: { value: profile.public_catalog_version, enumerable: true }, expires_at: { value: expiry, enumerable: true },
          generation_permit: { value: false, enumerable: true }, references: { value: referenceMetadata, enumerable: true },
          ...(maskBinding === undefined ? {} : { mask_binding: { value: maskBinding, enumerable: true } })
        });
        const set = Object.freeze(setData) as unknown as OwnerIdeogramImageAssetSet;
        const state: AssetSetState = { set, uploader, principal: input.principal, attemptId: input.attempt_id, profile,
          catalog: options.catalog, catalogVersion: options.catalog_version, handles: input.reference_handles,
          resolutions: Object.freeze(resolutions), ...(options.maskService === undefined ? {} : { maskService: options.maskService }),
          ...(input.mask_handle === undefined ? {} : { maskHandle: input.mask_handle }),
          ...(maskResolution === undefined ? {} : { maskResolution }), ...(maskBinding === undefined ? {} : { maskBinding }),
          normalized, prompt: input.prompt, expiresAt: expiry, epoch,
          lastNow: checkedNow, expired: false };
        assetSets.set(set, state);
        const bucket = activeSets.get(input.attempt_id) ?? new Set<object>(); bucket.add(set); activeSets.set(input.attempt_id, bucket);
        return set;
      } catch (error) {
        if (error instanceof OwnerIdeogramImageRequestPreparerError) throw error;
        fail("REFERENCE_UNAVAILABLE");
      } finally {
        pendingCount -= 1;
        finishOperation(input.attempt_id, operation, pendingByAttempt, allOperations);
      }
    },
    async invalidateAttempt(attemptIdInput: string): Promise<void> {
      if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput) || closed) return;
      const attemptId = attemptIdInput;
      epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
      for (const set of activeSets.get(attemptId) ?? []) {
        revokedAssetSets.add(set);
        revokeCandidatesForAssetSet(set);
      }
      activeSets.delete(attemptId);
      const pending = [...(pendingByAttempt.get(attemptId) ?? [])];
      for (const operation of pending) operation.controller.abort();
      await options.maskService?.invalidateAttempt(attemptId);
      await uploader.invalidateAttempt(attemptId);
      await Promise.allSettled(pending.map((operation) => operation.done));
    },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      for (const [attemptId, bucket] of activeSets) {
        epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
        for (const set of bucket) {
          revokedAssetSets.add(set);
          revokeCandidatesForAssetSet(set);
        }
      }
      for (const operations of pendingByAttempt.values()) for (const operation of operations) operation.controller.abort();
      const maskClosing = options.maskService?.close();
      const uploaderClosing = uploader.close();
      closing = Promise.allSettled([...allOperations, ...(maskClosing === undefined ? [] : [maskClosing]), uploaderClosing]).then(async () => {
        activeSets.clear(); epochs.clear(); pendingByAttempt.clear(); allOperations.clear();
      });
      return closing;
    }
  });
}

export interface PrepareOwnerIdeogramImageRequestInput {
  readonly principal: GenerationPrincipalRef;
  readonly attempt_id: string;
  readonly asset_set: OwnerIdeogramImageAssetSet;
}
export interface OwnerIdeogramImageRequestPreparerOptions {
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

/** Creates an immutable non-dispatchable candidate; reference wire mapping stays closed until source join. */
export async function prepareOwnerIdeogramImageRequest(
  inputInput: PrepareOwnerIdeogramImageRequestInput | unknown,
  optionsInput: OwnerIdeogramImageRequestPreparerOptions | unknown
): Promise<OwnerIdeogramImagePreparedCandidate> {
  const input = exact(inputInput, ["principal", "attempt_id", "asset_set"]);
  if (typeof input.attempt_id !== "string" || !ATTEMPT.test(input.attempt_id)) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(input.principal, input.attempt_id);
  const options = snapshotOptions(optionsInput);
  const set = input.asset_set as OwnerIdeogramImageAssetSet;
  const state = getOwnerIdeogramImageAssetSetState(set);
  if (!state || state.set !== set || revokedAssetSets.has(set as object) || revokedCandidates.has(set as object)) fail("CANDIDATE_INVALID");
  if (state.attemptId !== input.attempt_id || !sameGenerationPrincipal(state.principal, principal)) fail("PRINCIPAL_MISMATCH");
  if (options.catalog_version !== state.catalogVersion || options.catalog !== state.catalog) fail("MODEL_BINDING_MISMATCH");
  const now = readClock(options.now, state.lastNow);
  if (now >= state.expiresAt || state.expired) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
  if (!observeAssetSetClock(set, now) || !sameJson(getProfile(state.profile.model_id, state.profile.mode, options.catalog,
      options.catalog_version).source_binding, state.profile.source_binding)) fail("MODEL_BINDING_MISMATCH");
  const currentReferences: OwnerIdeogramPrivateImageReferenceResolution[] = [];
  const seenFileUrls = new Set<string>();
  let lastNow = now;
  for (let index = 0; index < state.handles.length; index += 1) {
    if (revokedAssetSets.has(set as object)) fail("CANDIDATE_INVALID");
    let resolution: OwnerIdeogramPrivateImageReferenceResolution;
    try {
      resolution = await state.uploader.resolveImageReference({ attemptId: state.attemptId,
        model_id: state.profile.model_id, mode: state.profile.mode, reference_handle: state.handles[index] });
    } catch (error) {
      if (error instanceof OwnerIdeogramImageUploadServiceError && error.code === "REFERENCE_EXPIRED") fail("REFERENCE_EXPIRED");
      fail("REFERENCE_UNAVAILABLE");
    }
    const resolvedAt = readClock(options.now, lastNow); lastNow = resolvedAt;
    if (revokedAssetSets.has(set as object)) fail("CANDIDATE_INVALID");
    assertResolution(resolution, { principal, attemptId: state.attemptId, modelId: state.profile.model_id,
      mode: state.profile.mode, profile: state.profile, now: resolvedAt });
    const original = state.resolutions[index];
    if (!original || !sameResolvedReference(original, resolution) || seenFileUrls.has(resolution.file_url)) fail("REFERENCE_UNAVAILABLE");
    seenFileUrls.add(resolution.file_url);
    currentReferences.push(resolution);
  }
  let currentMask: OwnerIdeogramPrivateMaskResolution | undefined;
  let maskBinding: OwnerIdeogramImageMaskBinding | undefined;
  if (state.maskHandle !== undefined) {
    const base = currentReferences[0];
    const baseHandle = state.handles[0];
    if (!state.maskService || !state.maskResolution || !state.maskBinding || !base || !baseHandle) fail("CANDIDATE_INVALID");
    try {
      currentMask = await state.maskService.resolveMask({ attemptId: state.attemptId, mask_handle: state.maskHandle,
        base_reference_handle: baseHandle });
    } catch (error) {
      if (error instanceof OwnerIdeogramImageMaskUploadServiceError && error.code === "MASK_HANDLE_EXPIRED") fail("REFERENCE_EXPIRED");
      fail("REFERENCE_UNAVAILABLE");
    }
    const maskAt = readClock(options.now, lastNow); lastNow = maskAt;
    assertMaskResolution(currentMask, { principal, attemptId: state.attemptId, baseHandle, base, maskHandle: state.maskHandle,
      profile: state.profile, now: maskAt });
    if (!sameResolvedMask(state.maskResolution, currentMask)) fail("REFERENCE_UNAVAILABLE");
    maskBinding = snapshotMaskBinding(currentMask);
    if (!isDeepStrictEqual(maskBinding, state.maskBinding) || !isDeepStrictEqual(maskBinding, state.set.mask_binding)) fail("CANDIDATE_INVALID");
  } else if (state.set.mask_present || state.maskResolution || state.maskBinding) fail("CANDIDATE_INVALID");
  lastNow = readClock(options.now, lastNow);
  if (lastNow >= state.expiresAt || revokedAssetSets.has(set as object)) fail("CANDIDATE_EXPIRED");
  state.lastNow = lastNow;
  const files = Object.freeze([
    ...currentReferences.map((reference) => Object.freeze({ type: "image" as const, url: reference.file_url })),
    ...(currentMask === undefined ? [] : [Object.freeze({ type: "mask" as const, url: currentMask.primary_url })])
  ]);
  const settings = deepFreeze({ ...state.normalized.source_json_mapping, file_urls: files });
  const prompt = state.prompt;
  const requestPrompt = prompt ?? "";
  const request = deepFreeze({ prompt: requestPrompt, settings });
  const requestFingerprint = schemaHash({ principal, attempt_id: state.attemptId, profile_id: state.profile.profile_id,
    profile_schema_hash: state.profile.profile_schema_hash, model_id: state.profile.model_id, mode: state.profile.mode,
    source_wire_binding: WIRE_SOURCE_BINDING, prompt, parameters: state.normalized.parameters,
    references: currentReferences.map(privateReferenceDigest), mask_binding: maskBinding ?? null,
    mask_url: currentMask?.primary_url ?? null, request });
  const intentFingerprint = schemaHash({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
    profile_id: state.profile.profile_id, profile_schema_hash: state.profile.profile_schema_hash,
    source_wire_binding: WIRE_SOURCE_BINDING, model_id: state.profile.model_id, mode: state.profile.mode,
    prompt, parameters: state.normalized.parameters,
    references: currentReferences.map((reference) => ({ mime_type: reference.mime_type, width: reference.width,
      height: reference.height, size: reference.size, sha256: reference.sha256 })), mask_binding: maskBinding ?? null });
  const candidateData = Object.create(null) as Record<PropertyKey, unknown>;
  Object.defineProperties(candidateData, {
    [CANDIDATE_BRAND]: { value: true }, status: { value: "blocked", enumerable: true }, dispatch_allowed: { value: false, enumerable: true },
    backend_acceptance: { value: "UNPROVEN", enumerable: true }, profile_id: { value: state.profile.profile_id, enumerable: true },
    profile_schema_hash: { value: state.profile.profile_schema_hash, enumerable: true }, source_binding: { value: state.profile.source_binding, enumerable: true },
    source_wire_binding: { value: WIRE_SOURCE_BINDING, enumerable: true },
    model_id: { value: state.profile.model_id, enumerable: true }, mode: { value: state.profile.mode, enumerable: true },
    ai_name: { value: "ideogram", enumerable: true }, model_type: { value: state.profile.model_id, enumerable: true },
    scope: { value: "image", enumerable: true }, operation_id: { value: "generate-image", enumerable: true },
    prompt: { value: prompt, enumerable: true }, prompt_policy: { value: state.normalized.prompt_policy, enumerable: true },
    native_wire_status: { value: prompt === null ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" : "SOURCE_MAPPED", enumerable: true },
    request_prompt_confidence: { value: prompt === null ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE"
      : "SOURCE_REQUIRED_PROMPT", enumerable: true },
    parameters: { value: state.normalized.parameters, enumerable: true }, reference_count: { value: currentReferences.length, enumerable: true },
    mask_present: { value: currentMask !== undefined, enumerable: true },
    ...(maskBinding === undefined ? {} : { mask_binding: { value: maskBinding, enumerable: true } }),
    references: { value: state.set.references, enumerable: true },
    source_json_mapping: { value: state.normalized.source_json_mapping, enumerable: true }, cost_inputs: { value: state.normalized.cost_inputs, enumerable: true },
    cost_input_confidence: { value: state.normalized.cost_input_confidence, enumerable: true }, expires_at: { value: state.expiresAt, enumerable: true },
    request_fingerprint: { value: requestFingerprint, enumerable: true }, intent_fingerprint: { value: intentFingerprint, enumerable: true },
    request: { value: request, enumerable: false }
  });
  const candidate = Object.freeze(candidateData) as unknown as OwnerIdeogramImagePreparedCandidate;
  candidates.set(candidate, { candidate, assetSet: set, principal, attemptId: state.attemptId, promptIntent: prompt,
    requestFingerprint, intentFingerprint,
    ...(state.maskService === undefined ? {} : { maskService: state.maskService }),
    ...(state.maskHandle === undefined ? {} : { maskHandle: state.maskHandle }),
    ...(currentMask === undefined ? {} : { maskResolution: currentMask }), ...(maskBinding === undefined ? {} : { maskBinding }),
    expiresAt: state.expiresAt, request, normalized: state.normalized, profile: state.profile, catalog: options.catalog,
    catalogVersion: options.catalog_version, now: options.now ?? Date.now, lastNow, expired: false });
  const candidateBucket = candidateSets.get(set as object) ?? new Set<object>();
  candidateBucket.add(candidate as object); candidateSets.set(set as object, candidateBucket);
  return candidate;
}

export function isOwnerIdeogramImagePreparedCandidateForPrincipal(
  value: unknown, principalInput: unknown, attemptId: unknown, nowInput?: number
): value is OwnerIdeogramImagePreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const state = candidates.get(value as object);
  if (!state || state.candidate !== value || revokedCandidates.has(value as object) || revokedAssetSets.has(state.assetSet) ||
      state.attemptId !== attemptId || state.expired) return false;
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotPrincipal(principalInput, attemptId); } catch { return false; }
  if (!sameGenerationPrincipal(state.principal, principal)) return false;
  if (nowInput !== undefined && (!Number.isSafeInteger(nowInput) || nowInput < state.lastNow || nowInput >= state.expiresAt)) return false;
  return true;
}

/** Internal same-module-family accessor for a future one-shot permit; never re-export from src/index.ts. */
export function getOwnerIdeogramImagePreparedCandidateState(value: unknown): OwnerIdeogramImagePreparedCandidateState | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value)
    ? candidates.get(value as object) : undefined;
}

export function observeOwnerIdeogramImageCandidateClock(value: unknown, now: number): boolean {
  const state = getOwnerIdeogramImagePreparedCandidateState(value);
  if (!state || revokedCandidates.has(value as object) || revokedAssetSets.has(state.assetSet) ||
      !Number.isSafeInteger(now) || now < state.lastNow || now >= state.expiresAt) {
    if (state) state.expired = true;
    return false;
  }
  state.lastNow = now;
  return !state.expired;
}

function snapshotUploader(value: unknown): OwnerIdeogramImageUploadService {
  if (!(value instanceof OwnerIdeogramImageUploadService) || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== OwnerIdeogramImageUploadService.prototype) fail("MODEL_BINDING_MISMATCH");
  return value;
}
function snapshotMaskService(value: unknown): OwnerIdeogramImageMaskUploadService {
  if (!(value instanceof OwnerIdeogramImageMaskUploadService) || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== OwnerIdeogramImageMaskUploadService.prototype) fail("MODEL_BINDING_MISMATCH");
  return value;
}
function snapshotOptions(value: unknown): Readonly<OwnerIdeogramImageAssetBindingIssuerOptions> {
  const fields = exact(value, ["catalog", "catalog_version", "now", "maskService"], ["catalog", "catalog_version"]);
  if (!fields.catalog || typeof fields.catalog !== "object" || types.isProxy(fields.catalog) ||
      fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
  const maskService = fields.maskService === undefined ? undefined : snapshotMaskService(fields.maskService);
  return Object.freeze({ catalog: fields.catalog as OwnerIdeogramImageCatalogPort,
    catalog_version: fields.catalog_version as string, ...(fields.now === undefined ? {} : { now: fields.now as () => number }),
    ...(maskService === undefined ? {} : { maskService }) });
}
function snapshotIssueInput(value: unknown): Readonly<OwnerIdeogramImageAssetBindingIssueInput> {
  const fields = exact(value, ["principal", "attempt_id", "model_id", "mode", "reference_handles", "prompt", "parameters", "signal", "mask_handle"],
    ["principal", "attempt_id", "model_id", "mode", "reference_handles", "prompt", "parameters"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) || typeof fields.model_id !== "string" ||
      typeof fields.mode !== "string" || (fields.signal !== undefined &&
        (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal))) ||
      (Object.hasOwn(fields, "mask_handle") && (typeof fields.mask_handle !== "string" || !MASK_HANDLE.test(fields.mask_handle)))) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(fields.principal, fields.attempt_id);
  const handles = snapshotHandles(fields.reference_handles);
  if (handles.length > 5) fail("INVALID_REQUEST");
  if (fields.prompt !== null && (typeof fields.prompt !== "string" || fields.prompt.length > 10_000)) fail("INVALID_REQUEST");
  return Object.freeze({ principal, attempt_id: fields.attempt_id, model_id: fields.model_id as OwnerIdeogramImageModelId,
    mode: fields.mode as OwnerIdeogramImageMode, reference_handles: handles, prompt: fields.prompt as string | null,
    parameters: snapshotPlainRecord(fields.parameters), ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }),
    ...(fields.mask_handle === undefined ? {} : { mask_handle: fields.mask_handle as string }) });
}
function normalizeIntent(input: Readonly<OwnerIdeogramImageAssetBindingIssueInput>, maskPresent: boolean): OwnerIdeogramImageNormalizedParameters {
  try {
    return normalizeOwnerIdeogramImageParameters({ model_id: input.model_id, mode: input.mode,
      reference_count: input.reference_handles.length, mask_present: maskPresent, prompt: input.prompt, parameters: input.parameters });
  } catch { fail("PARAMETERS_INVALID"); }
}
function getProfile(modelId: OwnerIdeogramImageModelId, mode: OwnerIdeogramImageMode, catalog: OwnerIdeogramImageCatalogPort,
  catalogVersion: string): Readonly<OwnerIdeogramImageSourceProfile> {
  try { return getOwnerIdeogramImageSourceProfile(modelId, mode, catalog, catalogVersion); }
  catch { fail("MODEL_BINDING_MISMATCH"); }
}
function snapshotPrincipal(value: unknown, attemptId: unknown): Readonly<GenerationPrincipalRef> {
  if (typeof attemptId !== "string") fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function snapshotHandles(value: unknown): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 5) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== value.length + 1 || !own.includes("length") || own.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!)))) fail("INVALID_REQUEST");
  const handles: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const handle = descriptors[String(index)]!.value;
    if (typeof handle !== "string" || !HANDLE.test(handle) || handles.includes(handle)) fail("INVALID_REQUEST");
    handles.push(handle);
  }
  return Object.freeze(handles);
}
function snapshotPlainRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") fail("INVALID_REQUEST");
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || descriptor.enumerable !== true) fail("INVALID_REQUEST");
    result[key] = snapshotJson(descriptor.value, 0);
  }
  return deepFreeze(result);
}
function snapshotJson(value: unknown, depth: number): unknown {
  if (depth > 12) fail("INVALID_REQUEST");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && !types.isProxy(value) && Object.getPrototypeOf(value) === Array.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const own = Reflect.ownKeys(descriptors);
    if (own.length !== value.length + 1 || !own.includes("length")) fail("INVALID_REQUEST");
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("INVALID_REQUEST");
      result.push(snapshotJson(descriptor.value, depth + 1));
    }
    return Object.freeze(result);
  }
  if (value && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") fail("INVALID_REQUEST");
      const descriptor = descriptors[key]!;
      if (!("value" in descriptor) || descriptor.enumerable !== true) fail("INVALID_REQUEST");
      result[key] = snapshotJson(descriptor.value, depth + 1);
    }
    return deepFreeze(result);
  }
  return fail("INVALID_REQUEST");
}
function exact(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || own.some((key) => typeof key !== "string" || !keys.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) || required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of own as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return fail("INVALID_REQUEST"); }
}
function assertResolution(value: OwnerIdeogramPrivateImageReferenceResolution, expected: {
  principal: Readonly<GenerationPrincipalRef>; attemptId: string; modelId: OwnerIdeogramImageModelId;
  mode: OwnerIdeogramImageMode; profile: Readonly<OwnerIdeogramImageSourceProfile>; now: number;
}): void {
  if (!value || value.role !== "ordinary_image_reference" || value.attempt_id !== expected.attemptId ||
      value.model_id !== expected.modelId || value.mode !== expected.mode || value.catalog_version !== expected.profile.public_catalog_version ||
      value.profile_schema_hash !== expected.profile.profile_schema_hash || value.generation_permit !== false ||
      !sameGenerationPrincipal(value.principal, expected.principal) || !HANDLE.test(value.reference_handle) ||
      !isSafeUploadReferenceUrl(value.file_url) || !expected.profile.input_policy.accepted_file_types.includes(value.source_mime_type) ||
      !expected.profile.input_policy.accepted_file_types.includes(value.mime_type) || !Number.isSafeInteger(value.width) || value.width < 1 ||
      !Number.isSafeInteger(value.height) || value.height < 1 || !Number.isSafeInteger(value.size) || value.size < 1 ||
      !SHA256.test(value.sha256) || !Number.isSafeInteger(value.expires_at) || value.expires_at <= expected.now ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 0 || value.metadata_confidence !== "CONTAINER_METADATA_ONLY") fail("REFERENCE_UNAVAILABLE");
}
function assertMaskResolution(value: OwnerIdeogramPrivateMaskResolution, expected: {
  principal: Readonly<GenerationPrincipalRef>; attemptId: string; baseHandle: string; base: OwnerIdeogramPrivateImageReferenceResolution;
  maskHandle: string; profile: Readonly<OwnerIdeogramImageSourceProfile>; now: number;
}): void {
  if (!value || value.role !== "mask" || value.attempt_id !== expected.attemptId || value.mask_handle !== expected.maskHandle ||
      value.base_reference_handle !== expected.baseHandle || value.model_id !== "ideogram_45" || value.mode !== "precise_edit" ||
      expected.profile.model_id !== "ideogram_45" || expected.profile.mode !== "precise_edit" ||
      value.catalog_version !== expected.profile.public_catalog_version || value.profile_schema_hash !== expected.profile.profile_schema_hash ||
      !sameGenerationPrincipal(value.principal, expected.principal) || value.base_sha256 !== expected.base.sha256 ||
      value.base_width !== expected.base.width || value.base_height !== expected.base.height || value.width !== expected.base.width ||
      value.height !== expected.base.height || !SHA256.test(value.base_sha256) || !SHA256.test(value.pair_sha256) ||
      !SHA256.test(value.normal_sha256) || !SHA256.test(value.inverse_sha256) || value.normal_sha256 === value.inverse_sha256 ||
      !isSafeUploadReferenceUrl(value.normal_url) || !isSafeUploadReferenceUrl(value.inverse_url) || value.normal_url === value.inverse_url ||
      value.primary_url !== value.normal_url || value.geometry_verified !== false || value.generation_permit !== false ||
      value.metadata_confidence !== "CONTAINER_METADATA_ONLY" || !Number.isSafeInteger(value.expires_at) || value.expires_at <= expected.now ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 0 || value.base_epoch !== expected.base.epoch) fail("REFERENCE_UNAVAILABLE");
}
function snapshotMaskBinding(value: OwnerIdeogramPrivateMaskResolution): OwnerIdeogramImageMaskBinding {
  return Object.freeze({ role: "mask", mask_handle: value.mask_handle, base_reference_handle: value.base_reference_handle,
    base_sha256: value.base_sha256, pair_sha256: value.pair_sha256, normal_sha256: value.normal_sha256,
    inverse_sha256: value.inverse_sha256, width: value.width, height: value.height, expires_at: value.expires_at,
    geometry_verified: false, epoch: value.epoch, base_epoch: value.base_epoch,
    confidence_scope: "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE" });
}
function sameResolvedMask(a: OwnerIdeogramPrivateMaskResolution, b: OwnerIdeogramPrivateMaskResolution): boolean {
  return a.role === b.role && a.attempt_id === b.attempt_id && sameGenerationPrincipal(a.principal, b.principal) &&
    a.model_id === b.model_id && a.mode === b.mode && a.catalog_version === b.catalog_version &&
    a.profile_schema_hash === b.profile_schema_hash && a.mask_handle === b.mask_handle &&
    a.base_reference_handle === b.base_reference_handle && a.base_sha256 === b.base_sha256 &&
    a.base_width === b.base_width && a.base_height === b.base_height && a.width === b.width && a.height === b.height &&
    a.pair_sha256 === b.pair_sha256 && a.normal_sha256 === b.normal_sha256 && a.inverse_sha256 === b.inverse_sha256 &&
    a.normal_url === b.normal_url && a.inverse_url === b.inverse_url && a.primary_url === b.primary_url &&
    a.expires_at === b.expires_at && a.epoch === b.epoch && a.base_epoch === b.base_epoch &&
    a.metadata_confidence === b.metadata_confidence && a.geometry_verified === b.geometry_verified &&
    a.generation_permit === b.generation_permit;
}
function beginOperation(attemptId: string, parentSignal: AbortSignal | undefined, epoch: number,
  pendingByAttempt: Map<string, Set<PendingOperation>>, allOperations: Set<Promise<void>>): PendingOperation {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const operation = { controller, done, finish, removeParentAbort: () => parentSignal?.removeEventListener("abort", onAbort), epoch };
  const bucket = pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>(); bucket.add(operation); pendingByAttempt.set(attemptId, bucket);
  allOperations.add(done);
  return operation;
}
function finishOperation(attemptId: string, operation: PendingOperation, pendingByAttempt: Map<string, Set<PendingOperation>>,
  allOperations: Set<Promise<void>>): void {
  operation.removeParentAbort();
  const bucket = pendingByAttempt.get(attemptId); bucket?.delete(operation); if (bucket?.size === 0) pendingByAttempt.delete(attemptId);
  allOperations.delete(operation.done); operation.finish();
}
function throwIfUnavailable(closed: boolean, signal: AbortSignal): void {
  if (closed) fail("SERVICE_CLOSED");
  if (signal.aborted) fail("REQUEST_ABORTED");
}
function readClock(clock: (() => number) | undefined, prior?: number): number {
  let now: number;
  try { now = (clock ?? Date.now)(); } catch { fail("CLOCK_INVALID"); }
  if (!Number.isSafeInteger(now) || now < 0 || (prior !== undefined && now < prior)) fail("CLOCK_INVALID");
  return now;
}
function activeSetCount(active: Map<string, Set<object>>): number { let total = 0; for (const bucket of active.values()) total += bucket.size; return total; }
function pruneActiveSets(active: Map<string, Set<object>>, revoked: WeakSet<object>, now: number): void {
  for (const [attemptId, bucket] of active) {
    for (const set of bucket) {
      const state = assetSets.get(set);
      if (!state || state.expiresAt <= now) { revoked.add(set); revokeCandidatesForAssetSet(set); bucket.delete(set); }
    }
    if (bucket.size === 0) active.delete(attemptId);
  }
}
function getOwnerIdeogramImageAssetSetState(value: unknown): AssetSetState | undefined {
  return value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value)
    ? assetSets.get(value as object) : undefined;
}
function observeAssetSetClock(value: OwnerIdeogramImageAssetSet, now: number): boolean {
  const state = getOwnerIdeogramImageAssetSetState(value);
  if (!state || revokedAssetSets.has(value as object) || !Number.isSafeInteger(now) || now < state.lastNow || now >= state.expiresAt) {
    if (state) state.expired = true;
    return false;
  }
  state.lastNow = now;
  return !state.expired;
}
function revokeCandidatesForAssetSet(set: object): void {
  // Candidates are kept in a weak index by their source set; no URLs are retained here.
  const bucket = candidateSets.get(set);
  if (bucket) for (const candidate of bucket) revokedCandidates.add(candidate);
  candidateSets.delete(set);
}
const candidateSets = new WeakMap<object, Set<object>>();
function privateReferenceDigest(reference: OwnerIdeogramPrivateImageReferenceResolution): Readonly<Record<string, unknown>> {
  return Object.freeze({ reference_handle: reference.reference_handle, file_url: reference.file_url, file_id: reference.file_id,
    sha256: reference.sha256, mime_type: reference.mime_type, size: reference.size, width: reference.width, height: reference.height });
}
function sameResolvedReference(a: OwnerIdeogramPrivateImageReferenceResolution, b: OwnerIdeogramPrivateImageReferenceResolution): boolean {
  return a.role === b.role && a.attempt_id === b.attempt_id && a.model_id === b.model_id && a.mode === b.mode &&
    sameGenerationPrincipal(a.principal, b.principal) && a.catalog_version === b.catalog_version &&
    a.profile_schema_hash === b.profile_schema_hash && a.reference_handle === b.reference_handle &&
    a.file_url === b.file_url && a.file_id === b.file_id && a.source_mime_type === b.source_mime_type &&
    a.mime_type === b.mime_type && a.width === b.width && a.height === b.height && a.size === b.size &&
    a.sha256 === b.sha256 && a.expires_at === b.expires_at && a.epoch === b.epoch &&
    a.metadata_confidence === b.metadata_confidence && a.generation_permit === b.generation_permit;
}
function sameJson(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function fail(code: OwnerIdeogramImageRequestPreparerErrorCode): never { throw new OwnerIdeogramImageRequestPreparerError(code); }
