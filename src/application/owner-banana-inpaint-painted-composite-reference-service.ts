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
import { schemaHash } from "../domain/generation-contract.js";
import type { MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  getOwnerBananaInpaintOriginalUploadSourceProfile,
  type OwnerBananaInpaintOriginalUploadCatalogPort,
  type OwnerBananaInpaintOriginalUploadSourceProfile,
  type OwnerBananaInpaintOriginalUploadVariant
} from "./owner-banana-inpaint-original-upload-source-profile.js";
import {
  OwnerBananaInpaintOriginalReferenceService,
  OwnerBananaInpaintOriginalReferenceServiceError,
  type OwnerBananaInpaintOriginalPrivateResolution
} from "./owner-banana-inpaint-original-reference-service.js";
import {
  getOwnerBananaInpaintPaintedCompositeSourceProfile,
  type OwnerBananaInpaintPaintedCompositeSourceProfile,
  type OwnerBananaInpaintPaintedCompositeVariant
} from "./owner-banana-inpaint-painted-composite-source-profile.js";
import {
  OwnerBananaInpaintPaintedCompositeInputError,
  validateOwnerBananaInpaintPaintedCompositeInput,
  type ValidatedOwnerBananaInpaintPaintedComposite
} from "./owner-banana-inpaint-painted-composite-input-validator.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL_HANDLE_PATTERN = /^banana_inpaint_original_[0-9a-f-]{36}$/u;
const PAINTED_HANDLE_PATTERN = /^banana_inpaint_painted_[0-9a-f-]{36}$/u;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const ORIGINAL_RESOLVE_METHOD = OwnerBananaInpaintOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_INVALIDATE_METHOD = OwnerBananaInpaintOriginalReferenceService.prototype.invalidateAttempt;
const ORIGINAL_CLOSE_METHOD = OwnerBananaInpaintOriginalReferenceService.prototype.close;
const NATIVE_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadBananaInpaintPaintedComposite;

export interface OwnerBananaInpaintPaintedCompositeReferenceServiceOptions {
  readonly originalReferenceService: OwnerBananaInpaintOriginalReferenceService;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerBananaInpaintOriginalUploadCatalogPort;
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory: MaplessSettingsInventory;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerBananaInpaintPaintedCompositeUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerBananaInpaintPaintedCompositeVariant;
  readonly original_handle: string;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: "image/png";
  readonly signal?: AbortSignal;
}

export interface OwnerBananaInpaintPaintedCompositeUploadReceipt {
  readonly status: "uploaded";
  readonly painted_handle: string;
  readonly original_handle: string;
  readonly variant: OwnerBananaInpaintPaintedCompositeVariant;
  readonly mime_type: "image/png";
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly geometry_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
}

export interface OwnerBananaInpaintPaintedCompositeResolverContext {
  readonly attempt_id: string;
  readonly variant: OwnerBananaInpaintPaintedCompositeVariant;
  readonly original_handle: string;
  readonly painted_handle: string;
}

export interface OwnerBananaInpaintPaintedCompositePrivateResolution {
  readonly role: "painted_composite";
  readonly wire_type: "mask";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerBananaInpaintPaintedCompositeVariant;
  readonly form_id: "banana-inpaint";
  readonly source_role: "painted_composite";
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly profile_schema_hash: string;
  readonly original_profile_schema_hash: string;
  readonly original_handle: string;
  readonly painted_handle: string;
  readonly original_sha256: `sha256:${string}`;
  readonly painted_sha256: `sha256:${string}`;
  readonly original_width: number;
  readonly original_height: number;
  readonly width: number;
  readonly height: number;
  readonly file_url: string;
  readonly file_id?: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly original_epoch: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly generation_permit: false;
}

export type OwnerBananaInpaintPaintedCompositeReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "REQUEST_ABORTED" | "ORIGINAL_REFERENCE_UNAVAILABLE" | "ORIGINAL_REFERENCE_EXPIRED"
  | "PAINTED_REFERENCE_UNAVAILABLE" | "PAINTED_REFERENCE_EXPIRED" | "GEOMETRY_MISMATCH"
  | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerBananaInpaintPaintedCompositeReferenceServiceError extends Error {
  constructor(readonly code: OwnerBananaInpaintPaintedCompositeReferenceServiceErrorCode) {
    super("The Banana Inpaint painted-composite reference is unavailable.");
    this.name = "OwnerBananaInpaintPaintedCompositeReferenceServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerBananaInpaintPaintedCompositeVariant;
  readonly publicCatalogVersion: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settingsInventoryVersion: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly profileSchemaHash: string;
  readonly originalProfileSchemaHash: string;
  readonly originalHandle: string;
  readonly originalSha256: `sha256:${string}`;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly originalExpiresAt: number;
  readonly originalEpoch: number;
  readonly paintedSha256: `sha256:${string}`;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly fileUrl: string;
  readonly fileId?: string;
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

/** Process-local paired composite handles; a source role is not provider or generation authorization. */
export class OwnerBananaInpaintPaintedCompositeReferenceService {
  readonly #original: OwnerBananaInpaintOriginalReferenceService;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerBananaInpaintOriginalUploadCatalogPort;
  readonly #publicCatalogVersion: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly #settingsInventory: MaplessSettingsInventory;
  readonly #settingsInventoryVersion: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly #resolveClient: OwnerBananaInpaintPaintedCompositeReferenceServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #originalProfiles = new Map<OwnerBananaInpaintOriginalUploadVariant, Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>>();
  readonly #profiles = new Map<OwnerBananaInpaintPaintedCompositeVariant, Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile>>();
  readonly #records = new Map<string, PrivateRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #epochs = new Map<string, number>();
  readonly #unknownSemanticHolds = new Set<string>();
  readonly #pendingSemantic = new Map<string, symbol>();
  readonly #invalidatingAttempts = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #lastObservedNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerBananaInpaintPaintedCompositeReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["originalReferenceService", "binding", "linkService", "catalog", "public_catalog_version",
      "settings_inventory", "settings_inventory_version", "resolveClient"], ["now"]);
    if (fields.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
        fields.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
        !isObject(fields.linkService) || !isObject(fields.catalog) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    const original = fields.originalReferenceService;
    if (!original || types.isProxy(original) || Object.getPrototypeOf(original) !== OwnerBananaInpaintOriginalReferenceService.prototype ||
        Object.hasOwn(original, "resolveOriginal") || Object.hasOwn(original, "invalidateAttempt") || Object.hasOwn(original, "close")) {
      fail("PROFILE_BINDING_MISMATCH");
    }
    for (const [name, method] of [["resolveOriginal", ORIGINAL_RESOLVE_METHOD], ["invalidateAttempt", ORIGINAL_INVALIDATE_METHOD], ["close", ORIGINAL_CLOSE_METHOD]] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(OwnerBananaInpaintOriginalReferenceService.prototype, name);
      if (!descriptor || !("value" in descriptor) || descriptor.value !== method || typeof method !== "function") fail("PROFILE_BINDING_MISMATCH");
    }
    this.#original = original as OwnerBananaInpaintOriginalReferenceService;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerBananaInpaintOriginalUploadCatalogPort;
    this.#publicCatalogVersion = OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
    this.#settingsInventory = fields.settings_inventory as MaplessSettingsInventory;
    this.#settingsInventoryVersion = OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
    this.#resolveClient = fields.resolveClient as OwnerBananaInpaintPaintedCompositeReferenceServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const variant of OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS) {
        const originalProfile = getOwnerBananaInpaintOriginalUploadSourceProfile(
          variant, this.#catalog, this.#publicCatalogVersion, this.#settingsInventory, this.#settingsInventoryVersion);
        this.#originalProfiles.set(variant, originalProfile);
        this.#profiles.set(variant, getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, originalProfile));
      }
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async uploadPaintedComposite(input: OwnerBananaInpaintPaintedCompositeUploadInput | unknown): Promise<OwnerBananaInpaintPaintedCompositeUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const profile = this.#assertProfile(request.variant);
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerBananaInpaintPaintedComposite | undefined;
    let nativeBytes: Buffer | undefined;
    let started = false;
    let unknownOutcome = false;
    let semanticKey: string | undefined;
    try {
      this.#throwIfClosedOrAborted(operation.controller);
      const original = await this.#resolveOriginal(request.attemptId, request.variant, request.original_handle, operation.controller.signal);
      this.#assertCurrentOriginal(operation, request.attemptId, original);
      validated = validateOwnerBananaInpaintPaintedCompositeInput({ content_base64: request.content_base64, filename: request.filename,
        mime_type: request.mime_type, original_width: original.width, original_height: original.height });
      if (validated.width !== original.width || validated.height !== original.height) fail("GEOMETRY_MISMATCH");
      this.#assertProfile(request.variant);
      const principal = original.principal;
      const key = semanticUploadKey(principal, request.variant, original.sha256, validated.sha256, profile.profile_schema_hash);
      semanticKey = key;
      if (this.#unknownSemanticHolds.has(key)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantic.has(key)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemanticHolds.size + this.#pendingSemantic.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      const reservation = Symbol("painted-composite-upload");
      this.#pendingSemantic.set(key, reservation);
      const native = snapshotNativeClient(this.#resolveClient(request.attemptId));
      nativeBytes = Buffer.from(validated.bytes);
      this.#throwIfClosedOrAborted(operation.controller);
      this.#assertCurrentOriginal(operation, request.attemptId,
        await this.#resolveOriginal(request.attemptId, request.variant, request.original_handle, operation.controller.signal));
      if (this.#pendingSemantic.get(key) !== reservation) fail("UPLOAD_OUTCOME_UNKNOWN");
      started = true;
      const rawReceipt = await Reflect.apply(native.method, native.client, [Object.freeze({ variant: request.variant,
        bytes: nativeBytes, filename: validated.filename, mime_type: validated.mime_type }), operation.controller.signal]);
      this.#throwIfClosedOrAborted(operation.controller);
      if ((this.#epochs.get(request.attemptId) ?? 0) !== operation.epoch) fail("REQUEST_ABORTED");
      const privateReference = parseUploadReference(rawReceipt);
      const currentOriginal = await this.#resolveOriginal(request.attemptId, request.variant, request.original_handle, operation.controller.signal);
      this.#assertCurrentOriginal(operation, request.attemptId, currentOriginal);
      const currentProfile = this.#assertProfile(request.variant);
      if (!sameOriginalResolution(original, currentOriginal) || currentProfile.profile_schema_hash !== profile.profile_schema_hash ||
          original.expires_at <= this.#readNow() || this.#pendingSemantic.get(key) !== reservation) fail("UPLOAD_OUTCOME_UNKNOWN");
      const handle = `banana_inpaint_painted_${randomUUID()}`;
      const record: PrivateRecord = Object.freeze({ handle, attemptId: request.attemptId, principal,
        variant: request.variant, publicCatalogVersion: this.#publicCatalogVersion, settingsInventoryVersion: this.#settingsInventoryVersion,
        profileSchemaHash: profile.profile_schema_hash, originalProfileSchemaHash: original.profile_schema_hash,
        originalHandle: original.reference_handle, originalSha256: original.sha256, originalWidth: original.width,
        originalHeight: original.height, originalExpiresAt: original.expires_at, originalEpoch: original.epoch,
        paintedSha256: validated.sha256, width: validated.width, height: validated.height, size: validated.size,
        fileUrl: privateReference.url, ...(privateReference.file_id === undefined ? {} : { fileId: privateReference.file_id }),
        expiresAt: original.expires_at, epoch: operation.epoch });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      this.#pendingSemantic.delete(key); semanticKey = undefined;
      return receipt(record, this.#readNow());
    } catch (error) {
      if (started && !isKnownUploadRejection(error)) unknownOutcome = true;
      if (error instanceof OwnerBananaInpaintPaintedCompositeReferenceServiceError) throw error;
      if (error instanceof OwnerBananaInpaintPaintedCompositeInputError) {
        if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        fail("INVALID_IMAGE_INPUT");
      }
      if (error instanceof SyntxHttpError && isKnownUploadRejection(error.code)) fail("UPLOAD_REJECTED");
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (started) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      return fail("INVALID_REQUEST");
    } finally {
      if (semanticKey !== undefined) {
        if (unknownOutcome) this.#unknownSemanticHolds.add(semanticKey);
        this.#pendingSemantic.delete(semanticKey);
      }
      nativeBytes?.fill(0);
      validated?.bytes.fill(0);
      this.#finishOperation(request.attemptId, operation);
    }
  }

  async resolvePaintedComposite(input: OwnerBananaInpaintPaintedCompositeResolverContext | unknown): Promise<OwnerBananaInpaintPaintedCompositePrivateResolution> {
    const request = snapshotResolverContext(input);
    this.#assertOpen();
    const operation = this.#beginOperation(request.attempt_id);
    try {
      const profile = this.#assertProfile(request.variant);
      const record = this.#records.get(request.painted_handle);
      if (!record || record.attemptId !== request.attempt_id || record.variant !== request.variant ||
          record.originalHandle !== request.original_handle) fail("PAINTED_REFERENCE_UNAVAILABLE");
      const now = this.#readNow();
      if (record.expiresAt <= now) { this.#removeHandle(record.handle); fail("PAINTED_REFERENCE_EXPIRED"); }
      const original = await this.#resolveOriginal(request.attempt_id, request.variant, request.original_handle, operation.controller.signal);
      this.#assertCurrentOriginal(operation, request.attempt_id, original);
      if (!sameOriginalRecord(record, original) || profile.profile_schema_hash !== record.profileSchemaHash ||
          record.publicCatalogVersion !== this.#publicCatalogVersion || record.settingsInventoryVersion !== this.#settingsInventoryVersion ||
          record.epoch !== operation.epoch || record.expiresAt <= this.#readNow() || !isSafeUploadReferenceUrl(record.fileUrl)) {
        this.#removeHandle(record.handle); fail("PAINTED_REFERENCE_UNAVAILABLE");
      }
      return Object.freeze({ role: "painted_composite", wire_type: "mask", principal: record.principal,
        attempt_id: record.attemptId, variant: record.variant, form_id: "banana-inpaint", source_role: "painted_composite",
        public_catalog_version: record.publicCatalogVersion, settings_inventory_version: record.settingsInventoryVersion,
        profile_schema_hash: record.profileSchemaHash, original_profile_schema_hash: record.originalProfileSchemaHash,
        original_handle: record.originalHandle, painted_handle: record.handle, original_sha256: record.originalSha256,
        painted_sha256: record.paintedSha256, original_width: record.originalWidth, original_height: record.originalHeight,
        width: record.width, height: record.height, file_url: record.fileUrl,
        ...(record.fileId === undefined ? {} : { file_id: record.fileId }), expires_at: record.expiresAt,
        epoch: record.epoch, original_epoch: record.originalEpoch,
        metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS", generation_permit: false });
    } catch (error) {
      if (error instanceof OwnerBananaInpaintPaintedCompositeReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("PAINTED_REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(request.attempt_id, operation); }
  }

  invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId)) return Promise.resolve();
    const existing = this.#invalidations.get(attemptId);
    if (existing) return existing;
    this.#invalidatingAttempts.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#removeHandle(handle);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    const completion = Promise.allSettled(pending).then(async () => {
      await Reflect.apply(ORIGINAL_INVALIDATE_METHOD, this.#original, [attemptId]);
    }).finally(() => {
      this.#invalidatingAttempts.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeReleaseAttempt(attemptId);
    });
    this.#invalidations.set(attemptId, completion);
    return completion;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = this.#activeAttempts();
    const invalidations = [...attempts].map((attemptId) => this.invalidateAttempt(attemptId));
    const allOperations = [...this.#allOperations];
    this.#closing = Promise.allSettled([...invalidations, ...allOperations]).then(async () => {
      await Reflect.apply(ORIGINAL_CLOSE_METHOD, this.#original, []);
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#pendingByAttempt.clear(); this.#epochs.clear();
      this.#unknownSemanticHolds.clear(); this.#pendingSemantic.clear(); this.#invalidatingAttempts.clear();
      this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #assertProfile(variant: OwnerBananaInpaintPaintedCompositeVariant): Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile> {
    this.#assertOpen();
    const expected = this.#profiles.get(variant), originalExpected = this.#originalProfiles.get(variant);
    if (!expected || !originalExpected) fail("PROFILE_BINDING_MISMATCH");
    try {
      const original = getOwnerBananaInpaintOriginalUploadSourceProfile(variant, this.#catalog, this.#publicCatalogVersion,
        this.#settingsInventory, this.#settingsInventoryVersion);
      const current = getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, original);
      if (original.profile_schema_hash !== originalExpected.profile_schema_hash || current.profile_schema_hash !== expected.profile_schema_hash ||
          current.source_binding.original_upload_profile_schema_hash !== original.profile_schema_hash) fail("PROFILE_BINDING_MISMATCH");
      return current;
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async #resolveOriginal(attemptId: string, variant: OwnerBananaInpaintPaintedCompositeVariant, handle: string,
    signal: AbortSignal): Promise<OwnerBananaInpaintOriginalPrivateResolution> {
    this.#throwIfClosedOrAborted({ signal });
    const principal = await this.#resolvePrincipal(attemptId, signal);
    const profile = this.#assertOriginalProfile(variant);
    const context = Object.freeze({ principal, attempt_id: attemptId, variant, form_id: "banana-inpaint" as const,
      source_role: "inpaint_original" as const, public_catalog_version: this.#publicCatalogVersion,
      settings_inventory_version: this.#settingsInventoryVersion, profile_schema_hash: profile.profile_schema_hash,
      reference_handle: handle });
    let resolution: OwnerBananaInpaintOriginalPrivateResolution;
    try { resolution = await Reflect.apply(ORIGINAL_RESOLVE_METHOD, this.#original, [context]) as OwnerBananaInpaintOriginalPrivateResolution; }
    catch (error) {
      if (error instanceof OwnerBananaInpaintOriginalReferenceServiceError) {
        if (error.code === "REFERENCE_EXPIRED") fail("ORIGINAL_REFERENCE_EXPIRED");
        if (error.code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
        if (error.code === "PROFILE_BINDING_MISMATCH") fail("PROFILE_BINDING_MISMATCH");
      }
      fail("ORIGINAL_REFERENCE_UNAVAILABLE");
    }
    const after = await this.#resolvePrincipal(attemptId, signal);
    this.#assertOriginalResolution(resolution, attemptId, variant, handle, principal);
    if (!sameGenerationPrincipal(principal, after)) fail("PRINCIPAL_NOT_LINKED");
    return resolution;
  }

  #assertOriginalProfile(variant: OwnerBananaInpaintPaintedCompositeVariant): Readonly<OwnerBananaInpaintOriginalUploadSourceProfile> {
    const expected = this.#originalProfiles.get(variant);
    if (!expected) fail("PROFILE_BINDING_MISMATCH");
    try {
      const current = getOwnerBananaInpaintOriginalUploadSourceProfile(variant, this.#catalog, this.#publicCatalogVersion,
        this.#settingsInventory, this.#settingsInventoryVersion);
      if (current.profile_schema_hash !== expected.profile_schema_hash) fail("PROFILE_BINDING_MISMATCH");
      return current;
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  #assertOriginalResolution(value: OwnerBananaInpaintOriginalPrivateResolution, attemptId: string,
    variant: OwnerBananaInpaintPaintedCompositeVariant, handle: string, principal: Readonly<GenerationPrincipalRef>): void {
    if (!value || value.role !== "inpaint_original" || value.wire_type !== "image" || value.attempt_id !== attemptId ||
        value.variant !== variant || value.form_id !== "banana-inpaint" || value.source_role !== "inpaint_original" ||
        value.reference_handle !== handle || !sameGenerationPrincipal(value.principal, principal) ||
        value.public_catalog_version !== this.#publicCatalogVersion || value.settings_inventory_version !== this.#settingsInventoryVersion ||
        value.profile_schema_hash !== this.#assertOriginalProfile(variant).profile_schema_hash || value.generation_permit !== false ||
        !/^sha256:[a-f0-9]{64}$/u.test(value.sha256) || !Number.isSafeInteger(value.width) || value.width < 1 ||
        !Number.isSafeInteger(value.height) || value.height < 1 || !Number.isSafeInteger(value.expires_at) ||
        !Number.isSafeInteger(value.epoch) || value.expires_at <= this.#readNow() || !isSafeUploadReferenceUrl(value.file_url)) {
      fail("ORIGINAL_REFERENCE_UNAVAILABLE");
    }
  }

  #assertCurrentOriginal(operation: PendingOperation, attemptId: string, original: OwnerBananaInpaintOriginalPrivateResolution): void {
    this.#assertOpen();
    if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
    if ((this.#epochs.get(attemptId) ?? 0) !== operation.epoch || this.#invalidatingAttempts.has(attemptId)) fail("REQUEST_ABORTED");
    this.#assertOriginalResolution(original, attemptId, original.variant, original.reference_handle, original.principal);
  }

  async #resolvePrincipal(attemptId: string, signal: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal.aborted) fail("REQUEST_ABORTED");
    const principalPromise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    let remove = () => {};
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerBananaInpaintPaintedCompositeReferenceServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principalPromise, aborted]);
    } catch (error) {
      if (error instanceof OwnerBananaInpaintPaintedCompositeReferenceServiceError) throw error;
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
    } finally { remove(); }
  }

  #beginOperation(attemptId: string, parentSignal?: AbortSignal, pruneExpired = false): PendingOperation {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId)) fail("REQUEST_ABORTED");
    if (pruneExpired) this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    if (!this.#activeAttempts().has(attemptId) && this.#activeAttempts().size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent(); else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = { controller, done, finish,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent), epoch: this.#epochs.get(attemptId) ?? 0 };
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done); this.#pendingCount += 1;
    return operation;
  }

  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1; operation.finish(); this.#allOperations.delete(operation.done); this.#maybeReleaseAttempt(attemptId);
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#handlesByAttempt.keys(), ...this.#pendingByAttempt.keys()]);
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

  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeHandle(handle);
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }

  #maybeReleaseAttempt(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidatingAttempts.has(attemptId)) return;
    this.#epochs.delete(attemptId);
  }

  #throwIfClosedOrAborted(operation: Pick<PendingOperation, "controller"> | { readonly signal: AbortSignal }): void {
    this.#assertOpen();
    const signal = "controller" in operation ? operation.controller.signal : operation.signal;
    if (signal.aborted) fail("REQUEST_ABORTED");
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastObservedNow !== undefined && (value as number) < this.#lastObservedNow)) {
      fail("SERVICE_CLOSED");
    }
    this.#lastObservedNow = value as number;
    return value as number;
  }
}

function snapshotUploadInput(value: unknown): Readonly<OwnerBananaInpaintPaintedCompositeUploadInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "original_handle", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || !isVariant(fields.variant) ||
      typeof fields.original_handle !== "string" || !ORIGINAL_HANDLE_PATTERN.test(fields.original_handle) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" || fields.mime_type !== "image/png") fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant, original_handle: fields.original_handle,
    content_base64: fields.content_base64, filename: fields.filename, mime_type: "image/png",
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }) });
}

function snapshotResolverContext(value: unknown): Readonly<OwnerBananaInpaintPaintedCompositeResolverContext> {
  const fields = exactRecord(value, ["attempt_id", "variant", "original_handle", "painted_handle"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT_PATTERN.test(fields.attempt_id) || !isVariant(fields.variant) ||
      typeof fields.original_handle !== "string" || !ORIGINAL_HANDLE_PATTERN.test(fields.original_handle) ||
      typeof fields.painted_handle !== "string" || !PAINTED_HANDLE_PATTERN.test(fields.painted_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attempt_id: fields.attempt_id, variant: fields.variant, original_handle: fields.original_handle, painted_handle: fields.painted_handle });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient; method: SyntxChatHttpClient["uploadBananaInpaintPaintedComposite"] }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("PROFILE_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadBananaInpaintPaintedComposite");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) ||
      descriptor.value !== NATIVE_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ client: value, method: NATIVE_UPLOAD_METHOD });
}

function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id)))) {
    fail("UPLOAD_OUTCOME_UNKNOWN");
  }
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id }) });
}

function semanticUploadKey(principal: Readonly<GenerationPrincipalRef>, variant: OwnerBananaInpaintPaintedCompositeVariant,
  originalSha256: `sha256:${string}`, paintedSha256: `sha256:${string}`, profileSchemaHash: string): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, variant,
    original_sha256: originalSha256, painted_sha256: paintedSha256, profile_schema_hash: profileSchemaHash });
}

function sameOriginalResolution(left: OwnerBananaInpaintOriginalPrivateResolution, right: OwnerBananaInpaintOriginalPrivateResolution): boolean {
  return left.reference_handle === right.reference_handle && left.sha256 === right.sha256 && left.width === right.width && left.height === right.height &&
    left.expires_at === right.expires_at && left.epoch === right.epoch && left.profile_schema_hash === right.profile_schema_hash &&
    left.variant === right.variant && sameGenerationPrincipal(left.principal, right.principal);
}

function sameOriginalRecord(record: PrivateRecord, original: OwnerBananaInpaintOriginalPrivateResolution): boolean {
  return record.originalHandle === original.reference_handle && record.originalSha256 === original.sha256 &&
    record.originalWidth === original.width && record.originalHeight === original.height && record.originalExpiresAt === original.expires_at &&
    record.originalEpoch === original.epoch && record.originalProfileSchemaHash === original.profile_schema_hash &&
    record.variant === original.variant && sameGenerationPrincipal(record.principal, original.principal);
}

function receipt(record: PrivateRecord, now: number): OwnerBananaInpaintPaintedCompositeUploadReceipt {
  return Object.freeze({ status: "uploaded", painted_handle: record.handle, original_handle: record.originalHandle,
    variant: record.variant, mime_type: "image/png", width: record.width, height: record.height, size: record.size,
    sha256: record.paintedSha256, expires_in_seconds: Math.max(0, Math.ceil((record.expiresAt - now) / 1000)),
    metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS", geometry_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" });
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)) || !("value" in descriptors[key]!)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isKnownUploadRejection(error: unknown): boolean {
  if (!(error instanceof SyntxHttpError)) return false;
  return error.code === "INVALID_REQUEST" || error.code === "AUTH_OR_ACCESS_DENIED" || error.code === "UPSTREAM_RATE_LIMITED";
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

function isObject(value: unknown): value is object { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function isVariant(value: unknown): value is OwnerBananaInpaintPaintedCompositeVariant {
  return typeof value === "string" && (OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS as readonly string[]).includes(value);
}
function fail(code: OwnerBananaInpaintPaintedCompositeReferenceServiceErrorCode): never {
  throw new OwnerBananaInpaintPaintedCompositeReferenceServiceError(code);
}
