import { isDeepStrictEqual, types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import {
  isOwnerWanImagePreparedCandidateForPrincipal,
  type OwnerWanImagePreparedCandidate
} from "./owner-wan-image-request-preparer.js";
import {
  getOwnerWanImageSourceProfile,
  type OwnerWanImageSourceProfile
} from "./owner-wan-image-source-profile.js";
import { normalizeOwnerWanImageParameters, type OwnerWanImageVariant } from "./owner-wan-image-parameters.js";
import { normalizeOwnerWanImagePrompt } from "./owner-wan-image-prompt.js";

const TTL_MS = 15 * 60_000;
const SETTINGS_KEYS = Object.freeze([
  "n", "model_type", "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"
] as const);
const CANDIDATE_KEYS = Object.freeze([
  "status", "source_readiness", "dispatch_allowed", "backend_acceptance", "profile_id", "profile_schema_hash",
  "source_binding", "model_id", "ai_name", "variant", "model_type", "scope", "operation_id", "public_catalog_version",
  "prompt", "prompt_source_limit_confidence", "reference_count", "input_images", "bbox_coordinate_policy",
  "cost_inputs", "cost_input_confidence", "expires_at", "request_fingerprint", "request"
] as const);
const INPUT_IMAGE_KEYS = Object.freeze([
  "reference_handle", "mime_type", "width", "height", "size", "sha256", "metadata_confidence", "coordinate_source_sha256", "coordinate_metadata"
] as const);
const permitBrand: unique symbol = Symbol("OwnerWanImageOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const issuedForCandidate = new WeakMap<object, object>();
const candidateClocks = new WeakMap<object, CandidateClock>();

export interface CreateOwnerWanImageOneShotPermitInput {
  readonly candidate: OwnerWanImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel" | "fetched_at" | "source_hashes" | "catalog_metadata">;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerWanImageOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly profile_id: OwnerWanImageSourceProfile["profile_id"];
  readonly profile_schema_hash: string;
  readonly variant: OwnerWanImageVariant;
  readonly model_id: OwnerWanImageVariant;
  readonly ai_name: "wan_image";
  readonly public_catalog_version: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly expires_at: number;
}

export interface ConsumeOwnerWanImageOneShotPermitInput {
  readonly permit: OwnerWanImageOneShotPermit;
  readonly candidate: OwnerWanImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerWanImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerWanImageOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";

export class OwnerWanImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerWanImageOneShotPolicyErrorCode) {
    super("The owner WAN image one-shot policy could not be satisfied.");
    this.name = "OwnerWanImageOneShotPolicyError";
  }
}

interface CandidateClock { lastObservedAt: number; expired: boolean }
interface PermitState {
  readonly permit: OwnerWanImageOneShotPermit;
  readonly candidate: OwnerWanImagePreparedCandidate;
  readonly candidateFingerprint: string;
  readonly requestFingerprint: string;
  readonly profile: Readonly<OwnerWanImageSourceProfile>;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly expiresAt: number;
  readonly candidateExpiresAt: number;
  readonly now: () => number;
  lastObservedAt: number;
  consumed: boolean;
  expired: boolean;
}

/** Issues one nominal local capability bound to the selected e551 profile and the full owned request. */
export function createOwnerWanImageOneShotPermit(
  input: CreateOwnerWanImageOneShotPermitInput | unknown
): OwnerWanImageOneShotPermit {
  const fields = readExactRecord(input, ["candidate", "principal", "attemptId", "catalog", "catalog_version", "now"],
    ["candidate", "principal", "attemptId", "catalog", "catalog_version"]);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      typeof fields.catalog_version !== "string" ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
  const attemptId = fields.attemptId;
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const now = typeof fields.now === "function" ? fields.now as () => number : Date.now;
  const issuedAt = readClock(now);
  const candidate = fields.candidate;
  if (!isOwnerWanImagePreparedCandidateForPrincipal(candidate, principal, attemptId, 0)) fail("CANDIDATE_UNBOUND");
  const record = readCandidateRecord(candidate);
  if (!isVariant(record.variant)) fail("CANDIDATE_UNBOUND");
  let profile: Readonly<OwnerWanImageSourceProfile>;
  try {
    profile = getOwnerWanImageSourceProfile(record.variant, fields.catalog as CreateOwnerWanImageOneShotPermitInput["catalog"], fields.catalog_version);
  } catch { fail("CATALOG_BINDING_MISMATCH"); }
  const intent = validateCandidate(record, candidate as OwnerWanImagePreparedCandidate, profile);
  observeCandidateClock(candidate as object, issuedAt, intent.expiresAt);
  if (issuedForCandidate.has(candidate as object)) fail("CANDIDATE_ALREADY_ISSUED");
  if (fields.catalog_version !== profile.public_catalog_version) fail("CATALOG_BINDING_MISMATCH");
  const expiresAt = Math.min(intent.expiresAt, issuedAt + TTL_MS);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");
  const permit: OwnerWanImageOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "nominal" as const,
    dispatch_allowed: false as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    variant: profile.variant,
    model_id: profile.model_id,
    ai_name: "wan_image" as const,
    public_catalog_version: profile.public_catalog_version,
    catalog_version: fields.catalog_version,
    request_fingerprint: intent.requestFingerprint,
    expires_at: expiresAt
  });
  permitStates.set(permit, {
    permit, candidate: candidate as OwnerWanImagePreparedCandidate,
    candidateFingerprint: intent.candidateFingerprint, requestFingerprint: intent.requestFingerprint, profile,
    principal, attemptId, expiresAt, candidateExpiresAt: intent.expiresAt, now,
    lastObservedAt: issuedAt, consumed: false, expired: false
  });
  issuedForCandidate.set(candidate as object, permit);
  return permit;
}

/** Atomically consumes the nominal permit; it grants no account, plan, or cost approval. */
export function consumeOwnerWanImageOneShotPermit(
  input: ConsumeOwnerWanImageOneShotPermitInput | unknown
): OwnerWanImageOneShotPermitReceipt {
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
      state.permit.request_fingerprint !== state.requestFingerprint || state.permit.profile_schema_hash !== state.profile.profile_schema_hash ||
      state.permit.variant !== state.profile.variant || state.permit.model_id !== state.profile.model_id ||
      state.permit.ai_name !== "wan_image" || state.permit.public_catalog_version !== state.profile.public_catalog_version ||
      state.permit.catalog_version !== state.profile.public_catalog_version || issuedForCandidate.get(state.candidate) !== permit) {
    fail("CANDIDATE_MISMATCH");
  }
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.requestFingerprint });
}

function validateCandidate(
  record: Record<string, unknown>, candidate: OwnerWanImagePreparedCandidate, profile: Readonly<OwnerWanImageSourceProfile>
): Readonly<{ candidateFingerprint: string; requestFingerprint: string; expiresAt: number }> {
  const variant = profile.variant;
  const request = readExactRecord((candidate as OwnerWanImagePreparedCandidate & { request?: unknown }).request,
    ["prompt", "settings"], ["prompt", "settings"]);
  const settings = readExactRecord(request.settings, SETTINGS_KEYS, SETTINGS_KEYS);
  const expiry = record.expires_at;
  if (record.status !== "blocked" || record.source_readiness !== "SOURCE_JOINED_FULL_SETTINGS_AND_PROMPT" ||
      record.dispatch_allowed !== false || record.backend_acceptance !== "UNPROVEN" || record.profile_id !== profile.profile_id ||
      record.profile_schema_hash !== profile.profile_schema_hash || !isDeepStrictEqual(record.source_binding, profile.source_binding) ||
      record.model_id !== variant || record.ai_name !== "wan_image" || record.variant !== variant || record.model_type !== variant ||
      record.scope !== "image" || record.operation_id !== "generate-image" || record.public_catalog_version !== profile.public_catalog_version ||
      typeof record.prompt !== "string" || record.prompt !== request.prompt ||
      record.prompt_source_limit_confidence !== profile.prompt_policy.limit_confidence ||
      !Number.isSafeInteger(expiry) || (expiry as number) <= 0 ||
      typeof record.reference_count !== "number" || !Number.isSafeInteger(record.reference_count) ||
      typeof record.request_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.request_fingerprint)) fail("CANDIDATE_UNBOUND");
  const count = record.reference_count as number;
  if (count < profile.reference_count.minimum || count > profile.reference_count.maximum ||
      settings.n !== 1 || settings.model_type !== variant || !Array.isArray(settings.file_urls) || settings.file_urls.length !== count ||
      !isDeepStrictEqual(record.cost_inputs, { batch_size: settings.batch_size }) || record.cost_input_confidence !== "SOURCE_JOINED_BATCH_SIZE_ONLY" ||
      !isDeepStrictEqual(normalizePrompt(variant, request.prompt), request.prompt)) fail("CANDIDATE_UNBOUND");
  const normalized = normalizeParameters(variant, count, settings);
  const normalizedSettings = {
    aspect_ratio: settings.aspect_ratio, resolution: settings.resolution, batch_size: settings.batch_size,
    prompt_extend: settings.prompt_extend, seed: settings.seed, color_palette: settings.color_palette, bbox_list: settings.bbox_list
  };
  if (!isDeepStrictEqual(normalized.parameters, normalizedSettings) || !isDeepStrictEqual(normalized.cost_inputs, record.cost_inputs)) fail("CANDIDATE_UNBOUND");
  validateInputImages(record.input_images, count, profile);
  for (const item of settings.file_urls) {
    const reference = readExactRecord(item, ["type", "url"], ["type", "url"]);
    if (reference.type !== "image" || typeof reference.url !== "string" || !isSafeUploadReferenceUrl(reference.url)) fail("CANDIDATE_UNBOUND");
  }
  const anyBbox = normalized.parameters.bbox_list.some((boxes) => boxes.length > 0);
  if ((anyBbox && record.bbox_coordinate_policy !== "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER") ||
      (!anyBbox && record.bbox_coordinate_policy !== null)) fail("CANDIDATE_UNBOUND");
  if (count === 0 && settings.file_urls.length !== 0) fail("CANDIDATE_UNBOUND");
  const requestFingerprint = record.request_fingerprint as string;
  return Object.freeze({ candidateFingerprint: schemaHash({ record, request }), requestFingerprint, expiresAt: expiry as number });
}

function validateInputImages(value: unknown, count: number, profile: Readonly<OwnerWanImageSourceProfile>): void {
  if (!Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value) || value.length !== count) fail("CANDIDATE_UNBOUND");
  for (const input of value) {
    const item = readExactRecord(input, INPUT_IMAGE_KEYS, INPUT_IMAGE_KEYS);
    if (typeof item.reference_handle !== "string" || !/^wan_image_[0-9a-f-]{36}$/u.test(item.reference_handle as string) ||
        !profile.mime_policy.canonical_values.includes(item.mime_type as string) ||
        !Number.isSafeInteger(item.width) || (item.width as number) < profile.input_policy.minimum_dimension ||
        (item.width as number) > profile.input_policy.maximum_dimension ||
        !Number.isSafeInteger(item.height) || (item.height as number) < profile.input_policy.minimum_dimension ||
        (item.height as number) > profile.input_policy.maximum_dimension ||
        !Number.isSafeInteger(item.size) || (item.size as number) < 1 || (item.size as number) > profile.input_policy.maximum_bytes ||
        typeof item.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(item.sha256) ||
        item.metadata_confidence !== "CONTAINER_METADATA_ONLY" || item.coordinate_source_sha256 !== item.sha256) fail("CANDIDATE_UNBOUND");
    const coordinate = readExactRecord(item.coordinate_metadata,
      ["orientation", "projected_width", "projected_height", "confidence"],
      ["orientation", "projected_width", "projected_height", "confidence"]);
    const supported = coordinate.confidence === "HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE";
    const orientationOkay = coordinate.orientation === null || (typeof coordinate.orientation === "number" &&
      Number.isInteger(coordinate.orientation) && coordinate.orientation >= 1 && coordinate.orientation <= 8);
    const dimensionsOkay = coordinate.projected_width === null && coordinate.projected_height === null ||
      (Number.isSafeInteger(coordinate.projected_width) && Number.isSafeInteger(coordinate.projected_height) &&
        (coordinate.projected_width as number) > 0 && (coordinate.projected_height as number) > 0);
    if (!orientationOkay || !dimensionsOkay ||
        (supported && (coordinate.orientation === null || coordinate.projected_width === null || coordinate.projected_height === null)) ||
        (!supported && (coordinate.confidence !== "UNSUPPORTED_OR_MALFORMED_METADATA" || coordinate.orientation !== null ||
          coordinate.projected_width !== null || coordinate.projected_height !== null))) fail("CANDIDATE_UNBOUND");
  }
}

function normalizeParameters(variant: OwnerWanImageVariant, count: number, settings: Record<string, unknown>) {
  try { return normalizeOwnerWanImageParameters({ variant, reference_count: count, parameters: {
    aspect_ratio: settings.aspect_ratio, resolution: settings.resolution, batch_size: settings.batch_size,
    prompt_extend: settings.prompt_extend, seed: settings.seed, color_palette: settings.color_palette, bbox_list: settings.bbox_list
  } }); } catch { fail("CANDIDATE_UNBOUND"); }
}

function normalizePrompt(variant: OwnerWanImageVariant, prompt: unknown): string {
  try { return normalizeOwnerWanImagePrompt({ variant, prompt: prompt as string }).prompt; }
  catch { fail("CANDIDATE_UNBOUND"); }
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
  if (value !== state.candidate || !isOwnerWanImagePreparedCandidateForPrincipal(value, state.principal, state.attemptId, now)) fail("CANDIDATE_MISMATCH");
  try { return schemaHash({ record: readCandidateRecord(value), request: (value as OwnerWanImagePreparedCandidate & { request: unknown }).request }); }
  catch { fail("CANDIDATE_MISMATCH"); }
}

function observeCandidateClock(candidate: object, now: number, expiresAt: number): void {
  const observation = candidateClocks.get(candidate);
  if (observation?.expired) fail("CANDIDATE_EXPIRED");
  if (observation && now < observation.lastObservedAt) { observation.expired = true; fail("CLOCK_INVALID"); }
  if (now >= expiresAt) {
    candidateClocks.set(candidate, { lastObservedAt: now, expired: true });
    fail("CANDIDATE_EXPIRED");
  }
  candidateClocks.set(candidate, { lastObservedAt: now, expired: false });
}

function latchCandidateClock(candidate: object, now: number, expiresAt: number, expired: boolean): void {
  const previous = candidateClocks.get(candidate) ?? { lastObservedAt: now, expired: false };
  previous.lastObservedAt = Math.max(previous.lastObservedAt, now);
  previous.expired ||= expired;
  candidateClocks.set(candidate, previous);
  if (now >= expiresAt) previous.expired = true;
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
  } catch (error) { if (error instanceof OwnerWanImageOneShotPolicyError) throw error; fail("INVALID_REQUEST"); }
}

function isPermitBrand(value: object): boolean {
  if (types.isProxy(value) || !Object.isFrozen(value)) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const expected = ["status", "dispatch_allowed", "profile_id", "profile_schema_hash", "variant", "model_id", "ai_name",
      "public_catalog_version", "catalog_version", "request_fingerprint", "expires_at"];
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expected.length + 1 && expected.every((key) => Object.hasOwn(descriptors, key)) &&
      keys.every((key) => key === permitBrand || (typeof key === "string" && expected.includes(key))) &&
      keys.every((key) => "value" in (Object.getOwnPropertyDescriptor(value, key) ?? {})) &&
      Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true &&
      descriptors.status?.value === "nominal" && descriptors.dispatch_allowed?.value === false;
  } catch { return false; }
}

function isVariant(value: unknown): value is OwnerWanImageVariant {
  return value === "wan_25_i2i_preview" || value === "wan_26_image" || value === "wan_27_image" || value === "wan_27_image_pro";
}

function fail(code: OwnerWanImageOneShotPolicyErrorCode): never { throw new OwnerWanImageOneShotPolicyError(code); }
