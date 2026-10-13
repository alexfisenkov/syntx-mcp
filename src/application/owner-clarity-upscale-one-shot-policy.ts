import { isDeepStrictEqual, types } from "node:util";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { generationPrincipalKey, sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  getOwnerClarityUpscaleSourceProfile,
  isOwnerClarityUpscalePreparedCandidateForPrincipal,
  type OwnerClarityUpscalePreparedCandidate
} from "./owner-clarity-upscale-request-preparer.js";

const TTL_MS = 15 * 60_000;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PERMIT_BRAND_DESCRIPTION = "OwnerClarityUpscaleOneShotPermit";
const E551_FETCHED_AT = "2026-10-08T13:18:39.393Z";
const E551_SOURCE_HASHES = Object.freeze({
  ai: "sha256:ad66f71c5ace9bb2c2670eb3ccddfbd013882928b398a100d0c757cd2895d609",
  llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
  models: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444"
});

const permitBrand: unique symbol = Symbol(PERMIT_BRAND_DESCRIPTION);
const permitStates = new WeakMap<object, PermitState>();

export interface CreateOwnerClarityUpscaleOneShotPermitInput {
  readonly candidate: OwnerClarityUpscalePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel" | "catalog_kind" | "runtime_usable" | "fetched_at" | "source_hashes">;
  /** Test seam; production callers use the monotonic wall-clock default. */
  readonly now?: () => number;
}

export interface OwnerClarityUpscaleOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "authorized";
  /** Authority metadata is explicitly not itself a provider dispatch permission. */
  readonly dispatch_allowed: false;
  readonly profile_id: "clarity-upscale-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly public_catalog_version: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly expires_at: number;
}

export interface ConsumeOwnerClarityUpscaleOneShotPermitInput {
  readonly permit: OwnerClarityUpscaleOneShotPermit;
  readonly candidate: OwnerClarityUpscalePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerClarityUpscaleOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerClarityUpscaleOneShotPolicyErrorCode =
  | "INVALID_REQUEST"
  | "CANDIDATE_UNBOUND"
  | "CATALOG_BINDING_MISMATCH"
  | "PERMIT_INVALID"
  | "PERMIT_EXPIRED"
  | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH"
  | "CANDIDATE_MISMATCH"
  | "CLOCK_INVALID";

export class OwnerClarityUpscaleOneShotPolicyError extends Error {
  constructor(readonly code: OwnerClarityUpscaleOneShotPolicyErrorCode) {
    super("The owner Clarity upscaler one-shot policy could not be satisfied.");
    this.name = "OwnerClarityUpscaleOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerClarityUpscaleOneShotPermit;
  readonly candidate: OwnerClarityUpscalePreparedCandidate;
  readonly candidateFingerprint: string;
  readonly requestFingerprint: string;
  readonly profileSchemaHash: string;
  readonly publicCatalogVersion: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly catalogVersion: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly principalKey: string;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly now: () => number;
  lastObservedAt: number;
  consumed: boolean;
  expired: boolean;
}

/**
 * Trusted application composition only. Call after fresh owner/model/cost
 * preflight; this factory does not fetch or assert any account/cost state.
 */
export function createOwnerClarityUpscaleOneShotPermit(
  input: CreateOwnerClarityUpscaleOneShotPermitInput | unknown
): OwnerClarityUpscaleOneShotPermit {
  const fields = readExactRecord(input,
    ["candidate", "principal", "attemptId", "catalog", "now"],
    ["candidate", "principal", "attemptId", "catalog"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
  const attemptId = fields.attemptId;
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
  const issuedAt = readClock(now);
  const profile = getOwnerClarityUpscaleSourceProfile();
  if (profile.source_binding.public_catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("CATALOG_BINDING_MISMATCH");
  const profileSchemaHash = schemaHash(profile);
  const catalogVersion = validateCatalog(fields.catalog, profile.source_binding.public_models_sha256);
  const candidateValue = fields.candidate;
  const candidateFingerprint = validateCandidate(candidateValue, principal, attemptId, profile, profileSchemaHash);
  const candidate = candidateValue as OwnerClarityUpscalePreparedCandidate;
  const requestFingerprint = candidate.request_fingerprint;
  const expiresAt = issuedAt + TTL_MS;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CLOCK_INVALID");

  const permit: OwnerClarityUpscaleOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "authorized" as const,
    dispatch_allowed: false as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profileSchemaHash,
    public_catalog_version: profile.source_binding.public_catalog_version,
    catalog_version: catalogVersion,
    request_fingerprint: requestFingerprint,
    expires_at: expiresAt
  });
  permitStates.set(permit, {
    permit,
    candidate,
    candidateFingerprint,
    requestFingerprint,
    profileSchemaHash,
    publicCatalogVersion: profile.source_binding.public_catalog_version,
    catalogVersion,
    principal,
    principalKey: generationPrincipalKey(principal),
    attemptId,
    expiresAt,
    now,
    lastObservedAt: issuedAt,
    consumed: false,
    expired: false
  });
  return permit;
}

/** Consume synchronously before a single future HTTP POST; no await or I/O here. */
export function consumeOwnerClarityUpscaleOneShotPermit(
  input: ConsumeOwnerClarityUpscaleOneShotPermitInput | unknown
): OwnerClarityUpscaleOneShotPermitReceipt {
  const fields = readExactRecord(input, ["permit", "candidate", "principal", "attemptId"],
    ["permit", "candidate", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId)) fail("INVALID_REQUEST");
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !isPermitBrand(permit) || !Object.isFrozen(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.expired) fail("PERMIT_EXPIRED");

  const now = readClock(state.now);
  if (now < state.lastObservedAt) {
    state.expired = true;
    fail("CLOCK_INVALID");
  }
  state.lastObservedAt = now;
  if (now >= state.expiresAt) {
    state.expired = true;
    fail("PERMIT_EXPIRED");
  }

  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  if (fields.attemptId !== state.attemptId || generationPrincipalKey(principal) !== state.principalKey ||
      !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate ||
      candidateFingerprintForPermit(fields.candidate, state) !== state.candidateFingerprint ||
      state.permit.request_fingerprint !== state.requestFingerprint ||
      state.permit.profile_schema_hash !== state.profileSchemaHash ||
      state.permit.public_catalog_version !== state.publicCatalogVersion ||
      state.permit.catalog_version !== state.catalogVersion) fail("CANDIDATE_MISMATCH");

  // JavaScript runs this check-and-set atomically because the function never awaits.
  state.consumed = true;
  return Object.freeze({
    status: "consumed",
    dispatch_allowed: false,
    request_fingerprint: state.requestFingerprint
  });
}

function validateCatalog(
  input: unknown,
  expectedModelsHash: string
): string {
  if (!input || typeof input !== "object" || types.isProxy(input) || !(input instanceof DiscoveryCatalogRepository)) {
    fail("CATALOG_BINDING_MISMATCH");
  }
  const catalog = input as CreateOwnerClarityUpscaleOneShotPermitInput["catalog"];
  if (catalog.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || catalog.runtime_usable !== false ||
      catalog.fetched_at !== E551_FETCHED_AT ||
      catalog.source_hashes.ai !== E551_SOURCE_HASHES.ai ||
      catalog.source_hashes.llm_models !== E551_SOURCE_HASHES.llm_models ||
      catalog.source_hashes.models !== expectedModelsHash ||
      expectedModelsHash !== E551_SOURCE_HASHES.models) fail("CATALOG_BINDING_MISMATCH");
  let model: ReturnType<typeof catalog.getModel>;
  try { model = catalog.getModel("clarity"); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  const operation = model.operations.find((entry) => entry.id === "upscale-image");
  if (model.id !== "clarity" || model.ai_name !== "clarity" || model.upstream_id !== "clarity" ||
      model.scope !== "tool_image_upscaler" || model.active !== true ||
      model.source_hashes.ai !== E551_SOURCE_HASHES.ai ||
      model.source_hashes.llm_models !== E551_SOURCE_HASHES.llm_models ||
      model.source_hashes.models !== expectedModelsHash ||
      operation?.output_modality !== "image") fail("CATALOG_BINDING_MISMATCH");
  return `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
}

function validateCandidate(
  candidate: unknown,
  principal: Readonly<GenerationPrincipalRef>,
  attemptId: string,
  profile: ReturnType<typeof getOwnerClarityUpscaleSourceProfile>,
  profileSchemaHash: string
): string {
  if (!isOwnerClarityUpscalePreparedCandidateForPrincipal(candidate, principal, attemptId)) fail("CANDIDATE_UNBOUND");
  const record = readCandidateRecord(candidate,
    ["status", "dispatch_allowed", "backend_acceptance", "profile_id", "profile_schema_hash", "source_binding",
      "model_id", "ai_name", "model_type", "operation_id", "modality", "source_route", "mime_confidence",
      "image", "request_fingerprint", "query", "request"],
    ["status", "dispatch_allowed", "backend_acceptance", "profile_id", "profile_schema_hash", "source_binding",
      "model_id", "ai_name", "model_type", "operation_id", "modality", "source_route", "mime_confidence",
      "image", "request_fingerprint", "query", "request"]);
  const query = readExactRecord(record.query, ["ai_name"], ["ai_name"]);
  const request = readExactRecord(record.request, ["prompt", "settings"], ["settings"]);
  const settings = readExactRecord(request.settings, ["n", "model_type", "scale", "is_professional_mode", "strength", "cfg", "denoise", "file_urls"],
    ["n", "model_type", "scale", "is_professional_mode", "strength", "cfg", "denoise", "file_urls"]);
  const image = readExactRecord(record.image, ["mime_type", "width", "height"], ["mime_type", "width", "height"]);
  const files = snapshotSingleFileReference(settings.file_urls);
  const prompt = request.prompt;
  if (prompt !== undefined && (typeof prompt !== "string" || prompt.length === 0 ||
      Buffer.byteLength(prompt, "utf8") > 5_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt))) fail("CANDIDATE_UNBOUND");
  if (record.status !== "blocked" || record.dispatch_allowed !== false || record.backend_acceptance !== "unproven" ||
      record.profile_id !== profile.profile_id || record.profile_schema_hash !== profileSchemaHash ||
      !isDeepStrictEqual(record.source_binding, profile.source_binding) ||
      record.model_id !== profile.model_id || record.ai_name !== profile.ai_name || record.model_type !== profile.model_type ||
      record.operation_id !== profile.operation_id || record.modality !== profile.modality || record.source_route !== profile.source_route ||
      record.mime_confidence !== "UPLOAD_DECLARED_NOT_SNIFFED" || query.ai_name !== "clarity" ||
      settings.n !== 1 || settings.model_type !== "clarity" || typeof settings.scale !== "number" ||
      !Number.isFinite(settings.scale) || settings.scale <= 0 || typeof settings.is_professional_mode !== "boolean" ||
      typeof settings.strength !== "number" || !Number.isFinite(settings.strength) ||
      typeof settings.cfg !== "number" || !Number.isFinite(settings.cfg) ||
      typeof settings.denoise !== "number" || !Number.isFinite(settings.denoise) ||
      typeof image.mime_type !== "string" || !profile.input_mime_types.includes(image.mime_type as never) ||
      !Number.isSafeInteger(image.width) || (image.width as number) <= 0 ||
      !Number.isSafeInteger(image.height) || (image.height as number) <= 0 ||
      files.type !== "image" || typeof files.url !== "string" || !isSafeUploadReferenceUrl(files.url) ||
      typeof record.request_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.request_fingerprint)) fail("CANDIDATE_UNBOUND");

  const fingerprint = schemaHash({
    profile_schema_hash: profileSchemaHash,
    principal,
    attempt_id: attemptId,
    prompt: prompt ?? null,
    query: { ai_name: "clarity" },
    settings: request.settings
  });
  if (fingerprint !== record.request_fingerprint) fail("CANDIDATE_UNBOUND");
  return candidatePayloadFingerprint(candidate);
}

function candidatePayloadFingerprint(value: unknown): string {
  if (!value || typeof value !== "object") fail("CANDIDATE_UNBOUND");
  return schemaHash(value);
}

function candidateFingerprintForPermit(
  value: unknown,
  state: PermitState
): string {
  if (!isOwnerClarityUpscalePreparedCandidateForPrincipal(value, state.principal, state.attemptId)) fail("CANDIDATE_MISMATCH");
  return candidatePayloadFingerprint(value);
}

function snapshotSingleFileReference(value: unknown): Readonly<{ type: string; url: string }> {
  if (!Array.isArray(value) || !Object.isFrozen(value) || types.isProxy(value) || value.length !== 1) fail("CANDIDATE_UNBOUND");
  const file = readExactRecord(value[0], ["type", "url"], ["type", "url"]);
  if (!Object.isFrozen(value[0])) fail("CANDIDATE_UNBOUND");
  return Object.freeze({ type: file.type as string, url: file.url as string });
}

function readCandidateRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value)) fail("CANDIDATE_UNBOUND");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("CANDIDATE_UNBOUND");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const symbols = keys.filter((key): key is symbol => typeof key === "symbol");
  const strings = keys.filter((key): key is string => typeof key === "string");
  if (symbols.length !== 1 || symbols[0]!.description !== "OwnerClarityUpscalePreparedCandidate" ||
      Object.getOwnPropertyDescriptor(value, symbols[0]!)?.value !== true ||
      strings.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      strings.some((key) => !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) fail("CANDIDATE_UNBOUND");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of strings) result[key] = descriptors[key]!.value;
  return result;
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

function isPermitBrand(value: object): value is OwnerClarityUpscaleOneShotPermit {
  if (types.isProxy(value) || !Object.isFrozen(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const strings = keys.filter((key): key is string => typeof key === "string");
  const symbols = keys.filter((key): key is symbol => typeof key === "symbol");
  const expected = ["status", "dispatch_allowed", "profile_id", "profile_schema_hash", "public_catalog_version", "catalog_version", "request_fingerprint", "expires_at"];
  return strings.length === expected.length && expected.every((key) => Object.hasOwn(descriptors, key)) &&
    strings.every((key) => expected.includes(key)) && symbols.length === 1 && symbols[0] === permitBrand &&
    keys.every((key) => "value" in descriptors[key as keyof typeof descriptors]!) &&
    Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true &&
    descriptors.status?.value === "authorized" && descriptors.dispatch_allowed?.value === false;
}

function readExactRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function fail(code: OwnerClarityUpscaleOneShotPolicyErrorCode): never {
  throw new OwnerClarityUpscaleOneShotPolicyError(code);
}
