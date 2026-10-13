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
  OwnerBananaInpaintOriginalInputError,
  validateOwnerBananaInpaintOriginalInput,
  type OwnerBananaInpaintOriginalMimeType,
  type ValidatedOwnerBananaInpaintOriginal
} from "./owner-banana-inpaint-original-validator.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^banana_inpaint_original_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_ACTIVE_ATTEMPTS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD_METHOD = SyntxChatHttpClient.prototype.uploadBananaInpaintOriginal;

export interface OwnerBananaInpaintOriginalReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerBananaInpaintOriginalUploadCatalogPort;
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory: MaplessSettingsInventory;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerBananaInpaintOriginalUploadInput {
  readonly attemptId: string;
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: OwnerBananaInpaintOriginalMimeType;
  readonly signal?: AbortSignal;
}

export interface OwnerBananaInpaintOriginalUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly original_mime_type: OwnerBananaInpaintOriginalMimeType;
  readonly mime_type: OwnerBananaInpaintOriginalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly validation_scope: "BANANA_INPAINT_ORIGINAL_UI_FILE_INPUT_ONLY";
}

export interface OwnerBananaInpaintOriginalResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly form_id: "banana-inpaint";
  readonly source_role: "inpaint_original";
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
}

export interface OwnerBananaInpaintOriginalPrivateResolution {
  readonly role: "inpaint_original";
  readonly wire_type: "image";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly form_id: "banana-inpaint";
  readonly source_role: "inpaint_original";
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly profile_schema_hash: string;
  readonly reference_handle: string;
  readonly file_url: string;
  readonly file_id?: string;
  readonly original_mime_type: OwnerBananaInpaintOriginalMimeType;
  readonly mime_type: OwnerBananaInpaintOriginalMimeType;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: `sha256:${string}`;
  readonly expires_at: number;
  readonly epoch: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly generation_permit: false;
}

export type OwnerBananaInpaintOriginalReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";

export class OwnerBananaInpaintOriginalReferenceServiceError extends Error {
  constructor(readonly code: OwnerBananaInpaintOriginalReferenceServiceErrorCode) {
    super("The Banana Inpaint original reference is unavailable.");
    this.name = "OwnerBananaInpaintOriginalReferenceServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly publicCatalogVersion: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settingsInventoryVersion: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly profileSchemaHash: string;
  readonly fileUrl: string;
  readonly fileId?: string;
  readonly originalMimeType: OwnerBananaInpaintOriginalMimeType;
  readonly mimeType: OwnerBananaInpaintOriginalMimeType;
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

/** Process-local original-image handles only; no mask role or generation permission is created. */
export class OwnerBananaInpaintOriginalReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerBananaInpaintOriginalUploadCatalogPort;
  readonly #publicCatalogVersion: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly #settingsInventory: MaplessSettingsInventory;
  readonly #settingsInventoryVersion: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly #resolveClient: OwnerBananaInpaintOriginalReferenceServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerBananaInpaintOriginalUploadVariant, Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>>();
  readonly #records = new Map<string, PrivateRecord>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
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

  constructor(optionsInput: OwnerBananaInpaintOriginalReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "catalog", "public_catalog_version",
      "settings_inventory", "settings_inventory_version", "resolveClient"], ["now"]);
    if (fields.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
        fields.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
        !isObject(fields.linkService) || !isObject(fields.catalog) ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = fields.catalog as OwnerBananaInpaintOriginalUploadCatalogPort;
    this.#publicCatalogVersion = OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
    this.#settingsInventory = fields.settings_inventory as MaplessSettingsInventory;
    this.#settingsInventoryVersion = OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
    this.#resolveClient = fields.resolveClient as OwnerBananaInpaintOriginalReferenceServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    try {
      for (const variant of OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS) {
        this.#profiles.set(variant, getOwnerBananaInpaintOriginalUploadSourceProfile(
          variant, this.#catalog, this.#publicCatalogVersion, this.#settingsInventory, this.#settingsInventoryVersion));
      }
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerBananaInpaintOriginalUploadInput | unknown): Promise<OwnerBananaInpaintOriginalUploadReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    const profile = this.#assertProfile(request.variant);
    const operation = this.#beginOperation(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerBananaInpaintOriginal | undefined;
    let invoked = false;
    let pendingSemanticKey: string | undefined;
    let unknownOutcome = false;
    try {
      validated = validateOwnerBananaInpaintOriginalInput({
        content_base64: request.content_base64, filename: request.filename, mime_type: request.mime_type
      });
      if (!profile.input_policy.accepted_file_types.includes(validated.original_mime_type) ||
          validated.size > profile.input_policy.max_file_bytes || profile.input_policy.max_file_count !== 1) {
        fail("PROFILE_BINDING_MISMATCH");
      }
      this.#assertProfile(request.variant);
      this.#throwIfClosedOrAborted(operation.controller);
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) {
        void this.#invalidateAttemptInternal(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const semanticKey = semanticUploadKey(principal, request.variant, validated.sha256, profile.profile_schema_hash);
      if (this.#unknownSemanticHolds.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantic.has(semanticKey)) fail("SERVICE_BUSY");
      if (this.#records.size + this.#unknownSemanticHolds.size + this.#pendingSemantic.size >= MAX_RECORDS) {
        fail("CAPACITY_EXCEEDED");
      }
      const reservation = Symbol("inpaint-original-upload");
      this.#pendingSemantic.set(semanticKey, reservation);
      pendingSemanticKey = semanticKey;
      const native = snapshotNativeClient(this.#resolveClient(request.attemptId));
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const expiresAt = issuedAt + TTL_MS;
      const epoch = operation.epoch;
      const nativeRequest = Object.freeze({ variant: request.variant, bytes: validated.bytes,
        filename: validated.filename, mime_type: validated.mime_type });
      this.#throwIfClosedOrAborted(operation.controller);
      if (this.#pendingSemantic.get(semanticKey) !== reservation) fail("UPLOAD_OUTCOME_UNKNOWN");
      invoked = true;
      const rawReceipt = await Reflect.apply(native.method, native.client, [nativeRequest, operation.controller.signal]);
      this.#throwIfClosedOrAborted(operation.controller);
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch) fail("REQUEST_ABORTED");
      const privateReference = parseUploadReference(rawReceipt);
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        void this.#invalidateAttemptInternal(request.attemptId);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const currentProfile = this.#assertProfile(request.variant);
      if (currentProfile.profile_schema_hash !== profile.profile_schema_hash || expiresAt <= this.#readNow() ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch || this.#pendingSemantic.get(semanticKey) !== reservation) {
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      this.#prune(this.#readNow());
      if (this.#records.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      const handle = `banana_inpaint_original_${randomUUID()}`;
      if (!HANDLE_PATTERN.test(handle) || this.#records.has(handle)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const record = Object.freeze({ handle, attemptId: request.attemptId, principal, variant: request.variant,
        publicCatalogVersion: profile.public_catalog_version, settingsInventoryVersion: profile.settings_inventory_version,
        profileSchemaHash: profile.profile_schema_hash, fileUrl: privateReference.url,
        ...(privateReference.file_id === undefined ? {} : { fileId: privateReference.file_id }),
        originalMimeType: validated.original_mime_type, mimeType: validated.mime_type,
        width: validated.width, height: validated.height, size: validated.size, sha256: validated.sha256,
        expiresAt, epoch });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      this.#pendingSemantic.delete(semanticKey); pendingSemanticKey = undefined;
      return Object.freeze({ status: "uploaded", reference_handle: handle, variant: record.variant,
        original_mime_type: record.originalMimeType, mime_type: record.mimeType, width: record.width, height: record.height,
        size: record.size, sha256: record.sha256,
        expires_in_seconds: Math.max(0, Math.ceil((expiresAt - this.#readNow()) / 1000)),
        metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
        validation_scope: "BANANA_INPAINT_ORIGINAL_UI_FILE_INPUT_ONLY" });
    } catch (error) {
      if (error instanceof OwnerBananaInpaintOriginalReferenceServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED") unknownOutcome = true;
        if (unknownOutcome) fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerBananaInpaintOriginalInputError) {
        if (invoked) unknownOutcome = true;
        else if (error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
        else fail("INVALID_IMAGE_INPUT");
      }
      if (error instanceof OwnerReferencePrincipalError) {
        void this.#invalidateAttemptInternal(request.attemptId);
        if (invoked) unknownOutcome = true;
        else fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && invoked && isKnownUploadRejection(error.code)) fail("UPLOAD_REJECTED");
      if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED" && !invoked) fail("PRINCIPAL_NOT_LINKED");
      if (invoked) unknownOutcome = true;
      if (unknownOutcome) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      return fail("INVALID_REQUEST");
    } finally {
      if (pendingSemanticKey !== undefined) {
        if (unknownOutcome) this.#unknownSemanticHolds.add(pendingSemanticKey);
        this.#pendingSemantic.delete(pendingSemanticKey);
      }
      validated?.bytes.fill(0);
      this.#finishOperation(request.attemptId, operation);
    }
  }

  async resolveOriginal(input: OwnerBananaInpaintOriginalResolverContext | unknown): Promise<OwnerBananaInpaintOriginalPrivateResolution> {
    const request = snapshotResolverContext(input);
    this.#assertOpen();
    const operation = this.#beginOperation(request.attempt_id);
    try {
      const profile = this.#assertProfile(request.variant);
      const principal = await this.#resolvePrincipal(request.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, request.principal)) fail("PRINCIPAL_NOT_LINKED");
      if (!this.#rememberPrincipal(request.attempt_id, principal)) {
        void this.#invalidateAttemptInternal(request.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      const record = this.#records.get(request.reference_handle);
      const now = this.#readNow();
      if (!record) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#removeHandle(record.handle); fail("REFERENCE_EXPIRED"); }
      const epoch = this.#epochs.get(request.attempt_id) ?? 0;
      if (record.attemptId !== request.attempt_id || record.variant !== request.variant || record.epoch !== epoch ||
          record.publicCatalogVersion !== request.public_catalog_version || record.settingsInventoryVersion !== request.settings_inventory_version ||
          record.profileSchemaHash !== request.profile_schema_hash || record.profileSchemaHash !== profile.profile_schema_hash ||
          request.form_id !== "banana-inpaint" || request.source_role !== "inpaint_original" ||
          !sameGenerationPrincipal(record.principal, principal) || !isSafeUploadReferenceUrl(record.fileUrl)) fail("REFERENCE_UNAVAILABLE");
      const currentPrincipal = await this.#resolvePrincipal(request.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        void this.#invalidateAttemptInternal(request.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertProfile(request.variant);
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          (this.#epochs.get(request.attempt_id) ?? 0) !== epoch || this.#invalidatingAttempts.has(request.attempt_id)) {
        fail("REFERENCE_EXPIRED");
      }
      return Object.freeze({ role: "inpaint_original", wire_type: "image", principal: record.principal,
        attempt_id: record.attemptId, variant: record.variant, form_id: "banana-inpaint", source_role: "inpaint_original",
        public_catalog_version: record.publicCatalogVersion, settings_inventory_version: record.settingsInventoryVersion,
        profile_schema_hash: record.profileSchemaHash, reference_handle: record.handle, file_url: record.fileUrl,
        ...(record.fileId === undefined ? {} : { file_id: record.fileId }), original_mime_type: record.originalMimeType,
        mime_type: record.mimeType, width: record.width, height: record.height, size: record.size, sha256: record.sha256,
        expires_at: record.expiresAt, epoch: record.epoch, metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS",
        generation_permit: false });
    } catch (error) {
      if (error instanceof OwnerBananaInpaintOriginalReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) {
        void this.#invalidateAttemptInternal(request.attempt_id);
        fail("PRINCIPAL_NOT_LINKED");
      }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finishOperation(request.attempt_id, operation); }
  }

  invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT_PATTERN.test(attemptId)) return Promise.resolve();
    return this.#invalidateAttemptInternal(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = this.#activeAttempts();
    const invalidations = [...attempts].map((attemptId) => this.#invalidateAttemptInternal(attemptId));
    const allOperations = [...this.#allOperations];
    this.#closing = Promise.allSettled([...invalidations, ...allOperations]).then(() => {
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear(); this.#pendingByAttempt.clear();
      this.#epochs.clear(); this.#unknownSemanticHolds.clear(); this.#pendingSemantic.clear();
      this.#invalidatingAttempts.clear(); this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #assertProfile(variant: OwnerBananaInpaintOriginalUploadVariant): Readonly<OwnerBananaInpaintOriginalUploadSourceProfile> {
    this.#assertOpen();
    const expected = this.#profiles.get(variant);
    if (!expected) fail("PROFILE_BINDING_MISMATCH");
    try {
      const current = getOwnerBananaInpaintOriginalUploadSourceProfile(variant, this.#catalog, this.#publicCatalogVersion,
        this.#settingsInventory, this.#settingsInventoryVersion);
      if (current.profile_schema_hash !== expected.profile_schema_hash ||
          current.public_catalog_version !== expected.public_catalog_version ||
          current.settings_inventory_version !== expected.settings_inventory_version) fail("PROFILE_BINDING_MISMATCH");
      return current;
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    let remove = () => {};
    try {
      const principal = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (!signal) return await principal;
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new OwnerBananaInpaintOriginalReferenceServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort();
        else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
      });
      return await Promise.race([principal, aborted]);
    } catch (error) {
      if (error instanceof OwnerBananaInpaintOriginalReferenceServiceError) throw error;
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
    } finally { remove(); }
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId);
    if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal);
    return true;
  }

  #beginOperation(attemptId: string, parentSignal?: AbortSignal, pruneExpired = false): PendingOperation {
    this.#assertOpen();
    if (this.#invalidatingAttempts.has(attemptId)) fail("REQUEST_ABORTED");
    if (pruneExpired) this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const activeAttempts = this.#activeAttempts();
    if (!activeAttempts.has(attemptId) && activeAttempts.size >= MAX_ACTIVE_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent(); else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation: PendingOperation = { controller, done, finish,
      removeParentAbort: () => parentSignal?.removeEventListener("abort", abortFromParent),
      epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done);
    this.#pendingCount += 1;
    return operation;
  }

  #finishOperation(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1;
    operation.finish(); this.#allOperations.delete(operation.done);
    this.#maybeReleaseAttempt(attemptId);
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]);
  }

  #invalidateAttemptInternal(attemptId: string): Promise<void> {
    const existing = this.#invalidations.get(attemptId);
    if (existing) return existing;
    this.#invalidatingAttempts.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptHandles(attemptId);
    this.#principalByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    const completion = Promise.allSettled(pending).then(() => {
      this.#invalidatingAttempts.delete(attemptId);
      this.#invalidations.delete(attemptId);
      this.#maybeReleaseAttempt(attemptId);
    });
    this.#invalidations.set(attemptId, completion);
    return completion;
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

  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeHandle(handle);
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }

  #maybeReleaseAttempt(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidatingAttempts.has(attemptId)) return;
    this.#epochs.delete(attemptId);
    this.#principalByAttempt.delete(attemptId);
  }

  #throwIfClosedOrAborted(controller: AbortController): void {
    this.#assertOpen();
    if (controller.signal.aborted) fail("REQUEST_ABORTED");
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 ||
        (this.#lastObservedNow !== undefined && (value as number) < this.#lastObservedNow)) fail("SERVICE_CLOSED");
    this.#lastObservedNow = value as number;
    return value as number;
  }
}

function snapshotUploadInput(value: unknown): Readonly<OwnerBananaInpaintOriginalUploadInput> {
  const fields = exactRecord(value, ["attemptId", "variant", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) ||
      typeof fields.variant !== "string" || !OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS.includes(fields.variant as never) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" ||
      (fields.mime_type !== "image/jpeg" && fields.mime_type !== "image/png")) fail("INVALID_REQUEST");
  const signal = fields.signal;
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, variant: fields.variant as OwnerBananaInpaintOriginalUploadVariant,
    content_base64: fields.content_base64, filename: fields.filename, mime_type: fields.mime_type as OwnerBananaInpaintOriginalMimeType,
    ...(signal === undefined ? {} : { signal: signal as AbortSignal }) });
}

function snapshotResolverContext(value: unknown): Readonly<OwnerBananaInpaintOriginalResolverContext> {
  const fields = exactRecord(value, ["principal", "attempt_id", "variant", "form_id", "source_role", "public_catalog_version",
    "settings_inventory_version", "profile_schema_hash", "reference_handle"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT_PATTERN.test(fields.attempt_id) ||
      typeof fields.variant !== "string" || !OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS.includes(fields.variant as never) ||
      fields.form_id !== "banana-inpaint" || fields.source_role !== "inpaint_original" ||
      fields.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      fields.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
      typeof fields.profile_schema_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(fields.profile_schema_hash) ||
      typeof fields.reference_handle !== "string" || !HANDLE_PATTERN.test(fields.reference_handle)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attempt_id) fail("INVALID_REQUEST");
  return Object.freeze({ principal, attempt_id: fields.attempt_id, variant: fields.variant as OwnerBananaInpaintOriginalUploadVariant,
    form_id: "banana-inpaint", source_role: "inpaint_original", public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, profile_schema_hash: fields.profile_schema_hash,
    reference_handle: fields.reference_handle });
}

function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient; method: SyntxChatHttpClient["uploadBananaInpaintOriginal"] }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("PROFILE_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadBananaInpaintOriginal");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) ||
      descriptor.value !== NATIVE_UPLOAD_METHOD || typeof descriptor.value !== "function") fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ client: value, method: NATIVE_UPLOAD_METHOD });
}

function parseUploadReference(value: unknown): InternalUploadReference {
  const fields = exactRecord(value, ["url"], ["file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fields.file_id)))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id }) });
}

function semanticUploadKey(principal: Readonly<GenerationPrincipalRef>, variant: OwnerBananaInpaintOriginalUploadVariant,
  sha256: `sha256:${string}`, profileSchemaHash: string): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, variant, sha256, profile_schema_hash: profileSchemaHash });
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
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isObject(value: unknown): value is object {
  return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value);
}

function fail(code: OwnerBananaInpaintOriginalReferenceServiceErrorCode): never {
  throw new OwnerBananaInpaintOriginalReferenceServiceError(code);
}
