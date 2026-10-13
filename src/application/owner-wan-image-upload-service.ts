import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  createOwnerWanImageOwnedReferenceBindingIssuer,
  type OwnerWanImageReferenceBindingIssuer,
  type OwnerWanImageReferenceBindingIssueInput,
  type OwnerWanImageOwnedReferenceResolverContext,
  type OwnerWanImageOwnedReferenceResolution
} from "./owner-wan-image-request-preparer.js";
import type { OwnerWanImageVariant } from "./owner-wan-image-parameters.js";
import {
  OwnerWanImageInputError,
  validateOwnerWanImageInput,
  type OwnerWanOriginalImageMimeType,
  type OwnerWanCanonicalImageMimeType,
  type ValidatedOwnerWanImageInput
} from "./owner-wan-image-input-validator.js";
import {
  inspectOwnerWanImageCoordinateMetadata,
  type OwnerWanImageCoordinateMetadata
} from "./owner-wan-image-coordinate-metadata.js";
import { getOwnerWanImageSourceProfile, type OwnerWanImageCatalogPort, type OwnerWanImageSourceProfile } from "./owner-wan-image-source-profile.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^wan_image_[0-9a-f-]{36}$/u;
const VARIANTS = Object.freeze(["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const);
const NATIVE_WAN_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadWanImageReference;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;

export interface OwnerWanImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerWanImageCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerWanImageUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerWanImageVariant;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: OwnerWanOriginalImageMimeType;
  readonly signal?: AbortSignal;
}

export interface OwnerWanImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly variant: OwnerWanImageVariant;
  readonly original_mime_type: OwnerWanOriginalImageMimeType;
  readonly mime_type: OwnerWanCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly coordinate_projection: Readonly<OwnerWanImageCoordinateMetadata>;
}

export type OwnerWanImageUploadErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_BMP_COMPOSITION"
  | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerWanImageUploadServiceError extends Error {
  constructor(readonly code: OwnerWanImageUploadErrorCode) {
    super("The owner WAN image upload is unavailable.");
    this.name = "OwnerWanImageUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerWanImageVariant;
  readonly modelId: OwnerWanImageVariant;
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly providerFileId?: string;
  readonly originalMimeType: OwnerWanOriginalImageMimeType;
  readonly mimeType: OwnerWanCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly coordinateMetadata: Readonly<OwnerWanImageCoordinateMetadata>;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly reservesUpload: boolean;
}

interface IssuerOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly epoch: number;
  readonly finish: () => void;
}

interface IssuerPair { readonly native: OwnerWanImageReferenceBindingIssuer; readonly exposed: OwnerWanImageReferenceBindingIssuer }

/** Process-local per-principal WAN uploads and opaque references; this does not authorize dispatch. */
export class OwnerWanImageUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerWanImageCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerWanImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerWanImageVariant, Readonly<OwnerWanImageSourceProfile>>();
  readonly #records = new Map<string, PrivateRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #issuerPendingByAttempt = new Map<string, Set<IssuerOperation>>();
  readonly #issuedAttempts = new Map<string, number>();
  readonly #epochs = new Map<string, number>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #pendingUploads = 0;
  #pendingIssuerCount = 0;
  #closed = false;
  #closing: Promise<void> | undefined;
  #issuer: IssuerPair | undefined;

  constructor(optionsInput: OwnerWanImageUploadServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isPlainService(fields.linkService) ||
        !isPlainService(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerWanImageCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#resolveClient = fields.resolveClient as OwnerWanImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const variant of VARIANTS) this.#profiles.set(variant, getOwnerWanImageSourceProfile(variant, this.#catalog, this.#catalogVersion));
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerWanImageUploadInput | unknown): Promise<OwnerWanImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const initialProfile = this.#assertVariant(request.variant);
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerWanImageInput | undefined;
    let uploadBytes: Uint8Array | undefined;
    let invoked = false;
    try {
      this.#prune(this.#readNow());
      validated = validateOwnerWanImageInput({ variant: request.variant, content_base64: request.content_base64,
        filename: request.filename, mime_type: request.mime_type });
      const profile = this.#assertVariant(request.variant, validated.original_mime_type);
      if (profile.profile_schema_hash !== initialProfile.profile_schema_hash ||
          !profile.mime_policy.source_values.includes(validated.original_mime_type)) fail("MODEL_BINDING_MISMATCH");
      const coordinateMetadata = inspectOwnerWanImageCoordinateMetadata({ bytes: validated.bytes, mime_type: validated.mime_type,
        width: validated.width, height: validated.height });
      const coordinateProjection = snapshotCoordinateProjection(coordinateMetadata);
      this.#throwIfClosedOrAborted(operation.controller);
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const native = snapshotNativeClient(this.#resolveClient(request.attemptId));
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const expiresAt = issuedAt + TTL_MS;
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      uploadBytes = new Uint8Array(validated.bytes);
      const nativeRequest = Object.freeze({ bytes: uploadBytes, filename: validated.filename,
        mime_type: validated.mime_type, model_type: request.variant });
      invoked = true;
      const receipt = await Reflect.apply(native.method, native.client, [nativeRequest, operation.controller.signal]);
      this.#throwIfClosedOrAborted(operation.controller);
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("REQUEST_ABORTED");
      const privateReference = parseUploadReference(receipt);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const currentProfile = this.#assertVariant(request.variant, validated.original_mime_type);
      if (currentProfile.profile_schema_hash !== initialProfile.profile_schema_hash || expiresAt <= this.#readNow() ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#prune(this.#readNow());
      if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      const handle = `wan_image_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const sha = `sha256:${validated.sha256}`;
      const record: PrivateRecord = Object.freeze({ handle, attemptId: request.attemptId, principal,
        variant: request.variant, modelId: currentProfile.model_id, catalogVersion: currentProfile.public_catalog_version,
        profileSchemaHash: currentProfile.profile_schema_hash, fileUrl: privateReference.url,
        ...(privateReference.file_id === undefined ? {} : { providerFileId: privateReference.file_id }),
        originalMimeType: validated.original_mime_type, mimeType: validated.mime_type,
        width: validated.width, height: validated.height, size: validated.size, sha256: sha,
        expiresAt, epoch, coordinateMetadata: coordinateMetadata });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", reference_handle: handle, variant: record.variant,
        original_mime_type: record.originalMimeType, mime_type: record.mimeType, width: record.width,
        height: record.height, size: record.size, sha256: record.sha256,
        expires_in_seconds: Math.max(0, Math.ceil((expiresAt - this.#readNow()) / 1000)),
        metadata_confidence: "CONTAINER_METADATA_ONLY", coordinate_projection: coordinateProjection });
    } catch (error) {
      if (error instanceof OwnerWanImageUploadServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerWanImageInputError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        if (error.code === "UNSUPPORTED_BMP_COMPOSITION") fail("UNSUPPORTED_BMP_COMPOSITION");
        fail("INVALID_IMAGE_INPUT");
      }
      if (error instanceof OwnerReferencePrincipalError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") fail("PRINCIPAL_NOT_LINKED");
      if (error instanceof SyntxHttpError && invoked && isKnownUploadRejection(error.code)) fail("UPLOAD_REJECTED");
      if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      return fail("INVALID_REQUEST");
    } finally {
      uploadBytes?.fill(0);
      validated?.bytes.fill(0);
      this.#finishOperation(request.attemptId, operation);
    }
  }

  createOwnedReferenceBindingIssuer(): OwnerWanImageReferenceBindingIssuer {
    this.#assertOpen();
    if (this.#issuer) return this.#issuer.exposed;
    const native = createOwnerWanImageOwnedReferenceBindingIssuer(
      (context) => this.#resolveOwnedReference(context),
      { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now }
    );
    const service = this;
    const exposed: OwnerWanImageReferenceBindingIssuer = Object.freeze({
      async issue(input: OwnerWanImageReferenceBindingIssueInput | unknown) {
        service.#assertOpen();
        const attemptId = attemptForIssue(input);
        service.#prune(service.#readNow());
        const operation = attemptId === undefined ? undefined : service.#beginIssuerOperation(attemptId);
        try {
          const requestedPrincipal = principalForIssue(input);
          let linked: Readonly<GenerationPrincipalRef> | undefined;
          if (attemptId && requestedPrincipal) {
            linked = await service.#resolvePrincipal(attemptId, operation!.controller.signal);
            service.#throwIfClosedOrAborted(operation!.controller);
            if (!sameGenerationPrincipal(linked, requestedPrincipal) || !service.#rememberPrincipal(attemptId, linked)) {
              service.#invalidateAttemptState(attemptId);
              fail("PRINCIPAL_NOT_LINKED");
            }
          }
          const set = await native.issue(input);
          if (attemptId && linked) {
            const current = await service.#resolvePrincipal(attemptId, operation!.controller.signal);
            service.#throwIfClosedOrAborted(operation!.controller);
            if (!sameGenerationPrincipal(linked, current)) {
              service.#invalidateAttemptState(attemptId);
              fail("PRINCIPAL_NOT_LINKED");
            }
          }
          if (service.#closed || (attemptId && operation && (service.#epochs.get(attemptId) ?? 0) !== operation.epoch)) {
            if (attemptId) native.invalidateAttempt(attemptId);
            fail("REFERENCE_UNAVAILABLE");
          }
          if (attemptId) service.#issuedAttempts.set(attemptId, Math.max(service.#issuedAttempts.get(attemptId) ?? 0, set.expires_at));
          return set;
        } catch (error) {
          if (attemptId && error instanceof OwnerReferencePrincipalError) {
            service.#invalidateAttemptState(attemptId);
            fail("PRINCIPAL_NOT_LINKED");
          }
          throw error;
        } finally {
          if (attemptId && operation) service.#finishIssuerOperation(attemptId, operation);
        }
      },
      invalidateAttempt(attemptId: string) { if (typeof attemptId === "string") void service.invalidateAttempt(attemptId); },
      close() {
        for (const operations of service.#issuerPendingByAttempt.values()) for (const operation of operations) operation.controller.abort();
        native.close();
        const issuedAttempts = [...service.#issuedAttempts.keys()];
        service.#issuedAttempts.clear();
        for (const attemptId of issuedAttempts) {
          if (!service.#handlesByAttempt.has(attemptId) && !service.#pendingByAttempt.has(attemptId) &&
              !service.#issuerPendingByAttempt.has(attemptId)) {
            service.#principalByAttempt.delete(attemptId);
            service.#maybeReleaseAttempt(attemptId);
          }
        }
        if (service.#issuer?.native === native) service.#issuer = undefined;
      }
    });
    this.#issuer = { native, exposed };
    return exposed;
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT_PATTERN.test(attemptId) || !this.#hasAttemptState(attemptId)) return;
    this.#invalidateAttemptState(attemptId);
    const pending = [
      ...[...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done),
      ...[...(this.#issuerPendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done)
    ];
    await Promise.allSettled(pending);
    this.#maybeReleaseAttempt(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const operations of this.#pendingByAttempt.values()) for (const operation of operations) operation.controller.abort();
    for (const operations of this.#issuerPendingByAttempt.values()) for (const operation of operations) operation.controller.abort();
    this.#issuer?.native.close();
    this.#issuer = undefined;
    this.#issuedAttempts.clear();
    this.#records.clear();
    this.#handlesByAttempt.clear();
    this.#principalByAttempt.clear();
    this.#epochs.clear();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => undefined);
    return this.#closing;
  }

  async #resolveOwnedReference(value: Readonly<OwnerWanImageOwnedReferenceResolverContext>): Promise<OwnerWanImageOwnedReferenceResolution> {
    const context = snapshotResolveContext(value);
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(context.attempt_id) || context.principal.connection_id !== context.attempt_id || !HANDLE_PATTERN.test(context.reference_handle)) fail("REFERENCE_UNAVAILABLE");
    const profile = this.#assertVariant(context.variant);
    if (context.model_id !== profile.model_id || context.ai_name !== profile.ai_name || context.scope !== profile.scope ||
        context.catalog_version !== profile.public_catalog_version || context.profile_schema_hash !== profile.profile_schema_hash) fail("REFERENCE_UNAVAILABLE");
    const record = this.#records.get(context.reference_handle);
    if (!record) fail("REFERENCE_UNAVAILABLE");
    if (record.expiresAt <= this.#readNow()) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
    const epoch = this.#epochs.get(context.attempt_id) ?? 0;
    if (record.epoch !== epoch || record.attemptId !== context.attempt_id || record.variant !== context.variant ||
        record.modelId !== context.model_id || record.catalogVersion !== context.catalog_version ||
        record.profileSchemaHash !== context.profile_schema_hash || !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
    const operation = this.#beginOperation(context.attempt_id);
    try {
      const principal = await this.#resolvePrincipal(context.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, context.principal) || !sameGenerationPrincipal(principal, record.principal) ||
          (this.#epochs.get(context.attempt_id) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
      const currentProfile = this.#assertVariant(context.variant, record.originalMimeType);
      if (currentProfile.profile_schema_hash !== record.profileSchemaHash) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record) fail("REFERENCE_EXPIRED");
      return Object.freeze({ principal: record.principal, attempt_id: record.attemptId, variant: record.variant,
        model_id: record.modelId, ai_name: currentProfile.ai_name, scope: currentProfile.scope,
        catalog_version: record.catalogVersion, profile_schema_hash: record.profileSchemaHash,
        reference_handle: record.handle, file_url: record.fileUrl, mime_type: record.mimeType,
        width: record.width, height: record.height, size: record.size, sha256: record.sha256,
        expires_at: record.expiresAt, metadata_confidence: "CONTAINER_METADATA_ONLY",
        coordinate_source_sha256: record.sha256, coordinate_metadata: record.coordinateMetadata });
    } catch (error) {
      if (error instanceof OwnerWanImageUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(context.attempt_id, operation); }
  }

  #assertVariant(variant: OwnerWanImageVariant, mimeType?: OwnerWanOriginalImageMimeType): Readonly<OwnerWanImageSourceProfile> {
    this.#assertOpen();
    const stored = this.#profiles.get(variant);
    if (!stored || stored.public_catalog_version !== this.#catalogVersion ||
        (mimeType !== undefined && !stored.mime_policy.source_values.includes(mimeType))) fail("MODEL_BINDING_MISMATCH");
    try {
      const current = getOwnerWanImageSourceProfile(variant, this.#catalog, this.#catalogVersion);
      if (current.profile_schema_hash !== stored.profile_schema_hash || current.public_catalog_version !== stored.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
      return current;
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal.aborted) fail("REQUEST_ABORTED");
    let remove = () => {};
    try {
      const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerWanImageUploadServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principal, aborted]);
    } catch (error) {
      if (error instanceof OwnerWanImageUploadServiceError) throw error;
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
    } finally { remove(); }
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId);
    if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal);
    return true;
  }

  #beginOperation(attemptId: string, parentSignal?: AbortSignal, reservesUpload = false): PendingOperation {
    this.#assertOpen();
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    if (reservesUpload) this.#prune(this.#readNow());
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    if (reservesUpload && this.#records.size + this.#pendingUploads >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent(); else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation = { controller, done, finish, removeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent), reservesUpload };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done);
    this.#pendingCount += 1; if (reservesUpload) this.#pendingUploads += 1;
    return operation;
  }

  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId); pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1; if (operation.reservesUpload) this.#pendingUploads -= 1;
    operation.finish(); this.#allOperations.delete(operation.done); this.#maybeReleaseAttempt(attemptId);
  }

  #beginIssuerOperation(attemptId: string): IssuerOperation {
    this.#assertOpen();
    if (this.#pendingIssuerCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts(); if (!active.has(attemptId) && active.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation = { controller: new AbortController(), done, epoch: this.#epochs.get(attemptId) ?? 0, finish };
    const pending = this.#issuerPendingByAttempt.get(attemptId) ?? new Set<IssuerOperation>();
    pending.add(operation); this.#issuerPendingByAttempt.set(attemptId, pending); this.#pendingIssuerCount += 1; this.#allOperations.add(done);
    return operation;
  }

  #finishIssuerOperation(attemptId: string, operation: IssuerOperation): void {
    const pending = this.#issuerPendingByAttempt.get(attemptId); pending?.delete(operation);
    if (pending?.size === 0) this.#issuerPendingByAttempt.delete(attemptId);
    this.#pendingIssuerCount -= 1; operation.finish(); this.#allOperations.delete(operation.done); this.#maybeReleaseAttempt(attemptId);
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys(),
      ...this.#issuerPendingByAttempt.keys(), ...this.#issuedAttempts.keys()]);
  }
  #hasAttemptState(attemptId: string): boolean { return this.#activeAttempts().has(attemptId); }

  #invalidateAttemptState(attemptId: string): void {
    if (!this.#hasAttemptState(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptHandles(attemptId); this.#principalByAttempt.delete(attemptId); this.#issuedAttempts.delete(attemptId);
    this.#issuer?.native.invalidateAttempt(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    for (const operation of this.#issuerPendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
  }

  #removeAttemptHandles(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#records.delete(handle);
    this.#handlesByAttempt.delete(attemptId);
  }
  #removeHandle(handle: string): void {
    const record = this.#records.get(handle); if (!record) return;
    this.#records.delete(handle); const handles = this.#handlesByAttempt.get(record.attemptId); handles?.delete(handle);
    if (handles?.size === 0) this.#handlesByAttempt.delete(record.attemptId); this.#maybeReleaseAttempt(record.attemptId);
  }

  #prune(now: number): void {
    const expiredAttempts = new Set<string>();
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) {
      expiredAttempts.add(record.attemptId);
      this.#removeHandle(handle);
    }
    for (const attemptId of expiredAttempts) {
      if (!this.#handlesByAttempt.has(attemptId) && !this.#pendingByAttempt.has(attemptId) &&
          !this.#issuerPendingByAttempt.has(attemptId) && !this.#issuedAttempts.has(attemptId)) {
        this.#principalByAttempt.delete(attemptId);
        this.#maybeReleaseAttempt(attemptId);
      }
    }
    for (const [attemptId, expiry] of this.#issuedAttempts) if (expiry <= now) {
      this.#issuedAttempts.delete(attemptId); this.#issuer?.native.invalidateAttempt(attemptId);
      if (!this.#handlesByAttempt.has(attemptId) && !this.#pendingByAttempt.has(attemptId) && !this.#issuerPendingByAttempt.has(attemptId)) this.#principalByAttempt.delete(attemptId);
      this.#maybeReleaseAttempt(attemptId);
    }
    for (const attemptId of this.#epochs.keys()) if (!this.#hasAttemptState(attemptId)) this.#epochs.delete(attemptId);
  }

  #maybeReleaseAttempt(attemptId: string): void {
    if (this.#hasAttemptState(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principalByAttempt.delete(attemptId);
  }
  #throwIfClosedOrAborted(operation: AbortController): void { if (this.#closed) fail("SERVICE_CLOSED"); if (operation.signal.aborted) fail("REQUEST_ABORTED"); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number { const value = this.#now(); if (!Number.isSafeInteger(value) || value < 0) fail("SERVICE_CLOSED"); return value; }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotUploadInput(value: unknown): Readonly<OwnerWanImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || typeof fields.variant !== "string" ||
      !(VARIANTS as readonly string[]).includes(fields.variant) || typeof fields.content_base64 !== "string" ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string" || !isInputMime(fields.mime_type)) fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant as OwnerWanImageVariant,
      content_base64: fields.content_base64, filename: fields.filename, mime_type: fields.mime_type as OwnerWanOriginalImageMimeType,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }) });
}

function snapshotNativeClient(value: unknown): { readonly client: SyntxChatHttpClient; readonly method: SyntxChatHttpClient["uploadWanImageReference"] } {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("MODEL_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value); const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadWanImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) ||
      descriptor.value !== NATIVE_WAN_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("MODEL_BINDING_MISMATCH");
  return { client: value, method: NATIVE_WAN_UPLOAD_METHOD };
}

function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id)))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
}

function snapshotResolveContext(value: unknown): Readonly<OwnerWanImageOwnedReferenceResolverContext> {
  const fields = exactRecord(value, ["principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "catalog_version", "profile_schema_hash", "reference_handle"]);
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { fail("REFERENCE_UNAVAILABLE"); }
  if (typeof fields.attempt_id !== "string" || typeof fields.variant !== "string" || typeof fields.model_id !== "string" ||
      typeof fields.ai_name !== "string" || typeof fields.scope !== "string" || typeof fields.catalog_version !== "string" ||
      typeof fields.profile_schema_hash !== "string" || typeof fields.reference_handle !== "string") fail("REFERENCE_UNAVAILABLE");
  return Object.freeze({ principal, attempt_id: fields.attempt_id, variant: fields.variant as OwnerWanImageVariant,
    model_id: fields.model_id as OwnerWanImageVariant, ai_name: fields.ai_name as "wan_image", scope: fields.scope as "image",
    catalog_version: fields.catalog_version as typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    profile_schema_hash: fields.profile_schema_hash, reference_handle: fields.reference_handle });
}

function attemptForIssue(input: unknown): string | undefined {
  try { const fields = exactRecord(input, ["principal", "attempt_id", "variant", "reference_handles"]);
    return typeof fields.attempt_id === "string" && ATTEMPT_PATTERN.test(fields.attempt_id) ? fields.attempt_id : undefined; }
  catch { return undefined; }
}
function principalForIssue(input: unknown): Readonly<GenerationPrincipalRef> | undefined {
  try { const fields = exactRecord(input, ["principal", "attempt_id", "variant", "reference_handles"]); return snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { return undefined; }
}
function isInputMime(value: string): value is OwnerWanOriginalImageMimeType {
  return value === "image/jpeg" || value === "image/jpg" || value === "image/png" || value === "image/bmp" || value === "image/webp";
}
function snapshotCoordinateProjection(value: OwnerWanImageCoordinateMetadata): Readonly<OwnerWanImageCoordinateMetadata> {
  return Object.freeze({ orientation: value.orientation, projected_width: value.projected_width,
    projected_height: value.projected_height, confidence: value.confidence });
}
function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let now: unknown; try { now = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("SERVICE_CLOSED"); return now as number; };
}
function isPlainService(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const keys = Reflect.ownKeys(descriptors); const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function fail(code: OwnerWanImageUploadErrorCode): never { throw new OwnerWanImageUploadServiceError(code); }
