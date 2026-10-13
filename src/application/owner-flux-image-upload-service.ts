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
  type OwnerFluxAssetResolverContext,
  type OwnerFluxImageReferenceResolution,
  type ResolveOwnerFluxImageReference
} from "./owner-flux-image-request-preparer.js";
import { getOwnerFluxImageSourceProfile, type OwnerFluxImageCatalogPort, type OwnerFluxImageSourceProfile } from "./owner-flux-image-source-profile.js";
import {
  OwnerRunwayFluxImageInputError,
  validateOwnerRunwayFluxImageInput,
  type ValidatedOwnerRunwayFluxImageInput
} from "./owner-runway-flux-image-input-validator.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^flux_image_[0-9a-f-]{36}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadFluxImageReference;
const SOURCE_FIELDS = ["principal", "attempt_id", "model_id", "ai_name", "scope", "operation_id", "catalog_version", "profile_schema_hash"] as const;

export interface OwnerFluxImageUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerFluxImageCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerFluxImageUploadInput {
  readonly attemptId: string;
  readonly model_id: "flux-1";
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly signal?: AbortSignal;
}

export interface OwnerFluxImageUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: "flux-1";
  readonly source_mime_type: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
}

export type OwnerFluxImageUploadServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerFluxImageUploadServiceError extends Error {
  constructor(readonly code: OwnerFluxImageUploadServiceErrorCode) {
    super("The owner Flux image upload is unavailable.");
    this.name = "OwnerFluxImageUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly modelId: "flux-1";
  readonly aiName: "flux";
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly assetId: string;
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

/** Owner-linked Flux-1 image uploads; the bound resolver grants image provenance only to native uploaded bytes. */
export class OwnerFluxImageUploadService {
  readonly resolveImage: ResolveOwnerFluxImageReference;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerFluxImageCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerFluxImageUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profile: Readonly<OwnerFluxImageSourceProfile>;
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

  constructor(optionsInput: OwnerFluxImageUploadServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (fields.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isPlainService(fields.linkService) ||
        !isPlainService(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerFluxImageCatalogPort;
    this.#catalogVersion = fields.catalog_version as string;
    this.#resolveClient = fields.resolveClient as OwnerFluxImageUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try { this.#profile = getOwnerFluxImageSourceProfile("flux-1", this.#catalog, this.#catalogVersion); }
    catch { fail("MODEL_BINDING_MISMATCH"); }
    this.resolveImage = (context) => this.#resolveOwnedImage(context);
  }

  async upload(input: OwnerFluxImageUploadInput | unknown): Promise<OwnerFluxImageUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    if (request.model_id !== "flux-1") fail("INVALID_REQUEST");
    this.#assertProfile();
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerRunwayFluxImageInput | undefined;
    let uploadBytes: Uint8Array | undefined;
    let invoked = false;
    try {
      this.#prune(this.#readNow());
      validated = validateOwnerRunwayFluxImageInput({ variant: "flux-1", content_base64: request.content_base64,
        filename: request.filename, mime_type: request.mime_type });
      if (!this.#profile.media_limits.accepted_file_types.includes(validated.source_mime_type)) fail("MODEL_BINDING_MISMATCH");
      this.#assertProfile();
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
      const nativeRequest = Object.freeze({ variant: "flux-1" as const, bytes: uploadBytes,
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
      this.#assertProfile();
      if (expiresAt <= this.#readNow() || (this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#prune(this.#readNow());
      if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      const handle = `flux_image_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: PrivateRecord = Object.freeze({ handle, attemptId: request.attemptId, principal,
        modelId: "flux-1", aiName: this.#profile.ai_name, catalogVersion: this.#profile.public_catalog_version,
        profileSchemaHash: this.#profile.profile_schema_hash, fileUrl: privateReference.url,
        assetId: trustedAssetObjectName(privateReference.url), sourceMimeType: validated.source_mime_type, mimeType: validated.mime_type,
        width: validated.width, height: validated.height, size: validated.size, sha256: validated.sha256, expiresAt, epoch });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: "flux-1",
        source_mime_type: record.sourceMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
        size: record.size, sha256: record.sha256, expires_in_seconds: Math.max(0, Math.ceil((expiresAt - this.#readNow()) / 1000)),
        metadata_confidence: validated.metadata_confidence, size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT" });
    } catch (error) {
      if (error instanceof OwnerFluxImageUploadServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerRunwayFluxImageInputError) {
        if (invoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
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
    this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => undefined);
    return this.#closing;
  }

  async #resolveOwnedImage(contextInput: unknown): Promise<OwnerFluxImageReferenceResolution> {
    const context = snapshotResolverContext(contextInput);
    this.#assertOpen();
    if (context.model_id !== "flux-1" || context.ai_name !== this.#profile.ai_name || context.scope !== "image" ||
        context.operation_id !== this.#profile.operation_id || context.catalog_version !== this.#profile.public_catalog_version ||
        context.profile_schema_hash !== this.#profile.profile_schema_hash || context.principal.connection_id !== context.attempt_id) fail("MODEL_BINDING_MISMATCH");
    const operation = this.#beginOperation(context.attempt_id);
    try {
      this.#prune(this.#readNow());
      const record = this.#records.get(context.asset_handle);
      if (!record) fail("REFERENCE_UNAVAILABLE");
      const now = this.#readNow();
      if (record.expiresAt <= now) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
      const epoch = this.#epochs.get(context.attempt_id) ?? 0;
      if (record.epoch !== epoch || record.attemptId !== context.attempt_id || record.modelId !== context.model_id ||
          record.catalogVersion !== context.catalog_version || record.profileSchemaHash !== context.profile_schema_hash ||
          !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
      const principal = await this.#resolvePrincipal(context.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, context.principal) || !sameGenerationPrincipal(principal, record.principal) ||
          (this.#epochs.get(context.attempt_id) ?? 0) !== epoch) fail("REFERENCE_UNAVAILABLE");
      this.#assertProfile();
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record) fail("REFERENCE_EXPIRED");
      return Object.freeze({ ...context, asset_role: "image_reference", provenance: "private_r2_owned", provenance_verified: true,
        asset_id: record.assetId, canonical_url: record.fileUrl, mime_type: record.mimeType, width: record.width, height: record.height,
        size: record.size, sha256: record.sha256, expires_at: record.expiresAt });
    } catch (error) {
      if (error instanceof OwnerFluxImageUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) {
        this.#invalidateAttemptState(context.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(context.attempt_id, operation, false); }
  }

  #assertProfile(): void {
    this.#assertOpen();
    try {
      const current = getOwnerFluxImageSourceProfile("flux-1", this.#catalog, this.#catalogVersion);
      if (current.profile_schema_hash !== this.#profile.profile_schema_hash || current.public_catalog_version !== this.#profile.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
    } catch { fail("MODEL_BINDING_MISMATCH"); }
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    let remove = () => {};
    try {
      const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (!signal) return await principal;
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerFluxImageUploadServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort();
        else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principal, aborted]);
    } catch (error) {
      if (error instanceof OwnerFluxImageUploadServiceError) throw error;
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
    const controller = new AbortController(), abortFromParent = () => controller.abort(parentSignal?.reason);
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
  #activeAttempts(): Set<string> { return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]); }
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

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function snapshotUploadInput(value: unknown): Readonly<OwnerFluxImageUploadInput> {
  const fields = exactRecord(value, ["attemptId", "model_id", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" || typeof fields.mime_type !== "string") fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: fields.model_id as "flux-1", content_base64: fields.content_base64,
    filename: fields.filename, mime_type: fields.mime_type, ...(signal === undefined ? {} : { signal: signal as AbortSignal }) });
}
function snapshotResolverContext(value: unknown): Readonly<OwnerFluxAssetResolverContext> {
  const fields = exactRecord(value, [...SOURCE_FIELDS, "asset_handle", "asset_role"]);
  if (fields.model_id !== "flux-1" || fields.ai_name !== "flux" || fields.scope !== "image" || fields.operation_id !== "generate-image" ||
      fields.asset_role !== "image_reference" || typeof fields.attempt_id !== "string" || !ATTEMPT_PATTERN.test(fields.attempt_id) ||
      typeof fields.asset_handle !== "string" || !HANDLE_PATTERN.test(fields.asset_handle)) fail("REFERENCE_UNAVAILABLE");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); } catch { fail("REFERENCE_UNAVAILABLE"); }
  if (principal.connection_id !== fields.attempt_id) fail("REFERENCE_UNAVAILABLE");
  if (typeof fields.catalog_version !== "string" || typeof fields.profile_schema_hash !== "string" || !SHA256_PATTERN.test(fields.profile_schema_hash)) fail("REFERENCE_UNAVAILABLE");
  // 623 compares the principal field by identity as well as validating its values.
  return Object.freeze({ ...fields, principal: fields.principal as Readonly<GenerationPrincipalRef> }) as unknown as OwnerFluxAssetResolverContext;
}
function snapshotNativeClient(value: unknown): { readonly client: SyntxChatHttpClient; readonly method: SyntxChatHttpClient["uploadFluxImageReference"] } {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("MODEL_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value), descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadFluxImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("MODEL_BINDING_MISMATCH");
  return { client: value, method: NATIVE_UPLOAD_METHOD };
}
function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id))) ||
      (fields.file_id !== undefined && /[\u0000-\u001f\u007f]/u.test(fields.file_id))) fail("UPLOAD_OUTCOME_UNKNOWN");
  let url: URL;
  try { url = new URL(fields.url); } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
  if (url.search !== "") fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
}
function trustedAssetObjectName(value: string): string {
  let path: string;
  try { path = new URL(value).pathname; } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
  const basename = path.slice(path.lastIndexOf("/") + 1);
  if (!basename || basename.length > 256 || /[\u0000-\u001f\u007f]/u.test(basename)) fail("UPLOAD_OUTCOME_UNKNOWN");
  return basename;
}
function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean { return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED"; }
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let now: unknown; try { now = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(now) || (now as number) < 0) fail("SERVICE_CLOSED"); return now as number; };
}
function isPlainService(value: unknown): boolean { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
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
function fail(code: OwnerFluxImageUploadServiceErrorCode): never { throw new OwnerFluxImageUploadServiceError(code); }
