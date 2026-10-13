import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerWanImageSourceProfile,
  type OwnerWanImageCatalogPort,
  type OwnerWanImageSourceProfile
} from "./owner-wan-image-source-profile.js";
import {
  normalizeOwnerWanImageParameters,
  OwnerWanImageParametersError,
  type OwnerWanImageNormalizedParameters,
  type OwnerWanImageRectangle,
  type OwnerWanImageVariant
} from "./owner-wan-image-parameters.js";
import {
  normalizeOwnerWanImagePrompt,
  OwnerWanImagePromptError
} from "./owner-wan-image-prompt.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const HANDLE_PATTERN = /^wan_image_[0-9a-f-]{36}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_STATES = 128;
const MAX_STATES_PER_ATTEMPT = 128;
const BBOX_COORDINATE_POLICY = "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" as const;
const HEADER_PROJECTION = "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE" as const;
const UNSUPPORTED_PROJECTION = "UNSUPPORTED_OR_MALFORMED_METADATA" as const;
const VARIANTS = Object.freeze([
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
] as const);

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type OwnerWanImageCoordinateMetadataConfidence = typeof HEADER_PROJECTION | typeof UNSUPPORTED_PROJECTION;
export type OwnerWanImageBboxCoordinatePolicy = typeof BBOX_COORDINATE_POLICY;
export type OwnerWanImageMimeType = "image/png" | "image/jpeg" | "image/bmp" | "image/webp";

export interface OwnerWanImageOwnedReferenceResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerWanImageVariant;
  readonly model_id: OwnerWanImageVariant;
  readonly ai_name: "wan_image";
  readonly scope: "image";
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
}

export interface OwnerWanImageCoordinateMetadata {
  readonly orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null;
  readonly projected_width: number | null;
  readonly projected_height: number | null;
  readonly confidence: OwnerWanImageCoordinateMetadataConfidence;
}

export interface OwnerWanImageOwnedReferenceResolution extends OwnerWanImageOwnedReferenceResolverContext {
  readonly file_url: string;
  readonly mime_type: OwnerWanImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly coordinate_source_sha256: string;
  readonly coordinate_metadata: OwnerWanImageCoordinateMetadata;
}

export type ResolveOwnerWanImageOwnedReference = (
  context: Readonly<OwnerWanImageOwnedReferenceResolverContext>
) => Promise<unknown>;

export interface OwnerWanImageReferenceBindingIssuerOptions {
  readonly catalog: OwnerWanImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerWanImageReferenceBindingIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerWanImageVariant;
  readonly reference_handles: readonly string[];
}

export interface OwnerWanImageOwnedReferenceSet {
  readonly variant: OwnerWanImageVariant;
  readonly reference_count: number;
  readonly expires_at: number;
}

export interface OwnerWanImageReferenceBindingIssuer {
  issue(input: OwnerWanImageReferenceBindingIssueInput | unknown): Promise<OwnerWanImageOwnedReferenceSet>;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}

export interface OwnerWanImagePreparedCandidate {
  readonly status: "blocked";
  readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: OwnerWanImageSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerWanImageSourceProfile["source_binding"];
  readonly model_id: OwnerWanImageVariant;
  readonly ai_name: "wan_image";
  readonly variant: OwnerWanImageVariant;
  readonly model_type: OwnerWanImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly public_catalog_version: typeof CATALOG_VERSION;
  readonly prompt: string;
  readonly prompt_source_limit_confidence: "SOURCE_UI_BEHAVIOR_NOT_BACKEND_LIMIT";
  readonly reference_count: number;
  readonly input_images: readonly OwnerWanImageInputImageMetadata[];
  readonly bbox_coordinate_policy: OwnerWanImageBboxCoordinatePolicy | null;
  readonly cost_inputs: Readonly<{ batch_size: number }>;
  readonly cost_input_confidence: "SOURCE_JOINED_BATCH_SIZE_ONLY";
  readonly expires_at: number;
  readonly request_fingerprint: string;
}

export interface OwnerWanImageInputImageMetadata {
  readonly reference_handle: string;
  readonly mime_type: OwnerWanImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly coordinate_source_sha256: string;
  readonly coordinate_metadata: OwnerWanImageCoordinateMetadata;
}

export interface PrepareOwnerWanImageRequestInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerWanImageVariant;
  readonly parameters: unknown;
  readonly reference_set: OwnerWanImageOwnedReferenceSet;
  readonly prompt: string;
  readonly bbox_coordinate_policy: OwnerWanImageBboxCoordinatePolicy | null;
}

export interface PrepareOwnerWanImageRequestOptions {
  readonly catalog: OwnerWanImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

interface IssuedReference {
  readonly reference_handle: string;
  readonly file_url: string;
  readonly mime_type: OwnerWanImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly coordinate_source_sha256: string;
  readonly coordinate_metadata: OwnerWanImageCoordinateMetadata;
}

interface ReferenceSetState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerWanImageVariant;
  readonly profile: Readonly<OwnerWanImageSourceProfile>;
  readonly references: readonly IssuedReference[];
  readonly expires_at: number;
}

interface PreparedState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerWanImageVariant;
  readonly expires_at: number;
  readonly reference_set: object;
}

const issuedSets = new WeakMap<object, Readonly<ReferenceSetState>>();
const revokedSets = new WeakSet<object>();
const preparedCandidates = new WeakMap<object, Readonly<PreparedState>>();

export class OwnerWanImagePrepareError extends Error {
  constructor(readonly code: OwnerWanImagePrepareErrorCode) {
    super("The owner WAN image candidate could not be prepared safely.");
    this.name = "OwnerWanImagePrepareError";
  }
}

export type OwnerWanImagePrepareErrorCode =
  | "INVALID_REQUEST"
  | "PROFILE_BINDING_MISMATCH"
  | "PRINCIPAL_MISMATCH"
  | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED"
  | "PARAMETERS_INVALID"
  | "PROMPT_INVALID"
  | "BBOX_GEOMETRY_UNAVAILABLE";

/** Issues ordered, private reference sets from exact owner-resolved handles; close and revoke invalidate pending work. */
export function createOwnerWanImageOwnedReferenceBindingIssuer(
  resolveOwnedReference: ResolveOwnerWanImageOwnedReference,
  optionsInput: OwnerWanImageReferenceBindingIssuerOptions | unknown
): OwnerWanImageReferenceBindingIssuer {
  if (typeof resolveOwnedReference !== "function" || isProxy(resolveOwnedReference)) fail("INVALID_REQUEST");
  const options = snapshotOptions(optionsInput);
  let closed = false;
  let pending = 0;
  const epochs = new Map<string, number>();
  const pendingByAttempt = new Map<string, number>();
  const pendingPrincipals = new Map<string, Readonly<GenerationPrincipalRef>>();
  const setsByAttempt = new Map<string, Set<object>>();
  const handleFingerprints = new Map<string, Readonly<{ fingerprint: string; expires_at: number }>>();
  const emptyCache = new Map<string, object>();

  const prune = (now: number): void => {
    for (const [attempt, sets] of setsByAttempt) {
      for (const set of sets) {
        const state = issuedSets.get(set);
        if (!state || state.expires_at <= now) {
          revokedSets.add(set);
          sets.delete(set);
        }
      }
      if (sets.size === 0) setsByAttempt.delete(attempt);
    }
    for (const [key, set] of emptyCache) {
      const state = issuedSets.get(set);
      if (!state || state.expires_at <= now || revokedSets.has(set)) emptyCache.delete(key);
    }
    for (const [key, item] of handleFingerprints) if (item.expires_at <= now) handleFingerprints.delete(key);
    for (const attempt of epochs.keys()) if (!pendingByAttempt.has(attempt)) epochs.delete(attempt);
  };

  const invalidateAttempt = (attemptId: string): void => {
    if (typeof attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId)) return;
    if ((pendingByAttempt.get(attemptId) ?? 0) > 0) epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
    else epochs.delete(attemptId);
    for (const set of setsByAttempt.get(attemptId) ?? []) revokedSets.add(set);
    setsByAttempt.delete(attemptId);
    for (const [key, set] of emptyCache) if (issuedSets.get(set)?.attempt_id === attemptId) emptyCache.delete(key);
    for (const key of handleFingerprints.keys()) {
      try { if (JSON.parse(key)[0] === attemptId) handleFingerprints.delete(key); } catch { handleFingerprints.delete(key); }
    }
  };

  return Object.freeze({
    async issue(input: OwnerWanImageReferenceBindingIssueInput | unknown): Promise<OwnerWanImageOwnedReferenceSet> {
      if (closed || pending >= MAX_PENDING) fail("REFERENCE_UNAVAILABLE");
      const request = snapshotIssueInput(input);
      const principal = snapshotPrincipal(request.principal);
      if (!isAttempt(request.attempt_id) || principal.connection_id !== request.attempt_id || !isVariant(request.variant)) fail("INVALID_REQUEST");
      let now = safeNow(options.now);
      prune(now);
      const pendingPrincipal = pendingPrincipals.get(request.attempt_id);
      if (pendingPrincipal && !sameGenerationPrincipal(pendingPrincipal, principal)) fail("PRINCIPAL_MISMATCH");
      for (const set of setsByAttempt.get(request.attempt_id) ?? []) {
        const prior = issuedSets.get(set);
        if (prior && !sameGenerationPrincipal(prior.principal, principal)) fail("PRINCIPAL_MISMATCH");
      }
      const profile = getProfile(request.variant, options);
      const counts = profile.reference_count;
      if (request.reference_handles.length < counts.minimum || request.reference_handles.length > counts.maximum) fail("INVALID_REQUEST");
      if (request.reference_handles.some((handle) => !HANDLE_PATTERN.test(handle)) ||
          new Set(request.reference_handles).size !== request.reference_handles.length) fail("INVALID_REQUEST");
      const emptyKey = request.reference_handles.length === 0
        ? schemaHash({ principal, attempt_id: request.attempt_id, variant: request.variant, profile_schema_hash: profile.profile_schema_hash })
        : null;
      if (emptyKey) {
        const cached = emptyCache.get(emptyKey);
        if (cached && !revokedSets.has(cached)) return cached as OwnerWanImageOwnedReferenceSet;
      }
      const current = setsByAttempt.get(request.attempt_id)?.size ?? 0;
      const total = [...setsByAttempt.values()].reduce((count, sets) => count + sets.size, 0);
      if (current + (pendingByAttempt.get(request.attempt_id) ?? 0) >= MAX_STATES_PER_ATTEMPT || total + pending >= MAX_STATES) {
        fail("REFERENCE_UNAVAILABLE");
      }
      if (now > Number.MAX_SAFE_INTEGER - TTL_MS) fail("REFERENCE_UNAVAILABLE");
      const epoch = epochs.get(request.attempt_id) ?? 0;
      pending += 1;
      pendingByAttempt.set(request.attempt_id, (pendingByAttempt.get(request.attempt_id) ?? 0) + 1);
      pendingPrincipals.set(request.attempt_id, principal);
      try {
        const references: IssuedReference[] = [];
        const seenUrls = new Set<string>();
        for (const handle of request.reference_handles) {
          const context: OwnerWanImageOwnedReferenceResolverContext = Object.freeze({
            principal, attempt_id: request.attempt_id, variant: request.variant, model_id: profile.model_id,
            ai_name: "wan_image", scope: "image", catalog_version: profile.public_catalog_version,
            profile_schema_hash: profile.profile_schema_hash, reference_handle: handle
          });
          let raw: unknown;
          try { raw = await resolveOwnedReference(context); } catch { fail("REFERENCE_UNAVAILABLE"); }
          if (closed || (epochs.get(request.attempt_id) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
          const reference = snapshotResolution(raw);
          validateResolution(reference, context, now, profile);
          if (seenUrls.has(reference.file_url)) fail("REFERENCE_UNAVAILABLE");
          seenUrls.add(reference.file_url);
          const key = JSON.stringify([request.attempt_id, handle]);
          const fingerprint = referenceFingerprint(reference);
          const prior = handleFingerprints.get(key);
          if (prior && prior.expires_at > now && prior.fingerprint !== fingerprint) fail("REFERENCE_UNAVAILABLE");
          references.push(reference);
        }
        if (closed || (epochs.get(request.attempt_id) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
        now = safeNow(options.now);
        const expiresAt = references.length === 0 ? now + TTL_MS : Math.min(...references.map((item) => item.expires_at));
        if (expiresAt <= now) fail("REFERENCE_EXPIRED");
        const currentProfile = getProfile(request.variant, options);
        if (currentProfile.profile_schema_hash !== profile.profile_schema_hash) fail("PROFILE_BINDING_MISMATCH");
        for (const reference of references) {
          handleFingerprints.set(JSON.stringify([request.attempt_id, reference.reference_handle]), Object.freeze({
            fingerprint: referenceFingerprint(reference), expires_at: reference.expires_at
          }));
        }
        const set = Object.create(null) as OwnerWanImageOwnedReferenceSet;
        Object.defineProperties(set, {
          variant: { value: request.variant }, reference_count: { value: references.length }, expires_at: { value: expiresAt }
        });
        Object.freeze(set);
        issuedSets.set(set as object, Object.freeze({ principal, attempt_id: request.attempt_id, variant: request.variant,
          profile, references: Object.freeze(references), expires_at: expiresAt }));
        const attemptSets = setsByAttempt.get(request.attempt_id) ?? new Set<object>();
        attemptSets.add(set as object);
        setsByAttempt.set(request.attempt_id, attemptSets);
        if (emptyKey) emptyCache.set(emptyKey, set as object);
        return set;
      } finally {
        pending -= 1;
        const attemptPending = pendingByAttempt.get(request.attempt_id) ?? 0;
        if (attemptPending <= 1) {
          pendingByAttempt.delete(request.attempt_id);
          pendingPrincipals.delete(request.attempt_id);
          epochs.delete(request.attempt_id);
        } else pendingByAttempt.set(request.attempt_id, attemptPending - 1);
      }
    },
    invalidateAttempt,
    close(): void {
      if (closed) return;
      closed = true;
      for (const sets of setsByAttempt.values()) for (const set of sets) revokedSets.add(set);
      setsByAttempt.clear(); emptyCache.clear(); handleFingerprints.clear(); epochs.clear();
      pendingByAttempt.clear(); pendingPrincipals.clear();
    }
  });
}

/** Builds an immutable full-state WAN request candidate; the internal ten-key wire DTO is non-enumerable. */
export function prepareOwnerWanImageRequest(
  input: PrepareOwnerWanImageRequestInput | unknown,
  optionsInput: PrepareOwnerWanImageRequestOptions | unknown
): OwnerWanImagePreparedCandidate & { readonly request: OwnerWanImagePrivateRequest } {
  const request = snapshotPrepareInput(input);
  const options = snapshotOptions(optionsInput);
  const principal = snapshotPrincipal(request.principal);
  if (!isAttempt(request.attempt_id) || principal.connection_id !== request.attempt_id || !isVariant(request.variant)) fail("INVALID_REQUEST");
  const profile = getProfile(request.variant, options);
  const set = request.reference_set;
  if (!set || typeof set !== "object" || Array.isArray(set) || isProxy(set) || !Object.isFrozen(set)) fail("REFERENCE_UNAVAILABLE");
  const state = issuedSets.get(set as object);
  if (!state || revokedSets.has(set as object) || state.attempt_id !== request.attempt_id || state.variant !== request.variant ||
      state.profile.profile_schema_hash !== profile.profile_schema_hash || !sameGenerationPrincipal(state.principal, principal)) {
    fail("REFERENCE_UNAVAILABLE");
  }
  const now = safeNow(options.now);
  if (state.expires_at <= now || state.references.some((reference) => reference.expires_at <= now)) fail("REFERENCE_EXPIRED");
  let normalized: OwnerWanImageNormalizedParameters;
  try { normalized = normalizeOwnerWanImageParameters({ variant: request.variant, reference_count: state.references.length, parameters: request.parameters }); }
  catch (error) { if (error instanceof OwnerWanImageParametersError) fail("PARAMETERS_INVALID"); fail("PARAMETERS_INVALID"); }
  let prompt: string;
  try { prompt = normalizeOwnerWanImagePrompt({ variant: request.variant, prompt: request.prompt }).prompt; }
  catch (error) { if (error instanceof OwnerWanImagePromptError) fail("PROMPT_INVALID"); fail("PROMPT_INVALID"); }

  const anyBbox = normalized.parameters.bbox_list.some((rectangles) => rectangles.length > 0);
  if ((anyBbox && request.bbox_coordinate_policy !== BBOX_COORDINATE_POLICY) ||
      (!anyBbox && request.bbox_coordinate_policy !== null)) fail("INVALID_REQUEST");
  if (anyBbox) {
    for (let index = 0; index < state.references.length; index += 1) {
      const rectangles = normalized.parameters.bbox_list[index]!;
      if (rectangles.length === 0) continue;
      const metadata = state.references[index]!.coordinate_metadata;
      if (metadata.confidence !== HEADER_PROJECTION || metadata.orientation === null ||
          metadata.projected_width === null || metadata.projected_height === null) fail("BBOX_GEOMETRY_UNAVAILABLE");
      for (const rectangle of rectangles) if (!insideProjectedBounds(rectangle, metadata.projected_width, metadata.projected_height)) {
        fail("BBOX_GEOMETRY_UNAVAILABLE");
      }
    }
  }

  const fileUrls = Object.freeze(state.references.map((reference) => Object.freeze({ type: "image" as const, url: reference.file_url })));
  const settings = deepFreeze({ n: 1 as const, model_type: profile.model_type, ...normalized.parameters, file_urls: fileUrls });
  const body = deepFreeze({ prompt, settings });
  const candidateData = {
    status: "blocked" as const,
    source_readiness: "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    source_binding: profile.source_binding,
    model_id: profile.model_id,
    ai_name: profile.ai_name,
    variant: profile.variant,
    model_type: profile.model_type,
    scope: profile.scope,
    operation_id: profile.operation_id,
    public_catalog_version: profile.public_catalog_version,
    prompt,
    prompt_source_limit_confidence: profile.prompt_policy.limit_confidence,
    reference_count: state.references.length,
    input_images: state.references.map(({ reference_handle, mime_type, width, height, size, sha256, metadata_confidence,
      coordinate_source_sha256, coordinate_metadata }) => ({ reference_handle, mime_type, width, height, size, sha256,
      metadata_confidence, coordinate_source_sha256, coordinate_metadata })),
    bbox_coordinate_policy: request.bbox_coordinate_policy,
    cost_inputs: normalized.cost_inputs,
    cost_input_confidence: "SOURCE_JOINED_BATCH_SIZE_ONLY" as const,
    expires_at: state.expires_at,
    request_fingerprint: schemaHash({ profile_schema_hash: profile.profile_schema_hash, principal,
      attempt_id: request.attempt_id, variant: request.variant, prompt, request: body,
      references: state.references.map(({ reference_handle, file_url, mime_type, width, height, size, sha256,
        expires_at, coordinate_source_sha256, coordinate_metadata }) => ({ reference_handle, file_url, mime_type, width,
        height, size, sha256, expires_at, coordinate_source_sha256, coordinate_metadata })) })
  };
  Object.defineProperty(candidateData, "request", { value: body, enumerable: false, writable: false, configurable: false });
  const candidate = deepFreeze(candidateData) as unknown as OwnerWanImagePreparedCandidate & { readonly request: OwnerWanImagePrivateRequest };
  preparedCandidates.set(candidate as object, Object.freeze({ principal, attempt_id: request.attempt_id,
    variant: request.variant, expires_at: state.expires_at, reference_set: set as object }));
  return candidate;
}

export interface OwnerWanImagePrivateRequest {
  readonly prompt: string;
  readonly settings: Readonly<{
    n: 1;
    model_type: OwnerWanImageVariant;
    aspect_ratio: string;
    resolution: string;
    batch_size: number;
    prompt_extend: boolean;
    seed: number | null;
    color_palette: OwnerWanImageNormalizedParameters["parameters"]["color_palette"];
    bbox_list: readonly (readonly OwnerWanImageRectangle[])[];
    file_urls: readonly Readonly<{ type: "image"; url: string }>[];
  }>;
}

export function isOwnerWanImagePreparedCandidateForPrincipal(
  candidateInput: unknown, principalInput: unknown, attemptIdInput: unknown, nowInput: unknown = Date.now()
): candidateInput is OwnerWanImagePreparedCandidate {
  if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || isProxy(candidateInput) ||
      !Object.isFrozen(candidateInput) || typeof attemptIdInput !== "string" || !Number.isSafeInteger(nowInput) ||
      (nowInput as number) < 0) return false;
  const state = preparedCandidates.get(candidateInput);
  if (!state || state.attempt_id !== attemptIdInput || state.expires_at <= (nowInput as number) || revokedSets.has(state.reference_set)) return false;
  try { return sameGenerationPrincipal(state.principal, snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef)); }
  catch { return false; }
}

function snapshotIssueInput(input: unknown): OwnerWanImageReferenceBindingIssueInput {
  const fields = exactRecord(input, ["principal", "attempt_id", "variant", "reference_handles"]);
  const handles = denseArray(fields.reference_handles);
  if (handles.some((item) => typeof item !== "string")) fail("INVALID_REQUEST");
  return Object.freeze({ principal: snapshotPrincipal(fields.principal), attempt_id: fields.attempt_id as string,
    variant: fields.variant as OwnerWanImageVariant, reference_handles: Object.freeze(handles as string[]) });
}

function snapshotPrepareInput(input: unknown): PrepareOwnerWanImageRequestInput {
  const fields = exactRecord(input, ["principal", "attempt_id", "variant", "parameters", "reference_set", "prompt", "bbox_coordinate_policy"]);
  return Object.freeze({ principal: snapshotPrincipal(fields.principal), attempt_id: fields.attempt_id as string,
    variant: fields.variant as OwnerWanImageVariant, parameters: fields.parameters,
    reference_set: fields.reference_set as OwnerWanImageOwnedReferenceSet, prompt: fields.prompt as string,
    bbox_coordinate_policy: fields.bbox_coordinate_policy as OwnerWanImageBboxCoordinatePolicy | null });
}

function snapshotResolution(input: unknown): IssuedReference & OwnerWanImageOwnedReferenceResolverContext {
  const fields = exactRecord(input, ["principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "catalog_version",
    "profile_schema_hash", "reference_handle", "file_url", "mime_type", "width", "height", "size", "sha256", "expires_at",
    "metadata_confidence", "coordinate_source_sha256", "coordinate_metadata"]);
  const coordinate = exactRecord(fields.coordinate_metadata, ["orientation", "projected_width", "projected_height", "confidence"]);
  const metadata: OwnerWanImageCoordinateMetadata = Object.freeze({
    orientation: coordinate.orientation as OwnerWanImageCoordinateMetadata["orientation"],
    projected_width: coordinate.projected_width as number | null,
    projected_height: coordinate.projected_height as number | null,
    confidence: coordinate.confidence as OwnerWanImageCoordinateMetadataConfidence
  });
  return Object.freeze({ principal: snapshotPrincipal(fields.principal), attempt_id: fields.attempt_id as string,
    variant: fields.variant as OwnerWanImageVariant, model_id: fields.model_id as OwnerWanImageVariant,
    ai_name: fields.ai_name as "wan_image", scope: fields.scope as "image", catalog_version: fields.catalog_version as typeof CATALOG_VERSION,
    profile_schema_hash: fields.profile_schema_hash as string, reference_handle: fields.reference_handle as string,
    file_url: fields.file_url as string, mime_type: fields.mime_type as OwnerWanImageMimeType, width: fields.width as number,
    height: fields.height as number, size: fields.size as number, sha256: fields.sha256 as string, expires_at: fields.expires_at as number,
    metadata_confidence: fields.metadata_confidence as "CONTAINER_METADATA_ONLY", coordinate_source_sha256: fields.coordinate_source_sha256 as string,
    coordinate_metadata: metadata });
}

function validateResolution(reference: IssuedReference & OwnerWanImageOwnedReferenceResolverContext,
  expected: OwnerWanImageOwnedReferenceResolverContext, now: number, profile: Readonly<OwnerWanImageSourceProfile>): void {
  if (!sameGenerationPrincipal(reference.principal, expected.principal) || reference.attempt_id !== expected.attempt_id ||
      reference.variant !== expected.variant || reference.model_id !== expected.model_id || reference.ai_name !== expected.ai_name ||
      reference.scope !== expected.scope || reference.catalog_version !== expected.catalog_version ||
      reference.profile_schema_hash !== expected.profile_schema_hash || reference.reference_handle !== expected.reference_handle ||
      !HANDLE_PATTERN.test(reference.reference_handle) || !isSafeUploadReferenceUrl(reference.file_url) ||
      !(["image/png", "image/jpeg", "image/bmp", "image/webp"] as const).includes(reference.mime_type) ||
      !isSafeDimension(reference.width) || !isSafeDimension(reference.height) || !Number.isSafeInteger(reference.size) || reference.size <= 0 ||
      reference.size > profile.input_policy.maximum_bytes || reference.width < profile.input_policy.minimum_dimension ||
      reference.height < profile.input_policy.minimum_dimension || reference.width > profile.input_policy.maximum_dimension ||
      reference.height > profile.input_policy.maximum_dimension ||
      !SHA256_PATTERN.test(reference.sha256) || reference.coordinate_source_sha256 !== reference.sha256 ||
      !Number.isSafeInteger(reference.expires_at) || reference.expires_at <= now || reference.expires_at > now + TTL_MS ||
      reference.metadata_confidence !== "CONTAINER_METADATA_ONLY") fail("REFERENCE_UNAVAILABLE");
  const metadata = reference.coordinate_metadata;
  if (metadata.confidence === HEADER_PROJECTION) {
    if (!isOrientation(metadata.orientation) || !isDimension(metadata.projected_width) || !isDimension(metadata.projected_height)) fail("REFERENCE_UNAVAILABLE");
    const swap = metadata.orientation >= 5;
    if (metadata.projected_width !== (swap ? reference.height : reference.width) ||
        metadata.projected_height !== (swap ? reference.width : reference.height)) fail("REFERENCE_UNAVAILABLE");
  } else if (metadata.confidence !== UNSUPPORTED_PROJECTION || metadata.orientation !== null ||
      metadata.projected_width !== null || metadata.projected_height !== null) fail("REFERENCE_UNAVAILABLE");
}

function referenceFingerprint(reference: IssuedReference): string {
  return schemaHash({ reference_handle: reference.reference_handle, file_url: reference.file_url, mime_type: reference.mime_type,
    width: reference.width, height: reference.height, size: reference.size, sha256: reference.sha256,
    expires_at: reference.expires_at, metadata_confidence: reference.metadata_confidence,
    coordinate_source_sha256: reference.coordinate_source_sha256, coordinate_metadata: reference.coordinate_metadata });
}

function snapshotOptions(input: unknown): Readonly<PrepareOwnerWanImageRequestOptions> {
  const fields = exactRecord(input, ["catalog", "catalog_version"], ["now"]);
  if (fields.catalog_version !== CATALOG_VERSION || (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now)))) {
    fail("PROFILE_BINDING_MISMATCH");
  }
  return Object.freeze({ catalog: fields.catalog as OwnerWanImageCatalogPort, catalog_version: fields.catalog_version as string,
    ...(fields.now === undefined ? {} : { now: fields.now as () => number }) });
}

function getProfile(variant: OwnerWanImageVariant, options: Readonly<PrepareOwnerWanImageRequestOptions>): Readonly<OwnerWanImageSourceProfile> {
  try { return getOwnerWanImageSourceProfile(variant, options.catalog, options.catalog_version); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "PROFILE_BINDING_MISMATCH") fail("PROFILE_BINDING_MISMATCH");
    fail("INVALID_REQUEST");
  }
}

function insideProjectedBounds(rectangle: OwnerWanImageRectangle, width: number, height: number): boolean {
  return rectangle[0] <= width && rectangle[2] <= width && rectangle[1] <= height && rectangle[3] <= height;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!plainRecord(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || actual.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) copy[key] = descriptors[key]!.value;
  return copy;
}

function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  if (value.length > 9) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expected = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))];
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== expected.length || actual.some((key) => typeof key !== "string" || !expected.includes(key))) fail("INVALID_REQUEST");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("INVALID_REQUEST");
    result.push(descriptor.value);
  }
  return result;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotPrincipal(value: unknown): Readonly<GenerationPrincipalRef> {
  try { return snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
}

function safeNow(clock?: () => number): number {
  const now = clock ? clock() : Date.now();
  if (!Number.isSafeInteger(now) || now < 0) fail("REFERENCE_UNAVAILABLE");
  return now;
}

function isAttempt(value: unknown): value is string { return typeof value === "string" && /^link_[A-Za-z0-9_-]{20,120}$/u.test(value); }
function isVariant(value: unknown): value is OwnerWanImageVariant { return typeof value === "string" && VARIANTS.includes(value as OwnerWanImageVariant); }
function isOrientation(value: unknown): value is 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 8;
}
function isSafeDimension(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 8_000; }
function isDimension(value: unknown): value is number { return isSafeDimension(value); }

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function fail(code: OwnerWanImagePrepareErrorCode): never { throw new OwnerWanImagePrepareError(code); }
