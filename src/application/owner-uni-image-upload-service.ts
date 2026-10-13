import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { OWNER_UNI_IMAGE_MODEL_IDS } from "../adapter/syntx/owner-uni-image-upload.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerUniImageUploadProfile,
  type OwnerUniImageModelId,
  type OwnerUniImageUploadCatalogPort,
  type OwnerUniImageUploadProfile
} from "../catalog/owner-uni-image-upload-profile.js";
import {
  OWNER_UNI_IMAGE_INPUT_POLICY,
  OwnerUniImageInputError,
  validateOwnerUniImageInput,
  type OwnerUniImageOriginalMimeType,
  type ValidatedOwnerUniImageInput
} from "./owner-uni-image-input-validator.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^uni_image_[0-9a-f-]{36}$/u;
const FILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadUniImageReference;
const RESOLUTIONS = new WeakMap<object, ResolutionBrand>();

export interface OwnerUniImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerUniImageUploadCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerUniImageUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerUniImageModelId;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: OwnerUniImageOriginalMimeType;
  readonly signal?: AbortSignal;
}

export interface OwnerUniImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: OwnerUniImageModelId;
  readonly source_mime_type: OwnerUniImageOriginalMimeType;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
}

export interface OwnerUniImageReferenceResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerUniImageModelId;
  readonly ai_name: "luma_image";
  readonly scope: "image";
  readonly operation_id: "upload-image-reference";
  readonly catalog_version: string;
  readonly upload_profile_schema_hash: string;
  readonly reference_handle: string;
}

/** Internal nominal resolution for later owner application composition; not a provider-acceptance proof. */
export interface OwnerUniImageOwnedReferenceResolution extends OwnerUniImageReferenceResolverContext {
  readonly asset_role: "image_reference";
  readonly provenance: "private_r2_owned";
  readonly provenance_verified: true;
  readonly asset_id: string;
  readonly canonical_url: string;
  readonly source_mime_type: OwnerUniImageOriginalMimeType;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export type OwnerUniImageUploadServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "CLOCK_INVALID" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_IN_PROGRESS" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerUniImageUploadServiceError extends Error {
  constructor(readonly code: OwnerUniImageUploadServiceErrorCode) {
    super("The owner Uni image upload is unavailable.");
    this.name = "OwnerUniImageUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly stablePrincipalKey: string;
  readonly semanticKey: string;
  readonly successKey: string;
  readonly modelId: OwnerUniImageModelId;
  readonly aiName: "luma_image";
  readonly catalogVersion: string;
  readonly uploadProfileSchemaHash: string;
  readonly fileUrl: string;
  readonly assetId: string;
  readonly sourceMimeType: OwnerUniImageOriginalMimeType;
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
  readonly owner: OwnerUniImageUploadService;
  readonly record: PrivateRecord;
  readonly epoch: number;
}

/** Process-local owner upload boundary bound to the full selected Uni upload profile. */
export class OwnerUniImageUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerUniImageUploadCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerUniImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerUniImageModelId, Readonly<OwnerUniImageUploadProfile>>();
  readonly #records = new Map<string, PrivateRecord>();
  readonly #successByAttemptSemantic = new Map<string, string>();
  readonly #successKeysByAttempt = new Map<string, Set<string>>();
  readonly #resolutionsByHandle = new Map<string, object>();
  readonly #unknownSemanticHolds = new Set<string>();
  readonly #pendingBySemantic = new Map<string, PendingOperation>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #epochs = new Map<string, number>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #lastObservedNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerUniImageUploadServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isPlainService(fields.linkService) ||
        !isPlainService(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerUniImageUploadCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#resolveClient = fields.resolveClient as OwnerUniImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const modelId of OWNER_UNI_IMAGE_MODEL_IDS) {
        this.#profiles.set(modelId, getOwnerUniImageUploadProfile(modelId, this.#catalog, this.#catalogVersion));
      }
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerUniImageUploadInput | unknown): Promise<OwnerUniImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    if (request.signal?.aborted) fail("REQUEST_ABORTED");
    const profile = this.#assertProfile(request.model_id);
    let validated: ValidatedOwnerUniImageInput | undefined;
    let operation: PendingOperation | undefined;
    let invoked = false;
    let semanticKey: string | undefined;
    try {
      try {
        validated = validateOwnerUniImageInput({ content_base64: request.content_base64,
          filename: request.filename, mime_type: request.mime_type });
      } catch (error) { throw mapInputError(error); }
      if (!profile.source_metadata.accepted_file_types.includes(validated.original_mime_type) ||
          profile.local_input_policy.local_max_bytes !== OWNER_UNI_IMAGE_INPUT_POLICY.local_max_bytes ||
          validated.size > profile.local_input_policy.local_max_bytes) fail("PROFILE_BINDING_MISMATCH");
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
      if (existing) return this.#receipt(existing, now);
      if (this.#unknownSemanticHolds.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingBySemantic.has(semanticKey)) fail("UPLOAD_IN_PROGRESS");
      if (this.#records.size + this.#unknownSemanticHolds.size + this.#pendingBySemantic.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingBySemantic.set(semanticKey, operation);

      const native = snapshotNativeClient(this.#resolveClient(request.attemptId));
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("CLOCK_INVALID");
      const expiresAt = issuedAt + TTL_MS;
      const epoch = operation.epoch;
      const nativeRequest = Object.freeze({ model_id: request.model_id, bytes: validated.bytes,
        filename: validated.filename, mime_type: validated.original_mime_type });
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
      const handle = `uni_image_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: PrivateRecord = Object.freeze({
        handle, attemptId: request.attemptId, principal, stablePrincipalKey, semanticKey, successKey,
        modelId: request.model_id, aiName: profile.ai_name, catalogVersion: profile.catalog_version,
        uploadProfileSchemaHash: profile.upload_profile_schema_hash, fileUrl: privateReference.url,
        assetId: trustedAssetId(privateReference), sourceMimeType: validated.original_mime_type, mimeType: validated.mime_type,
        width: validated.width, height: validated.height, size: validated.size, sha256: validated.sha256, expiresAt, epoch
      });
      const receipt = this.#receipt(record, finishedAt);
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      this.#successByAttemptSemantic.set(successKey, handle);
      const successKeys = this.#successKeysByAttempt.get(request.attemptId) ?? new Set<string>();
      successKeys.add(successKey); this.#successKeysByAttempt.set(request.attemptId, successKeys);
      return receipt;
    } catch (error) {
      if (error instanceof OwnerUniImageUploadServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") {
          if (semanticKey !== undefined) this.#unknownSemanticHolds.add(semanticKey);
          fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        throw error;
      }
      if (error instanceof OwnerUniImageInputError) {
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
      validated?.bytes.fill(0);
      if (operation) this.#finishOperation(request.attemptId, operation);
    }
  }

  async resolveReference(contextInput: OwnerUniImageReferenceResolverContext | unknown, signal?: AbortSignal): Promise<OwnerUniImageOwnedReferenceResolution> {
    const context = snapshotResolverContext(contextInput);
    this.#assertOpen();
    this.#assertContextBinding(context);
    const operation = this.#beginOperation(context.attempt_id, signal);
    try {
      const now = this.#readNow();
      const record = this.#records.get(context.reference_handle);
      if (!record) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
      this.#pruneExpired(now);
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
      const existing = this.#resolutionsByHandle.get(record.handle);
      if (existing) return existing as OwnerUniImageOwnedReferenceResolution;
      const resolution = deepFreeze({ principal: record.principal, attempt_id: record.attemptId, model_id: record.modelId,
        ai_name: record.aiName, scope: "image" as const, operation_id: "upload-image-reference" as const,
        catalog_version: record.catalogVersion, upload_profile_schema_hash: record.uploadProfileSchemaHash,
        reference_handle: record.handle, asset_role: "image_reference" as const, provenance: "private_r2_owned" as const,
        provenance_verified: true as const, asset_id: record.assetId, canonical_url: record.fileUrl,
        source_mime_type: record.sourceMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
        size: record.size, sha256: record.sha256, expires_at: record.expiresAt,
        metadata_confidence: "CONTAINER_METADATA_ONLY" as const }) as Readonly<OwnerUniImageOwnedReferenceResolution>;
      RESOLUTIONS.set(resolution as object, { owner: this, record, epoch: operation.epoch });
      this.#resolutionsByHandle.set(record.handle, resolution as object);
      return resolution;
    } catch (error) {
      if (error instanceof OwnerUniImageUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(context.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (operation.controller.signal.aborted || signal?.aborted) fail("REQUEST_ABORTED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(context.attempt_id, operation); }
  }

  isOwnedReferenceResolution(value: unknown, contextInput: OwnerUniImageReferenceResolverContext | unknown): value is OwnerUniImageOwnedReferenceResolution {
    if (!value || typeof value !== "object" || types.isProxy(value)) return false;
    const brand = RESOLUTIONS.get(value);
    if (!brand || brand.owner !== this || this.#closed || this.#records.get(brand.record.handle) !== brand.record) return false;
    let context: OwnerUniImageReferenceResolverContext;
    try { context = snapshotResolverContext(contextInput); } catch { return false; }
    try {
      this.#assertProfile(context.model_id);
      return brand.record.expiresAt > this.#readNow() && brand.epoch === (this.#epochs.get(context.attempt_id) ?? 0) &&
        context.reference_handle === brand.record.handle && context.attempt_id === brand.record.attemptId &&
        context.model_id === brand.record.modelId && context.catalog_version === brand.record.catalogVersion &&
        context.upload_profile_schema_hash === brand.record.uploadProfileSchemaHash &&
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

  #assertProfile(modelId: OwnerUniImageModelId): Readonly<OwnerUniImageUploadProfile> {
    this.#assertOpen();
    const profile = this.#profiles.get(modelId);
    if (!profile) fail("PROFILE_BINDING_MISMATCH");
    try {
      const current = getOwnerUniImageUploadProfile(modelId, this.#catalog, this.#catalogVersion);
      if (current.upload_profile_schema_hash !== profile.upload_profile_schema_hash ||
          current.full_public_record_sha256 !== profile.full_public_record_sha256 ||
          current.catalog_metadata_sha256 !== profile.catalog_metadata_sha256) fail("PROFILE_BINDING_MISMATCH");
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
    return profile;
  }

  #assertContextBinding(context: OwnerUniImageReferenceResolverContext): void {
    const profile = this.#assertProfile(context.model_id);
    if (context.principal.connection_id !== context.attempt_id || context.ai_name !== profile.ai_name ||
        context.scope !== profile.scope || context.operation_id !== profile.operation_id ||
        context.catalog_version !== profile.catalog_version || context.upload_profile_schema_hash !== profile.upload_profile_schema_hash ||
        !HANDLE_PATTERN.test(context.reference_handle)) fail("PROFILE_BINDING_MISMATCH");
  }

  #assertRecordContext(record: PrivateRecord, context: OwnerUniImageReferenceResolverContext, epoch: number): void {
    this.#assertContextBinding(context);
    if (record.attemptId !== context.attempt_id || record.modelId !== context.model_id ||
        record.catalogVersion !== context.catalog_version || record.uploadProfileSchemaHash !== context.upload_profile_schema_hash ||
        record.epoch !== epoch || !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
  }

  #contextMatchesProfile(context: OwnerUniImageReferenceResolverContext): boolean {
    const profile = this.#profiles.get(context.model_id);
    return !!profile && profile.ai_name === context.ai_name && profile.scope === context.scope &&
      profile.operation_id === context.operation_id && profile.catalog_version === context.catalog_version &&
      profile.upload_profile_schema_hash === context.upload_profile_schema_hash;
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const principalRequest = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return await principalRequest;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerUniImageUploadServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    try { return await Promise.race([principalRequest, aborted]); }
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
    if (operation.semanticKey && this.#pendingBySemantic.get(operation.semanticKey) === operation) this.#pendingBySemantic.delete(operation.semanticKey);
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
    const resolution = this.#resolutionsByHandle.get(handle);
    if (resolution) { RESOLUTIONS.delete(resolution); this.#resolutionsByHandle.delete(handle); }
    const handles = this.#handlesByAttempt.get(record.attemptId);
    handles?.delete(handle);
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

  #receipt(record: PrivateRecord, now = this.#readNow()): OwnerUniImageUploadReceipt {
    const remaining = record.expiresAt - now;
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

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  try {
    const principal = snapshotGenerationPrincipal({ tenant_id: fields.tenant_id, subject_id: fields.subject,
      connection_id: "link_uni_binding_snapshot_0123456789" });
    return Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  } catch { fail("INVALID_REQUEST"); }
}

function snapshotUploadInput(value: unknown): Readonly<OwnerUniImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "model_id", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || !isModel(fields.model_id) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
      (fields.signal !== undefined && (types.isProxy(fields.signal) || !(fields.signal instanceof AbortSignal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: fields.model_id,
    content_base64: fields.content_base64, filename: fields.filename, mime_type: fields.mime_type as OwnerUniImageOriginalMimeType,
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal }) });
}

function snapshotResolverContext(value: unknown): Readonly<OwnerUniImageReferenceResolverContext> {
  const fields = exactRecord(value, ["principal", "attempt_id", "model_id", "ai_name", "scope", "operation_id",
    "catalog_version", "upload_profile_schema_hash", "reference_handle"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT_PATTERN.test(fields.attempt_id) || !isModel(fields.model_id) ||
      fields.ai_name !== "luma_image" || fields.scope !== "image" || fields.operation_id !== "upload-image-reference" ||
      typeof fields.catalog_version !== "string" || typeof fields.upload_profile_schema_hash !== "string" ||
      !SHA256_PATTERN.test(fields.upload_profile_schema_hash) || typeof fields.reference_handle !== "string" ||
      !HANDLE_PATTERN.test(fields.reference_handle)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attempt_id) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ principal, attempt_id: fields.attempt_id, model_id: fields.model_id,
    ai_name: "luma_image", scope: "image", operation_id: "upload-image-reference",
    catalog_version: fields.catalog_version, upload_profile_schema_hash: fields.upload_profile_schema_hash,
    reference_handle: fields.reference_handle });
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient; method: typeof NATIVE_UPLOAD_METHOD }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("PROFILE_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadUniImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || Object.hasOwn(value, "uploadUniImageReference") ||
      !descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ client: value, method: NATIVE_UPLOAD_METHOD });
}

function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
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
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
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
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]!);
    Object.freeze(value);
  }
  return value;
}
function stablePrincipalKeyFor(principal: Readonly<GenerationPrincipalRef>): string { return JSON.stringify([principal.tenant_id, principal.subject_id]); }
function semanticKeyFor(stablePrincipalKey: string, modelId: OwnerUniImageModelId, sha256: string): string { return JSON.stringify([stablePrincipalKey, modelId, sha256]); }
function successKeyFor(stablePrincipalKey: string, attemptId: string, modelId: OwnerUniImageModelId, sha256: string): string { return JSON.stringify([stablePrincipalKey, attemptId, modelId, sha256]); }
function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function mapInputError(error: unknown): OwnerUniImageUploadServiceError {
  if (error instanceof OwnerUniImageInputError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") {
    return new OwnerUniImageUploadServiceError("LOCAL_RESOURCE_LIMIT_EXCEEDED");
  }
  return new OwnerUniImageUploadServiceError("INVALID_IMAGE_INPUT");
}
function isModel(value: unknown): value is OwnerUniImageModelId {
  return value === "uni-1" || value === "uni-1.1-modify-image" || value === "uni-1.1-remove-background";
}
function isPlainService(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function fail(code: OwnerUniImageUploadServiceErrorCode): never { throw new OwnerUniImageUploadServiceError(code); }
