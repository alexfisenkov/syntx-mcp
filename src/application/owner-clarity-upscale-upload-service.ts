import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  createOwnerClarityUpscaleOwnedImageBindingIssuer,
  getOwnerClarityUpscaleSourceProfile,
  type OwnerClarityUpscaleOwnedImageBindingIssuer
} from "./owner-clarity-upscale-request-preparer.js";
import { OwnerClarityUpscaleInputError, validateOwnerClarityUpscaleInput } from "./owner-clarity-upscale-input-validator.js";

const MODEL_ID = "clarity" as const;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE_PATTERN = /^clarity_image_[0-9a-f-]{36}$/u;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u;
const SOURCE_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(SOURCE_MAX_IMAGE_BYTES / 3) * 4;
const SOURCE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"] as const);
const IMPLEMENTED_MIME_TYPES = SOURCE_MIME_TYPES;
const MAX_HANDLES = 128;
const MAX_PENDING = 4;
const HANDLE_TTL_MS = 15 * 60_000;
const PROFILE_SCHEMA_HASH = schemaHash(getOwnerClarityUpscaleSourceProfile());
const UPLOAD_DESTINATION = "uploaded" as const;

export const OWNER_CLARITY_UPSCALE_UPLOAD_COVERAGE = Object.freeze({
  source_mime_types: SOURCE_MIME_TYPES,
  source_max_bytes: SOURCE_MAX_IMAGE_BYTES,
  implemented_mime_types: IMPLEMENTED_MIME_TYPES,
  implemented_max_bytes: SOURCE_MAX_IMAGE_BYTES,
  status: "STRUCTURALLY_VALIDATED_NOT_PROVIDER_ACCEPTANCE",
  upload_destination: UPLOAD_DESTINATION,
  destination_source_binding: "root347_clarity_default_upload"
} as const);

export interface OwnerClarityUpscaleUploadServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly catalogVersion: string;
  readonly resolveClient: (attemptId: string) => Pick<SyntxChatHttpClient, "uploadClarityUpscaleImageReference">;
  readonly now?: () => number;
}

export interface OwnerClarityUpscaleUploadInput {
  readonly attemptId: string;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly signal?: AbortSignal;
}

export interface OwnerClarityUpscaleUploadReceipt {
  readonly status: "accepted";
  readonly image_handle: string;
  readonly mime_type: "image/jpeg" | "image/png" | "image/avif" | "image/webp";
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
  readonly expires_in_seconds: 900;
  readonly confidence_scope: "input_bytes_sniffed_and_dimensions_checked";
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly upload_destination: "uploaded";
  readonly destination_source_binding: "root347_clarity_default_upload";
  readonly coverage: typeof OWNER_CLARITY_UPSCALE_UPLOAD_COVERAGE;
}

export type OwnerClarityUpscaleUploadErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_IMAGE_INPUT"
  | "UNSUPPORTED_SOURCE_FORMAT"
  | "UNSUPPORTED_SOURCE_SIZE"
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

export class OwnerClarityUpscaleUploadServiceError extends Error {
  constructor(readonly code: OwnerClarityUpscaleUploadErrorCode) {
    super("The owner Clarity image upload is unavailable.");
    this.name = "OwnerClarityUpscaleUploadServiceError";
  }
}

interface InternalOwnedImageRecord {
  readonly imageHandle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly modelId: typeof MODEL_ID;
  readonly catalogVersion: typeof DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/avif" | "image/webp";
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

/** Process-local private upload issuer; it returns no upstream URL or file ID. */
export class OwnerClarityUpscaleUploadService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: Pick<DiscoveryCatalogRepository, "getModel">;
  readonly #resolveClient: OwnerClarityUpscaleUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #records = new Map<string, InternalOwnedImageRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #pendingByAttempt = new Map<string, Set<AbortController>>();
  readonly #operations = new Set<Promise<void>>();
  #pendingCount = 0;
  #pendingUploads = 0;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerClarityUpscaleUploadServiceOptions) {
    if (options.catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH");
    this.#assertModel(options.catalog);
    this.#binding = snapshotBinding(options.binding);
    this.#linkService = options.linkService;
    this.#catalog = options.catalog;
    this.#resolveClient = options.resolveClient;
    this.#now = options.now ?? Date.now;
  }

  async upload(input: OwnerClarityUpscaleUploadInput | unknown): Promise<OwnerClarityUpscaleUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    this.#assertModel(this.#catalog);
    const operation = this.#beginOperation(request.attemptId, request.signal);
    let validatedImage: ReturnType<typeof validateOwnerClarityUpscaleInput> | undefined;
    let uploadBytes: Uint8Array | undefined;
    let uploadInvoked = false;
    let uploadReservation = false;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      this.#pruneExpired(this.#readNow());
      if (this.#records.size + this.#pendingUploads >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");
      validatedImage = validateClarityImage(request);
      this.#throwIfClosedOrAborted(operation.controller);
      const uploadClient = snapshotUploadClient(this.#resolveClient(request.attemptId));
      this.#pendingUploads += 1;
      uploadReservation = true;
      uploadBytes = new Uint8Array(validatedImage.bytes);
      const result = await (async () => {
        uploadInvoked = true;
        return Reflect.apply(uploadClient.method, uploadClient.client, [{
          bytes: uploadBytes!,
          filename: request.filename,
          mime_type: validatedImage!.mime_type
        }, operation.controller.signal]);
      })();
      this.#throwIfClosedOrAborted(operation.controller);
      const reference = parseOneUploadReference(result);
      const current = await this.#resolvePrincipal(request.attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, current)) fail("PRINCIPAL_NOT_LINKED");
      this.#pruneExpired(this.#readNow());
      if (this.#records.size >= MAX_HANDLES) fail("CAPACITY_EXCEEDED");
      const now = this.#readNow();
      if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - HANDLE_TTL_MS) fail("SERVICE_CLOSED");
      const imageHandle = `clarity_image_${randomUUID()}`;
      if (!IMAGE_HANDLE_PATTERN.test(imageHandle) || this.#records.has(imageHandle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record: InternalOwnedImageRecord = Object.freeze({
        imageHandle,
        attemptId: request.attemptId,
        principal,
        modelId: MODEL_ID,
        catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
        profileSchemaHash: PROFILE_SCHEMA_HASH,
        fileUrl: reference.url,
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
        mime_type: record.mimeType,
        size: record.size,
        width: record.width,
        height: record.height,
        sha256: record.sha256,
        expires_in_seconds: 900 as const,
        confidence_scope: "input_bytes_sniffed_and_dimensions_checked" as const,
        metadata_confidence: validatedImage.metadata_confidence,
        upload_destination: UPLOAD_DESTINATION,
        destination_source_binding: "root347_clarity_default_upload" as const,
        coverage: OWNER_CLARITY_UPSCALE_UPLOAD_COVERAGE
      });
    } catch (error) {
      if (error instanceof OwnerClarityUpscaleUploadServiceError) {
        if (uploadInvoked && error.code !== "UPLOAD_REJECTED") {
          throw new OwnerClarityUpscaleUploadServiceError("UPLOAD_OUTCOME_UNKNOWN");
        }
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) {
        throw new OwnerClarityUpscaleUploadServiceError(uploadInvoked ? "UPLOAD_OUTCOME_UNKNOWN" : "PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof OwnerClarityUpscaleInputError) throw new OwnerClarityUpscaleUploadServiceError("INVALID_IMAGE_INPUT");
      if (error instanceof SyntxHttpError && isKnownUploadRejection(error.code)) throw new OwnerClarityUpscaleUploadServiceError("UPLOAD_REJECTED");
      if (uploadInvoked) throw new OwnerClarityUpscaleUploadServiceError("UPLOAD_OUTCOME_UNKNOWN");
      throw new OwnerClarityUpscaleUploadServiceError(operation.controller.signal.aborted ? "REQUEST_ABORTED" : "INVALID_REQUEST");
    } finally {
      uploadBytes?.fill(0);
      validatedImage?.bytes.fill(0);
      if (uploadReservation) this.#pendingUploads -= 1;
      this.#finishOperation(request.attemptId, operation);
    }
  }

  /** Internal resolver for the existing Clarity owned-image binding issuer. */
  async resolveOwnedImage(
    attemptIdInput: string,
    principalInput: Readonly<GenerationPrincipalRef>,
    imageHandleInput: string
  ): Promise<Readonly<{
    principal: Readonly<GenerationPrincipalRef>; attempt_id: string; scope: "tool_image_upscaler";
    model_id: "clarity"; file_url: string; mime_type: "image/jpeg" | "image/png" | "image/avif" | "image/webp";
    width: number; height: number;
  }>> {
    const attemptId = typeof attemptIdInput === "string" ? attemptIdInput : "";
    const handle = typeof imageHandleInput === "string" ? imageHandleInput : "";
    if (!ATTEMPT_PATTERN.test(attemptId) || !IMAGE_HANDLE_PATTERN.test(handle)) fail("IMAGE_HANDLE_UNAVAILABLE");
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(principalInput); }
    catch { fail("IMAGE_HANDLE_UNAVAILABLE"); }
    if (principal.connection_id !== attemptId || this.#closed) fail("IMAGE_HANDLE_UNAVAILABLE");
    this.#assertModel(this.#catalog);
    const operation = this.#beginOperation(attemptId, undefined);
    try {
      const linked = await this.#resolvePrincipal(attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, linked)) fail("IMAGE_HANDLE_UNAVAILABLE");
      const record = this.#records.get(handle);
      if (!record) fail("IMAGE_HANDLE_UNAVAILABLE");
      const now = this.#readNow();
      if (record.expiresAt <= now) {
        this.#removeHandle(handle);
        fail("IMAGE_HANDLE_EXPIRED");
      }
      if (record.attemptId !== attemptId || !sameGenerationPrincipal(record.principal, principal) ||
          record.modelId !== MODEL_ID || record.catalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
          record.profileSchemaHash !== PROFILE_SCHEMA_HASH || !isSafeUploadReferenceUrl(record.fileUrl)) {
        fail("IMAGE_HANDLE_UNAVAILABLE");
      }
      const current = await this.#resolvePrincipal(attemptId);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, current)) {
        this.#removeAttempt(attemptId);
        fail("IMAGE_HANDLE_UNAVAILABLE");
      }
      return Object.freeze({
        principal: record.principal,
        attempt_id: record.attemptId,
        scope: "tool_image_upscaler",
        model_id: MODEL_ID,
        file_url: record.fileUrl,
        mime_type: record.mimeType,
        width: record.width,
        height: record.height
      });
    } catch (error) {
      if (error instanceof OwnerClarityUpscaleUploadServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (operation.controller.signal.aborted) fail("INVALID_REQUEST");
      fail("IMAGE_HANDLE_UNAVAILABLE");
    } finally {
      this.#finishOperation(attemptId, operation);
    }
  }

  createOwnedImageBindingIssuer(): OwnerClarityUpscaleOwnedImageBindingIssuer {
    return createOwnerClarityUpscaleOwnedImageBindingIssuer((attemptId, principal, imageHandle) =>
      this.resolveOwnedImage(attemptId, principal, imageHandle));
  }

  invalidateAttempt(attemptId: string): void {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    this.#removeAttempt(attemptId);
    for (const controller of this.#pendingByAttempt.get(attemptId) ?? []) controller.abort();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#pendingByAttempt.values()) for (const controller of controllers) controller.abort();
    this.#records.clear();
    this.#handlesByAttempt.clear();
    this.#closing = Promise.allSettled([...this.#operations]).then(() => undefined);
    return this.#closing;
  }

  #assertModel(catalog: Pick<DiscoveryCatalogRepository, "getModel">): void {
    try {
      const model = catalog.getModel(MODEL_ID);
      if (model.id !== MODEL_ID || model.ai_name !== MODEL_ID || model.upstream_id !== MODEL_ID ||
          model.active !== true || !model.modalities.includes("image")) fail("MODEL_BINDING_MISMATCH");
    } catch (error) {
      if (error instanceof OwnerClarityUpscaleUploadServiceError) throw error;
      fail("MODEL_BINDING_MISMATCH");
    }
  }

  #assertOpen(): void {
    if (this.#closed) fail("SERVICE_CLOSED");
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

function snapshotBinding(value: AuthBinding): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotUploadInput(value: unknown): {
  attemptId: string; content_base64: string; filename: string; mime_type: string; signal?: AbortSignal;
} {
  const fields = exactRecord(value, ["attemptId", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.content_base64 !== "string" || fields.content_base64.length === 0 ||
      typeof fields.filename !== "string" || !SAFE_FILENAME.test(fields.filename) ||
      typeof fields.mime_type !== "string") fail("INVALID_REQUEST");
  if (!(SOURCE_MIME_TYPES as readonly string[]).includes(fields.mime_type)) fail("UNSUPPORTED_SOURCE_FORMAT");
  if (fields.content_base64.length > MAX_BASE64_CHARS || decodedBase64Length(fields.content_base64) > SOURCE_MAX_IMAGE_BYTES) {
    fail("UNSUPPORTED_SOURCE_SIZE");
  }
  const signal = fields.signal;
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
  return {
    attemptId: fields.attemptId,
    content_base64: fields.content_base64,
    filename: fields.filename,
    mime_type: fields.mime_type,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal })
  };
}

function decodedBase64Length(value: string): number {
  if (value.length % 4 !== 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function snapshotUploadClient(value: unknown): {
  readonly client: object;
  readonly method: SyntxChatHttpClient["uploadClarityUpscaleImageReference"];
} {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadClarityUpscaleImageReference");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    fail("INVALID_REQUEST");
  }
  return { client: value, method: descriptor.value as SyntxChatHttpClient["uploadClarityUpscaleImageReference"] };
}

function validateClarityImage(request: { content_base64: string; filename: string; mime_type: string }) {
  try {
    return validateOwnerClarityUpscaleInput({
      content_base64: request.content_base64,
      filename: request.filename,
      mime_type: request.mime_type
    });
  } catch (error) {
    if (error instanceof OwnerClarityUpscaleInputError) fail("INVALID_IMAGE_INPUT");
    fail("INVALID_IMAGE_INPUT");
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

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}

function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_REQUIRED" ||
    code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}

function fail(code: OwnerClarityUpscaleUploadErrorCode): never {
  throw new OwnerClarityUpscaleUploadServiceError(code);
}
