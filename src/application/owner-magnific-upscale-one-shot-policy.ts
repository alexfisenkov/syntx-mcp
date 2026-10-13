import { isDeepStrictEqual, types } from "node:util";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { generationPrincipalKey, sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  getOwnerMagnificUpscaleSourceProfile,
  isOwnerMagnificUpscalePreparedCandidateForPrincipal,
  type OwnerMagnificUpscalePreparedCandidate
} from "./owner-magnific-upscale-request-preparer.js";
import {
  normalizeOwnerMagnificUpscaleParameters,
  OwnerMagnificUpscaleParametersError,
  type OwnerMagnificUpscaleVariant
} from "./owner-magnific-upscale-parameters.js";

const TTL_MS = 15 * 60_000;
const E551_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const E551_SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
});
const IMAGE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"] as const);
const MAX_LOCAL_IMAGE_BYTES = 10 * 1024 * 1024;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_PROMPT_UTF8_BYTES = 5_000;
const SETTINGS_KEYS = Object.freeze([
  "n", "model_type", "width", "height", "scale_factor", "optimized_for", "engine", "creativity", "hdr",
  "resemblance", "fractality", "sharpen", "smart_grain", "ultra_detail", "flavor", "file_urls"
] as const);
const PERMIT_BRAND_DESCRIPTION = "OwnerMagnificUpscaleOneShotPermit";
const permitBrand: unique symbol = Symbol(PERMIT_BRAND_DESCRIPTION);
const permitStates = new WeakMap<object, PermitState>();
const issuedForCandidate = new WeakMap<object, object>();
const candidateClockObservations = new WeakMap<object, CandidateClockObservation>();

export interface CreateOwnerMagnificUpscaleOneShotPermitInput {
  readonly candidate: OwnerMagnificUpscalePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel" | "catalog_kind" | "runtime_usable" | "fetched_at" | "source_hashes">;
  readonly now?: () => number;
}

export interface OwnerMagnificUpscaleOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "authorized";
  /** Internal authority metadata only; this policy does not activate dispatch. */
  readonly dispatch_allowed: false;
  readonly profile_id: "magnific-upscale-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly ai_name: "magnific";
  readonly public_catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly expires_at: number;
}

export interface ConsumeOwnerMagnificUpscaleOneShotPermitInput {
  readonly permit: OwnerMagnificUpscaleOneShotPermit;
  readonly candidate: OwnerMagnificUpscalePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerMagnificUpscaleOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerMagnificUpscaleOneShotPolicyErrorCode =
  | "INVALID_REQUEST"
  | "CANDIDATE_UNBOUND"
  | "CANDIDATE_EXPIRED"
  | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH"
  | "PERMIT_INVALID"
  | "PERMIT_EXPIRED"
  | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH"
  | "CANDIDATE_MISMATCH"
  | "CLOCK_INVALID";

export class OwnerMagnificUpscaleOneShotPolicyError extends Error {
  constructor(readonly code: OwnerMagnificUpscaleOneShotPolicyErrorCode) {
    super("The owner Magnific upscaler one-shot policy could not be satisfied.");
    this.name = "OwnerMagnificUpscaleOneShotPolicyError";
  }
}

interface CandidateClockObservation {
  lastObservedAt: number;
  expired: boolean;
}

interface PermitState {
  readonly permit: OwnerMagnificUpscaleOneShotPermit;
  readonly candidate: OwnerMagnificUpscalePreparedCandidate;
  readonly candidateFingerprint: string;
  readonly requestFingerprint: string;
  readonly profileSchemaHash: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly publicCatalogVersion: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly catalogVersion: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly principalKey: string;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly candidateExpiresAt: number;
  readonly now: () => number;
  lastObservedAt: number;
  consumed: boolean;
  expired: boolean;
}

/**
 * Trusted application composition after fresh owner/model/cost preflight.
 * This pure local policy does not fetch account or cost state and grants no
 * public/runtime dispatch permission.
 */
export function createOwnerMagnificUpscaleOneShotPermit(
  input: CreateOwnerMagnificUpscaleOneShotPermitInput | unknown
): OwnerMagnificUpscaleOneShotPermit {
  const fields = readExactRecord(input,
    ["candidate", "principal", "attemptId", "catalog", "now"],
    ["candidate", "principal", "attemptId", "catalog"]);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
  const attemptId = fields.attemptId;
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
  const issuedAt = readClock(now);
  const candidateInput = fields.candidate;

  // Use zero only to establish nominal identity before observing the injected
  // clock; source-issued candidate expiries are always positive epoch values.
  if (!isOwnerMagnificUpscalePreparedCandidateForPrincipal(candidateInput, principal, attemptId, 0)) fail("CANDIDATE_UNBOUND");
  const candidateRecord = readCandidateRecord(candidateInput);
  const variant = candidateRecord.variant as OwnerMagnificUpscaleVariant;
  const profile = getOwnerMagnificUpscaleSourceProfile(variant);
  const profileSchemaHash = profile.profile_schema_hash;
  const candidate = candidateInput as OwnerMagnificUpscalePreparedCandidate;
  const candidateIntent = validateCandidate(candidateRecord, candidate, principal, attemptId, profile, profileSchemaHash);
  observeCandidateClock(candidate, issuedAt, candidateIntent.expiresAt);
  if (issuedForCandidate.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");

  const publicCatalogVersion = profile.public_catalog_version;
  if (publicCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("CATALOG_BINDING_MISMATCH");
  const catalogVersion = validateCatalog(fields.catalog, variant);
  const ttlExpiry = issuedAt + TTL_MS;
  if (!Number.isSafeInteger(ttlExpiry) || ttlExpiry <= issuedAt) fail("CLOCK_INVALID");
  const expiresAt = Math.min(candidateIntent.expiresAt, ttlExpiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");

  const permit: OwnerMagnificUpscaleOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "authorized" as const,
    dispatch_allowed: false as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profileSchemaHash,
    variant,
    model_id: variant,
    ai_name: "magnific" as const,
    public_catalog_version: publicCatalogVersion,
    catalog_version: catalogVersion,
    request_fingerprint: candidateIntent.requestFingerprint,
    expires_at: expiresAt
  });
  const state: PermitState = {
    permit,
    candidate,
    candidateFingerprint: candidateIntent.candidateFingerprint,
    requestFingerprint: candidateIntent.requestFingerprint,
    profileSchemaHash,
    variant,
    publicCatalogVersion,
    catalogVersion,
    principal,
    principalKey: generationPrincipalKey(principal),
    attemptId,
    expiresAt,
    candidateExpiresAt: candidateIntent.expiresAt,
    now,
    lastObservedAt: issuedAt,
    consumed: false,
    expired: false
  };
  permitStates.set(permit, state);
  issuedForCandidate.set(candidate, permit);
  return permit;
}

/** Synchronous consume boundary immediately before one future HTTP POST. */
export function consumeOwnerMagnificUpscaleOneShotPermit(
  input: ConsumeOwnerMagnificUpscaleOneShotPermitInput | unknown
): OwnerMagnificUpscaleOneShotPermitReceipt {
  const fields = readExactRecord(input, ["permit", "candidate", "principal", "attemptId"],
    ["permit", "candidate", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId)) fail("INVALID_REQUEST");
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !isPermitBrand(permit) || !Object.isFrozen(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.expired) fail("PERMIT_EXPIRED");

  const now = readClock(state.now);
  if (now < state.lastObservedAt) {
    state.expired = true;
    latchCandidateClock(state.candidate, now, state.candidateExpiresAt, true);
    fail("CLOCK_INVALID");
  }
  state.lastObservedAt = now;
  if (now >= state.expiresAt) {
    state.expired = true;
    latchCandidateClock(state.candidate, now, state.candidateExpiresAt, now >= state.candidateExpiresAt);
    fail("PERMIT_EXPIRED");
  }
  observeCandidateClock(state.candidate, now, state.candidateExpiresAt);

  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  if (fields.attemptId !== state.attemptId || generationPrincipalKey(principal) !== state.principalKey ||
      !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate ||
      candidateFingerprintForPermit(fields.candidate, state, now) !== state.candidateFingerprint ||
      state.permit.request_fingerprint !== state.requestFingerprint ||
      state.permit.profile_schema_hash !== state.profileSchemaHash ||
      state.permit.variant !== state.variant || state.permit.model_id !== state.variant ||
      state.permit.public_catalog_version !== state.publicCatalogVersion ||
      state.permit.catalog_version !== state.catalogVersion || issuedForCandidate.get(state.candidate) !== permit) {
    fail("CANDIDATE_MISMATCH");
  }

  // The operation is synchronous: the claim becomes permanent before the
  // caller can begin any external dispatch.
  state.consumed = true;
  return Object.freeze({
    status: "consumed",
    dispatch_allowed: false,
    request_fingerprint: state.requestFingerprint
  });
}

function validateCatalog(
  input: unknown,
  variant: OwnerMagnificUpscaleVariant
): string {
  if (!input || typeof input !== "object" || types.isProxy(input) || !(input instanceof DiscoveryCatalogRepository)) {
    fail("CATALOG_BINDING_MISMATCH");
  }
  const catalog = input as CreateOwnerMagnificUpscaleOneShotPermitInput["catalog"];
  if (Object.getPrototypeOf(catalog) !== DiscoveryCatalogRepository.prototype || Object.hasOwn(catalog, "getModel") ||
      !hasDataField(catalog, "catalog_kind") || !hasDataField(catalog, "runtime_usable") ||
      !hasDataField(catalog, "fetched_at") || !hasDataField(catalog, "source_hashes") ||
      !Object.isFrozen(catalog.source_hashes) || Object.getPrototypeOf(catalog.source_hashes) !== Object.prototype) {
    fail("CATALOG_BINDING_MISMATCH");
  }
  if (catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || catalog.runtime_usable !== false ||
      catalog.fetched_at !== E551_FETCHED_AT ||
      catalog.source_hashes.ai !== E551_SOURCE_HASHES.ai ||
      catalog.source_hashes.llm_models !== E551_SOURCE_HASHES.llm_models ||
      catalog.source_hashes.models !== E551_SOURCE_HASHES.models) fail("CATALOG_BINDING_MISMATCH");
  let model: ReturnType<typeof catalog.getModel>;
  try { model = catalog.getModel(variant); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  const operation = model.operations.find((entry) => entry.id === "upscale-image");
  if (model.id !== variant || model.upstream_id !== variant || model.ai_name !== "magnific" || model.active !== true ||
      model.default !== false || model.scope !== "tool_image_upscaler" || model.runtime_usable !== false ||
      model.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || model.fetched_at !== E551_FETCHED_AT ||
      model.source_hashes.ai !== E551_SOURCE_HASHES.ai || model.source_hashes.llm_models !== E551_SOURCE_HASHES.llm_models ||
      model.source_hashes.models !== E551_SOURCE_HASHES.models || operation?.output_modality !== "image") fail("CATALOG_BINDING_MISMATCH");
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}

function hasDataField(value: object, key: string): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable === true && "value" in descriptor;
}

function validateCandidate(
  candidateRecord: Record<string, unknown>,
  candidate: OwnerMagnificUpscalePreparedCandidate,
  principal: Readonly<GenerationPrincipalRef>,
  attemptId: string,
  profile: ReturnType<typeof getOwnerMagnificUpscaleSourceProfile>,
  profileSchemaHash: string
): Readonly<{ candidateFingerprint: string; requestFingerprint: string; expiresAt: number }> {
  const variant = profile.variant;
  const query = readExactRecord(candidateRecord.query, ["ai_name"], ["ai_name"]);
  const request = readExactRecord(candidateRecord.request, ["prompt", "settings"], ["settings"]);
  const settings = readExactRecord(request.settings, SETTINGS_KEYS, SETTINGS_KEYS);
  const image = readExactRecord(candidateRecord.image,
    ["mime_type", "width", "height", "size", "sha256", "metadata_confidence"],
    ["mime_type", "width", "height", "size", "sha256", "metadata_confidence"]);
  const files = readSingleImageReference(settings.file_urls);
  const expiresAt = candidateRecord.expires_at;
  const prompt = request.prompt;
  if (prompt !== undefined && (typeof prompt !== "string" || prompt.length === 0 ||
      Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_UTF8_BYTES || PROMPT_CONTROL.test(prompt))) fail("CANDIDATE_UNBOUND");
  if (candidateRecord.status !== "blocked" || candidateRecord.dispatch_allowed !== false ||
      candidateRecord.backend_acceptance !== "UNPROVEN" || candidateRecord.profile_id !== profile.profile_id ||
      candidateRecord.profile_schema_hash !== profileSchemaHash || !isDeepStrictEqual(candidateRecord.source_binding, profile.source_binding) ||
      candidateRecord.model_id !== variant || candidateRecord.variant !== variant || candidateRecord.ai_name !== "magnific" ||
      candidateRecord.model_type !== variant || candidateRecord.operation_id !== "upscale-image" ||
      candidateRecord.modality !== "image" || candidateRecord.scope !== "tool_image_upscaler" ||
      candidateRecord.source_route !== "design/generate" || query.ai_name !== "magnific" ||
      !Number.isSafeInteger(expiresAt) || (expiresAt as number) <= 0 ||
      typeof image.mime_type !== "string" || !IMAGE_MIME_TYPES.includes(image.mime_type as typeof IMAGE_MIME_TYPES[number]) ||
      !Number.isSafeInteger(image.width) || (image.width as number) <= 0 ||
      !Number.isSafeInteger(image.height) || (image.height as number) <= 0 ||
      !Number.isSafeInteger((image.width as number) * (image.height as number)) ||
      !Number.isSafeInteger(image.size) || (image.size as number) <= 0 || (image.size as number) > MAX_LOCAL_IMAGE_BYTES ||
      typeof image.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(image.sha256) ||
      image.metadata_confidence !== "CONTAINER_METADATA_ONLY" || settings.n !== 1 || settings.model_type !== variant ||
      settings.width !== image.width || settings.height !== image.height || files.type !== "image" ||
      typeof files.url !== "string" || !isSafeUploadReferenceUrl(files.url) ||
      typeof candidateRecord.request_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(candidateRecord.request_fingerprint as string)) {
    fail("CANDIDATE_UNBOUND");
  }
  const parameters = {
    scale_factor: settings.scale_factor,
    optimized_for: settings.optimized_for,
    engine: settings.engine,
    creativity: settings.creativity,
    hdr: settings.hdr,
    resemblance: settings.resemblance,
    fractality: settings.fractality,
    sharpen: settings.sharpen,
    smart_grain: settings.smart_grain,
    ultra_detail: settings.ultra_detail,
    flavor: settings.flavor
  };
  let normalized: ReturnType<typeof normalizeOwnerMagnificUpscaleParameters>;
  try {
    normalized = normalizeOwnerMagnificUpscaleParameters({
      variant,
      parameters,
      dimensions: { width: image.width, height: image.height }
    });
  } catch (error) {
    if (error instanceof OwnerMagnificUpscaleParametersError) fail("CANDIDATE_UNBOUND");
    throw error;
  }
  if (!isDeepStrictEqual(normalized.parameters, parameters) || normalized.model_type !== settings.model_type) fail("CANDIDATE_UNBOUND");

  const requestFingerprint = schemaHash({
    profile_schema_hash: profileSchemaHash,
    principal,
    attempt_id: attemptId,
    variant,
    prompt: prompt ?? null,
    query: { ai_name: "magnific" },
    settings: request.settings,
    image: {
      mime_type: image.mime_type,
      width: image.width,
      height: image.height,
      size: image.size,
      sha256: image.sha256,
      metadata_confidence: image.metadata_confidence,
      expires_at: expiresAt
    }
  });
  if (requestFingerprint !== candidateRecord.request_fingerprint) fail("CANDIDATE_UNBOUND");
  return Object.freeze({
    candidateFingerprint: candidatePayloadFingerprint(candidate),
    requestFingerprint,
    expiresAt: expiresAt as number
  });
}

function readCandidateRecord(candidate: unknown): Record<string, unknown> {
  const allowed = ["status", "dispatch_allowed", "backend_acceptance", "profile_id", "profile_schema_hash", "source_binding",
    "model_id", "ai_name", "variant", "model_type", "operation_id", "modality", "scope", "source_route", "image",
    "expires_at", "request_fingerprint", "query", "request"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate) || !Object.isFrozen(candidate)) {
    fail("CANDIDATE_UNBOUND");
  }
  let descriptors: PropertyDescriptorMap;
  try {
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) fail("CANDIDATE_UNBOUND");
    descriptors = Object.getOwnPropertyDescriptors(candidate);
  } catch { fail("CANDIDATE_UNBOUND"); }
  const keys = Reflect.ownKeys(descriptors);
  const symbols = keys.filter((key): key is symbol => typeof key === "symbol");
  const strings = keys.filter((key): key is string => typeof key === "string");
  if (symbols.length !== 1 || symbols[0]!.description !== "OwnerMagnificUpscalePreparedCandidate" ||
      descriptors[symbols[0] as keyof typeof descriptors]?.value !== true ||
      strings.length !== allowed.length || strings.some((key) => !allowed.includes(key)) ||
      strings.some((key) => !descriptors[key]?.enumerable || !("value" in descriptors[key]!))) fail("CANDIDATE_UNBOUND");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of strings) result[key] = descriptors[key]!.value;
  return result;
}

function observeCandidateClock(candidate: object, now: number, expiresAt: number): void {
  let observation = candidateClockObservations.get(candidate);
  if (observation?.expired) fail("CANDIDATE_EXPIRED");
  if (observation && now < observation.lastObservedAt) {
    observation.expired = true;
    fail("CLOCK_INVALID");
  }
  if (now >= expiresAt) {
    observation ??= { lastObservedAt: now, expired: true };
    observation.lastObservedAt = now;
    observation.expired = true;
    candidateClockObservations.set(candidate, observation);
    fail("CANDIDATE_EXPIRED");
  }
  observation ??= { lastObservedAt: now, expired: false };
  observation.lastObservedAt = now;
  candidateClockObservations.set(candidate, observation);
}

function latchCandidateClock(candidate: object, now: number, expiresAt: number, expired: boolean): void {
  const observation = candidateClockObservations.get(candidate) ?? { lastObservedAt: now, expired: false };
  observation.lastObservedAt = Math.max(observation.lastObservedAt, now);
  observation.expired ||= expired;
  candidateClockObservations.set(candidate, observation);
  if (now >= expiresAt) observation.expired = true;
}

function candidateFingerprintForPermit(value: unknown, state: PermitState, now: number): string {
  if (value !== state.candidate || !isOwnerMagnificUpscalePreparedCandidateForPrincipal(value, state.principal, state.attemptId, now)) {
    fail("CANDIDATE_MISMATCH");
  }
  return candidatePayloadFingerprint(value);
}

function candidatePayloadFingerprint(value: unknown): string {
  try { return schemaHash(value); }
  catch { fail("CANDIDATE_UNBOUND"); }
}

function readSingleImageReference(value: unknown): Readonly<{ type: string; url: string }> {
  if (!Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value) || value.length !== 1) fail("CANDIDATE_UNBOUND");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (keys.length !== 2 || !Object.hasOwn(descriptors, "0") || !Object.hasOwn(descriptors, "length") ||
      !("value" in descriptors["0"]!) || !descriptors["0"]!.enumerable || lengthDescriptor?.value !== 1) fail("CANDIDATE_UNBOUND");
  const item = descriptors["0"]!.value;
  if (!item || typeof item !== "object" || types.isProxy(item) || !Object.isFrozen(item)) fail("CANDIDATE_UNBOUND");
  const fields = readExactRecord(item, ["type", "url"], ["type", "url"]);
  if (fields.type !== "image" || typeof fields.url !== "string") fail("CANDIDATE_UNBOUND");
  return Object.freeze({ type: fields.type, url: fields.url });
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function readClock(now: () => number): number {
  let value: number;
  try { value = now(); }
  catch { fail("CLOCK_INVALID"); }
  if (!Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}

function isPermitBrand(value: object): value is OwnerMagnificUpscaleOneShotPermit {
  if (types.isProxy(value) || !Object.isFrozen(value)) return false;
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return false; }
  const keys = Reflect.ownKeys(descriptors);
  const strings = keys.filter((key): key is string => typeof key === "string");
  const symbols = keys.filter((key): key is symbol => typeof key === "symbol");
  const expected = ["status", "dispatch_allowed", "profile_id", "profile_schema_hash", "variant", "model_id", "ai_name",
    "public_catalog_version", "catalog_version", "request_fingerprint", "expires_at"];
  return strings.length === expected.length && expected.every((key) => Object.hasOwn(descriptors, key)) &&
    strings.every((key) => expected.includes(key)) && symbols.length === 1 && symbols[0] === permitBrand &&
    keys.every((key) => "value" in descriptors[key as keyof typeof descriptors]!) &&
    descriptors[permitBrand]?.value === true && descriptors.status?.value === "authorized" &&
    descriptors.dispatch_allowed?.value === false;
}

function readExactRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) || required.some((key) => !Object.hasOwn(descriptors, key))) {
      fail("INVALID_REQUEST");
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch (error) {
    if (error instanceof OwnerMagnificUpscaleOneShotPolicyError) throw error;
    fail("INVALID_REQUEST");
  }
}

function fail(code: OwnerMagnificUpscaleOneShotPolicyErrorCode): never {
  throw new OwnerMagnificUpscaleOneShotPolicyError(code);
}
