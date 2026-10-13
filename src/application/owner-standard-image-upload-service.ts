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
  createOwnerStandardImageOwnedReferenceBindingIssuer,
  type OwnerStandardImageOwnedReferenceResolution,
  type OwnerStandardImageOwnedReferenceResolverContext,
  type OwnerStandardImageReferenceBindingIssueInput,
  type OwnerStandardImageReferenceBindingIssuer,
  type OwnerStandardImageVariant,
  type OwnerStandardImageSourceProfile
} from "./owner-standard-image-request-preparer.js";
import {
  getOwnerBananaImageSourceProfile,
  type OwnerBananaImageCatalogPort
} from "./owner-banana-image-source-profile.js";
import {
  getOwnerGptImageSourceProfile,
  type OwnerGptImageCatalogPort
} from "./owner-gpt-image-source-profile.js";
import {
  OwnerStandardImageInputError,
  validateOwnerStandardImageInput,
  type OwnerStandardImageInputVariant,
  type ValidatedOwnerStandardImageInput
} from "./owner-standard-image-input-validator.js";
import {
  OwnerStandardImageAuxInputError,
  validateOwnerStandardImageAuxInput,
  type ValidatedOwnerStandardImageAuxInput
} from "./owner-standard-image-aux-input-validator.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^standard_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const NATIVE_STANDARD_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadStandardImageReference;

type StandardCatalogPort = OwnerBananaImageCatalogPort | OwnerGptImageCatalogPort;
type ValidatedStandardInput = ValidatedOwnerStandardImageInput | ValidatedOwnerStandardImageAuxInput;

export interface OwnerStandardImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: StandardCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerStandardImageUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerStandardImageVariant;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly signal?: AbortSignal;
}

export interface OwnerStandardImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly variant: OwnerStandardImageVariant;
  readonly kind: "image" | "video" | "file";
  readonly original_mime_type: string;
  readonly mime_type: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY" | "NOT_EXTRACTED";
  readonly validation_confidence: string;
}

export type OwnerStandardImageUploadErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UNSUPPORTED_IMAGE_COMPOSITION"
  | "INVALID_MEDIA_INPUT" | "UNSUPPORTED_MEDIA_CONTAINER" | "UNSUPPORTED_ENCRYPTED_PDF"
  | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerStandardImageUploadServiceError extends Error {
  constructor(readonly code: OwnerStandardImageUploadErrorCode) {
    super("The owner standard image upload is unavailable.");
    this.name = "OwnerStandardImageUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerStandardImageVariant;
  readonly modelId: OwnerStandardImageVariant;
  readonly aiName: OwnerStandardImageSourceProfile["ai_name"];
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly kind: "image" | "video" | "file";
  readonly originalMimeType: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration: number | null;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly metadataConfidence: "CONTAINER_METADATA_ONLY" | "UNKNOWN";
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

interface IssuerPair {
  readonly native: OwnerStandardImageReferenceBindingIssuer;
  readonly exposed: OwnerStandardImageReferenceBindingIssuer;
}

/** Process-local per-principal uploads and opaque reference handles; this does not authorize generation. */
export class OwnerStandardImageUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: StandardCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerStandardImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerStandardImageVariant, Readonly<OwnerStandardImageSourceProfile>>();
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

  constructor(optionsInput: OwnerStandardImageUploadServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isPlainService(fields.linkService) ||
        !isPlainService(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as StandardCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#resolveClient = fields.resolveClient as OwnerStandardImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const variant of STANDARD_VARIANTS) this.#profiles.set(variant, getProfile(variant, this.#catalog, this.#catalogVersion));
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerStandardImageUploadInput | unknown): Promise<OwnerStandardImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const initialProfile = this.#assertVariant(request.variant);
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedStandardInput | undefined;
    let uploadBytes: Uint8Array | undefined;
    let invoked = false;
    try {
      this.#prune(this.#readNow());
      validated = validateStandardInput(request);
      const profile = this.#assertVariant(request.variant, validated.original_mime_type);
      const sourceMimes = acceptedMimeTypes(profile);
      if (profile.profile_schema_hash !== initialProfile.profile_schema_hash ||
          (!sourceMimes.includes(validated.original_mime_type) && !sourceMimes.includes(validated.mime_type))) fail("MODEL_BINDING_MISMATCH");
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
        mime_type: validated.mime_type, variant: request.variant as OwnerStandardImageInputVariant });
      this.#throwIfClosedOrAborted(operation.controller);
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
      const handle = `standard_image_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const metadataConfidence = validated.metadata_confidence === "NOT_EXTRACTED" ? "UNKNOWN" : validated.metadata_confidence;
      const record: PrivateRecord = Object.freeze({ handle, attemptId: request.attemptId, principal,
        variant: request.variant, modelId: currentProfile.model_id, aiName: currentProfile.ai_name,
        catalogVersion: currentProfile.public_catalog_version, profileSchemaHash: currentProfile.profile_schema_hash,
        fileUrl: privateReference.url,
        kind: validated.kind, originalMimeType: validated.original_mime_type, mimeType: validated.mime_type,
        width: validated.width, height: validated.height, duration: durationForValidated(validated), size: validated.size,
        sha256: validated.sha256 as `sha256:${string}`, expiresAt, epoch, metadataConfidence });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", reference_handle: handle, variant: record.variant, kind: record.kind,
        original_mime_type: record.originalMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
        duration: record.duration, size: record.size, sha256: record.sha256,
        expires_in_seconds: Math.max(0, Math.ceil((expiresAt - this.#readNow()) / 1000)),
        metadata_confidence: validated.metadata_confidence, validation_confidence: validated.validation_confidence });
    } catch (error) {
      if (error instanceof OwnerStandardImageUploadServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerStandardImageInputError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (error.code === "UNSUPPORTED_IMAGE_COMPOSITION") fail("UNSUPPORTED_IMAGE_COMPOSITION");
        fail("INVALID_IMAGE_INPUT");
      }
      if (error instanceof OwnerStandardImageAuxInputError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        if (error.code === "UNSUPPORTED_MEDIA_CONTAINER") fail("UNSUPPORTED_MEDIA_CONTAINER");
        if (error.code === "UNSUPPORTED_ENCRYPTED_PDF") fail("UNSUPPORTED_ENCRYPTED_PDF");
        fail("INVALID_MEDIA_INPUT");
      }
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(request.attemptId);
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

  createOwnedReferenceBindingIssuer(): OwnerStandardImageReferenceBindingIssuer {
    this.#assertOpen();
    if (this.#issuer) return this.#issuer.exposed;
    const native = createOwnerStandardImageOwnedReferenceBindingIssuer(
      (context) => this.#resolveOwnedReference(context),
      { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now }
    );
    const service = this;
    const exposed: OwnerStandardImageReferenceBindingIssuer = Object.freeze({
      async issue(input: OwnerStandardImageReferenceBindingIssueInput | unknown) {
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

  async #resolveOwnedReference(value: Readonly<OwnerStandardImageOwnedReferenceResolverContext>): Promise<OwnerStandardImageOwnedReferenceResolution> {
    const context = snapshotResolveContext(value);
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(context.attempt_id) || context.principal.connection_id !== context.attempt_id ||
        !HANDLE_PATTERN.test(context.reference_handle)) fail("REFERENCE_UNAVAILABLE");
    const profile = this.#assertVariant(context.variant);
    if (context.model_id !== profile.model_id || context.ai_name !== profile.ai_name || context.scope !== "image" ||
        context.operation_id !== profile.operation_id || context.catalog_version !== profile.public_catalog_version ||
        context.profile_schema_hash !== profile.profile_schema_hash) fail("REFERENCE_UNAVAILABLE");
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
      if (currentProfile.profile_schema_hash !== record.profileSchemaHash ||
          record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record) fail("REFERENCE_EXPIRED");
      return Object.freeze({ principal: record.principal, attempt_id: record.attemptId, variant: record.variant,
        model_id: record.modelId, ai_name: record.aiName, scope: "image", operation_id: currentProfile.operation_id,
        catalog_version: record.catalogVersion, profile_schema_hash: record.profileSchemaHash,
        reference_handle: record.handle, file_url: record.fileUrl, mime_type: record.mimeType, kind: record.kind,
        width: record.width, height: record.height, duration: record.duration, size: record.size, sha256: record.sha256,
        expires_at: record.expiresAt, metadata_confidence: record.metadataConfidence });
    } catch (error) {
      if (error instanceof OwnerStandardImageUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(context.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(context.attempt_id, operation); }
  }

  #assertVariant(variant: OwnerStandardImageVariant, mimeType?: string): Readonly<OwnerStandardImageSourceProfile> {
    this.#assertOpen();
    const stored = this.#profiles.get(variant);
    if (!stored || stored.public_catalog_version !== this.#catalogVersion ||
        (mimeType !== undefined && !acceptedMimeTypes(stored).includes(mimeType) &&
          !acceptedMimeTypes(stored).includes(canonicalAlias(mimeType)))) fail("MODEL_BINDING_MISMATCH");
    try {
      const current = getProfile(variant, this.#catalog, this.#catalogVersion);
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
        const onAbort = () => reject(new OwnerStandardImageUploadServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort();
        else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principal, aborted]);
    } catch (error) {
      if (error instanceof OwnerStandardImageUploadServiceError) throw error;
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
    if (this.#pendingCount + this.#pendingIssuerCount >= MAX_PENDING) fail("SERVICE_BUSY");
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
    if (this.#pendingCount + this.#pendingIssuerCount >= MAX_PENDING) fail("SERVICE_BUSY");
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
      expiredAttempts.add(record.attemptId); this.#removeHandle(handle);
    }
    for (const attemptId of expiredAttempts) {
      if (!this.#handlesByAttempt.has(attemptId) && !this.#pendingByAttempt.has(attemptId) &&
          !this.#issuerPendingByAttempt.has(attemptId) && !this.#issuedAttempts.has(attemptId)) {
        this.#principalByAttempt.delete(attemptId); this.#maybeReleaseAttempt(attemptId);
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

function getProfile(variant: OwnerStandardImageVariant, catalog: StandardCatalogPort, catalogVersion: string): Readonly<OwnerStandardImageSourceProfile> {
  return variant.startsWith("gpt-image-")
    ? getOwnerGptImageSourceProfile(variant, catalog as OwnerGptImageCatalogPort, catalogVersion)
    : getOwnerBananaImageSourceProfile(variant as "banana" | "banana-2.1" | "banana2" | "banana3" | "banana3_light",
      catalog as OwnerBananaImageCatalogPort, catalogVersion);
}

function validateStandardInput(request: OwnerStandardImageUploadInput): ValidatedStandardInput {
  if (request.mime_type === "application/pdf" || request.mime_type.startsWith("video/")) {
    return validateOwnerStandardImageAuxInput({ variant: request.variant, content_base64: request.content_base64,
      filename: request.filename, mime_type: request.mime_type });
  }
  return validateOwnerStandardImageInput({ variant: request.variant, content_base64: request.content_base64,
    filename: request.filename, mime_type: request.mime_type });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotUploadInput(value: unknown): Readonly<OwnerStandardImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || typeof fields.variant !== "string" ||
      !(STANDARD_VARIANTS as readonly string[]).includes(fields.variant) || typeof fields.content_base64 !== "string" ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string") fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant as OwnerStandardImageVariant,
    content_base64: fields.content_base64, filename: fields.filename, mime_type: fields.mime_type,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }) });
}

function snapshotNativeClient(value: unknown): { readonly client: SyntxChatHttpClient; readonly method: SyntxChatHttpClient["uploadStandardImageReference"] } {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("MODEL_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value); const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadStandardImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) ||
      descriptor.value !== NATIVE_STANDARD_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("MODEL_BINDING_MISMATCH");
  return { client: value, method: NATIVE_STANDARD_UPLOAD_METHOD };
}

function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id)))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
}

function snapshotResolveContext(value: unknown): Readonly<OwnerStandardImageOwnedReferenceResolverContext> {
  const fields = exactRecord(value, ["principal", "attempt_id", "variant", "model_id", "ai_name", "scope", "operation_id", "catalog_version", "profile_schema_hash", "reference_handle"]);
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { fail("REFERENCE_UNAVAILABLE"); }
  if (typeof fields.attempt_id !== "string" || typeof fields.variant !== "string" || typeof fields.model_id !== "string" ||
      typeof fields.ai_name !== "string" || typeof fields.scope !== "string" || typeof fields.operation_id !== "string" ||
      typeof fields.catalog_version !== "string" || typeof fields.profile_schema_hash !== "string" || typeof fields.reference_handle !== "string") fail("REFERENCE_UNAVAILABLE");
  return Object.freeze({ principal, attempt_id: fields.attempt_id, variant: fields.variant as OwnerStandardImageVariant,
    model_id: fields.model_id as OwnerStandardImageVariant, ai_name: fields.ai_name as OwnerStandardImageSourceProfile["ai_name"],
    scope: fields.scope as "image", operation_id: fields.operation_id as "generate-image",
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
function canonicalAlias(mime: string): string { return mime === "image/jpg" ? "image/jpeg" : mime === "video/mov" ? "video/quicktime" : mime; }
function durationForValidated(value: ValidatedStandardInput): number | null {
  return "duration" in value ? value.duration : null;
}
function acceptedMimeTypes(profile: Readonly<OwnerStandardImageSourceProfile>): readonly string[] {
  return "media_limits" in profile ? profile.media_limits.accepted_file_types : profile.public_settings.accepted_file_types;
}
function fail(code: OwnerStandardImageUploadErrorCode): never { throw new OwnerStandardImageUploadServiceError(code); }

const STANDARD_VARIANTS = Object.freeze(["banana", "banana-2.1", "banana2", "banana3", "banana3_light",
  "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const);
