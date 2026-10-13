import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  OWNER_UNI_IMAGE_MODELS,
  normalizeOwnerUniImageParameters,
  type OwnerUniImageInputParameters,
  type OwnerUniImageModel,
  type OwnerUniImageNormalizedParameters,
  type OwnerUniImageParametersInput
} from "./owner-uni-image-parameters.js";
import {
  getOwnerUniImageSourceProfile,
  type OwnerUniImageSourceProfile,
  type OwnerUniImageSourceProfileCatalogPort
} from "./owner-uni-image-source-profile.js";
import {
  OwnerUniImageUploadService,
  type OwnerUniImageOwnedReferenceResolution,
  type OwnerUniImageReferenceResolverContext
} from "./owner-uni-image-upload-service.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_ACTIVE = 128;
const RESOLVE_METHOD = OwnerUniImageUploadService.prototype.resolveReference;
const IS_OWNED_METHOD = OwnerUniImageUploadService.prototype.isOwnedReferenceResolution;
const INVALIDATE_METHOD = OwnerUniImageUploadService.prototype.invalidateAttempt;

const ASSET_BRAND: unique symbol = Symbol("OwnerUniImageOwnedAssetSet");
const CANDIDATE_BRAND: unique symbol = Symbol("OwnerUniImagePreparedCandidate");

export interface OwnerUniImageRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly imageUploadService: OwnerUniImageUploadService;
  readonly catalog: OwnerUniImageSourceProfileCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}

export interface OwnerUniImageAssetIssueInput extends OwnerUniImageParametersInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly signal?: AbortSignal;
}

export interface OwnerUniImageReferenceMetadata {
  readonly source_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export interface OwnerUniImageOwnedAssetSet {
  readonly [ASSET_BRAND]: true;
  readonly status: "nominal";
  readonly model_id: OwnerUniImageModel;
  readonly reference_count: number;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly expires_at: number;
  readonly references: readonly OwnerUniImageReferenceMetadata[];
}

export interface OwnerUniImageAssetPrepareInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly asset_set: OwnerUniImageOwnedAssetSet;
  readonly signal?: AbortSignal;
}

export interface OwnerUniImagePreparedCandidate {
  readonly [CANDIDATE_BRAND]: true;
  readonly status: "blocked";
  readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerUniImageSourceProfile["source_binding"];
  readonly model_id: OwnerUniImageModel;
  readonly ai_name: "luma_image";
  readonly model_type: OwnerUniImageModel;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly prompt_local_max_utf16_units: 6_000;
  readonly prompt_limit_confidence: "SOURCE_UI_LOCAL_INPUT_RULE_NOT_PROVIDER_LIMIT";
  readonly parameters: OwnerUniImageInputParameters;
  readonly custom_settings: OwnerUniImageNormalizedParameters["custom_settings"];
  readonly reference_count: number;
  readonly references: readonly OwnerUniImageReferenceMetadata[];
  readonly cost_routing: OwnerUniImageNormalizedParameters["cost_routing"];
  readonly cost_inputs: Readonly<Record<never, never>>;
  readonly cost_input_confidence: "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION";
  readonly source_mapping_confidence: OwnerUniImageSourceProfile["source_binding"]["confidence"];
  readonly defaults_injected: false;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly request: Readonly<{ prompt: string; settings: Readonly<Record<string, unknown>> }>;
}

export type OwnerUniImageRequestPrepareErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_MISMATCH" | "ASSET_UNAVAILABLE" | "ASSET_EXPIRED"
  | "PARAMETERS_INVALID" | "PROMPT_INVALID" | "CLOCK_INVALID" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "REQUEST_ABORTED" | "PRINCIPAL_NOT_LINKED" | "SERVICE_CLOSED";

export class OwnerUniImageRequestPrepareError extends Error {
  constructor(readonly code: OwnerUniImageRequestPrepareErrorCode) {
    super("The owner Uni image request candidate could not be prepared safely.");
    this.name = "OwnerUniImageRequestPrepareError";
  }
}

interface AssetState {
  readonly owner: OwnerUniImageRequestPreparer;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerUniImageModel;
  readonly profile: Readonly<OwnerUniImageSourceProfile>;
  readonly normalized: Readonly<OwnerUniImageNormalizedParameters>;
  readonly handles: readonly string[];
  readonly references: readonly OwnerUniImageOwnedReferenceResolution[];
  readonly expires_at: number;
  readonly epoch: number;
}

interface CandidateState {
  readonly owner: OwnerUniImageRequestPreparer;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly asset_set: object;
  readonly profile: Readonly<OwnerUniImageSourceProfile>;
  readonly expires_at: number;
  readonly epoch: number;
  readonly request_fingerprint: string;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

const assetStates = new WeakMap<object, AssetState>();
const revokedAssets = new WeakSet<object>();
const candidateStates = new WeakMap<object, CandidateState>();
const revokedCandidates = new WeakSet<object>();

/** Source-bound private asset issuer and request preparer; it does not grant dispatch. */
export class OwnerUniImageRequestPreparer {
  readonly #imageUploadService: OwnerUniImageUploadService;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerUniImageSourceProfileCatalogPort;
  readonly #catalogVersion: string;
  readonly #now: () => number;
  readonly #assetsByAttempt = new Map<string, Set<object>>();
  readonly #candidatesByAttempt = new Map<string, Set<object>>();
  readonly #candidateByAssetSet = new WeakMap<object, OwnerUniImagePreparedCandidate>();
  readonly #epochs = new Map<string, number>();
  readonly #operationsByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #lastNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerUniImageRequestPreparerOptions | unknown) {
    const fields = exact(optionsInput, ["binding", "linkService", "imageUploadService", "catalog", "catalog_version"], ["now"]);
    if (types.isProxy(fields.imageUploadService) || !(fields.imageUploadService instanceof OwnerUniImageUploadService) ||
        Object.getPrototypeOf(fields.imageUploadService) !== OwnerUniImageUploadService.prototype ||
        Object.hasOwn(fields.imageUploadService, "resolveReference") || Object.hasOwn(fields.imageUploadService, "isOwnedReferenceResolution") ||
        !isPlainPort(fields.linkService) || !isPlainPort(fields.catalog) ||
        fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#imageUploadService = fields.imageUploadService;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerUniImageSourceProfileCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#now = readClock(fields.now);
    for (const model of OWNER_UNI_IMAGE_MODELS) this.#profile(model);
  }

  async issue(input: OwnerUniImageAssetIssueInput | unknown): Promise<OwnerUniImageOwnedAssetSet> {
    const request = snapshotIssue(input);
    this.#assertOpen();
    if (request.signal?.aborted) fail("REQUEST_ABORTED");
    const profile = this.#profile(request.variant);
    const normalized = normalizeParameters(request, profile);
    this.#pruneExpired(this.#readNow());
    if (this.#activeCount() >= MAX_ACTIVE) fail("CAPACITY_EXCEEDED");
    const operation = this.#begin(request.attempt_id, request.signal);
    const epoch = operation.epoch;
    try {
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CLOCK_INVALID");
      const currentPrincipal = await this.#resolvePrincipal(request.attempt_id, operation.controller.signal);
      this.#throwIfAborted(operation);
      if (!sameGenerationPrincipal(currentPrincipal, request.principal)) fail("PRINCIPAL_MISMATCH");
      const references: OwnerUniImageOwnedReferenceResolution[] = [];
      for (const handle of normalized.ordered_image_reference_handles) {
        this.#throwIfAborted(operation);
        const context = this.#resolverContext(request.principal, request.attempt_id, request.variant, profile, handle);
        const resolved = await this.#resolveOwnedReference(context, operation.controller.signal);
        this.#throwIfAborted(operation);
        if (!this.#isOwnedReferenceResolution(resolved, context)) fail("ASSET_UNAVAILABLE");
        const reference = validateResolution(resolved, context, issuedAt);
        if (references.some((previous) => previous.asset_id === reference.asset_id ||
            previous.canonical_url === reference.canonical_url || previous.sha256 === reference.sha256)) fail("ASSET_UNAVAILABLE");
        references.push(reference);
      }
      this.#profile(request.variant);
      if ((this.#epochs.get(request.attempt_id) ?? 0) !== epoch) fail("ASSET_UNAVAILABLE");
      const now = this.#readNow();
      const expiresAt = Math.min(issuedAt + TTL_MS, ...references.map((reference) => reference.expires_at));
      if (expiresAt <= now) fail("ASSET_EXPIRED");
      const set = Object.create(null) as OwnerUniImageOwnedAssetSet;
      Object.defineProperties(set, {
        [ASSET_BRAND]: { value: true }, status: { value: "nominal" }, model_id: { value: request.variant },
        reference_count: { value: references.length }, profile_schema_hash: { value: profile.profile_schema_hash },
        catalog_version: { value: profile.public_catalog_version }, expires_at: { value: expiresAt },
        references: { value: metadataFor(references) }
      });
      Object.freeze(set);
      assetStates.set(set, Object.freeze({ owner: this, principal: request.principal, attempt_id: request.attempt_id,
        model_id: request.variant, profile, normalized, handles: normalized.ordered_image_reference_handles,
        references: Object.freeze(references), expires_at: expiresAt, epoch }));
      const active = this.#assetsByAttempt.get(request.attempt_id) ?? new Set<object>();
      active.add(set); this.#assetsByAttempt.set(request.attempt_id, active);
      return set;
    } finally { this.#finish(request.attempt_id, operation); }
  }

  async prepare(input: unknown): Promise<OwnerUniImagePreparedCandidate> {
    const request = snapshotPrepare(input);
    const { attempt_id: attemptId, principal, asset_set: assetSet } = request;
    this.#assertOpen();
    if (request.signal?.aborted) fail("REQUEST_ABORTED");
    if (!assetSet || typeof assetSet !== "object" || Array.isArray(assetSet) || types.isProxy(assetSet)) fail("ASSET_UNAVAILABLE");
    const state = assetStates.get(assetSet as object);
    if (!state || state.owner !== this || revokedAssets.has(assetSet as object) || state.attempt_id !== attemptId ||
        !sameGenerationPrincipal(state.principal, principal)) fail("ASSET_UNAVAILABLE");
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const profile = this.#profile(state.model_id);
    if (profile.profile_schema_hash !== state.profile.profile_schema_hash ||
        profile.public_catalog_version !== state.profile.public_catalog_version) fail("PROFILE_BINDING_MISMATCH");
    const now = this.#readNow();
    this.#pruneExpired(now);
    if (state.expires_at <= now || (this.#epochs.get(attemptId) ?? 0) !== state.epoch) fail("ASSET_EXPIRED");
    const operation = this.#begin(attemptId, request.signal);
    const epoch = operation.epoch;
    try {
      const currentPrincipal = await this.#resolvePrincipal(attemptId, operation.controller.signal);
      this.#throwIfAborted(operation);
      if (!sameGenerationPrincipal(currentPrincipal, principal)) fail("PRINCIPAL_MISMATCH");
      const fresh: OwnerUniImageOwnedReferenceResolution[] = [];
      for (let index = 0; index < state.handles.length; index += 1) {
        this.#throwIfAborted(operation);
        const handle = state.handles[index]!;
        const context = this.#resolverContext(principal, attemptId, state.model_id, profile, handle);
        const resolved = await this.#resolveOwnedReference(context, operation.controller.signal);
        this.#throwIfAborted(operation);
        if (!this.#isOwnedReferenceResolution(resolved, context)) fail("ASSET_UNAVAILABLE");
        const reference = validateResolution(resolved, context, now);
        if (!sameReference(state.references[index]!, reference)) fail("ASSET_UNAVAILABLE");
        fresh.push(reference);
      }
      const checkedAt = this.#readNow();
      if ((this.#epochs.get(attemptId) ?? 0) !== epoch || state.expires_at <= checkedAt) fail("ASSET_EXPIRED");
      const existing = this.#candidateByAssetSet.get(assetSet as object);
      if (existing && !revokedCandidates.has(existing) && candidateStates.has(existing)) return existing;
      if (this.#candidateCount() >= MAX_ACTIVE) fail("CAPACITY_EXCEEDED");

      const fileUrls = deepFreeze(fresh.map((reference) => Object.freeze({ type: "image" as const, url: reference.canonical_url })));
      const settings = deepFreeze({ ...state.normalized.custom_settings, file_urls: fileUrls });
      const requestBody = deepFreeze({ prompt: state.normalized.prompt, settings });
      const references = metadataFor(fresh);
      const requestFingerprint = schemaHash({ principal, attempt_id: attemptId, model_id: state.model_id,
        upload_profile_schema_hash: profile.source_binding.upload_profile_reference.schema_hash,
        profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
        source_binding: profile.source_binding, parameters: state.normalized.parameters,
        custom_settings: state.normalized.custom_settings, source_selection: state.normalized.reference_selection,
        references: fresh.map(referenceFingerprint), request: requestBody, expires_at: state.expires_at });
      const intentFingerprint = schemaHash({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
        model_id: state.model_id, profile_id: profile.profile_id, profile_schema_hash: profile.profile_schema_hash,
        source_binding: profile.source_binding, prompt: state.normalized.prompt, parameters: state.normalized.parameters,
        custom_settings: state.normalized.custom_settings, ordered_references: fresh.map((reference) => ({
          sha256: reference.sha256, size: reference.size, mime_type: reference.mime_type,
          source_mime_type: reference.source_mime_type, width: reference.width, height: reference.height
        })) });

      const candidateData: Record<string, unknown> = {
        [CANDIDATE_BRAND]: true, status: "blocked", source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT",
        dispatch_allowed: false, backend_acceptance: "UNPROVEN", profile_id: profile.profile_id,
        profile_schema_hash: profile.profile_schema_hash, source_binding: profile.source_binding,
        model_id: state.model_id, ai_name: profile.ai_name, model_type: state.model_id,
        scope: profile.scope, operation_id: profile.operation_id,
        prompt_local_max_utf16_units: state.normalized.prompt_local_max_utf16_units,
        prompt_limit_confidence: state.normalized.prompt_limit_confidence,
        parameters: state.normalized.parameters, custom_settings: state.normalized.custom_settings,
        reference_count: fresh.length, references,
        cost_routing: state.normalized.cost_routing, cost_inputs: state.normalized.cost_inputs,
        cost_input_confidence: "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION",
        source_mapping_confidence: profile.source_binding.confidence, defaults_injected: false,
        expires_at: state.expires_at, request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint
      };
      Object.defineProperty(candidateData, "request", { value: requestBody, enumerable: false, writable: false, configurable: false });
      Object.freeze(candidateData);
      const candidate = candidateData as unknown as OwnerUniImagePreparedCandidate;
      candidateStates.set(candidate, Object.freeze({ owner: this, principal, attempt_id: attemptId, asset_set: assetSet as object,
        profile, expires_at: state.expires_at, epoch, request_fingerprint: candidate.request_fingerprint }));
      this.#candidateByAssetSet.set(assetSet as object, candidate);
      const candidates = this.#candidatesByAttempt.get(attemptId) ?? new Set<object>();
      candidates.add(candidate); this.#candidatesByAttempt.set(attemptId, candidates);
      return candidate;
    } finally { this.#finish(attemptId, operation); }
  }

  isPreparedCandidateForPrincipal(candidate: unknown, principalInput: unknown, attemptIdInput: unknown): candidate is OwnerUniImagePreparedCandidate {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate)) return false;
    const state = candidateStates.get(candidate as object);
    if (!state || state.owner !== this || revokedCandidates.has(candidate as object) || revokedAssets.has(state.asset_set) ||
        state.attempt_id !== attemptIdInput) return false;
    try {
      const principal = snapshotPrincipal(principalInput, attemptIdInput);
      const now = this.#readNow();
      const profile = this.#profile(state.profile.model_id);
      const asset = assetStates.get(state.asset_set);
      if (!asset || asset.owner !== this || revokedAssets.has(state.asset_set) || asset.expires_at <= now ||
          (this.#epochs.get(state.attempt_id) ?? 0) !== asset.epoch) return false;
      for (let index = 0; index < asset.references.length; index += 1) {
        const context = this.#resolverContext(asset.principal, asset.attempt_id, asset.model_id, asset.profile, asset.handles[index]!);
        if (!this.#isOwnedReferenceResolution(asset.references[index]!, context)) return false;
      }
      const value = candidate as OwnerUniImagePreparedCandidate;
      return sameGenerationPrincipal(state.principal, principal) && state.expires_at > now &&
        (this.#epochs.get(state.attempt_id) ?? 0) === state.epoch && profile.profile_schema_hash === state.profile.profile_schema_hash &&
        value.dispatch_allowed === false && value.request_fingerprint === state.request_fingerprint;
    } catch { return false; }
  }

  async invalidateAttempt(attemptIdInput: string): Promise<void> {
    if (!ATTEMPT_PATTERN.test(attemptIdInput)) return;
    this.#epochs.set(attemptIdInput, (this.#epochs.get(attemptIdInput) ?? 0) + 1);
    for (const asset of this.#assetsByAttempt.get(attemptIdInput) ?? []) revokedAssets.add(asset);
    for (const candidate of this.#candidatesByAttempt.get(attemptIdInput) ?? []) revokedCandidates.add(candidate);
    for (const operation of this.#operationsByAttempt.get(attemptIdInput) ?? []) operation.controller.abort();
    await Promise.allSettled([...(this.#operationsByAttempt.get(attemptIdInput) ?? [])].map((operation) => operation.done));
    this.#assetsByAttempt.delete(attemptIdInput); this.#candidatesByAttempt.delete(attemptIdInput);
    try { await Reflect.apply(INVALIDATE_METHOD, this.#imageUploadService, [attemptIdInput]); }
    catch { fail("ASSET_UNAVAILABLE"); }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const assets of this.#assetsByAttempt.values()) for (const asset of assets) revokedAssets.add(asset);
    for (const candidates of this.#candidatesByAttempt.values()) for (const candidate of candidates) revokedCandidates.add(candidate);
    for (const operations of this.#operationsByAttempt.values()) for (const operation of operations) operation.controller.abort();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => {
      this.#assetsByAttempt.clear(); this.#candidatesByAttempt.clear(); this.#epochs.clear(); this.#operationsByAttempt.clear();
    });
    return this.#closing;
  }

  #resolverContext(principal: Readonly<GenerationPrincipalRef>, attemptId: string, modelId: OwnerUniImageModel,
    profile: Readonly<OwnerUniImageSourceProfile>, handle: string): OwnerUniImageReferenceResolverContext {
    return Object.freeze({ principal, attempt_id: attemptId, model_id: modelId, ai_name: "luma_image", scope: "image",
      operation_id: "upload-image-reference", catalog_version: profile.public_catalog_version,
      upload_profile_schema_hash: profile.source_binding.upload_profile_reference.schema_hash, reference_handle: handle });
  }

  async #resolveOwnedReference(context: OwnerUniImageReferenceResolverContext, signal: AbortSignal): Promise<OwnerUniImageOwnedReferenceResolution> {
    try { return await Reflect.apply(RESOLVE_METHOD, this.#imageUploadService, [context, signal]); }
    catch {
      if (signal.aborted) fail("REQUEST_ABORTED");
      fail("ASSET_UNAVAILABLE");
    }
  }

  #isOwnedReferenceResolution(value: unknown, context: OwnerUniImageReferenceResolverContext): value is OwnerUniImageOwnedReferenceResolution {
    try { return Reflect.apply(IS_OWNED_METHOD, this.#imageUploadService, [value, context]) === true; }
    catch { return false; }
  }

  #profile(model: OwnerUniImageModel): Readonly<OwnerUniImageSourceProfile> {
    try { return getOwnerUniImageSourceProfile(model, this.#catalog, this.#catalogVersion); }
    catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal.aborted) fail("REQUEST_ABORTED");
    const promise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerUniImageRequestPrepareError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    try { return await Promise.race([promise, aborted]); }
    catch (error) {
      if (error instanceof OwnerUniImageRequestPrepareError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRINCIPAL_NOT_LINKED");
    } finally { remove(); }
  }

  #begin(attemptId: string, parentSignal?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort(); else parentSignal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = { controller, done, finish, epoch: this.#epochs.get(attemptId) ?? 0,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abort) };
    const bucket = this.#operationsByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    bucket.add(operation); this.#operationsByAttempt.set(attemptId, bucket); this.#allOperations.add(done); this.#pendingCount += 1;
    return operation;
  }

  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const bucket = this.#operationsByAttempt.get(attemptId); bucket?.delete(operation);
    if (bucket?.size === 0) this.#operationsByAttempt.delete(attemptId);
    this.#pendingCount -= 1; operation.finish(); this.#allOperations.delete(operation.done);
  }

  #readNow(): number {
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value as number;
    return value as number;
  }

  #pruneExpired(now: number): void {
    for (const [attemptId, assets] of this.#assetsByAttempt) {
      for (const asset of assets) { const state = assetStates.get(asset); if (!state || state.expires_at <= now) { revokedAssets.add(asset); assets.delete(asset); } }
      if (assets.size === 0) this.#assetsByAttempt.delete(attemptId);
    }
    for (const [attemptId, candidates] of this.#candidatesByAttempt) {
      for (const candidate of candidates) {
        const state = candidateStates.get(candidate);
        if (!state || state.expires_at <= now || revokedCandidates.has(candidate) || revokedAssets.has(state.asset_set)) {
          revokedCandidates.add(candidate); candidates.delete(candidate);
        }
      }
      if (candidates.size === 0) this.#candidatesByAttempt.delete(attemptId);
    }
  }

  #activeCount(): number { let count = 0; for (const assets of this.#assetsByAttempt.values()) count += assets.size; return count; }
  #candidateCount(): number { let count = 0; for (const candidates of this.#candidatesByAttempt.values()) count += candidates.size; return count; }
  #throwIfAborted(operation: PendingOperation): void { this.#assertOpen(); if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

function snapshotIssue(value: unknown): Readonly<OwnerUniImageAssetIssueInput> {
  const fields = exact(value, ["principal", "attempt_id", "variant", "prompt", "parameters", "image_reference_handles", "main_image_reference_handle"], ["signal"]);
  const attemptId = readAttempt(fields.attempt_id);
  if (!isModel(fields.variant)) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(fields.principal, attemptId);
  if (fields.signal !== undefined && (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ principal, attempt_id: attemptId, variant: fields.variant, prompt: fields.prompt as string,
    parameters: fields.parameters as OwnerUniImageParametersInput["parameters"],
    image_reference_handles: fields.image_reference_handles as readonly string[],
    main_image_reference_handle: fields.main_image_reference_handle as string | null,
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}

function snapshotPrepare(value: unknown): Readonly<OwnerUniImageAssetPrepareInput> {
  const fields = exact(value, ["principal", "attempt_id", "asset_set"], ["signal"]);
  const attemptId = readAttempt(fields.attempt_id);
  if (fields.signal !== undefined && (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ principal: snapshotPrincipal(fields.principal, attemptId), attempt_id: attemptId,
    asset_set: fields.asset_set as OwnerUniImageOwnedAssetSet,
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}

function normalizeParameters(input: OwnerUniImageAssetIssueInput, profile: Readonly<OwnerUniImageSourceProfile>): Readonly<OwnerUniImageNormalizedParameters> {
  try {
    const normalized = normalizeOwnerUniImageParameters({ variant: input.variant, prompt: input.prompt,
      parameters: input.parameters, image_reference_handles: input.image_reference_handles,
      main_image_reference_handle: input.main_image_reference_handle });
    if (normalized.model_id !== profile.model_id || normalized.profile_id !== "owner-uni-image-source-parameters-v1") fail("PROFILE_BINDING_MISMATCH");
    return normalized;
  } catch (error) {
    if (error instanceof OwnerUniImageRequestPrepareError) throw error;
    fail("PARAMETERS_INVALID");
  }
}

function validateResolution(value: OwnerUniImageOwnedReferenceResolution, context: OwnerUniImageReferenceResolverContext,
  now: number): OwnerUniImageOwnedReferenceResolution {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value) ||
      value.attempt_id !== context.attempt_id || value.model_id !== context.model_id || value.ai_name !== "luma_image" ||
      value.scope !== "image" || value.operation_id !== "upload-image-reference" || value.catalog_version !== context.catalog_version ||
      value.upload_profile_schema_hash !== context.upload_profile_schema_hash || value.reference_handle !== context.reference_handle ||
      !sameGenerationPrincipal(value.principal, context.principal) || value.asset_role !== "image_reference" ||
      value.provenance !== "private_r2_owned" || value.provenance_verified !== true || typeof value.asset_id !== "string" ||
      value.asset_id.length < 1 || value.asset_id.length > 256 || !isSafeUploadReferenceUrl(value.canonical_url) ||
      !Number.isSafeInteger(value.expires_at) || value.expires_at <= now || !Number.isSafeInteger(value.size) || value.size <= 0 ||
      !Number.isSafeInteger(value.width) || value.width <= 0 || !Number.isSafeInteger(value.height) || value.height <= 0 ||
      !SHA256_PATTERN.test(value.sha256) || value.metadata_confidence !== "CONTAINER_METADATA_ONLY") fail("ASSET_UNAVAILABLE");
  let url: URL;
  try { url = new URL(value.canonical_url); } catch { fail("ASSET_UNAVAILABLE"); }
  if (url.search || url.username || url.password || url.hash) fail("ASSET_UNAVAILABLE");
  return value;
}

function sameReference(a: OwnerUniImageOwnedReferenceResolution, b: OwnerUniImageOwnedReferenceResolution): boolean {
  return a.reference_handle === b.reference_handle && a.asset_id === b.asset_id && a.canonical_url === b.canonical_url &&
    a.sha256 === b.sha256 && a.size === b.size && a.width === b.width && a.height === b.height &&
    a.source_mime_type === b.source_mime_type && a.mime_type === b.mime_type && a.expires_at === b.expires_at &&
    a.upload_profile_schema_hash === b.upload_profile_schema_hash;
}

function metadataFor(references: readonly OwnerUniImageOwnedReferenceResolution[]): readonly OwnerUniImageReferenceMetadata[] {
  return deepFreeze(references.map((reference) => ({ source_mime_type: reference.source_mime_type,
    mime_type: reference.mime_type, width: reference.width, height: reference.height, size: reference.size,
    sha256: reference.sha256, metadata_confidence: "CONTAINER_METADATA_ONLY" as const })));
}

function referenceFingerprint(reference: OwnerUniImageOwnedReferenceResolution): Readonly<Record<string, unknown>> {
  return Object.freeze({ asset_id: reference.asset_id, canonical_url: reference.canonical_url, sha256: reference.sha256,
    size: reference.size, mime_type: reference.mime_type, source_mime_type: reference.source_mime_type,
    upload_profile_schema_hash: reference.upload_profile_schema_hash, expires_at: reference.expires_at });
}

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.length > allowed.length || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}

function snapshotPrincipal(value: unknown, attemptIdInput: unknown): Readonly<GenerationPrincipalRef> {
  const attemptId = readAttempt(attemptIdInput);
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exact(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  try {
    const principal = snapshotGenerationPrincipal({ tenant_id: fields.tenant_id, subject_id: fields.subject,
      connection_id: "link_uni_preparer_binding_0123456789" });
    return Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  } catch { fail("INVALID_REQUEST"); }
}

function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) fail("INVALID_REQUEST"); return value; }
function readClock(value: unknown): () => number {
  if (value === undefined) return Date.now;
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => Reflect.apply(value, undefined, []) as number;
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function isModel(value: unknown): value is OwnerUniImageModel { return typeof value === "string" && OWNER_UNI_IMAGE_MODELS.includes(value as OwnerUniImageModel); }
function isPlainPort(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function fail(code: OwnerUniImageRequestPrepareErrorCode): never { throw new OwnerUniImageRequestPrepareError(code); }

export function createOwnerUniImageRequestPreparer(options: OwnerUniImageRequestPreparerOptions | unknown): OwnerUniImageRequestPreparer {
  return new OwnerUniImageRequestPreparer(options);
}
