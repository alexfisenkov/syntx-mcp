import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  OwnerGrokT2iImageUploadService,
  type OwnerGrokT2iOwnedReferenceResolution,
  type OwnerGrokT2iReferenceResolverContext
} from "./owner-grok-t2i-image-upload-service.js";
import {
  getOwnerGrokT2iSourceProfile,
  type OwnerGrokT2iCatalogPort,
  type OwnerGrokT2iSourceProfile
} from "./owner-grok-t2i-source-profile.js";
import { normalizeOwnerGrokT2iParameters, type OwnerGrokT2iModel, type OwnerGrokT2iNormalizedParameters } from "./owner-grok-t2i-parameters.js";
import { projectOwnerGrokT2iCostParameters } from "./owner-grok-t2i-cost-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^grok_t2i_image_[0-9a-f-]{36}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_ACTIVE = 128;
const SOURCE_WIRE_BINDING = Object.freeze({
  helper: "video.js",
  build_id: "1791467421",
  sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
  confidence: "SOURCE_MAPPED_ORDINARY_EXPLICIT_NOT_RENDERED_GROK_SUBMIT"
} as const);
const MAX_PROMPT_UNITS = Object.freeze({
  grok_t2i: 5_000, grok_t2i_pro: 5_000, grok_imagine_2: 1_000, grok_imagine_quality: 1_000
} as const);

export interface OwnerGrokT2iRequestPreparerOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly imageUploadService: OwnerGrokT2iImageUploadService;
  readonly catalog: OwnerGrokT2iCatalogPort;
  readonly catalog_version: string;
  readonly now?: () => number;
}
export interface OwnerGrokT2iAssetIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly prompt: string;
  readonly parameters: unknown;
  readonly reference_handles: readonly string[];
  readonly signal?: AbortSignal;
}
export interface OwnerGrokT2iReferenceMetadata {
  readonly source_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}
const ASSET_BRAND: unique symbol = Symbol("OwnerGrokT2iOwnedAssetSet");
const CANDIDATE_BRAND: unique symbol = Symbol("OwnerGrokT2iPreparedCandidate");
export interface OwnerGrokT2iOwnedAssetSet {
  readonly [ASSET_BRAND]: true;
  readonly status: "nominal";
  readonly model_id: OwnerGrokT2iModel;
  readonly reference_count: number;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly expires_at: number;
  readonly references: readonly OwnerGrokT2iReferenceMetadata[];
}
export interface OwnerGrokT2iAssetPrepareInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly asset_set: OwnerGrokT2iOwnedAssetSet;
  readonly signal?: AbortSignal;
}
export interface OwnerGrokT2iPreparedCandidate {
  readonly [CANDIDATE_BRAND]: true;
  readonly status: "blocked";
  readonly source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: string;
  readonly profile_schema_hash: string;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly model_id: OwnerGrokT2iModel;
  readonly ai_name: "grok_image";
  readonly model_type: OwnerGrokT2iModel;
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly prompt_local_max_utf16_units: number;
  readonly prompt_limit_confidence: "SOURCE_UI_BUDGET_LOCAL_REJECTION_NOT_PROVIDER_LIMIT";
  readonly source_wire_binding: typeof SOURCE_WIRE_BINDING;
  readonly parameters: Readonly<{ aspect_ratio: string; resolution: string; batch_size: number; details_quality?: "low" | "medium" }>;
  readonly reference_count: number;
  readonly references: readonly OwnerGrokT2iReferenceMetadata[];
  readonly cost_routing: Readonly<{ ai_name: "grok_image"; model_type: OwnerGrokT2iModel }>;
  readonly source_cost_binding: Readonly<Record<string, unknown>>;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly cost_input_confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly request: Readonly<{ prompt: string; settings: Readonly<Record<string, unknown>> }>;
}
export type OwnerGrokT2iRequestPrepareErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_MISMATCH" | "ASSET_UNAVAILABLE" | "ASSET_EXPIRED"
  | "PARAMETERS_INVALID" | "PROMPT_INVALID" | "CLOCK_INVALID" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "REQUEST_ABORTED" | "PRINCIPAL_NOT_LINKED" | "SERVICE_CLOSED";
export class OwnerGrokT2iRequestPrepareError extends Error {
  constructor(readonly code: OwnerGrokT2iRequestPrepareErrorCode) {
    super("The owner Grok T2I request candidate could not be prepared safely.");
    this.name = "OwnerGrokT2iRequestPrepareError";
  }
}

interface AssetState {
  readonly owner: OwnerGrokT2iRequestPreparer;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly profile: Readonly<OwnerGrokT2iSourceProfile>;
  readonly prompt: string;
  readonly normalized: OwnerGrokT2iNormalizedParameters;
  readonly handles: readonly string[];
  readonly references: readonly OwnerGrokT2iOwnedReferenceResolution[];
  readonly expires_at: number;
  readonly epoch: number;
}
interface CandidateState {
  readonly owner: OwnerGrokT2iRequestPreparer;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly asset_set: object;
  readonly profile: Readonly<OwnerGrokT2iSourceProfile>;
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
export class OwnerGrokT2iRequestPreparer {
  readonly #imageUploadService: OwnerGrokT2iImageUploadService;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerGrokT2iCatalogPort;
  readonly #catalogVersion: string;
  readonly #now: () => number;
  readonly #assetsByAttempt = new Map<string, Set<object>>();
  readonly #candidatesByAttempt = new Map<string, Set<object>>();
  readonly #candidateByAssetSet = new WeakMap<object, OwnerGrokT2iPreparedCandidate>();
  readonly #epochs = new Map<string, number>();
  readonly #operationsByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #lastNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerGrokT2iRequestPreparerOptions | unknown) {
    const fields = exact(optionsInput, ["binding", "linkService", "imageUploadService", "catalog", "catalog_version"], ["now"]);
    if (types.isProxy(fields.imageUploadService) || !(fields.imageUploadService instanceof OwnerGrokT2iImageUploadService) ||
        !fields.linkService || typeof fields.linkService !== "object" || Array.isArray(fields.linkService) || types.isProxy(fields.linkService) ||
        !fields.catalog || typeof fields.catalog !== "object" || Array.isArray(fields.catalog) || types.isProxy(fields.catalog) ||
        fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#imageUploadService = fields.imageUploadService;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerGrokT2iCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#now = readClock(fields.now);
    for (const model of ["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"] as const) this.#profile(model);
  }

  async issue(input: OwnerGrokT2iAssetIssueInput | unknown): Promise<OwnerGrokT2iOwnedAssetSet> {
    const request = snapshotIssue(input);
    this.#assertOpen();
    if (request.signal?.aborted) fail("REQUEST_ABORTED");
    const profile = this.#profile(request.model_id);
    const prompt = validatePrompt(request.prompt, request.model_id);
    const handles = snapshotHandles(request.reference_handles, profile.reference_selector.maximum);
    const normalized = normalizeParameters(request.model_id, handles.length, request.parameters);
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
      const references: OwnerGrokT2iOwnedReferenceResolution[] = [];
      for (const handle of handles) {
        this.#throwIfAborted(operation);
        const context = this.#resolverContext(request.principal, request.attempt_id, request.model_id, profile, handle);
        let resolved: OwnerGrokT2iOwnedReferenceResolution;
        try { resolved = await this.#imageUploadService.resolveReference(context, operation.controller.signal); }
        catch { if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); fail("ASSET_UNAVAILABLE"); }
        this.#throwIfAborted(operation);
        if (!this.#imageUploadService.isOwnedReferenceResolution(resolved, context)) fail("ASSET_UNAVAILABLE");
        const reference = validateResolution(resolved, context, issuedAt);
        if (references.some((previous) => previous.asset_id === reference.asset_id || previous.canonical_url === reference.canonical_url || previous.sha256 === reference.sha256)) fail("ASSET_UNAVAILABLE");
        references.push(reference);
      }
      this.#profile(request.model_id);
      if ((this.#epochs.get(request.attempt_id) ?? 0) !== epoch) fail("ASSET_UNAVAILABLE");
      const now = this.#readNow();
      const expiresAt = Math.min(issuedAt + TTL_MS, ...references.map((reference) => reference.expires_at));
      if (expiresAt <= now) fail("ASSET_EXPIRED");
      const set = Object.create(null) as OwnerGrokT2iOwnedAssetSet;
      Object.defineProperties(set, {
        [ASSET_BRAND]: { value: true }, status: { value: "nominal" }, model_id: { value: request.model_id },
        reference_count: { value: references.length }, profile_schema_hash: { value: profile.profile_schema_hash },
        catalog_version: { value: profile.public_catalog_version }, expires_at: { value: expiresAt },
        references: { value: metadataFor(references) }
      });
      Object.freeze(set);
      assetStates.set(set, Object.freeze({ owner: this, principal: request.principal, attempt_id: request.attempt_id,
        model_id: request.model_id, profile, prompt, normalized, handles, references: Object.freeze(references), expires_at: expiresAt, epoch }));
      const active = this.#assetsByAttempt.get(request.attempt_id) ?? new Set<object>();
      active.add(set); this.#assetsByAttempt.set(request.attempt_id, active);
      return set;
    } finally { this.#finish(request.attempt_id, operation); }
  }

  async prepare(input: unknown): Promise<OwnerGrokT2iPreparedCandidate> {
    const request = snapshotPrepare(input);
    const { attempt_id: attemptId, principal, asset_set: assetSet } = request;
    this.#assertOpen();
    if (request.signal?.aborted) fail("REQUEST_ABORTED");
    if (!assetSet || typeof assetSet !== "object" || Array.isArray(assetSet) || types.isProxy(assetSet)) fail("ASSET_UNAVAILABLE");
    const state = assetStates.get(assetSet as object);
    if (!state || state.owner !== this || revokedAssets.has(assetSet as object) || state.attempt_id !== attemptId ||
        !sameGenerationPrincipal(state.principal, principal)) fail("ASSET_UNAVAILABLE");
    this.#assertOpen();
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const profile = this.#profile(state.model_id);
    if (profile.profile_schema_hash !== state.profile.profile_schema_hash || profile.public_catalog_version !== state.profile.public_catalog_version) fail("PROFILE_BINDING_MISMATCH");
    const now = this.#readNow();
    this.#pruneExpired(now);
    if (state.expires_at <= now || (this.#epochs.get(attemptId) ?? 0) !== state.epoch) fail("ASSET_EXPIRED");
    const operation = this.#begin(attemptId, request.signal);
    const epoch = operation.epoch;
    try {
      const currentPrincipal = await this.#resolvePrincipal(attemptId, operation.controller.signal);
      this.#throwIfAborted(operation);
      if (!sameGenerationPrincipal(currentPrincipal, principal)) fail("PRINCIPAL_MISMATCH");
      const fresh: OwnerGrokT2iOwnedReferenceResolution[] = [];
      for (let index = 0; index < state.handles.length; index += 1) {
        this.#throwIfAborted(operation);
        const handle = state.handles[index]!;
        const context = this.#resolverContext(principal, attemptId, state.model_id, profile, handle);
        let resolved: OwnerGrokT2iOwnedReferenceResolution;
        try { resolved = await this.#imageUploadService.resolveReference(context, operation.controller.signal); }
        catch { if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); fail("ASSET_UNAVAILABLE"); }
        this.#throwIfAborted(operation);
        if (!this.#imageUploadService.isOwnedReferenceResolution(resolved, context)) fail("ASSET_UNAVAILABLE");
        const reference = validateResolution(resolved, context, now);
        if (!sameReference(state.references[index]!, reference)) fail("ASSET_UNAVAILABLE");
        fresh.push(reference);
      }
      const checkedAt = this.#readNow();
      if ((this.#epochs.get(attemptId) ?? 0) !== epoch || state.expires_at <= checkedAt) fail("ASSET_EXPIRED");
      const existingCandidate = this.#candidateByAssetSet.get(assetSet as object);
      if (existingCandidate && !revokedCandidates.has(existingCandidate) && candidateStates.has(existingCandidate)) return existingCandidate;
      if (this.#candidateCount() >= MAX_ACTIVE) fail("CAPACITY_EXCEEDED");
      const settings: Record<string, unknown> = {
        n: 1, model_type: state.model_id, aspect_ratio: state.normalized.parameters.aspect_ratio,
        resolution: state.normalized.parameters.resolution, batch_size: state.normalized.parameters.batch_size,
        ...(state.model_id === "grok_imagine_2" ? { details_quality: state.normalized.parameters.details_quality } : {}),
        file_urls: fresh.map((reference) => Object.freeze({ type: "image" as const, url: reference.canonical_url }))
      };
      const requestBody = deepFreeze({ prompt: state.prompt, settings });
      const cost = projectOwnerGrokT2iCostParameters({ model_id: state.model_id, reference_count: fresh.length, parameters: state.normalized.parameters });
      const requestFingerprint = schemaHash({ principal, attempt_id: attemptId, model_id: state.model_id,
        profile_schema_hash: profile.profile_schema_hash, prompt: state.prompt, parameters: state.normalized.parameters,
        source_wire_binding: SOURCE_WIRE_BINDING, source_cost_binding: cost.source_binding,
        references: fresh.map(referenceFingerprint), request: requestBody });
      const intentFingerprint = schemaHash({ principal: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
        model_id: state.model_id, profile_schema_hash: profile.profile_schema_hash, prompt: state.prompt,
        parameters: state.normalized.parameters, source_wire_binding: SOURCE_WIRE_BINDING, source_cost_binding: cost.source_binding,
        references: fresh.map((reference) => ({ sha256: reference.sha256, size: reference.size })) });
      const candidateData: Record<string, unknown> = {
        [CANDIDATE_BRAND]: true, status: "blocked", source_readiness: "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT",
        dispatch_allowed: false, backend_acceptance: "UNPROVEN", profile_id: profile.profile_id,
        profile_schema_hash: profile.profile_schema_hash, source_binding: profile.source_binding,
        model_id: state.model_id, ai_name: "grok_image", model_type: state.model_id, scope: "image", operation_id: "generate-image",
        prompt_local_max_utf16_units: MAX_PROMPT_UNITS[state.model_id], prompt_limit_confidence: "SOURCE_UI_BUDGET_LOCAL_REJECTION_NOT_PROVIDER_LIMIT",
        source_wire_binding: SOURCE_WIRE_BINDING,
        parameters: state.normalized.parameters, reference_count: fresh.length, references: metadataFor(fresh),
        cost_routing: cost.routing, source_cost_binding: cost.source_binding, cost_inputs: cost.cost_inputs, cost_input_confidence: cost.confidence,
        expires_at: state.expires_at, request_fingerprint: requestFingerprint, intent_fingerprint: intentFingerprint
      };
      Object.defineProperty(candidateData, "request", { value: requestBody, enumerable: false, writable: false, configurable: false });
      Object.freeze(candidateData);
      const candidate = candidateData as unknown as OwnerGrokT2iPreparedCandidate;
      candidateStates.set(candidate, Object.freeze({ owner: this, principal, attempt_id: attemptId, asset_set: assetSet as object,
        profile, expires_at: state.expires_at, epoch, request_fingerprint: candidate.request_fingerprint }));
      this.#candidateByAssetSet.set(assetSet as object, candidate);
      const bucket = this.#candidatesByAttempt.get(attemptId) ?? new Set<object>(); bucket.add(candidate); this.#candidatesByAttempt.set(attemptId, bucket);
      return candidate;
    } finally { this.#finish(attemptId, operation); }
  }

  isPreparedCandidateForPrincipal(candidate: unknown, principalInput: unknown, attemptIdInput: unknown): candidate is OwnerGrokT2iPreparedCandidate {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate)) return false;
    const state = candidateStates.get(candidate as object);
    if (!state || state.owner !== this || revokedCandidates.has(candidate as object) || revokedAssets.has(state.asset_set) || state.attempt_id !== attemptIdInput) return false;
    try {
      const principal = snapshotPrincipal(principalInput, attemptIdInput);
      const now = this.#readNow(); const profile = this.#profile(state.profile.model_id);
      const assetState = assetStates.get(state.asset_set);
      if (!assetState || revokedAssets.has(state.asset_set) || assetState.owner !== this || assetState.expires_at <= now ||
          (this.#epochs.get(state.attempt_id) ?? 0) !== assetState.epoch) return false;
      for (let index = 0; index < assetState.references.length; index += 1) {
        const context = this.#resolverContext(assetState.principal, assetState.attempt_id, assetState.model_id, assetState.profile, assetState.handles[index]!);
        if (!this.#imageUploadService.isOwnedReferenceResolution(assetState.references[index], context)) return false;
      }
      return sameGenerationPrincipal(state.principal, principal) && state.expires_at > now &&
        (this.#epochs.get(state.attempt_id) ?? 0) === state.epoch && profile.profile_schema_hash === state.profile.profile_schema_hash &&
        (candidate as OwnerGrokT2iPreparedCandidate).dispatch_allowed === false &&
        (candidate as OwnerGrokT2iPreparedCandidate).request_fingerprint === state.request_fingerprint;
    } catch { return false; }
  }

  async invalidateAttempt(attemptIdInput: string): Promise<void> {
    if (!ATTEMPT.test(attemptIdInput)) return;
    this.#epochs.set(attemptIdInput, (this.#epochs.get(attemptIdInput) ?? 0) + 1);
    for (const asset of this.#assetsByAttempt.get(attemptIdInput) ?? []) revokedAssets.add(asset);
    for (const candidate of this.#candidatesByAttempt.get(attemptIdInput) ?? []) revokedCandidates.add(candidate);
    for (const operation of this.#operationsByAttempt.get(attemptIdInput) ?? []) operation.controller.abort();
    await Promise.allSettled([...(this.#operationsByAttempt.get(attemptIdInput) ?? [])].map((operation) => operation.done));
    this.#assetsByAttempt.delete(attemptIdInput); this.#candidatesByAttempt.delete(attemptIdInput);
    await this.#imageUploadService.invalidateAttempt(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const sets of this.#assetsByAttempt.values()) for (const set of sets) revokedAssets.add(set);
    for (const candidates of this.#candidatesByAttempt.values()) for (const candidate of candidates) revokedCandidates.add(candidate);
    for (const operations of this.#operationsByAttempt.values()) for (const operation of operations) operation.controller.abort();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => {
      this.#assetsByAttempt.clear(); this.#candidatesByAttempt.clear(); this.#epochs.clear(); this.#operationsByAttempt.clear();
    });
    return this.#closing;
  }

  #resolverContext(principal: Readonly<GenerationPrincipalRef>, attemptId: string, modelId: OwnerGrokT2iModel,
    profile: Readonly<OwnerGrokT2iSourceProfile>, handle: string): OwnerGrokT2iReferenceResolverContext {
    return Object.freeze({ principal, attempt_id: attemptId, model_id: modelId as "grok_imagine_2" | "grok_imagine_quality",
      ai_name: "grok_image", scope: "image", operation_id: "generate-image", catalog_version: profile.public_catalog_version,
      profile_schema_hash: profile.profile_schema_hash, reference_handle: handle });
  }
  #profile(model: OwnerGrokT2iModel): Readonly<OwnerGrokT2iSourceProfile> {
    try { return getOwnerGrokT2iSourceProfile(model, this.#catalog, this.#catalogVersion); } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }
  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal.aborted) fail("REQUEST_ABORTED");
    const promise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerGrokT2iRequestPrepareError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    try { return await Promise.race([promise, aborted]); }
    catch (error) {
      if (error instanceof OwnerGrokT2iRequestPrepareError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PRINCIPAL_NOT_LINKED");
    } finally { remove(); }
  }
  #begin(attemptId: string, parentSignal?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(); const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort(); else parentSignal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = { controller, done, finish, epoch: this.#epochs.get(attemptId) ?? 0,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abort) };
    const bucket = this.#operationsByAttempt.get(attemptId) ?? new Set<PendingOperation>(); bucket.add(operation);
    this.#operationsByAttempt.set(attemptId, bucket); this.#allOperations.add(done); this.#pendingCount += 1; return operation;
  }
  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort(); const bucket = this.#operationsByAttempt.get(attemptId); bucket?.delete(operation);
    if (bucket?.size === 0) this.#operationsByAttempt.delete(attemptId);
    this.#pendingCount -= 1; operation.finish(); this.#allOperations.delete(operation.done);
  }
  #readNow(): number {
    let value: unknown; try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("CLOCK_INVALID");
    this.#lastNow = value as number; return value as number;
  }
  #pruneExpired(now: number): void {
    for (const [attemptId, sets] of this.#assetsByAttempt) {
      for (const set of sets) { const state = assetStates.get(set); if (!state || state.expires_at <= now) { revokedAssets.add(set); sets.delete(set); } }
      if (sets.size === 0) this.#assetsByAttempt.delete(attemptId);
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
  #activeCount(): number { let count = 0; for (const sets of this.#assetsByAttempt.values()) count += sets.size; return count; }
  #candidateCount(): number { let count = 0; for (const candidates of this.#candidatesByAttempt.values()) count += candidates.size; return count; }
  #throwIfAborted(operation: PendingOperation): void { this.#assertOpen(); if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

function snapshotIssue(value: unknown): Readonly<OwnerGrokT2iAssetIssueInput> {
  const fields = exact(value, ["principal", "attempt_id", "model_id", "prompt", "parameters", "reference_handles"], ["signal"]);
  const attemptId = readAttempt(fields.attempt_id);
  if (!isModel(fields.model_id)) fail("INVALID_REQUEST");
  const principal = snapshotPrincipal(fields.principal, attemptId);
  if (fields.signal !== undefined && (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ principal, attempt_id: attemptId, model_id: fields.model_id, prompt: fields.prompt as string,
    parameters: fields.parameters, reference_handles: fields.reference_handles as readonly string[],
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}
function snapshotPrepare(value: unknown): Readonly<OwnerGrokT2iAssetPrepareInput> {
  const fields = exact(value, ["principal", "attempt_id", "asset_set"], ["signal"]);
  const attemptId = readAttempt(fields.attempt_id);
  if (fields.signal !== undefined && (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ principal: snapshotPrincipal(fields.principal, attemptId), attempt_id: attemptId,
    asset_set: fields.asset_set as OwnerGrokT2iOwnedAssetSet,
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}
function snapshotPrincipal(value: unknown, attemptIdInput: unknown): Readonly<GenerationPrincipalRef> {
  const attemptId = readAttempt(attemptIdInput);
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}
function snapshotBinding(value: unknown): Readonly<{ tenant_id: string; subject: string }> {
  const fields = exact(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  try {
    const principal = snapshotGenerationPrincipal({ tenant_id: fields.tenant_id, subject_id: fields.subject, connection_id: "link_grok_binding_snapshot_00000001" });
    return Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  } catch { fail("INVALID_REQUEST"); }
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function snapshotHandles(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !Object.hasOwn(descriptors, "length")) fail("INVALID_REQUEST");
  const handles: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" || !HANDLE.test(descriptor.value)) fail("INVALID_REQUEST");
    handles.push(descriptor.value);
  }
  if (handles.length > maximum || new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  return Object.freeze(handles);
}
function normalizeParameters(model: OwnerGrokT2iModel, referenceCount: number, parameters: unknown): OwnerGrokT2iNormalizedParameters {
  try { return normalizeOwnerGrokT2iParameters({ model_id: model, reference_count: referenceCount, parameters }); }
  catch { fail("PARAMETERS_INVALID"); }
}
function validatePrompt(value: unknown, model: OwnerGrokT2iModel): string {
  if (typeof value !== "string" || !value.trim() || !isWellFormed(value) ||
      value.length + (value.match(/\n/gu)?.length ?? 0) > MAX_PROMPT_UNITS[model]) fail("PROMPT_INVALID");
  return value;
}
function isWellFormed(value: string): boolean { return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value); }
function validateResolution(value: OwnerGrokT2iOwnedReferenceResolution, context: OwnerGrokT2iReferenceResolverContext,
  now: number): OwnerGrokT2iOwnedReferenceResolution {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value) ||
      value.attempt_id !== context.attempt_id || value.model_id !== context.model_id || value.ai_name !== "grok_image" ||
      value.scope !== "image" || value.operation_id !== "generate-image" || value.catalog_version !== context.catalog_version ||
      value.profile_schema_hash !== context.profile_schema_hash || value.reference_handle !== context.reference_handle ||
      !sameGenerationPrincipal(value.principal, context.principal) || value.asset_role !== "image_reference" ||
      value.provenance !== "private_r2_owned" || value.provenance_verified !== true || typeof value.asset_id !== "string" ||
      value.asset_id.length < 1 || value.asset_id.length > 256 || !isSafeUploadReferenceUrl(value.canonical_url) ||
      !Number.isSafeInteger(value.expires_at) || value.expires_at <= now || !Number.isSafeInteger(value.size) || value.size < 1 ||
      !Number.isSafeInteger(value.width) || value.width < 1 || !Number.isSafeInteger(value.height) || value.height < 1 ||
      !SHA256.test(value.sha256) || value.metadata_confidence !== "CONTAINER_METADATA_ONLY") fail("ASSET_UNAVAILABLE");
  let url: URL;
  try { url = new URL(value.canonical_url); } catch { fail("ASSET_UNAVAILABLE"); }
  if (url.search || url.username || url.password || url.hash) fail("ASSET_UNAVAILABLE");
  return value;
}
function sameReference(a: OwnerGrokT2iOwnedReferenceResolution, b: OwnerGrokT2iOwnedReferenceResolution): boolean {
  return a.reference_handle === b.reference_handle && a.asset_id === b.asset_id && a.canonical_url === b.canonical_url &&
    a.sha256 === b.sha256 && a.size === b.size && a.width === b.width && a.height === b.height &&
    a.source_mime_type === b.source_mime_type && a.mime_type === b.mime_type && a.expires_at === b.expires_at &&
    a.profile_schema_hash === b.profile_schema_hash;
}
function metadataFor(references: readonly OwnerGrokT2iOwnedReferenceResolution[]): readonly OwnerGrokT2iReferenceMetadata[] {
  return deepFreeze(references.map((reference) => ({ source_mime_type: reference.source_mime_type, mime_type: reference.mime_type,
    width: reference.width, height: reference.height, size: reference.size, sha256: reference.sha256,
    metadata_confidence: "CONTAINER_METADATA_ONLY" as const })));
}
function referenceFingerprint(reference: OwnerGrokT2iOwnedReferenceResolution): Readonly<Record<string, unknown>> {
  return Object.freeze({ asset_id: reference.asset_id, canonical_url: reference.canonical_url, sha256: reference.sha256,
    size: reference.size, mime_type: reference.mime_type, source_mime_type: reference.source_mime_type, expires_at: reference.expires_at });
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
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
function isModel(value: unknown): value is OwnerGrokT2iModel {
  return value === "grok_t2i" || value === "grok_t2i_pro" || value === "grok_imagine_2" || value === "grok_imagine_quality";
}
function fail(code: OwnerGrokT2iRequestPrepareErrorCode): never { throw new OwnerGrokT2iRequestPrepareError(code); }

export function createOwnerGrokT2iRequestPreparer(options: OwnerGrokT2iRequestPreparerOptions | unknown): OwnerGrokT2iRequestPreparer {
  return new OwnerGrokT2iRequestPreparer(options);
}
