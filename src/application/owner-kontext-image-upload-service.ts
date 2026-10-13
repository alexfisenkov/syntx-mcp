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
  createOwnerKontextImageOwnedReferenceBindingIssuer,
  getOwnerKontextImageSourceProfile,
  type OwnerKontextImageCatalogPort,
  type OwnerKontextImageReferenceBindingIssuer,
  type OwnerKontextImageReferenceBindingIssueInput,
  type OwnerKontextImageOwnedReferenceResolverContext,
  type OwnerKontextImageOwnedReferenceResolution,
  type OwnerKontextImageSourceProfile
} from "./owner-kontext-image-request-preparer.js";
import type { OwnerKontextImageVariant } from "./owner-kontext-image-parameters.js";
import {
  OwnerKontextImageInputError,
  validateOwnerKontextImageInput,
  type OwnerKontextCanonicalImageMimeType,
  type OwnerKontextOriginalImageMimeType,
  type ValidatedOwnerKontextImageInput
} from "./owner-kontext-image-input-validator.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE_PATTERN = /^kontext_image_[0-9a-f-]{36}$/u;
const VARIANTS = Object.freeze(["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const);
const MAX_HANDLES = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const HANDLE_TTL_MS = 15 * 60_000;
const NATIVE_KONTEXT_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadKontextImageReference;

export interface OwnerKontextImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerKontextImageCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export type OwnerKontextImageOwnedReferenceBindingIssuer = OwnerKontextImageReferenceBindingIssuer;
export type OwnerKontextImageOwnedReferenceIssueInput = OwnerKontextImageReferenceBindingIssueInput;

export interface OwnerKontextImageUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerKontextImageVariant;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: OwnerKontextOriginalImageMimeType;
  readonly signal?: AbortSignal;
}

export interface OwnerKontextImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly variant: OwnerKontextImageVariant;
  readonly original_mime_type: OwnerKontextOriginalImageMimeType;
  readonly mime_type: OwnerKontextCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export type OwnerKontextImageUploadErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IMAGE_INPUT"
  | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "UNSUPPORTED_AVIF_COMPOSITION"
  | "PRINCIPAL_NOT_LINKED"
  | "MODEL_BINDING_MISMATCH"
  | "SERVICE_BUSY"
  | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED"
  | "REQUEST_ABORTED"
  | "REFERENCE_UNAVAILABLE"
  | "REFERENCE_EXPIRED"
  | "UPLOAD_REJECTED"
  | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerKontextImageUploadServiceError extends Error {
  constructor(readonly code: OwnerKontextImageUploadErrorCode) {
    super("The owner Kontext image upload is unavailable.");
    this.name = "OwnerKontextImageUploadServiceError";
  }
}

interface PrivateKontextImageRecord {
  readonly referenceHandle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerKontextImageVariant;
  readonly modelId: OwnerKontextImageVariant;
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly providerFileId?: string;
  readonly originalMimeType: OwnerKontextOriginalImageMimeType;
  readonly mimeType: OwnerKontextCanonicalImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expiresAt: number;
  readonly epoch: number;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly reservesUpload: boolean;
}

interface BindingIssuerState {
  readonly native: OwnerKontextImageOwnedReferenceBindingIssuer;
  readonly exposed: OwnerKontextImageOwnedReferenceBindingIssuer;
}

interface PendingIssuerOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly epoch: number;
  readonly finish: () => void;
}

/** Process-local private upload handles; no provider URL or file ID is returned. */
export class OwnerKontextImageUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerKontextImageCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerKontextImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerKontextImageVariant, Readonly<OwnerKontextImageSourceProfile>>();
  readonly #records = new Map<string, PrivateKontextImageRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #issuerPendingByAttempt = new Map<string, Set<PendingIssuerOperation>>();
  readonly #issuedReferenceAttempts = new Map<string, number>();
  readonly #attemptEpoch = new Map<string, number>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #pendingUploads = 0;
  #pendingIssuerCount = 0;
  #closed = false;
  #closing: Promise<void> | undefined;
  #bindingIssuer: BindingIssuerState | undefined;

  constructor(options: OwnerKontextImageUploadServiceOptions | unknown) {
    const fields = exactRecord(options, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
        !fields.linkService || typeof fields.linkService !== "object" || types.isProxy(fields.linkService) ||
        !fields.catalog || typeof fields.catalog !== "object" || types.isProxy(fields.catalog) ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) {
      fail("MODEL_BINDING_MISMATCH");
    }
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerKontextImageCatalogPort;
    this.#catalogVersion = fields.catalog_version;
    this.#resolveClient = fields.resolveClient as OwnerKontextImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const variant of VARIANTS) this.#profiles.set(variant, getOwnerKontextImageSourceProfile(variant, this.#catalog, this.#catalogVersion));
    } catch {
      fail("MODEL_BINDING_MISMATCH");
    }
  }

  async upload(input: OwnerKontextImageUploadInput | unknown): Promise<OwnerKontextImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const profile = this.#assertVariant(request.variant);
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerKontextImageInput | undefined;
    let uploadBytes: Uint8Array | undefined;
    let uploadInvoked = false;
    let currentProfile: Readonly<OwnerKontextImageSourceProfile> | undefined;
    try {
      this.#pruneExpired(this.#readNow());
      validated = validateOwnerKontextImageInput({
        content_base64: request.content_base64,
        filename: request.filename,
        mime_type: request.mime_type
      });
      currentProfile = this.#assertVariant(request.variant);
      if (!currentProfile.public_mime_values.includes(validated.original_mime_type) ||
          currentProfile.profile_schema_hash !== profile.profile_schema_hash) fail("MODEL_BINDING_MISMATCH");
      this.#throwIfClosedOrAborted(operation.controller);

      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const native = snapshotNativeClient(this.#resolveClient(request.attemptId));
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - HANDLE_TTL_MS) fail("SERVICE_CLOSED");
      const expiry = issuedAt + HANDLE_TTL_MS;
      const epoch = this.#attemptEpoch.get(request.attemptId) ?? 0;
      uploadBytes = new Uint8Array(validated.bytes);
      const nativeRequest = Object.freeze({
        bytes: uploadBytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        model_type: request.variant
      });
      uploadInvoked = true;
      const reference = await Reflect.apply(native.method, native.client, [nativeRequest, operation.controller.signal]);
      this.#throwIfClosedOrAborted(operation.controller);
      if ((this.#attemptEpoch.get(request.attemptId) ?? 0) !== epoch) fail("REQUEST_ABORTED");

      const privateReference = parseUploadReference(reference);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      currentProfile = this.#assertVariant(request.variant);
      if (currentProfile.profile_schema_hash !== profile.profile_schema_hash ||
          currentProfile.public_catalog_version !== profile.public_catalog_version ||
          this.#catalogVersion !== currentProfile.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
      if ((this.#attemptEpoch.get(request.attemptId) ?? 0) !== epoch || expiry <= this.#readNow()) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#pruneExpired(this.#readNow());
      if (this.#records.size >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");

      const referenceHandle = `kontext_image_${randomUUID()}`;
      if (!REFERENCE_HANDLE_PATTERN.test(referenceHandle) || this.#records.has(referenceHandle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: PrivateKontextImageRecord = Object.freeze({
        referenceHandle,
        attemptId: request.attemptId,
        principal,
        variant: request.variant,
        modelId: profile.model_id,
        catalogVersion: profile.public_catalog_version,
        profileSchemaHash: profile.profile_schema_hash,
        fileUrl: privateReference.url,
        ...(privateReference.file_id === undefined ? {} : { providerFileId: privateReference.file_id }),
        originalMimeType: validated.original_mime_type,
        mimeType: validated.mime_type,
        width: validated.width,
        height: validated.height,
        size: validated.size,
        sha256: `sha256:${validated.sha256}`,
        expiresAt: expiry,
        epoch
      });
      this.#records.set(referenceHandle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(referenceHandle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({
        status: "uploaded",
        reference_handle: referenceHandle,
        variant: request.variant,
        original_mime_type: record.originalMimeType,
        mime_type: record.mimeType,
        width: record.width,
        height: record.height,
        size: record.size,
        sha256: record.sha256,
        expires_in_seconds: Math.max(0, Math.ceil((expiry - this.#readNow()) / 1000)),
        metadata_confidence: "CONTAINER_METADATA_ONLY"
      });
    } catch (error) {
      if (error instanceof OwnerKontextImageUploadServiceError) {
        if (uploadInvoked && error.code !== "UPLOAD_REJECTED") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerKontextImageInputError) {
        if (uploadInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        fail(mapInputError(error.code));
      }
      if (error instanceof OwnerReferencePrincipalError) {
        if (uploadInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && uploadInvoked && isKnownUploadRejection(error.code)) fail("UPLOAD_REJECTED");
      if (uploadInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") fail("PRINCIPAL_NOT_LINKED");
      return fail("INVALID_REQUEST");
    } finally {
      uploadBytes?.fill(0);
      validated?.bytes.fill(0);
      this.#finishOperation(request.attemptId, operation);
    }
  }

  /** Exposes the real 460 issuer over this service's bounded private handle map. */
  createOwnedReferenceBindingIssuer(): OwnerKontextImageReferenceBindingIssuer {
    this.#assertOpen();
    if (this.#bindingIssuer) return this.#bindingIssuer.exposed;
    const native = createOwnerKontextImageOwnedReferenceBindingIssuer(
      (context) => this.#resolveOwnedReference(context),
      { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now }
    );
    const service = this;
    const exposed: OwnerKontextImageOwnedReferenceBindingIssuer = Object.freeze({
      async issue(input: OwnerKontextImageOwnedReferenceIssueInput | unknown) {
        service.#assertOpen();
        const attemptId = attemptIdForIssuerTracking(input);
        service.#pruneExpired(service.#readNow());
        const operation = attemptId === undefined ? undefined : service.#beginIssuerOperation(attemptId);
        try {
          const requestedPrincipal = principalForIssuerTracking(input);
          let linkedPrincipal: Readonly<GenerationPrincipalRef> | undefined;
          if (attemptId !== undefined && requestedPrincipal) {
            linkedPrincipal = await service.#resolvePrincipal(attemptId, operation!.controller.signal);
            service.#throwIfClosedOrAborted(operation!.controller);
            if (!sameGenerationPrincipal(linkedPrincipal, requestedPrincipal) ||
                !service.#rememberPrincipal(attemptId, linkedPrincipal)) {
              service.#invalidateAttemptState(attemptId);
              fail("PRINCIPAL_NOT_LINKED");
            }
          }
          const referenceSet = await native.issue(input);
          if (attemptId !== undefined && linkedPrincipal) {
            const currentPrincipal = await service.#resolvePrincipal(attemptId, operation!.controller.signal);
            service.#throwIfClosedOrAborted(operation!.controller);
            if (!sameGenerationPrincipal(linkedPrincipal, currentPrincipal)) {
              service.#invalidateAttemptState(attemptId);
              fail("PRINCIPAL_NOT_LINKED");
            }
          }
          if (service.#closed || (operation && (service.#attemptEpoch.get(attemptId!) ?? 0) !== operation.epoch)) {
            if (attemptId !== undefined) native.invalidateAttempt(attemptId);
            fail("REFERENCE_UNAVAILABLE");
          }
          if (attemptId !== undefined) {
            const priorExpiry = service.#issuedReferenceAttempts.get(attemptId) ?? 0;
            service.#issuedReferenceAttempts.set(attemptId, Math.max(priorExpiry, referenceSet.expires_at));
          }
          return referenceSet;
        } catch (error) {
          if (attemptId !== undefined && error instanceof OwnerReferencePrincipalError) {
            service.#invalidateAttemptState(attemptId);
            fail("PRINCIPAL_NOT_LINKED");
          }
          throw error;
        } finally {
          if (operation && attemptId !== undefined) service.#finishIssuerOperation(attemptId, operation);
        }
      },
      invalidateAttempt(attemptId: string) {
        if (attemptId !== undefined) void service.invalidateAttempt(attemptId);
      },
      close() {
        for (const operations of service.#issuerPendingByAttempt.values()) {
          for (const operation of operations) operation.controller.abort();
        }
        native.close();
        service.#issuedReferenceAttempts.clear();
        if (service.#bindingIssuer?.native === native) service.#bindingIssuer = undefined;
      }
    });
    this.#bindingIssuer = { native, exposed };
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
    for (const operations of this.#pendingByAttempt.values()) {
      for (const operation of operations) operation.controller.abort();
    }
    for (const operations of this.#issuerPendingByAttempt.values()) {
      for (const operation of operations) operation.controller.abort();
    }
    this.#bindingIssuer?.native.close();
    this.#bindingIssuer = undefined;
    this.#issuedReferenceAttempts.clear();
    this.#records.clear();
    this.#handlesByAttempt.clear();
    this.#principalByAttempt.clear();
    this.#attemptEpoch.clear();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => undefined);
    return this.#closing;
  }

  #resolveOwnedReference(contextInput: Readonly<OwnerKontextImageOwnedReferenceResolverContext>): Promise<OwnerKontextImageOwnedReferenceResolution> {
    return this.#resolveOwnedReferenceInternal(contextInput);
  }

  async #resolveOwnedReferenceInternal(value: unknown): Promise<OwnerKontextImageOwnedReferenceResolution> {
    const context = snapshotResolveContext(value);
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(context.attempt_id) || context.principal.connection_id !== context.attempt_id ||
        !REFERENCE_HANDLE_PATTERN.test(context.reference_handle)) fail("REFERENCE_UNAVAILABLE");
    const profile = this.#assertVariant(context.variant);
    if (context.model_id !== profile.model_id || context.ai_name !== profile.ai_name || context.scope !== profile.scope ||
        context.catalog_version !== profile.public_catalog_version || context.profile_schema_hash !== profile.profile_schema_hash) {
      fail("REFERENCE_UNAVAILABLE");
    }
    const record = this.#records.get(context.reference_handle);
    if (!record) fail("REFERENCE_UNAVAILABLE");
    if (record.expiresAt <= this.#readNow()) {
      this.#removeHandle(record.referenceHandle);
      fail("REFERENCE_EXPIRED");
    }
    const epoch = this.#attemptEpoch.get(context.attempt_id) ?? 0;
    if (record.epoch !== epoch || record.attemptId !== context.attempt_id || record.variant !== context.variant ||
        record.modelId !== context.model_id || record.catalogVersion !== context.catalog_version ||
        record.profileSchemaHash !== context.profile_schema_hash || !isSafeUploadReferenceUrl(record.fileUrl)) {
      fail("REFERENCE_UNAVAILABLE");
    }

    const operation = this.#beginOperation(context.attempt_id);
    try {
      const principal = await this.#resolvePrincipal(context.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, context.principal) || !sameGenerationPrincipal(principal, record.principal) ||
          (this.#attemptEpoch.get(context.attempt_id) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
      const currentProfile = this.#assertVariant(context.variant, record.originalMimeType);
      if (currentProfile.profile_schema_hash !== record.profileSchemaHash) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.referenceHandle) !== record) fail("REFERENCE_EXPIRED");
      return Object.freeze({
        principal: record.principal,
        attempt_id: record.attemptId,
        variant: record.variant,
        model_id: record.modelId,
        ai_name: currentProfile.ai_name,
        scope: currentProfile.scope,
        catalog_version: record.catalogVersion,
        profile_schema_hash: record.profileSchemaHash,
        reference_handle: record.referenceHandle,
        file_url: record.fileUrl,
        mime_type: record.mimeType,
        width: record.width,
        height: record.height,
        size: record.size,
        sha256: record.sha256,
        expires_at: record.expiresAt,
        metadata_confidence: "CONTAINER_METADATA_ONLY"
      });
    } catch (error) {
      if (error instanceof OwnerKontextImageUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally {
      this.#finishOperation(context.attempt_id, operation);
    }
  }

  #assertVariant(variant: OwnerKontextImageVariant, mimeType?: OwnerKontextOriginalImageMimeType): Readonly<OwnerKontextImageSourceProfile> {
    this.#assertOpen();
    const profile = this.#profiles.get(variant);
    if (!profile || profile.public_catalog_version !== this.#catalogVersion ||
        (mimeType !== undefined && !profile.public_mime_values.includes(mimeType))) fail("MODEL_BINDING_MISMATCH");
    try {
      const current = getOwnerKontextImageSourceProfile(variant, this.#catalog, this.#catalogVersion);
    if (current.profile_schema_hash !== profile.profile_schema_hash ||
        current.public_catalog_version !== profile.public_catalog_version) {
        fail("MODEL_BINDING_MISMATCH");
      }
      return current;
    } catch {
      fail("MODEL_BINDING_MISMATCH");
    }
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal.aborted) fail("REQUEST_ABORTED");
    let removeAbortListener = () => {};
    try {
      const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerKontextImageUploadServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort();
        else {
          signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        }
      });
      return await Promise.race([principal, aborted]);
    } catch (error) {
      if (error instanceof OwnerKontextImageUploadServiceError) throw error;
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
    } finally {
      removeAbortListener();
    }
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
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    if (reservesUpload) {
      this.#pruneExpired(this.#readNow());
      if (this.#records.size + this.#pendingUploads >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");
    }
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation = {
      controller,
      done,
      finish,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent),
      reservesUpload
    };
    pending.add(operation);
    this.#pendingByAttempt.set(attemptId, pending);
    this.#allOperations.add(done);
    this.#pendingCount += 1;
    if (reservesUpload) this.#pendingUploads += 1;
    return operation;
  }

  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1;
    if (operation.reservesUpload) this.#pendingUploads -= 1;
    operation.finish();
    this.#allOperations.delete(operation.done);
    this.#maybeReleaseAttempt(attemptId);
  }

  #beginIssuerOperation(attemptId: string): PendingIssuerOperation {
    this.#assertOpen();
    if (this.#pendingIssuerCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const controller = new AbortController();
    const operation = { controller, done, epoch: this.#attemptEpoch.get(attemptId) ?? 0, finish };
    const pending = this.#issuerPendingByAttempt.get(attemptId) ?? new Set<PendingIssuerOperation>();
    pending.add(operation);
    this.#issuerPendingByAttempt.set(attemptId, pending);
    this.#pendingIssuerCount += 1;
    this.#allOperations.add(done);
    return operation;
  }

  #finishIssuerOperation(attemptId: string, operation: PendingIssuerOperation): void {
    const pending = this.#issuerPendingByAttempt.get(attemptId);
    pending?.delete(operation);
    if (pending?.size === 0) this.#issuerPendingByAttempt.delete(attemptId);
    this.#pendingIssuerCount -= 1;
    operation.finish();
    this.#allOperations.delete(operation.done);
    this.#maybeReleaseAttempt(attemptId);
  }

  #activeAttempts(): Set<string> {
    return new Set([
      ...this.#handlesByAttempt.keys(),
      ...this.#principalByAttempt.keys(),
      ...this.#pendingByAttempt.keys(),
      ...this.#issuerPendingByAttempt.keys(),
      ...this.#issuedReferenceAttempts.keys()
    ]);
  }

  #hasAttemptState(attemptId: string): boolean { return this.#activeAttempts().has(attemptId); }

  #invalidateAttemptState(attemptId: string): void {
    if (!this.#hasAttemptState(attemptId)) return;
    this.#attemptEpoch.set(attemptId, (this.#attemptEpoch.get(attemptId) ?? 0) + 1);
    this.#removeAttemptHandles(attemptId);
    this.#principalByAttempt.delete(attemptId);
    this.#issuedReferenceAttempts.delete(attemptId);
    this.#bindingIssuer?.native.invalidateAttempt(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    for (const operation of this.#issuerPendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
  }

  #removeAttemptHandles(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#records.delete(handle);
    this.#handlesByAttempt.delete(attemptId);
  }

  #removeHandle(handle: string): void {
    const record = this.#records.get(handle);
    if (!record) return;
    this.#records.delete(handle);
    const handles = this.#handlesByAttempt.get(record.attemptId);
    handles?.delete(handle);
    if (handles?.size === 0) this.#handlesByAttempt.delete(record.attemptId);
    this.#maybeReleaseAttempt(record.attemptId);
  }

  #pruneExpired(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeHandle(handle);
    for (const [attemptId, expiresAt] of this.#issuedReferenceAttempts) {
      if (expiresAt <= now) {
        this.#issuedReferenceAttempts.delete(attemptId);
        this.#bindingIssuer?.native.invalidateAttempt(attemptId);
        if (!this.#handlesByAttempt.has(attemptId) && !this.#pendingByAttempt.has(attemptId) &&
            !this.#issuerPendingByAttempt.has(attemptId)) this.#principalByAttempt.delete(attemptId);
        this.#maybeReleaseAttempt(attemptId);
      }
    }
  }

  #maybeReleaseAttempt(attemptId: string): void {
    if (this.#hasAttemptState(attemptId)) return;
    this.#attemptEpoch.delete(attemptId);
    this.#principalByAttempt.delete(attemptId);
  }

  #throwIfClosedOrAborted(operation: AbortController): void {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (operation.signal.aborted) fail("REQUEST_ABORTED");
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) fail("SERVICE_CLOSED");
    return value;
  }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotUploadInput(value: unknown): Readonly<OwnerKontextImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.variant !== "string" || !(VARIANTS as readonly string[]).includes(fields.variant) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" ||
      typeof fields.mime_type !== "string" || !isOriginalMimeType(fields.mime_type)) fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
  return Object.freeze({
    attemptId: fields.attemptId,
    variant: fields.variant as OwnerKontextImageVariant,
    content_base64: fields.content_base64,
    filename: fields.filename,
    mime_type: fields.mime_type as OwnerKontextOriginalImageMimeType,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal })
  });
}

function snapshotNativeClient(value: unknown): {
  readonly client: SyntxChatHttpClient;
  readonly method: SyntxChatHttpClient["uploadKontextImageReference"];
} {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("MODEL_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadKontextImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) ||
      descriptor.value !== NATIVE_KONTEXT_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("MODEL_BINDING_MISMATCH");
  return { client: value as SyntxChatHttpClient, method: NATIVE_KONTEXT_UPLOAD_METHOD };
}

function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id)))) {
    fail("UPLOAD_OUTCOME_UNKNOWN");
  }
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
}

function snapshotResolveContext(value: unknown): Readonly<OwnerKontextImageOwnedReferenceResolverContext> {
  const fields = exactRecord(value, ["principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "catalog_version", "profile_schema_hash", "reference_handle"]);
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { fail("REFERENCE_UNAVAILABLE"); }
  if (typeof fields.attempt_id !== "string" || typeof fields.variant !== "string" || typeof fields.model_id !== "string" ||
      typeof fields.ai_name !== "string" || typeof fields.scope !== "string" || typeof fields.catalog_version !== "string" ||
      typeof fields.profile_schema_hash !== "string" || typeof fields.reference_handle !== "string") fail("REFERENCE_UNAVAILABLE");
  return Object.freeze({
    principal,
    attempt_id: fields.attempt_id,
    variant: fields.variant as OwnerKontextImageVariant,
    model_id: fields.model_id as OwnerKontextImageVariant,
    ai_name: fields.ai_name as "flux",
    scope: fields.scope as "image",
    catalog_version: fields.catalog_version as typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    profile_schema_hash: fields.profile_schema_hash,
    reference_handle: fields.reference_handle
  });
}

function attemptIdForIssuerTracking(value: unknown): string | undefined {
  try {
    const fields = exactRecord(value, ["principal", "attempt_id", "variant", "reference_handles"]);
    if (typeof fields.attempt_id === "string" && ATTEMPT_PATTERN.test(fields.attempt_id)) return fields.attempt_id;
  } catch { /* the real 460 issuer owns validation for malformed calls */ }
  return undefined;
}

function principalForIssuerTracking(value: unknown): Readonly<GenerationPrincipalRef> | undefined {
  try {
    const fields = exactRecord(value, ["principal", "attempt_id", "variant", "reference_handles"]);
    return snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
  } catch {
    return undefined;
  }
}

function isOriginalMimeType(value: unknown): value is OwnerKontextOriginalImageMimeType {
  return value === "image/jpeg" || value === "image/jpg" || value === "image/png" || value === "image/avif" || value === "image/webp";
}

function mapInputError(code: OwnerKontextImageInputError["code"]): OwnerKontextImageUploadErrorCode {
  if (code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") return "LOCAL_RESOURCE_LIMIT_EXCEEDED";
  if (code === "UNSUPPORTED_AVIF_COMPOSITION") return "UNSUPPORTED_AVIF_COMPOSITION";
  return "INVALID_IMAGE_INPUT";
}

function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_REQUIRED" ||
    code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => {
    let now: unknown;
    try { now = Reflect.apply(value, undefined, []); }
    catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("SERVICE_CLOSED");
    return now as number;
  };
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail("INVALID_REQUEST");
  }
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const keys = Reflect.ownKeys(descriptors);
  const allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) fields[key] = descriptors[key]!.value;
  return fields;
}

function fail(code: OwnerKontextImageUploadErrorCode): never { throw new OwnerKontextImageUploadServiceError(code); }
