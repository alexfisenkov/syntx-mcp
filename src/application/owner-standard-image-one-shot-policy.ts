import { isDeepStrictEqual, types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerStandardImageSourceProfile,
  isOwnerStandardImagePreparedCandidateForPrincipal,
  OWNER_STANDARD_IMAGE_VARIANTS,
  type OwnerStandardImagePreparedCandidate,
  type OwnerStandardImageVariant
} from "./owner-standard-image-request-preparer.js";
import { normalizeOwnerBananaImageParameters, type OwnerBananaImageVariant } from "./owner-banana-image-parameters.js";
import { normalizeOwnerGptImageParameters, type OwnerGptImageVariant } from "./owner-gpt-image-parameters.js";

const TTL_MS = 15 * 60_000;
const CANDIDATE_KEYS = Object.freeze([
  "status", "source_readiness", "dispatch_allowed", "backend_acceptance", "profile_id", "profile_schema_hash",
  "source_binding", "model_id", "ai_name", "variant", "model_type", "scope", "operation_id", "prompt",
  "prompt_local_max_utf8_bytes", "prompt_limit_confidence", "parameters", "reference_count", "total_reference_count",
  "counts_by_kind", "references", "dimension_confidence", "pixel_decode_verified", "projection_verified", "cost_inputs",
  "cost_input_confidence", "expires_at", "request_fingerprint", "intent_fingerprint", "request"
] as const);
const permitBrand: unique symbol = Symbol("OwnerStandardImageOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const issuedForCandidate = new WeakMap<object, object>();
const candidateClocks = new WeakMap<object, CandidateClock>();

export interface CreateOwnerStandardImageOneShotPermitInput {
  readonly candidate: OwnerStandardImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: Parameters<typeof getOwnerStandardImageSourceProfile>[1];
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerStandardImageOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly variant: OwnerStandardImageVariant;
  readonly model_id: OwnerStandardImageVariant;
  readonly ai_name: "banana" | "sora-images";
  readonly public_catalog_version: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly expires_at: number;
}

export interface ConsumeOwnerStandardImageOneShotPermitInput {
  readonly permit: OwnerStandardImageOneShotPermit;
  readonly candidate: OwnerStandardImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerStandardImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerStandardImageOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";

export class OwnerStandardImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerStandardImageOneShotPolicyErrorCode) {
    super("The owner standard image one-shot policy could not be satisfied.");
    this.name = "OwnerStandardImageOneShotPolicyError";
  }
}

interface CandidateClock { lastObservedAt: number; expired: boolean }
interface PermitState {
  readonly permit: OwnerStandardImageOneShotPermit;
  readonly candidate: OwnerStandardImagePreparedCandidate;
  readonly candidateFingerprint: string;
  readonly profileSchemaHash: string;
  readonly publicCatalogVersion: string;
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
  readonly catalog: Parameters<typeof getOwnerStandardImageSourceProfile>[1];
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly candidateExpiresAt: number;
  readonly now: () => number;
  lastObservedAt: number;
  consumed: boolean;
  expired: boolean;
}

/** Issues a process-local permit for one exact owned candidate; it grants no plan or cost approval. */
export function createOwnerStandardImageOneShotPermit(
  input: CreateOwnerStandardImageOneShotPermitInput | unknown
): OwnerStandardImageOneShotPermit {
  const fields = readExactRecord(input, ["candidate", "principal", "attemptId", "catalog", "catalog_version", "now"],
    ["candidate", "principal", "attemptId", "catalog", "catalog_version"]);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      typeof fields.catalog_version !== "string" || !fields.catalog || typeof fields.catalog !== "object" ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
  const attemptId = fields.attemptId;
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
  const issuedAt = readClock(now);
  const candidate = fields.candidate;
  if (!isOwnerStandardImagePreparedCandidateForPrincipal(candidate, principal, attemptId, 0)) fail("CANDIDATE_UNBOUND");
  const record = readCandidateRecord(candidate);
  if (!isVariant(record.variant)) fail("CANDIDATE_UNBOUND");
  let profile: ReturnType<typeof getOwnerStandardImageSourceProfile>;
  try { profile = getOwnerStandardImageSourceProfile(record.variant, fields.catalog as Parameters<typeof getOwnerStandardImageSourceProfile>[1], fields.catalog_version); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  const candidateFingerprint = validateCandidate(record, candidate as OwnerStandardImagePreparedCandidate, profile);
  observeCandidateClock(candidate as object, issuedAt, record.expires_at as number);
  if (issuedForCandidate.has(candidate as object)) fail("CANDIDATE_ALREADY_ISSUED");
  if (fields.catalog_version !== profile.public_catalog_version) fail("CATALOG_BINDING_MISMATCH");
  const expiry = Math.min(record.expires_at as number, issuedAt + TTL_MS);
  if (!Number.isSafeInteger(expiry) || expiry <= issuedAt) fail("CANDIDATE_EXPIRED");

  const permit: OwnerStandardImageOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "nominal" as const,
    dispatch_allowed: false as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    variant: profile.variant,
    model_id: profile.model_id,
    ai_name: profile.ai_name,
    public_catalog_version: profile.public_catalog_version,
    catalog_version: fields.catalog_version,
    request_fingerprint: record.request_fingerprint as string,
    intent_fingerprint: record.intent_fingerprint as string,
    expires_at: expiry
  });
  permitStates.set(permit, {
    permit, candidate: candidate as OwnerStandardImagePreparedCandidate, candidateFingerprint,
    profileSchemaHash: profile.profile_schema_hash, publicCatalogVersion: profile.public_catalog_version,
    requestFingerprint: record.request_fingerprint as string, intentFingerprint: record.intent_fingerprint as string,
    catalog: fields.catalog as Parameters<typeof getOwnerStandardImageSourceProfile>[1],
    principal, attemptId, expiresAt: expiry, candidateExpiresAt: record.expires_at as number, now,
    lastObservedAt: issuedAt, consumed: false, expired: false
  });
  issuedForCandidate.set(candidate as object, permit);
  return permit;
}

/** Synchronously consumes the permit before the sole native generation POST. */
export function consumeOwnerStandardImageOneShotPermit(
  input: ConsumeOwnerStandardImageOneShotPermitInput | unknown
): OwnerStandardImageOneShotPermitReceipt {
  const fields = readExactRecord(input, ["permit", "candidate", "principal", "attemptId"], ["permit", "candidate", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId)) fail("INVALID_REQUEST");
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !isPermitBrand(permit)) fail("PERMIT_INVALID");
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
  if (fields.attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate || candidateFingerprintForPermit(fields.candidate, state, now) !== state.candidateFingerprint ||
      state.permit.request_fingerprint !== state.candidate.request_fingerprint ||
      state.permit.request_fingerprint !== state.requestFingerprint ||
      state.permit.intent_fingerprint !== state.candidate.intent_fingerprint ||
      state.permit.intent_fingerprint !== state.intentFingerprint ||
      state.permit.profile_schema_hash !== state.profileSchemaHash || state.permit.variant !== state.candidate.variant ||
      state.permit.model_id !== state.candidate.model_id || state.permit.ai_name !== state.candidate.ai_name ||
      state.permit.public_catalog_version !== state.publicCatalogVersion || state.permit.catalog_version !== state.publicCatalogVersion ||
      issuedForCandidate.get(state.candidate) !== permit) fail("CANDIDATE_MISMATCH");
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.permit.request_fingerprint });
}

function validateCandidate(
  record: Record<string, unknown>, candidate: OwnerStandardImagePreparedCandidate,
  profile: ReturnType<typeof getOwnerStandardImageSourceProfile>
): string {
  const request = readExactRecord(candidate.request, ["prompt", "settings"], ["prompt", "settings"]);
  const variant = profile.variant;
  const count = record.reference_count;
  if (record.status !== "blocked" || record.source_readiness !== "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT" ||
      record.dispatch_allowed !== false || record.backend_acceptance !== "UNPROVEN" || record.profile_id !== profile.profile_id ||
      record.profile_schema_hash !== profile.profile_schema_hash || !isDeepStrictEqual(record.source_binding, profile.source_binding) ||
      record.model_id !== variant || record.ai_name !== profile.ai_name || record.variant !== variant || record.model_type !== variant ||
      record.scope !== "image" || record.operation_id !== "generate-image" ||
      record.prompt !== request.prompt || typeof record.prompt !== "string" ||
      record.prompt_limit_confidence !== "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" || record.prompt_local_max_utf8_bytes !== 65_536 ||
      !Number.isSafeInteger(record.expires_at) || (record.expires_at as number) <= 0 ||
      !Number.isSafeInteger(count) || (count as number) < 0 ||
      !Number.isSafeInteger(record.total_reference_count) || !Array.isArray(record.references) ||
      typeof record.request_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.request_fingerprint) ||
      typeof record.intent_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.intent_fingerprint)) fail("CANDIDATE_UNBOUND");
  let normalized: { parameters: unknown; cost_inputs: unknown; cost_input_confidence: string; wire: Record<string, unknown> };
  try {
    const parameters = record.parameters;
    const result = isBanana(variant)
      ? normalizeOwnerBananaImageParameters({ variant: variant as OwnerBananaImageVariant, reference_count: count as number, parameters })
      : normalizeOwnerGptImageParameters({ variant: variant as OwnerGptImageVariant, reference_count: count as number, parameters });
    normalized = { parameters: result.parameters, cost_inputs: result.cost_inputs,
      cost_input_confidence: result.cost_input_confidence,
      wire: "source_wire_settings" in result ? result.source_wire_settings : result.source_json_mapping };
  } catch { fail("CANDIDATE_UNBOUND"); }
  if (!isDeepStrictEqual(record.parameters, normalized.parameters) || !isDeepStrictEqual(record.cost_inputs, normalized.cost_inputs) ||
      record.cost_input_confidence !== normalized.cost_input_confidence ||
      !isDeepStrictEqual(request.prompt, record.prompt) ||
      !Number.isSafeInteger(record.total_reference_count) || record.total_reference_count !== record.references.length) fail("CANDIDATE_UNBOUND");
  const settingsValue = request.settings;
  const settings = readExactRecord(settingsValue, ["n", "model_type", "aspect_ratio", "image_size", "thinking_level", "quality", "details_quality", "file_urls"],
    ["n", "model_type", "aspect_ratio", "file_urls"]);
  const refs = record.references as unknown[];
  if (types.isProxy(refs) || !Object.isFrozen(refs) || !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) ||
      !Object.isFrozen(settings.file_urls) || refs.length !== settings.file_urls.length || !Object.isFrozen(settingsValue)) fail("CANDIDATE_UNBOUND");
  const wireSettings = Object.assign(Object.create(null) as Record<string, unknown>, {
    n: 1, model_type: variant, ...normalized.wire,
    file_urls: (settings.file_urls as unknown[]).map((item) => {
      const reference = readExactRecord(item, ["type", "url"], ["type", "url"]);
      if (!isKind(reference.type) || typeof reference.url !== "string" || !isSafeUploadReferenceUrl(reference.url)) fail("CANDIDATE_UNBOUND");
      return { type: reference.type, url: reference.url };
    }) });
  if (!isDeepStrictEqual(settings, wireSettings)) fail("CANDIDATE_UNBOUND");
  const counts = { image: 0, video: 0, file: 0 };
  for (let index = 0; index < refs.length; index += 1) {
    const metadata = readExactRecord(refs[index], ["kind", "mime_type", "width", "height", "duration", "size", "sha256", "metadata_confidence"],
      ["kind", "mime_type", "width", "height", "duration", "size", "sha256", "metadata_confidence"]);
    const wire = wireSettings.file_urls[index] as Record<string, unknown>;
    if (!isKind(metadata.kind) || metadata.kind !== wire.type || typeof metadata.mime_type !== "string" ||
        !Number.isSafeInteger(metadata.size) || (metadata.size as number) < 0 ||
        typeof metadata.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(metadata.sha256) ||
        !["CONTAINER_METADATA_ONLY", "UNKNOWN"].includes(metadata.metadata_confidence as string) ||
        !nullableDimension(metadata.width) || !nullableDimension(metadata.height) ||
        !(metadata.duration === null || typeof metadata.duration === "number" && Number.isFinite(metadata.duration) && metadata.duration >= 0)) fail("CANDIDATE_UNBOUND");
    counts[metadata.kind] += 1;
  }
  if (!isDeepStrictEqual(record.counts_by_kind, counts) || record.reference_count !== counts.image) fail("CANDIDATE_UNBOUND");
  return schemaHash({ record, request });
}

function readCandidateRecord(candidate: unknown): Record<string, unknown> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate) || !Object.isFrozen(candidate)) fail("CANDIDATE_UNBOUND");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(candidate); } catch { fail("CANDIDATE_UNBOUND"); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== CANDIDATE_KEYS.length || keys.some((key) => typeof key !== "string" || !CANDIDATE_KEYS.includes(key as typeof CANDIDATE_KEYS[number]))) fail("CANDIDATE_UNBOUND");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of CANDIDATE_KEYS) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== (key !== "request")) fail("CANDIDATE_UNBOUND");
    output[key] = descriptor.value;
  }
  return output;
}

function candidateFingerprintForPermit(value: unknown, state: PermitState, now: number): string {
  if (value !== state.candidate || !isOwnerStandardImagePreparedCandidateForPrincipal(value, state.principal, state.attemptId, now)) fail("CANDIDATE_MISMATCH");
  try { return validateCandidate(readCandidateRecord(value), value as OwnerStandardImagePreparedCandidate,
    getOwnerStandardImageSourceProfile(state.candidate.variant, state.catalog, state.publicCatalogVersion)); }
  catch { fail("CANDIDATE_MISMATCH"); }
}

function observeCandidateClock(candidate: object, now: number, expiresAt: number): void {
  const observation = candidateClocks.get(candidate);
  if (observation?.expired) fail("CANDIDATE_EXPIRED");
  if (observation && now < observation.lastObservedAt) { observation.expired = true; fail("CLOCK_INVALID"); }
  if (now >= expiresAt) { candidateClocks.set(candidate, { lastObservedAt: now, expired: true }); fail("CANDIDATE_EXPIRED"); }
  candidateClocks.set(candidate, { lastObservedAt: now, expired: false });
}

function latchCandidateClock(candidate: object, now: number, expiresAt: number, expired: boolean): void {
  const previous = candidateClocks.get(candidate) ?? { lastObservedAt: now, expired: false };
  previous.lastObservedAt = Math.max(previous.lastObservedAt, now);
  previous.expired ||= expired || now >= expiresAt;
  candidateClocks.set(candidate, previous);
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function readClock(now: () => number): number {
  let value: number;
  try { value = now(); } catch { fail("CLOCK_INVALID"); }
  if (!Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}

function readExactRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
        required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch (error) { if (error instanceof OwnerStandardImageOneShotPolicyError) throw error; fail("INVALID_REQUEST"); }
}

function isPermitBrand(value: object): boolean {
  if (types.isProxy(value) || !Object.isFrozen(value)) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = ["status", "dispatch_allowed", "profile_id", "profile_schema_hash", "variant", "model_id", "ai_name",
      "public_catalog_version", "catalog_version", "request_fingerprint", "intent_fingerprint", "expires_at"];
    const keys = Reflect.ownKeys(descriptors);
    const symbolDescriptor = (descriptors as Record<PropertyKey, PropertyDescriptor>)[permitBrand];
    return keys.length === expected.length + 1 && expected.every((key) => Object.hasOwn(descriptors, key)) &&
      keys.every((key) => typeof key === "symbol" || expected.includes(key)) && symbolDescriptor?.value === true &&
      expected.every((key) => "value" in descriptors[key]!) && descriptors.status!.value === "nominal" &&
      descriptors.dispatch_allowed!.value === false && typeof descriptors.profile_schema_hash!.value === "string" &&
      typeof descriptors.request_fingerprint!.value === "string" && typeof descriptors.intent_fingerprint!.value === "string" &&
      Number.isSafeInteger(descriptors.expires_at!.value);
  } catch { return false; }
}

function isVariant(value: unknown): value is OwnerStandardImageVariant {
  return typeof value === "string" && (OWNER_STANDARD_IMAGE_VARIANTS as readonly string[]).includes(value);
}
function isBanana(value: OwnerStandardImageVariant): boolean { return value.startsWith("banana"); }
function isKind(value: unknown): value is "image" | "video" | "file" { return value === "image" || value === "video" || value === "file"; }
function nullableDimension(value: unknown): boolean { return value === null || Number.isSafeInteger(value) && (value as number) > 0; }
function fail(code: OwnerStandardImageOneShotPolicyErrorCode): never { throw new OwnerStandardImageOneShotPolicyError(code); }
