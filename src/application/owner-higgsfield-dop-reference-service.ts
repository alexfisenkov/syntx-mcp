import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { OwnerHiggsfieldDopExistingImageContext, OwnerHiggsfieldDopImageUploadContext, OwnerHiggsfieldDopUploadDestination } from "../adapter/syntx/owner-higgsfield-dop-upload-context.js";
import { readOwnerHiggsfieldDopExistingImageReferenceForClient, readOwnerHiggsfieldDopUploadReferenceForClient } from "../adapter/syntx/owner-higgsfield-dop-upload-context.js";
import {
  OWNER_HIGGSFIELD_DOP_IMAGE_POLICY,
  OwnerHiggsfieldDopImagePolicyError,
  validateOwnerHiggsfieldDopImageUpload,
  readValidatedOwnerHiggsfieldDopImageUpload,
  releaseValidatedOwnerHiggsfieldDopImageUpload,
  type OwnerHiggsfieldDopImageMimeType,
  type ValidatedOwnerHiggsfieldDopImageUpload
} from "./owner-higgsfield-dop-image-policy.js";
import { getOwnerHiggsfieldDopSourceProfile, isOwnerHiggsfieldDopModelId,
  type OwnerHiggsfieldDopModelId } from "./owner-higgsfield-dop-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^higgsfield_dop_reference_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerHiggsfieldDopImage") as unknown;
const NATIVE_IMPORT = Reflect.get(SyntxChatHttpClient.prototype, "importOwnerHiggsfieldDopImage") as unknown;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const PROFILE_SHA256 = getOwnerHiggsfieldDopSourceProfile().source_sha256;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

export interface OwnerHiggsfieldDopReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly uploadDestination: OwnerHiggsfieldDopUploadDestination;
  readonly now?: () => number;
}
export interface OwnerHiggsfieldDopReferenceUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly filename: string;
  readonly mime_type: OwnerHiggsfieldDopImageMimeType;
  readonly bytes: Uint8Array;
}
export interface OwnerHiggsfieldDopReferenceUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly media_type: "image";
  readonly mime_type: OwnerHiggsfieldDopImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN";
  readonly upload_authority: false;
  readonly generation_permit: false;
}
export interface OwnerHiggsfieldDopExistingAssetImportInput {
  readonly attemptId: string; readonly model_id: OwnerHiggsfieldDopModelId; readonly filename: string;
  readonly mime_type: OwnerHiggsfieldDopImageMimeType; readonly bytes: Uint8Array; readonly file_id: string; readonly destination: "uploaded";
}
export interface OwnerHiggsfieldDopExistingAssetImportReceipt {
  readonly status: "imported"; readonly reference_handle: string; readonly model_id: OwnerHiggsfieldDopModelId;
  readonly media_type: "image"; readonly mime_type: OwnerHiggsfieldDopImageMimeType; readonly size: number;
  readonly sha256: string; readonly width: number; readonly height: number; readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly provenance: "OWNED_EXISTING_ACCOUNT_ASSET"; readonly provider_acceptance: "UNPROVEN"; readonly generation_permit: false;
}
export interface OwnerHiggsfieldDopOwnedReference {
  readonly attempt_id: string;
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly reference: Readonly<{ reference_handle: string; media_type: "image"; mime_type: OwnerHiggsfieldDopImageMimeType;
    size: number; sha256: string; width: number; height: number }>;
  readonly generation_permit: false;
}
export type OwnerHiggsfieldDopReferenceServiceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" |
  "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "VALIDATION_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" |
  "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "SOURCE_FILE_UNAVAILABLE" | "SOURCE_ASSET_UNVERIFIED";
export class OwnerHiggsfieldDopReferenceServiceError extends Error {
  constructor(readonly code: OwnerHiggsfieldDopReferenceServiceErrorCode) {
    super("The owner Higgsfield DOP image reference is unavailable.");
    this.name = "OwnerHiggsfieldDopReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string; readonly attemptId: string; readonly modelId: OwnerHiggsfieldDopModelId;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient; readonly epoch: number;
  readonly expiresAt: number; readonly context: OwnerHiggsfieldDopImageUploadContext | OwnerHiggsfieldDopExistingImageContext;
  readonly destination: OwnerHiggsfieldDopUploadDestination; readonly provenance: "native_upload" | "existing_account_asset";
  readonly sourceFileId?: string;
  readonly mimeType: OwnerHiggsfieldDopImageMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number;
}
interface Pending { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void;
  readonly removeAbort: () => void; readonly epoch: number }
interface OwnedState { readonly service: OwnerHiggsfieldDopReferenceService; readonly record: RecordEntry;
  readonly attemptId: string; readonly modelId: OwnerHiggsfieldDopModelId; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly epoch: number; readonly expiresAt: number }
interface UploadSnapshot { readonly attemptId: string; readonly modelId: OwnerHiggsfieldDopModelId;
  readonly filename: string; readonly mimeType: OwnerHiggsfieldDopImageMimeType; readonly bytes: Buffer }
interface ExistingAssetSnapshot extends UploadSnapshot { readonly fileId: string }
interface ResolveSnapshot { readonly attemptId: string; readonly modelId: OwnerHiggsfieldDopModelId; readonly handle: string }
const OWNED = new WeakMap<object, OwnedState>();
const SERVICES = new WeakSet<object>();

/** Owner-bound, process-local image vault with sticky uncertainty after native upload invocation. */
export class OwnerHiggsfieldDopReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (id: string) => unknown;
  readonly #uploadDestination: OwnerHiggsfieldDopUploadDestination;
  readonly #now: () => number;
  readonly #records = new Map<string, RecordEntry>();
  readonly #handles = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<Pending>>();
  readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  readonly #all = new Set<Promise<void>>();
  #pendingCount = 0; #lastNow: number | undefined; #closed = false; #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerHiggsfieldDopReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "resolveClient", "uploadDestination"], ["now"]);
    if (!genuineLinks(fields.linkService) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.uploadDestination !== "uploaded" && fields.uploadDestination !== "hidden") ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        typeof NATIVE_UPLOAD !== "function" || typeof NATIVE_IMPORT !== "function" ||
        typeof readOwnerHiggsfieldDopUploadReferenceForClient !== "function" ||
        typeof readOwnerHiggsfieldDopExistingImageReferenceForClient !== "function") fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding); this.#links = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as (attemptId: string) => unknown;
    this.#uploadDestination = fields.uploadDestination as OwnerHiggsfieldDopUploadDestination;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    SERVICES.add(this); Object.freeze(this);
  }

  async uploadReference(input: OwnerHiggsfieldDopReferenceUploadInput | unknown, signalInput?: AbortSignal): Promise<OwnerHiggsfieldDopReferenceUploadReceipt> {
    this.#assertOpen(); const request = snapshotUpload(input);
    let operation: Pending;
    try { operation = this.#begin(request.attemptId, exactSignal(signalInput)); }
    catch (error) { request.bytes.fill(0); throw error; }
    let validated: Readonly<ValidatedOwnerHiggsfieldDopImageUpload> | undefined;
    let semantic: string | undefined, reserved = false, nativeInvoked = false, published = false;
    try {
      const principal = await this.#principal(request.attemptId, operation.controller.signal); this.#stopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const initialClient = clientSnapshot(this.#resolveClient(request.attemptId));
      try { validated = validateOwnerHiggsfieldDopImageUpload({ model_id: request.modelId, filename: request.filename,
        mime_type: request.mimeType, bytes: request.bytes }); }
      catch (error) { this.#stopped(operation); if (error instanceof OwnerHiggsfieldDopImagePolicyError) fail("VALIDATION_REJECTED"); fail("VALIDATION_REJECTED"); }
      this.#stopped(operation);
      const media = readValidatedOwnerHiggsfieldDopImageUpload(validated); if (!media) fail("VALIDATION_REJECTED");
      const metadata = Object.freeze({ model_id: media.model_id, mime_type: media.mime_type, size: media.size, sha256: media.sha256,
        width: media.width, height: media.height });
      media.bytes.fill(0);
      semantic = semanticKey(principal, metadata.model_id, metadata.sha256, metadata.mime_type, metadata.size, metadata.width, metadata.height);
      if (this.#unknownSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semantic)) fail("SERVICE_BUSY");
      this.#prune(this.#time());
      const existing = [...this.#records.values()].find(record => record.provenance === "native_upload" && record.attemptId === request.attemptId && record.client === initialClient.client &&
        record.destination === this.#uploadDestination && semanticKey(record.principal, record.modelId, record.sha256, record.mimeType,
          record.size, record.width, record.height) === semantic && record.expiresAt > this.#lastNow!);
      if (existing) return this.#receipt(existing, this.#time());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic); reserved = true;
      const before = await this.#principal(request.attemptId, operation.controller.signal); this.#stopped(operation);
      const client = clientSnapshot(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, before) || client.client !== initialClient.client) fail("PRINCIPAL_NOT_LINKED");
      const issued = this.#time(); if (issued > Number.MAX_SAFE_INTEGER - TTL) fail("SERVICE_CLOSED");
      nativeInvoked = true;
      let context: OwnerHiggsfieldDopImageUploadContext;
      try { context = await Reflect.apply(NATIVE_UPLOAD as Function, client.client,
        [{ media: validated, destination: this.#uploadDestination }, operation.controller.signal]) as OwnerHiggsfieldDopImageUploadContext; }
      catch { this.#unknownIfStopped(operation); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#unknownIfStopped(operation);
      const nativeReference = readOwnerHiggsfieldDopUploadReferenceForClient(client.client, context);
      if (!nativeReference || nativeReference.type !== "image" || !isSafeUploadReferenceUrl(nativeReference.url) ||
          !contextMatchesUpload(context, { ...metadata, model_id: request.modelId, destination: this.#uploadDestination })) fail("UPLOAD_OUTCOME_UNKNOWN");
      const after = await this.#principal(request.attemptId, operation.controller.signal); this.#unknownIfStopped(operation);
      if (!sameGenerationPrincipal(principal, after) || clientSnapshot(this.#resolveClient(request.attemptId)).client !== client.client) fail("UPLOAD_OUTCOME_UNKNOWN");
      const acknowledged = this.#time(), expiresAt = issued + TTL, epoch = operation.epoch;
      if (expiresAt - acknowledged < 1_000 || epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#invalidating.has(request.attemptId) ||
          this.#records.size + this.#unknownSemantics.size >= MAX_RECORDS || !this.#pendingSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const conflicting = [...this.#records.values()].filter(record => {
        const prior = recordReference(record, record.client);
        return record.principal.tenant_id === principal.tenant_id && record.principal.subject_id === principal.subject_id && prior?.url === nativeReference.url;
      });
      if (conflicting.some(record => record.sha256 !== metadata.sha256 || record.mimeType !== metadata.mime_type || record.size !== metadata.size ||
          record.width !== metadata.width || record.height !== metadata.height)) {
        for (const record of conflicting) {
          this.#unknownSemantics.add(semanticKey(record.principal, record.modelId, record.sha256, record.mimeType, record.size, record.width, record.height));
          this.#remove(record.handle);
        }
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const handle = `higgsfield_dop_reference_${randomUUID()}`;
      const record: RecordEntry = Object.freeze({ handle, attemptId: request.attemptId, modelId: request.modelId, principal,
        client: client.client, epoch, expiresAt, context, destination: this.#uploadDestination, mimeType: metadata.mime_type,
        size: metadata.size, sha256: metadata.sha256, width: metadata.width, height: metadata.height, provenance: "native_upload" });
      this.#records.set(handle, record);
      const handles = this.#handles.get(request.attemptId) ?? new Set<string>(); handles.add(handle); this.#handles.set(request.attemptId, handles);
      published = true;
      return this.#receipt(record, acknowledged);
    } catch (error) {
      if (error instanceof OwnerHiggsfieldDopReferenceServiceError) {
        if (nativeInvoked && !published && error.code !== "UPLOAD_OUTCOME_UNKNOWN") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) { if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN"); fail("PRINCIPAL_NOT_LINKED"); }
      if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("VALIDATION_REJECTED");
    } finally {
      if (semantic && reserved) { if (nativeInvoked && !published) this.#unknownSemantics.add(semantic); this.#pendingSemantics.delete(semantic); }
      if (validated) releaseValidatedOwnerHiggsfieldDopImageUpload(validated);
      request.bytes.fill(0); this.#finish(request.attemptId, operation);
    }
    return fail("VALIDATION_REJECTED");
  }

  /** Imports one explicitly selected owned uploaded asset by opaque account file id; never falls back to upload. */
  async importExistingReference(input: OwnerHiggsfieldDopExistingAssetImportInput | unknown,
    signalInput?: AbortSignal): Promise<OwnerHiggsfieldDopExistingAssetImportReceipt> {
    this.#assertOpen(); const request = snapshotExistingAsset(input);
    let operation: Pending;
    try { operation = this.#begin(request.attemptId, exactSignal(signalInput)); }
    catch (error) { request.bytes.fill(0); throw error; }
    let validated: Readonly<ValidatedOwnerHiggsfieldDopImageUpload> | undefined, semantic: string | undefined, reserved = false;
    try {
      const principal = await this.#principal(request.attemptId, operation.controller.signal); this.#stopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const initialClient = importClientSnapshot(this.#resolveClient(request.attemptId));
      try { validated = validateOwnerHiggsfieldDopImageUpload({ model_id: request.modelId, filename: request.filename,
        mime_type: request.mimeType, bytes: request.bytes }); }
      catch { this.#stopped(operation); fail("VALIDATION_REJECTED"); }
      this.#stopped(operation);
      const media = readValidatedOwnerHiggsfieldDopImageUpload(validated); if (!media) fail("VALIDATION_REJECTED");
      const metadata = Object.freeze({ model_id: media.model_id, destination: "uploaded" as const, mime_type: media.mime_type,
        size: media.size, sha256: media.sha256, width: media.width, height: media.height });
      media.bytes.fill(0);
      semantic = schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id },
        model_id: request.modelId, file_id: request.fileId, sha256: metadata.sha256, mime_type: metadata.mime_type,
        size: metadata.size, width: metadata.width, height: metadata.height });
      if (this.#pendingSemantics.has(semantic)) fail("SERVICE_BUSY");
      this.#prune(this.#time());
      const existing = [...this.#records.values()].find(record => record.provenance === "existing_account_asset" &&
        record.attemptId === request.attemptId && record.modelId === request.modelId && record.sourceFileId === request.fileId &&
        record.client === initialClient.client && record.sha256 === metadata.sha256 && record.expiresAt > this.#lastNow!);
      if (existing) return this.#importReceipt(existing, this.#time());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic); reserved = true;
      const before = await this.#principal(request.attemptId, operation.controller.signal); this.#stopped(operation);
      const client = importClientSnapshot(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, before) || client.client !== initialClient.client) fail("PRINCIPAL_NOT_LINKED");
      const issued = this.#time(); if (issued > Number.MAX_SAFE_INTEGER - TTL) fail("SERVICE_CLOSED");
      let context: OwnerHiggsfieldDopExistingImageContext;
      try {
        context = await Reflect.apply(NATIVE_IMPORT as Function, client.client,
          [{ media: validated, file_id: request.fileId, destination: "uploaded" }, operation.controller.signal]) as OwnerHiggsfieldDopExistingImageContext;
      } catch (error) {
        this.#stopped(operation);
        if (error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR") fail("SOURCE_ASSET_UNVERIFIED");
        fail("SOURCE_FILE_UNAVAILABLE");
      }
      this.#stopped(operation);
      const nativeReference = readOwnerHiggsfieldDopExistingImageReferenceForClient(client.client, context, request.fileId);
      if (!nativeReference || nativeReference.type !== "image" || !isSafeUploadReferenceUrl(nativeReference.url) ||
          !contextMatchesExistingImport(context, { ...metadata, file_id: request.fileId })) fail("SOURCE_ASSET_UNVERIFIED");
      const after = await this.#principal(request.attemptId, operation.controller.signal); this.#stopped(operation);
      if (!sameGenerationPrincipal(principal, after) || importClientSnapshot(this.#resolveClient(request.attemptId)).client !== client.client) fail("PRINCIPAL_NOT_LINKED");
      const acknowledged = this.#time(), expiresAt = issued + TTL, epoch = operation.epoch;
      if (expiresAt - acknowledged < 1_000 || epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#invalidating.has(request.attemptId) ||
          this.#records.size + this.#unknownSemantics.size >= MAX_RECORDS) fail("SOURCE_ASSET_UNVERIFIED");
      const conflicting = [...this.#records.values()].filter(record => {
        const prior = recordReference(record, client.client);
        return record.principal.tenant_id === principal.tenant_id && record.principal.subject_id === principal.subject_id && prior?.url === nativeReference.url;
      });
      if (conflicting.some(record => record.sha256 !== metadata.sha256 || record.mimeType !== metadata.mime_type || record.size !== metadata.size ||
          record.width !== metadata.width || record.height !== metadata.height)) fail("SOURCE_ASSET_UNVERIFIED");
      const handle = `higgsfield_dop_reference_${randomUUID()}`;
      const record: RecordEntry = Object.freeze({ handle, attemptId: request.attemptId, modelId: request.modelId, principal,
        client: client.client, epoch, expiresAt, context, destination: "uploaded", mimeType: metadata.mime_type,
        size: metadata.size, sha256: metadata.sha256, width: metadata.width, height: metadata.height,
        provenance: "existing_account_asset", sourceFileId: request.fileId });
      this.#records.set(handle, record);
      const handles = this.#handles.get(request.attemptId) ?? new Set<string>(); handles.add(handle); this.#handles.set(request.attemptId, handles);
      return this.#importReceipt(record, acknowledged);
    } catch (error) {
      if (error instanceof OwnerHiggsfieldDopReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      return fail("SOURCE_ASSET_UNVERIFIED");
    } finally {
      if (semantic && reserved) this.#pendingSemantics.delete(semantic);
      if (validated) releaseValidatedOwnerHiggsfieldDopImageUpload(validated);
      request.bytes.fill(0);
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveReference(input: unknown, signalInput?: AbortSignal): Promise<OwnerHiggsfieldDopOwnedReference> {
    this.#assertOpen(); const request = snapshotResolve(input), operation = this.#begin(request.attemptId, exactSignal(signalInput));
    try {
      const principal = await this.#principal(request.attemptId, operation.controller.signal); this.#stopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = clientSnapshot(this.#resolveClient(request.attemptId)).client;
      const record = this.#records.get(request.handle), now = this.#time();
      if (!record || record.attemptId !== request.attemptId || record.modelId !== request.modelId || !sameGenerationPrincipal(record.principal, principal)) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#remove(record.handle); fail("REFERENCE_EXPIRED"); }
      const nativeReference = recordReference(record, client);
      if (record.epoch !== operation.epoch || record.client !== client || !contextMatchesRecord(record, nativeReference) || !nativeReference) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#principal(request.attemptId, operation.controller.signal); this.#stopped(operation);
      if (!sameGenerationPrincipal(latest, principal) || clientSnapshot(this.#resolveClient(request.attemptId)).client !== client) fail("PRINCIPAL_NOT_LINKED");
      const acknowledged = this.#time();
      if (record.expiresAt <= acknowledged || this.#records.get(record.handle) !== record || record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || record.client !== client) fail("REFERENCE_EXPIRED");
      const owned: OwnerHiggsfieldDopOwnedReference = Object.freeze({ attempt_id: request.attemptId, model_id: request.modelId,
        principal, profile_sha256: PROFILE_SHA256, expires_at: record.expiresAt, epoch: operation.epoch,
        reference: Object.freeze({ reference_handle: record.handle, media_type: "image", mime_type: record.mimeType,
          size: record.size, sha256: record.sha256, width: record.width, height: record.height }), generation_permit: false });
      OWNED.set(owned, Object.freeze({ service: this, record, attemptId: request.attemptId, modelId: request.modelId,
        principal, client, epoch: operation.epoch, expiresAt: record.expiresAt }));
      return owned;
    } catch (error) {
      if (error instanceof OwnerHiggsfieldDopReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedReference(value: unknown): value is OwnerHiggsfieldDopOwnedReference {
    try {
      this.#assertOpen();
      if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const state = OWNED.get(value), remembered = state ? this.#principalByAttempt.get(state.attemptId) : undefined;
      if (!state || state.service !== this || this.#time() >= state.expiresAt || state.epoch !== (this.#epochs.get(state.attemptId) ?? 0) ||
          this.#invalidating.has(state.attemptId) || !remembered || !sameGenerationPrincipal(remembered, state.principal) || !exactOwned(value, state)) return false;
      const record = state.record, nativeReference = recordReference(record, state.client);
      return this.#records.get(record.handle) === record && record.expiresAt > this.#lastNow! && record.epoch === state.epoch &&
        sameGenerationPrincipal(record.principal, state.principal) && clientSnapshot(this.#resolveClient(record.attemptId)).client === state.client &&
        contextMatchesRecord(record, nativeReference);
    } catch { return false; }
  }

  withCapturedReference<T>(value: unknown, request: unknown,
    consume: (client: SyntxChatHttpClient, reference: Readonly<{ reference_handle: string; type: "image"; url: string;
      sha256: string; width: number; height: number }>) => T): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const modelId = snapshotModelRequest(request), state = value && typeof value === "object" && !types.isProxy(value) ? OWNED.get(value) : undefined;
    if (!state || state.service !== this || state.modelId !== modelId || !this.isOwnedReference(value)) fail("REFERENCE_UNAVAILABLE");
    const record = state.record, captured = recordReference(record, state.client);
    if (!contextMatchesRecord(record, captured) || !captured || clientSnapshot(this.#resolveClient(record.attemptId)).client !== state.client) fail("REFERENCE_UNAVAILABLE");
    return consume(state.client, Object.freeze({ reference_handle: record.handle, type: "image", url: captured.url,
      sha256: record.sha256, width: record.width, height: record.height }));
  }

  invalidateAttempt(value: unknown): Promise<void> { return typeof value === "string" && ATTEMPT.test(value) ? this.#invalidate(value) : Promise.resolve(); }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true; const invalidations = [...this.#active()].map(attempt => this.#invalidate(attempt)), pending = [...this.#all];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#records.clear(); this.#handles.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
      this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear(); this.#invalidations.clear(); this.#all.clear();
    });
    return this.#closing;
  }

  #receipt(record: RecordEntry, now: number): OwnerHiggsfieldDopReferenceUploadReceipt {
    if (record.provenance !== "native_upload") fail("REFERENCE_UNAVAILABLE");
    return Object.freeze({ status: "uploaded", reference_handle: record.handle, model_id: record.modelId, media_type: "image",
      mime_type: record.mimeType, size: record.size, sha256: record.sha256, width: record.width, height: record.height,
      expires_in_seconds: Math.max(0, Math.floor((record.expiresAt - now) / 1000)),
      metadata_confidence: OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.metadata_confidence,
      size_limit_confidence: OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.local_max_bytes_policy, provider_acceptance: "UNPROVEN",
      upload_authority: false, generation_permit: false });
  }
  #importReceipt(record: RecordEntry, now: number): OwnerHiggsfieldDopExistingAssetImportReceipt {
    if (record.provenance !== "existing_account_asset") fail("SOURCE_ASSET_UNVERIFIED");
    return Object.freeze({ status: "imported", reference_handle: record.handle, model_id: record.modelId, media_type: "image",
      mime_type: record.mimeType, size: record.size, sha256: record.sha256, width: record.width, height: record.height,
      expires_in_seconds: Math.max(0, Math.floor((record.expiresAt - now) / 1000)),
      metadata_confidence: OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.metadata_confidence, provenance: "OWNED_EXISTING_ACCOUNT_ASSET",
      provider_acceptance: "UNPROVEN", generation_permit: false });
  }
  #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerHiggsfieldDopReferenceServiceError("REQUEST_ABORTED"));
    const promise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
    if (!signal) return promise;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { const onAbort = () => reject(new OwnerHiggsfieldDopReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); } });
    return Promise.race([promise, aborted]).finally(remove);
  }
  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId); if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal); return true;
  }
  #begin(attemptId: string, parent?: AbortSignal): Pending {
    this.#assertOpen(); if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED"); this.#prune(this.#time());
    if (!this.#active().has(attemptId) && this.#active().size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const set = this.#pendingByAttempt.get(attemptId) ?? new Set<Pending>();
    const operation: Pending = { controller, done, finish, removeAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attemptId) ?? 0 };
    set.add(operation); this.#pendingByAttempt.set(attemptId, set); this.#all.add(done); this.#pendingCount++; return operation;
  }
  #finish(attemptId: string, operation: Pending): void {
    operation.removeAbort(); const set = this.#pendingByAttempt.get(attemptId); set?.delete(operation); if (!set?.size) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount--; operation.finish(); this.#all.delete(operation.done); this.#release(attemptId);
  }
  #stopped(operation: Pending): void { this.#assertOpen(); if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #unknownIfStopped(operation: Pending): void { if (this.#closed || operation.controller.signal.aborted) fail("UPLOAD_OUTCOME_UNKNOWN"); }
  #active(): Set<string> { return new Set([...this.#handles.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]); }
  #invalidate(attemptId: string): Promise<void> {
    const prior = this.#invalidations.get(attemptId); if (prior) return prior;
    this.#invalidating.add(attemptId); this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttempt(attemptId); this.#principalByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    const done = Promise.allSettled([...(this.#pendingByAttempt.get(attemptId) ?? [])].map(operation => operation.done)).then(() => {
      this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#release(attemptId);
    });
    this.#invalidations.set(attemptId, done); return done;
  }
  #removeAttempt(attemptId: string): void { for (const handle of this.#handles.get(attemptId) ?? []) this.#records.delete(handle); this.#handles.delete(attemptId); }
  #remove(handle: string): void {
    const record = this.#records.get(handle); if (!record) return; this.#records.delete(handle);
    const handles = this.#handles.get(record.attemptId); handles?.delete(handle); if (!handles?.size) this.#handles.delete(record.attemptId);
    this.#release(record.attemptId);
  }
  #prune(now: number): void { for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#remove(handle); }
  #release(attemptId: string): void { if (this.#handles.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principalByAttempt.delete(attemptId); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #time(): number {
    let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number;
  }
}
Object.freeze(OwnerHiggsfieldDopReferenceService.prototype);

export function isOwnerHiggsfieldDopReferenceService(value: unknown): value is OwnerHiggsfieldDopReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerHiggsfieldDopReferenceService.prototype && Object.isFrozen(value);
}

function snapshotUpload(value: unknown): UploadSnapshot {
  const fields = exactRecord(value, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !isOwnerHiggsfieldDopModelId(fields.model_id) ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string" || !supportedBytes(fields.bytes)) fail("INVALID_REQUEST");
  const length = safeByteLength(fields.bytes), maximum = OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.local_max_bytes;
  if (length < 1 || length > maximum) fail("INVALID_REQUEST");
  const bytes = copyBytes(fields.bytes);
  try { return Object.freeze({ attemptId: fields.attemptId, modelId: fields.model_id, filename: fields.filename,
    mimeType: fields.mime_type as OwnerHiggsfieldDopImageMimeType, bytes }); }
  catch (error) { bytes.fill(0); throw error; }
}
function snapshotExistingAsset(value: unknown): ExistingAssetSnapshot {
  const fields = exactRecord(value, ["attemptId", "model_id", "filename", "mime_type", "bytes", "file_id", "destination"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !isOwnerHiggsfieldDopModelId(fields.model_id) ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string" || !supportedBytes(fields.bytes) ||
      typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id) || fields.destination !== "uploaded") fail("INVALID_REQUEST");
  const length = safeByteLength(fields.bytes), maximum = OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.local_max_bytes;
  if (length < 1 || length > maximum) fail("INVALID_REQUEST");
  const bytes = copyBytes(fields.bytes);
  try { return Object.freeze({ attemptId: fields.attemptId, modelId: fields.model_id, filename: fields.filename,
    mimeType: fields.mime_type as OwnerHiggsfieldDopImageMimeType, bytes, fileId: fields.file_id }); }
  catch (error) { bytes.fill(0); throw error; }
}
function snapshotResolve(value: unknown): ResolveSnapshot {
  const fields = exactRecord(value, ["attemptId", "model_id", "reference_handle"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || !isOwnerHiggsfieldDopModelId(fields.model_id) ||
      typeof fields.reference_handle !== "string" || !exactMatch(HANDLE, fields.reference_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, modelId: fields.model_id, handle: fields.reference_handle });
}
function snapshotModelRequest(value: unknown): OwnerHiggsfieldDopModelId {
  const fields = exactRecord(value, ["model_id"]); if (!isOwnerHiggsfieldDopModelId(fields.model_id)) fail("INVALID_REQUEST"); return fields.model_id;
}
function exactOwned(value: object, state: OwnedState): boolean {
  try {
    const fields = exactRecord(value, ["attempt_id", "model_id", "principal", "profile_sha256", "expires_at", "epoch", "reference", "generation_permit"]);
    const record = state.record;
    if (fields.attempt_id !== state.attemptId || fields.model_id !== state.modelId || fields.principal !== state.principal ||
        fields.profile_sha256 !== PROFILE_SHA256 || fields.expires_at !== state.expiresAt || fields.epoch !== state.epoch || fields.generation_permit !== false ||
        !fields.reference || typeof fields.reference !== "object" || types.isProxy(fields.reference) || !Object.isFrozen(fields.reference)) return false;
    const reference = exactRecord(fields.reference, ["reference_handle", "media_type", "mime_type", "size", "sha256", "width", "height"]);
    return reference.reference_handle === record.handle && reference.media_type === "image" && reference.mime_type === record.mimeType &&
      reference.size === record.size && reference.sha256 === record.sha256 && reference.width === record.width && reference.height === record.height;
  } catch { return false; }
}
function contextMatchesRecord(record: RecordEntry, reference: Readonly<{ type: "image"; url: string }> | null): boolean {
  const context = record.context;
  const provenanceMatches = record.provenance === "native_upload"
    ? context.status === "uploaded" && "owner_upload_binding" in context && context.owner_upload_binding === "SAME_CLIENT_NATIVE_UPLOAD"
    : context.status === "imported" && "provenance" in context && context.provenance === "OWNED_EXISTING_ACCOUNT_ASSET" &&
      "owner_asset_binding" in context && context.owner_asset_binding === "SAME_CLIENT_ACCOUNT_FILE_IMPORT" && !!record.sourceFileId;
  return !!reference && reference.type === "image" && isSafeUploadReferenceUrl(reference.url) && provenanceMatches &&
    context.model_id === record.modelId && context.destination === record.destination && context.media_type === "image" &&
    context.mime_type === record.mimeType && context.size === record.size && context.sha256 === record.sha256 &&
    context.width === record.width && context.height === record.height &&
    context.metadata_confidence === OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.metadata_confidence && context.provider_acceptance === "UNPROVEN" &&
    context.generation_permit === false;
}
function contextMatchesUpload(context: OwnerHiggsfieldDopImageUploadContext, expected: Readonly<{
  model_id: OwnerHiggsfieldDopModelId; destination: OwnerHiggsfieldDopUploadDestination; mime_type: OwnerHiggsfieldDopImageMimeType;
  size: number; sha256: string; width: number; height: number
}>): boolean {
  return context.status === "uploaded" && context.model_id === expected.model_id && context.destination === expected.destination &&
    context.media_type === "image" && context.mime_type === expected.mime_type && context.size === expected.size &&
    context.sha256 === expected.sha256 && context.width === expected.width && context.height === expected.height &&
    context.provider_acceptance === "UNPROVEN" && context.generation_permit === false && context.owner_upload_binding === "SAME_CLIENT_NATIVE_UPLOAD";
}
function clientSnapshot(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    const method = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerHiggsfieldDopImage");
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadOwnerHiggsfieldDopImage") || method !== NATIVE_UPLOAD || Reflect.get(value, "uploadOwnerHiggsfieldDopImage") !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch (error) { if (error instanceof OwnerHiggsfieldDopReferenceServiceError) throw error; fail("INVALID_REQUEST"); }
}
function importClientSnapshot(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    const uploadMethod = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerHiggsfieldDopImage");
    const importMethod = Reflect.get(SyntxChatHttpClient.prototype, "importOwnerHiggsfieldDopImage");
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadOwnerHiggsfieldDopImage") || Object.hasOwn(value, "importOwnerHiggsfieldDopImage") ||
        uploadMethod !== NATIVE_UPLOAD || importMethod !== NATIVE_IMPORT || Reflect.get(value, "uploadOwnerHiggsfieldDopImage") !== NATIVE_UPLOAD ||
        Reflect.get(value, "importOwnerHiggsfieldDopImage") !== NATIVE_IMPORT) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch (error) { if (error instanceof OwnerHiggsfieldDopReferenceServiceError) throw error; fail("INVALID_REQUEST"); }
}
function contextMatchesExistingImport(context: OwnerHiggsfieldDopExistingImageContext, expected: Readonly<{
  model_id: OwnerHiggsfieldDopModelId; destination: "uploaded"; mime_type: OwnerHiggsfieldDopImageMimeType;
  size: number; sha256: string; width: number; height: number; file_id: string
}>): boolean {
  return context.status === "imported" && context.model_id === expected.model_id && context.destination === "uploaded" &&
    context.media_type === "image" && context.mime_type === expected.mime_type && context.size === expected.size &&
    context.sha256 === expected.sha256 && context.width === expected.width && context.height === expected.height &&
    context.metadata_confidence === OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.metadata_confidence &&
    context.provenance === "OWNED_EXISTING_ACCOUNT_ASSET" && context.provider_acceptance === "UNPROVEN" &&
    context.generation_permit === false && context.owner_asset_binding === "SAME_CLIENT_ACCOUNT_FILE_IMPORT" &&
    expected.file_id.length > 0;
}
function recordReference(record: RecordEntry, client: unknown): Readonly<{ type: "image"; url: string }> | null {
  return record.provenance === "native_upload"
    ? readOwnerHiggsfieldDopUploadReferenceForClient(client, record.context)
    : record.sourceFileId ? readOwnerHiggsfieldDopExistingImageReferenceForClient(client, record.context, record.sourceFileId) : null;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function genuineLinks(value: unknown): value is PerUserLinkService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
      PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
  return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_STATUS;
}
function exactSignal(value: AbortSignal | undefined): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof AbortSignal) || Object.getPrototypeOf(value) !== AbortSignal.prototype) fail("INVALID_REQUEST");
  return value;
}
function supportedBytes(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      ["buffer", "byteLength", "byteOffset", "length"].some(key => Object.hasOwn(value, key))) return false;
  try {
    if (!TYPED_ARRAY_BUFFER_GETTER || !TYPED_ARRAY_OFFSET_GETTER || !TYPED_ARRAY_LENGTH_GETTER || !ARRAY_BUFFER_LENGTH_GETTER) return false;
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as unknown;
    const offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number;
    const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
    const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, buffer, []) as number;
    return !!buffer && typeof buffer === "object" && !types.isProxy(buffer) && Object.getPrototypeOf(buffer) === ArrayBuffer.prototype &&
      !Object.hasOwn(buffer, "byteLength") && Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0 && offset + length <= backingLength;
  } catch { return false; }
}
function safeByteLength(value: Uint8Array): number { try { return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER!, value, []) as number; } catch { fail("INVALID_REQUEST"); } }
function copyBytes(value: Uint8Array): Buffer {
  try { return Buffer.from(new Uint8Array(Reflect.apply(TYPED_ARRAY_BUFFER_GETTER!, value, []) as ArrayBuffer,
    Reflect.apply(TYPED_ARRAY_OFFSET_GETTER!, value, []) as number, safeByteLength(value))); } catch { fail("INVALID_REQUEST"); }
}
function semanticKey(principal: Readonly<GenerationPrincipalRef>, modelId: OwnerHiggsfieldDopModelId, sha256: string,
  mimeType: string, size: number, width: number, height: number): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, profile_sha256: PROFILE_SHA256,
    model_id: modelId, sha256, mime_type: mimeType, size, width, height });
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some(key => !Object.hasOwn(descriptors, key)) ||
      keys.some(key => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) output[key] = descriptors[key]!.value;
  return output;
}
function readClock(value: unknown): () => number {
  return () => { let result: unknown; try { result = Reflect.apply(value as Function, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED"); return result as number; };
}
function exactMatch(regex: RegExp, value: string): boolean { return regex.exec(value)?.[0] === value; }
function fail(code: OwnerHiggsfieldDopReferenceServiceErrorCode): never { throw new OwnerHiggsfieldDopReferenceServiceError(code); }
