import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  createOwnerMagnificUpscaleOwnedImageBindingIssuer,
  getOwnerMagnificUpscaleSourceProfile,
  type OwnerMagnificUpscaleOwnedImageBindingIssuer,
  type OwnerMagnificUpscaleOwnedImageResolveContext,
  type OwnerMagnificUpscaleOwnedImageResolution,
  type OwnerMagnificUpscaleSourceProfile
} from "./owner-magnific-upscale-request-preparer.js";
import type { OwnerMagnificUpscaleVariant } from "./owner-magnific-upscale-parameters.js";
import {
  OwnerMagnificUpscaleInputError,
  validateOwnerMagnificUpscaleInput,
  type OwnerMagnificUpscaleImageMimeType
} from "./owner-magnific-upscale-input-validator.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE_PATTERN = /^magnific_image_[0-9a-f-]{36}$/u;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u;
const MAX_HANDLES = 128;
const MAX_PENDING = 4;
const HANDLE_TTL_MS = 15 * 60_000;
const SOURCE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"] as const);
const VARIANTS = Object.freeze(["creative", "precision_v1", "precision_v2"] as const);
const NATIVE_MAGNIFIC_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadMagnificUpscaleImageReference;
const PROFILE_BY_VARIANT = new Map<OwnerMagnificUpscaleVariant, Readonly<OwnerMagnificUpscaleSourceProfile>>(
  VARIANTS.map((variant) => [variant, getOwnerMagnificUpscaleSourceProfile(variant)] as const)
);

export interface OwnerMagnificUpscaleUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly catalogVersion: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerMagnificUpscaleUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: OwnerMagnificUpscaleImageMimeType;
  readonly signal?: AbortSignal;
}

export interface OwnerMagnificUpscaleUploadReceipt {
  readonly status: "accepted";
  readonly image_handle: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly mime_type: OwnerMagnificUpscaleImageMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly expires_in_seconds: 900;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export type OwnerMagnificUpscaleUploadErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IMAGE_INPUT"
  | "UNSUPPORTED_SOURCE_FORMAT"
  | "UNSUPPORTED_SOURCE_SIZE"
  | "UNSUPPORTED_AVIF_COMPOSITION"
  | "PRINCIPAL_NOT_LINKED"
  | "MODEL_BINDING_MISMATCH"
  | "SERVICE_BUSY"
  | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED"
  | "REQUEST_ABORTED"
  | "IMAGE_HANDLE_UNAVAILABLE"
  | "IMAGE_HANDLE_EXPIRED"
  | "UPLOAD_REJECTED"
  | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerMagnificUpscaleUploadServiceError extends Error {
  constructor(readonly code: OwnerMagnificUpscaleUploadErrorCode) {
    super("The owner Magnific image upload is unavailable.");
    this.name = "OwnerMagnificUpscaleUploadServiceError";
  }
}

interface InternalOwnedImageRecord {
  readonly imageHandle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly modelId: OwnerMagnificUpscaleVariant;
  readonly catalogVersion: string;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly mimeType: OwnerMagnificUpscaleImageMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expiresAt: number;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
}

/** Process-local private Magnific upload issuer; no provider URL or file ID is returned. */
export class OwnerMagnificUpscaleUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerMagnificUpscaleUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #records = new Map<string, InternalOwnedImageRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #pendingByAttempt = new Map<string, Set<AbortController>>();
  readonly #operations = new Set<Promise<void>>();
  readonly #bindingIssuers = new Set<OwnerMagnificUpscaleOwnedImageBindingIssuer>();
  readonly #attemptEpoch = new Map<string, number>();
  #pendingCount = 0;
  #pendingUploads = 0;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerMagnificUpscaleUploadServiceOptions) {
    const fields = exactRecord(options, ["binding", "linkService", "catalog", "catalogVersion", "resolveClient"], ["now"]);
    if (typeof fields.catalogVersion !== "string" ||
        typeof fields.resolveClient !== "function" ||
        typeof fields.linkService !== "object" || !fields.linkService ||
        typeof fields.catalog !== "object" || !fields.catalog) fail("INVALID_REQUEST");
    const binding = snapshotBinding(fields.binding);
    if (fields.catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
        fields.catalogVersion !== getOwnerMagnificUpscaleSourceProfile("creative").public_catalog_version) {
      fail("MODEL_BINDING_MISMATCH");
    }
    this.#binding = binding;
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as Pick<DiscoveryCatalogRepository, "getModel">;
    this.#catalogVersion = fields.catalogVersion;
    this.#resolveClient = fields.resolveClient as OwnerMagnificUpscaleUploadServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
  }

  async upload(input: OwnerMagnificUpscaleUploadInput | unknown): Promise<OwnerMagnificUpscaleUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const profile = this.#assertVariant(request.variant, request.mime_type);
    const operation = this.#beginOperation(request.attemptId, request.signal);
    let validatedImage: ReturnType<typeof validateOwnerMagnificUpscaleInput> | undefined;
    let uploadBytes: Uint8Array | undefined;
    let uploadInvoked = false;
    let uploadReservation = false;
    try {
      this.#pruneExpired(this.#readNow());
      if (this.#records.size + this.#pendingUploads >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");
      validatedImage = validateMagnificImage({
        content_base64: request.content_base64,
        filename: request.filename,
        mime_type: request.mime_type
      });
      this.#throwIfClosedOrAborted(operation.controller);

      const principal = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      const client = snapshotNativeClient(this.#resolveClient(request.attemptId));
      this.#pendingUploads += 1;
      uploadReservation = true;
      uploadBytes = new Uint8Array(validatedImage.bytes);
      const uploadRequest = Object.freeze({
        bytes: uploadBytes,
        filename: validatedImage.filename,
        mime_type: validatedImage.mime_type,
        model_type: profile.model_id
      });
      const reference = await (async () => {
        uploadInvoked = true;
        return Reflect.apply(client.method, client.client, [uploadRequest, operation.controller.signal]);
      })();

      this.#throwIfClosedOrAborted(operation.controller);
      const safeReference = parseOneUploadReference(reference);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        this.#removeAttempt(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const currentProfile = this.#assertVariant(request.variant, validatedImage.mime_type);
      if (currentProfile.profile_schema_hash !== profile.profile_schema_hash ||
          currentProfile.public_catalog_version !== profile.public_catalog_version ||
          this.#catalogVersion !== currentProfile.public_catalog_version) fail("MODEL_BINDING_MISMATCH");
      this.#pruneExpired(this.#readNow());
      if (this.#records.size >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");
      const now = this.#readNow();
      if (now > Number.MAX_SAFE_INTEGER - HANDLE_TTL_MS) fail("SERVICE_CLOSED");
      const imageHandle = `magnific_image_${randomUUID()}`;
      if (!IMAGE_HANDLE_PATTERN.test(imageHandle) || this.#records.has(imageHandle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: InternalOwnedImageRecord = Object.freeze({
        imageHandle,
        attemptId: request.attemptId,
        principal,
        variant: request.variant,
        modelId: profile.model_id,
        catalogVersion: profile.public_catalog_version,
        profileSchemaHash: profile.profile_schema_hash,
        fileUrl: safeReference.url,
        mimeType: validatedImage.mime_type,
        width: validatedImage.width,
        height: validatedImage.height,
        size: validatedImage.bytes.byteLength,
        sha256: `sha256:${validatedImage.sha256}`,
        expiresAt: now + HANDLE_TTL_MS
      });
      this.#records.set(imageHandle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(imageHandle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({
        status: "accepted",
        image_handle: imageHandle,
        variant: request.variant,
        mime_type: record.mimeType,
        size: record.size,
        width: record.width,
        height: record.height,
        sha256: record.sha256,
        expires_in_seconds: 900 as const,
        metadata_confidence: validatedImage.metadata_confidence
      });
    } catch (error) {
      if (error instanceof OwnerMagnificUpscaleUploadServiceError) {
        if (uploadInvoked && error.code !== "UPLOAD_REJECTED") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) {
        fail(uploadInvoked ? "UPLOAD_OUTCOME_UNKNOWN" : "PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof OwnerMagnificUpscaleInputError) {
        fail(mapInputError(error.code));
      }
      if (error instanceof SyntxHttpError && isKnownUploadRejection(error.code)) fail("UPLOAD_REJECTED");
      if (uploadInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
      return fail(operation.controller.signal.aborted ? "REQUEST_ABORTED" : "INVALID_REQUEST");
    } finally {
      uploadBytes?.fill(0);
      validatedImage?.bytes.fill(0);
      if (uploadReservation) this.#pendingUploads -= 1;
      this.#finishOperation(request.attemptId, operation);
    }
  }

  /** Creates the frozen Task421 issuer over this service's private handle store. */
  createOwnedImageBindingIssuer(): OwnerMagnificUpscaleOwnedImageBindingIssuer {
    this.#assertOpen();
    const issuer = createOwnerMagnificUpscaleOwnedImageBindingIssuer(
      (context) => this.#resolveOwnedImage(context),
      { now: this.#now }
    );
    this.#bindingIssuers.add(issuer);
    return issuer;
  }

  invalidateAttempt(attemptId: string): void {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    this.#attemptEpoch.set(attemptId, (this.#attemptEpoch.get(attemptId) ?? 0) + 1);
    this.#removeAttempt(attemptId);
    for (const controller of this.#pendingByAttempt.get(attemptId) ?? []) controller.abort();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#pendingByAttempt.values()) for (const controller of controllers) controller.abort();
    for (const issuer of this.#bindingIssuers) issuer.close();
    this.#bindingIssuers.clear();
    this.#records.clear();
    this.#handlesByAttempt.clear();
    this.#closing = Promise.allSettled([...this.#operations]).then(() => undefined);
    return this.#closing;
  }

  #assertOpen(): void {
    if (this.#closed) fail("SERVICE_CLOSED");
  }

  #assertVariant(variant: OwnerMagnificUpscaleVariant, mimeType?: string): Readonly<OwnerMagnificUpscaleSourceProfile> {
    this.#assertOpen();
    const profile = PROFILE_BY_VARIANT.get(variant);
    if (!profile || profile.public_catalog_version !== this.#catalogVersion ||
        (mimeType !== undefined && !SOURCE_MIME_TYPES.includes(mimeType as OwnerMagnificUpscaleImageMimeType))) {
      fail("MODEL_BINDING_MISMATCH");
    }
    try {
      const model = this.#catalog.getModel(profile.model_id);
      const mimeValues = model.settings?.accepted_file_types;
      if (model.id !== profile.model_id || model.upstream_id !== profile.model_id || model.ai_name !== "magnific" ||
          model.scope !== profile.scope || model.active !== true || !model.modalities.includes("image") ||
          !model.operations.some((operation) => operation.id === profile.operation_id && operation.output_modality === "image") ||
          model.settings?.uploadable !== true || model.settings.file_count_limit !== 1 ||
          !Array.isArray(mimeValues) || (mimeType !== undefined && !mimeValues.includes(mimeType))) fail("MODEL_BINDING_MISMATCH");
    } catch (error) {
      if (error instanceof OwnerMagnificUpscaleUploadServiceError) throw error;
      fail("MODEL_BINDING_MISMATCH");
    }
    return profile;
  }

  async #resolveOwnedImage(contextInput: Readonly<OwnerMagnificUpscaleOwnedImageResolveContext>): Promise<OwnerMagnificUpscaleOwnedImageResolution> {
    const context = snapshotResolveContext(contextInput);
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(context.attempt_id) || context.principal.connection_id !== context.attempt_id ||
        !IMAGE_HANDLE_PATTERN.test(context.opaque_image_handle)) fail("IMAGE_HANDLE_UNAVAILABLE");
    const profile = this.#assertVariant(context.variant);
    if (context.model_id !== profile.model_id || context.scope !== profile.scope ||
        context.catalog_version !== profile.public_catalog_version || context.profile_schema_hash !== profile.profile_schema_hash) {
      fail("IMAGE_HANDLE_UNAVAILABLE");
    }
    const epoch = this.#attemptEpoch.get(context.attempt_id) ?? 0;
    const operation = this.#beginOperation(context.attempt_id);
    try {
      const principal = await this.#resolvePrincipal(context.attempt_id);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(context.principal, principal)) fail("IMAGE_HANDLE_UNAVAILABLE");
      const record = this.#records.get(context.opaque_image_handle);
      if (!record) fail("IMAGE_HANDLE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) {
        this.#removeHandle(record.imageHandle);
        fail("IMAGE_HANDLE_EXPIRED");
      }
      if (record.attemptId !== context.attempt_id || !sameGenerationPrincipal(record.principal, principal) ||
          record.variant !== context.variant || record.modelId !== context.model_id ||
          record.catalogVersion !== context.catalog_version || record.profileSchemaHash !== context.profile_schema_hash ||
          !isSafeUploadReferenceUrl(record.fileUrl)) fail("IMAGE_HANDLE_UNAVAILABLE");
      const currentProfile = this.#assertVariant(context.variant, record.mimeType);
      if ((this.#attemptEpoch.get(context.attempt_id) ?? 0) !== epoch || currentProfile.profile_schema_hash !== record.profileSchemaHash) {
        fail("IMAGE_HANDLE_UNAVAILABLE");
      }
      const currentPrincipal = await this.#resolvePrincipal(context.attempt_id);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal) ||
          (this.#attemptEpoch.get(context.attempt_id) ?? 0) !== epoch ||
          this.#records.get(record.imageHandle) !== record) fail("IMAGE_HANDLE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) {
        this.#removeHandle(record.imageHandle);
        fail("IMAGE_HANDLE_EXPIRED");
      }
      return Object.freeze({
        principal: record.principal,
        attempt_id: record.attemptId,
        variant: record.variant,
        model_id: record.modelId,
        scope: currentProfile.scope,
        catalog_version: record.catalogVersion,
        profile_schema_hash: record.profileSchemaHash,
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
      if (error instanceof OwnerMagnificUpscaleUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("IMAGE_HANDLE_UNAVAILABLE");
      fail("IMAGE_HANDLE_UNAVAILABLE");
    } finally {
      this.#finishOperation(context.attempt_id, operation);
    }
  }

  async #resolvePrincipal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    } catch {
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
    }
  }

  #beginOperation(attemptId: string, parentSignal?: AbortSignal): PendingOperation {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) onAbort();
    else parentSignal?.addEventListener("abort", onAbort, { once: true });
    const controllers = this.#pendingByAttempt.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.#pendingByAttempt.set(attemptId, controllers);
    this.#pendingCount += 1;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    this.#operations.add(done);
    return { controller, done, finish, removeParentAbort: () => parentSignal?.removeEventListener("abort", onAbort) };
  }

  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const controllers = this.#pendingByAttempt.get(attemptId);
    controllers?.delete(operation.controller);
    if (controllers?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1;
    operation.finish();
    this.#operations.delete(operation.done);
  }

  #throwIfClosedOrAborted(operation: AbortController): void {
    if (this.#closed) fail("SERVICE_CLOSED");
    if (operation.signal.aborted) fail("REQUEST_ABORTED");
  }

  #removeAttempt(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#records.delete(handle);
    this.#handlesByAttempt.delete(attemptId);
    for (const issuer of this.#bindingIssuers) issuer.invalidateAttempt(attemptId);
  }

  #removeHandle(handle: string): void {
    const record = this.#records.get(handle);
    if (!record) return;
    this.#records.delete(handle);
    const handles = this.#handlesByAttempt.get(record.attemptId);
    handles?.delete(handle);
    if (handles?.size === 0) this.#handlesByAttempt.delete(record.attemptId);
  }

  #pruneExpired(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeHandle(handle);
  }

  #readNow(): number {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0) fail("SERVICE_CLOSED");
    return now;
  }
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotUploadInput(value: unknown): {
  attemptId: string; variant: OwnerMagnificUpscaleVariant; content_base64: string;
  filename: string; mime_type: OwnerMagnificUpscaleImageMimeType; signal?: AbortSignal;
} {
  const fields = exactRecord(value, ["attemptId", "variant", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.variant !== "string" || !PROFILE_BY_VARIANT.has(fields.variant as OwnerMagnificUpscaleVariant) ||
      typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
      typeof fields.filename !== "string" || !SAFE_FILENAME.test(fields.filename) || typeof fields.mime_type !== "string" ||
      !(SOURCE_MIME_TYPES as readonly string[]).includes(fields.mime_type)) {
    if (typeof fields.mime_type === "string" && !(SOURCE_MIME_TYPES as readonly string[]).includes(fields.mime_type)) {
      fail("UNSUPPORTED_SOURCE_FORMAT");
    }
    fail("INVALID_REQUEST");
  }
  const signal = fields.signal;
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
  return {
    attemptId: fields.attemptId,
    variant: fields.variant as OwnerMagnificUpscaleVariant,
    content_base64: fields.content_base64,
    filename: fields.filename,
    mime_type: fields.mime_type as OwnerMagnificUpscaleImageMimeType,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal })
  };
}

function snapshotResolveContext(value: unknown): Readonly<OwnerMagnificUpscaleOwnedImageResolveContext> {
  const fields = exactRecord(value, ["principal", "attempt_id", "opaque_image_handle", "variant", "model_id", "scope", "catalog_version", "profile_schema_hash"]);
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { fail("IMAGE_HANDLE_UNAVAILABLE"); }
  if (typeof fields.attempt_id !== "string" || typeof fields.opaque_image_handle !== "string" ||
      typeof fields.variant !== "string" || typeof fields.model_id !== "string" || typeof fields.scope !== "string" ||
      typeof fields.catalog_version !== "string" || typeof fields.profile_schema_hash !== "string") fail("IMAGE_HANDLE_UNAVAILABLE");
  return Object.freeze({
    principal,
    attempt_id: fields.attempt_id,
    opaque_image_handle: fields.opaque_image_handle,
    variant: fields.variant as OwnerMagnificUpscaleVariant,
    model_id: fields.model_id as OwnerMagnificUpscaleVariant,
    scope: fields.scope as "tool_image_upscaler",
    catalog_version: fields.catalog_version,
    profile_schema_hash: fields.profile_schema_hash
  });
}

function validateMagnificImage(request: { content_base64: string; filename: string; mime_type: string }): ReturnType<typeof validateOwnerMagnificUpscaleInput> {
  try {
    return validateOwnerMagnificUpscaleInput(request);
  } catch (error) {
    if (error instanceof OwnerMagnificUpscaleInputError) throw error;
    return fail("INVALID_IMAGE_INPUT");
  }
}

function parseOneUploadReference(value: unknown): InternalUploadReference {
  const record = exactRecord(value, ["url"], ["file_id"]);
  if (typeof record.url !== "string" || !isSafeUploadReferenceUrl(record.url) ||
      (record.file_id !== undefined && (typeof record.file_id !== "string" || record.file_id.length > 256))) {
    fail("UPLOAD_OUTCOME_UNKNOWN");
  }
  return Object.freeze({ url: record.url, ...(record.file_id === undefined ? {} : { file_id: record.file_id as string }) });
}

function snapshotNativeClient(value: unknown): {
  readonly client: SyntxChatHttpClient;
  readonly method: SyntxChatHttpClient["uploadMagnificUpscaleImageReference"];
} {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadMagnificUpscaleImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) ||
      descriptor.value !== NATIVE_MAGNIFIC_UPLOAD_METHOD || typeof descriptor.value !== "function") {
    fail("INVALID_REQUEST");
  }
  return { client: value as SyntxChatHttpClient, method: NATIVE_MAGNIFIC_UPLOAD_METHOD };
}

function mapInputError(code: OwnerMagnificUpscaleInputError["code"]): OwnerMagnificUpscaleUploadErrorCode {
  if (code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") return "UNSUPPORTED_SOURCE_SIZE";
  if (code === "UNSUPPORTED_AVIF_COMPOSITION") return "UNSUPPORTED_AVIF_COMPOSITION";
  return "INVALID_IMAGE_INPUT";
}

function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_REQUIRED" ||
    code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
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
  if (keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return value as () => number;
}

function fail(code: OwnerMagnificUpscaleUploadErrorCode): never {
  throw new OwnerMagnificUpscaleUploadServiceError(code);
}
