import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerIdeogramImageSourceProfile,
  type OwnerIdeogramImageCatalogPort,
  type OwnerIdeogramImageSourceProfile
} from "./owner-ideogram-image-source-profile.js";
import type { OwnerIdeogramImageModelId, OwnerIdeogramImageMode } from "./owner-ideogram-image-parameters.js";
import {
  OwnerIdeogramImageInputError,
  validateOwnerIdeogramImageInput,
  type ValidatedOwnerIdeogramImageInput
} from "./owner-ideogram-image-input.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^ideogram_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadIdeogramImageReference;

export interface OwnerIdeogramImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerIdeogramImageUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly signal?: AbortSignal;
}

export interface OwnerIdeogramImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly original_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly validation_scope: "LOCAL_INPUT_VALIDATION_ONLY_NOT_PROVIDER_ACCEPTANCE";
}

export interface OwnerIdeogramPrivateImageReferenceResolution {
  readonly role: "ordinary_image_reference";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
  readonly file_url: string;
  readonly file_id?: string;
  readonly source_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_at: number;
  readonly epoch: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly generation_permit: false;
}

export type OwnerIdeogramImageUploadServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "MODE_HAS_NO_IMAGE_REFERENCES"
  | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "REQUEST_ABORTED"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerIdeogramImageUploadServiceError extends Error {
  constructor(readonly code: OwnerIdeogramImageUploadServiceErrorCode) {
    super("The owner Ideogram image upload is unavailable.");
    this.name = "OwnerIdeogramImageUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly modelId: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly fileId?: string;
  readonly sourceMimeType: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expiresAt: number;
  readonly epoch: number;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

type ProfileKey = `${OwnerIdeogramImageModelId}\u0000${OwnerIdeogramImageMode}`;

/** Process-local owner uploads. Receipts are not URL grants, mask grants, or generation permits. */
export class OwnerIdeogramImageUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerIdeogramImageCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerIdeogramImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<ProfileKey, Readonly<OwnerIdeogramImageSourceProfile>>();
  readonly #records = new Map<string, PrivateRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #epochs = new Map<string, number>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #pendingUploads = 0;
  #lastObservedNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerIdeogramImageUploadServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isService(fields.linkService) ||
        !isObjectPort(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerIdeogramImageCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#resolveClient = fields.resolveClient as OwnerIdeogramImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const modelMode of [
        ["ideogram", "generate"], ["ideogram", "remix"], ["ideogram", "reframe"],
        ["ideogram", "replace_background"], ["ideogram", "character_reference"],
        ["ideogram_40", "generate"], ["ideogram_40", "transparent"],
        ["ideogram_45", "generate"], ["ideogram_45", "precise_edit"]
      ] as const) {
        const [modelId, mode] = modelMode;
        this.#profiles.set(profileKey(modelId, mode), getOwnerIdeogramImageSourceProfile(modelId, mode, this.#catalog, this.#catalogVersion));
      }
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerIdeogramImageUploadInput | unknown): Promise<OwnerIdeogramImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const profile = this.#assertProfile(request.model_id, request.mode);
    if (!allowsOrdinaryImageReference(request.model_id, request.mode)) fail("MODE_HAS_NO_IMAGE_REFERENCES");
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerIdeogramImageInput | undefined;
    let uploadBytes: Uint8Array | undefined;
    let invoked = false;
    try {
      this.#prune(this.#readNow());
      validated = validateOwnerIdeogramImageInput({
        model_id: request.model_id, content_base64: request.content_base64,
        filename: request.filename, mime_type: request.mime_type
      });
      if (!profile.input_policy.accepted_file_types.includes(validated.original_mime_type) ||
          validated.model_id !== request.model_id) fail("MODEL_BINDING_MISMATCH");
      this.#assertProfile(request.model_id, request.mode);
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
      const nativeRequest = Object.freeze({ model_id: request.model_id, bytes: uploadBytes,
        filename: validated.filename, mime_type: validated.mime_type });
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
      const currentProfile = this.#assertProfile(request.model_id, request.mode);
      if (currentProfile.profile_schema_hash !== profile.profile_schema_hash ||
          expiresAt <= this.#readNow() || (this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#prune(this.#readNow());
      if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      const handle = `ideogram_image_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: PrivateRecord = Object.freeze({
        handle, attemptId: request.attemptId, principal, modelId: request.model_id, mode: request.mode,
        catalogVersion: currentProfile.public_catalog_version, profileSchemaHash: currentProfile.profile_schema_hash,
        fileUrl: privateReference.url, ...(privateReference.file_id === undefined ? {} : { fileId: privateReference.file_id }),
        sourceMimeType: validated.original_mime_type, mimeType: validated.mime_type, width: validated.width,
        height: validated.height, size: validated.size, sha256: validated.sha256, expiresAt, epoch
      });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: record.modelId, mode: record.mode,
        original_mime_type: record.sourceMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
        size: record.size, sha256: record.sha256,
        expires_in_seconds: Math.max(0, Math.ceil((expiresAt - this.#readNow()) / 1000)),
        metadata_confidence: "CONTAINER_METADATA_ONLY", validation_scope: "LOCAL_INPUT_VALIDATION_ONLY_NOT_PROVIDER_ACCEPTANCE" });
    } catch (error) {
      if (error instanceof OwnerIdeogramImageUploadServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerIdeogramImageInputError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        fail("INVALID_IMAGE_INPUT");
      }
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(request.attemptId);
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") {
        this.#invalidateAttemptState(request.attemptId);
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        fail("PRINCIPAL_NOT_LINKED");
      }
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

  async resolveImageReference(input: unknown): Promise<OwnerIdeogramPrivateImageReferenceResolution> {
    const request = snapshotResolutionInput(input);
    this.#assertOpen();
    const profile = this.#assertProfile(request.model_id, request.mode);
    if (!allowsOrdinaryImageReference(request.model_id, request.mode)) fail("REFERENCE_UNAVAILABLE");
    const operation = this.#beginOperation(request.attemptId);
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const record = this.#records.get(request.reference_handle);
      if (!record) fail("REFERENCE_UNAVAILABLE");
      const now = this.#readNow();
      if (record.expiresAt <= now) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
      this.#prune(now);
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      if (record.attemptId !== request.attemptId || record.modelId !== request.model_id || record.mode !== request.mode ||
          record.epoch !== epoch || record.catalogVersion !== profile.public_catalog_version ||
          record.profileSchemaHash !== profile.profile_schema_hash || !sameGenerationPrincipal(record.principal, principal) ||
          !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
      this.#assertProfile(request.model_id, request.mode);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("REFERENCE_EXPIRED");
      return Object.freeze({ role: "ordinary_image_reference", principal: record.principal, attempt_id: record.attemptId,
        model_id: record.modelId, mode: record.mode, catalog_version: record.catalogVersion,
        profile_schema_hash: record.profileSchemaHash, reference_handle: record.handle,
        file_url: record.fileUrl, ...(record.fileId === undefined ? {} : { file_id: record.fileId }),
        source_mime_type: record.sourceMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
        size: record.size, sha256: record.sha256, expires_at: record.expiresAt, epoch: record.epoch,
        metadata_confidence: "CONTAINER_METADATA_ONLY", generation_permit: false });
    } catch (error) {
      if (error instanceof OwnerIdeogramImageUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(request.attemptId, operation, false); }
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId)) return;
    this.#invalidateAttemptState(attemptId);
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    await Promise.allSettled(pending);
    this.#maybeReleaseAttempt(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const attemptId of this.#activeAttempts()) this.#invalidateAttemptState(attemptId);
    const pending = [...this.#allOperations];
    this.#closing = Promise.allSettled(pending).then(() => {
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear();
      this.#pendingByAttempt.clear(); this.#epochs.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #assertProfile(modelId: OwnerIdeogramImageModelId, mode: OwnerIdeogramImageMode): Readonly<OwnerIdeogramImageSourceProfile> {
    this.#assertOpen();
    const expected = this.#profiles.get(profileKey(modelId, mode));
    if (!expected) fail("MODEL_BINDING_MISMATCH");
    try {
      const current = getOwnerIdeogramImageSourceProfile(modelId, mode, this.#catalog, this.#catalogVersion);
      if (current.profile_schema_hash !== expected.profile_schema_hash || current.public_catalog_version !== expected.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
      return current;
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    let remove = () => {};
    try {
      const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (!signal) return await principal;
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerIdeogramImageUploadServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort();
        else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principal, aborted]);
    } catch (error) {
      if (error instanceof OwnerIdeogramImageUploadServiceError) throw error;
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
    const operation: PendingOperation = { controller, done, finish,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent), epoch: this.#epochs.get(attemptId) ?? 0 };
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
    return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]);
  }
  #hasAttemptState(attemptId: string): boolean { return this.#activeAttempts().has(attemptId); }
  #invalidateAttemptState(attemptId: string): void {
    if (!this.#hasAttemptState(attemptId)) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptHandles(attemptId); this.#principalByAttempt.delete(attemptId);
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

function snapshotUploadInput(value: unknown): Readonly<OwnerIdeogramImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "model_id", "mode", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.model_id !== "string" || typeof fields.mode !== "string" ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" || typeof fields.mime_type !== "string") fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: fields.model_id as OwnerIdeogramImageModelId,
    mode: fields.mode as OwnerIdeogramImageMode, content_base64: fields.content_base64, filename: fields.filename,
    mime_type: fields.mime_type, ...(signal === undefined ? {} : { signal: signal as AbortSignal }) });
}
function snapshotResolutionInput(value: unknown): Readonly<{ attemptId: string; model_id: OwnerIdeogramImageModelId; mode: OwnerIdeogramImageMode; reference_handle: string }> {
  const fields = exactRecord(value, ["attemptId", "model_id", "mode", "reference_handle"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.model_id !== "string" || typeof fields.mode !== "string" ||
      typeof fields.reference_handle !== "string" || !HANDLE_PATTERN.test(fields.reference_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: fields.model_id as OwnerIdeogramImageModelId,
    mode: fields.mode as OwnerIdeogramImageMode, reference_handle: fields.reference_handle });
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotNativeClient(value: unknown): { readonly client: SyntxChatHttpClient; readonly method: SyntxChatHttpClient["uploadIdeogramImageReference"] } {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("MODEL_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value), descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadIdeogramImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) ||
      descriptor.value !== NATIVE_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("MODEL_BINDING_MISMATCH");
  return { client: value, method: NATIVE_UPLOAD_METHOD };
}
function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id))) ||
      (fields.file_id !== undefined && /[\u0000-\u001f\u007f]/u.test(fields.file_id))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
}
function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => {
    let now: unknown;
    try { now = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("SERVICE_CLOSED");
    return now as number;
  };
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const allowed = [...required, ...optional], keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function profileKey(modelId: OwnerIdeogramImageModelId, mode: OwnerIdeogramImageMode): ProfileKey { return `${modelId}\u0000${mode}`; }
function isService(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function isObjectPort(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function allowsOrdinaryImageReference(modelId: OwnerIdeogramImageModelId, mode: OwnerIdeogramImageMode): boolean {
  return !(modelId === "ideogram_40" && mode === "transparent");
}
function fail(code: OwnerIdeogramImageUploadServiceErrorCode): never { throw new OwnerIdeogramImageUploadServiceError(code); }
