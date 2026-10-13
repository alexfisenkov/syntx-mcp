import { isDeepStrictEqual, types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerIdeogramImageSourceProfile,
  type OwnerIdeogramImageCatalogPort,
  type OwnerIdeogramImageSourceProfile
} from "./owner-ideogram-image-source-profile.js";
import {
  normalizeOwnerIdeogramImageParameters,
  type OwnerIdeogramImageModelId,
  type OwnerIdeogramImageMode
} from "./owner-ideogram-image-parameters.js";
import { OwnerIdeogramImageMaskUploadService } from "./owner-ideogram-image-mask-upload-service.js";
import {
  getOwnerIdeogramImagePreparedCandidateState,
  isOwnerIdeogramImagePreparedCandidateForPrincipal,
  observeOwnerIdeogramImageCandidateClock,
  type OwnerIdeogramImageMaskBinding,
  type OwnerIdeogramImagePreparedCandidate,
  type OwnerIdeogramImagePreparedCandidateState
} from "./owner-ideogram-image-request-preparer.js";

const TTL_MS = 15 * 60_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const BRAND: unique symbol = Symbol("OwnerIdeogramImageOneShotPermit");
const SOURCE_WIRE_BINDING = Object.freeze({
  custom_settings_sender_sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
  ordered_file_url_canonicalizer_sha256: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706",
  confidence: "STATIC_SOURCE_HELPER_JOIN_NOT_PROVIDER_ACCEPTANCE"
} as const);
const permitStates = new WeakMap<object, PermitState>();
const candidatePermits = new WeakMap<object, object>();

export interface CreateOwnerIdeogramImageOneShotPermitInput {
  readonly candidate: OwnerIdeogramImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}
export interface OwnerIdeogramImageOneShotPermit {
  readonly [BRAND]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly mask_present: boolean;
  readonly mask_binding_fingerprint: string | null;
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly ai_name: "ideogram";
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly source_wire_fingerprint: string;
  readonly parameters_fingerprint: string;
  readonly references_fingerprint: string;
  readonly expires_at: number;
}
export interface ConsumeOwnerIdeogramImageOneShotPermitInput {
  readonly permit: OwnerIdeogramImageOneShotPermit;
  readonly candidate: OwnerIdeogramImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerIdeogramImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}
export type OwnerIdeogramImageOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";

export class OwnerIdeogramImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerIdeogramImageOneShotPolicyErrorCode) {
    super("The owner Ideogram image one-shot policy could not be satisfied.");
    this.name = "OwnerIdeogramImageOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerIdeogramImageOneShotPermit;
  readonly candidate: OwnerIdeogramImagePreparedCandidate;
  readonly candidateState: OwnerIdeogramImagePreparedCandidateState;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalogVersion: string;
  readonly candidateFingerprint: string;
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
  readonly sourceWireFingerprint: string;
  readonly parametersFingerprint: string;
  readonly referencesFingerprint: string;
  readonly maskBindingFingerprint: string | null;
  readonly expiry: number;
  readonly originalExpiry: number;
  readonly now: () => number;
  lastNow: number;
  consumed: boolean;
  expired: boolean;
}

/** Mints an opaque local nominal permit for one exact candidate; it is not payment or POST authorization. */
export function createOwnerIdeogramImageOneShotPermit(input: CreateOwnerIdeogramImageOneShotPermitInput | unknown): OwnerIdeogramImageOneShotPermit {
  const fields = exact(input, ["candidate", "principal", "attemptId", "catalog", "catalog_version", "now"],
    ["candidate", "principal", "attemptId", "catalog", "catalog_version"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !fields.catalog || typeof fields.catalog !== "object" ||
      types.isProxy(fields.catalog) || fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
      (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
  const candidate = fields.candidate as OwnerIdeogramImagePreparedCandidate;
  const candidateState = getOwnerIdeogramImagePreparedCandidateState(candidate);
  if (!candidateState || candidateState.candidate !== candidate) fail("CANDIDATE_UNBOUND");
  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  if (candidateState.attemptId !== fields.attemptId || !sameGenerationPrincipal(candidateState.principal, principal)) fail("PRINCIPAL_MISMATCH");
  const now = (fields.now as (() => number) | undefined) ?? Date.now;
  const current = readClock(now);
  if (current < candidateState.lastNow) {
    observeOwnerIdeogramImageCandidateClock(candidate, current);
    fail("CLOCK_INVALID");
  }
  if (!observeOwnerIdeogramImageCandidateClock(candidate, current) || candidateState.expired || current >= candidateState.expiresAt) fail("CANDIDATE_EXPIRED");
  if (!isOwnerIdeogramImagePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, current)) fail("CANDIDATE_EXPIRED");
  const catalog = fields.catalog as OwnerIdeogramImageCatalogPort;
  let profile: Readonly<OwnerIdeogramImageSourceProfile>;
  try { profile = getOwnerIdeogramImageSourceProfile(candidate.model_id, candidate.mode, catalog, fields.catalog_version); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (catalog !== candidateState.catalog || fields.catalog_version !== candidateState.catalogVersion ||
      !matchesProfile(candidate, candidateState, profile)) fail("CATALOG_BINDING_MISMATCH");
  const candidateFingerprint = validateCandidate(candidate, candidateState, principal, fields.attemptId, profile);
  if (candidatePermits.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const expiry = Math.min(candidateState.expiresAt, current + TTL_MS);
  if (!Number.isSafeInteger(expiry) || expiry <= current) fail("CANDIDATE_EXPIRED");
  const sourceWireFingerprint = schemaHash(candidate.source_wire_binding);
  const parametersFingerprint = schemaHash(candidateState.normalized.parameters);
  const referencesFingerprint = schemaHash({ reference_count: candidate.reference_count, references: candidate.references,
    file_urls: readCandidateFiles(candidate), mask_binding: candidate.mask_binding ?? null });
  const maskBindingFingerprint = candidate.mask_binding === undefined ? null : schemaHash(candidate.mask_binding);
  const permit: OwnerIdeogramImageOneShotPermit = Object.freeze({
    [BRAND]: true as const, status: "nominal", dispatch_allowed: false, backend_acceptance: "UNPROVEN",
    mask_present: candidate.mask_present, mask_binding_fingerprint: maskBindingFingerprint,
    profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash, model_id: profile.model_id,
    mode: profile.mode, ai_name: "ideogram", catalog_version: fields.catalog_version as string,
    request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint,
    source_wire_fingerprint: sourceWireFingerprint, parameters_fingerprint: parametersFingerprint,
    references_fingerprint: referencesFingerprint, expires_at: expiry
  });
  permitStates.set(permit, { permit, candidate, candidateState, principal, attemptId: fields.attemptId as string,
    catalog, catalogVersion: fields.catalog_version as string, candidateFingerprint,
    requestFingerprint: candidate.request_fingerprint, intentFingerprint: candidate.intent_fingerprint,
    sourceWireFingerprint, parametersFingerprint, referencesFingerprint, maskBindingFingerprint, expiry, originalExpiry: candidateState.expiresAt,
    now, lastNow: current, consumed: false, expired: false });
  candidatePermits.set(candidate, permit);
  return permit;
}

/** Consumes synchronously once; dispatch stays false and must still pass later service gates. */
export function consumeOwnerIdeogramImageOneShotPermit(input: ConsumeOwnerIdeogramImageOneShotPermitInput | unknown): OwnerIdeogramImageOneShotPermitReceipt {
  const fields = exact(input, ["permit", "candidate", "principal", "attemptId"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId)) fail("INVALID_REQUEST");
  const permit = fields.permit as OwnerIdeogramImageOneShotPermit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !hasPermitShape(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.expired) fail("PERMIT_EXPIRED");
  const current = readClock(state.now);
  if (current < state.lastNow) {
    state.expired = true;
    observeOwnerIdeogramImageCandidateClock(state.candidate, current);
    fail("CLOCK_INVALID");
  }
  state.lastNow = current;
  if (current >= state.expiry || current >= state.originalExpiry) { state.expired = true; fail("PERMIT_EXPIRED"); }
  const principal = snapshotPrincipal(fields.principal, fields.attemptId);
  if (fields.attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate || candidatePermits.get(state.candidate) !== permit) fail("CANDIDATE_MISMATCH");
  if (getOwnerIdeogramImagePreparedCandidateState(state.candidate) !== state.candidateState ||
      !observeOwnerIdeogramImageCandidateClock(state.candidate, current) || state.candidateState.expired ||
      !isOwnerIdeogramImagePreparedCandidateForPrincipal(state.candidate, state.principal, state.attemptId, current)) {
    state.expired = true;
    fail("CANDIDATE_EXPIRED");
  }
  let profile: Readonly<OwnerIdeogramImageSourceProfile>;
  try { profile = getOwnerIdeogramImageSourceProfile(state.candidate.model_id, state.candidate.mode, state.catalog, state.catalogVersion); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (!matchesProfile(state.candidate, state.candidateState, profile)) fail("CATALOG_BINDING_MISMATCH");
  if (validateCandidate(state.candidate, state.candidateState, state.principal, state.attemptId, profile) !== state.candidateFingerprint ||
      permit.request_fingerprint !== state.requestFingerprint || permit.intent_fingerprint !== state.intentFingerprint ||
      permit.profile_schema_hash !== profile.profile_schema_hash || permit.profile_id !== profile.profile_id ||
      permit.catalog_version !== state.catalogVersion || permit.source_wire_fingerprint !== state.sourceWireFingerprint ||
      permit.parameters_fingerprint !== state.parametersFingerprint || permit.references_fingerprint !== state.referencesFingerprint ||
      permit.mask_present !== state.candidate.mask_present || permit.mask_binding_fingerprint !== state.maskBindingFingerprint) fail("CANDIDATE_MISMATCH");
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.requestFingerprint });
}

function matchesProfile(candidate: OwnerIdeogramImagePreparedCandidate, state: OwnerIdeogramImagePreparedCandidateState,
  profile: Readonly<OwnerIdeogramImageSourceProfile>): boolean {
  return candidate.profile_id === profile.profile_id && candidate.profile_schema_hash === profile.profile_schema_hash &&
    isDeepStrictEqual(candidate.source_binding, profile.source_binding) && candidate.model_id === profile.model_id &&
    candidate.mode === profile.mode && candidate.model_type === profile.model_type && candidate.ai_name === "ideogram" &&
    candidate.scope === "image" && candidate.operation_id === "generate-image" &&
    state.profile.profile_id === profile.profile_id && state.profile.model_id === profile.model_id && state.profile.mode === profile.mode &&
    isDeepStrictEqual(state.profile.source_binding, profile.source_binding) &&
    state.profile.profile_schema_hash === profile.profile_schema_hash && state.catalogVersion === profile.public_catalog_version &&
    candidate.native_wire_status === (candidate.prompt === null ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" : "SOURCE_MAPPED");
}

function validateCandidate(candidate: OwnerIdeogramImagePreparedCandidate, state: OwnerIdeogramImagePreparedCandidateState,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string, profile: Readonly<OwnerIdeogramImageSourceProfile>): string {
  if (state.attemptId !== attemptId || !sameGenerationPrincipal(state.principal, principal) || candidate.status !== "blocked" ||
      candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.mask_present !== (state.maskBinding !== undefined) || state.assetSet.mask_present !== candidate.mask_present ||
      !isDeepStrictEqual(candidate.mask_binding, state.maskBinding) ||
      candidate.profile_id !== profile.profile_id || candidate.profile_schema_hash !== profile.profile_schema_hash ||
      !isDeepStrictEqual(candidate.source_binding, profile.source_binding) || !isDeepStrictEqual(candidate.source_wire_binding, SOURCE_WIRE_BINDING) ||
      candidate.model_id !== profile.model_id || candidate.mode !== profile.mode || candidate.ai_name !== "ideogram" ||
      candidate.model_type !== profile.model_type || candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
      candidate.expires_at !== state.expiresAt || candidate.expires_at !== state.assetSet.expires_at ||
      state.assetSet.generation_permit !== false || candidate.reference_count !== state.assetSet.reference_count ||
      !isDeepStrictEqual(candidate.references, state.assetSet.references) || candidate.request_fingerprint !== state.requestFingerprint ||
      candidate.intent_fingerprint !== state.intentFingerprint || candidate.request !== state.request || !Object.isFrozen(candidate) ||
      !Object.isFrozen(candidate.request) || !Object.isFrozen(candidate.request.settings) || candidate.request_prompt_confidence !==
        (state.promptIntent === null ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" : "SOURCE_REQUIRED_PROMPT")) fail("CANDIDATE_UNBOUND");
  const promptPolicy = state.normalized.prompt_policy;
  if ((promptPolicy === "disabled") !== (state.promptIntent === null) || candidate.prompt !== state.promptIntent ||
      candidate.prompt_policy !== promptPolicy || candidate.request.prompt !== (state.promptIntent ?? "")) fail("CANDIDATE_UNBOUND");
  let normalized;
  try {
    normalized = normalizeOwnerIdeogramImageParameters({ model_id: profile.model_id, mode: profile.mode,
      reference_count: candidate.reference_count, mask_present: candidate.mask_present, prompt: state.promptIntent, parameters: state.normalized.parameters });
  } catch { fail("CANDIDATE_UNBOUND"); }
  if (!isDeepStrictEqual(normalized, state.normalized) || !isDeepStrictEqual(candidate.parameters, normalized.parameters) ||
      !isDeepStrictEqual(candidate.source_json_mapping, normalized.source_json_mapping) ||
      !isDeepStrictEqual(candidate.cost_inputs, normalized.cost_inputs) || candidate.cost_input_confidence !== normalized.cost_input_confidence ||
      !isDeepStrictEqual(candidate.request.settings, { ...normalized.source_json_mapping, file_urls: readCandidateFiles(candidate) })) fail("CANDIDATE_UNBOUND");
  const files = readCandidateFiles(candidate);
  if (files.length !== candidate.reference_count + (candidate.mask_present ? 1 : 0) ||
      candidate.references.length !== candidate.reference_count) fail("CANDIDATE_UNBOUND");
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const role = candidate.mask_present && index === files.length - 1 ? "mask" : "image";
    if (file.type !== role || !isSafeUploadReferenceUrl(file.url)) fail("CANDIDATE_UNBOUND");
  }
  if (candidate.mask_present) {
    const mask = state.maskResolution;
    const binding: OwnerIdeogramImageMaskBinding | undefined = state.maskBinding;
    if (!(state.maskService instanceof OwnerIdeogramImageMaskUploadService) || types.isProxy(state.maskService) ||
        !state.maskHandle || !mask || !binding || mask.role !== "mask" || mask.attempt_id !== state.attemptId ||
        !sameGenerationPrincipal(mask.principal, principal) || mask.model_id !== "ideogram_45" || mask.mode !== "precise_edit" ||
        mask.catalog_version !== state.catalogVersion || mask.profile_schema_hash !== profile.profile_schema_hash ||
        binding.mask_handle !== state.maskHandle || !isDeepStrictEqual(binding, candidate.mask_binding) ||
        binding.base_reference_handle !== mask.base_reference_handle || binding.base_sha256 !== mask.base_sha256 ||
        binding.pair_sha256 !== mask.pair_sha256 || binding.normal_sha256 !== mask.normal_sha256 ||
        binding.inverse_sha256 !== mask.inverse_sha256 || binding.expires_at !== mask.expires_at ||
        binding.epoch !== mask.epoch || binding.base_epoch !== mask.base_epoch ||
        mask.primary_url !== mask.normal_url || !isSafeUploadReferenceUrl(mask.normal_url) || !isSafeUploadReferenceUrl(mask.inverse_url) ||
        files[files.length - 1]?.url !== mask.primary_url) fail("CANDIDATE_UNBOUND");
  } else if (state.maskService && state.maskResolution || state.maskHandle !== undefined || state.maskBinding !== undefined ||
      candidate.mask_binding !== undefined) fail("CANDIDATE_UNBOUND");
  for (const reference of candidate.references) {
    if (reference.metadata_confidence !== "CONTAINER_METADATA_ONLY" || typeof reference.mime_type !== "string" ||
        !Number.isSafeInteger(reference.width) || reference.width < 1 || !Number.isSafeInteger(reference.height) || reference.height < 1 ||
        !Number.isSafeInteger(reference.size) || reference.size < 1 || typeof reference.sha256 !== "string" || !SHA256.test(reference.sha256)) fail("CANDIDATE_UNBOUND");
  }
  const candidateFingerprint = schemaHash({
    candidate: { status: candidate.status, profile_id: candidate.profile_id, profile_schema_hash: candidate.profile_schema_hash,
      source_binding: candidate.source_binding, source_wire_binding: candidate.source_wire_binding, model_id: candidate.model_id,
      mode: candidate.mode, prompt: candidate.prompt, prompt_policy: candidate.prompt_policy, parameters: candidate.parameters,
      reference_count: candidate.reference_count, mask_present: candidate.mask_present, mask_binding: candidate.mask_binding ?? null,
      references: candidate.references,
      source_json_mapping: candidate.source_json_mapping, cost_inputs: candidate.cost_inputs, expires_at: candidate.expires_at,
      request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint },
    request: candidate.request
  });
  return candidateFingerprint;
}

function readCandidateFiles(candidate: OwnerIdeogramImagePreparedCandidate): readonly Readonly<{ type: unknown; url: string }>[] {
  const request = exact(candidate.request, ["prompt", "settings"]);
  const settings = exact(request.settings, Object.keys(request.settings as object));
  const fileUrls = settings.file_urls;
  const files = readArray(fileUrls, 5);
  return Object.freeze(files.map((item) => {
    const file = exact(item, ["type", "url"]);
    if (typeof file.url !== "string") fail("CANDIDATE_UNBOUND");
    return Object.freeze({ type: file.type, url: file.url });
  }));
}

function snapshotPrincipal(value: unknown, attemptId: unknown): Readonly<GenerationPrincipalRef> {
  if (typeof attemptId !== "string") fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function readClock(now: () => number): number {
  let value: number;
  try { value = now(); } catch { fail("CLOCK_INVALID"); }
  if (!Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}
function hasPermitShape(value: object): boolean {
  if (types.isProxy(value) || !Object.isFrozen(value)) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
    const expected = ["status", "dispatch_allowed", "backend_acceptance", "mask_present", "profile_id", "profile_schema_hash", "model_id", "mode",
      "mask_binding_fingerprint", "ai_name", "catalog_version", "request_fingerprint", "intent_fingerprint", "source_wire_fingerprint",
      "parameters_fingerprint", "references_fingerprint", "expires_at"];
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expected.length + 1 && keys.includes(BRAND) && expected.every((key) => Object.hasOwn(descriptors, key) &&
      "value" in descriptors[key]!) && descriptors[BRAND]?.value === true && descriptors.status!.value === "nominal" &&
      descriptors.dispatch_allowed!.value === false && descriptors.backend_acceptance!.value === "UNPROVEN" &&
      typeof descriptors.mask_present!.value === "boolean" &&
      (descriptors.mask_binding_fingerprint!.value === null ||
        (typeof descriptors.mask_binding_fingerprint!.value === "string" && SHA256.test(descriptors.mask_binding_fingerprint!.value))) &&
      Number.isSafeInteger(descriptors.expires_at!.value);
  } catch { return false; }
}
function exact(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || own.some((key) => typeof key !== "string" || !keys.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) || required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
    const record = Object.create(null) as Record<string, any>;
    for (const key of own as string[]) record[key] = descriptors[key]!.value;
    return record;
  } catch (error) {
    if (error instanceof OwnerIdeogramImageOneShotPolicyError) throw error;
    fail("INVALID_REQUEST");
  }
}
function readArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail("CANDIDATE_UNBOUND");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("CANDIDATE_UNBOUND");
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}
function fail(code: OwnerIdeogramImageOneShotPolicyErrorCode): never { throw new OwnerIdeogramImageOneShotPolicyError(code); }
