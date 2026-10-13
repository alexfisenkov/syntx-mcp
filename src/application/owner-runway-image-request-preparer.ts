import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { normalizeOwnerRunwayImageParameters, type OwnerRunwayImageVariant } from "./owner-runway-image-parameters.js";
import { getOwnerRunwayImageSourceProfile, type OwnerRunwayImageCatalogPort, type OwnerRunwayImageSourceProfile } from "./owner-runway-image-source-profile.js";

const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_SETS = 128;
const MAX_FILE_BYTES = 33_554_432;
const MAX_PROMPT_BYTES = 65_536;
const HANDLE = /^runway_image_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export interface OwnerRunwayImageOwnedReferenceResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly variant: OwnerRunwayImageVariant;
  readonly model_id: OwnerRunwayImageVariant; readonly ai_name: "runway-frames"; readonly scope: "image";
  readonly operation_id: "generate-image"; readonly catalog_version: string; readonly profile_schema_hash: string;
  readonly reference_handle: string;
}
export interface OwnerRunwayImageOwnedReferenceResolution extends OwnerRunwayImageOwnedReferenceResolverContext {
  readonly file_url: string; readonly mime_type: string; readonly width: number | null; readonly height: number | null;
  readonly size: number; readonly sha256: string; readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY" | "UNKNOWN";
}
export type ResolveOwnerRunwayImageOwnedReference = (context: Readonly<OwnerRunwayImageOwnedReferenceResolverContext>) => Promise<OwnerRunwayImageOwnedReferenceResolution>;
const referenceBrand: unique symbol = Symbol("OwnerRunwayImageOwnedReferenceSet");
export interface OwnerRunwayImageOwnedReferenceSet {
  readonly [referenceBrand]: true; readonly variant: OwnerRunwayImageVariant; readonly reference_count: number; readonly expires_at: number;
}
interface RefState { principal: Readonly<GenerationPrincipalRef>; attempt_id: string; variant: OwnerRunwayImageVariant; profile: Readonly<OwnerRunwayImageSourceProfile>; refs: readonly OwnerRunwayImageOwnedReferenceResolution[]; expires_at: number; }
const sets = new WeakMap<object, Readonly<RefState>>();
const revoked = new WeakSet<object>();

export interface OwnerRunwayImageReferenceBindingIssuerOptions { readonly catalog: OwnerRunwayImageCatalogPort; readonly catalog_version: string; readonly now?: () => number; }
export interface OwnerRunwayImageReferenceBindingIssueInput { readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly variant: OwnerRunwayImageVariant; readonly reference_handles: readonly string[]; }
export interface OwnerRunwayImageReferenceBindingIssuer { issue(input: OwnerRunwayImageReferenceBindingIssueInput | unknown): Promise<OwnerRunwayImageOwnedReferenceSet>; invalidateAttempt(attemptId: string): void; close(): void; }
export interface OwnerRunwayImageInputReferenceMetadata { readonly mime_type: string; readonly width: number | null; readonly height: number | null; readonly size: number; readonly sha256: string; readonly metadata_confidence: "CONTAINER_METADATA_ONLY" | "UNKNOWN"; }
export interface OwnerRunwayImagePreparedCandidate {
  readonly status: "blocked"; readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT";
  readonly dispatch_allowed: false; readonly backend_acceptance: "UNPROVEN"; readonly profile_id: string; readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>; readonly model_id: OwnerRunwayImageVariant; readonly ai_name: "runway-frames";
  readonly variant: OwnerRunwayImageVariant; readonly model_type: OwnerRunwayImageVariant; readonly scope: "image"; readonly operation_id: "generate-image";
  readonly prompt: string; readonly prompt_local_max_utf8_bytes: 65_536; readonly prompt_limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT";
  readonly parameters: Readonly<{ resolution: string; temperature: number }>; readonly reference_count: number;
  readonly references: readonly OwnerRunwayImageInputReferenceMetadata[]; readonly pixel_decode_verified: false;
  readonly cost_inputs: Readonly<Record<string, never>>; readonly cost_input_confidence: string; readonly expires_at: number;
  readonly request_fingerprint: string; readonly intent_fingerprint: string;
  readonly request: Readonly<{ prompt: string; settings: Readonly<{ n: 1; model_type: OwnerRunwayImageVariant; resolution: string; temperature: number; file_urls: readonly Readonly<{ type: "image"; url: string }>[] }> }>;
}
export interface PrepareOwnerRunwayImageRequestInput { readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly variant: OwnerRunwayImageVariant; readonly parameters: unknown; readonly reference_set: OwnerRunwayImageOwnedReferenceSet; readonly prompt: string; }
export interface PrepareOwnerRunwayImageRequestOptions extends OwnerRunwayImageReferenceBindingIssuerOptions {}
interface CandidateState { principal: Readonly<GenerationPrincipalRef>; attempt_id: string; reference_set: object; expires_at: number; fingerprint: string; intent_fingerprint: string; last_now: number; expired: boolean; }
const candidates = new WeakMap<object, CandidateState>();
export type OwnerRunwayImagePrepareErrorCode = "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_MISMATCH" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "PARAMETERS_INVALID" | "PROMPT_INVALID" | "CANDIDATE_INVALID" | "CLOCK_INVALID";
export class OwnerRunwayImagePrepareError extends Error {
  constructor(readonly code: OwnerRunwayImagePrepareErrorCode) { super("The owner Runway image candidate could not be prepared safely."); this.name = "OwnerRunwayImagePrepareError"; }
}

export function createOwnerRunwayImageOwnedReferenceBindingIssuer(resolve: ResolveOwnerRunwayImageOwnedReference, optionsInput: OwnerRunwayImageReferenceBindingIssuerOptions | unknown): OwnerRunwayImageReferenceBindingIssuer {
  if (typeof resolve !== "function" || isProxy(resolve)) fail("INVALID_REQUEST");
  const options = snapshotOptions(optionsInput); let closed = false; let pending = 0; let total = 0;
  const epochs = new Map<string, number>(); const byAttempt = new Map<string, Set<object>>();
  const invalidateAttempt = (id: string): void => { if (!ATTEMPT.test(id)) return; epochs.set(id, (epochs.get(id) ?? 0) + 1); for (const set of byAttempt.get(id) ?? []) revoked.add(set); byAttempt.delete(id); };
  return Object.freeze({
    async issue(input: OwnerRunwayImageReferenceBindingIssueInput | unknown): Promise<OwnerRunwayImageOwnedReferenceSet> {
      if (closed || pending >= MAX_PENDING || total >= MAX_SETS) fail("REFERENCE_UNAVAILABLE");
      const req = exact(input, ["principal", "attempt_id", "variant", "reference_handles"]);
      const principal = snapshotPrincipal(req.principal, req.attempt_id);
      if (req.variant !== "runway_frames" || !Array.isArray(req.reference_handles) || isProxy(req.reference_handles) || !Object.isFrozen(req.reference_handles) && !Array.isArray(req.reference_handles)) fail("INVALID_REQUEST");
      const handles = snapshotHandles(req.reference_handles);
      if (handles.length > 3 || new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
      const profile = profileFor(req.variant, options);
      const now = safeNow(options.now); if (now > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CLOCK_INVALID");
      const attemptId = req.attempt_id as string;
      const expiresAt = now + TTL_MS; const epoch = epochs.get(attemptId) ?? 0; pending += 1;
      try {
        const refs: OwnerRunwayImageOwnedReferenceResolution[] = [];
        for (const handle of handles) {
          const context = Object.freeze({ principal, attempt_id: req.attempt_id as string, variant: req.variant as OwnerRunwayImageVariant,
            model_id: profile.model_id, ai_name: profile.ai_name, scope: "image" as const, operation_id: "generate-image" as const,
            catalog_version: profile.public_catalog_version, profile_schema_hash: profile.profile_schema_hash, reference_handle: handle });
          let raw: unknown; try { raw = await resolve(context); } catch { fail("REFERENCE_UNAVAILABLE"); }
          if (closed || (epochs.get(req.attempt_id as string) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
          const ref = snapshotResolution(raw); validateResolution(ref, context, now);
          if (refs.some((prior) => prior.file_url === ref.file_url || prior.sha256 === ref.sha256)) fail("REFERENCE_UNAVAILABLE");
          refs.push(ref);
        }
        if (closed || (epochs.get(req.attempt_id as string) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
        const effectiveExpiry = refs.length ? Math.min(...refs.map((r) => r.expires_at)) : expiresAt;
        if (safeNow(options.now) < now || effectiveExpiry <= safeNow(options.now)) fail("REFERENCE_EXPIRED");
        const set = Object.create(null) as OwnerRunwayImageOwnedReferenceSet;
        Object.defineProperties(set, { [referenceBrand]: { value: true }, variant: { value: req.variant }, reference_count: { value: refs.length }, expires_at: { value: effectiveExpiry } });
        Object.freeze(set); sets.set(set, Object.freeze({ principal, attempt_id: req.attempt_id as string, variant: req.variant as OwnerRunwayImageVariant,
          profile, refs: Object.freeze(refs), expires_at: effectiveExpiry }));
        const attemptSets = byAttempt.get(req.attempt_id as string) ?? new Set<object>(); attemptSets.add(set); byAttempt.set(req.attempt_id as string, attemptSets); total += 1; return set;
      } finally { pending -= 1; }
    },
    invalidateAttempt,
    close(): void { if (closed) return; closed = true; for (const bucket of byAttempt.values()) for (const set of bucket) revoked.add(set); byAttempt.clear(); epochs.clear(); }
  });
}

export function prepareOwnerRunwayImageRequest(input: PrepareOwnerRunwayImageRequestInput | unknown, optionsInput: PrepareOwnerRunwayImageRequestOptions | unknown): OwnerRunwayImagePreparedCandidate {
  const req = exact(input, ["principal", "attempt_id", "variant", "parameters", "reference_set", "prompt"]);
  const options = snapshotOptions(optionsInput); const principal = snapshotPrincipal(req.principal, req.attempt_id);
  if (req.variant !== "runway_frames") fail("INVALID_REQUEST");
  const prompt = validatePrompt(req.prompt); const profile = profileFor(req.variant, options);
  const set = req.reference_set;
  if (!set || typeof set !== "object" || Array.isArray(set) || isProxy(set) || !Object.isFrozen(set)) fail("REFERENCE_UNAVAILABLE");
  const state = sets.get(set as object);
  if (!state || revoked.has(set as object) || state.attempt_id !== req.attempt_id || state.variant !== req.variant ||
      state.profile.profile_schema_hash !== profile.profile_schema_hash || !sameGenerationPrincipal(state.principal, principal)) fail("REFERENCE_UNAVAILABLE");
  const now = safeNow(options.now); if (state.expires_at <= now) fail("REFERENCE_EXPIRED");
  let normalized; try { normalized = normalizeOwnerRunwayImageParameters({ variant: req.variant, reference_count: state.refs.length, parameters: req.parameters }); } catch { fail("PARAMETERS_INVALID"); }
  const settings = deepFreeze({ n: 1 as const, model_type: req.variant as OwnerRunwayImageVariant,
    resolution: normalized.parameters.resolution, temperature: normalized.parameters.temperature,
    file_urls: state.refs.map((r) => ({ type: "image" as const, url: r.file_url })) });
  const body = deepFreeze({ prompt, settings });
  const references = deepFreeze(state.refs.map((r) => ({ mime_type: r.mime_type, width: r.width, height: r.height, size: r.size, sha256: r.sha256, metadata_confidence: r.metadata_confidence })));
  const requestFingerprint = schemaHash({ principal, attempt_id: req.attempt_id, profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
    variant: req.variant, parameters: normalized.parameters, prompt, references: state.refs.map((r) => ({ reference_handle: r.reference_handle, file_url: r.file_url,
      mime_type: r.mime_type, width: r.width, height: r.height, size: r.size, sha256: r.sha256, expires_at: r.expires_at })) });
  const intentFingerprint = schemaHash({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash, variant: req.variant, parameters: normalized.parameters, prompt,
    references: state.refs.map((r) => ({ mime_type: r.mime_type, size: r.size, sha256: r.sha256 })) });
  const data: Record<string, unknown> = { status: "blocked", source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT",
    dispatch_allowed: false, backend_acceptance: "UNPROVEN", profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
    source_binding: profile.source_binding, model_id: profile.model_id, ai_name: profile.ai_name, variant: req.variant, model_type: profile.model_type,
    scope: "image", operation_id: "generate-image", prompt, prompt_local_max_utf8_bytes: MAX_PROMPT_BYTES,
    prompt_limit_confidence: "LOCAL_RESOURCE_GUARD_NOT_PROVIDER_LIMIT", parameters: normalized.parameters, reference_count: state.refs.length,
    references, pixel_decode_verified: false, cost_inputs: Object.freeze({}), cost_input_confidence: normalized.cost_input_confidence,
    expires_at: state.expires_at, request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint };
  Object.defineProperty(data, "request", { value: body, enumerable: false, writable: false, configurable: false });
  const candidate = deepFreeze(data) as unknown as OwnerRunwayImagePreparedCandidate;
  candidates.set(candidate, { principal, attempt_id: req.attempt_id as string, reference_set: set as object, expires_at: state.expires_at,
    fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint, last_now: now, expired: false });
  return candidate;
}

export function isOwnerRunwayImagePreparedCandidateForPrincipal(candidate: unknown, principalInput: unknown, attemptId: unknown, nowInput = Date.now()): candidate is OwnerRunwayImagePreparedCandidate {
  if (!candidate || typeof candidate !== "object" || isProxy(candidate) || !Object.isFrozen(candidate) || typeof attemptId !== "string" || !Number.isSafeInteger(nowInput)) return false;
  const state = candidates.get(candidate); if (!state || state.attempt_id !== attemptId || state.expires_at <= nowInput || revoked.has(state.reference_set) || state.expired) return false;
  try { return sameGenerationPrincipal(state.principal, snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef)); } catch { return false; }
}

export function observeOwnerRunwayImageCandidateClock(candidate: OwnerRunwayImagePreparedCandidate, now: number): boolean {
  const state = candidates.get(candidate); if (!state || !Number.isSafeInteger(now) || now < 0 || state.expired || now < state.last_now || now >= state.expires_at) { if (state) state.expired = true; return false; }
  state.last_now = now; return true;
}
export function getOwnerRunwayImagePreparedCandidateState(candidate: OwnerRunwayImagePreparedCandidate): Readonly<{ principal: Readonly<GenerationPrincipalRef>; attempt_id: string; expires_at: number; fingerprint: string; intent_fingerprint: string }> | null {
  const state = candidates.get(candidate); return state ? Object.freeze({ principal: state.principal, attempt_id: state.attempt_id,
    expires_at: state.expires_at, fingerprint: state.fingerprint, intent_fingerprint: state.intent_fingerprint }) : null;
}

function profileFor(variant: unknown, options: Readonly<{ catalog: OwnerRunwayImageCatalogPort; catalog_version: string; now: () => number }>): Readonly<OwnerRunwayImageSourceProfile> {
  try { return getOwnerRunwayImageSourceProfile(variant, options.catalog, options.catalog_version); } catch { fail("PROFILE_BINDING_MISMATCH"); }
}
function snapshotOptions(value: unknown): Readonly<{ catalog: OwnerRunwayImageCatalogPort; catalog_version: string; now: () => number }> {
  const o = exact(value, ["catalog", "catalog_version", "now"], ["catalog", "catalog_version"]);
  if (!o.catalog || typeof o.catalog !== "object" || typeof o.catalog_version !== "string" || (o.now !== undefined && typeof o.now !== "function")) fail("INVALID_REQUEST");
  return Object.freeze({ catalog: o.catalog as OwnerRunwayImageCatalogPort, catalog_version: o.catalog_version, now: o.now as (() => number) | undefined ?? Date.now });
}
function snapshotPrincipal(value: unknown, attemptId: unknown): Readonly<GenerationPrincipalRef> {
  if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH"); return principal;
}
function snapshotHandles(value: unknown): string[] {
  if (!Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  if (Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value); const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length > 3 || Reflect.ownKeys(descriptors).length !== length + 1) fail("INVALID_REQUEST");
  const result: string[] = []; for (let i = 0; i < length; i += 1) { const d = descriptors[String(i)]; if (!d || !("value" in d) || !d.enumerable || typeof d.value !== "string" || !HANDLE.test(d.value)) fail("INVALID_REQUEST"); result.push(d.value); } return result;
}
function snapshotResolution(value: unknown): OwnerRunwayImageOwnedReferenceResolution {
  const keys = ["principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "operation_id", "catalog_version", "profile_schema_hash", "reference_handle", "file_url", "mime_type", "width", "height", "size", "sha256", "expires_at", "metadata_confidence"];
  const r = exact(value, keys); const principal = snapshotGenerationPrincipal(r.principal as GenerationPrincipalRef);
  return Object.freeze({ ...r, principal }) as unknown as OwnerRunwayImageOwnedReferenceResolution;
}
function validateResolution(r: OwnerRunwayImageOwnedReferenceResolution, c: OwnerRunwayImageOwnedReferenceResolverContext, now: number): void {
  if (!sameGenerationPrincipal(r.principal, c.principal) || r.attempt_id !== c.attempt_id || r.variant !== c.variant || r.model_id !== c.model_id || r.ai_name !== c.ai_name || r.scope !== c.scope || r.operation_id !== c.operation_id || r.catalog_version !== c.catalog_version || r.profile_schema_hash !== c.profile_schema_hash || r.reference_handle !== c.reference_handle ||
      typeof r.file_url !== "string" || !isSafeUploadReferenceUrl(r.file_url) || typeof r.mime_type !== "string" || !MIME_TYPES.has(r.mime_type) ||
      !Number.isSafeInteger(r.size) || r.size <= 0 || r.size > MAX_FILE_BYTES || !SHA256.test(r.sha256) || !Number.isSafeInteger(r.expires_at) || r.expires_at <= now ||
      !(r.width === null || Number.isSafeInteger(r.width) && r.width > 0) || !(r.height === null || Number.isSafeInteger(r.height) && r.height > 0) ||
      !(r.metadata_confidence === "CONTAINER_METADATA_ONLY" || r.metadata_confidence === "UNKNOWN")) fail("REFERENCE_UNAVAILABLE");
}
function validatePrompt(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || PROMPT_CONTROLS.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value) || new TextEncoder().encode(value).length > MAX_PROMPT_BYTES) fail("PROMPT_INVALID"); return value;
}
function exact(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) fail("INVALID_REQUEST");
  const ds = Object.getOwnPropertyDescriptors(value); const own = Reflect.ownKeys(ds);
  if (own.some((k) => typeof k !== "string" || !keys.includes(k) || !("value" in ds[k]!) || !ds[k]!.enumerable) || required.some((k) => !Object.hasOwn(ds, k))) fail("INVALID_REQUEST");
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const k of own as string[]) out[k] = ds[k]!.value; return out;
}
function safeNow(now: () => number): number { let n: number; try { n = now(); } catch { fail("CLOCK_INVALID"); } if (!Number.isSafeInteger(n) || n < 0) fail("CLOCK_INVALID"); return n; }
function deepFreeze<T>(value: T): DeepReadonly<T> { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>; for (const k of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[k]); return Object.freeze(value) as DeepReadonly<T>; }
function fail(code: OwnerRunwayImagePrepareErrorCode): never { throw new OwnerRunwayImagePrepareError(code); }
