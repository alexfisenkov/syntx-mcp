import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient, type GrokImagineImageReferenceUploadRequest } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  OwnerGrokT2iImageInputError,
  OWNER_GROK_T2I_IMAGE_INPUT_POLICY,
  validateOwnerGrokT2iImageUploadData,
  type OwnerGrokT2iImageModelId,
  type OwnerGrokT2iImageSourceMimeType,
  type ValidatedOwnerGrokT2iImageUploadData
} from "./owner-grok-t2i-image-input-validator.js";
import {
  getOwnerGrokT2iSourceProfile,
  type OwnerGrokT2iCatalogPort,
  type OwnerGrokT2iSourceProfile
} from "./owner-grok-t2i-source-profile.js";
import { OWNER_GROK_T2I_MODELS, type OwnerGrokT2iModel } from "./owner-grok-t2i-parameters.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^grok_t2i_image_[0-9a-f-]{36}$/u;
const FILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const MAX_BASE64_CHARS = Math.ceil(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.local_max_bytes / 3) * 4;
const NATIVE_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadGrokImagineImageReference;
const RESOLUTIONS = new WeakMap<object, ResolutionBrand>();

export interface OwnerGrokT2iImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerGrokT2iCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerGrokT2iImageUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: OwnerGrokT2iImageSourceMimeType;
  readonly signal?: AbortSignal;
}

export interface OwnerGrokT2iImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: OwnerGrokT2iImageModelId;
  readonly source_mime_type: OwnerGrokT2iImageSourceMimeType;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
}

export interface OwnerGrokT2iReferenceResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerGrokT2iImageModelId;
  readonly ai_name: "grok_image";
  readonly scope: "image";
  readonly operation_id: "generate-image";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
}

/** Internal, nominal and short-lived; never serialize this resolution outside the owner application pipeline. */
export interface OwnerGrokT2iOwnedReferenceResolution extends OwnerGrokT2iReferenceResolverContext {
  readonly asset_role: "image_reference";
  readonly provenance: "private_r2_owned";
  readonly provenance_verified: true;
  readonly asset_id: string;
  readonly canonical_url: string;
  readonly source_mime_type: OwnerGrokT2iImageSourceMimeType;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export type OwnerGrokT2iImageUploadServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "CLOCK_INVALID" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_IN_PROGRESS" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerGrokT2iImageUploadServiceError extends Error {
  constructor(readonly code: OwnerGrokT2iImageUploadServiceErrorCode) {
    super("The owner Grok T2I image upload is unavailable.");
    this.name = "OwnerGrokT2iImageUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly stablePrincipalKey: string;
  readonly semanticKey: string;
  readonly successKey: string;
  readonly modelId: OwnerGrokT2iImageModelId;
  readonly aiName: "grok_image";
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly assetId: string;
  readonly sourceMimeType: OwnerGrokT2iImageSourceMimeType;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expiresAt: number;
  readonly epoch: number;
}

interface PendingOperation {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
  semanticKey?: string;
}

interface ResolutionBrand {
  readonly owner: OwnerGrokT2iImageUploadService;
  readonly record: PrivateRecord;
  readonly epoch: number;
}

/** Process-local upload/resolve boundary; handles bind private bytes to one attempt and never grant provider acceptance. */
export class OwnerGrokT2iImageUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerGrokT2iCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerGrokT2iImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerGrokT2iModel, Readonly<OwnerGrokT2iSourceProfile>>();
  readonly #records = new Map<string, PrivateRecord>();
  readonly #successByAttemptSemantic = new Map<string, string>();
  readonly #successKeysByAttempt = new Map<string, Set<string>>();
  readonly #resolutionsByHandle = new Map<string, object>();
  readonly #unknownSemanticHolds = new Set<string>();
  readonly #pendingBySemantic = new Map<string, string>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #epochs = new Map<string, number>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #lastObservedNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerGrokT2iImageUploadServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isPlainService(fields.linkService) ||
        !isPlainService(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerGrokT2iCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#resolveClient = fields.resolveClient as OwnerGrokT2iImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const model of OWNER_GROK_T2I_MODELS) this.#profiles.set(model, getOwnerGrokT2iSourceProfile(model, this.#catalog, this.#catalogVersion));
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerGrokT2iImageUploadInput | unknown): Promise<OwnerGrokT2iImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    if (request.signal?.aborted) fail("REQUEST_ABORTED");
    if (!isUploadableModel(request.model_id)) fail("INVALID_REQUEST");
    const profile = this.#assertProfile(request.model_id);
    if (profile.public_settings.uploadable !== true) fail("INVALID_REQUEST");

    let decoded: Buffer | undefined;
    let validated: ValidatedOwnerGrokT2iImageUploadData | undefined;
    let operation: PendingOperation | undefined;
    let invoked = false;
    let semanticKey: string | undefined;
    try {
      decoded = decodeCanonicalBase64(request.content_base64);
      try {
        validated = validateOwnerGrokT2iImageUploadData({ model_id: request.model_id, bytes: decoded,
          filename: request.filename, mime_type: request.mime_type });
      } catch (error) { throw mapInputError(error); }
      decoded.fill(0);
      decoded = undefined;
      const acceptedFileTypes = profile.public_settings.accepted_file_types;
      if (!Array.isArray(acceptedFileTypes) || !acceptedFileTypes.includes(validated.source_mime_type)) fail("MODEL_BINDING_MISMATCH");
      operation = this.#beginOperation(request.attemptId, request.signal);
      this.#throwIfClosedOrAborted(operation);
      this.#assertProfile(request.model_id);
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const now = this.#readNow();
      this.#pruneExpired(now);
      const stablePrincipalKey = stablePrincipalKeyFor(principal);
      semanticKey = semanticKeyFor(stablePrincipalKey, request.model_id, validated.sha256);
      operation.semanticKey = semanticKey;
      const successKey = successKeyFor(stablePrincipalKey, request.attemptId, request.model_id, validated.sha256);
      const existing = this.#findSameAttemptSuccess(successKey, semanticKey, principal, now);
      if (existing) return this.#receipt(existing);
      if (this.#unknownSemanticHolds.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingBySemantic.has(semanticKey)) fail("UPLOAD_IN_PROGRESS");
      if (this.#records.size + this.#unknownSemanticHolds.size + this.#pendingBySemantic.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingBySemantic.set(semanticKey, request.attemptId);

      const native = snapshotNativeClient(this.#resolveClient(request.attemptId));
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CLOCK_INVALID");
      const expiresAt = issuedAt + TTL_MS;
      const epoch = operation.epoch;
      const nativeRequest: GrokImagineImageReferenceUploadRequest = Object.freeze({
        model_id: request.model_id, bytes: validated.bytes, filename: validated.filename, mime_type: validated.source_mime_type
      });
      this.#throwIfClosedOrAborted(operation);
      invoked = true;
      const rawReceipt = await Reflect.apply(native.method, native.client, [nativeRequest, operation.controller.signal]);
      this.#throwIfClosedOrAborted(operation);
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("REQUEST_ABORTED");
      const privateReference = parseUploadReference(rawReceipt);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertProfile(request.model_id);
      const finishedAt = this.#readNow();
      if (expiresAt <= finishedAt || (this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#pruneExpired(finishedAt);
      const handle = `grok_t2i_image_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: PrivateRecord = Object.freeze({
        handle, attemptId: request.attemptId, principal, stablePrincipalKey, semanticKey, successKey,
        modelId: request.model_id, aiName: profile.ai_name, catalogVersion: profile.public_catalog_version,
        profileSchemaHash: profile.profile_schema_hash, fileUrl: privateReference.url,
        assetId: trustedAssetId(privateReference), sourceMimeType: validated.source_mime_type,
        mimeType: validated.mime_type, width: validated.width, height: validated.height,
        size: validated.size, sha256: validated.sha256, expiresAt, epoch
      });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      this.#successByAttemptSemantic.set(record.successKey, handle);
      const successKeys = this.#successKeysByAttempt.get(request.attemptId) ?? new Set<string>();
      successKeys.add(record.successKey); this.#successKeysByAttempt.set(request.attemptId, successKeys);
      return this.#receipt(record);
    } catch (error) {
      if (error instanceof OwnerGrokT2iImageUploadServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") {
          if (semanticKey !== undefined) this.#unknownSemanticHolds.add(semanticKey);
          fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        throw error;
      }
      if (error instanceof OwnerGrokT2iImageInputError) {
        if (invoked) {
          if (semanticKey !== undefined) this.#unknownSemanticHolds.add(semanticKey);
          fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        fail("INVALID_IMAGE_INPUT");
      }
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(request.attemptId);
        if (invoked) {
          if (semanticKey !== undefined) this.#unknownSemanticHolds.add(semanticKey);
          fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError) {
        if (error.code === "AUTH_REQUIRED") fail("PRINCIPAL_NOT_LINKED");
        if (invoked && isKnownUploadRejection(error.code)) fail("UPLOAD_REJECTED");
      }
      if (invoked) {
        if (semanticKey !== undefined) this.#unknownSemanticHolds.add(semanticKey);
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      if (operation?.controller.signal.aborted || request.signal?.aborted) fail("REQUEST_ABORTED");
      if (error instanceof SyntxHttpError && error.code === "AUTH_OR_ACCESS_DENIED") fail("UPLOAD_REJECTED");
      return fail("INVALID_REQUEST");
    } finally {
      decoded?.fill(0);
      validated?.bytes.fill(0);
      if (operation) this.#finishOperation(request.attemptId, operation);
    }
  }

  async resolveReference(contextInput: OwnerGrokT2iReferenceResolverContext | unknown, signal?: AbortSignal): Promise<OwnerGrokT2iOwnedReferenceResolution> {
    const context = snapshotResolverContext(contextInput);
    this.#assertOpen();
    this.#assertContextBinding(context);
    const operation = this.#beginOperation(context.attempt_id, signal);
    try {
      const now = this.#readNow();
      this.#pruneExpired(now);
      const record = this.#records.get(context.reference_handle);
      if (!record) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
      this.#assertRecordContext(record, context, operation.epoch);
      this.#throwIfClosedOrAborted(operation);
      const principal = await this.#resolvePrincipal(context.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation);
      if (!sameGenerationPrincipal(principal, context.principal) || !sameGenerationPrincipal(principal, record.principal)) {
        this.#invalidateAttemptState(context.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertProfile(context.model_id);
      const resolvedAt = this.#readNow();
      if (record.expiresAt <= resolvedAt || this.#records.get(record.handle) !== record ||
          (this.#epochs.get(context.attempt_id) ?? 0) !== operation.epoch) fail("REFERENCE_EXPIRED");
      const existingResolution = this.#resolutionsByHandle.get(record.handle);
      if (existingResolution) return existingResolution as OwnerGrokT2iOwnedReferenceResolution;
      const resolution = deepFreeze({
        principal: record.principal, attempt_id: record.attemptId, model_id: record.modelId, ai_name: record.aiName,
        scope: "image" as const, operation_id: "generate-image" as const, catalog_version: record.catalogVersion,
        profile_schema_hash: record.profileSchemaHash, reference_handle: record.handle,
        asset_role: "image_reference" as const, provenance: "private_r2_owned" as const, provenance_verified: true as const,
        asset_id: record.assetId, canonical_url: record.fileUrl, source_mime_type: record.sourceMimeType, mime_type: record.mimeType,
        width: record.width, height: record.height, size: record.size, sha256: record.sha256, expires_at: record.expiresAt,
        metadata_confidence: "CONTAINER_METADATA_ONLY" as const
      }) as Readonly<OwnerGrokT2iOwnedReferenceResolution>;
      RESOLUTIONS.set(resolution as object, { owner: this, record, epoch: operation.epoch });
      this.#resolutionsByHandle.set(record.handle, resolution as object);
      return resolution;
    } catch (error) {
      if (error instanceof OwnerGrokT2iImageUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(context.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (operation.controller.signal.aborted || signal?.aborted) fail("REQUEST_ABORTED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(context.attempt_id, operation); }
  }

  isOwnedReferenceResolution(value: unknown, contextInput: OwnerGrokT2iReferenceResolverContext | unknown): value is OwnerGrokT2iOwnedReferenceResolution {
    if (!value || typeof value !== "object" || types.isProxy(value)) return false;
    const brand = RESOLUTIONS.get(value);
    if (!brand || brand.owner !== this || this.#closed || this.#records.get(brand.record.handle) !== brand.record) return false;
    let context: OwnerGrokT2iReferenceResolverContext;
    try { context = snapshotResolverContext(contextInput); } catch { return false; }
    try {
      const now = this.#readNow();
      return brand.record.expiresAt > now && brand.epoch === (this.#epochs.get(context.attempt_id) ?? 0) &&
        context.reference_handle === brand.record.handle && context.attempt_id === brand.record.attemptId &&
        context.model_id === brand.record.modelId && context.catalog_version === brand.record.catalogVersion &&
        context.profile_schema_hash === brand.record.profileSchemaHash &&
        sameGenerationPrincipal(context.principal, brand.record.principal) && this.#contextMatchesProfile(context);
    } catch { return false; }
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    this.#invalidateAttemptState(attemptId);
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    await Promise.allSettled(pending);
    this.#maybeReleaseAttempt(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const operations of this.#pendingByAttempt.values()) for (const operation of operations) operation.controller.abort();
    for (const resolution of this.#resolutionsByHandle.values()) RESOLUTIONS.delete(resolution);
    this.#resolutionsByHandle.clear();
    this.#records.clear(); this.#successByAttemptSemantic.clear(); this.#successKeysByAttempt.clear();
    this.#unknownSemanticHolds.clear(); this.#pendingBySemantic.clear(); this.#handlesByAttempt.clear();
    this.#principalByAttempt.clear(); this.#epochs.clear();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => {
      this.#unknownSemanticHolds.clear(); this.#pendingBySemantic.clear(); this.#records.clear();
      this.#successByAttemptSemantic.clear(); this.#successKeysByAttempt.clear(); this.#handlesByAttempt.clear();
      this.#principalByAttempt.clear(); this.#epochs.clear(); this.#resolutionsByHandle.clear();
    });
    return this.#closing;
  }

  #assertContextBinding(context: OwnerGrokT2iReferenceResolverContext): void {
    const profile = this.#assertProfile(context.model_id);
    if (context.principal.connection_id !== context.attempt_id || context.ai_name !== profile.ai_name || context.scope !== profile.scope ||
        context.operation_id !== profile.operation_id || context.catalog_version !== profile.public_catalog_version ||
        context.profile_schema_hash !== profile.profile_schema_hash || !HANDLE_PATTERN.test(context.reference_handle)) fail("MODEL_BINDING_MISMATCH");
  }

  #assertRecordContext(record: PrivateRecord, context: OwnerGrokT2iReferenceResolverContext, epoch: number): void {
    this.#assertContextBinding(context);
    if (record.attemptId !== context.attempt_id || record.modelId !== context.model_id ||
        record.catalogVersion !== context.catalog_version || record.profileSchemaHash !== context.profile_schema_hash ||
        record.epoch !== epoch || !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
  }

  #contextMatchesProfile(context: OwnerGrokT2iReferenceResolverContext): boolean {
    const profile = this.#profiles.get(context.model_id);
    return !!profile && profile.ai_name === context.ai_name && profile.scope === context.scope &&
      profile.operation_id === context.operation_id && profile.public_catalog_version === context.catalog_version &&
      profile.profile_schema_hash === context.profile_schema_hash;
  }

  #assertProfile(modelId: OwnerGrokT2iModel): Readonly<OwnerGrokT2iSourceProfile> {
    this.#assertOpen();
    const profile = this.#profiles.get(modelId);
    if (!profile) fail("MODEL_BINDING_MISMATCH");
    try {
      const current = getOwnerGrokT2iSourceProfile(modelId, this.#catalog, this.#catalogVersion);
      if (current.profile_schema_hash !== profile.profile_schema_hash || current.public_catalog_version !== profile.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
    } catch { fail("MODEL_BINDING_MISMATCH"); }
    return profile;
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return await principal;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerGrokT2iImageUploadServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    try { return await Promise.race([principal, aborted]); }
    finally { remove(); }
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const previous = this.#principalByAttempt.get(attemptId);
    if (previous && !sameGenerationPrincipal(previous, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal);
    return true;
  }

  #beginOperation(attemptId: string, parentSignal?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(attemptId)) fail("INVALID_REQUEST");
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent(); else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = { attemptId, controller, done, finish,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent), epoch: this.#epochs.get(attemptId) ?? 0 };
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done); this.#pendingCount += 1;
    return operation;
  }

  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId); pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    if (operation.semanticKey && this.#pendingBySemantic.get(operation.semanticKey) === attemptId) this.#pendingBySemantic.delete(operation.semanticKey);
    this.#pendingCount -= 1; operation.finish(); this.#allOperations.delete(operation.done); this.#maybeReleaseAttempt(attemptId);
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]);
  }

  #invalidateAttemptState(attemptId: string): void {
    if (!this.#activeAttempts().has(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptHandles(attemptId);
    this.#principalByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
  }

  #removeAttemptHandles(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#removeHandle(handle);
    this.#handlesByAttempt.delete(attemptId);
  }

  #removeHandle(handle: string): void {
    const record = this.#records.get(handle);
    if (!record) return;
    this.#records.delete(handle);
    this.#successByAttemptSemantic.delete(record.successKey);
    const successKeys = this.#successKeysByAttempt.get(record.attemptId);
    successKeys?.delete(record.successKey);
    if (successKeys?.size === 0) this.#successKeysByAttempt.delete(record.attemptId);
    const resolution = this.#resolutionsByHandle.get(record.handle);
    if (resolution) { RESOLUTIONS.delete(resolution); this.#resolutionsByHandle.delete(record.handle); }
    const handles = this.#handlesByAttempt.get(record.attemptId);
    handles?.delete(record.handle);
    if (handles?.size === 0) this.#handlesByAttempt.delete(record.attemptId);
    this.#maybeReleaseAttempt(record.attemptId);
  }

  #maybeReleaseAttempt(attemptId: string): void {
    if (!this.#handlesByAttempt.has(attemptId) && !this.#pendingByAttempt.has(attemptId)) {
      this.#principalByAttempt.delete(attemptId);
      this.#epochs.delete(attemptId);
    }
  }

  #pruneExpired(now: number): void {
    for (const record of this.#records.values()) if (record.expiresAt <= now) this.#removeHandle(record.handle);
  }

  #findSameAttemptSuccess(key: string, semanticKey: string, principal: Readonly<GenerationPrincipalRef>, now: number): PrivateRecord | undefined {
    const handle = this.#successByAttemptSemantic.get(key);
    if (!handle) return undefined;
    const record = this.#records.get(handle);
    if (!record || record.expiresAt <= now || record.semanticKey !== semanticKey ||
        record.epoch !== (this.#epochs.get(record.attemptId) ?? 0) || !sameGenerationPrincipal(record.principal, principal)) {
      if (record) this.#removeHandle(record.handle); else this.#successByAttemptSemantic.delete(key);
      return undefined;
    }
    return record;
  }

  #receipt(record: PrivateRecord): OwnerGrokT2iImageUploadReceipt {
    const remaining = record.expiresAt - this.#readNow();
    if (remaining <= 0) fail("REFERENCE_EXPIRED");
    return Object.freeze({ status: "uploaded", reference_handle: record.handle, model_id: record.modelId,
      source_mime_type: record.sourceMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
      size: record.size, sha256: record.sha256, expires_in_seconds: Math.ceil(remaining / 1000),
      metadata_confidence: "CONTAINER_METADATA_ONLY", size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" });
  }

  #readNow(): number {
    let value: unknown;
    try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 ||
        (this.#lastObservedNow !== undefined && (value as number) < this.#lastObservedNow)) fail("CLOCK_INVALID");
    this.#lastObservedNow = value as number;
    return value as number;
  }

  #throwIfClosedOrAborted(operation: PendingOperation): void {
    this.#assertOpen();
    if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

function snapshotUploadInput(value: unknown): Readonly<OwnerGrokT2iImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "model_id", "content_base64", "filename", "mime_type"], ["attemptId", "model_id", "content_base64", "filename", "mime_type", "signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || !isModel(fields.model_id) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
      (fields.signal !== undefined && (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: fields.model_id, content_base64: fields.content_base64,
    filename: fields.filename, mime_type: fields.mime_type as OwnerGrokT2iImageSourceMimeType,
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}

function snapshotResolverContext(value: unknown): Readonly<OwnerGrokT2iReferenceResolverContext> {
  const fields = exactRecord(value, ["principal", "attempt_id", "model_id", "ai_name", "scope", "operation_id", "catalog_version", "profile_schema_hash", "reference_handle"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT_PATTERN.test(fields.attempt_id) || !isUploadableModel(fields.model_id) ||
      fields.ai_name !== "grok_image" || fields.scope !== "image" || fields.operation_id !== "generate-image" ||
      typeof fields.catalog_version !== "string" || typeof fields.profile_schema_hash !== "string" || !SHA256_PATTERN.test(fields.profile_schema_hash) ||
      typeof fields.reference_handle !== "string" || !HANDLE_PATTERN.test(fields.reference_handle)) fail("INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  if (principal.connection_id !== fields.attempt_id) fail("MODEL_BINDING_MISMATCH");
  return Object.freeze({ principal, attempt_id: fields.attempt_id, model_id: fields.model_id,
    ai_name: "grok_image", scope: "image", operation_id: "generate-image", catalog_version: fields.catalog_version,
    profile_schema_hash: fields.profile_schema_hash, reference_handle: fields.reference_handle });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  try {
    const principal = snapshotGenerationPrincipal({ tenant_id: fields.tenant_id, subject_id: fields.subject, connection_id: "link_grok_binding_snapshot_0123456789" });
    return Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  } catch { fail("INVALID_REQUEST"); }
}

function decodeCanonicalBase64(value: string): Buffer {
  if (value.length === 0) fail("INVALID_IMAGE_INPUT");
  if (value.length > MAX_BASE64_CHARS) fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) fail("INVALID_IMAGE_INPUT");
  let decoded: Buffer | undefined;
  try {
    decoded = Buffer.from(value, "base64");
    if (decoded.byteLength < 1 || decoded.toString("base64") !== value) fail("INVALID_IMAGE_INPUT");
    if (decoded.byteLength > OWNER_GROK_T2I_IMAGE_INPUT_POLICY.local_max_bytes) fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
    const result = decoded;
    decoded = undefined;
    return result;
  } catch (error) {
    decoded?.fill(0);
    if (error instanceof OwnerGrokT2iImageUploadServiceError) throw error;
    fail("INVALID_IMAGE_INPUT");
  }
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient; method: typeof NATIVE_UPLOAD_METHOD }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("MODEL_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadGrokImagineImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || Object.hasOwn(value, "uploadGrokImagineImageReference") ||
      !descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("MODEL_BINDING_MISMATCH");
  return Object.freeze({ client: value, method: NATIVE_UPLOAD_METHOD });
}

function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["url", "file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !FILE_ID_PATTERN.test(fields.file_id))) ||
      (fields.file_id !== undefined && /[\u0000-\u001f\u007f]/u.test(fields.file_id))) fail("UPLOAD_OUTCOME_UNKNOWN");
  let url: URL;
  try { url = new URL(fields.url); } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
  if (url.search !== "") fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
}

function trustedAssetId(reference: InternalUploadReference): string {
  if (reference.file_id !== undefined) return reference.file_id;
  let pathname: string;
  try { pathname = new URL(reference.url).pathname; } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
  const id = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/u.test(id)) fail("UPLOAD_OUTCOME_UNKNOWN");
  return id;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { fail("INVALID_REQUEST"); }
  const allowed = [...required, ...optional], keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => Reflect.apply(value, undefined, []) as number;
}
function stablePrincipalKeyFor(principal: Readonly<GenerationPrincipalRef>): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id]);
}
function semanticKeyFor(stablePrincipalKey: string, modelId: OwnerGrokT2iImageModelId, sha256: string): string {
  return JSON.stringify([stablePrincipalKey, modelId, sha256]);
}
function successKeyFor(stablePrincipalKey: string, attemptId: string, modelId: OwnerGrokT2iImageModelId, sha256: string): string {
  return JSON.stringify([stablePrincipalKey, attemptId, modelId, sha256]);
}
function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function mapInputError(error: unknown): OwnerGrokT2iImageUploadServiceError {
  if (error instanceof OwnerGrokT2iImageInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    return new OwnerGrokT2iImageUploadServiceError("LOCAL_RESOURCE_LIMIT_EXCEEDED");
  }
  return new OwnerGrokT2iImageUploadServiceError("INVALID_IMAGE_INPUT");
}
function isUploadableModel(value: unknown): value is OwnerGrokT2iImageModelId {
  return value === "grok_imagine_2" || value === "grok_imagine_quality";
}
function isModel(value: unknown): value is OwnerGrokT2iModel {
  return typeof value === "string" && (OWNER_GROK_T2I_MODELS as readonly string[]).includes(value);
}
function isPlainService(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
function fail(code: OwnerGrokT2iImageUploadServiceErrorCode): never { throw new OwnerGrokT2iImageUploadServiceError(code); }
