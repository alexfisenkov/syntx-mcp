import { isProxy } from "node:util/types";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  normalizeOwnerSeedreamImageParameters,
  OWNER_SEEDREAM_IMAGE_VARIANTS,
  type OwnerSeedreamImageParameters,
  type OwnerSeedreamImageRatio,
  type OwnerSeedreamImageResolution,
  type OwnerSeedreamImageVariant
} from "./owner-seedream-image-parameters.js";
import {
  getOwnerSeedreamImageSourceProfile,
  type OwnerSeedreamImageCatalogPort,
  type OwnerSeedreamImageSourceProfile
} from "./owner-seedream-image-source-profile.js";
import {
  snapshotOwnerSeedreamSourceAlphaWitness,
  type OwnerSeedreamSourceAlphaWitness
} from "./owner-seedream-source-alpha-witness.js";

const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_ACTIVE_SETS = 128;
const MAX_PROMPT_BYTES = 65_536;
const PROMPT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^seedream_image_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerSeedreamImageOwnedReferenceResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly model_id: OwnerSeedreamImageVariant;
  readonly ai_name: "seedream";
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
}

export interface OwnerSeedreamImageOwnedReferenceResolution extends OwnerSeedreamImageOwnedReferenceResolverContext {
  readonly file_url: string;
  readonly source_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly source_alpha_witness: OwnerSeedreamSourceAlphaWitness | null;
}

export type ResolveOwnerSeedreamImageOwnedReference = (
  context: Readonly<OwnerSeedreamImageOwnedReferenceResolverContext>
) => Promise<OwnerSeedreamImageOwnedReferenceResolution>;

const setBrand: unique symbol = Symbol("OwnerSeedreamImageOwnedReferenceSet");
export interface OwnerSeedreamImageOwnedReferenceSet {
  readonly [setBrand]: true;
  readonly variant: OwnerSeedreamImageVariant;
  readonly reference_count: number;
  readonly expires_at: number;
}

export interface OwnerSeedreamImageReferenceBindingIssuerOptions {
  readonly catalog: OwnerSeedreamImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}
export interface OwnerSeedreamImageReferenceBindingIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly reference_handles: readonly string[];
}
export interface OwnerSeedreamImageReferenceBindingIssuer {
  issue(input: OwnerSeedreamImageReferenceBindingIssueInput | unknown): Promise<OwnerSeedreamImageOwnedReferenceSet>;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}

interface AlphaSummary {
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly source_sample_width: number;
  readonly source_sample_height: number;
  readonly source_alpha_eligible: boolean;
  readonly confidence_scope: string;
}
interface OwnedReference extends OwnerSeedreamImageOwnedReferenceResolution {
  readonly alpha_summary: AlphaSummary | null;
}
interface SetState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly profile: Readonly<OwnerSeedreamImageSourceProfile>;
  readonly references: readonly OwnedReference[];
  readonly issued_at: number;
  readonly expires_at: number;
}
const setStates = new WeakMap<object, Readonly<SetState>>();
const revokedSets = new WeakSet<object>();

export interface OwnerSeedreamImageInputReferenceMetadata {
  readonly source_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly source_alpha: Readonly<Pick<AlphaSummary, "source_sample_width" | "source_sample_height" | "source_alpha_eligible" | "confidence_scope">> | null;
}

export interface OwnerSeedreamImageRequestSettings {
  readonly n: 1;
  readonly stream: false;
  readonly model_type: OwnerSeedreamImageVariant;
  readonly aspect_ratio: OwnerSeedreamImageRatio;
  readonly resolution: OwnerSeedreamImageResolution;
  readonly output_format?: "jpeg" | "png";
  readonly background?: "opaque" | "transparent";
  readonly file_urls: readonly Readonly<{ type: "image"; url: string }>[];
}
export interface OwnerSeedreamImageRequestBody {
  readonly prompt: string;
  readonly settings: Readonly<OwnerSeedreamImageRequestSettings>;
}

export interface OwnerSeedreamImagePreparedCandidate {
  readonly status: "blocked";
  readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly model_id: OwnerSeedreamImageVariant;
  readonly ai_name: "seedream";
  readonly variant: OwnerSeedreamImageVariant;
  readonly model_type: OwnerSeedreamImageVariant;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly prompt: string;
  readonly prompt_local_max_utf8_bytes: 65_536;
  readonly prompt_limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
  readonly parameters: Readonly<OwnerSeedreamImageParameters>;
  readonly reference_count: number;
  readonly references: readonly OwnerSeedreamImageInputReferenceMetadata[];
  readonly transparency_eligibility: Readonly<{
    source_alpha_eligible: boolean;
    owned_png_reference_count: number;
    sampled_source_dimensions: readonly Readonly<{ width: number; height: number }>[];
    confidence_scope: string | null;
    browser_geometry_proven: false;
  }>;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly cost_input_confidence: string;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly request: Readonly<OwnerSeedreamImageRequestBody>;
}

export interface PrepareOwnerSeedreamImageRequestInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly parameters: unknown;
  readonly reference_set: OwnerSeedreamImageOwnedReferenceSet;
  readonly prompt: string;
}
export interface PrepareOwnerSeedreamImageRequestOptions extends OwnerSeedreamImageReferenceBindingIssuerOptions {}
interface CandidateState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly reference_set: object;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  last_now: number;
  expired: boolean;
}
const candidates = new WeakMap<object, CandidateState>();

export type OwnerSeedreamImagePrepareErrorCode = "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_MISMATCH"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "PARAMETERS_INVALID" | "PROMPT_INVALID" | "CANDIDATE_INVALID" | "CLOCK_INVALID";
export class OwnerSeedreamImagePrepareError extends Error {
  constructor(readonly code: OwnerSeedreamImagePrepareErrorCode) {
    super("The owner Seedream image candidate could not be prepared safely.");
    this.name = "OwnerSeedreamImagePrepareError";
  }
}

/** Resolves opaque owner handles once, snapshots private URLs, and applies the original 15 minute TTL. */
export function createOwnerSeedreamImageOwnedReferenceBindingIssuer(
  resolve: ResolveOwnerSeedreamImageOwnedReference,
  optionsInput: OwnerSeedreamImageReferenceBindingIssuerOptions | unknown
): OwnerSeedreamImageReferenceBindingIssuer {
  if (typeof resolve !== "function" || isProxy(resolve)) fail("INVALID_REQUEST");
  const options = snapshotOptions(optionsInput);
  let closed = false;
  let pending = 0;
  const pendingByAttempt = new Map<string, number>();
  const epochs = new Map<string, number>();
  const active = new Map<object, Readonly<SetState>>();
  const byAttempt = new Map<string, Set<object>>();

  const dropSet = (set: object): void => {
    active.delete(set);
    const state = setStates.get(set);
    if (!state) return;
    const bucket = byAttempt.get(state.attempt_id);
    bucket?.delete(set);
    if (bucket?.size === 0) byAttempt.delete(state.attempt_id);
  };
  const prune = (now: number): void => {
    for (const [set, state] of active) if (revokedSets.has(set) || state.expires_at <= now) dropSet(set);
  };
  const finishPending = (attemptId: string): void => {
    pending -= 1;
    const next = (pendingByAttempt.get(attemptId) ?? 1) - 1;
    if (next <= 0) pendingByAttempt.delete(attemptId);
    else pendingByAttempt.set(attemptId, next);
    if (next <= 0 && !byAttempt.has(attemptId)) epochs.delete(attemptId);
  };

  return Object.freeze({
    async issue(input: OwnerSeedreamImageReferenceBindingIssueInput | unknown): Promise<OwnerSeedreamImageOwnedReferenceSet> {
      if (closed || pending >= MAX_PENDING) fail("REFERENCE_UNAVAILABLE");
      const req = exact(input, ["principal", "attempt_id", "variant", "reference_handles"]);
      const attemptId = req.attempt_id;
      const principal = snapshotPrincipal(req.principal, attemptId);
      if (!isVariant(req.variant)) fail("INVALID_REQUEST");
      const handles = snapshotHandles(req.reference_handles, maximumReferences(req.variant));
      const profile = profileFor(req.variant, options);
      const now = safeNow(options.now);
      if (now > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CLOCK_INVALID");
      prune(now);
      if (active.size >= MAX_ACTIVE_SETS) fail("REFERENCE_UNAVAILABLE");
      const epoch = epochs.get(attemptId as string) ?? 0;
      const expiresAt = now + TTL_MS;
      pending += 1;
      pendingByAttempt.set(attemptId as string, (pendingByAttempt.get(attemptId as string) ?? 0) + 1);
      try {
        const references: OwnedReference[] = [];
        for (const handle of handles) {
          const context = Object.freeze({ principal, attempt_id: attemptId as string, variant: req.variant as OwnerSeedreamImageVariant,
            model_id: profile.model_id, ai_name: profile.ai_name, scope: "image" as const, operation_id: "generate-image" as const,
            catalog_version: profile.public_catalog_version, profile_schema_hash: profile.profile_schema_hash, reference_handle: handle });
          let raw: unknown;
          try { raw = await resolve(context); } catch { fail("REFERENCE_UNAVAILABLE"); }
          if (closed || (epochs.get(attemptId as string) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
          const reference = snapshotResolution(raw);
          const alpha = validateResolution(reference, context, profile, now);
          if (references.some((prior) => prior.file_url === reference.file_url || prior.sha256 === reference.sha256)) fail("REFERENCE_UNAVAILABLE");
          references.push(Object.freeze({ ...reference, alpha_summary: alpha }));
        }
        if (closed || (epochs.get(attemptId as string) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
        const laterNow = safeNow(options.now);
        const effectiveExpiry = references.length ? Math.min(expiresAt, ...references.map((reference) => reference.expires_at)) : expiresAt;
        if (laterNow < now) fail("CLOCK_INVALID");
        if (effectiveExpiry <= laterNow) fail("REFERENCE_EXPIRED");
        if (active.size >= MAX_ACTIVE_SETS) { prune(laterNow); if (active.size >= MAX_ACTIVE_SETS) fail("REFERENCE_UNAVAILABLE"); }
        const set = Object.create(null) as OwnerSeedreamImageOwnedReferenceSet;
        Object.defineProperties(set, {
          [setBrand]: { value: true }, variant: { value: req.variant }, reference_count: { value: references.length }, expires_at: { value: effectiveExpiry }
        });
        Object.freeze(set);
        const state = Object.freeze({ principal, attempt_id: attemptId as string, variant: req.variant as OwnerSeedreamImageVariant,
          profile, references: Object.freeze(references), issued_at: now, expires_at: effectiveExpiry });
        setStates.set(set, state);
        active.set(set, state);
        const bucket = byAttempt.get(attemptId as string) ?? new Set<object>();
        bucket.add(set);
        byAttempt.set(attemptId as string, bucket);
        return set;
      } finally { finishPending(attemptId as string); }
    },
    invalidateAttempt(attemptId: string): void {
      if (!ATTEMPT.test(attemptId)) return;
      epochs.set(attemptId, (epochs.get(attemptId) ?? 0) + 1);
      for (const set of byAttempt.get(attemptId) ?? []) { revokedSets.add(set); dropSet(set); }
      byAttempt.delete(attemptId);
      if (!pendingByAttempt.has(attemptId)) epochs.delete(attemptId);
    },
    close(): void {
      if (closed) return;
      closed = true;
      for (const set of active.keys()) revokedSets.add(set);
      active.clear(); byAttempt.clear(); epochs.clear();
    }
  });
}

/** Prepares the complete current-source request. Transparent Flash is admitted only through a nominal 622 PNG witness. */
export function prepareOwnerSeedreamImageRequest(
  input: PrepareOwnerSeedreamImageRequestInput | unknown,
  optionsInput: PrepareOwnerSeedreamImageRequestOptions | unknown
): OwnerSeedreamImagePreparedCandidate {
  const req = exact(input, ["principal", "attempt_id", "variant", "parameters", "reference_set", "prompt"]);
  const options = snapshotOptions(optionsInput);
  const principal = snapshotPrincipal(req.principal, req.attempt_id);
  if (!isVariant(req.variant)) fail("INVALID_REQUEST");
  const profile = profileFor(req.variant, options);
  const set = req.reference_set;
  if (!set || typeof set !== "object" || Array.isArray(set) || isProxy(set) || !Object.isFrozen(set)) fail("REFERENCE_UNAVAILABLE");
  const state = setStates.get(set as object);
  if (!state || revokedSets.has(set as object) || state.attempt_id !== req.attempt_id || state.variant !== req.variant ||
      state.profile.profile_schema_hash !== profile.profile_schema_hash || !sameGenerationPrincipal(state.principal, principal)) fail("REFERENCE_UNAVAILABLE");
  const now = safeNow(options.now);
  if (now < state.issued_at) fail("CLOCK_INVALID");
  if (state.expires_at <= now) fail("REFERENCE_EXPIRED");
  const prompt = validatePrompt(req.prompt);
  let normalized: ReturnType<typeof normalizeOwnerSeedreamImageParameters>;
  try {
    const parameters = exact(req.parameters, ["aspect_ratio", "resolution", "output_format", "background"]);
    const transparent = parameters.background === "transparent";
    let transparency_context: { reference_count: 1; source_mime_types: readonly ["image/png"]; pixel_alpha_eligible: true } | undefined;
    if (transparent) {
      if (req.variant !== "seedream-5.0-flash" || state.references.length !== 1) fail("PARAMETERS_INVALID");
      const reference = state.references[0]!;
      const alpha = reference.alpha_summary;
      if (reference.source_mime_type !== "image/png" || reference.mime_type !== "image/png" || !alpha?.source_alpha_eligible ||
          alpha.sha256 !== reference.sha256 || alpha.width !== reference.width || alpha.height !== reference.height) fail("PARAMETERS_INVALID");
      transparency_context = { reference_count: 1, source_mime_types: ["image/png"], pixel_alpha_eligible: true };
    }
    normalized = normalizeOwnerSeedreamImageParameters({ variant: req.variant, reference_count: state.references.length,
      parameters, ...(transparency_context ? { transparency_context } : {}) });
  } catch { fail("PARAMETERS_INVALID"); }

  const wire: Record<string, unknown> = { n: 1, stream: false, model_type: req.variant,
    aspect_ratio: normalized.parameters.aspect_ratio, resolution: normalized.parameters.resolution };
  if (req.variant === "seedream-5.0-flash") {
    wire.output_format = normalized.parameters.output_format;
    wire.background = normalized.parameters.background;
  }
  wire.file_urls = state.references.map((reference) => ({ type: "image" as const, url: reference.file_url }));
  const body = deepFreeze({ prompt, settings: wire as unknown as OwnerSeedreamImageRequestSettings });
  const references = deepFreeze(state.references.map((reference) => ({ source_mime_type: reference.source_mime_type, mime_type: reference.mime_type,
    width: reference.width, height: reference.height, size: reference.size, sha256: reference.sha256,
    metadata_confidence: reference.metadata_confidence, source_alpha: reference.alpha_summary ? {
      source_sample_width: reference.alpha_summary.source_sample_width, source_sample_height: reference.alpha_summary.source_sample_height,
      source_alpha_eligible: reference.alpha_summary.source_alpha_eligible, confidence_scope: reference.alpha_summary.confidence_scope
    } : null })));
  const requestFingerprint = schemaHash({ principal, attempt_id: req.attempt_id, profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash, variant: req.variant, parameters: normalized.parameters, prompt,
    references: state.references.map((reference) => ({ reference_handle: reference.reference_handle, file_url: reference.file_url,
      source_mime_type: reference.source_mime_type, mime_type: reference.mime_type, width: reference.width, height: reference.height,
      size: reference.size, sha256: reference.sha256, expires_at: reference.expires_at })) });
  const intentFingerprint = schemaHash({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
    profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash, variant: req.variant,
    parameters: normalized.parameters, prompt, references: state.references.map((reference) => ({ source_mime_type: reference.source_mime_type,
      mime_type: reference.mime_type, size: reference.size, sha256: reference.sha256 })) });
  const alphaSummaries = state.references.map((reference) => reference.alpha_summary).filter((alpha): alpha is AlphaSummary => alpha !== null);
  const candidateData: Record<string, unknown> = {
    status: "blocked", source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT", dispatch_allowed: false,
    backend_acceptance: "UNPROVEN", profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
    source_binding: profile.source_binding, model_id: profile.model_id, ai_name: profile.ai_name, variant: req.variant, model_type: profile.model_type,
    scope: "image", operation_id: "generate-image", prompt, prompt_local_max_utf8_bytes: MAX_PROMPT_BYTES,
    prompt_limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT", parameters: normalized.parameters, reference_count: state.references.length,
    references, transparency_eligibility: {
      source_alpha_eligible: alphaSummaries.some((alpha) => alpha.source_alpha_eligible), owned_png_reference_count: state.references.filter((reference) => reference.source_mime_type === "image/png").length,
      sampled_source_dimensions: alphaSummaries.map((alpha) => ({ width: alpha.source_sample_width, height: alpha.source_sample_height })),
      confidence_scope: alphaSummaries[0]?.confidence_scope ?? null, browser_geometry_proven: false
    }, cost_inputs: normalized.cost_inputs,
    cost_input_confidence: profile.cost_policy.confidence, expires_at: state.expires_at,
    request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint
  };
  Object.defineProperty(candidateData, "request", { value: body, enumerable: false, writable: false, configurable: false });
  const candidate = deepFreeze(candidateData) as unknown as OwnerSeedreamImagePreparedCandidate;
  candidates.set(candidate, { principal, attempt_id: req.attempt_id as string, reference_set: set as object,
    expires_at: state.expires_at, request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint, last_now: now, expired: false });
  return candidate;
}

export function isOwnerSeedreamImagePreparedCandidateForPrincipal(
  candidate: unknown, principalInput: unknown, attemptId: unknown, nowInput = Date.now()
): candidate is OwnerSeedreamImagePreparedCandidate {
  if (!candidate || typeof candidate !== "object" || isProxy(candidate) || !Object.isFrozen(candidate) || typeof attemptId !== "string" || !Number.isSafeInteger(nowInput)) return false;
  const state = candidates.get(candidate);
  if (!state || state.attempt_id !== attemptId || state.expires_at <= nowInput || state.expired || revokedSets.has(state.reference_set)) return false;
  try { return sameGenerationPrincipal(state.principal, snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef)); } catch { return false; }
}

export function observeOwnerSeedreamImageCandidateClock(candidate: OwnerSeedreamImagePreparedCandidate, now: number): boolean {
  const state = candidates.get(candidate);
  if (!state || !Number.isSafeInteger(now) || now < state.last_now || now >= state.expires_at || state.expired || revokedSets.has(state.reference_set)) {
    if (state) state.expired = true;
    return false;
  }
  state.last_now = now;
  return true;
}

export function getOwnerSeedreamImagePreparedCandidateState(candidate: OwnerSeedreamImagePreparedCandidate): Readonly<{
  principal: Readonly<GenerationPrincipalRef>; attempt_id: string; expires_at: number; request_fingerprint: string; intent_fingerprint: string;
}> | null {
  const state = candidates.get(candidate);
  return state ? Object.freeze({ principal: state.principal, attempt_id: state.attempt_id, expires_at: state.expires_at,
    request_fingerprint: state.request_fingerprint, intent_fingerprint: state.intent_fingerprint }) : null;
}

interface ResolverRecord extends OwnerSeedreamImageOwnedReferenceResolverContext {
  file_url: string; source_mime_type: string; mime_type: string; width: number; height: number; size: number; sha256: string;
  expires_at: number; metadata_confidence: "CONTAINER_METADATA_ONLY"; source_alpha_witness: OwnerSeedreamSourceAlphaWitness | null;
}
function snapshotResolution(value: unknown): ResolverRecord {
  const fields = exact(value, ["principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "operation_id", "catalog_version",
    "profile_schema_hash", "reference_handle", "file_url", "source_mime_type", "mime_type", "width", "height", "size", "sha256",
    "expires_at", "metadata_confidence", "source_alpha_witness"]);
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("REFERENCE_UNAVAILABLE"); }
  return Object.freeze({ ...fields, principal }) as unknown as ResolverRecord;
}

function validateResolution(
  reference: ResolverRecord,
  context: Readonly<OwnerSeedreamImageOwnedReferenceResolverContext>,
  profile: Readonly<OwnerSeedreamImageSourceProfile>,
  now: number
): AlphaSummary | null {
  if (!sameGenerationPrincipal(reference.principal, context.principal) || reference.attempt_id !== context.attempt_id ||
      reference.variant !== context.variant || reference.model_id !== context.model_id || reference.ai_name !== context.ai_name ||
      reference.scope !== context.scope || reference.operation_id !== context.operation_id || reference.catalog_version !== context.catalog_version ||
      reference.profile_schema_hash !== context.profile_schema_hash || reference.reference_handle !== context.reference_handle ||
      typeof reference.file_url !== "string" || !isSafeUploadReferenceUrl(reference.file_url) ||
      !profile.mime_policy.accepted_file_types.includes(reference.source_mime_type) || !Number.isSafeInteger(reference.size) || reference.size <= 0 ||
      reference.size > profile.input_policy.image_max_file_bytes || reference.size > profile.input_policy.generic_max_file_bytes ||
      !SHA256.test(reference.sha256) || !Number.isSafeInteger(reference.width) || reference.width <= 0 ||
      !Number.isSafeInteger(reference.height) || reference.height <= 0 || reference.metadata_confidence !== "CONTAINER_METADATA_ONLY" ||
      !Number.isSafeInteger(reference.expires_at) || reference.expires_at <= now) fail("REFERENCE_UNAVAILABLE");
  const canonical = reference.source_mime_type === "image/jpg" ? "image/jpeg" : reference.source_mime_type;
  if (reference.mime_type !== canonical) fail("REFERENCE_UNAVAILABLE");
  const policy = profile.input_policy;
  if (policy.max_image_width !== null && (reference.width > policy.max_image_width || reference.height > policy.max_image_height! ||
      reference.width < policy.min_image_width! || reference.height < policy.min_image_height! ||
      reference.width * reference.height < policy.min_image_pixel_count! || reference.width * reference.height > policy.max_image_pixel_count!)) fail("REFERENCE_UNAVAILABLE");
  if (policy.max_image_dimension !== null && (reference.width > policy.max_image_dimension || reference.height > policy.max_image_dimension)) fail("REFERENCE_UNAVAILABLE");
  const aspectRatio = reference.width / reference.height;
  if ((policy.min_image_aspect_ratio !== null && aspectRatio < policy.min_image_aspect_ratio) ||
      (policy.max_image_aspect_ratio !== null && aspectRatio > policy.max_image_aspect_ratio)) fail("REFERENCE_UNAVAILABLE");
  const hasWitness = reference.source_alpha_witness !== null;
  if (reference.source_mime_type !== "image/png" && hasWitness) fail("REFERENCE_UNAVAILABLE");
  if (!hasWitness) return null;
  if (!reference.source_alpha_witness || typeof reference.source_alpha_witness !== "object" || isProxy(reference.source_alpha_witness)) fail("REFERENCE_UNAVAILABLE");
  try {
    const summary = snapshotOwnerSeedreamSourceAlphaWitness(reference.source_alpha_witness as OwnerSeedreamSourceAlphaWitness, {
      sha256: reference.sha256, width: reference.width, height: reference.height
    });
    return Object.freeze({ sha256: summary.sha256, width: summary.width, height: summary.height,
      source_sample_width: summary.source_sample_width, source_sample_height: summary.source_sample_height,
      source_alpha_eligible: summary.source_alpha_eligible, confidence_scope: summary.confidence_scope });
  } catch { fail("REFERENCE_UNAVAILABLE"); }
}

function profileFor(variant: unknown, options: Readonly<OwnerSeedreamImageReferenceBindingIssuerOptions & { now: () => number }>): Readonly<OwnerSeedreamImageSourceProfile> {
  try { return getOwnerSeedreamImageSourceProfile(variant, options.catalog, options.catalog_version); }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
}
function snapshotOptions(value: unknown): Readonly<OwnerSeedreamImageReferenceBindingIssuerOptions & { now: () => number }> {
  const fields = exact(value, ["catalog", "catalog_version", "now"], ["catalog", "catalog_version"]);
  if (!fields.catalog || typeof fields.catalog !== "object" || typeof fields.catalog_version !== "string" ||
      (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now)))) fail("INVALID_REQUEST");
  return Object.freeze({ catalog: fields.catalog as OwnerSeedreamImageCatalogPort, catalog_version: fields.catalog_version,
    now: (fields.now as (() => number) | undefined) ?? Date.now });
}
function snapshotPrincipal(value: unknown, attemptId: unknown): Readonly<GenerationPrincipalRef> {
  if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function snapshotHandles(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || (length as number) > maximum || Reflect.ownKeys(descriptors).length !== (length as number) + 1) fail("INVALID_REQUEST");
  const result: string[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" || !HANDLE.test(descriptor.value)) fail("INVALID_REQUEST");
    result.push(descriptor.value);
  }
  if (new Set(result).size !== result.length) fail("INVALID_REQUEST");
  return result;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.length > required.length + optional.length ||
      keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function validatePrompt(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_PROMPT_BYTES || PROMPT_CONTROLS.test(value)) fail("PROMPT_INVALID");
  return value;
}
function maximumReferences(variant: OwnerSeedreamImageVariant): number { return variant === "seedream-4" || variant === "seedream-4.5" ? 4 : variant === "seedream-5" ? 14 : 10; }
function isVariant(value: unknown): value is OwnerSeedreamImageVariant { return typeof value === "string" && OWNER_SEEDREAM_IMAGE_VARIANTS.includes(value as OwnerSeedreamImageVariant); }
function safeNow(now: () => number): number {
  let value: unknown;
  try { value = now(); } catch { fail("CLOCK_INVALID"); }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value) as DeepReadonly<T>;
}
function fail(code: OwnerSeedreamImagePrepareErrorCode): never { throw new OwnerSeedreamImagePrepareError(code); }
