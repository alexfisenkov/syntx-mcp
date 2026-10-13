import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { OwnerPngAlphaInspectionError } from "./owner-png-alpha-inspector.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  createOwnerSeedreamImageOwnedReferenceBindingIssuer,
  type OwnerSeedreamImageOwnedReferenceResolution,
  type OwnerSeedreamImageOwnedReferenceResolverContext,
  type OwnerSeedreamImageOwnedReferenceSet
} from "./owner-seedream-image-request-preparer.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";
import { getOwnerSeedreamImageSourceProfile, type OwnerSeedreamImageCatalogPort, type OwnerSeedreamImageSourceProfile } from "./owner-seedream-image-source-profile.js";
import {
  OwnerSeedreamImageInputError,
  validateOwnerSeedreamImageInput,
  type ValidatedOwnerSeedreamImageInput
} from "./owner-seedream-image-input-validator.js";
import {
  createOwnerSeedreamSourceAlphaWitness,
  snapshotOwnerSeedreamSourceAlphaWitness,
  type OwnerSeedreamSourceAlphaWitness
} from "./owner-seedream-source-alpha-witness.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^seedream_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadSeedreamImageReference;

export interface OwnerSeedreamImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerSeedreamImageCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerSeedreamImageUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly signal?: AbortSignal;
}

export interface OwnerSeedreamImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly original_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly validation_confidence: string;
  readonly source_alpha_eligible: boolean;
  readonly source_alpha_confidence: "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED" | "UNSUPPORTED_PNG_ALPHA_COMPOSITION" | "NOT_PNG_SOURCE";
  readonly source_sample_width: number | null;
  readonly source_sample_height: number | null;
}

export interface OwnerSeedreamImageIssueReferencesInput {
  readonly attemptId: string;
  readonly variant: OwnerSeedreamImageVariant;
  readonly reference_handles: readonly string[];
}

export type OwnerSeedreamImageUploadServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerSeedreamImageUploadServiceError extends Error {
  constructor(readonly code: OwnerSeedreamImageUploadServiceErrorCode) {
    super("The owner Seedream image upload is unavailable.");
    this.name = "OwnerSeedreamImageUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerSeedreamImageVariant;
  readonly modelId: OwnerSeedreamImageVariant;
  readonly aiName: OwnerSeedreamImageSourceProfile["ai_name"];
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly originalMimeType: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly sourceAlphaWitness: OwnerSeedreamSourceAlphaWitness | null;
  readonly sourceAlphaConfidence: OwnerSeedreamImageUploadReceipt["source_alpha_confidence"];
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

/** Process-local, per-linked-owner uploads and nominal reference bindings for all reviewed Seedream variants. */
export class OwnerSeedreamImageUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerSeedreamImageCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerSeedreamImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerSeedreamImageVariant, Readonly<OwnerSeedreamImageSourceProfile>>();
  readonly #records = new Map<string, PrivateRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #issuedAttempts = new Map<string, number>();
  readonly #epochs = new Map<string, number>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #pendingUploads = 0;
  #lastObservedNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;
  #issuer: ReturnType<typeof createOwnerSeedreamImageOwnedReferenceBindingIssuer> | undefined;

  constructor(optionsInput: OwnerSeedreamImageUploadServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isPlainService(fields.linkService) ||
        !isPlainService(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerSeedreamImageCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#resolveClient = fields.resolveClient as OwnerSeedreamImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) {
        this.#profiles.set(variant, getOwnerSeedreamImageSourceProfile(variant, this.#catalog, this.#catalogVersion));
      }
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerSeedreamImageUploadInput | unknown): Promise<OwnerSeedreamImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const profile = this.#assertProfile(request.variant);
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerSeedreamImageInput | undefined;
    let uploadBytes: Uint8Array | undefined;
    let invoked = false;
    try {
      this.#prune(this.#readNow());
      validated = validateOwnerSeedreamImageInput({ variant: request.variant, content_base64: request.content_base64,
        filename: request.filename, mime_type: request.mime_type });
      if (!profile.mime_policy.accepted_file_types.includes(validated.source_mime_type)) fail("MODEL_BINDING_MISMATCH");
      const alpha = inspectOwnedAlpha(validated);
      this.#assertProfile(request.variant);
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
      const epoch = operation.epoch;
      uploadBytes = new Uint8Array(validated.bytes);
      const nativeRequest = Object.freeze({ variant: request.variant, bytes: uploadBytes, filename: validated.filename, mime_type: validated.mime_type });
      this.#throwIfClosedOrAborted(operation.controller);
      invoked = true;
      const rawReceipt = await Reflect.apply(native.method, native.client, [nativeRequest, operation.controller.signal]);
      this.#throwIfClosedOrAborted(operation.controller);
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("REQUEST_ABORTED");
      const privateReference = parseUploadReference(rawReceipt);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertProfile(request.variant);
      if (expiresAt <= this.#readNow() || (this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#prune(this.#readNow());
      if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      const handle = `seedream_image_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: PrivateRecord = Object.freeze({ handle, attemptId: request.attemptId, principal,
        variant: request.variant, modelId: profile.model_id, aiName: profile.ai_name,
        catalogVersion: profile.public_catalog_version, profileSchemaHash: profile.profile_schema_hash,
        fileUrl: privateReference.url, originalMimeType: validated.source_mime_type, mimeType: validated.mime_type,
        width: validated.width, height: validated.height, size: validated.size, sha256: validated.sha256,
        expiresAt, epoch, sourceAlphaWitness: alpha.witness, sourceAlphaConfidence: alpha.confidence });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      const alphaProjection = alpha.witness === null ? null : snapshotOwnerSeedreamSourceAlphaWitness(alpha.witness,
        { sha256: validated.sha256, width: validated.width, height: validated.height });
      return Object.freeze({ status: "uploaded", reference_handle: handle, variant: record.variant,
        original_mime_type: record.originalMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
        size: record.size, sha256: record.sha256, expires_in_seconds: Math.max(0, Math.ceil((expiresAt - this.#readNow()) / 1000)),
        metadata_confidence: validated.metadata_confidence, validation_confidence: validated.validation_confidence,
        source_alpha_eligible: alphaProjection?.source_alpha_eligible ?? false, source_alpha_confidence: alpha.confidence,
        source_sample_width: alphaProjection?.source_sample_width ?? null, source_sample_height: alphaProjection?.source_sample_height ?? null });
    } catch (error) {
      if (error instanceof OwnerSeedreamImageUploadServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerSeedreamImageInputError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        fail("INVALID_IMAGE_INPUT");
      }
      if (error instanceof OwnerPngAlphaInspectionError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (error.code === "PNG_RESOURCE_LIMIT") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        fail("INVALID_IMAGE_INPUT");
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
      this.#finishOperation(request.attemptId, operation, true);
    }
  }

  async issueReferences(input: OwnerSeedreamImageIssueReferencesInput | unknown): Promise<OwnerSeedreamImageOwnedReferenceSet> {
    const request = snapshotIssueReferencesInput(input);
    this.#assertOpen();
    this.#assertProfile(request.variant);
    const operation = this.#beginOperation(request.attemptId);
    try {
      this.#prune(this.#readNow());
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertHandlesAvailable(request, principal, operation.epoch);
      const set = await this.#getIssuer().issue({ principal, attempt_id: request.attemptId,
        variant: request.variant, reference_handles: request.reference_handles });
      this.#throwIfClosedOrAborted(operation.controller);
      if ((this.#epochs.get(request.attemptId) ?? 0) !== operation.epoch) fail("REFERENCE_UNAVAILABLE");
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertProfile(request.variant);
      this.#issuedAttempts.set(request.attemptId, Math.max(this.#issuedAttempts.get(request.attemptId) ?? 0, set.expires_at));
      return set;
    } catch (error) {
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof OwnerSeedreamImageUploadServiceError) throw error;
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(request.attemptId, operation, false); }
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
    this.#issuer?.close(); this.#issuer = undefined;
    this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear(); this.#issuedAttempts.clear(); this.#epochs.clear();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => undefined);
    return this.#closing;
  }

  #getIssuer(): ReturnType<typeof createOwnerSeedreamImageOwnedReferenceBindingIssuer> {
    if (this.#issuer) return this.#issuer;
    this.#issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer((context) => this.#resolveOwnedReference(context),
      { catalog: this.#catalog, catalog_version: this.#catalogVersion, now: this.#now });
    return this.#issuer;
  }

  async #resolveOwnedReference(context: Readonly<OwnerSeedreamImageOwnedReferenceResolverContext>): Promise<OwnerSeedreamImageOwnedReferenceResolution> {
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(context.attempt_id) || context.principal.connection_id !== context.attempt_id || !HANDLE_PATTERN.test(context.reference_handle)) fail("REFERENCE_UNAVAILABLE");
    const profile = this.#assertProfile(context.variant);
    if (context.model_id !== profile.model_id || context.ai_name !== profile.ai_name || context.scope !== "image" ||
        context.operation_id !== profile.operation_id || context.catalog_version !== profile.public_catalog_version ||
        context.profile_schema_hash !== profile.profile_schema_hash) fail("REFERENCE_UNAVAILABLE");
    const record = this.#records.get(context.reference_handle);
    if (!record) fail("REFERENCE_UNAVAILABLE");
    if (record.expiresAt <= this.#readNow()) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
    const epoch = this.#epochs.get(context.attempt_id) ?? 0;
    if (record.epoch !== epoch || record.attemptId !== context.attempt_id || record.variant !== context.variant ||
        record.modelId !== context.model_id || record.catalogVersion !== context.catalog_version || record.profileSchemaHash !== context.profile_schema_hash ||
        !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
    const principal = await this.#resolvePrincipal(context.attempt_id);
    if (!sameGenerationPrincipal(principal, context.principal) || !sameGenerationPrincipal(principal, record.principal) ||
        (this.#epochs.get(context.attempt_id) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
    this.#assertProfile(context.variant);
    if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record) fail("REFERENCE_EXPIRED");
    return Object.freeze({ principal: record.principal, attempt_id: record.attemptId, variant: record.variant,
      model_id: record.modelId, ai_name: record.aiName, scope: "image", operation_id: profile.operation_id,
      catalog_version: record.catalogVersion, profile_schema_hash: record.profileSchemaHash, reference_handle: record.handle,
      file_url: record.fileUrl, source_mime_type: record.originalMimeType, mime_type: record.mimeType,
      width: record.width, height: record.height, size: record.size, sha256: record.sha256, expires_at: record.expiresAt,
      metadata_confidence: "CONTAINER_METADATA_ONLY", source_alpha_witness: record.sourceAlphaWitness });
  }

  #assertProfile(variant: OwnerSeedreamImageVariant): Readonly<OwnerSeedreamImageSourceProfile> {
    this.#assertOpen();
    const expected = this.#profiles.get(variant);
    if (!expected) fail("MODEL_BINDING_MISMATCH");
    try {
      const current = getOwnerSeedreamImageSourceProfile(variant, this.#catalog, this.#catalogVersion);
      if (current.profile_schema_hash !== expected.profile_schema_hash || current.public_catalog_version !== expected.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
      return current;
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  #assertHandlesAvailable(request: Readonly<OwnerSeedreamImageIssueReferencesInput>, principal: Readonly<GenerationPrincipalRef>, epoch: number): void {
    const profile = this.#assertProfile(request.variant), now = this.#readNow();
    if (request.reference_handles.length > profile.reference_count.maximum) fail("INVALID_REQUEST");
    for (const handle of request.reference_handles) {
      const record = this.#records.get(handle);
      if (!record || record.attemptId !== request.attemptId || record.variant !== request.variant || record.epoch !== epoch ||
          !sameGenerationPrincipal(record.principal, principal) || !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#removeHandle(handle); fail("REFERENCE_EXPIRED"); }
    }
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    let remove = () => {};
    try {
      const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (!signal) return await principal;
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerSeedreamImageUploadServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort();
        else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principal, aborted]);
    } catch (error) {
      if (error instanceof OwnerSeedreamImageUploadServiceError) throw error;
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
    } finally { remove(); }
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId);
    if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal); return true;
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
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation = { controller, done, finish, removeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent), epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done);
    this.#pendingCount += 1; if (reservesUpload) this.#pendingUploads += 1;
    return operation;
  }

  #finishOperation(attemptId: string, operation: PendingOperation, reservesUpload: boolean): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId); pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1; if (reservesUpload) this.#pendingUploads -= 1;
    operation.finish(); this.#allOperations.delete(operation.done); this.#maybeReleaseAttempt(attemptId);
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys(), ...this.#issuedAttempts.keys()]);
  }
  #hasAttemptState(attemptId: string): boolean { return this.#activeAttempts().has(attemptId); }
  #invalidateAttemptState(attemptId: string): void {
    if (!this.#hasAttemptState(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptHandles(attemptId); this.#principalByAttempt.delete(attemptId); this.#issuedAttempts.delete(attemptId);
    this.#issuer?.invalidateAttempt(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
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
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeHandle(handle);
    for (const [attemptId, expiry] of this.#issuedAttempts) if (expiry <= now) {
      this.#issuedAttempts.delete(attemptId); this.#issuer?.invalidateAttempt(attemptId);
      if (!this.#handlesByAttempt.has(attemptId) && !this.#pendingByAttempt.has(attemptId)) this.#principalByAttempt.delete(attemptId);
      this.#maybeReleaseAttempt(attemptId);
    }
    for (const attemptId of this.#epochs.keys()) if (!this.#hasAttemptState(attemptId)) this.#epochs.delete(attemptId);
  }
  #maybeReleaseAttempt(attemptId: string): void {
    if (this.#hasAttemptState(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principalByAttempt.delete(attemptId);
  }
  #throwIfClosedOrAborted(controller: AbortController): void { if (this.#closed) fail("SERVICE_CLOSED"); if (controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastObservedNow !== undefined && value < this.#lastObservedNow)) fail("SERVICE_CLOSED");
    this.#lastObservedNow = value; return value;
  }
}

function inspectOwnedAlpha(validated: ValidatedOwnerSeedreamImageInput): {
  readonly witness: OwnerSeedreamSourceAlphaWitness | null;
  readonly confidence: OwnerSeedreamImageUploadReceipt["source_alpha_confidence"];
} {
  if (validated.source_mime_type !== "image/png") return { witness: null, confidence: "NOT_PNG_SOURCE" };
  try { return { witness: createOwnerSeedreamSourceAlphaWitness(validated.bytes), confidence: "SOURCE_CANVAS_ALPHA8_NEAREST_SAMPLED" }; }
  catch (error) {
    if (error instanceof OwnerPngAlphaInspectionError && error.code === "UNSUPPORTED_PNG_COMPOSITION") {
      return { witness: null, confidence: "UNSUPPORTED_PNG_ALPHA_COMPOSITION" };
    }
    throw error;
  }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotUploadInput(value: unknown): Readonly<OwnerSeedreamImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || !isVariant(fields.variant) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" || typeof fields.mime_type !== "string") fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant, content_base64: fields.content_base64,
    filename: fields.filename, mime_type: fields.mime_type, ...(signal === undefined ? {} : { signal: signal as AbortSignal }) });
}
function snapshotIssueReferencesInput(value: unknown): Readonly<OwnerSeedreamImageIssueReferencesInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "reference_handles"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || !isVariant(fields.variant) ||
      !Array.isArray(fields.reference_handles) || types.isProxy(fields.reference_handles)) fail("INVALID_REQUEST");
  const handles = fields.reference_handles;
  if (Object.getPrototypeOf(handles) !== Array.prototype) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(handles), length = Object.getOwnPropertyDescriptor(handles, "length")?.value;
  const maximum = getStaticReferenceLimit(fields.variant);
  if (!Number.isSafeInteger(length) || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) fail("INVALID_REQUEST");
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" || !HANDLE_PATTERN.test(descriptor.value)) fail("INVALID_REQUEST");
    snapshot.push(descriptor.value);
  }
  if (new Set(snapshot).size !== snapshot.length) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant, reference_handles: Object.freeze(snapshot) });
}
function snapshotNativeClient(value: unknown): { readonly client: SyntxChatHttpClient; readonly method: SyntxChatHttpClient["uploadSeedreamImageReference"] } {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("MODEL_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value), descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadSeedreamImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("MODEL_BINDING_MISMATCH");
  return { client: value, method: NATIVE_UPLOAD_METHOD };
}
function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id))) ||
      (fields.file_id !== undefined && /[\u0000-\u001f\u007f]/u.test(fields.file_id))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
}
function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean { return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED"; }
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let now: unknown; try { now = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("SERVICE_CLOSED"); return now as number; };
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const allowed = [...required, ...optional], keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function getStaticReferenceLimit(variant: OwnerSeedreamImageVariant): number {
  switch (variant) {
    case "seedream-4": case "seedream-4.5": return 4;
    case "seedream-5": return 14;
    case "seedream-5.0-flash": case "seedream-5.0-pro": return 10;
  }
}
function isVariant(value: unknown): value is OwnerSeedreamImageVariant { return typeof value === "string" && OWNER_SEEDREAM_IMAGE_VARIANTS.includes(value as OwnerSeedreamImageVariant); }
function isPlainService(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function fail(code: OwnerSeedreamImageUploadServiceErrorCode): never { throw new OwnerSeedreamImageUploadServiceError(code); }
