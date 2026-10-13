import { isDeepStrictEqual } from "node:util";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerGrokT2iSourceProfile,
  type OwnerGrokT2iCatalogPort,
  type OwnerGrokT2iSourceProfile
} from "./owner-grok-t2i-source-profile.js";
import {
  projectOwnerGrokT2iCostParameters
} from "./owner-grok-t2i-cost-parameters.js";
import {
  normalizeOwnerGrokT2iParameters,
  type OwnerGrokT2iModel
} from "./owner-grok-t2i-parameters.js";
import {
  OwnerGrokT2iRequestPreparer,
  type OwnerGrokT2iPreparedCandidate
} from "./owner-grok-t2i-request-preparer.js";

const TTL_MS = 15 * 60_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_WIRE_BINDING = Object.freeze({ helper: "video.js", build_id: "1791467421",
  sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
  confidence: "SOURCE_MAPPED_ORDINARY_EXPLICIT_NOT_RENDERED_GROK_SUBMIT" });
const permitBrand: unique symbol = Symbol("OwnerGrokT2iOneShotPermit");
const permitStates = new WeakMap<object, PermitState>();
const permitsByCandidate = new WeakMap<object, object>();
const realCandidateGuard = OwnerGrokT2iRequestPreparer.prototype.isPreparedCandidateForPrincipal;

export interface CreateOwnerGrokT2iOneShotPermitInput {
  readonly preparer: OwnerGrokT2iRequestPreparer;
  readonly candidate: OwnerGrokT2iPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly catalog: OwnerGrokT2iCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}
export interface OwnerGrokT2iOneShotPermit {
  readonly [permitBrand]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly ai_name: "grok_image";
  readonly public_catalog_version: string;
  readonly catalog_version: string;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly candidate_fingerprint: string;
  readonly expires_at: number;
}
export interface ConsumeOwnerGrokT2iOneShotPermitInput {
  readonly permit: OwnerGrokT2iOneShotPermit;
  readonly candidate: OwnerGrokT2iPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
export interface OwnerGrokT2iOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}
export type OwnerGrokT2iOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED"
  | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED"
  | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";

export class OwnerGrokT2iOneShotPolicyError extends Error {
  constructor(readonly code: OwnerGrokT2iOneShotPolicyErrorCode) {
    super("The owner Grok T2I one-shot policy could not be satisfied.");
    this.name = "OwnerGrokT2iOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerGrokT2iOneShotPermit;
  readonly preparer: OwnerGrokT2iRequestPreparer;
  readonly candidate: OwnerGrokT2iPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly catalog: OwnerGrokT2iCatalogPort;
  readonly catalog_version: string;
  readonly profile: Readonly<OwnerGrokT2iSourceProfile>;
  readonly candidate_expires_at: number;
  readonly expires_at: number;
  readonly candidate_fingerprint: string;
  readonly now: () => number;
  last_now: number;
  expired: boolean;
  consumed: boolean;
}

/** Creates an in-process permit for one frozen preparer candidate; it conveys no cost or provider approval. */
export function createOwnerGrokT2iOneShotPermit(input: CreateOwnerGrokT2iOneShotPermitInput | unknown): OwnerGrokT2iOneShotPermit {
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
  const permit: OwnerGrokT2iOneShotPermit = Object.freeze({
    [permitBrand]: true as const, status: "nominal" as const, dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const, profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
    model_id: profile.model_id, ai_name: profile.ai_name, public_catalog_version: profile.public_catalog_version,
    catalog_version: fields.catalog_version as string, request_fingerprint: candidate.request_fingerprint,
    intent_fingerprint: candidate.intent_fingerprint, candidate_fingerprint: candidateFingerprint, expires_at: expiresAt
  });
  permitStates.set(permit, { permit, preparer, candidate, principal, attemptId, catalog, catalog_version: fields.catalog_version as string,
    profile, candidate_expires_at: candidate.expires_at, expires_at: expiresAt, candidate_fingerprint: candidateFingerprint,
    now, last_now: issuedAt, expired: false, consumed: false });
  permitsByCandidate.set(candidate, permit);
  return permit;
}

/** Synchronously consumes one exact permit; the caller must do so immediately before its single native POST. */
export function consumeOwnerGrokT2iOneShotPermit(input: ConsumeOwnerGrokT2iOneShotPermitInput | unknown): OwnerGrokT2iOneShotPermitReceipt {
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
      permit.catalog_version !== state.catalog_version || permit.expires_at !== state.expires_at) fail("CANDIDATE_MISMATCH");
  state.consumed = true;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: candidate.request_fingerprint });
}

function validatePreparer(value: unknown): OwnerGrokT2iRequestPreparer {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof OwnerGrokT2iRequestPreparer) ||
      Object.getPrototypeOf(value) !== OwnerGrokT2iRequestPreparer.prototype || Object.hasOwn(value, "isPreparedCandidateForPrincipal")) fail("INVALID_REQUEST");
  return value;
}

function validateCatalogPort(value: unknown): OwnerGrokT2iCatalogPort {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as OwnerGrokT2iCatalogPort;
}

function requireCandidate(value: unknown, preparer: OwnerGrokT2iRequestPreparer, principal: Readonly<GenerationPrincipalRef>, attemptId: string): OwnerGrokT2iPreparedCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("CANDIDATE_UNBOUND");
  let valid = false;
  try { valid = Reflect.apply(realCandidateGuard, preparer, [value, principal, attemptId]) as boolean; } catch { /* fail closed */ }
  if (!valid) fail("CANDIDATE_UNBOUND");
  const candidate = value as OwnerGrokT2iPreparedCandidate;
  if (!Object.isFrozen(candidate) || candidate.status !== "blocked" || candidate.source_readiness !== "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT" ||
      candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" || !ATTEMPT.test(attemptId) ||
      candidate.model_id !== candidate.model_type || candidate.ai_name !== "grok_image" || candidate.scope !== "image" ||
      candidate.operation_id !== "generate-image" || !SHA256.test(candidate.request_fingerprint) || !SHA256.test(candidate.intent_fingerprint)) fail("CANDIDATE_UNBOUND");
  return candidate;
}

function readProfile(candidate: OwnerGrokT2iPreparedCandidate, catalog: OwnerGrokT2iCatalogPort, catalogVersion: string): Readonly<OwnerGrokT2iSourceProfile> {
  let profile: Readonly<OwnerGrokT2iSourceProfile>;
  try { profile = getOwnerGrokT2iSourceProfile(candidate.model_id, catalog, catalogVersion); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (catalogVersion !== profile.public_catalog_version || candidate.profile_id !== profile.profile_id ||
      candidate.profile_schema_hash !== profile.profile_schema_hash || !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
      candidate.model_id !== profile.model_id || candidate.ai_name !== profile.ai_name || candidate.model_type !== profile.model_type) fail("CATALOG_BINDING_MISMATCH");
  return profile;
}

function fingerprintCandidate(candidate: OwnerGrokT2iPreparedCandidate, profile: Readonly<OwnerGrokT2iSourceProfile>): string {
  try {
    const normalized = normalizeOwnerGrokT2iParameters({ model_id: candidate.model_id, reference_count: candidate.reference_count, parameters: candidate.parameters });
    const cost = projectOwnerGrokT2iCostParameters({ model_id: candidate.model_id, reference_count: candidate.reference_count, parameters: candidate.parameters });
    if (!isDeepStrictEqual(candidate.parameters, normalized.parameters) || !isDeepStrictEqual(candidate.cost_routing, cost.routing) ||
        !isDeepStrictEqual(candidate.cost_inputs, cost.cost_inputs) || !isDeepStrictEqual(candidate.source_cost_binding, cost.source_binding) ||
        !isDeepStrictEqual(candidate.source_wire_binding, SOURCE_WIRE_BINDING) || candidate.cost_input_confidence !== cost.confidence ||
        candidate.reference_count !== candidate.references.length) fail("CANDIDATE_MISMATCH");
    const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
    if (!requestDescriptor || !("value" in requestDescriptor) || requestDescriptor.enumerable || requestDescriptor.writable ||
        !requestDescriptor.value || typeof requestDescriptor.value !== "object" || types.isProxy(requestDescriptor.value)) fail("CANDIDATE_MISMATCH");
    const request = requestDescriptor.value as OwnerGrokT2iPreparedCandidate["request"];
    if (!Object.isFrozen(request) || !Object.isFrozen(request.settings) || typeof request.prompt !== "string" || !request.prompt.trim()) fail("CANDIDATE_MISMATCH");
    const expectedKeys = ["n", "model_type", "aspect_ratio", "resolution", "batch_size", ...(candidate.model_id === "grok_imagine_2" ? ["details_quality"] : []), "file_urls"].sort();
    if (!isExactFrozenRecord(request.settings, expectedKeys)) fail("CANDIDATE_MISMATCH");
    const settings = request.settings;
    if (settings.n !== 1 || settings.model_type !== candidate.model_id || settings.aspect_ratio !== candidate.parameters.aspect_ratio ||
        settings.resolution !== candidate.parameters.resolution || settings.batch_size !== candidate.parameters.batch_size ||
        (candidate.model_id === "grok_imagine_2" && settings.details_quality !== candidate.parameters.details_quality)) fail("CANDIDATE_MISMATCH");
    const fileUrls = settings.file_urls;
    if (!Array.isArray(fileUrls) || !Object.isFrozen(fileUrls) || fileUrls.length !== candidate.reference_count) fail("CANDIDATE_MISMATCH");
    const orderedUrls: string[] = [];
    for (const item of fileUrls) {
      if (!item || typeof item !== "object" || types.isProxy(item) || !isExactFrozenRecord(item, ["type", "url"]) ||
          item.type !== "image" || typeof item.url !== "string" || !isSafeUploadReferenceUrl(item.url)) fail("CANDIDATE_MISMATCH");
      orderedUrls.push(item.url);
    }
    for (const reference of candidate.references) {
      if (!reference || typeof reference !== "object" || types.isProxy(reference) || !Object.isFrozen(reference) ||
          !SHA256.test(reference.sha256) || !Number.isSafeInteger(reference.size) || reference.size <= 0) fail("CANDIDATE_MISMATCH");
    }
    return schemaHash({ model_id: candidate.model_id, ai_name: candidate.ai_name, model_type: candidate.model_type,
      profile_id: candidate.profile_id, profile_schema_hash: candidate.profile_schema_hash, source_binding: profile.source_binding,
      parameters: normalized.parameters, reference_count: candidate.reference_count, references: candidate.references,
      source_wire_binding: SOURCE_WIRE_BINDING, source_cost_binding: cost.source_binding,
      cost_routing: cost.routing, cost_inputs: cost.cost_inputs, cost_input_confidence: cost.confidence,
      request: { prompt: request.prompt, settings }, ordered_reference_urls: orderedUrls,
      request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint, expires_at: candidate.expires_at });
  } catch (error) {
    if (error instanceof OwnerGrokT2iOneShotPolicyError) throw error;
    fail("CANDIDATE_MISMATCH");
  }
}

function isExactFrozenRecord(value: unknown, keys: readonly string[]): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  return actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key) &&
    "value" in descriptors[key]! && descriptors[key]!.enumerable === true);
}

function snapshotPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.length > required.length + optional.length || keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
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
function hasPermitBrand(value: object): value is OwnerGrokT2iOneShotPermit {
  return Object.getOwnPropertyDescriptor(value, permitBrand)?.value === true;
}
function fail(code: OwnerGrokT2iOneShotPolicyErrorCode): never { throw new OwnerGrokT2iOneShotPolicyError(code); }
