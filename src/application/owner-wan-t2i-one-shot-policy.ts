import { isDeepStrictEqual } from "node:util";
import { isProxy } from "node:util/types";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  OwnerWanT2iRequestPreparer,
  type OwnerWanT2iPreparedCandidate
} from "./owner-wan-t2i-request-preparer.js";
import {
  getOwnerWanT2iSourceProfile,
  OwnerWanT2iSourceProfileError,
  type OwnerWanT2iSourceProfile
} from "./owner-wan-t2i-source-profile.js";
import {
  normalizeOwnerWanT2iParameters,
  OwnerWanT2iParametersError,
  type OwnerWanT2iModel
} from "./owner-wan-t2i-parameters.js";
import { projectOwnerWanT2iCostParameters } from "./owner-wan-t2i-cost-parameters.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const PERMIT_TTL_MS = 15 * 60_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_PROJECTION = "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" as const;
const COST_CONFIDENCE = "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" as const;
const PREPARER_GUARD = OwnerWanT2iRequestPreparer.prototype.isPreparedCandidateForPrincipal;
const CATALOG_GET_MODEL = DiscoveryCatalogRepository.prototype.getModel;
const permitBrand: unique symbol = Symbol("OwnerWanT2iOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const permitsByCandidate = new WeakMap<object, object>();

export interface CreateOwnerWanT2iOneShotPermitInput {
  readonly preparer: OwnerWanT2iRequestPreparer;
  readonly candidate: OwnerWanT2iPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerWanT2iOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_execution: false;
  readonly profile_id: "owner-wan-t2i-source-profile-v1";
  readonly profile_schema_hash: string;
  readonly model_id: OwnerWanT2iModel;
  readonly ai_name: "wan_image";
  readonly model_type: OwnerWanT2iModel;
  readonly catalog_version: typeof CATALOG_VERSION;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly candidate_fingerprint: string;
  readonly cost_routing: Readonly<{ ai_name: "wan_image"; model_type: OwnerWanT2iModel }>;
  readonly cost_inputs: Readonly<{ batch_size: 1 | 2 | 3 | 4 }>;
  readonly cost_confidence: typeof COST_CONFIDENCE;
  readonly source_projection_confidence: typeof SOURCE_PROJECTION;
  readonly expires_at_ms: number;
}

export interface ConsumeOwnerWanT2iOneShotPermitInput {
  readonly permit: OwnerWanT2iOneShotPermit;
  readonly candidate: OwnerWanT2iPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface OwnerWanT2iOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerWanT2iOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";

export class OwnerWanT2iOneShotPolicyError extends Error {
  constructor(readonly code: OwnerWanT2iOneShotPolicyErrorCode) {
    super("The owner WAN T2I one-shot policy could not be satisfied.");
    this.name = "OwnerWanT2iOneShotPolicyError";
  }
}

interface CandidateSnapshot {
  readonly fingerprint: string;
  readonly modelId: OwnerWanT2iModel;
  readonly profileSchemaHash: string;
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
  readonly expiresAt: number;
  readonly costRouting: Readonly<{ ai_name: "wan_image"; model_type: OwnerWanT2iModel }>;
  readonly costInputs: Readonly<{ batch_size: 1 | 2 | 3 | 4 }>;
}

interface PermitState {
  readonly permit: OwnerWanT2iOneShotPermit;
  readonly preparer: OwnerWanT2iRequestPreparer;
  readonly candidate: OwnerWanT2iPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly catalog: DiscoveryCatalogRepository;
  readonly profile: Readonly<OwnerWanT2iSourceProfile>;
  readonly snapshot: CandidateSnapshot;
  readonly expiresAt: number;
  readonly now: () => number;
  lastNow: number;
  expired: boolean;
  consumed: boolean;
}

/** Creates one process-local permit for one exact 841 candidate; it is not a provider or dispatch grant. */
export function createOwnerWanT2iOneShotPermit(input: CreateOwnerWanT2iOneShotPermitInput | unknown): OwnerWanT2iOneShotPermit {
  const fields = exactRecord(input, ["preparer", "candidate", "principal", "attemptId", "catalog", "catalog_version"], ["now"]);
  const attemptId = readAttempt(fields.attemptId);
  const preparer = validatePreparer(fields.preparer);
  const principal = snapshotPrincipal(fields.principal, attemptId);
  const catalog = validateCatalog(fields.catalog);
  if (fields.catalog_version !== CATALOG_VERSION ||
      (fields.now !== undefined && (typeof fields.now !== "function" || isProxy(fields.now)))) fail("CATALOG_BINDING_MISMATCH");
  const now = (fields.now as (() => number) | undefined) ?? Date.now;
  const issuedAt = readClock(now);
  const candidate = requireCandidate(fields.candidate, preparer, principal, attemptId);
  const profile = readProfile(candidate, catalog);
  const snapshot = snapshotCandidate(candidate, profile);
  if (permitsByCandidate.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  if (snapshot.expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");
  if (issuedAt > Number.MAX_SAFE_INTEGER - PERMIT_TTL_MS) fail("CLOCK_INVALID");
  const expiresAt = Math.min(snapshot.expiresAt, issuedAt + PERMIT_TTL_MS);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= issuedAt) fail("CANDIDATE_EXPIRED");

  const permit: OwnerWanT2iOneShotPermit = Object.freeze({
    [permitBrand]: true as const,
    status: "nominal" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const,
    provider_execution: false as const,
    profile_id: profile.profile_id,
    profile_schema_hash: snapshot.profileSchemaHash,
    model_id: snapshot.modelId,
    ai_name: "wan_image" as const,
    model_type: snapshot.modelId,
    catalog_version: CATALOG_VERSION,
    request_fingerprint: snapshot.requestFingerprint,
    intent_fingerprint: snapshot.intentFingerprint,
    candidate_fingerprint: snapshot.fingerprint,
    cost_routing: Object.freeze({ ...snapshot.costRouting }),
    cost_inputs: Object.freeze({ ...snapshot.costInputs }),
    cost_confidence: COST_CONFIDENCE,
    source_projection_confidence: SOURCE_PROJECTION,
    expires_at_ms: expiresAt
  });
  permitStates.set(permit, { permit, preparer, candidate, principal, attemptId, catalog, profile, snapshot,
    expiresAt, now, lastNow: issuedAt, expired: false, consumed: false });
  permitsByCandidate.set(candidate, permit);
  return permit;
}

/** Synchronously consumes the exact nominal permit once; a future native method performs its own dispatch checks. */
export function consumeOwnerWanT2iOneShotPermit(input: ConsumeOwnerWanT2iOneShotPermitInput | unknown): OwnerWanT2iOneShotPermitReceipt {
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
  const profile = readProfile(candidate, state.catalog);
  const current = snapshotCandidate(candidate, profile);
  if (current.expiresAt !== state.snapshot.expiresAt || now >= current.expiresAt) fail("CANDIDATE_EXPIRED");
  if (current.fingerprint !== state.snapshot.fingerprint || current.profileSchemaHash !== state.profile.profile_schema_hash ||
      profile.profile_schema_hash !== state.profile.profile_schema_hash || current.modelId !== permit.model_id ||
      current.requestFingerprint !== permit.request_fingerprint || current.intentFingerprint !== permit.intent_fingerprint ||
      current.fingerprint !== permit.candidate_fingerprint || permit.profile_id !== profile.profile_id ||
      permit.catalog_version !== CATALOG_VERSION || permit.ai_name !== "wan_image" || permit.model_type !== current.modelId ||
      permit.status !== "nominal" || permit.dispatch_allowed !== false || permit.backend_acceptance !== "UNPROVEN" ||
      permit.provider_execution !== false || permit.expires_at_ms !== state.expiresAt ||
      !isDeepStrictEqual(permit.cost_routing, current.costRouting) || !isDeepStrictEqual(permit.cost_inputs, current.costInputs) ||
      permit.cost_confidence !== COST_CONFIDENCE || permit.source_projection_confidence !== SOURCE_PROJECTION) fail("CANDIDATE_MISMATCH");

  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: current.requestFingerprint });
}

function validatePreparer(value: unknown): OwnerWanT2iRequestPreparer {
  if (!value || typeof value !== "object" || isProxy(value) || !(value instanceof OwnerWanT2iRequestPreparer) ||
      Object.getPrototypeOf(value) !== OwnerWanT2iRequestPreparer.prototype ||
      Object.hasOwn(value, "isPreparedCandidateForPrincipal") ||
      OwnerWanT2iRequestPreparer.prototype.isPreparedCandidateForPrincipal !== PREPARER_GUARD) fail("INVALID_REQUEST");
  return value;
}

function validateCatalog(value: unknown): DiscoveryCatalogRepository {
  if (!value || typeof value !== "object" || isProxy(value) || !(value instanceof DiscoveryCatalogRepository) ||
      Object.getPrototypeOf(value) !== DiscoveryCatalogRepository.prototype || Object.hasOwn(value, "getModel") ||
      DiscoveryCatalogRepository.prototype.getModel !== CATALOG_GET_MODEL) fail("INVALID_REQUEST");
  return value;
}

function requireCandidate(value: unknown, preparer: OwnerWanT2iRequestPreparer,
  principal: Readonly<GenerationPrincipalRef>, attemptId: string): OwnerWanT2iPreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("CANDIDATE_UNBOUND");
  let valid = false;
  try { valid = Reflect.apply(PREPARER_GUARD, preparer, [value, { attemptId, principal }]) === true; }
  catch { /* fail closed */ }
  if (!valid) fail("CANDIDATE_UNBOUND");
  return value as OwnerWanT2iPreparedCandidate;
}

function readProfile(candidate: OwnerWanT2iPreparedCandidate,
  catalog: DiscoveryCatalogRepository): Readonly<OwnerWanT2iSourceProfile> {
  let profile: Readonly<OwnerWanT2iSourceProfile>;
  try { profile = getOwnerWanT2iSourceProfile(candidate.model_id, catalog, CATALOG_VERSION); }
  catch (error) {
    if (error instanceof OwnerWanT2iSourceProfileError) fail("CATALOG_BINDING_MISMATCH");
    fail("CATALOG_BINDING_MISMATCH");
  }
  if (candidate.profile_id !== profile.profile_id || candidate.profile_schema_hash !== profile.profile_schema_hash ||
      candidate.model_id !== profile.model_id || candidate.ai_name !== profile.ai_name ||
      candidate.scope !== profile.scope || candidate.operation_id !== profile.operation_id ||
      candidate.catalog_version !== profile.public_catalog_version || !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
      candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" || candidate.provider_execution !== false ||
      candidate.status !== "PREPARED_SOURCE_SHAPED" || candidate.defaults_injected !== false ||
      candidate.source_projection_confidence !== SOURCE_PROJECTION || profile.dispatch_allowed !== false ||
      profile.runtime_activation !== false || profile.backend_acceptance !== "UNPROVEN") fail("CATALOG_BINDING_MISMATCH");
  return profile;
}

function snapshotCandidate(candidate: OwnerWanT2iPreparedCandidate,
  profile: Readonly<OwnerWanT2iSourceProfile>): CandidateSnapshot {
  try {
    if (isProxy(candidate) || !Object.isFrozen(candidate)) fail("CANDIDATE_MISMATCH");
    const fields = exactFrozenCandidate(candidate, ["status", "dispatch_allowed", "backend_acceptance", "provider_execution",
      "profile_id", "profile_schema_hash", "source_binding", "model_id", "ai_name", "scope", "operation_id", "catalog_version",
      "parameters", "cost_routing", "cost_inputs", "cost_input_confidence", "source_projection_confidence", "defaults_injected",
      "expires_at_ms", "request_fingerprint", "intent_fingerprint", "request"]);
    const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
    if (!requestDescriptor || !("value" in requestDescriptor) || requestDescriptor.enumerable ||
        requestDescriptor.writable || requestDescriptor.configurable) fail("CANDIDATE_MISMATCH");
    const request = exactFrozenRecord(requestDescriptor.value, ["prompt", "settings"]);
    const parameters = exactFrozenRecord(candidate.parameters, ["aspect_ratio", "resolution", "batch_size", "prompt_extend",
      "seed", "color_palette", "bbox_list"]);
    const input = { model_id: candidate.model_id, prompt: request.prompt, parameters };
    const normalized = normalizeOwnerWanT2iParameters(input);
    const cost = projectOwnerWanT2iCostParameters(input);
    const normalizedParameters = normalized.source_bound_intent.parameters;
    if (schemaHash(parameters) !== schemaHash(normalizedParameters) || !isDeepStrictEqual(candidate.parameters, normalizedParameters) ||
        !isDeepStrictEqual(candidate.cost_routing, cost.routing) || !isDeepStrictEqual(candidate.cost_inputs, cost.cost_inputs) ||
        candidate.cost_input_confidence !== cost.confidence || !isDeepStrictEqual(candidate.cost_routing, normalized.cost_routing) ||
        !isDeepStrictEqual(candidate.cost_inputs, normalized.cost_inputs) ||
        schemaHash(request.settings) !== schemaHash(expectedRequestSettings(candidate.model_id, normalizedParameters)) ||
        !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
        candidate.profile_schema_hash !== profile.profile_schema_hash || candidate.profile_id !== profile.profile_id ||
        candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.provider_execution !== false || candidate.defaults_injected !== false ||
        candidate.source_projection_confidence !== SOURCE_PROJECTION) fail("CANDIDATE_MISMATCH");
    const expiresAt = fields.expires_at_ms;
    const requestFingerprint = fields.request_fingerprint;
    const intentFingerprint = fields.intent_fingerprint;
    if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < 0 ||
        typeof requestFingerprint !== "string" || !SHA256.test(requestFingerprint) ||
        typeof intentFingerprint !== "string" || !SHA256.test(intentFingerprint)) fail("CANDIDATE_MISMATCH");
    const modelId = candidate.model_id;
    const profileSchemaHash = profile.profile_schema_hash;
    const costRouting = Object.freeze({ ...cost.routing });
    const costInputs = Object.freeze({ ...cost.cost_inputs });
    const fingerprint = schemaHash({
      profile_id: profile.profile_id, profile_schema_hash: profileSchemaHash, source_binding: profile.source_binding,
      model_id: modelId, parameters: normalizedParameters, cost_routing: costRouting, cost_inputs: costInputs,
      cost_confidence: cost.confidence, source_projection_confidence: SOURCE_PROJECTION,
      request: { prompt: request.prompt, settings: request.settings }, request_fingerprint: requestFingerprint,
      intent_fingerprint: intentFingerprint, expires_at_ms: expiresAt
    });
    return Object.freeze({ fingerprint, modelId, profileSchemaHash, requestFingerprint, intentFingerprint,
      expiresAt, costRouting, costInputs });
  } catch (error) {
    if (error instanceof OwnerWanT2iOneShotPolicyError) throw error;
    if (error instanceof OwnerWanT2iParametersError) fail("CANDIDATE_MISMATCH");
    fail("CANDIDATE_MISMATCH");
  }
}

function expectedRequestSettings(modelId: OwnerWanT2iModel, parameters: OwnerWanT2iPreparedCandidate["parameters"]): Readonly<Record<string, unknown>> {
  return { n: 1, model_type: modelId, aspect_ratio: parameters.aspect_ratio, resolution: parameters.resolution,
    batch_size: parameters.batch_size, prompt_extend: parameters.prompt_extend, seed: parameters.seed,
    color_palette: null, bbox_list: [], file_urls: [] };
}

function exactFrozenCandidate(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || !Object.isFrozen(value)) fail("CANDIDATE_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== (key !== "request") ||
      descriptors[key]!.writable || descriptors[key]!.configurable)) fail("CANDIDATE_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function exactFrozenRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || !Object.isFrozen(value)) fail("CANDIDATE_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("CANDIDATE_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true ||
      descriptors[key]!.writable || descriptors[key]!.configurable)) fail("CANDIDATE_MISMATCH");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.length > required.length + optional.length || keys.some((key) => typeof key !== "string" ||
        (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) {
    fail("INVALID_REQUEST");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
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

function hasPermitBrand(value: object): value is OwnerWanT2iOneShotPermit {
  return Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true;
}

function fail(code: OwnerWanT2iOneShotPolicyErrorCode): never {
  throw new OwnerWanT2iOneShotPolicyError(code);
}
