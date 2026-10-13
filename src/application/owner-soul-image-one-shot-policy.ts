import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  OwnerSoulImageRequestPreparer,
  type OwnerSoulImagePreparedCandidate
} from "./owner-soul-image-request-preparer.js";
import type { OwnerSoulGenerationQuality, OwnerSoulGenerationResolution } from "./owner-soul-generation-parameters.js";
import { getOwnerSoulImageSourceProfile, type OwnerSoulImageSourceProfile } from "./owner-soul-image-source-profile.js";

const MODEL_ID = "higgsfield-soul" as const;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const TTL_MS = 15 * 60_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COST_KEYS = ["quality", "resolution", "batch_size"] as const;
const permitBrand: unique symbol = Symbol("OwnerSoulImageOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const permitsByCandidate = new WeakMap<object, object>();
const realCandidateGuard = OwnerSoulImageRequestPreparer.prototype.isPreparedCandidateForPrincipal;

export interface CreateOwnerSoulImageOneShotPermitInput {
  readonly preparer: OwnerSoulImageRequestPreparer;
  readonly candidate: OwnerSoulImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerSoulImageOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "NOMINAL_ONE_SHOT";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_execution: false;
  readonly profile_id: "owner-soul-image-source-profile-v1";
  readonly profile_schema_hash: string;
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof MODEL_ID;
  readonly model_type: typeof MODEL_ID;
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly candidate_fingerprint: string;
  readonly cost_routing: Readonly<{ ai_name: typeof MODEL_ID; model_type: typeof MODEL_ID }>;
  readonly cost_inputs: Readonly<{ quality: OwnerSoulGenerationQuality; resolution: OwnerSoulGenerationResolution; batch_size: 1 | 4 }>;
  readonly cost_confidence: "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY";
  readonly reference_strength: "UNRESOLVED_UNCONTROLLED_WIRE_FIELD";
  readonly expires_at_ms: number;
}

export interface ConsumeOwnerSoulImageOneShotPermitInput {
  readonly permit: OwnerSoulImageOneShotPermit;
  readonly candidate: OwnerSoulImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerSoulImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerSoulImageOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";

export class OwnerSoulImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerSoulImageOneShotPolicyErrorCode) {
    super("The owner Soul image one-shot policy could not be satisfied.");
    this.name = "OwnerSoulImageOneShotPolicyError";
  }
}

interface CandidateSnapshot {
  readonly fingerprint: string;
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
  readonly profileSchemaHash: string;
  readonly expiresAt: number;
  readonly costInputs: Readonly<{ quality: OwnerSoulGenerationQuality; resolution: OwnerSoulGenerationResolution; batch_size: 1 | 4 }>;
}

interface PermitState {
  readonly permit: OwnerSoulImageOneShotPermit;
  readonly preparer: OwnerSoulImageRequestPreparer;
  readonly candidate: OwnerSoulImagePreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalogVersion: typeof CATALOG_VERSION;
  readonly profileSchemaHash: string;
  readonly candidateSnapshot: CandidateSnapshot;
  readonly expiresAt: number;
  readonly now: () => number;
  lastNow: number;
  expired: boolean;
  consumed: boolean;
}

/** Creates a private process-local permit for one exact 821 candidate; it is not a provider or dispatch grant. */
export function createOwnerSoulImageOneShotPermit(input: CreateOwnerSoulImageOneShotPermitInput | unknown): OwnerSoulImageOneShotPermit {
  const fields = exactRecord(input, ["preparer", "candidate", "principal", "attemptId", "catalog", "catalog_version", "now"], ["now"]);
  const attemptId = readAttempt(fields.attemptId);
  const preparer = validatePreparer(fields.preparer);
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const catalog = validateCatalog(fields.catalog);
  if (fields.catalog_version !== CATALOG_VERSION ||
      (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now)))) fail("CATALOG_BINDING_MISMATCH");
  const now = (fields.now as (() => number) | undefined) ?? Date.now;
  const issuedAt = readClock(now);
  const candidate = requireCandidate(fields.candidate, preparer, principal, attemptId);
  const profile = readProfile(candidate, catalog, CATALOG_VERSION);
  const snapshot = snapshotCandidate(candidate, profile);
  if (permitsByCandidate.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  if (snapshot.expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");
  const expiresAt = Math.min(snapshot.expiresAt, issuedAt + TTL_MS);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");

  const permit: OwnerSoulImageOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "NOMINAL_ONE_SHOT" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const,
    provider_execution: false as const,
    profile_id: "owner-soul-image-source-profile-v1" as const,
    profile_schema_hash: snapshot.profileSchemaHash,
    model_id: MODEL_ID,
    ai_name: MODEL_ID,
    model_type: MODEL_ID,
    catalog_version: CATALOG_VERSION,
    request_fingerprint: snapshot.requestFingerprint,
    intent_fingerprint: snapshot.intentFingerprint,
    candidate_fingerprint: snapshot.fingerprint,
    cost_routing: Object.freeze({ ai_name: MODEL_ID, model_type: MODEL_ID }),
    cost_inputs: snapshot.costInputs,
    cost_confidence: "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
    source_projection_confidence: "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" as const,
    reference_strength: "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" as const,
    expires_at_ms: expiresAt
  });

  permitStates.set(permit, { permit, preparer, candidate, principal, attemptId, catalog, catalogVersion: CATALOG_VERSION,
    profileSchemaHash: snapshot.profileSchemaHash, candidateSnapshot: snapshot, expiresAt, now, lastNow: issuedAt,
    expired: false, consumed: false });
  permitsByCandidate.set(candidate, permit);
  return permit;
}

/** Consumes the exact permit once, immediately before a future native consumer's own dispatch boundary. */
export function consumeOwnerSoulImageOneShotPermit(input: ConsumeOwnerSoulImageOneShotPermitInput | unknown): OwnerSoulImageOneShotPermitReceipt {
  const fields = exactRecord(input, ["permit", "candidate", "principal", "attemptId"]);
  const attemptId = readAttempt(fields.attemptId);
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || isProxy(permit)) fail("PERMIT_INVALID");
  const state = permitStates.get(permit);
  if (!state || state.permit !== permit || !hasPermitBrand(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (state.expired) fail("PERMIT_EXPIRED");
  const now = readClock(state.now);
  if (now < state.lastNow) { state.expired = true; fail("CLOCK_INVALID"); }
  state.lastNow = now;
  if (now >= state.expiresAt) { state.expired = true; fail("PERMIT_EXPIRED"); }

  const principal = snapshotPrincipal(fields.principal, attemptId);
  if (attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (fields.candidate !== state.candidate || permitsByCandidate.get(state.candidate) !== permit) fail("CANDIDATE_MISMATCH");
  const candidate = requireCandidate(state.candidate, state.preparer, state.principal, state.attemptId);
  const profile = readProfile(candidate, state.catalog, state.catalogVersion);
  const current = snapshotCandidate(candidate, profile);
  if (current.expiresAt !== state.candidateSnapshot.expiresAt || now >= current.expiresAt) fail("CANDIDATE_EXPIRED");
  if (current.fingerprint !== state.candidateSnapshot.fingerprint || current.requestFingerprint !== permit.request_fingerprint ||
      current.intentFingerprint !== permit.intent_fingerprint || current.profileSchemaHash !== state.profileSchemaHash ||
      profile.profile_schema_hash !== permit.profile_schema_hash || current.expiresAt > permit.expires_at_ms ||
      permit.candidate_fingerprint !== current.fingerprint || !isDeepStrictEqual(permit.cost_inputs, current.costInputs) ||
      !isDeepStrictEqual(permit.cost_routing, { ai_name: MODEL_ID, model_type: MODEL_ID }) ||
      permit.cost_confidence !== "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP" ||
      permit.source_projection_confidence !== "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" ||
      permit.reference_strength !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" || permit.dispatch_allowed !== false ||
      permit.backend_acceptance !== "UNPROVEN" || permit.provider_execution !== false || permit.expires_at_ms !== state.expiresAt ||
      permit.catalog_version !== state.catalogVersion || permit.model_id !== MODEL_ID || permit.ai_name !== MODEL_ID ||
      permit.model_type !== MODEL_ID || permit.status !== "NOMINAL_ONE_SHOT") fail("CANDIDATE_MISMATCH");

  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: current.requestFingerprint });
}

function validatePreparer(value: unknown): OwnerSoulImageRequestPreparer {
  if (!value || typeof value !== "object" || isProxy(value) || !(value instanceof OwnerSoulImageRequestPreparer) ||
      Object.getPrototypeOf(value) !== OwnerSoulImageRequestPreparer.prototype ||
      Object.hasOwn(value, "isPreparedCandidateForPrincipal")) fail("INVALID_REQUEST");
  return value;
}

function validateCatalog(value: unknown): DiscoveryCatalogRepository {
  if (!value || typeof value !== "object" || isProxy(value) || !(value instanceof DiscoveryCatalogRepository) ||
      Object.getPrototypeOf(value) !== DiscoveryCatalogRepository.prototype) fail("INVALID_REQUEST");
  return value;
}

function requireCandidate(value: unknown, preparer: OwnerSoulImageRequestPreparer, principal: Readonly<GenerationPrincipalRef>,
  attemptId: string): OwnerSoulImagePreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("CANDIDATE_UNBOUND");
  let valid = false;
  try { valid = Reflect.apply(realCandidateGuard, preparer, [value, { attemptId, principal }]) === true; } catch { /* fail closed */ }
  if (!valid) fail("CANDIDATE_UNBOUND");
  return value as OwnerSoulImagePreparedCandidate;
}

function readProfile(candidate: OwnerSoulImagePreparedCandidate, catalog: DiscoveryCatalogRepository,
  catalogVersion: typeof CATALOG_VERSION): Readonly<OwnerSoulImageSourceProfile> {
  let profile: Readonly<OwnerSoulImageSourceProfile>;
  try { profile = getOwnerSoulImageSourceProfile(candidate.model_id, catalog, catalogVersion); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (candidate.model_id !== MODEL_ID || candidate.ai_name !== MODEL_ID || candidate.model_type !== MODEL_ID ||
      candidate.catalog_version !== CATALOG_VERSION || candidate.profile_id !== profile.profile_id ||
      candidate.profile_schema_hash !== profile.profile_schema_hash || !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
      candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" || candidate.provider_execution !== false ||
      candidate.status !== "PREPARED_SOURCE_SHAPED" || candidate.source_projection_confidence !== "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" ||
      candidate.reference_strength !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" || profile.dispatch_allowed !== false ||
      profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN" || profile.generation_readiness !== "SOURCE_PROFILE_ONLY_NOT_GENERATION_ADMISSION" ||
      !isDeepStrictEqual(profile.cost_policy.cost_input_keys, COST_KEYS) ||
      profile.cost_policy.projector !== "projectOwnerSoulImageCostParameters" ||
      profile.cost_policy.cost_inputs_confidence !== "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP" ||
      profile.cost_policy.query_is_generation_wire !== false || profile.cost_policy.generation_cost_inputs !== null ||
      !isDeepStrictEqual(profile.cost_policy.declared_model_info_keys, ["quality", "resolution", "batch_size", "version"]) ||
      profile.cost_policy.projection_status !== "JOINED_PARAMETER_DEFINITION_ONLY_NO_INTENT_VALUES" ||
      profile.cost_policy.version_value !== "UNRESOLVED_NOT_UI_CONTROL" || profile.cost_policy.quote_or_unit !== "UNPROVEN") {
    fail("CATALOG_BINDING_MISMATCH");
  }
  return profile;
}

function snapshotCandidate(candidate: OwnerSoulImagePreparedCandidate, profile: Readonly<OwnerSoulImageSourceProfile>): CandidateSnapshot {
  try {
    if (!Object.isFrozen(candidate) || isProxy(candidate)) fail("CANDIDATE_MISMATCH");
    const candidateFields = exactFrozenCandidate(candidate, ["status", "dispatch_allowed", "backend_acceptance", "provider_execution",
      "profile_id", "profile_schema_hash", "source_binding", "model_id", "ai_name", "model_type", "catalog_version", "parameters",
      "selection", "cost_routing", "cost_inputs", "cost_confidence", "source_projection_confidence", "reference_strength",
      "expires_at_ms", "request_fingerprint", "intent_fingerprint", "request"]);
    const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
    if (!requestDescriptor || !("value" in requestDescriptor) || requestDescriptor.enumerable !== false ||
        requestDescriptor.writable !== false || requestDescriptor.configurable !== false) fail("CANDIDATE_MISMATCH");
    const request = exactFrozenRecord(requestDescriptor.value, ["prompt", "settings"]);
    const promptPolicy = profile.parameters_source.prompt;
    if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
        Buffer.byteLength(request.prompt, "utf8") > promptPolicy.local_utf8_max_bytes ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(request.prompt)) fail("CANDIDATE_MISMATCH");
    const parameters = exactFrozenRecord(candidate.parameters, ["quality", "resolution", "batch_size", "enhance_prompt", "seed", "style", "character"]);
    const selection = exactFrozenRecord(candidate.selection, ["style", "character"]);
    const style = exactFrozenRecord(parameters.style, parameters.style && (parameters.style as Record<string, unknown>).kind === "selected" ? ["kind", "strength"] : ["kind"]);
    const character = exactFrozenRecord(parameters.character, ["kind"]);
    const settings = exactFrozenRecord(request.settings, ["n", "model_type", "quality", "resolution", "batch_size", "enhance_prompt", "seed",
      "style_id", "reference_id", "file_urls"], ["style_strength"]);
    if (candidateFields.request !== requestDescriptor.value || selection.style !== style.kind || selection.character !== character.kind ||
        !["none", "selected"].includes(style.kind as string) || !["none", "selected"].includes(character.kind as string) ||
        parameters.quality !== "720p" && parameters.quality !== "1080p" ||
        !profile.parameters_source.quality_resolution_pairs[parameters.quality as "720p" | "1080p"].includes(parameters.resolution as never) ||
        (parameters.batch_size !== 1 && parameters.batch_size !== 4) || typeof parameters.enhance_prompt !== "boolean" ||
        (parameters.seed !== null && (!Number.isSafeInteger(parameters.seed) || (parameters.seed as number) < 0 || (parameters.seed as number) > 2_147_483_647)) ||
        settings.n !== 1 || settings.model_type !== MODEL_ID || settings.quality !== parameters.quality ||
        settings.resolution !== parameters.resolution || settings.batch_size !== parameters.batch_size ||
        settings.enhance_prompt !== parameters.enhance_prompt || settings.seed !== parameters.seed ||
        !Array.isArray(settings.file_urls) || isProxy(settings.file_urls) || !Object.isFrozen(settings.file_urls) || settings.file_urls.length !== 0 ||
        Object.hasOwn(settings, "version") || Object.hasOwn(settings, "reference_strength") ||
        !isDeepStrictEqual(candidate.cost_routing, { ai_name: MODEL_ID, model_type: MODEL_ID }) ||
        !isExactFrozenRecord(candidate.cost_inputs, COST_KEYS) || candidate.cost_inputs.quality !== parameters.quality ||
        candidate.cost_inputs.resolution !== parameters.resolution || candidate.cost_inputs.batch_size !== parameters.batch_size ||
        candidate.cost_confidence !== "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP" ||
        !isSha256(candidate.request_fingerprint) || !isSha256(candidate.intent_fingerprint) ||
        !Number.isSafeInteger(candidate.expires_at_ms) || candidate.expires_at_ms < 0) fail("CANDIDATE_MISMATCH");

    if (style.kind === "none") {
      if (settings.style_id !== "" || Object.hasOwn(settings, "style_strength")) fail("CANDIDATE_MISMATCH");
    } else {
      const strength = style.strength;
      if (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0 || strength > 1 ||
          Math.abs(strength * 10 - Math.round(strength * 10)) > 1e-9 || typeof settings.style_id !== "string" ||
          settings.style_id.length === 0 || settings.style_strength !== strength) fail("CANDIDATE_MISMATCH");
    }
    if (character.kind === "none") {
      if (settings.reference_id !== "") fail("CANDIDATE_MISMATCH");
    } else if ((typeof settings.reference_id !== "string" && typeof settings.reference_id !== "number") ||
        (typeof settings.reference_id === "string" && settings.reference_id.length === 0) ||
        (typeof settings.reference_id === "number" && (!Number.isSafeInteger(settings.reference_id) || settings.reference_id < 0))) {
      fail("CANDIDATE_MISMATCH");
    }
    const fingerprint = schemaHash({ status: candidate.status, profile_id: candidate.profile_id,
      profile_schema_hash: candidate.profile_schema_hash, source_binding: candidate.source_binding,
      model_id: candidate.model_id, ai_name: candidate.ai_name, model_type: candidate.model_type,
      catalog_version: candidate.catalog_version, parameters: candidate.parameters, selection: candidate.selection,
      cost_routing: candidate.cost_routing, cost_inputs: candidate.cost_inputs, cost_confidence: candidate.cost_confidence,
      source_projection_confidence: candidate.source_projection_confidence, reference_strength: candidate.reference_strength,
      expires_at_ms: candidate.expires_at_ms, request_fingerprint: candidate.request_fingerprint,
      intent_fingerprint: candidate.intent_fingerprint, request: { prompt: request.prompt, settings } });
    return Object.freeze({ fingerprint, requestFingerprint: candidate.request_fingerprint, intentFingerprint: candidate.intent_fingerprint,
      profileSchemaHash: candidate.profile_schema_hash, expiresAt: candidate.expires_at_ms,
      costInputs: Object.freeze({ quality: candidate.cost_inputs.quality, resolution: candidate.cost_inputs.resolution,
        batch_size: candidate.cost_inputs.batch_size }) });
  } catch (error) {
    if (error instanceof OwnerSoulImageOneShotPolicyError) throw error;
    fail("CANDIDATE_MISMATCH");
  }
}

function exactFrozenRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || !Object.isFrozen(value)) fail("CANDIDATE_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("CANDIDATE_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value); const allowed = [...required, ...optional];
  const keys = Reflect.ownKeys(descriptors);
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true) ||
      keys.length < required.length || keys.length > allowed.length) fail("CANDIDATE_MISMATCH");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function exactFrozenCandidate(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || !Object.isFrozen(value)) fail("CANDIDATE_MISMATCH");
  const prototype = Object.getPrototypeOf(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!))) fail("CANDIDATE_MISMATCH");
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    if (key === "request") {
      if (descriptor.enumerable !== false || descriptor.writable !== false || descriptor.configurable !== false) fail("CANDIDATE_MISMATCH");
    } else if (descriptor.enumerable !== true) fail("CANDIDATE_MISMATCH");
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function isExactFrozenRecord(value: unknown, keys: readonly string[]): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || !Object.isFrozen(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value); const ownKeys = Reflect.ownKeys(descriptors);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key) &&
    "value" in descriptors[key]! && descriptors[key]!.enumerable === true);
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = [...required, ...optional]; const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.length > allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}
function readClock(now: () => number): number {
  let value: unknown;
  try { value = Reflect.apply(now, undefined, []); } catch { fail("CLOCK_INVALID"); }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("CLOCK_INVALID");
  return value;
}
function isSha256(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function hasPermitBrand(value: object): value is OwnerSoulImageOneShotPermit {
  return Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true;
}
function fail(code: OwnerSoulImageOneShotPolicyErrorCode): never { throw new OwnerSoulImageOneShotPolicyError(code); }
