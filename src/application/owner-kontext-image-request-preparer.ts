import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import type { DiscoveryCatalogRepository, DiscoveryModelRecord } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  getOwnerKontextImageSourceParameters,
  normalizeOwnerKontextImageParameters,
  OwnerKontextImageParametersError,
  type OwnerKontextImageNormalizedParameters,
  type OwnerKontextImageParameters,
  type OwnerKontextImageVariant
} from "./owner-kontext-image-parameters.js";

const SOURCE_PARAMETERS = getOwnerKontextImageSourceParameters();
const SOURCE_BUILD_ID = "1791467421";
const E551_CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const E551_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const E551_SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
} as const);
const ACCEPTED_MIME_TYPES = Object.freeze([
  "image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"
] as const);
const CANONICAL_MIME_TYPES = Object.freeze([
  "image/jpeg", "image/png", "image/avif", "image/webp"
] as const);
const MODEL_FILE_COUNTS = Object.freeze({
  "flux-kontext-pro": 1,
  "flux-kontext-max": 1,
  "flux-kontext-multi": 4
} as const);
const REFERENCE_POLICY = SOURCE_PARAMETERS.reference_count;
const PRINCIPAL_ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE_PATTERN = /^kontext_image_[0-9a-f-]{36}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPERATOR_TTL_MS = 15 * 60_000;
const MAX_LOCAL_PROMPT_UTF8_BYTES = 64 * 1024;
const PROMPT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_PENDING_RESOLVES = 4;
const MAX_REFERENCE_SETS = 128;
const MAX_SETS_PER_ATTEMPT = 128;
const MAX_METADATA_SIZE = Number.MAX_SAFE_INTEGER;
const FILE_URL_TYPE = "image" as const;
const LOCAL_WORKFLOW_POLICY = "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const;

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type OwnerKontextImageMimeType = typeof CANONICAL_MIME_TYPES[number];
export type OwnerKontextImageWorkflowPolicy = typeof LOCAL_WORKFLOW_POLICY;

export interface OwnerKontextImageSourceProfile {
  readonly profile_id: "flux-kontext-source-reviewed-v1";
  readonly model_id: OwnerKontextImageVariant;
  readonly variant: OwnerKontextImageVariant;
  readonly ai_name: "flux";
  readonly model_type: OwnerKontextImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly source_route: "design/generate";
  readonly public_catalog_version: typeof E551_CATALOG_VERSION;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly parameters_source: ReturnType<typeof getOwnerKontextImageSourceParameters>;
  readonly reference_count: (typeof REFERENCE_POLICY)[OwnerKontextImageVariant];
  readonly public_file_count_limit: 1 | 4;
  readonly public_mime_values: typeof ACCEPTED_MIME_TYPES;
  readonly canonical_mime_types: typeof CANONICAL_MIME_TYPES;
  readonly mime_confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE";
  readonly public_max_file_size: 0;
  readonly public_max_prompt_length: 0;
  readonly public_limit_semantics: Readonly<{
    file_size: "PROVIDER_SEMANTICS_UNPROVEN";
    prompt: "NO_FRONTEND_CLIPPING_PROVIDER_SEMANTICS_UNPROVEN";
  }>;
  readonly workflow_policy: OwnerKontextImageWorkflowPolicy;
  readonly workflow_policy_confidence: "EXPLICIT_LOCAL_CLIENT_INTENT_NOT_WEBSITE_DEFAULT";
  readonly prompt_policy: Readonly<{
    required: true;
    admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL";
    local_max_utf8_bytes: 65_536;
    limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
    source_sha256: Readonly<{ input_component: string; shared_luma_controller: string }>;
  }>;
  readonly prompt_admission: "SOURCE_REQUIRED_NONEMPTY_PRESERVE_INPUT_LOCAL_64KIB_GUARD";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerKontextImagePrepareError extends Error {
  constructor(readonly code: OwnerKontextImagePrepareErrorCode) {
    super("The owner Kontext image candidate could not be prepared safely.");
    this.name = "OwnerKontextImagePrepareError";
  }
}

export type OwnerKontextImagePrepareErrorCode =
  | "INVALID_REQUEST"
  | "PROFILE_BINDING_MISMATCH"
  | "PRINCIPAL_MISMATCH"
  | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED"
  | "PARAMETERS_INVALID"
  | "PROMPT_INVALID"
  | "CANDIDATE_INVALID";

const referenceSetBrand: unique symbol = Symbol("OwnerKontextImageOwnedReferenceSet");
const issuedReferenceSets = new WeakMap<object, Readonly<OwnerKontextImageReferenceSetState>>();
const revokedReferenceSets = new WeakSet<object>();

interface IssuedKontextReference {
  readonly reference_handle: string;
  readonly file_url: string;
  readonly mime_type: OwnerKontextImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

interface OwnerKontextImageReferenceSetState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly profile: Readonly<OwnerKontextImageSourceProfile>;
  readonly references: readonly IssuedKontextReference[];
  readonly expires_at: number;
  readonly epoch: number;
}

interface IssuedHandleFingerprint {
  readonly fingerprint: string;
  readonly expires_at: number;
}

interface EmptyReferenceIssueMarker {
  readonly attempt_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly expires_at: number;
}

interface PendingAttemptPrincipal {
  readonly principal: Readonly<GenerationPrincipalRef>;
  count: number;
}

export interface OwnerKontextImageOwnedReferenceSet {
  readonly [referenceSetBrand]: true;
  readonly variant: OwnerKontextImageVariant;
  readonly reference_count: number;
  readonly expires_at: number;
}

export interface OwnerKontextImageOwnedReferenceResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly model_id: OwnerKontextImageVariant;
  readonly ai_name: "flux";
  readonly scope: "image";
  readonly catalog_version: typeof E551_CATALOG_VERSION;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
}

export interface OwnerKontextImageOwnedReferenceResolution extends OwnerKontextImageOwnedReferenceResolverContext {
  readonly file_url: string;
  readonly mime_type: OwnerKontextImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export type ResolveOwnerKontextImageOwnedReference = (
  context: Readonly<OwnerKontextImageOwnedReferenceResolverContext>
) => Promise<unknown>;

export interface OwnerKontextImageReferenceBindingIssuerOptions {
  readonly catalog: OwnerKontextImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerKontextImageReferenceBindingIssuer {
  issue(input: OwnerKontextImageReferenceBindingIssueInput | unknown): Promise<OwnerKontextImageOwnedReferenceSet>;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}

export interface OwnerKontextImageReferenceBindingIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly reference_handles: readonly string[];
}

export interface OwnerKontextImagePreparedCandidate {
  readonly status: "blocked";
  readonly source_readiness: "SOURCE_JOINED_PROMPT_POLICY";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: OwnerKontextImageSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerKontextImageSourceProfile["source_binding"];
  readonly model_id: OwnerKontextImageVariant;
  readonly ai_name: "flux";
  readonly variant: OwnerKontextImageVariant;
  readonly model_type: OwnerKontextImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly source_route: "design/generate";
  readonly workflow_policy: OwnerKontextImageWorkflowPolicy;
  readonly reference_count: number;
  readonly input_images: readonly OwnerKontextImageInputImageMetadata[];
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly query: Readonly<{ ai_name: "flux" }>;
  readonly request: Readonly<{
    prompt: string;
    settings: Readonly<{
      n: 1;
      model_type: OwnerKontextImageVariant;
      workflow_type: "default";
      civitai_loras: readonly [];
      resolution: OwnerKontextImageParameters["resolution"];
      cfg: number;
      steps: number;
      image_strength: number;
      file_urls: readonly Readonly<{ type: "image"; url: string }>[];
    }>;
  }>;
}

export interface OwnerKontextImageInputImageMetadata {
  readonly mime_type: OwnerKontextImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export interface PrepareOwnerKontextImageRequestInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly parameters: unknown;
  readonly reference_set: OwnerKontextImageOwnedReferenceSet;
  readonly workflow_policy: OwnerKontextImageWorkflowPolicy;
  readonly prompt: string;
}

export interface PrepareOwnerKontextImageRequestOptions {
  readonly catalog: OwnerKontextImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

interface PreparedCandidateState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly expires_at: number;
  readonly reference_set: object;
  readonly candidate: OwnerKontextImagePreparedCandidate;
}

const preparedCandidates = new WeakMap<object, Readonly<PreparedCandidateState>>();

/** Creates a source-bound candidate only from a nominal owner-issued set; it grants no dispatch permission. */
export function prepareOwnerKontextImageRequest(
  input: PrepareOwnerKontextImageRequestInput | unknown,
  optionsInput: PrepareOwnerKontextImageRequestOptions | unknown
): OwnerKontextImagePreparedCandidate {
  const request = snapshotPrepareInput(input);
  const options = snapshotIssuerOptions(optionsInput);
  const principal = snapshotGenerationPrincipal(request.principal);
  if (!PRINCIPAL_ATTEMPT_PATTERN.test(request.attempt_id) || principal.connection_id !== request.attempt_id ||
      !isVariant(request.variant) || request.workflow_policy !== LOCAL_WORKFLOW_POLICY) fail("INVALID_REQUEST");
  const profile = getOwnerKontextImageSourceProfile(request.variant, options.catalog, options.catalog_version);
  const referenceSet = request.reference_set;
  if (!referenceSet || typeof referenceSet !== "object" || Array.isArray(referenceSet) || isProxy(referenceSet) ||
      !Object.isFrozen(referenceSet)) fail("REFERENCE_UNAVAILABLE");
  const referenceState = issuedReferenceSets.get(referenceSet as object);
  if (!referenceState || revokedReferenceSets.has(referenceSet as object) ||
      referenceState.attempt_id !== request.attempt_id || referenceState.variant !== request.variant ||
      referenceState.profile.profile_schema_hash !== profile.profile_schema_hash ||
      !sameGenerationPrincipal(referenceState.principal, principal)) fail("REFERENCE_UNAVAILABLE");
  const now = safeNow(options.now);
  if (referenceState.expires_at <= now) fail("REFERENCE_EXPIRED");

  let normalized: OwnerKontextImageNormalizedParameters;
  try {
    normalized = normalizeOwnerKontextImageParameters({ variant: request.variant, parameters: request.parameters });
  } catch (error) {
    if (error instanceof OwnerKontextImageParametersError) fail("PARAMETERS_INVALID");
    fail("PARAMETERS_INVALID");
  }
  const fileUrls = Object.freeze(referenceState.references.map((reference) => Object.freeze({
    type: FILE_URL_TYPE,
    url: reference.file_url
  })));
  const settings = deepFreeze({
    n: 1 as const,
    model_type: profile.model_type,
    workflow_type: "default" as const,
    civitai_loras: Object.freeze([]) as readonly [],
    ...normalized.parameters,
    file_urls: fileUrls
  });
  const query = Object.freeze({ ai_name: profile.ai_name });
  const requestBody = deepFreeze({ prompt: request.prompt, settings });
  const requestFingerprint = schemaHash({
    profile_schema_hash: profile.profile_schema_hash,
    principal,
    attempt_id: request.attempt_id,
    variant: request.variant,
    workflow_policy: request.workflow_policy,
    prompt: request.prompt,
    request: requestBody,
    references: referenceState.references.map((reference) => ({
      reference_handle: reference.reference_handle,
      file_url: reference.file_url,
      mime_type: reference.mime_type,
      width: reference.width,
      height: reference.height,
      size: reference.size,
      sha256: reference.sha256,
      expires_at: reference.expires_at,
      metadata_confidence: reference.metadata_confidence
    }))
  });
  const inputImages = referenceState.references.map((reference) => ({
    mime_type: reference.mime_type,
    width: reference.width,
    height: reference.height,
    size: reference.size,
    sha256: reference.sha256,
    metadata_confidence: reference.metadata_confidence
  }));
  const candidateData = {
    status: "blocked" as const,
    source_readiness: "SOURCE_JOINED_PROMPT_POLICY" as const,
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
    source_route: profile.source_route,
    workflow_policy: request.workflow_policy,
    reference_count: referenceState.references.length,
    input_images: inputImages,
    expires_at: referenceState.expires_at,
    request_fingerprint: requestFingerprint,
    query
  };
  Object.defineProperty(candidateData, "request", {
    value: requestBody,
    enumerable: false,
    writable: false,
    configurable: false
  });
  const candidate = deepFreeze(candidateData) as OwnerKontextImagePreparedCandidate;
  preparedCandidates.set(candidate as object, Object.freeze({
    principal,
    attempt_id: request.attempt_id,
    variant: request.variant,
    expires_at: referenceState.expires_at,
    reference_set: referenceSet as object,
    candidate
  }));
  return candidate;
}

/** Tests nominal identity and lifetime only; it never grants permission to dispatch. */
export function isOwnerKontextImagePreparedCandidateForPrincipal(
  candidateInput: unknown,
  principalInput: unknown,
  attemptIdInput: unknown,
  nowInput: unknown = Date.now()
): candidateInput is OwnerKontextImagePreparedCandidate {
  if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || isProxy(candidateInput) ||
      !Object.isFrozen(candidateInput) || typeof attemptIdInput !== "string" ||
      !Number.isSafeInteger(nowInput) || (nowInput as number) < 0) return false;
  const state = preparedCandidates.get(candidateInput);
  if (!state || state.candidate !== candidateInput || state.attempt_id !== attemptIdInput ||
      state.expires_at <= (nowInput as number) || revokedReferenceSets.has(state.reference_set)) return false;
  try { return sameGenerationPrincipal(state.principal, snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef)); }
  catch { return false; }
}

/** Issues only private owner-resolved references; raw URLs never enter the caller input. */
export function createOwnerKontextImageOwnedReferenceBindingIssuer(
  resolveOwnedReference: ResolveOwnerKontextImageOwnedReference,
  optionsInput: OwnerKontextImageReferenceBindingIssuerOptions | unknown
): OwnerKontextImageReferenceBindingIssuer {
  if (typeof resolveOwnedReference !== "function" || isProxy(resolveOwnedReference)) fail("INVALID_REQUEST");
  const options = snapshotIssuerOptions(optionsInput);
  let closed = false;
  let pending = 0;
  const attemptEpoch = new Map<string, number>();
  const pendingByAttempt = new Map<string, number>();
  const pendingPrincipalByAttempt = new Map<string, PendingAttemptPrincipal>();
  const setsByAttempt = new Map<string, Set<object>>();
  const handleFingerprints = new Map<string, IssuedHandleFingerprint>();
  const emptySetIssued = new Map<string, EmptyReferenceIssueMarker>();

  const pruneExpired = (now: number): void => {
    for (const [attemptId, sets] of setsByAttempt) {
      for (const referenceSet of sets) {
        const state = issuedReferenceSets.get(referenceSet);
        if (!state || state.expires_at <= now) {
          revokedReferenceSets.add(referenceSet);
          sets.delete(referenceSet);
        }
      }
      if (sets.size === 0) setsByAttempt.delete(attemptId);
    }
    for (const [scopeKey, marker] of emptySetIssued) {
      if (marker.expires_at <= now) emptySetIssued.delete(scopeKey);
    }
    for (const [handleKey, record] of handleFingerprints) {
      if (record.expires_at <= now) handleFingerprints.delete(handleKey);
    }
    for (const attemptId of attemptEpoch.keys()) {
      if (!pendingByAttempt.has(attemptId)) attemptEpoch.delete(attemptId);
    }
  };

  const invalidateAttempt = (attemptId: string): void => {
    if (typeof attemptId !== "string" || !PRINCIPAL_ATTEMPT_PATTERN.test(attemptId)) return;
    if ((pendingByAttempt.get(attemptId) ?? 0) > 0) {
      attemptEpoch.set(attemptId, (attemptEpoch.get(attemptId) ?? 0) + 1);
    } else {
      attemptEpoch.delete(attemptId);
    }
    for (const referenceSet of setsByAttempt.get(attemptId) ?? []) revokedReferenceSets.add(referenceSet);
    setsByAttempt.delete(attemptId);
    for (const [scopeKey, marker] of emptySetIssued) {
      if (marker.attempt_id === attemptId) emptySetIssued.delete(scopeKey);
    }
    for (const key of handleFingerprints.keys()) {
      if ((JSON.parse(key) as unknown[])[0] === attemptId) handleFingerprints.delete(key);
    }
  };

  return Object.freeze({
    async issue(input: OwnerKontextImageReferenceBindingIssueInput | unknown): Promise<OwnerKontextImageOwnedReferenceSet> {
      if (closed || pending >= MAX_PENDING_RESOLVES) fail("REFERENCE_UNAVAILABLE");
      const request = snapshotIssueInput(input);
      const now = safeNow(options.now);
      pruneExpired(now);
      const principal = snapshotGenerationPrincipal(request.principal);
      if (!PRINCIPAL_ATTEMPT_PATTERN.test(request.attempt_id) || principal.connection_id !== request.attempt_id ||
          !isVariant(request.variant)) fail("INVALID_REQUEST");
      for (const referenceSet of setsByAttempt.get(request.attempt_id) ?? []) {
        const state = issuedReferenceSets.get(referenceSet);
        if (state && !sameGenerationPrincipal(state.principal, principal)) fail("PRINCIPAL_MISMATCH");
      }
      for (const marker of emptySetIssued.values()) {
        if (marker.attempt_id === request.attempt_id && !sameGenerationPrincipal(marker.principal, principal)) {
          fail("PRINCIPAL_MISMATCH");
        }
      }
      const pendingPrincipal = pendingPrincipalByAttempt.get(request.attempt_id);
      if (pendingPrincipal && !sameGenerationPrincipal(pendingPrincipal.principal, principal)) fail("PRINCIPAL_MISMATCH");
      const profile = getOwnerKontextImageSourceProfile(request.variant, options.catalog, options.catalog_version);
      const countPolicy = profile.reference_count;
      if (request.reference_handles.length < countPolicy.minimum || request.reference_handles.length > countPolicy.maximum ||
          request.reference_handles.length > profile.public_file_count_limit) fail("INVALID_REQUEST");
      const seen = new Set<string>();
      for (const handle of request.reference_handles) {
        if (typeof handle !== "string" || !REFERENCE_HANDLE_PATTERN.test(handle) || seen.has(handle)) fail("INVALID_REQUEST");
        seen.add(handle);
      }
      const emptySetScopeKey = request.reference_handles.length === 0
        ? schemaHash({ attempt_id: request.attempt_id, variant: request.variant, principal })
        : null;
      if (emptySetScopeKey !== null && emptySetIssued.has(emptySetScopeKey)) fail("REFERENCE_UNAVAILABLE");
      const existingSetCount = setsByAttempt.get(request.attempt_id)?.size ?? 0;
      const totalSetCount = [...setsByAttempt.values()].reduce((sum, value) => sum + value.size, 0);
      if (existingSetCount + (pendingByAttempt.get(request.attempt_id) ?? 0) >= MAX_SETS_PER_ATTEMPT ||
          totalSetCount + pending >= MAX_REFERENCE_SETS) fail("REFERENCE_UNAVAILABLE");
      const epoch = attemptEpoch.get(request.attempt_id) ?? 0;
      if (now > Number.MAX_SAFE_INTEGER - OPERATOR_TTL_MS) fail("REFERENCE_UNAVAILABLE");
      pending += 1;
      pendingByAttempt.set(request.attempt_id, (pendingByAttempt.get(request.attempt_id) ?? 0) + 1);
      if (pendingPrincipal) pendingPrincipal.count += 1;
      else pendingPrincipalByAttempt.set(request.attempt_id, { principal, count: 1 });
      try {
        const references: IssuedKontextReference[] = [];
        for (const referenceHandle of request.reference_handles) {
          const resolverContext = Object.freeze({
            principal,
            attempt_id: request.attempt_id,
            variant: request.variant,
            model_id: profile.model_id,
            ai_name: profile.ai_name,
            scope: profile.scope,
            catalog_version: profile.public_catalog_version,
            profile_schema_hash: profile.profile_schema_hash,
            reference_handle: referenceHandle
          });
          let raw: unknown;
          try { raw = await resolveOwnedReference(resolverContext); }
          catch { fail("REFERENCE_UNAVAILABLE"); }
          if (closed || epoch !== (attemptEpoch.get(request.attempt_id) ?? 0)) fail("REFERENCE_UNAVAILABLE");
          const resolved = snapshotResolvedReference(raw);
          validateResolvedReference(resolved, resolverContext, now);
          const handleKey = JSON.stringify([request.attempt_id, referenceHandle]);
          const fingerprint = schemaHash(resolved);
          const previous = handleFingerprints.get(handleKey);
          if (previous !== undefined && previous.expires_at > now && previous.fingerprint !== fingerprint) fail("REFERENCE_UNAVAILABLE");
          references.push(resolved);
        }
        if (closed || epoch !== (attemptEpoch.get(request.attempt_id) ?? 0)) fail("REFERENCE_UNAVAILABLE");
        const expiresAt = references.length === 0
          ? now + OPERATOR_TTL_MS
          : Math.min(...references.map((reference) => reference.expires_at));
        const completionNow = safeNow(options.now);
        if (expiresAt <= completionNow) fail("REFERENCE_EXPIRED");
        for (const reference of references) {
          handleFingerprints.set(JSON.stringify([request.attempt_id, reference.reference_handle]), {
            fingerprint: schemaHash(reference),
            expires_at: reference.expires_at
          });
        }
        const referenceSet = Object.create(null) as OwnerKontextImageOwnedReferenceSet;
        Object.defineProperties(referenceSet, {
          [referenceSetBrand]: { value: true },
          variant: { value: request.variant },
          reference_count: { value: references.length },
          expires_at: { value: expiresAt }
        });
        Object.freeze(referenceSet);
        issuedReferenceSets.set(referenceSet as object, Object.freeze({
          principal,
          attempt_id: request.attempt_id,
          variant: request.variant,
          profile,
          references: Object.freeze(references),
          expires_at: expiresAt,
          epoch
        }));
        if (emptySetScopeKey !== null) {
          emptySetIssued.set(emptySetScopeKey, Object.freeze({
            attempt_id: request.attempt_id,
            variant: request.variant,
            principal,
            expires_at: expiresAt
          }));
        }
        const attemptSets = setsByAttempt.get(request.attempt_id) ?? new Set<object>();
        attemptSets.add(referenceSet as object);
        setsByAttempt.set(request.attempt_id, attemptSets);
        return referenceSet;
      } finally {
        pending -= 1;
        const attemptPending = pendingByAttempt.get(request.attempt_id) ?? 0;
        if (attemptPending <= 1) {
          pendingByAttempt.delete(request.attempt_id);
          attemptEpoch.delete(request.attempt_id);
        } else {
          pendingByAttempt.set(request.attempt_id, attemptPending - 1);
        }
        const pendingPrincipalState = pendingPrincipalByAttempt.get(request.attempt_id);
        if (pendingPrincipalState) {
          pendingPrincipalState.count -= 1;
          if (pendingPrincipalState.count <= 0) pendingPrincipalByAttempt.delete(request.attempt_id);
        }
      }
    },
    invalidateAttempt,
    close(): void {
      if (closed) return;
      closed = true;
      for (const sets of setsByAttempt.values()) for (const referenceSet of sets) revokedReferenceSets.add(referenceSet);
      setsByAttempt.clear();
      handleFingerprints.clear();
      emptySetIssued.clear();
      attemptEpoch.clear();
      pendingByAttempt.clear();
      pendingPrincipalByAttempt.clear();
    }
  });
}

export interface OwnerKontextImageCatalogPort extends Pick<DiscoveryCatalogRepository,
  "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata"> {}

/** Builds a per-variant descriptor only from the exact selected e551 public model record. */
export function getOwnerKontextImageSourceProfile(
  variantInput: unknown,
  catalogInput: OwnerKontextImageCatalogPort,
  catalogVersionInput: unknown
): Readonly<OwnerKontextImageSourceProfile> {
  if (!isVariant(variantInput)) fail("INVALID_REQUEST");
  if (catalogVersionInput !== E551_CATALOG_VERSION) fail("PROFILE_BINDING_MISMATCH");
  const catalog = snapshotCatalog(catalogInput);
  let model: DiscoveryModelRecord;
  try { model = Reflect.apply(catalog.getModel, catalog.receiver, [variantInput]) as DiscoveryModelRecord; }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
  const record = snapshotPublicModel(model);
  const expectedFileCount = MODEL_FILE_COUNTS[variantInput];
  if (record.id !== variantInput || record.upstream_id !== variantInput || record.ai_name !== "flux" ||
      record.active !== true || record.fetched_at !== E551_FETCHED_AT || record.scope !== "image" ||
      record.modalities.length !== 1 || record.modalities[0] !== "image" ||
      record.operations.length !== 1 || record.operations[0]?.id !== "generate-image" ||
      record.operations[0]?.output_modality !== "image" || record.operations[0]?.derivation !== "PUBLIC_AI_SCOPE" ||
      record.file_count_limit !== expectedFileCount || record.accepted_file_types.length !== ACCEPTED_MIME_TYPES.length ||
      record.accepted_file_types.some((type, index) => type !== ACCEPTED_MIME_TYPES[index]) ||
      record.allowed_media_types.length !== 1 || record.allowed_media_types[0] !== "images" ||
      record.uploadable !== true || record.max_file_size !== 0 || record.max_prompt_length !== 0 ||
      record.get_cost_params.length !== 0 || record.source_hashes.ai !== E551_SOURCE_HASHES.ai ||
      record.source_hashes.llm_models !== E551_SOURCE_HASHES.llm_models ||
      record.source_hashes.models !== E551_SOURCE_HASHES.models) fail("PROFILE_BINDING_MISMATCH");

  const sourceBinding = deepFreeze({
    build_id: SOURCE_BUILD_ID,
    parameter_source_pins: SOURCE_PARAMETERS.source_pins,
    prompt_policy_source_pins: {
      input_component_sha256: "sha256:fbc1b642688cb9cfdd6e6ebe46593662e13ab05187b8e39c0ecd3244552a0928",
      shared_luma_controller_sha256: "sha256:f884e576649f4663919a079ac910e733f2e09e909262ee9e75bdf049e828f1d6"
    },
    selected_public_catalog_version: E551_CATALOG_VERSION,
    selected_public_source_hashes: E551_SOURCE_HASHES,
    normalized_public_model: {
      id: record.id,
      upstream_id: record.upstream_id,
      ai_name: record.ai_name,
      active: record.active,
      scope: record.scope,
      modalities: record.modalities,
      operations: record.operations,
      file_count_limit: record.file_count_limit,
      accepted_file_types: record.accepted_file_types,
      allowed_media_types: record.allowed_media_types,
      max_file_size: record.max_file_size,
      max_prompt_length: record.max_prompt_length,
      uploadable: record.uploadable
    }
  });
  const base = {
    profile_id: "flux-kontext-source-reviewed-v1" as const,
    model_id: variantInput,
    variant: variantInput,
    ai_name: "flux" as const,
    model_type: variantInput,
    scope: "image" as const,
    operation_id: "generate-image" as const,
    source_route: "design/generate" as const,
    public_catalog_version: E551_CATALOG_VERSION,
    source_binding: sourceBinding,
    parameters_source: SOURCE_PARAMETERS,
    reference_count: REFERENCE_POLICY[variantInput],
    public_file_count_limit: expectedFileCount,
    public_mime_values: ACCEPTED_MIME_TYPES,
    canonical_mime_types: CANONICAL_MIME_TYPES,
    mime_confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE" as const,
    public_max_file_size: 0 as const,
    public_max_prompt_length: 0 as const,
    public_limit_semantics: {
      file_size: "PROVIDER_SEMANTICS_UNPROVEN" as const,
      prompt: "NO_FRONTEND_CLIPPING_PROVIDER_SEMANTICS_UNPROVEN" as const
    },
    workflow_policy: LOCAL_WORKFLOW_POLICY,
    workflow_policy_confidence: "EXPLICIT_LOCAL_CLIENT_INTENT_NOT_WEBSITE_DEFAULT" as const,
    prompt_policy: {
      required: true as const,
      admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL" as const,
      local_max_utf8_bytes: MAX_LOCAL_PROMPT_UTF8_BYTES as 65_536,
      limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" as const,
      source_sha256: {
        input_component: "sha256:fbc1b642688cb9cfdd6e6ebe46593662e13ab05187b8e39c0ecd3244552a0928",
        shared_luma_controller: "sha256:f884e576649f4663919a079ac910e733f2e09e909262ee9e75bdf049e828f1d6"
      }
    },
    prompt_admission: "SOURCE_REQUIRED_NONEMPTY_PRESERVE_INPUT_LOCAL_64KIB_GUARD" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  };
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerKontextImageSourceProfile>;
}

function snapshotCatalog(input: unknown): Readonly<{
  receiver: object;
  getModel: (...args: never[]) => unknown;
}> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) fail("INVALID_REQUEST");
  const read = (key: string): unknown => {
    let current: object | null = input as object;
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return undefined;
  };
  const getModel = read("getModel");
  const fetchedAt = read("fetched_at");
  const hashes = read("source_hashes");
  const metadata = read("catalog_metadata");
  if (typeof getModel !== "function" || isProxy(getModel) || fetchedAt !== E551_FETCHED_AT) fail("PROFILE_BINDING_MISMATCH");
  const catalogHashes = readDataRecord(hashes, ["ai", "llm_models", "models"]);
  const metadataFields = readSelectedDataFields(metadata, ["fetched_at", "source_hashes"]);
  const metadataHashes = readDataRecord(metadataFields.source_hashes, ["ai", "llm_models", "models"]);
  if (metadataFields.fetched_at !== E551_FETCHED_AT ||
      catalogHashes.ai !== E551_SOURCE_HASHES.ai || catalogHashes.llm_models !== E551_SOURCE_HASHES.llm_models ||
      catalogHashes.models !== E551_SOURCE_HASHES.models ||
      metadataHashes.ai !== E551_SOURCE_HASHES.ai || metadataHashes.llm_models !== E551_SOURCE_HASHES.llm_models ||
      metadataHashes.models !== E551_SOURCE_HASHES.models) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ receiver: input as object, getModel: getModel as (...args: never[]) => unknown });
}

interface SnapshotPublicModel {
  readonly id: string;
  readonly upstream_id: string;
  readonly ai_name: string;
  readonly active: boolean;
  readonly fetched_at: string;
  readonly scope: string | null;
  readonly modalities: readonly unknown[];
  readonly operations: readonly Readonly<{ id: unknown; output_modality: unknown; derivation: unknown }> [];
  readonly file_count_limit: number;
  readonly accepted_file_types: readonly unknown[];
  readonly allowed_media_types: readonly unknown[];
  readonly max_file_size: number;
  readonly max_prompt_length: number;
  readonly get_cost_params: readonly unknown[];
  readonly uploadable: boolean;
  readonly source_hashes: Readonly<{ ai: unknown; llm_models: unknown; models: unknown }>;
}

function snapshotPublicModel(value: unknown): SnapshotPublicModel {
  const record = readSelectedDataFields(value, [
    "id", "upstream_id", "ai_name", "active", "scope", "modalities", "operations", "settings",
    "fetched_at", "source_hashes"
  ]);
  const settings = readDataRecord(record.settings, [
    "accepted_file_types", "allowed_media_types", "attach_info_text", "file_count_limit",
    "get_cost_params", "max_file_size", "max_prompt_length", "uploadable"
  ]);
  const hashes = readDataRecord(record.source_hashes, ["ai", "llm_models", "models"]);
  const operations = snapshotDenseArray(record.operations).map((operation) => {
    const fields = readDataRecord(operation, ["id", "display_name", "output_modality", "derivation"]);
    return Object.freeze({ id: fields.id, output_modality: fields.output_modality, derivation: fields.derivation });
  });
  return Object.freeze({
    id: readString(record.id),
    upstream_id: readString(record.upstream_id),
    ai_name: readString(record.ai_name),
    active: record.active as boolean,
    fetched_at: readString(record.fetched_at),
    scope: record.scope as string | null,
    modalities: snapshotDenseArray(record.modalities),
    operations: Object.freeze(operations),
    file_count_limit: settings.file_count_limit as number,
    accepted_file_types: snapshotDenseArray(settings.accepted_file_types),
    allowed_media_types: snapshotDenseArray(settings.allowed_media_types),
    max_file_size: settings.max_file_size as number,
    max_prompt_length: settings.max_prompt_length as number,
    get_cost_params: snapshotDenseArray(settings.get_cost_params),
    uploadable: settings.uploadable as boolean,
    source_hashes: Object.freeze({ ai: hashes.ai, llm_models: hashes.llm_models, models: hashes.models })
  });
}

function readDataRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotIssuerOptions(input: unknown): Readonly<{
  catalog: OwnerKontextImageCatalogPort;
  catalog_version: string;
  now?: () => number;
}> {
  const fields = readExactRecord(input, ["catalog", "catalog_version", "now"], ["catalog", "catalog_version"]);
  if (fields.catalog_version !== E551_CATALOG_VERSION || typeof fields.catalog_version !== "string") {
    fail("PROFILE_BINDING_MISMATCH");
  }
  snapshotCatalog(fields.catalog as OwnerKontextImageCatalogPort);
  if (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now))) fail("INVALID_REQUEST");
  return Object.freeze({
    catalog: fields.catalog as OwnerKontextImageCatalogPort,
    catalog_version: fields.catalog_version,
    ...(fields.now === undefined ? {} : { now: fields.now as () => number })
  });
}

function snapshotIssueInput(input: unknown): OwnerKontextImageReferenceBindingIssueInput {
  const fields = readExactRecord(input, ["principal", "attempt_id", "variant", "reference_handles"]);
  const handles = snapshotDenseArray(fields.reference_handles);
  if (handles.some((handle) => typeof handle !== "string")) fail("INVALID_REQUEST");
  return Object.freeze({
    principal: safeSnapshotPrincipal(fields.principal),
    attempt_id: fields.attempt_id as string,
    variant: fields.variant as OwnerKontextImageVariant,
    reference_handles: handles as readonly string[]
  });
}

function snapshotPrepareInput(input: unknown): PrepareOwnerKontextImageRequestInput {
  if (!plainRecord(input)) fail("INVALID_REQUEST");
  const promptDescriptor = Object.getOwnPropertyDescriptor(input, "prompt");
  if (!promptDescriptor || !("value" in promptDescriptor) || promptDescriptor.enumerable !== true) fail("PROMPT_INVALID");
  const fields = readExactRecord(input, [
    "principal", "attempt_id", "variant", "parameters", "reference_set", "workflow_policy", "prompt"
  ]);
  return Object.freeze({
    principal: safeSnapshotPrincipal(fields.principal),
    attempt_id: fields.attempt_id as string,
    variant: fields.variant as OwnerKontextImageVariant,
    parameters: fields.parameters,
    reference_set: fields.reference_set as OwnerKontextImageOwnedReferenceSet,
    workflow_policy: fields.workflow_policy as OwnerKontextImageWorkflowPolicy,
    prompt: validatePrompt(fields.prompt)
  });
}

function validatePrompt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || PROMPT_CONTROL_CHARACTERS.test(value) ||
      !isWellFormedUnicode(value) || Buffer.byteLength(value, "utf8") > MAX_LOCAL_PROMPT_UTF8_BYTES) {
    fail("PROMPT_INVALID");
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function snapshotResolvedReference(input: unknown): IssuedKontextReference & {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly model_id: OwnerKontextImageVariant;
  readonly ai_name: "flux";
  readonly scope: "image";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
} {
  const fields = readExactRecord(input, [
    "principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "catalog_version",
    "profile_schema_hash", "reference_handle", "file_url", "mime_type", "width", "height", "size",
    "sha256", "expires_at", "metadata_confidence"
  ]);
  return Object.freeze({
    principal: safeSnapshotPrincipal(fields.principal),
    attempt_id: fields.attempt_id as string,
    variant: fields.variant as OwnerKontextImageVariant,
    model_id: fields.model_id as OwnerKontextImageVariant,
    ai_name: fields.ai_name as "flux",
    scope: fields.scope as "image",
    catalog_version: fields.catalog_version as string,
    profile_schema_hash: fields.profile_schema_hash as string,
    reference_handle: fields.reference_handle as string,
    file_url: fields.file_url as string,
    mime_type: fields.mime_type as OwnerKontextImageMimeType,
    width: fields.width as number,
    height: fields.height as number,
    size: fields.size as number,
    sha256: fields.sha256 as string,
    expires_at: fields.expires_at as number,
    metadata_confidence: fields.metadata_confidence as "CONTAINER_METADATA_ONLY"
  });
}

function validateResolvedReference(
  reference: ReturnType<typeof snapshotResolvedReference>,
  expected: OwnerKontextImageOwnedReferenceResolverContext,
  now: number
): asserts reference is ReturnType<typeof snapshotResolvedReference> {
  if (!sameGenerationPrincipal(reference.principal, expected.principal) ||
      reference.attempt_id !== expected.attempt_id || reference.variant !== expected.variant ||
      reference.model_id !== expected.model_id || reference.ai_name !== expected.ai_name ||
      reference.scope !== expected.scope || reference.catalog_version !== expected.catalog_version ||
      reference.profile_schema_hash !== expected.profile_schema_hash ||
      reference.reference_handle !== expected.reference_handle ||
      !REFERENCE_HANDLE_PATTERN.test(reference.reference_handle) ||
      !isSafeUploadReferenceUrl(reference.file_url) || !isMimeType(reference.mime_type) ||
      !Number.isSafeInteger(reference.width) || reference.width <= 0 ||
      !Number.isSafeInteger(reference.height) || reference.height <= 0 ||
      !Number.isSafeInteger(reference.size) || reference.size <= 0 || reference.size > MAX_METADATA_SIZE ||
      !SHA256_PATTERN.test(reference.sha256) || !Number.isSafeInteger(reference.expires_at) ||
      reference.expires_at <= now || reference.expires_at > now + OPERATOR_TTL_MS ||
      reference.metadata_confidence !== "CONTAINER_METADATA_ONLY") fail("REFERENCE_UNAVAILABLE");
}

function readExactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (!plainRecord(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) ||
      actual.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function safeNow(clock: (() => number) | undefined): number {
  const value = clock === undefined ? Date.now() : clock();
  if (!Number.isSafeInteger(value) || value < 0) fail("REFERENCE_UNAVAILABLE");
  return value;
}

function safeSnapshotPrincipal(value: unknown): Readonly<GenerationPrincipalRef> {
  try { return snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("INVALID_REQUEST"); }
}

function isMimeType(value: unknown): value is OwnerKontextImageMimeType {
  return typeof value === "string" && CANONICAL_MIME_TYPES.includes(value as OwnerKontextImageMimeType);
}

function readSelectedDataFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainRecord(value)) fail("PROFILE_BINDING_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))];
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== expectedKeys.length || actual.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) {
    fail("PROFILE_BINDING_MISMATCH");
  }
  const result = value.map((_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) fail("PROFILE_BINDING_MISMATCH");
    return descriptor.value;
  });
  return Object.freeze(result);
}

function readString(value: unknown): string {
  if (typeof value !== "string") fail("PROFILE_BINDING_MISMATCH");
  return value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isVariant(value: unknown): value is OwnerKontextImageVariant {
  return typeof value === "string" && SOURCE_PARAMETERS.variants.includes(value as OwnerKontextImageVariant);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}

function fail(code: OwnerKontextImagePrepareErrorCode): never {
  throw new OwnerKontextImagePrepareError(code);
}
