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
  OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  getOwnerSeedreamEditorOriginalUploadSourceProfile, type OwnerSeedreamEditorOriginalUploadCatalogPort,
  type OwnerSeedreamEditorOriginalUploadSourceProfile
} from "./owner-seedream-editor-original-upload-source-profile.js";
import {
  validateOwnerSeedreamEditorOriginalInput, type OwnerSeedreamEditorOriginalMimeType,
  type ValidatedOwnerSeedreamEditorOriginal
} from "./owner-seedream-editor-original-validator.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^seedream_editor_original_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000, MAX_RECORDS = 128, MAX_ATTEMPTS = 128, MAX_PENDING = 4;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadSeedreamEditorOriginal;

export interface OwnerSeedreamEditorOriginalReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly catalog: OwnerSeedreamEditorOriginalUploadCatalogPort;
  readonly public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION;
  readonly settings_inventory: MaplessSettingsInventory;
  readonly settings_inventory_version: typeof OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerSeedreamEditorOriginalUploadInput {
  readonly attemptId: string; readonly variant: OwnerSeedreamImageVariant; readonly content_base64: string;
  readonly filename: string; readonly mime_type: OwnerSeedreamEditorOriginalMimeType; readonly signal?: AbortSignal;
}
export interface OwnerSeedreamEditorOriginalUploadReceipt {
  readonly status: "uploaded"; readonly reference_handle: string; readonly variant: OwnerSeedreamImageVariant;
  readonly original_mime_type: OwnerSeedreamEditorOriginalMimeType; readonly mime_type: string; readonly width: number;
  readonly height: number; readonly size: number; readonly sha256: `sha256:${string}`;
  readonly expires_in_seconds: number; readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly validation_confidence: ValidatedOwnerSeedreamEditorOriginal["validation_confidence"];
}
export interface OwnerSeedreamEditorOriginalResolverContext {
  readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string; readonly variant: OwnerSeedreamImageVariant;
  readonly form_id: "seedream-editor"; readonly source_role: "editor_original";
  readonly public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION;
  readonly profile_schema_hash: string; readonly reference_handle: string;
}
export interface OwnerSeedreamEditorOriginalPrivateResolution {
  readonly role: "editor_original"; readonly wire_type: "image"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string; readonly variant: OwnerSeedreamImageVariant; readonly form_id: "seedream-editor";
  readonly source_role: "editor_original"; readonly public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION; readonly profile_schema_hash: string;
  readonly reference_handle: string; readonly file_url: string; readonly file_id?: string;
  readonly original_mime_type: OwnerSeedreamEditorOriginalMimeType; readonly mime_type: string; readonly width: number;
  readonly height: number; readonly size: number; readonly original_sha256: `sha256:${string}`;
  readonly expires_at: number; readonly epoch: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS"; readonly generation_permit: false;
}
export type OwnerSeedreamEditorOriginalReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "INVALID_IMAGE_INPUT" | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "PRINCIPAL_NOT_LINKED"
  | "PROFILE_BINDING_MISMATCH" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "REQUEST_ABORTED"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN";
export class OwnerSeedreamEditorOriginalReferenceServiceError extends Error {
  constructor(readonly code: OwnerSeedreamEditorOriginalReferenceServiceErrorCode) {
    super("The Seedream Editor original reference is unavailable.");
    this.name = "OwnerSeedreamEditorOriginalReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly variant: OwnerSeedreamImageVariant; readonly profileHash: string; readonly fileUrl: string; readonly fileId?: string;
  readonly originalMime: OwnerSeedreamEditorOriginalMimeType; readonly mime: string; readonly width: number; readonly height: number;
  readonly size: number; readonly sha256: `sha256:${string}`; readonly expiresAt: number; readonly epoch: number;
}
interface Operation { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void;
  readonly removeParentAbort: () => void; readonly epoch: number; }

/** Process-local source-issued Editor originals; this service does not issue ordinary Seedream references or generation permission. */
export class OwnerSeedreamEditorOriginalReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #catalog: OwnerSeedreamEditorOriginalUploadCatalogPort; readonly #settings: MaplessSettingsInventory;
  readonly #resolveClient: OwnerSeedreamEditorOriginalReferenceServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profiles = new Map<OwnerSeedreamImageVariant, Readonly<OwnerSeedreamEditorOriginalUploadSourceProfile>>();
  readonly #records = new Map<string, RecordEntry>(); readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>(); readonly #pending = new Map<string, Set<Operation>>();
  readonly #epochs = new Map<string, number>(); readonly #unknown = new Set<string>();
  readonly #pendingKeys = new Set<string>(); readonly #ownedResolutions = new WeakMap<object, { fingerprint: string; record: RecordEntry }>();
  readonly #invalidating = new Set<string>(); readonly #invalidations = new Map<string, Promise<void>>();
  readonly #allOperations = new Set<Promise<void>>(); #pendingCount = 0; #lastNow: number | undefined;
  #closed = false; #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerSeedreamEditorOriginalReferenceServiceOptions | unknown) {
    const f = exactRecord(optionsInput, ["binding", "linkService", "catalog", "public_catalog_version", "settings_inventory",
      "settings_inventory_version", "resolveClient"], ["now"]);
    if (f.public_catalog_version !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION ||
        f.settings_inventory_version !== OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION || !isObjectPort(f.linkService) ||
        !getDataMethod(f.linkService, "getStatus") || !isObjectPort(f.catalog) || !isObjectPort(f.settings_inventory) ||
        typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) ||
        (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#binding = snapshotBinding(f.binding); this.#linkService = f.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#catalog = f.catalog as OwnerSeedreamEditorOriginalUploadCatalogPort;
    this.#settings = f.settings_inventory as MaplessSettingsInventory;
    this.#resolveClient = f.resolveClient as OwnerSeedreamEditorOriginalReferenceServiceOptions["resolveClient"];
    this.#now = f.now === undefined ? Date.now : readClock(f.now);
    try {
      for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) this.#profiles.set(variant,
        getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, this.#catalog, OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
          this.#settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION));
    } catch { fail("PROFILE_BINDING_MISMATCH"); }
  }

  async upload(input: OwnerSeedreamEditorOriginalUploadInput | unknown): Promise<OwnerSeedreamEditorOriginalUploadReceipt> {
    const request = snapshotUpload(input); this.#assertOpen(); this.#assertProfile(request.variant);
    const operation = this.#begin(request.attemptId, request.signal, true);
    let validated: ValidatedOwnerSeedreamEditorOriginal | undefined, semantic: string | undefined;
    let invoked = false, unknownOutcome = false;
    try {
      validated = validateOwnerSeedreamEditorOriginalInput({ variant: request.variant, content_base64: request.content_base64,
        filename: request.filename, mime_type: request.mime_type });
      const profile = this.#assertProfile(request.variant);
      if (!profile.input_policy.accepted_file_types.includes(validated.source_mime_type) ||
          validated.size > profile.input_policy.source_ui_max_file_bytes || profile.input_policy.max_file_count !== 1 ||
          profile.input_policy.destination !== "uploaded" || profile.input_policy.check_duplicates !== true) fail("PROFILE_BINDING_MISMATCH");
      this.#throwIfClosedOrAborted(operation.controller);
      const principal = await this.#principal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const key = semanticKey(principal, request.variant, validated.sha256, profile.profile_schema_hash);
      if (this.#unknown.has(key)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingKeys.has(key)) fail("SERVICE_BUSY");
      if (this.#records.size + this.#unknown.size + this.#pendingKeys.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingKeys.add(key); semantic = key;
      const native = snapshotClient(this.#resolveClient(request.attemptId));
      const issued = this.#readNow(); if (issued > Number.MAX_SAFE_INTEGER - TTL) fail("SERVICE_CLOSED");
      const expiresAt = issued + TTL, epoch = operation.epoch;
      const nativeRequest = Object.freeze({ variant: request.variant, bytes: validated.bytes, filename: validated.filename,
        mime_type: validated.mime_type });
      this.#throwIfClosedOrAborted(operation.controller);
      if (this.#invalidating.has(request.attemptId)) fail("REQUEST_ABORTED");
      invoked = true;
      const receipt = parseUpload(await Reflect.apply(native.method, native.client, [nativeRequest, operation.controller.signal]));
      this.#throwIfClosedOrAborted(operation.controller);
      const current = await this.#principal(request.attemptId, operation.controller.signal);
      if (!sameGenerationPrincipal(principal, current)) { this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      this.#assertProfile(request.variant);
      const acknowledgedAt = this.#readNow();
      if (expiresAt - acknowledgedAt < 1_000) fail("UPLOAD_OUTCOME_UNKNOWN");
      if ((this.#epochs.get(request.attemptId) ?? 0) !== epoch || this.#invalidating.has(request.attemptId) ||
          this.#pendingKeys.has(key) === false) fail("UPLOAD_OUTCOME_UNKNOWN");
      const handle = `seedream_editor_original_${randomUUID()}`;
      const entry: RecordEntry = { handle, attemptId: request.attemptId, principal, variant: request.variant,
        profileHash: profile.profile_schema_hash, fileUrl: receipt.url, ...(receipt.file_id === undefined ? {} : { fileId: receipt.file_id }),
        originalMime: validated.source_mime_type, mime: validated.mime_type, width: validated.width, height: validated.height,
        size: validated.size, sha256: validated.sha256, expiresAt, epoch };
      this.#records.set(handle, entry);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>(); handles.add(handle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", reference_handle: handle, variant: request.variant,
        original_mime_type: validated.source_mime_type, mime_type: validated.mime_type, width: validated.width,
        height: validated.height, size: validated.size, sha256: validated.sha256, expires_in_seconds: Math.floor((expiresAt - acknowledgedAt) / 1000),
        metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS", validation_confidence: validated.validation_confidence });
    } catch (error) {
      if (error instanceof OwnerSeedreamEditorOriginalReferenceServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") {
          unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome = invoked;
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) {
        if (invoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && isKnownRejection(error.code)) fail("UPLOAD_REJECTED");
      if (invoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      if (error && typeof error === "object" && "code" in error && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED") fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
      if (error && typeof error === "object" && "code" in error && error.code === "UNSUPPORTED_IMAGE_COMPOSITION") fail("INVALID_IMAGE_INPUT");
      if (error && typeof error === "object" && "code" in error && error.code === "INVALID_IMAGE_INPUT") fail("INVALID_IMAGE_INPUT");
      return fail("INVALID_REQUEST");
    } finally {
      if (semantic !== undefined) { if (unknownOutcome) this.#unknown.add(semantic); this.#pendingKeys.delete(semantic); }
      validated?.bytes.fill(0); this.#finish(request.attemptId, operation);
    }
  }

  async resolveOriginal(input: OwnerSeedreamEditorOriginalResolverContext | unknown): Promise<OwnerSeedreamEditorOriginalPrivateResolution> {
    const request = snapshotContext(input); this.#assertOpen(); const operation = this.#begin(request.attempt_id);
    try {
      const profile = this.#assertProfile(request.variant);
      const principal = await this.#principal(request.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, request.principal)) fail("PRINCIPAL_NOT_LINKED");
      if (!this.#rememberPrincipal(request.attempt_id, principal)) fail("PRINCIPAL_NOT_LINKED");
      const entry = this.#records.get(request.reference_handle), now = this.#readNow();
      if (!entry) fail("REFERENCE_UNAVAILABLE");
      if (entry.expiresAt <= now) { this.#remove(entry.handle); fail("REFERENCE_EXPIRED"); }
      const epoch = this.#epochs.get(request.attempt_id) ?? 0;
      if (entry.attemptId !== request.attempt_id || entry.variant !== request.variant || entry.epoch !== epoch ||
          entry.profileHash !== request.profile_schema_hash || entry.profileHash !== profile.profile_schema_hash ||
          !sameGenerationPrincipal(entry.principal, principal) || !isSafeUploadReferenceUrl(entry.fileUrl)) fail("REFERENCE_UNAVAILABLE");
      const current = await this.#principal(request.attempt_id, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, current)) { this.#invalidate(request.attempt_id); fail("PRINCIPAL_NOT_LINKED"); }
      this.#assertProfile(request.variant);
      if (entry.expiresAt <= this.#readNow() || this.#records.get(entry.handle) !== entry ||
          (this.#epochs.get(request.attempt_id) ?? 0) !== epoch || this.#invalidating.has(request.attempt_id)) fail("REFERENCE_EXPIRED");
      const result: OwnerSeedreamEditorOriginalPrivateResolution = Object.freeze({ role: "editor_original", wire_type: "image",
        principal: entry.principal, attempt_id: entry.attemptId, variant: entry.variant, form_id: "seedream-editor",
        source_role: "editor_original", public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
        settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION, profile_schema_hash: entry.profileHash,
        reference_handle: entry.handle, file_url: entry.fileUrl, ...(entry.fileId === undefined ? {} : { file_id: entry.fileId }),
        original_mime_type: entry.originalMime, mime_type: entry.mime, width: entry.width, height: entry.height, size: entry.size,
        original_sha256: entry.sha256, expires_at: entry.expiresAt, epoch: entry.epoch,
        metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS", generation_permit: false });
      this.#ownedResolutions.set(result, { fingerprint: requestFingerprint(request), record: entry }); return result;
    } catch (error) {
      if (error instanceof OwnerSeedreamEditorOriginalReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attempt_id, operation); }
  }

  isOwnedOriginalResolution(value: unknown, context: OwnerSeedreamEditorOriginalResolverContext | unknown): boolean {
    try { const request = snapshotContext(context); this.#assertOpen();
      if (!value || typeof value !== "object") return false;
      const owned = this.#ownedResolutions.get(value), entry = this.#records.get(request.reference_handle);
      if (!owned || !entry || owned.fingerprint !== requestFingerprint(request) || owned.record !== entry ||
          entry.attemptId !== request.attempt_id || entry.variant !== request.variant || entry.profileHash !== request.profile_schema_hash ||
          entry.expiresAt <= this.#readNow() || entry.epoch !== (this.#epochs.get(request.attempt_id) ?? 0)) return false;
      return this.#assertProfile(request.variant).profile_schema_hash === entry.profileHash &&
        sameGenerationPrincipal(entry.principal, request.principal);
    } catch { return false; }
  }

  /** Trusted lifecycle cleanup hook; not an MCP/user-authorized invalidation endpoint. */
  invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) return Promise.resolve();
    return this.#invalidate(attemptId);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true; const attempts = this.#activeAttempts();
    const invalidations = [...attempts].map((attempt) => this.#invalidate(attempt)); const pending = [...this.#allOperations];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#principals.clear(); this.#pending.clear();
      this.#epochs.clear(); this.#unknown.clear(); this.#pendingKeys.clear(); this.#invalidating.clear();
      this.#invalidations.clear(); this.#allOperations.clear();
    }); return this.#closing;
  }

  #assertProfile(variant: OwnerSeedreamImageVariant): Readonly<OwnerSeedreamEditorOriginalUploadSourceProfile> {
    this.#assertOpen(); const expected = this.#profiles.get(variant); if (!expected) fail("PROFILE_BINDING_MISMATCH");
    try { const actual = getOwnerSeedreamEditorOriginalUploadSourceProfile(variant, this.#catalog,
      OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION, this.#settings, OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION);
      if (actual.profile_schema_hash !== expected.profile_schema_hash) fail("PROFILE_BINDING_MISMATCH"); return actual;
    } catch { return fail("PROFILE_BINDING_MISMATCH"); }
  }
  async #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED"); let remove = () => {};
    try { const work = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
      if (!signal) return await work;
      const aborted = new Promise<never>((_resolve, reject) => { const onAbort = () => reject(new OwnerSeedreamEditorOriginalReferenceServiceError("REQUEST_ABORTED"));
        if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); } });
      return await Promise.race([work, aborted]);
    } catch (error) { if (error instanceof OwnerSeedreamEditorOriginalReferenceServiceError) throw error;
      throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED"); } finally { remove(); }
  }
  #rememberPrincipal(attempt: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const old = this.#principals.get(attempt); if (old && !sameGenerationPrincipal(old, principal)) return false;
    this.#principals.set(attempt, principal); return true;
  }
  #begin(attempt: string, parent?: AbortSignal, prune = false): Operation {
    this.#assertOpen(); if (this.#invalidating.has(attempt)) fail("REQUEST_ABORTED");
    if (prune) this.#prune(this.#readNow()); if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts(); if (!active.has(attempt) && active.size >= MAX_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pending.get(attempt) ?? new Set<Operation>();
    const op = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attempt) ?? 0 };
    pending.add(op); this.#pending.set(attempt, pending); this.#allOperations.add(done); this.#pendingCount += 1; return op;
  }
  #finish(attempt: string, op: Operation): void {
    op.removeParentAbort(); const pending = this.#pending.get(attempt); pending?.delete(op);
    if (!pending?.size) this.#pending.delete(attempt); this.#pendingCount -= 1; op.finish(); this.#allOperations.delete(op.done); this.#maybeRelease(attempt);
  }
  #activeAttempts(): Set<string> { return new Set([...this.#handlesByAttempt.keys(), ...this.#principals.keys(), ...this.#pending.keys()]); }
  #invalidate(attempt: string): Promise<void> {
    const prior = this.#invalidations.get(attempt); if (prior) return prior;
    this.#invalidating.add(attempt); this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1); this.#removeAttempt(attempt);
    this.#principals.delete(attempt); for (const op of this.#pending.get(attempt) ?? []) op.controller.abort();
    const pending = [...(this.#pending.get(attempt) ?? [])].map((op) => op.done);
    const done = Promise.allSettled(pending).then(() => { this.#invalidating.delete(attempt); this.#invalidations.delete(attempt); this.#maybeRelease(attempt); });
    this.#invalidations.set(attempt, done); return done;
  }
  #removeAttempt(attempt: string): void { for (const handle of this.#handlesByAttempt.get(attempt) ?? []) this.#records.delete(handle); this.#handlesByAttempt.delete(attempt); }
  #remove(handle: string): void { const record = this.#records.get(handle); if (!record) return; this.#records.delete(handle);
    const set = this.#handlesByAttempt.get(record.attemptId); set?.delete(handle); if (!set?.size) this.#handlesByAttempt.delete(record.attemptId); this.#maybeRelease(record.attemptId); }
  #prune(now: number): void { for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#remove(handle);
    for (const attempt of this.#epochs.keys()) if (!this.#activeAttempts().has(attempt)) this.#epochs.delete(attempt); }
  #maybeRelease(attempt: string): void { if (this.#handlesByAttempt.has(attempt) || this.#pending.has(attempt) || this.#invalidating.has(attempt)) return;
    this.#epochs.delete(attempt); this.#principals.delete(attempt); }
  #throwIfClosedOrAborted(op: Operation["controller"]): void { this.#assertOpen(); if (op.signal.aborted) fail("REQUEST_ABORTED"); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number { let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow) ||
        (value as number) > Number.MAX_SAFE_INTEGER) fail("SERVICE_CLOSED"); this.#lastNow = value as number; return value as number; }
}

function snapshotUpload(input: unknown): Readonly<OwnerSeedreamEditorOriginalUploadInput> {
  const f = exactRecord(input, ["attemptId", "variant", "content_base64", "filename", "mime_type"], ["signal"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.variant !== "string" ||
      !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(f.variant as OwnerSeedreamImageVariant) || typeof f.content_base64 !== "string" ||
      typeof f.filename !== "string" || typeof f.mime_type !== "string") fail("INVALID_REQUEST");
  if (f.signal !== undefined && (types.isProxy(f.signal) || !(f.signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, variant: f.variant as OwnerSeedreamImageVariant,
    content_base64: f.content_base64, filename: f.filename, mime_type: f.mime_type as OwnerSeedreamEditorOriginalMimeType,
    ...(f.signal === undefined ? {} : { signal: f.signal as AbortSignal }) });
}
function snapshotContext(input: unknown): Readonly<OwnerSeedreamEditorOriginalResolverContext> {
  const f = exactRecord(input, ["principal", "attempt_id", "variant", "form_id", "source_role", "public_catalog_version",
    "settings_inventory_version", "profile_schema_hash", "reference_handle"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.variant !== "string" ||
      !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(f.variant as OwnerSeedreamImageVariant) || f.form_id !== "seedream-editor" ||
      f.source_role !== "editor_original" || f.public_catalog_version !== OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION ||
      f.settings_inventory_version !== OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION || typeof f.profile_schema_hash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(f.profile_schema_hash) || typeof f.reference_handle !== "string" || !HANDLE.test(f.reference_handle)) fail("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>; try { principal = snapshotGenerationPrincipal(f.principal as GenerationPrincipalRef); }
  catch { fail("INVALID_REQUEST"); } if (principal.connection_id !== f.attempt_id) fail("INVALID_REQUEST");
  return Object.freeze({ principal, attempt_id: f.attempt_id, variant: f.variant as OwnerSeedreamImageVariant,
    form_id: "seedream-editor", source_role: "editor_original", public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION, profile_schema_hash: f.profile_schema_hash,
    reference_handle: f.reference_handle });
}
function snapshotBinding(input: unknown): Readonly<AuthBinding> { const f = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || typeof f.subject !== "string") fail("INVALID_REQUEST"); return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function snapshotClient(value: unknown): Readonly<{ client: SyntxChatHttpClient; method: SyntxChatHttpClient["uploadSeedreamEditorOriginal"] }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("PROFILE_BINDING_MISMATCH");
  const proto = Object.getPrototypeOf(value), descriptor = Object.getOwnPropertyDescriptor(proto, "uploadSeedreamEditorOriginal");
  if (proto !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD ||
      typeof descriptor.value !== "function") fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ client: value, method: NATIVE_UPLOAD });
}
function parseUpload(input: unknown): InternalUploadReference { const f = exactRecord(input, ["url"], ["file_id"]);
  if (typeof f.url !== "string" || !isSafeUploadReferenceUrl(f.url) || (f.file_id !== undefined &&
      (typeof f.file_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(f.file_id)))) fail("UPLOAD_OUTCOME_UNKNOWN");
  return Object.freeze({ url: f.url, ...(f.file_id === undefined ? {} : { file_id: f.file_id }) }); }
function semanticKey(principal: Readonly<GenerationPrincipalRef>, variant: OwnerSeedreamImageVariant, sha256: string, profileHash: string): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, variant, sha256, profile_schema_hash: profileHash });
}
function requestFingerprint(context: OwnerSeedreamEditorOriginalResolverContext): string { return schemaHash({ principal: context.principal,
  attempt_id: context.attempt_id, variant: context.variant, form_id: context.form_id, source_role: context.source_role,
  public_catalog_version: context.public_catalog_version, settings_inventory_version: context.settings_inventory_version,
  profile_schema_hash: context.profile_schema_hash, reference_handle: context.reference_handle }); }
function isKnownRejection(code: SyntxHttpError["code"]): boolean { return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED"; }
function readClock(value: unknown): () => number { if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let result: unknown; try { result = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED"); return result as number; }; }
function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) out[key] = descriptors[key]!.value; return out;
}
function isObjectPort(value: unknown): boolean { return !!value && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value); }
function getDataMethod(target: unknown, key: string): unknown {
  if (!target || typeof target !== "object" || types.isProxy(target)) return undefined;
  let current: object | null = target;
  try { while (current !== null) { const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current) as object | null; }
  } catch { return undefined; }
  return undefined;
}
function fail(code: OwnerSeedreamEditorOriginalReferenceServiceErrorCode): never { throw new OwnerSeedreamEditorOriginalReferenceServiceError(code); }
