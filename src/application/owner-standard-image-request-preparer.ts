import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  OWNER_BANANA_IMAGE_VARIANTS,
  normalizeOwnerBananaImageParameters,
  OwnerBananaImageParametersError,
  type OwnerBananaImageNormalizedParameters,
  type OwnerBananaImageVariant
} from "./owner-banana-image-parameters.js";
import {
  getOwnerBananaImageSourceProfile,
  type OwnerBananaImageCatalogPort,
  type OwnerBananaImageSourceProfile
} from "./owner-banana-image-source-profile.js";
import {
  normalizeOwnerGptImageParameters,
  OwnerGptImageParametersError,
  type OwnerGptImageNormalizedParameters,
  type OwnerGptImageVariant
} from "./owner-gpt-image-parameters.js";
import {
  getOwnerGptImageSourceProfile,
  type OwnerGptImageCatalogPort,
  type OwnerGptImageSourceProfile
} from "./owner-gpt-image-source-profile.js";

export const OWNER_STANDARD_IMAGE_VARIANTS = Object.freeze([
  ...OWNER_BANANA_IMAGE_VARIANTS,
  "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"
] as const);
export type OwnerStandardImageVariant = typeof OWNER_STANDARD_IMAGE_VARIANTS[number];
export type OwnerStandardImageReferenceMediaKind = "image" | "video" | "file";
export type OwnerStandardImageMimeType = string;

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const HANDLE_PATTERN = /^standard_image_[0-9a-f-]{36}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PROMPT_MAX_UTF8_BYTES = 65_536;
const PROMPT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const EMPTY_REFERENCE_TTL_MS = 15 * 60_000;
const MAX_PENDING_RESOLVES = 4;
const MAX_REFERENCE_SETS = 128;
const MAX_SETS_PER_ATTEMPT = 128;
const BANANA_21_TOTAL_BYTES = 78_643_200;
const BANANA_21_FILE_COUNT = 34;
const BANANA_21_KIND_LIMITS = Object.freeze({ image: 14, video: 10, file: 10 });
const BANANA_21_BYTE_LIMITS = Object.freeze({ image: 7_340_032, video: 20_971_520, file: 5_242_880 });
const PRINCIPAL_ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MEDIA_KINDS = Object.freeze(["image", "video", "file"] as const);

type StandardProfile = Readonly<OwnerBananaImageSourceProfile | OwnerGptImageSourceProfile>;
type StandardCatalogPort = OwnerBananaImageCatalogPort | OwnerGptImageCatalogPort;
type StandardNormalizedParameters = OwnerBananaImageNormalizedParameters | OwnerGptImageNormalizedParameters;
type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export type OwnerStandardImageSourceProfile = StandardProfile;

export interface OwnerStandardImageOwnedReferenceResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerStandardImageVariant;
  readonly model_id: OwnerStandardImageVariant;
  readonly ai_name: "banana" | "sora-images";
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
}

export interface OwnerStandardImageOwnedReferenceResolution extends OwnerStandardImageOwnedReferenceResolverContext {
  readonly file_url: string;
  readonly mime_type: OwnerStandardImageMimeType;
  readonly kind: OwnerStandardImageReferenceMediaKind;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY" | "UNKNOWN";
}

export type ResolveOwnerStandardImageOwnedReference = (
  context: Readonly<OwnerStandardImageOwnedReferenceResolverContext>
) => Promise<OwnerStandardImageOwnedReferenceResolution>;

const referenceSetBrand: unique symbol = Symbol("OwnerStandardImageOwnedReferenceSet");

export interface OwnerStandardImageOwnedReferenceSet {
  readonly [referenceSetBrand]: true;
  readonly variant: OwnerStandardImageVariant;
  readonly reference_count: number;
  readonly total_reference_count: number;
  readonly counts_by_kind: Readonly<Record<OwnerStandardImageReferenceMediaKind, number>>;
  readonly expires_at: number;
}

interface IssuedReference extends OwnerStandardImageOwnedReferenceResolution {}

interface ReferenceSetState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerStandardImageVariant;
  readonly profile: StandardProfile;
  readonly references: readonly IssuedReference[];
  readonly image_reference_count: number;
  readonly counts_by_kind: Readonly<Record<OwnerStandardImageReferenceMediaKind, number>>;
  readonly total_size: number;
  readonly expires_at: number;
}

const issuedReferenceSets = new WeakMap<object, Readonly<ReferenceSetState>>();
const revokedReferenceSets = new WeakSet<object>();

export interface OwnerStandardImageReferenceBindingIssuerOptions {
  readonly catalog: StandardCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerStandardImageReferenceBindingIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerStandardImageVariant;
  readonly reference_handles: readonly string[];
}

export interface OwnerStandardImageReferenceBindingIssuer {
  issue(input: OwnerStandardImageReferenceBindingIssueInput | unknown): Promise<OwnerStandardImageOwnedReferenceSet>;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}

export interface OwnerStandardImageInputReferenceMetadata {
  readonly kind: OwnerStandardImageReferenceMediaKind;
  readonly mime_type: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY" | "UNKNOWN";
}

export interface OwnerStandardImagePreparedCandidate {
  readonly status: "blocked";
  readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly model_id: OwnerStandardImageVariant;
  readonly ai_name: "banana" | "sora-images";
  readonly variant: OwnerStandardImageVariant;
  readonly model_type: OwnerStandardImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly prompt: string;
  readonly prompt_local_max_utf8_bytes: 65_536;
  readonly prompt_limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
  readonly parameters: Readonly<Record<string, string | null>>;
  readonly reference_count: number;
  readonly total_reference_count: number;
  readonly counts_by_kind: Readonly<Record<OwnerStandardImageReferenceMediaKind, number>>;
  readonly references: readonly OwnerStandardImageInputReferenceMetadata[];
  readonly dimension_confidence: "HEADER_OR_UNAVAILABLE_NOT_BROWSER_DECODED";
  readonly pixel_decode_verified: false;
  readonly projection_verified: false;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly cost_input_confidence: string;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly request: Readonly<{
    prompt: string;
    settings: Readonly<{
      n: 1;
      model_type: OwnerStandardImageVariant;
      aspect_ratio: string | null;
      image_size?: string | null;
      thinking_level?: string;
      quality?: string;
      details_quality?: string;
      file_urls: readonly Readonly<{ type: OwnerStandardImageReferenceMediaKind; url: string }>[];
      [key: string]: unknown;
    }>;
  }>;
}

export interface PrepareOwnerStandardImageRequestInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerStandardImageVariant;
  readonly parameters: unknown;
  readonly reference_set: OwnerStandardImageOwnedReferenceSet;
  readonly prompt: string;
}

export interface PrepareOwnerStandardImageRequestOptions {
  readonly catalog: StandardCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

interface PreparedCandidateState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerStandardImageVariant;
  readonly expires_at: number;
  readonly reference_set: object;
  readonly candidate: OwnerStandardImagePreparedCandidate;
  readonly fingerprint: string;
  readonly intent_fingerprint: string;
}

const preparedCandidates = new WeakMap<object, Readonly<PreparedCandidateState>>();

export class OwnerStandardImagePrepareError extends Error {
  constructor(readonly code: OwnerStandardImagePrepareErrorCode) {
    super("The owner standard image candidate could not be prepared safely.");
    this.name = "OwnerStandardImagePrepareError";
  }
}

export type OwnerStandardImagePrepareErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_MISMATCH" | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED" | "PARAMETERS_INVALID" | "PROMPT_INVALID" | "CANDIDATE_INVALID";

/** Exact selected source profile for one of the ten image-family IDs. */
export function getOwnerStandardImageSourceProfile(
  variantInput: unknown,
  catalogInput: StandardCatalogPort,
  catalogVersionInput: unknown
): StandardProfile {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  try {
    const profile = isBananaVariant(variantInput)
      ? getOwnerBananaImageSourceProfile(variantInput, catalogInput as OwnerBananaImageCatalogPort, catalogVersionInput)
      : getOwnerGptImageSourceProfile(variantInput, catalogInput as OwnerGptImageCatalogPort, catalogVersionInput);
    return profile as StandardProfile;
  } catch {
    fail("PROFILE_BINDING_MISMATCH");
  }
}

/** Issues opaque, exact-profile-bound references; never accepts caller URLs or metadata. */
export function createOwnerStandardImageOwnedReferenceBindingIssuer(
  resolveOwnedReference: ResolveOwnerStandardImageOwnedReference,
  optionsInput: OwnerStandardImageReferenceBindingIssuerOptions | unknown
): OwnerStandardImageReferenceBindingIssuer {
  if (typeof resolveOwnedReference !== "function" || isProxy(resolveOwnedReference)) fail("INVALID_REQUEST");
  const options = snapshotOptions(optionsInput);
  let closed = false;
  let pending = 0;
  const pendingByAttempt = new Map<string, number>();
  const pendingPrincipalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  const attemptEpoch = new Map<string, number>();
  const setsByAttempt = new Map<string, Set<object>>();
  const emptyIssued = new Map<string, number>();
  const resolvedIdentity = new Map<string, Readonly<{ fingerprint: string; expires_at: number }>>();

  const prune = (now: number): void => {
    for (const [attemptId, sets] of setsByAttempt) {
      for (const set of sets) {
        const state = issuedReferenceSets.get(set);
        if (!state || state.expires_at <= now) {
          revokedReferenceSets.add(set);
          sets.delete(set);
        }
      }
      if (sets.size === 0) setsByAttempt.delete(attemptId);
    }
    for (const [key, expiresAt] of emptyIssued) if (expiresAt <= now) emptyIssued.delete(key);
    for (const [key, value] of resolvedIdentity) if (value.expires_at <= now) resolvedIdentity.delete(key);
    for (const attemptId of attemptEpoch.keys()) if (!pendingByAttempt.has(attemptId)) attemptEpoch.delete(attemptId);
  };

  const invalidateAttempt = (attemptId: string): void => {
    if (!isAttemptId(attemptId)) return;
    if ((pendingByAttempt.get(attemptId) ?? 0) > 0) attemptEpoch.set(attemptId, (attemptEpoch.get(attemptId) ?? 0) + 1);
    else attemptEpoch.delete(attemptId);
    for (const set of setsByAttempt.get(attemptId) ?? []) revokedReferenceSets.add(set);
    setsByAttempt.delete(attemptId);
    for (const [key] of emptyIssued) {
      if (key.startsWith(`${attemptId}\u0000`)) emptyIssued.delete(key);
    }
    for (const key of resolvedIdentity.keys()) if (key.startsWith(`${attemptId}\u0000`)) resolvedIdentity.delete(key);
  };

  return Object.freeze({
    async issue(input: OwnerStandardImageReferenceBindingIssueInput | unknown): Promise<OwnerStandardImageOwnedReferenceSet> {
      if (closed || pending >= MAX_PENDING_RESOLVES) fail("REFERENCE_UNAVAILABLE");
      const request = snapshotIssueInput(input);
      const now = safeNow(options.now);
      prune(now);
      const principal = snapshotGenerationPrincipal(request.principal);
      if (!isAttemptId(request.attempt_id) || principal.connection_id !== request.attempt_id || !isVariant(request.variant)) fail("INVALID_REQUEST");
      const profile = getOwnerStandardImageSourceProfile(request.variant, options.catalog, options.catalog_version);
      for (const set of setsByAttempt.get(request.attempt_id) ?? []) {
        const state = issuedReferenceSets.get(set);
        if (state && !sameGenerationPrincipal(state.principal, principal)) fail("PRINCIPAL_MISMATCH");
      }
      const pendingPrincipal = pendingPrincipalByAttempt.get(request.attempt_id);
      if (pendingPrincipal && !sameGenerationPrincipal(pendingPrincipal, principal)) fail("PRINCIPAL_MISMATCH");
      validateHandleCount(profile, request.reference_handles.length);
      const seen = new Set<string>();
      for (const handle of request.reference_handles) {
        if (typeof handle !== "string" || !HANDLE_PATTERN.test(handle) || seen.has(handle)) fail("INVALID_REQUEST");
        seen.add(handle);
      }
      const emptyKey = request.reference_handles.length === 0
        ? `${request.attempt_id}\u0000${request.variant}\u0000${principalKey(principal)}` : null;
      if (emptyKey !== null && emptyIssued.has(emptyKey)) fail("REFERENCE_UNAVAILABLE");
      const attemptSetCount = setsByAttempt.get(request.attempt_id)?.size ?? 0;
      const totalSetCount = [...setsByAttempt.values()].reduce((sum, entries) => sum + entries.size, 0);
      if (attemptSetCount + (pendingByAttempt.get(request.attempt_id) ?? 0) >= MAX_SETS_PER_ATTEMPT ||
          totalSetCount + pending >= MAX_REFERENCE_SETS) fail("REFERENCE_UNAVAILABLE");
      if (request.reference_handles.length === 0 && now > Number.MAX_SAFE_INTEGER - EMPTY_REFERENCE_TTL_MS) fail("REFERENCE_UNAVAILABLE");

      const epoch = attemptEpoch.get(request.attempt_id) ?? 0;
      pending += 1;
      pendingByAttempt.set(request.attempt_id, (pendingByAttempt.get(request.attempt_id) ?? 0) + 1);
      if (!pendingPrincipal) pendingPrincipalByAttempt.set(request.attempt_id, principal);
      try {
        const references: IssuedReference[] = [];
        for (const referenceHandle of request.reference_handles) {
          const context = Object.freeze({
            principal, attempt_id: request.attempt_id, variant: request.variant,
            model_id: profile.model_id, ai_name: profile.ai_name, scope: "image" as const,
            operation_id: "generate-image" as const, catalog_version: profile.public_catalog_version,
            profile_schema_hash: profile.profile_schema_hash, reference_handle: referenceHandle
          });
          let raw: unknown;
          try { raw = await resolveOwnedReference(context); } catch { fail("REFERENCE_UNAVAILABLE"); }
          if (closed || epoch !== (attemptEpoch.get(request.attempt_id) ?? 0)) fail("REFERENCE_UNAVAILABLE");
          const reference = snapshotResolvedReference(raw);
          validateResolvedReference(reference, context, profile, now);
          const previous = resolvedIdentity.get(`${request.attempt_id}\u0000${referenceHandle}`);
          const fingerprint = schemaHash(reference);
          if (previous && previous.expires_at > now && previous.fingerprint !== fingerprint) fail("REFERENCE_UNAVAILABLE");
          references.push(reference);
        }
        validateReferenceCollection(profile, references);
        if (closed || epoch !== (attemptEpoch.get(request.attempt_id) ?? 0)) fail("REFERENCE_UNAVAILABLE");
        const expiresAt = references.length === 0
          ? now + EMPTY_REFERENCE_TTL_MS
          : Math.min(...references.map((reference) => reference.expires_at));
        if (expiresAt <= safeNow(options.now)) fail("REFERENCE_EXPIRED");
        for (const reference of references) {
          resolvedIdentity.set(`${request.attempt_id}\u0000${reference.reference_handle}`, {
            fingerprint: schemaHash(reference), expires_at: reference.expires_at
          });
        }
        const imageCount = references.filter((reference) => reference.kind === "image").length;
        const countsByKind = countByKind(references);
        const set = Object.create(null) as OwnerStandardImageOwnedReferenceSet;
        Object.defineProperties(set, {
          [referenceSetBrand]: { value: true },
          variant: { value: request.variant },
          reference_count: { value: imageCount },
          total_reference_count: { value: references.length },
          counts_by_kind: { value: deepFreeze(countsByKind) },
          expires_at: { value: expiresAt }
        });
        Object.freeze(set);
        issuedReferenceSets.set(set as object, Object.freeze({
          principal, attempt_id: request.attempt_id, variant: request.variant, profile,
          references: Object.freeze(references), image_reference_count: imageCount,
          counts_by_kind: deepFreeze(countsByKind),
          total_size: references.reduce((sum, reference) => sum + reference.size, 0), expires_at: expiresAt
        }));
        const attemptSets = setsByAttempt.get(request.attempt_id) ?? new Set<object>();
        attemptSets.add(set as object);
        setsByAttempt.set(request.attempt_id, attemptSets);
        if (emptyKey !== null) emptyIssued.set(emptyKey, expiresAt);
        return set;
      } finally {
        pending -= 1;
        const attemptPending = pendingByAttempt.get(request.attempt_id) ?? 0;
        if (attemptPending <= 1) {
          pendingByAttempt.delete(request.attempt_id);
          pendingPrincipalByAttempt.delete(request.attempt_id);
          attemptEpoch.delete(request.attempt_id);
        } else pendingByAttempt.set(request.attempt_id, attemptPending - 1);
      }
    },
    invalidateAttempt,
    close(): void {
      if (closed) return;
      closed = true;
      for (const sets of setsByAttempt.values()) for (const set of sets) revokedReferenceSets.add(set);
      setsByAttempt.clear(); emptyIssued.clear(); resolvedIdentity.clear(); attemptEpoch.clear();
      pendingByAttempt.clear(); pendingPrincipalByAttempt.clear();
    }
  });
}

/** Joins exact source controls, ordered issued references, a prompt and cost inputs; dispatch remains blocked. */
export function prepareOwnerStandardImageRequest(
  input: PrepareOwnerStandardImageRequestInput | unknown,
  optionsInput: PrepareOwnerStandardImageRequestOptions | unknown
): OwnerStandardImagePreparedCandidate {
  const request = snapshotPrepareInput(input);
  const options = snapshotOptions(optionsInput);
  const principal = snapshotGenerationPrincipal(request.principal);
  if (!isAttemptId(request.attempt_id) || principal.connection_id !== request.attempt_id || !isVariant(request.variant)) fail("INVALID_REQUEST");
  const prompt = validatePrompt(request.prompt);
  const profile = getOwnerStandardImageSourceProfile(request.variant, options.catalog, options.catalog_version);
  const referenceSet = request.reference_set;
  if (!referenceSet || typeof referenceSet !== "object" || Array.isArray(referenceSet) || isProxy(referenceSet) || !Object.isFrozen(referenceSet)) {
    fail("REFERENCE_UNAVAILABLE");
  }
  const state = issuedReferenceSets.get(referenceSet as object);
  if (!state || revokedReferenceSets.has(referenceSet as object) || state.attempt_id !== request.attempt_id ||
      state.variant !== request.variant || state.profile.profile_schema_hash !== profile.profile_schema_hash ||
      !sameGenerationPrincipal(state.principal, principal)) fail("REFERENCE_UNAVAILABLE");
  const now = safeNow(options.now);
  if (state.expires_at <= now) fail("REFERENCE_EXPIRED");

  let normalized: StandardNormalizedParameters;
  try {
    normalized = isBananaVariant(request.variant)
      ? normalizeOwnerBananaImageParameters({ variant: request.variant, reference_count: state.image_reference_count, parameters: request.parameters })
      : normalizeOwnerGptImageParameters({ variant: request.variant as OwnerGptImageVariant,
        reference_count: state.image_reference_count, parameters: request.parameters });
  } catch (error) {
    if (error instanceof OwnerBananaImageParametersError || error instanceof OwnerGptImageParametersError) fail("PARAMETERS_INVALID");
    fail("PARAMETERS_INVALID");
  }
  const settings = makeWireSettings(request.variant, normalized, state.references);
  const body = deepFreeze({ prompt, settings });
  const costInputs = deepFreeze({ ...normalized.cost_inputs });
  const publicMetadata = state.references.map((reference) => deepFreeze({
    kind: reference.kind, mime_type: reference.mime_type, width: reference.width, height: reference.height,
    duration: reference.duration, size: reference.size, sha256: reference.sha256,
    metadata_confidence: reference.metadata_confidence
  }));
  const fingerprint = schemaHash({
    profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
    principal, attempt_id: request.attempt_id, variant: request.variant,
    parameters: normalized.parameters, prompt, cost_inputs: normalized.cost_inputs,
    references: state.references.map((reference) => ({
      reference_handle: reference.reference_handle, file_url: reference.file_url, kind: reference.kind,
      mime_type: reference.mime_type, width: reference.width, height: reference.height, duration: reference.duration,
      size: reference.size, sha256: reference.sha256, expires_at: reference.expires_at,
      metadata_confidence: reference.metadata_confidence
    }))
  });
  const intentFingerprint = schemaHash({
    principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    variant: request.variant,
    parameters: normalized.parameters,
    prompt,
    references: state.references.map((reference) => ({
      kind: reference.kind, mime_type: reference.mime_type, size: reference.size, sha256: reference.sha256
    }))
  });
  const candidateData = {
    status: "blocked" as const,
    source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    source_binding: profile.source_binding,
    model_id: profile.model_id,
    ai_name: profile.ai_name,
    variant: request.variant,
    model_type: profile.model_type,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    prompt,
    prompt_local_max_utf8_bytes: PROMPT_MAX_UTF8_BYTES as 65_536,
    prompt_limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" as const,
    parameters: normalized.parameters as Readonly<Record<string, string | null>>,
    reference_count: state.image_reference_count,
    total_reference_count: state.references.length,
    counts_by_kind: state.counts_by_kind,
    references: Object.freeze(publicMetadata),
    dimension_confidence: "HEADER_OR_UNAVAILABLE_NOT_BROWSER_DECODED" as const,
    pixel_decode_verified: false as const,
    projection_verified: false as const,
    cost_inputs: costInputs,
    cost_input_confidence: normalized.cost_input_confidence,
    expires_at: state.expires_at,
    request_fingerprint: fingerprint,
    intent_fingerprint: intentFingerprint
  };
  Object.defineProperty(candidateData, "request", { value: body, enumerable: false, writable: false, configurable: false });
  const candidate = deepFreeze(candidateData) as OwnerStandardImagePreparedCandidate;
  preparedCandidates.set(candidate as object, Object.freeze({
    principal, attempt_id: request.attempt_id, variant: request.variant, expires_at: state.expires_at,
    reference_set: referenceSet as object, candidate, fingerprint, intent_fingerprint: intentFingerprint
  }));
  return candidate;
}

/** Identity/lifetime check only; this is not permission to dispatch. */
export function isOwnerStandardImagePreparedCandidateForPrincipal(
  candidateInput: unknown, principalInput: unknown, attemptIdInput: unknown, nowInput: unknown = Date.now()
): candidateInput is OwnerStandardImagePreparedCandidate {
  if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || isProxy(candidateInput) ||
      !Object.isFrozen(candidateInput) || typeof attemptIdInput !== "string" || !Number.isSafeInteger(nowInput) || (nowInput as number) < 0) return false;
  const state = preparedCandidates.get(candidateInput);
  if (!state || state.candidate !== candidateInput || state.attempt_id !== attemptIdInput ||
      state.expires_at <= (nowInput as number) || revokedReferenceSets.has(state.reference_set) ||
      state.fingerprint !== state.candidate.request_fingerprint ||
      state.intent_fingerprint !== state.candidate.intent_fingerprint) return false;
  try { return sameGenerationPrincipal(state.principal, snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef)); }
  catch { return false; }
}

function makeWireSettings(
  variant: OwnerStandardImageVariant,
  normalized: StandardNormalizedParameters,
  references: readonly IssuedReference[]
): OwnerStandardImagePreparedCandidate["request"]["settings"] {
  const fileUrls = Object.freeze(references.map((reference) => Object.freeze({ type: reference.kind, url: reference.file_url })));
  const base = { n: 1 as const, model_type: variant, ...("source_wire_settings" in normalized ? normalized.source_wire_settings : normalized.source_json_mapping), file_urls: fileUrls };
  return deepFreeze(base) as OwnerStandardImagePreparedCandidate["request"]["settings"];
}

function validateHandleCount(profile: StandardProfile, total: number): Readonly<Record<OwnerStandardImageReferenceMediaKind, number>> {
  if (!Number.isSafeInteger(total) || total < 0) fail("INVALID_REQUEST");
  if (profile.model_id === "banana-2.1") {
    if (total > BANANA_21_FILE_COUNT) fail("INVALID_REQUEST");
    return BANANA_21_KIND_LIMITS;
  }
  const maximum = isBananaVariant(profile.model_id)
    ? (profile as OwnerBananaImageSourceProfile).reference_count.maximum
    : (profile as OwnerGptImageSourceProfile).reference_count.maximum;
  if (total > maximum) fail("INVALID_REQUEST");
  return Object.freeze({ image: maximum, video: 0, file: 0 });
}

function validateResolvedReference(
  reference: IssuedReference,
  expected: OwnerStandardImageOwnedReferenceResolverContext,
  profile: StandardProfile,
  now: number
): void {
  if (reference.principal.tenant_id !== expected.principal.tenant_id ||
      reference.principal.subject_id !== expected.principal.subject_id ||
      reference.principal.connection_id !== expected.principal.connection_id ||
      reference.attempt_id !== expected.attempt_id || reference.variant !== expected.variant ||
      reference.model_id !== expected.model_id || reference.ai_name !== expected.ai_name ||
      reference.scope !== expected.scope || reference.operation_id !== expected.operation_id ||
      reference.catalog_version !== expected.catalog_version || reference.profile_schema_hash !== expected.profile_schema_hash ||
      reference.reference_handle !== expected.reference_handle) fail("REFERENCE_UNAVAILABLE");
  if (typeof reference.file_url !== "string" || !isSafeUploadReferenceUrl(reference.file_url) ||
      typeof reference.mime_type !== "string" || !SHA256_PATTERN.test(reference.sha256) ||
      !Number.isSafeInteger(reference.size) || reference.size < 0 || !Number.isSafeInteger(reference.expires_at) ||
      reference.expires_at <= now || !isNullablePositiveInteger(reference.width) || !isNullablePositiveInteger(reference.height) ||
      !isNullableNonNegativeFinite(reference.duration) || !isKind(reference.kind) ||
      (reference.metadata_confidence !== "CONTAINER_METADATA_ONLY" && reference.metadata_confidence !== "UNKNOWN")) fail("REFERENCE_UNAVAILABLE");
  if (reference.kind !== kindForMime(reference.mime_type) || !mimeAccepted(profile, reference.mime_type) ||
      (profile.model_id !== "banana-2.1" && reference.kind !== "image")) fail("REFERENCE_UNAVAILABLE");
}

function validateReferenceCollection(profile: StandardProfile, references: readonly IssuedReference[]): void {
  const urls = new Set<string>();
  const hashes = new Set<string>();
  const counts = countByKind(references);
  let totalBytes = 0;
  const banana21 = profile.model_id === "banana-2.1";
  const limits = banana21 ? BANANA_21_KIND_LIMITS : { image: (profile as OwnerBananaImageSourceProfile | OwnerGptImageSourceProfile).reference_count.maximum, video: 0, file: 0 };
  for (const reference of references) {
    if (urls.has(reference.file_url) || hashes.has(reference.sha256)) fail("REFERENCE_UNAVAILABLE");
    urls.add(reference.file_url); hashes.add(reference.sha256);
    if (counts[reference.kind] > limits[reference.kind]) fail("REFERENCE_UNAVAILABLE");
    if (banana21) {
      if (reference.size > BANANA_21_BYTE_LIMITS[reference.kind]) fail("REFERENCE_UNAVAILABLE");
      totalBytes += reference.size;
      if (totalBytes > BANANA_21_TOTAL_BYTES) fail("REFERENCE_UNAVAILABLE");
    }
  }
  if (!banana21 && (counts.video > 0 || counts.file > 0)) fail("REFERENCE_UNAVAILABLE");
}

function mimeAccepted(profile: StandardProfile, mime: string): boolean {
  const accepted = profile.public_settings.accepted_file_types;
  return Array.isArray(accepted) && accepted.includes(mime);
}

function kindForMime(mime: unknown): OwnerStandardImageReferenceMediaKind | null {
  if (typeof mime !== "string") return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "file";
  return null;
}

function countByKind(references: readonly Pick<IssuedReference, "kind">[]): Record<OwnerStandardImageReferenceMediaKind, number> {
  const counts = { image: 0, video: 0, file: 0 };
  for (const reference of references) counts[reference.kind] += 1;
  return counts;
}

function snapshotResolvedReference(value: unknown): IssuedReference {
  const fields = readExactRecord(value, ["principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "operation_id",
    "catalog_version", "profile_schema_hash", "reference_handle", "file_url", "mime_type", "kind", "width", "height",
    "duration", "size", "sha256", "expires_at", "metadata_confidence"]);
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  return Object.freeze({
    principal, attempt_id: fields.attempt_id as string, variant: fields.variant as OwnerStandardImageVariant,
    model_id: fields.model_id as OwnerStandardImageVariant, ai_name: fields.ai_name as "banana" | "sora-images",
    scope: fields.scope as "image", operation_id: fields.operation_id as "generate-image",
    catalog_version: fields.catalog_version as typeof CATALOG_VERSION, profile_schema_hash: fields.profile_schema_hash as string,
    reference_handle: fields.reference_handle as string, file_url: fields.file_url as string, mime_type: fields.mime_type as string,
    kind: fields.kind as OwnerStandardImageReferenceMediaKind, width: fields.width as number | null,
    height: fields.height as number | null, duration: fields.duration as number | null, size: fields.size as number,
    sha256: fields.sha256 as string, expires_at: fields.expires_at as number,
    metadata_confidence: fields.metadata_confidence as "CONTAINER_METADATA_ONLY" | "UNKNOWN"
  });
}

function snapshotIssueInput(value: unknown): OwnerStandardImageReferenceBindingIssueInput {
  const record = readExactRecord(value, ["principal", "attempt_id", "variant", "reference_handles"]);
  if (!Array.isArray(record.reference_handles) || isProxy(record.reference_handles)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(record.reference_handles);
  if (Object.getOwnPropertySymbols(record.reference_handles).length !== 0 ||
      Object.keys(descriptors).length !== record.reference_handles.length + 1 || !("length" in descriptors) ||
      Array.from({ length: record.reference_handles.length }, (_, index) => descriptors[String(index)]).some((descriptor) =>
        !descriptor || !("value" in descriptor) || descriptor.enumerable !== true)) fail("INVALID_REQUEST");
  return { principal: record.principal as GenerationPrincipalRef, attempt_id: record.attempt_id as string,
    variant: record.variant as OwnerStandardImageVariant,
    reference_handles: Object.freeze(Array.from({ length: record.reference_handles.length }, (_, index) => descriptors[String(index)]!.value as string)) };
}

function snapshotPrepareInput(value: unknown): PrepareOwnerStandardImageRequestInput {
  const record = readExactRecord(value, ["principal", "attempt_id", "variant", "parameters", "reference_set", "prompt"]);
  return record as unknown as PrepareOwnerStandardImageRequestInput;
}

function snapshotOptions(value: unknown): Readonly<{ catalog: StandardCatalogPort; catalog_version: string; now: () => number }> {
  if (isProxy(value) || !isPlainRecord(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !["catalog", "catalog_version", "now"].includes(key) ||
      !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      !Object.hasOwn(descriptors, "catalog") || !Object.hasOwn(descriptors, "catalog_version")) fail("INVALID_REQUEST");
  const catalog = descriptors.catalog!.value;
  const catalogVersion = descriptors.catalog_version!.value;
  const nowValue = descriptors.now?.value;
  if (!catalog || typeof catalog !== "object" || isProxy(catalog) || typeof catalogVersion !== "string" ||
      (nowValue !== undefined && (typeof nowValue !== "function" || isProxy(nowValue)))) fail("INVALID_REQUEST");
  return Object.freeze({ catalog: catalog as StandardCatalogPort, catalog_version: catalogVersion,
    now: typeof nowValue === "function" ? nowValue as () => number : Date.now });
}

function validatePrompt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || PROMPT_CONTROL_CHARACTERS.test(value) ||
      hasMalformedUnicode(value) || Buffer.byteLength(value, "utf8") > PROMPT_MAX_UTF8_BYTES) fail("PROMPT_INVALID");
  return value;
}

function hasMalformedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (isProxy(value) || !isPlainRecord(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) snapshot[key] = descriptors[key]!.value;
  return snapshot;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isAttemptId(value: unknown): value is string {
  return typeof value === "string" && PRINCIPAL_ATTEMPT_PATTERN.test(value);
}

function isVariant(value: unknown): value is OwnerStandardImageVariant {
  return typeof value === "string" && (OWNER_STANDARD_IMAGE_VARIANTS as readonly string[]).includes(value);
}

function isBananaVariant(value: OwnerStandardImageVariant): value is OwnerBananaImageVariant {
  return (OWNER_BANANA_IMAGE_VARIANTS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is OwnerStandardImageReferenceMediaKind {
  return MEDIA_KINDS.includes(value as OwnerStandardImageReferenceMediaKind);
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) > 0);
}

function isNullableNonNegativeFinite(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function principalKey(principal: Readonly<GenerationPrincipalRef>): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, connection_id: principal.connection_id });
}

function safeNow(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_REQUEST");
  return value;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function fail(code: OwnerStandardImagePrepareErrorCode): never {
  throw new OwnerStandardImagePrepareError(code);
}
