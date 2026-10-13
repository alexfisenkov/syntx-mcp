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
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  getOwnerSeedreamEditorOriginalUploadSourceProfile, type OwnerSeedreamEditorOriginalUploadCatalogPort } from "./owner-seedream-editor-original-upload-source-profile.js";
import { OwnerSeedreamEditorOriginalReferenceService, type OwnerSeedreamEditorOriginalPrivateResolution,
  type OwnerSeedreamEditorOriginalResolverContext } from "./owner-seedream-editor-original-reference-service.js";
import { getOwnerSeedreamEditorDrawingSourceProfile, type OwnerSeedreamEditorDrawingSourceProfile } from "./owner-seedream-editor-drawing-source-profile.js";
import { validateOwnerSeedreamEditorDrawingInput, type ValidatedOwnerSeedreamEditorDrawing } from "./owner-seedream-editor-drawing-input-validator.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const ORIGINAL_HANDLE = /^seedream_editor_original_[0-9a-f-]{36}$/u;
const DRAWING_HANDLE = /^seedream_editor_drawing_[0-9a-f-]{36}$/u;
const MAX_PENDING = 4, MAX_RECORDS = 128, MAX_ATTEMPTS = 128;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadSeedreamEditorDrawing;
const ORIGINAL_RESOLVE = OwnerSeedreamEditorOriginalReferenceService.prototype.resolveOriginal;
const ORIGINAL_GUARD = OwnerSeedreamEditorOriginalReferenceService.prototype.isOwnedOriginalResolution;

export interface OwnerSeedreamEditorDrawingReferenceServiceOptions {
  readonly originalReferenceService: OwnerSeedreamEditorOriginalReferenceService;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerSeedreamEditorOriginalUploadCatalogPort;
  readonly public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION;
  readonly settings_inventory: MaplessSettingsInventory;
  readonly settings_inventory_version: typeof OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerSeedreamEditorDrawingUploadInput {
  readonly attemptId: string; readonly variant: OwnerSeedreamImageVariant; readonly original_handle: string;
  readonly content_base64: string; readonly filename: string; readonly mime_type: "image/png"; readonly signal?: AbortSignal;
  readonly original_width?: number; readonly original_height?: number;
}
export interface OwnerSeedreamEditorDrawingUploadReceipt {
  readonly status: "uploaded"; readonly drawing_handle: string; readonly original_handle: string; readonly variant: OwnerSeedreamImageVariant;
  readonly drawing_mime_type: "image/png"; readonly original_mime_type: string; readonly width: number; readonly height: number;
  readonly size: number; readonly sha256: `sha256:${string}`; readonly original_sha256: `sha256:${string}`;
  readonly expires_in_seconds: number; readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
}
export interface OwnerSeedreamEditorDrawingResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly variant: OwnerSeedreamImageVariant;
  readonly original_handle: string; readonly drawing_handle: string;
}
export interface OwnerSeedreamEditorDrawingPrivateResolution {
  readonly role: "editor_drawing"; readonly wire_role: "image"; readonly extra_role: "image"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string; readonly variant: OwnerSeedreamImageVariant; readonly original_handle: string; readonly drawing_handle: string;
  readonly source_role: "editor_drawing"; readonly original_profile_schema_hash: string;
  readonly drawing_profile_schema_hash: string; readonly source_bindings: OwnerSeedreamEditorDrawingSourceProfile["source_binding"];
  readonly original_file_url: string; readonly original_file_id?: string; readonly drawing_file_url: string; readonly drawing_file_id?: string;
  readonly original_sha256: `sha256:${string}`; readonly drawing_sha256: `sha256:${string}`;
  readonly original_mime_type: string; readonly drawing_mime_type: "image/png"; readonly original_width: number;
  readonly original_height: number; readonly drawing_width: number; readonly drawing_height: number;
  readonly drawing_size: number; readonly original_expires_at: number; readonly expires_at: number;
  readonly original_epoch: number; readonly drawing_epoch: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"; readonly pixel_decode_verified: false; readonly generation_permit: false;
}
export type OwnerSeedreamEditorDrawingReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH"
  | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "REQUEST_ABORTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED"
  | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";
export class OwnerSeedreamEditorDrawingReferenceServiceError extends Error {
  constructor(readonly code: OwnerSeedreamEditorDrawingReferenceServiceErrorCode) {
    super("The Seedream Editor drawing reference is unavailable."); this.name = "OwnerSeedreamEditorDrawingReferenceServiceError";
  }
}

interface PairRecord {
  readonly handle: string; readonly originalHandle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerSeedreamImageVariant; readonly originalProfileHash: string; readonly drawingProfileHash: string;
  readonly originalUrl: string; readonly originalFileId?: string; readonly drawingUrl: string; readonly drawingFileId?: string;
  readonly originalSha: `sha256:${string}`; readonly drawingSha: `sha256:${string}`; readonly originalMime: string;
  readonly originalWidth: number; readonly originalHeight: number; readonly drawingWidth: number; readonly drawingHeight: number;
  readonly drawingSize: number; readonly expiresAt: number; readonly epoch: number; readonly semanticKey: string;
  readonly originalEpoch: number;
  readonly originalResolution: OwnerSeedreamEditorOriginalPrivateResolution;
}
interface Operation { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void;
  readonly removeParentAbort: () => void; readonly epoch: number; }

/** Process-local owned PNG imageextra paired to a genuine source-issued Editor original. */
export class OwnerSeedreamEditorDrawingReferenceService {
  readonly #original: OwnerSeedreamEditorOriginalReferenceService; readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">; readonly #catalog: OwnerSeedreamEditorOriginalUploadCatalogPort;
  readonly #settings: MaplessSettingsInventory; readonly #resolveClient: OwnerSeedreamEditorDrawingReferenceServiceOptions["resolveClient"];
  readonly #now: () => number; readonly #profiles = new Map<OwnerSeedreamImageVariant, Readonly<OwnerSeedreamEditorDrawingSourceProfile>>();
  readonly #records = new Map<string, PairRecord>(); readonly #byAttempt = new Map<string, Set<string>>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>(); readonly #pending = new Map<string, Set<Operation>>();
  readonly #epochs = new Map<string, number>(); readonly #unknown = new Set<string>(); readonly #pendingKeys = new Set<string>();
  readonly #owned = new WeakMap<object, { readonly fingerprint: string; readonly record: PairRecord }>();
  readonly #invalidating = new Set<string>(); readonly #invalidations = new Map<string, Promise<void>>(); readonly #all = new Set<Promise<void>>();
  #pendingCount = 0; #lastNow: number | undefined; #closed = false; #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerSeedreamEditorDrawingReferenceServiceOptions | unknown) {
    const f = exactRecord(optionsInput, ["originalReferenceService", "binding", "linkService", "catalog", "public_catalog_version",
      "settings_inventory", "settings_inventory_version", "resolveClient"], ["now"]);
    if (!(f.originalReferenceService instanceof OwnerSeedreamEditorOriginalReferenceService) || types.isProxy(f.originalReferenceService) ||
      f.public_catalog_version !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION || f.settings_inventory_version !== OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION ||
      !isObjectPort(f.linkService) || !getDataMethod(f.linkService, "getStatus") || !isObjectPort(f.catalog) || !isObjectPort(f.settings_inventory) ||
      typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) || (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#original = f.originalReferenceService as OwnerSeedreamEditorOriginalReferenceService; this.#binding = snapshotBinding(f.binding);
    this.#linkService = f.linkService as Pick<PerUserLinkService, "getStatus">; this.#catalog = f.catalog as OwnerSeedreamEditorOriginalUploadCatalogPort;
    this.#settings = f.settings_inventory as MaplessSettingsInventory; this.#resolveClient = f.resolveClient as OwnerSeedreamEditorDrawingReferenceServiceOptions["resolveClient"];
    this.#now = f.now === undefined ? Date.now : readClock(f.now);
    try {
      for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) {
        const original = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, this.#catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
          this.#settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
        this.#profiles.set(variant, getOwnerSeedreamEditorDrawingSourceProfile(variant, original));
      }
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async uploadDrawing(input: OwnerSeedreamEditorDrawingUploadInput | unknown): Promise<OwnerSeedreamEditorDrawingUploadReceipt> {
    const request = snapshotUpload(input); this.#assertOpen(); const operation = this.#begin(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerSeedreamEditorDrawing | undefined, key: string | undefined, invoked = false, unknownOutcome = false;
    try {
      validated = validateOwnerSeedreamEditorDrawingInput({ content_base64: request.content_base64, filename: request.filename,
        mime_type: request.mime_type, ...(request.original_width === undefined ? {} : { original_width: request.original_width, original_height: request.original_height }) });
      const profile = this.#assertProfile(request.variant);
      this.#throwIfAborted(operation.controller);
      const principal = await this.#principal(request.attemptId, operation.controller.signal);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const originalContext = this.#originalContext(principal, request.attemptId, request.variant, request.original_handle);
      const original = await this.#resolveOriginal(originalContext);
      if (!this.#isOriginal(original, originalContext) || original.width !== validated.width || original.height !== validated.height) fail("INVALID_IMAGE_INPUT");
      const semantic = semanticKey(principal, request.variant, original.original_sha256, validated.sha256, profile.profile_schema_hash);
      key = semantic;
      if (this.#unknown.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingKeys.has(semantic)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknown.size + this.#pendingKeys.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingKeys.add(semantic);
      this.#throwIfAborted(operation.controller);
      const current = await this.#principal(request.attemptId, operation.controller.signal);
      if (!sameGenerationPrincipal(principal, current)) { await this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      const latestOriginal = await this.#resolveOriginal(originalContext);
      if (!this.#isOriginal(latestOriginal, originalContext) || !sameOriginal(original, latestOriginal)) fail("REFERENCE_UNAVAILABLE");
      if (latestOriginal.expires_at - this.#readNow() < 1_000) fail("REFERENCE_EXPIRED");
      const client = snapshotClient(this.#resolveClient(request.attemptId));
      const nativeRequest = Object.freeze({ variant: request.variant, bytes: validated.bytes, filename: validated.filename, mime_type: "image/png" as const });
      this.#throwIfAborted(operation.controller);
      if (this.#invalidating.has(request.attemptId)) fail("REQUEST_ABORTED");
      invoked = true;
      const receipt = parseUpload(await Reflect.apply(client.method, client.client, [nativeRequest, operation.controller.signal]));
      this.#throwIfAborted(operation.controller);
      const currentPrincipal = await this.#principal(request.attemptId, operation.controller.signal);
      const currentOriginal = await this.#resolveOriginal(originalContext);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) { await this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      if (!this.#isOriginal(currentOriginal, originalContext) || !sameOriginal(original, currentOriginal) ||
        operation.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
        this.#invalidating.has(request.attemptId) || !this.#pendingKeys.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      this.#assertProfile(request.variant);
      const acknowledgedAt = this.#readNow();
      if (currentOriginal.expires_at - acknowledgedAt < 1_000) fail("UPLOAD_OUTCOME_UNKNOWN");
      const handle = `seedream_editor_drawing_${randomUUID()}`;
      const record: PairRecord = { handle, originalHandle: request.original_handle, attemptId: request.attemptId, principal, variant: request.variant,
        originalProfileHash: currentOriginal.profile_schema_hash, drawingProfileHash: profile.profile_schema_hash,
        originalUrl: currentOriginal.file_url, ...(currentOriginal.file_id === undefined ? {} : { originalFileId: currentOriginal.file_id }),
        drawingUrl: receipt.url, ...(receipt.file_id === undefined ? {} : { drawingFileId: receipt.file_id }),
        originalSha: currentOriginal.original_sha256, drawingSha: validated.sha256, originalMime: currentOriginal.original_mime_type,
        originalWidth: currentOriginal.width, originalHeight: currentOriginal.height, drawingWidth: validated.width, drawingHeight: validated.height,
        drawingSize: validated.size, expiresAt: currentOriginal.expires_at, epoch: operation.epoch, originalEpoch: currentOriginal.epoch,
        semanticKey: semantic, originalResolution: currentOriginal };
      this.#records.set(handle, record); const handles = this.#byAttempt.get(request.attemptId) ?? new Set<string>(); handles.add(handle); this.#byAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", drawing_handle: handle, original_handle: request.original_handle, variant: request.variant,
        drawing_mime_type: "image/png", original_mime_type: currentOriginal.original_mime_type, width: validated.width, height: validated.height,
        size: validated.size, sha256: validated.sha256, original_sha256: currentOriginal.original_sha256,
        expires_in_seconds: Math.floor((currentOriginal.expires_at - acknowledgedAt) / 1000), metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" });
    } catch (error) {
      if (error instanceof OwnerSeedreamEditorDrawingReferenceServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome = invoked;
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) { if (invoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); } fail("PRINCIPAL_NOT_LINKED"); }
      if (error instanceof SyntxHttpError && isKnownRejection(error.code)) fail("UPLOAD_REJECTED");
      if (invoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      if (error && typeof error === "object" && "code" in error && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
      if (error && typeof error === "object" && "code" in error && error.code === "INVALID_IMAGE_INPUT") fail("INVALID_IMAGE_INPUT");
      return fail("REFERENCE_UNAVAILABLE");
    } finally {
      if (key !== undefined) { if (unknownOutcome) this.#unknown.add(key); this.#pendingKeys.delete(key); }
      validated?.bytes.fill(0); this.#finish(request.attemptId, operation);
    }
  }

  async resolveDrawing(input: OwnerSeedreamEditorDrawingResolverContext | unknown): Promise<OwnerSeedreamEditorDrawingPrivateResolution> {
    const request = snapshotContext(input); this.#assertOpen(); const operation = this.#begin(request.attempt_id);
    try {
      const profile = this.#assertProfile(request.variant), principal = await this.#principal(request.attempt_id, operation.controller.signal);
      if (!sameGenerationPrincipal(principal, request.principal) || !this.#rememberPrincipal(request.attempt_id, principal)) fail("PRINCIPAL_NOT_LINKED");
      const originalContext = this.#originalContext(principal, request.attempt_id, request.variant, request.original_handle);
      const entry = this.#records.get(request.drawing_handle), now = this.#readNow();
      if (!entry) fail("REFERENCE_UNAVAILABLE");
      if (entry.expiresAt <= now) { this.#remove(entry.handle); fail("REFERENCE_EXPIRED"); }
      const original = await this.#resolveOriginal(originalContext);
      if (original.expires_at <= this.#readNow()) { this.#remove(entry.handle); fail("REFERENCE_EXPIRED"); }
      if (!this.#isOriginal(original, originalContext) || !sameOriginalRecord(original, entry) || entry.handle !== request.drawing_handle ||
        entry.originalHandle !== request.original_handle || entry.attemptId !== request.attempt_id || entry.variant !== request.variant ||
        entry.drawingProfileHash !== profile.profile_schema_hash || entry.epoch !== (this.#epochs.get(request.attempt_id) ?? 0) ||
        entry.expiresAt !== original.expires_at || !sameGenerationPrincipal(entry.principal, principal)) fail("REFERENCE_UNAVAILABLE");
      const after = await this.#principal(request.attempt_id, operation.controller.signal), originalAfter = await this.#resolveOriginal(originalContext);
      if (!sameGenerationPrincipal(principal, after)) { await this.#invalidate(request.attempt_id); fail("PRINCIPAL_NOT_LINKED"); }
      if (!this.#isOriginal(originalAfter, originalContext) || !sameOriginal(original, originalAfter) || entry.expiresAt <= this.#readNow() ||
        this.#records.get(entry.handle) !== entry || entry.epoch !== (this.#epochs.get(request.attempt_id) ?? 0)) fail("REFERENCE_EXPIRED");
      const result: OwnerSeedreamEditorDrawingPrivateResolution = Object.freeze({ role: "editor_drawing", wire_role: "image", extra_role: "image", principal: entry.principal,
        attempt_id: entry.attemptId, variant: entry.variant, original_handle: entry.originalHandle, drawing_handle: entry.handle,
        source_role: "editor_drawing", original_profile_schema_hash: entry.originalProfileHash,
        drawing_profile_schema_hash: entry.drawingProfileHash, source_bindings: profile.source_binding,
        original_file_url: entry.originalUrl, ...(entry.originalFileId === undefined ? {} : { original_file_id: entry.originalFileId }),
        drawing_file_url: entry.drawingUrl, ...(entry.drawingFileId === undefined ? {} : { drawing_file_id: entry.drawingFileId }),
        original_sha256: entry.originalSha, drawing_sha256: entry.drawingSha, original_mime_type: entry.originalMime, drawing_mime_type: "image/png",
        original_width: entry.originalWidth, original_height: entry.originalHeight, drawing_width: entry.drawingWidth, drawing_height: entry.drawingHeight,
        drawing_size: entry.drawingSize, original_expires_at: entry.expiresAt, expires_at: entry.expiresAt,
        original_epoch: entry.originalEpoch, drawing_epoch: entry.epoch,
        metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS", pixel_decode_verified: false, generation_permit: false });
      this.#owned.set(result, { fingerprint: contextFingerprint(request), record: entry }); return result;
    } catch (error) {
      if (error instanceof OwnerSeedreamEditorDrawingReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attempt_id, operation); }
  }

  isOwnedDrawingResolution(value: unknown, context: OwnerSeedreamEditorDrawingResolverContext | unknown): boolean {
    try {
      const request = snapshotContext(context); this.#assertOpen(); if (!value || typeof value !== "object") return false;
      const owned = this.#owned.get(value), record = this.#records.get(request.drawing_handle);
      if (!owned || !record || owned.record !== record || owned.fingerprint !== contextFingerprint(request) || record.attemptId !== request.attempt_id ||
        record.originalHandle !== request.original_handle || record.variant !== request.variant || record.expiresAt <= this.#readNow() ||
        record.epoch !== (this.#epochs.get(request.attempt_id) ?? 0) || !sameGenerationPrincipal(record.principal, request.principal)) return false;
      return this.#assertProfile(request.variant).profile_schema_hash === record.drawingProfileHash &&
        this.#isOriginal(record.originalResolution, this.#originalContext(request.principal, request.attempt_id, request.variant, request.original_handle));
    } catch { return false; }
  }

  async invalidateAttempt(attemptInput: string): Promise<void> {
    const attempt = snapshotAttempt(attemptInput); await this.#invalidate(attempt);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    const attempts = [...this.#activeAttempts()]; this.#closed = true;
    const invalidations = attempts.map((attempt) => this.#invalidate(attempt)), operations = [...this.#all];
    this.#closing = Promise.allSettled([...invalidations, ...operations]).then(() => {
      this.#records.clear(); this.#byAttempt.clear(); this.#pending.clear(); this.#principals.clear();
      this.#epochs.clear(); this.#unknown.clear(); this.#pendingKeys.clear(); this.#invalidations.clear(); this.#invalidating.clear();
    });
    return this.#closing;
  }

  #originalContext(principal: Readonly<GenerationPrincipalRef>, attempt: string, variant: OwnerSeedreamImageVariant, handle: string): OwnerSeedreamEditorOriginalResolverContext {
    const originalProfile = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, this.#catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
      this.#settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
    return Object.freeze({ principal, attempt_id: attempt, variant, form_id: "seedream-editor", source_role: "editor_original",
      public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
      profile_schema_hash: originalProfile.profile_schema_hash, reference_handle: handle });
  }
  async #resolveOriginal(context: OwnerSeedreamEditorOriginalResolverContext): Promise<OwnerSeedreamEditorOriginalPrivateResolution> {
    try { const value = await Reflect.apply(ORIGINAL_RESOLVE, this.#original, [context]);
      if (!this.#isOriginal(value, context)) fail("REFERENCE_UNAVAILABLE"); return value; }
    catch (error) { if (error instanceof OwnerSeedreamEditorDrawingReferenceServiceError) throw error; fail("REFERENCE_UNAVAILABLE"); }
  }
  #isOriginal(value: unknown, context: OwnerSeedreamEditorOriginalResolverContext): value is OwnerSeedreamEditorOriginalPrivateResolution {
    try { return Reflect.apply(ORIGINAL_GUARD, this.#original, [value, context]) === true; } catch { return false; }
  }
  #assertProfile(variant: OwnerSeedreamImageVariant): Readonly<OwnerSeedreamEditorDrawingSourceProfile> {
    const expected = this.#profiles.get(variant); if (!expected) fail("PROFILE_BINDING_MISMATCH");
    try { const original = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, this.#catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
      this.#settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION); const actual = getOwnerSeedreamEditorDrawingSourceProfile(variant, original);
      if (actual.profile_schema_hash !== expected.profile_schema_hash) fail("PROFILE_BINDING_MISMATCH"); return actual; }
    catch { fail("PROFILE_BINDING_MISMATCH"); }
  }
  async #principal(attempt: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED"); let remove = () => {};
    try { const work = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#linkService });
      if (!signal) return await work;
      const aborted = new Promise<never>((_resolve, reject) => { const onAbort = () => reject(new OwnerSeedreamEditorDrawingReferenceServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); } });
      return await Promise.race([work, aborted]);
    } catch (error) { if (error instanceof OwnerSeedreamEditorDrawingReferenceServiceError) throw error; throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED"); }
    finally { remove(); }
  }
  #rememberPrincipal(attempt: string, principal: Readonly<GenerationPrincipalRef>): boolean { const old = this.#principals.get(attempt);
    if (old && !sameGenerationPrincipal(old, principal)) return false; this.#principals.set(attempt, principal); return true; }
  #begin(attempt: string, parent?: AbortSignal, prune = false): Operation {
    this.#assertOpen(); if (this.#invalidating.has(attempt)) fail("REQUEST_ABORTED"); if (prune) this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY"); const active = this.#activeAttempts();
    if (!active.has(attempt) && active.size >= MAX_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pending.get(attempt) ?? new Set<Operation>(), op = { controller, done, finish,
      removeParentAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attempt) ?? 0 };
    pending.add(op); this.#pending.set(attempt, pending); this.#all.add(done); this.#pendingCount += 1; return op;
  }
  #finish(attempt: string, operation: Operation): void { operation.removeParentAbort(); const pending = this.#pending.get(attempt); pending?.delete(operation);
    if (!pending?.size) this.#pending.delete(attempt); this.#pendingCount -= 1; operation.finish(); this.#all.delete(operation.done); this.#maybeRelease(attempt); }
  #activeAttempts(): Set<string> { return new Set([...this.#byAttempt.keys(), ...this.#principals.keys(), ...this.#pending.keys()]); }
  #invalidate(attempt: string): Promise<void> {
    const prior = this.#invalidations.get(attempt); if (prior) return prior;
    this.#invalidating.add(attempt); this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1); this.#removeAttempt(attempt); this.#principals.delete(attempt);
    for (const operation of this.#pending.get(attempt) ?? []) operation.controller.abort();
    const pending = [...(this.#pending.get(attempt) ?? [])].map((operation) => operation.done);
    const done = Promise.allSettled(pending).then(() => undefined).finally(() => {
      this.#invalidating.delete(attempt); this.#invalidations.delete(attempt); this.#maybeRelease(attempt);
    });
    this.#invalidations.set(attempt, done); return done;
  }
  #removeAttempt(attempt: string): void { for (const handle of this.#byAttempt.get(attempt) ?? []) this.#records.delete(handle); this.#byAttempt.delete(attempt); }
  #remove(handle: string): void { const entry = this.#records.get(handle); if (!entry) return; this.#records.delete(handle);
    const handles = this.#byAttempt.get(entry.attemptId); handles?.delete(handle); if (!handles?.size) this.#byAttempt.delete(entry.attemptId); this.#maybeRelease(entry.attemptId); }
  #prune(now: number): void { for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#remove(handle);
    for (const attempt of this.#epochs.keys()) if (!this.#activeAttempts().has(attempt)) this.#epochs.delete(attempt); }
  #maybeRelease(attempt: string): void { if (this.#byAttempt.has(attempt) || this.#pending.has(attempt) || this.#invalidating.has(attempt)) return;
    this.#epochs.delete(attempt); this.#principals.delete(attempt); }
  #throwIfAborted(controller: AbortController): void { this.#assertOpen(); if (controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number { let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number; }
}

function snapshotUpload(input: unknown): Readonly<OwnerSeedreamEditorDrawingUploadInput> {
  const f = exactRecord(input, ["attemptId", "variant", "original_handle", "content_base64", "filename", "mime_type"], ["signal", "original_width", "original_height"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.variant !== "string" ||
    !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(f.variant as OwnerSeedreamImageVariant) || typeof f.original_handle !== "string" || !ORIGINAL_HANDLE.test(f.original_handle) ||
    typeof f.content_base64 !== "string" || typeof f.filename !== "string" || f.mime_type !== "image/png" ||
    (Object.hasOwn(f, "original_width") !== Object.hasOwn(f, "original_height"))) fail("INVALID_REQUEST");
  if (f.signal !== undefined && (types.isProxy(f.signal) || !(f.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, variant: f.variant as OwnerSeedreamImageVariant, original_handle: f.original_handle,
    content_base64: f.content_base64, filename: f.filename, mime_type: "image/png", ...(f.signal === undefined ? {} : { signal: f.signal as AbortSignal }),
    ...(f.original_width === undefined ? {} : { original_width: f.original_width as number, original_height: f.original_height as number }) });
}
function snapshotContext(input: unknown): Readonly<OwnerSeedreamEditorDrawingResolverContext> {
  const f = exactRecord(input, ["principal", "attempt_id", "variant", "original_handle", "drawing_handle"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.variant !== "string" || !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(f.variant as OwnerSeedreamImageVariant) ||
    typeof f.original_handle !== "string" || !ORIGINAL_HANDLE.test(f.original_handle) || typeof f.drawing_handle !== "string" || !DRAWING_HANDLE.test(f.drawing_handle)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(f.principal as GenerationPrincipalRef); } catch { fail("INVALID_REQUEST"); }
  if (principal.connection_id !== f.attempt_id) fail("INVALID_REQUEST");
  return Object.freeze({ principal, attempt_id: f.attempt_id, variant: f.variant as OwnerSeedreamImageVariant, original_handle: f.original_handle, drawing_handle: f.drawing_handle });
}
function snapshotBinding(input: unknown): Readonly<AuthBinding> { const f = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || typeof f.subject !== "string") fail("INVALID_REQUEST"); return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function snapshotAttempt(input: string): string { if (typeof input !== "string" || !ATTEMPT.test(input)) fail("INVALID_REQUEST"); return input; }
function snapshotClient(value: unknown): Readonly<{ client: SyntxChatHttpClient; method: SyntxChatHttpClient["uploadSeedreamEditorDrawing"] }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("PROFILE_BINDING_MISMATCH");
  const proto = Object.getPrototypeOf(value), descriptor = Object.getOwnPropertyDescriptor(proto, "uploadSeedreamEditorDrawing");
  if (proto !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD || typeof descriptor.value !== "function") fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ client: value, method: NATIVE_UPLOAD });
}
function parseUpload(input: unknown): InternalUploadReference { const f = exactRecord(input, ["url"], ["file_id"]);
  if (typeof f.url !== "string" || !isSafeUploadReferenceUrl(f.url) || (f.file_id !== undefined && (typeof f.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(f.file_id)))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: f.url, ...(f.file_id === undefined ? {} : { file_id: f.file_id }) }); }
function semanticKey(principal: Readonly<GenerationPrincipalRef>, variant: OwnerSeedreamImageVariant, original: string, drawing: string, profile: string): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, variant, original_sha256: original, drawing_sha256: drawing, drawing_profile_schema_hash: profile });
}
function contextFingerprint(context: OwnerSeedreamEditorDrawingResolverContext): string { return schemaHash({ principal: context.principal,
  attempt_id: context.attempt_id, variant: context.variant, original_handle: context.original_handle, drawing_handle: context.drawing_handle }); }
function sameOriginal(a: OwnerSeedreamEditorOriginalPrivateResolution, b: OwnerSeedreamEditorOriginalPrivateResolution): boolean {
  return a.reference_handle === b.reference_handle && a.variant === b.variant && a.profile_schema_hash === b.profile_schema_hash &&
    a.original_sha256 === b.original_sha256 && a.expires_at === b.expires_at && a.epoch === b.epoch && sameGenerationPrincipal(a.principal, b.principal);
}
function sameOriginalRecord(original: OwnerSeedreamEditorOriginalPrivateResolution, record: PairRecord): boolean {
  return original.reference_handle === record.originalHandle && original.profile_schema_hash === record.originalProfileHash &&
    original.original_sha256 === record.originalSha && original.file_url === record.originalUrl && original.expires_at === record.expiresAt &&
    original.epoch === record.originalEpoch && original.width === record.originalWidth && original.height === record.originalHeight &&
    original.original_mime_type === record.originalMime && (original.file_id ?? undefined) === record.originalFileId;
}
function isKnownRejection(code: SyntxHttpError["code"]): boolean { return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED"; }
function readClock(value: unknown): () => number { if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let result: unknown; try { result = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED"); return result as number; }; }
function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap; try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) out[key] = descriptors[key]!.value; return out;
}
function isObjectPort(value: unknown): boolean { return !!value && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value); }
function getDataMethod(target: unknown, key: string): unknown { if (!target || typeof target !== "object" || types.isProxy(target)) return undefined;
  let current: object | null = target; try { while (current !== null) { const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined; current = Object.getPrototypeOf(current) as object | null; } } catch { return undefined; } return undefined; }
function fail(code: OwnerSeedreamEditorDrawingReferenceServiceErrorCode): never { throw new OwnerSeedreamEditorDrawingReferenceServiceError(code); }
