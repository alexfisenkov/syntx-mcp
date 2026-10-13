import { isDeepStrictEqual, types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { getOwnerRunwayImageSourceProfile, type OwnerRunwayImageCatalogPort } from "./owner-runway-image-source-profile.js";
import { normalizeOwnerRunwayImageParameters } from "./owner-runway-image-parameters.js";
import {
  getOwnerRunwayImagePreparedCandidateState, isOwnerRunwayImagePreparedCandidateForPrincipal, observeOwnerRunwayImageCandidateClock,
  type OwnerRunwayImagePreparedCandidate
} from "./owner-runway-image-request-preparer.js";

const TTL_MS = 15 * 60_000;
const BRAND: unique symbol = Symbol("OwnerRunwayImageOneShotPermit");
const states = new WeakMap<object, PermitState>();
const candidatePermits = new WeakMap<object, object>();
export interface CreateOwnerRunwayImageOneShotPermitInput { readonly candidate: OwnerRunwayImagePreparedCandidate; readonly principal: GenerationPrincipalRef; readonly attemptId: string; readonly catalog: OwnerRunwayImageCatalogPort; readonly catalog_version: string; readonly now?: () => number; }
export interface OwnerRunwayImageOneShotPermit {
  readonly [BRAND]: true; readonly status: "nominal"; readonly dispatch_allowed: false; readonly profile_id: string; readonly profile_schema_hash: string;
  readonly variant: "runway_frames"; readonly model_id: "runway_frames"; readonly ai_name: "runway-frames";
  readonly public_catalog_version: string; readonly catalog_version: string; readonly request_fingerprint: string; readonly intent_fingerprint: string; readonly expires_at: number;
}
export interface ConsumeOwnerRunwayImageOneShotPermitInput { readonly permit: OwnerRunwayImageOneShotPermit; readonly candidate: OwnerRunwayImagePreparedCandidate; readonly principal: GenerationPrincipalRef; readonly attemptId: string; }
export interface OwnerRunwayImageOneShotPermitReceipt { readonly status: "consumed"; readonly dispatch_allowed: false; readonly request_fingerprint: string; }
export type OwnerRunwayImageOneShotPolicyErrorCode = "INVALID_REQUEST" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED" | "CANDIDATE_ALREADY_ISSUED" | "CATALOG_BINDING_MISMATCH" | "PERMIT_INVALID" | "PERMIT_EXPIRED" | "PERMIT_ALREADY_CONSUMED" | "PRINCIPAL_MISMATCH" | "CANDIDATE_MISMATCH" | "CLOCK_INVALID";
export class OwnerRunwayImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerRunwayImageOneShotPolicyErrorCode) { super("The owner Runway image one-shot policy could not be satisfied."); this.name = "OwnerRunwayImageOneShotPolicyError"; }
}
interface PermitState { permit: OwnerRunwayImageOneShotPermit; candidate: OwnerRunwayImagePreparedCandidate; principal: Readonly<GenerationPrincipalRef>; attemptId: string; catalog: OwnerRunwayImageCatalogPort; catalogVersion: string; candidateFingerprint: string; requestFingerprint: string; intentFingerprint: string; expiry: number; originalExpiry: number; now: () => number; lastNow: number; consumed: boolean; expired: boolean; }

/** A local nominal permit for one candidate. It is not account, plan, price, or dispatch approval. */
export function createOwnerRunwayImageOneShotPermit(input: CreateOwnerRunwayImageOneShotPermitInput | unknown): OwnerRunwayImageOneShotPermit {
  const f = exact(input, ["candidate", "principal", "attemptId", "catalog", "catalog_version", "now"], ["candidate", "principal", "attemptId", "catalog", "catalog_version"]);
  if (typeof f.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(f.attemptId) || typeof f.catalog_version !== "string" ||
      !f.catalog || typeof f.catalog !== "object" || (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(f.principal, f.attemptId); const now = (f.now as (() => number) | undefined) ?? Date.now; const current = readClock(now);
  const candidate = f.candidate as OwnerRunwayImagePreparedCandidate;
  if (!isOwnerRunwayImagePreparedCandidateForPrincipal(candidate, principal, f.attemptId, current)) fail("CANDIDATE_UNBOUND");
  const candidateState = getOwnerRunwayImagePreparedCandidateState(candidate); if (!candidateState) fail("CANDIDATE_UNBOUND");
  if (!observeOwnerRunwayImageCandidateClock(candidate, current)) fail("CANDIDATE_EXPIRED");
  let profile; try { profile = getOwnerRunwayImageSourceProfile(candidate.variant, f.catalog as OwnerRunwayImageCatalogPort, f.catalog_version); }
  catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (f.catalog_version !== profile.public_catalog_version || profile.variant !== candidate.variant || profile.dispatch_allowed !== false || profile.backend_acceptance !== "UNPROVEN") fail("CATALOG_BINDING_MISMATCH");
  const candidateFingerprint = validateCandidate(candidate, principal, f.attemptId as string, profile);
  if (candidatePermits.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const expiry = Math.min(candidateState.expires_at, current + TTL_MS);
  if (!Number.isSafeInteger(expiry) || expiry <= current) fail("CANDIDATE_EXPIRED");
  const permit: OwnerRunwayImageOneShotPermit = Object.freeze({ [BRAND]: true as const, status: "nominal", dispatch_allowed: false,
    profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash, variant: profile.variant, model_id: profile.model_id,
    ai_name: profile.ai_name, public_catalog_version: profile.public_catalog_version, catalog_version: f.catalog_version as string,
    request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint, expires_at: expiry });
  states.set(permit, { permit, candidate, principal, attemptId: f.attemptId as string, catalog: f.catalog as OwnerRunwayImageCatalogPort,
    catalogVersion: f.catalog_version as string, candidateFingerprint, requestFingerprint: candidate.request_fingerprint,
    intentFingerprint: candidate.intent_fingerprint, expiry, originalExpiry: candidateState.expires_at, now, lastNow: current, consumed: false, expired: false });
  candidatePermits.set(candidate, permit); return permit;
}

/** Synchronously consumes the nominal permit before a later adapter's one POST. */
export function consumeOwnerRunwayImageOneShotPermit(input: ConsumeOwnerRunwayImageOneShotPermitInput | unknown): OwnerRunwayImageOneShotPermitReceipt {
  const f = exact(input, ["permit", "candidate", "principal", "attemptId"]);
  if (typeof f.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(f.attemptId)) fail("INVALID_REQUEST");
  const permit = f.permit as OwnerRunwayImageOneShotPermit; if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = states.get(permit); if (!state || state.permit !== permit || !hasPermitShape(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED"); if (state.expired) fail("PERMIT_EXPIRED");
  const now = readClock(state.now);
  if (now < state.lastNow) { state.expired = true; observeOwnerRunwayImageCandidateClock(state.candidate, now); fail("CLOCK_INVALID"); }
  state.lastNow = now;
  if (now >= state.expiry || now >= state.originalExpiry) { state.expired = true; fail("PERMIT_EXPIRED"); }
  if (!observeOwnerRunwayImageCandidateClock(state.candidate, now)) { state.expired = true; fail("CANDIDATE_EXPIRED"); }
  const principal = snapshotPrincipal(f.principal, f.attemptId);
  if (f.attemptId !== state.attemptId || !sameGenerationPrincipal(principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  if (f.candidate !== state.candidate || candidatePermits.get(state.candidate) !== permit || !isOwnerRunwayImagePreparedCandidateForPrincipal(state.candidate, state.principal, state.attemptId, now)) fail("CANDIDATE_MISMATCH");
  let profile; try { profile = getOwnerRunwayImageSourceProfile(state.candidate.variant, state.catalog, state.catalogVersion); } catch { fail("CATALOG_BINDING_MISMATCH"); }
  if (permit.request_fingerprint !== state.requestFingerprint || permit.intent_fingerprint !== state.intentFingerprint ||
      permit.profile_schema_hash !== profile.profile_schema_hash || permit.profile_id !== profile.profile_id || permit.public_catalog_version !== profile.public_catalog_version ||
      permit.catalog_version !== state.catalogVersion || validateCandidate(state.candidate, state.principal, state.attemptId, profile) !== state.candidateFingerprint) fail("CANDIDATE_MISMATCH");
  state.consumed = true; return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.requestFingerprint });
}

function validateCandidate(candidate: OwnerRunwayImagePreparedCandidate, principal: Readonly<GenerationPrincipalRef>, attemptId: string, profile: ReturnType<typeof getOwnerRunwayImageSourceProfile>): string {
  const state = getOwnerRunwayImagePreparedCandidateState(candidate);
  if (!state || state.attempt_id !== attemptId || !sameGenerationPrincipal(state.principal, principal) || candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.profile_id !== profile.profile_id || candidate.profile_schema_hash !== profile.profile_schema_hash || !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
      candidate.model_id !== "runway_frames" || candidate.ai_name !== "runway-frames" || candidate.variant !== "runway_frames" || candidate.model_type !== "runway_frames" || candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
      candidate.prompt_local_max_utf8_bytes !== 65_536 || candidate.prompt_limit_confidence !== "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT" || candidate.cost_inputs === null || Object.keys(candidate.cost_inputs).length !== 0 ||
      candidate.references.length !== candidate.reference_count || candidate.request_fingerprint !== state.fingerprint || candidate.intent_fingerprint !== state.intent_fingerprint) fail("CANDIDATE_UNBOUND");
  const request = exact(candidate.request, ["prompt", "settings"]); const settings = exact(request.settings, ["n", "model_type", "resolution", "temperature", "file_urls"]);
  if (request.prompt !== candidate.prompt || settings.n !== 1 || settings.model_type !== "runway_frames" || !Array.isArray(settings.file_urls) || !Object.isFrozen(settings.file_urls) ||
      settings.file_urls.length !== candidate.reference_count || !Object.isFrozen(candidate.request) || !Object.isFrozen(request.settings)) fail("CANDIDATE_UNBOUND");
  let normalized; try { normalized = normalizeOwnerRunwayImageParameters({ variant: "runway_frames", reference_count: candidate.reference_count, parameters: candidate.parameters }); } catch { fail("CANDIDATE_UNBOUND"); }
  if (!isDeepStrictEqual(normalized.parameters, candidate.parameters) || settings.resolution !== normalized.parameters.resolution || settings.temperature !== normalized.parameters.temperature ||
      normalized.source_wire_settings.resolution !== settings.resolution || normalized.source_wire_settings.temperature !== settings.temperature || normalized.source_wire_settings.n !== settings.n) fail("CANDIDATE_UNBOUND");
  const urls: string[] = [];
  for (let i = 0; i < candidate.references.length; i += 1) {
    const metadata = exact(candidate.references[i], ["mime_type", "width", "height", "size", "sha256", "metadata_confidence"]);
    const wire = exact(settings.file_urls[i], ["type", "url"]);
    if (wire.type !== "image" || typeof wire.url !== "string" || !isSafeUploadReferenceUrl(wire.url) || !["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"].includes(metadata.mime_type as string) ||
        !Number.isSafeInteger(metadata.size) || (metadata.size as number) <= 0 || (metadata.size as number) > 33_554_432 || typeof metadata.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(metadata.sha256) ||
        !(metadata.width === null || Number.isSafeInteger(metadata.width) && (metadata.width as number) > 0) || !(metadata.height === null || Number.isSafeInteger(metadata.height) && (metadata.height as number) > 0) ||
        (metadata.metadata_confidence !== "CONTAINER_METADATA_ONLY" && metadata.metadata_confidence !== "UNKNOWN")) fail("CANDIDATE_UNBOUND");
    urls.push(wire.url);
  }
  if (new Set(urls).size !== urls.length) fail("CANDIDATE_UNBOUND");
  return schemaHash({ status: candidate.status, profile_id: candidate.profile_id, profile_schema_hash: candidate.profile_schema_hash, source_binding: candidate.source_binding,
    prompt: candidate.prompt, parameters: candidate.parameters, reference_count: candidate.reference_count, references: candidate.references,
    request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint, request: candidate.request });
}
function hasPermitShape(value: object): boolean {
  if (types.isProxy(value) || !Object.isFrozen(value)) return false;
  try { const d = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>; const keys = Reflect.ownKeys(d); const expected = ["status", "dispatch_allowed", "profile_id", "profile_schema_hash", "variant", "model_id", "ai_name", "public_catalog_version", "catalog_version", "request_fingerprint", "intent_fingerprint", "expires_at"];
    return keys.length === expected.length + 1 && keys.includes(BRAND) && expected.every((k) => Object.hasOwn(d, k) && "value" in d[k]!) &&
      keys.every((k) => typeof k === "symbol" || expected.includes(k)) && d[BRAND]?.value === true && d.status!.value === "nominal" && d.dispatch_allowed!.value === false && Number.isSafeInteger(d.expires_at!.value);
  } catch { return false; }
}
function snapshotPrincipal(value: unknown, attemptId: unknown): Readonly<GenerationPrincipalRef> { if (typeof attemptId !== "string") fail("INVALID_REQUEST"); let p: Readonly<GenerationPrincipalRef>; try { p = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); } if (p.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH"); return p; }
function readClock(now: () => number): number { let n: number; try { n = now(); } catch { fail("CLOCK_INVALID"); } if (!Number.isSafeInteger(n) || n < 0) fail("CLOCK_INVALID"); return n; }
function exact(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const p = Object.getPrototypeOf(value); if (p !== Object.prototype && p !== null) fail("INVALID_REQUEST"); const d = Object.getOwnPropertyDescriptors(value); const own = Reflect.ownKeys(d);
    if (own.some((k) => typeof k !== "string" || !keys.includes(k) || !("value" in d[k]!) || !d[k]!.enumerable) || required.some((k) => !Object.hasOwn(d, k))) fail("INVALID_REQUEST");
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const k of own as string[]) out[k] = d[k]!.value; return out;
  } catch (e) { if (e instanceof OwnerRunwayImageOneShotPolicyError) throw e; fail("INVALID_REQUEST"); }
}
function fail(code: OwnerRunwayImageOneShotPolicyErrorCode): never { throw new OwnerRunwayImageOneShotPolicyError(code); }
