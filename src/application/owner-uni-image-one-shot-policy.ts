import { isDeepStrictEqual } from "node:util";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerUniImageSourceProfile,
  type OwnerUniImageSourceProfile,
  type OwnerUniImageSourceProfileCatalogPort
} from "./owner-uni-image-source-profile.js";
import {
  OwnerUniImageRequestPreparer,
  type OwnerUniImagePreparedCandidate
} from "./owner-uni-image-request-preparer.js";
import type { OwnerUniImageModel } from "./owner-uni-image-parameters.js";

const TTL_MS = 15 * 60_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const permitBrand: unique symbol = Symbol("OwnerUniImageOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const permitsByCandidate = new WeakMap<object, object>();
const realCandidateGuard = OwnerUniImageRequestPreparer.prototype.isPreparedCandidateForPrincipal;

export interface CreateOwnerUniImageOneShotPermitInput {
  readonly preparer: OwnerUniImageRequestPreparer;
  readonly candidate: OwnerUniImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: OwnerUniImageSourceProfileCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerUniImageOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly upload_profile_schema_hash: string;
  readonly model_id: OwnerUniImageModel;
  readonly ai_name: "luma_image";
  readonly public_catalog_version: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly candidate_fingerprint: string;
  readonly cost_input_confidence: "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION";
  readonly expires_at: number;
}

export interface ConsumeOwnerUniImageOneShotPermitInput {
  readonly permit: OwnerUniImageOneShotPermit;
  readonly candidate: OwnerUniImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerUniImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerUniImageOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";

export class OwnerUniImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerUniImageOneShotPolicyErrorCode) {
    super("The owner Uni image one-shot policy could not be satisfied.");
    this.name = "OwnerUniImageOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerUniImageOneShotPermit;
  readonly preparer: OwnerUniImageRequestPreparer;
  readonly candidate: OwnerUniImagePreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly catalog: OwnerUniImageSourceProfileCatalogPort;
  readonly catalog_version: string;
  readonly profile: Readonly<OwnerUniImageSourceProfile>;
  readonly candidate_expires_at: number;
  readonly expires_at: number;
  readonly candidate_fingerprint: string;
  readonly now: () => number;
  last_now: number;
  expired: boolean;
  consumed: boolean;
}

/** Creates a process-local permit for one exact 803 candidate; it is not a dispatch or provider grant. */
export function createOwnerUniImageOneShotPermit(input: CreateOwnerUniImageOneShotPermitInput | unknown): OwnerUniImageOneShotPermit {
  const fields = exact(input, ["preparer", "candidate", "principal", "attemptId", "catalog", "catalog_version"], ["now"]);
  const attemptId = readAttempt(fields.attemptId);
  const preparer = validatePreparer(fields.preparer);
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const catalog = validateCatalogPort(fields.catalog);
  if (typeof fields.catalog_version !== "string" || (fields.now !== undefined &&
      (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
  const now = (fields.now as (() => number) | undefined) ?? Date.now;
  const issuedAt = readClock(now);
  const candidate = requireCandidate(fields.candidate, preparer, principal, attemptId);
  const profile = readProfile(candidate, catalog, fields.catalog_version as string);
  const candidateFingerprint = fingerprintCandidate(candidate, profile);
  if (permitsByCandidate.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  if (candidate.expires_at <= issuedAt) fail("CANDIDATE_EXPIRED");
  const expiresAt = Math.min(candidate.expires_at, issuedAt + TTL_MS);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");
  const uploadProfileSchemaHash = profile.source_binding.upload_profile_reference.schema_hash;
  if (!SHA256.test(uploadProfileSchemaHash)) fail("CATALOG_BINDING_MISMATCH");
  const permit: OwnerUniImageOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "nominal" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    upload_profile_schema_hash: uploadProfileSchemaHash,
    model_id: profile.model_id,
    ai_name: profile.ai_name,
    public_catalog_version: profile.public_catalog_version,
    catalog_version: fields.catalog_version as string,
    request_fingerprint: candidate.request_fingerprint,
    intent_fingerprint: candidate.intent_fingerprint,
    candidate_fingerprint: candidateFingerprint,
    cost_input_confidence: candidate.cost_input_confidence,
    expires_at: expiresAt
  });
  permitStates.set(permit, { permit, preparer, candidate, principal, attemptId, catalog,
    catalog_version: fields.catalog_version as string, profile, candidate_expires_at: candidate.expires_at,
    expires_at: expiresAt, candidate_fingerprint: candidateFingerprint, now, last_now: issuedAt,
    expired: false, consumed: false });
  permitsByCandidate.set(candidate, permit);
  return permit;
}

/** Synchronously consumes one exact permit; a later native consumer must still own the single dispatch. */
export function consumeOwnerUniImageOneShotPermit(input: ConsumeOwnerUniImageOneShotPermitInput | unknown): OwnerUniImageOneShotPermitReceipt {
  const fields = exact(input, ["permit", "candidate", "principal", "attemptId"]);
  const attemptId = readAttempt(fields.attemptId);
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !hasPermitBrand(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.expired) fail("PERMIT_EXPIRED");
  const now = readClock(state.now);
  if (now < state.last_now) { state.expired = true; fail("CLOCK_INVALID"); }
  state.last_now = now;
  if (now >= state.expires_at) { state.expired = true; fail("PERMIT_EXPIRED"); }
  if (state.candidate.expires_at !== state.candidate_expires_at || now >= state.candidate_expires_at) fail("CANDIDATE_EXPIRED");
  const principal = snapshotPrincipal(fields.principal, attemptId);
  if (attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate || permitsByCandidate.get(state.candidate) !== permit) fail("CANDIDATE_MISMATCH");
  const candidate = requireCandidate(state.candidate, state.preparer, state.principal, state.attemptId);
  const profile = readProfile(candidate, state.catalog, state.catalog_version);
  const currentFingerprint = fingerprintCandidate(candidate, profile);
  if (currentFingerprint !== state.candidate_fingerprint || permit.candidate_fingerprint !== state.candidate_fingerprint ||
      permit.request_fingerprint !== candidate.request_fingerprint || permit.intent_fingerprint !== candidate.intent_fingerprint ||
      permit.profile_schema_hash !== profile.profile_schema_hash || permit.profile_id !== profile.profile_id ||
      permit.upload_profile_schema_hash !== profile.source_binding.upload_profile_reference.schema_hash ||
      permit.cost_input_confidence !== candidate.cost_input_confidence || permit.catalog_version !== state.catalog_version ||
      permit.expires_at !== state.expires_at) fail("CANDIDATE_MISMATCH");
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
}

function validatePreparer(value: unknown): OwnerUniImageRequestPreparer {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof OwnerUniImageRequestPreparer) ||
      Object.getPrototypeOf(value) !== OwnerUniImageRequestPreparer.prototype ||
      Object.hasOwn(value, "isPreparedCandidateForPrincipal")) fail("INVALID_REQUEST");
  return value;
}

function validateCatalogPort(value: unknown): OwnerUniImageSourceProfileCatalogPort {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as OwnerUniImageSourceProfileCatalogPort;
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function requireCandidate(value: unknown, preparer: OwnerUniImageRequestPreparer,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): OwnerUniImagePreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
  let valid = false;
  try { valid = Reflect.apply(realCandidateGuard, preparer, [value, principal, attemptId]) as boolean; } catch { /* fail closed */ }
  if (!valid) fail("CANDIDATE_UNBOUND");
  const candidate = value as OwnerUniImagePreparedCandidate;
  if (!Object.isFrozen(candidate) || candidate.status !== "blocked" ||
      candidate.source_readiness !== "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT" ||
      candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" || !ATTEMPT.test(attemptId) ||
      !isUniModel(candidate.model_id) || candidate.model_id !== candidate.model_type || candidate.ai_name !== "luma_image" ||
      candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
      !SHA256.test(candidate.profile_schema_hash) || !SHA256.test(candidate.request_fingerprint) ||
      !SHA256.test(candidate.intent_fingerprint)) fail("CANDIDATE_UNBOUND");
  return candidate;
}

function readProfile(candidate: OwnerUniImagePreparedCandidate, catalog: OwnerUniImageSourceProfileCatalogPort,
  catalogVersion: string): Readonly<OwnerUniImageSourceProfile> {
  let profile: Readonly<OwnerUniImageSourceProfile>;
  try { profile = getOwnerUniImageSourceProfile(candidate.model_id, catalog, catalogVersion); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (catalogVersion !== profile.public_catalog_version || candidate.profile_id !== profile.profile_id ||
      candidate.profile_schema_hash !== profile.profile_schema_hash ||
      !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
      candidate.model_id !== profile.model_id || candidate.ai_name !== profile.ai_name || candidate.model_type !== profile.model_type) {
    fail("CATALOG_BINDING_MISMATCH");
  }
  return profile;
}

function fingerprintCandidate(candidate: OwnerUniImagePreparedCandidate, profile: Readonly<OwnerUniImageSourceProfile>): string {
  try {
    validateParameters(candidate, profile);
    const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
    if (!requestDescriptor || !("value" in requestDescriptor) || requestDescriptor.enumerable || requestDescriptor.writable ||
        requestDescriptor.configurable || !requestDescriptor.value || typeof requestDescriptor.value !== "object" ||
        types.isProxy(requestDescriptor.value)) fail("CANDIDATE_MISMATCH");
    const request = requestDescriptor.value as OwnerUniImagePreparedCandidate["request"];
    if (!Object.isFrozen(request) || !Object.isFrozen(request.settings) || typeof request.prompt !== "string" ||
        !isWellFormedUnicode(request.prompt) || PROMPT_CONTROL.test(request.prompt) ||
        request.prompt.length + (request.prompt.match(/\n/gu)?.length ?? 0) > profile.parameters_source.prompt_policy.max_utf16_units ||
        !isPromptAllowed(request.prompt, candidate.model_id, candidate.reference_count, profile)) fail("CANDIDATE_MISMATCH");

    const customKeys = profile.parameters_source.custom_settings_fields_by_model[candidate.model_id];
    if (!isExactFrozenRecord(candidate.custom_settings, customKeys) || candidate.custom_settings.model_type !== candidate.model_id) fail("CANDIDATE_MISMATCH");
    const expectedCustomSettings = deepFreeze({ model_type: candidate.model_id, ...candidate.parameters });
    if (!isDeepStrictEqual(candidate.custom_settings, expectedCustomSettings)) fail("CANDIDATE_MISMATCH");

    const requestSettingsKeys = [...customKeys, "file_urls"];
    if (!isExactFrozenRecord(request.settings, requestSettingsKeys) ||
        !isDeepStrictEqual(request.settings, { ...candidate.custom_settings, file_urls: request.settings.file_urls })) fail("CANDIDATE_MISMATCH");
    const files = request.settings.file_urls;
    if (!Array.isArray(files) || types.isProxy(files) || Object.getPrototypeOf(files) !== Array.prototype ||
        !Object.isFrozen(files) || files.length !== candidate.reference_count) fail("CANDIDATE_MISMATCH");
    const fileUrls: string[] = [];
    for (const file of files) {
      if (!isExactFrozenRecord(file, ["type", "url"]) || file.type !== "image" || typeof file.url !== "string" ||
          !isSafeUploadReferenceUrl(file.url)) fail("CANDIDATE_MISMATCH");
      fileUrls.push(file.url);
    }
    if (new Set(fileUrls).size !== fileUrls.length) fail("CANDIDATE_MISMATCH");

    if (!Array.isArray(candidate.references) || types.isProxy(candidate.references) ||
        Object.getPrototypeOf(candidate.references) !== Array.prototype || !Object.isFrozen(candidate.references) ||
        candidate.reference_count !== candidate.references.length || candidate.reference_count < profile.reference_selection.minimum ||
        candidate.reference_count > profile.reference_selection.maximum) fail("CANDIDATE_MISMATCH");
    for (const reference of candidate.references) {
      if (!isExactFrozenRecord(reference, ["source_mime_type", "mime_type", "width", "height", "size", "sha256", "metadata_confidence"]) ||
          typeof reference.source_mime_type !== "string" || typeof reference.mime_type !== "string" ||
          typeof reference.width !== "number" || !Number.isSafeInteger(reference.width) || reference.width <= 0 ||
          typeof reference.height !== "number" || !Number.isSafeInteger(reference.height) || reference.height <= 0 ||
          typeof reference.size !== "number" || !Number.isSafeInteger(reference.size) || reference.size <= 0 || typeof reference.sha256 !== "string" ||
          !SHA256.test(reference.sha256) || reference.metadata_confidence !== "CONTAINER_METADATA_ONLY") fail("CANDIDATE_MISMATCH");
    }

    const sourceCost = profile.cost_routing;
    if (!isDeepStrictEqual(candidate.cost_routing, {
      ai_name: sourceCost.ai_name, model_type: sourceCost.model_type,
      declared_parameter_keys: sourceCost.declared_parameter_keys,
      confidence: "RESERVED_ROUTING_ONLY_NOT_QUOTE_OR_ADMISSION"
    }) || !isExactFrozenRecord(candidate.cost_inputs, []) || candidate.cost_input_confidence !== sourceCost.projection ||
        candidate.source_mapping_confidence !== profile.source_binding.confidence || candidate.defaults_injected !== false ||
        candidate.prompt_local_max_utf16_units !== profile.parameters_source.prompt_policy.max_utf16_units ||
        candidate.prompt_limit_confidence !== profile.parameters_source.prompt_policy.confidence) fail("CANDIDATE_MISMATCH");

    return schemaHash({ model_id: candidate.model_id, ai_name: candidate.ai_name, model_type: candidate.model_type,
      profile_id: candidate.profile_id, profile_schema_hash: candidate.profile_schema_hash,
      upload_profile_schema_hash: profile.source_binding.upload_profile_reference.schema_hash,
      source_binding: profile.source_binding, parameters: candidate.parameters, custom_settings: candidate.custom_settings,
      reference_count: candidate.reference_count, references: candidate.references,
      cost_routing: candidate.cost_routing, cost_inputs: candidate.cost_inputs,
      cost_input_confidence: candidate.cost_input_confidence, source_mapping_confidence: candidate.source_mapping_confidence,
      defaults_injected: candidate.defaults_injected, request: { prompt: request.prompt, settings: request.settings },
      ordered_file_urls: fileUrls, request_fingerprint: candidate.request_fingerprint,
      intent_fingerprint: candidate.intent_fingerprint, expires_at: candidate.expires_at });
  } catch (error) {
    if (error instanceof OwnerUniImageOneShotPolicyError) throw error;
    fail("CANDIDATE_MISMATCH");
  }
}

function validateParameters(candidate: OwnerUniImagePreparedCandidate, profile: Readonly<OwnerUniImageSourceProfile>): void {
  if (!candidate.parameters || typeof candidate.parameters !== "object" || types.isProxy(candidate.parameters) ||
      !Object.isFrozen(candidate.parameters)) fail("CANDIDATE_MISMATCH");
  const source = profile.parameters_source;
  if (candidate.model_id === "uni-1") {
    if (!isExactFrozenRecord(candidate.parameters, ["aspect_ratio", "seed", "mode"]) ||
        !source.controls.aspect_ratio.values.includes(candidate.parameters.aspect_ratio as never) ||
        !source.controls.mode.values.includes(candidate.parameters.mode as never) ||
        (candidate.parameters.mode === "manga" && !source.controls.aspect_ratio.manga_values.includes(candidate.parameters.aspect_ratio as never)) ||
        !isValidSeed(candidate.parameters.seed, source.controls.seed.minimum, source.controls.seed.maximum)) fail("CANDIDATE_MISMATCH");
  } else if (candidate.model_id === "uni-1.1-modify-image") {
    if (!isExactFrozenRecord(candidate.parameters, ["seed", "mode"]) ||
        !source.controls.mode.values.includes(candidate.parameters.mode as never) ||
        !isValidSeed(candidate.parameters.seed, source.controls.seed.minimum, source.controls.seed.maximum)) fail("CANDIDATE_MISMATCH");
  } else if (!isExactFrozenRecord(candidate.parameters, ["invert_mask"]) || typeof candidate.parameters.invert_mask !== "boolean") {
    fail("CANDIDATE_MISMATCH");
  }
}

function isValidSeed(value: unknown, minimum: number, maximum: number): boolean {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum);
}

function isPromptAllowed(prompt: string, modelId: OwnerUniImageModel, referenceCount: number,
  profile: Readonly<OwnerUniImageSourceProfile>): boolean {
  const policy = profile.parameters_source.models_by_id[modelId].prompt_policy;
  if (policy === "required") return prompt.trim().length > 0;
  return referenceCount >= 1;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

const PROMPT_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/u;

function isExactFrozenRecord(value: unknown, keys: readonly string[]): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  return actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key) &&
    "value" in descriptors[key]! && descriptors[key]!.enumerable === true);
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.length > allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function readClock(now: () => number): number {
  let value: unknown;
  try { value = Reflect.apply(now, undefined, []); } catch { fail("CLOCK_INVALID"); }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function isUniModel(value: unknown): value is OwnerUniImageModel {
  return value === "uni-1" || value === "uni-1.1-modify-image" || value === "uni-1.1-remove-background";
}
function hasPermitBrand(value: object): value is OwnerUniImageOneShotPermit {
  return Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true;
}
function fail(code: OwnerUniImageOneShotPolicyErrorCode): never { throw new OwnerUniImageOneShotPolicyError(code); }
