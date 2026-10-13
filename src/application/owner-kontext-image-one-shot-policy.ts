import { isDeepStrictEqual, types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import {
  getOwnerKontextImageSourceProfile,
  isOwnerKontextImagePreparedCandidateForPrincipal,
  type OwnerKontextImagePreparedCandidate
} from "./owner-kontext-image-request-preparer.js";
import { normalizeOwnerKontextImageParameters, type OwnerKontextImageVariant } from "./owner-kontext-image-parameters.js";

const TTL_MS = 15 * 60_000;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_PROMPT_UTF8_BYTES = 65_536;
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
const INPUT_IMAGE_METADATA_KEYS = Object.freeze([
  "mime_type", "width", "height", "size", "sha256", "metadata_confidence"
] as const);
const SETTINGS_KEYS = Object.freeze([
  "n", "model_type", "workflow_type", "civitai_loras", "resolution", "cfg", "steps", "image_strength", "file_urls"
] as const);
const permitBrand: unique symbol = Symbol("OwnerKontextImageOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const issuedForCandidate = new WeakMap<object, object>();
const candidateClockObservations = new WeakMap<object, CandidateClockObservation>();

export interface CreateOwnerKontextImageOneShotPermitInput {
  readonly candidate: OwnerKontextImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata">;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerKontextImageOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "authorized";
  readonly dispatch_allowed: false;
  readonly profile_id: "flux-kontext-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly variant: OwnerKontextImageVariant;
  readonly model_id: OwnerKontextImageVariant;
  readonly ai_name: "flux";
  readonly public_catalog_version: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly expires_at: number;
}

export interface ConsumeOwnerKontextImageOneShotPermitInput {
  readonly permit: OwnerKontextImageOneShotPermit;
  readonly candidate: OwnerKontextImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerKontextImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerKontextImageOneShotPolicyErrorCode =
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

export class OwnerKontextImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerKontextImageOneShotPolicyErrorCode) {
    super("The owner Kontext image one-shot policy could not be satisfied.");
    this.name = "OwnerKontextImageOneShotPolicyError";
  }
}

interface CandidateClockObservation {
  lastObservedAt: number;
  expired: boolean;
}

interface PermitState {
  readonly permit: OwnerKontextImageOneShotPermit;
  readonly candidate: OwnerKontextImagePreparedCandidate;
  readonly candidateFingerprint: string;
  readonly requestFingerprint: string;
  readonly profileSchemaHash: string;
  readonly variant: OwnerKontextImageVariant;
  readonly publicCatalogVersion: string;
  readonly catalogVersion: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly candidateExpiresAt: number;
  readonly now: () => number;
  lastObservedAt: number;
  consumed: boolean;
  expired: boolean;
}

/** Issues only a nominal, local one-shot capability; account/cost approval belongs to the trusted service. */
export function createOwnerKontextImageOneShotPermit(
  input: CreateOwnerKontextImageOneShotPermitInput | unknown
): OwnerKontextImageOneShotPermit {
  const fields = readExactRecord(input, ["candidate", "principal", "attemptId", "catalog", "catalog_version", "now"],
    ["candidate", "principal", "attemptId", "catalog", "catalog_version"]);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      typeof fields.catalog_version !== "string" ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
  const attemptId = fields.attemptId;
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
  const issuedAt = readClock(now);
  const candidateInput = fields.candidate;
  if (!isOwnerKontextImagePreparedCandidateForPrincipal(candidateInput, principal, attemptId, 0)) fail("CANDIDATE_UNBOUND");
  const record = readCandidateRecord(candidateInput);
  if (!isVariant(record.variant)) fail("CANDIDATE_UNBOUND");
  let profile: ReturnType<typeof getOwnerKontextImageSourceProfile>;
  try {
    profile = getOwnerKontextImageSourceProfile(record.variant, fields.catalog as CreateOwnerKontextImageOneShotPermitInput["catalog"], fields.catalog_version);
  } catch { fail("CATALOG_BINDING_MISMATCH"); }
  const intent = validateCandidate(record, candidateInput as OwnerKontextImagePreparedCandidate, profile);
  observeCandidateClock(candidateInput as object, issuedAt, intent.expiresAt);
  if (issuedForCandidate.has(candidateInput as object)) fail("CANDIDATE_ALREADY_ISSUED");
  const publicCatalogVersion = profile.public_catalog_version;
  if (fields.catalog_version !== publicCatalogVersion) fail("CATALOG_BINDING_MISMATCH");
  const ttlExpiry = issuedAt + TTL_MS;
  if (!Number.isSafeInteger(ttlExpiry) || ttlExpiry <= issuedAt) fail("CLOCK_INVALID");
  const expiresAt = Math.min(intent.expiresAt, ttlExpiry);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");

  const permit: OwnerKontextImageOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "authorized" as const,
    dispatch_allowed: false as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    variant: profile.variant,
    model_id: profile.model_id,
    ai_name: "flux" as const,
    public_catalog_version: publicCatalogVersion,
    catalog_version: fields.catalog_version,
    request_fingerprint: intent.requestFingerprint,
    expires_at: expiresAt
  });
  permitStates.set(permit, {
    permit, candidate: candidateInput as OwnerKontextImagePreparedCandidate,
    candidateFingerprint: intent.candidateFingerprint,
    requestFingerprint: intent.requestFingerprint,
    profileSchemaHash: profile.profile_schema_hash,
    variant: profile.variant,
    publicCatalogVersion,
    catalogVersion: fields.catalog_version,
    principal,
    attemptId,
    expiresAt,
    candidateExpiresAt: intent.expiresAt,
    now,
    lastObservedAt: issuedAt,
    consumed: false,
    expired: false
  });
  issuedForCandidate.set(candidateInput as object, permit);
  return permit;
}

/** Synchronous consume boundary immediately before exactly one native generation POST. */
export function consumeOwnerKontextImageOneShotPermit(
  input: ConsumeOwnerKontextImageOneShotPermitInput | unknown
): OwnerKontextImageOneShotPermitReceipt {
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
  if (fields.attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate || candidateFingerprintForPermit(fields.candidate, state, now) !== state.candidateFingerprint ||
      state.permit.request_fingerprint !== state.requestFingerprint || state.permit.profile_schema_hash !== state.profileSchemaHash ||
      state.permit.variant !== state.variant || state.permit.model_id !== state.variant ||
      state.permit.public_catalog_version !== state.publicCatalogVersion || state.permit.catalog_version !== state.catalogVersion ||
      issuedForCandidate.get(state.candidate) !== permit) fail("CANDIDATE_MISMATCH");
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.requestFingerprint });
}

function validateCandidate(
  record: Record<string, unknown>, candidate: OwnerKontextImagePreparedCandidate,
  profile: ReturnType<typeof getOwnerKontextImageSourceProfile>
): Readonly<{ candidateFingerprint: string; requestFingerprint: string; expiresAt: number }> {
  const variant = profile.variant;
  const query = readExactRecord(record.query, ["ai_name"], ["ai_name"]);
  const request = readExactRecord(record.request, ["prompt", "settings"], ["prompt", "settings"]);
  const settings = readExactRecord(request.settings, SETTINGS_KEYS, SETTINGS_KEYS);
  const prompt = request.prompt;
  const expiresAt = record.expires_at;
  if (record.status !== "blocked" || record.source_readiness !== "SOURCE_JOINED_PROMPT_POLICY" ||
      record.dispatch_allowed !== false || record.backend_acceptance !== "UNPROVEN" ||
      record.profile_id !== profile.profile_id || record.profile_schema_hash !== profile.profile_schema_hash ||
      !isDeepStrictEqual(record.source_binding, profile.source_binding) || record.model_id !== variant ||
      record.ai_name !== "flux" || record.variant !== variant || record.model_type !== variant ||
      record.scope !== "image" || record.operation_id !== "generate-image" || record.source_route !== "design/generate" ||
      record.workflow_policy !== profile.workflow_policy || query.ai_name !== "flux" ||
      typeof prompt !== "string" || prompt.trim().length === 0 || Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_UTF8_BYTES ||
      PROMPT_CONTROL.test(prompt) || !Number.isSafeInteger(expiresAt) || (expiresAt as number) <= 0 ||
      typeof record.reference_count !== "number" || !Number.isSafeInteger(record.reference_count) ||
      typeof record.request_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.request_fingerprint)) fail("CANDIDATE_UNBOUND");
  if (settings.n !== 1 || settings.model_type !== variant || settings.workflow_type !== "default" ||
      !Array.isArray(settings.civitai_loras) || settings.civitai_loras.length !== 0 || !Object.isFrozen(settings.civitai_loras) ||
      settings.resolution === undefined || settings.cfg === undefined || settings.steps === undefined || settings.image_strength === undefined ||
      !Array.isArray(settings.file_urls) || settings.file_urls.length !== record.reference_count ||
      settings.file_urls.length < profile.reference_count.minimum || settings.file_urls.length > profile.reference_count.maximum ||
      settings.file_urls.length > profile.public_file_count_limit) fail("CANDIDATE_UNBOUND");
  validateInputImageMetadata(record.input_images, settings.file_urls.length);
  let normalized: ReturnType<typeof normalizeOwnerKontextImageParameters>;
  try {
    normalized = normalizeOwnerKontextImageParameters({
      variant,
      parameters: {
        resolution: settings.resolution,
        cfg: settings.cfg,
        steps: settings.steps,
        image_strength: settings.image_strength
      }
    });
  } catch { fail("CANDIDATE_UNBOUND"); }
  if (!isDeepStrictEqual(normalized.parameters, {
    resolution: settings.resolution, cfg: settings.cfg, steps: settings.steps, image_strength: settings.image_strength
  })) fail("CANDIDATE_UNBOUND");
  for (const item of settings.file_urls) {
    const reference = readExactRecord(item, ["type", "url"], ["type", "url"]);
    if (reference.type !== "image" || typeof reference.url !== "string" || !isSafeUploadReferenceUrl(reference.url) ||
        !Object.isFrozen(item)) fail("CANDIDATE_UNBOUND");
  }
  const requestFingerprint = record.request_fingerprint as string;
  return Object.freeze({
    candidateFingerprint: candidatePayloadFingerprint(candidate), requestFingerprint, expiresAt: expiresAt as number
  });
}

function readCandidateRecord(input: unknown): Record<string, unknown> {
  const allowed = ["status", "source_readiness", "dispatch_allowed", "backend_acceptance", "profile_id", "profile_schema_hash",
    "source_binding", "model_id", "ai_name", "variant", "model_type", "scope", "operation_id", "source_route",
    "workflow_policy", "reference_count", "input_images", "expires_at", "request_fingerprint", "query", "request"];
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) || !Object.isFrozen(input)) fail("CANDIDATE_UNBOUND");
  let descriptors: PropertyDescriptorMap;
  try {
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) fail("CANDIDATE_UNBOUND");
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch { fail("CANDIDATE_UNBOUND"); }
  const keys = Reflect.ownKeys(descriptors);
  const strings = keys.filter((key): key is string => typeof key === "string");
  if (keys.length !== allowed.length || strings.length !== allowed.length ||
      strings.some((key) => !allowed.includes(key) || !("value" in descriptors[key]!) ||
        (key === "request" ? descriptors[key]!.enumerable : !descriptors[key]!.enumerable))) fail("CANDIDATE_UNBOUND");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of strings) output[key] = descriptors[key]!.value;
  return output;
}

function validateInputImageMetadata(value: unknown, expectedCount: number): void {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value) || value.length !== expectedCount) fail("CANDIDATE_UNBOUND");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap; }
  catch { fail("CANDIDATE_UNBOUND"); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expectedCount + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) fail("CANDIDATE_UNBOUND");
  for (let index = 0; index < expectedCount; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("CANDIDATE_UNBOUND");
    const item = descriptor.value;
    if (!item || typeof item !== "object" || Array.isArray(item) || types.isProxy(item) || !Object.isFrozen(item)) {
      fail("CANDIDATE_UNBOUND");
    }
    const metadata = readExactRecord(item, INPUT_IMAGE_METADATA_KEYS, INPUT_IMAGE_METADATA_KEYS);
    if (!(CANONICAL_INPUT_MIME_TYPES as readonly unknown[]).includes(metadata.mime_type) ||
        !Number.isSafeInteger(metadata.width) || (metadata.width as number) < 1 || (metadata.width as number) > 0xffff_ffff ||
        !Number.isSafeInteger(metadata.height) || (metadata.height as number) < 1 || (metadata.height as number) > 0xffff_ffff ||
        !Number.isSafeInteger(metadata.size) || (metadata.size as number) < 1 || (metadata.size as number) > MAX_INPUT_IMAGE_BYTES ||
        typeof metadata.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(metadata.sha256) ||
        metadata.metadata_confidence !== "CONTAINER_METADATA_ONLY") fail("CANDIDATE_UNBOUND");
  }
}

const CANONICAL_INPUT_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"] as const);

function candidatePayloadFingerprint(candidate: unknown): string {
  try {
    const record = readCandidateRecord(candidate);
    const request = (candidate as OwnerKontextImagePreparedCandidate).request;
    return schemaHash({ ...record, request });
  } catch { fail("CANDIDATE_UNBOUND"); }
}

function candidateFingerprintForPermit(value: unknown, state: PermitState, now: number): string {
  if (value !== state.candidate || !isOwnerKontextImagePreparedCandidateForPrincipal(value, state.principal, state.attemptId, now)) {
    fail("CANDIDATE_MISMATCH");
  }
  return candidatePayloadFingerprint(value);
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

function readExactRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
        required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch (error) {
    if (error instanceof OwnerKontextImageOneShotPolicyError) throw error;
    fail("INVALID_REQUEST");
  }
}

function isPermitBrand(value: object): value is OwnerKontextImageOneShotPermit {
  if (types.isProxy(value) || !Object.isFrozen(value)) return false;
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return false; }
  const keys = Reflect.ownKeys(descriptors);
  const strings = keys.filter((key): key is string => typeof key === "string");
  const expected = ["status", "dispatch_allowed", "profile_id", "profile_schema_hash", "variant", "model_id", "ai_name",
    "public_catalog_version", "catalog_version", "request_fingerprint", "expires_at"];
  return strings.length === expected.length && expected.every((key) => Object.hasOwn(descriptors, key)) &&
    strings.every((key) => expected.includes(key)) && keys.length === expected.length + 1 &&
    keys.every((key) => "value" in descriptors[key as keyof typeof descriptors]!) &&
    descriptors[permitBrand]?.value === true && descriptors.status?.value === "authorized" &&
    descriptors.dispatch_allowed?.value === false;
}

function isVariant(value: unknown): value is OwnerKontextImageVariant {
  return value === "flux-kontext-pro" || value === "flux-kontext-max" || value === "flux-kontext-multi";
}

function fail(code: OwnerKontextImageOneShotPolicyErrorCode): never {
  throw new OwnerKontextImageOneShotPolicyError(code);
}
