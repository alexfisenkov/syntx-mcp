import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import {
  SyntxChatHttpClient,
  isOwnerVideo2AudioOriginalReferenceForClient,
  readOwnerVideo2AudioOriginalReferenceForClient,
  type OwnerVideo2AudioOriginalReference
} from "../adapter/syntx/chat-http-client.js";
import {
  validateOwnerVideo2AudioTrustedUploadDuration
} from "./owner-video2audio-input-parameters.js";
import { validateOwnerVideo2AudioOriginalUploadRequest } from "../adapter/syntx/video2audio-original-codec.js";
import {
  isAuthenticOwnerVideo2AudioSourceProfile,
  type OwnerVideo2AudioSourceProfile
} from "./owner-video2audio-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^video2audio_original_[0-9a-f-]{36}$/u;
const PROFILE_HASH = /^sha256:[a-f0-9]{64}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_ATTEMPTS = 128;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadVideo2AudioOriginal;
const SERVICE_INSTANCES = new WeakSet<object>();
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerVideo2AudioOriginalReferenceService; readonly record: RecordEntry }>();

export interface OwnerVideo2AudioOriginalReferenceServiceOptions {
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerVideo2AudioOriginalUploadInput {
  readonly attemptId: string;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly bytes: Uint8Array;
}

export interface OwnerVideo2AudioOriginalUploadReceipt {
  readonly status: "uploaded";
  readonly video_original_handle: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly duration_seconds: number;
  readonly expires_in_seconds: number;
}

export interface OwnerVideo2AudioOriginalResolveInput {
  readonly attempt_id: string;
  readonly video_original_handle: string;
}

/** Internal owner resolution. It contains no URL or native provider id and is not a generation permit. */
export interface OwnerVideo2AudioOriginalResolution {
  readonly role: "video2audio_original";
  readonly wire_type: "video";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly source_profile_id: OwnerVideo2AudioSourceProfile["profileId"];
  readonly profile_schema_hash: string;
  readonly video_original_handle: string;
  readonly sha256: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly duration_seconds: number;
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}

export type OwnerVideo2AudioOriginalReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED"
  | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";

export class OwnerVideo2AudioOriginalReferenceServiceError extends Error {
  constructor(readonly code: OwnerVideo2AudioOriginalReferenceServiceErrorCode) {
    super("The owner Video2Audio original is unavailable.");
    this.name = "OwnerVideo2AudioOriginalReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profileHash: string;
  readonly sha256: string;
  readonly size: number;
  readonly durationSeconds: number;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly nativeReference: OwnerVideo2AudioOriginalReference;
}

interface NativeClientPort {
  readonly client: SyntxChatHttpClient;
  readonly upload: SyntxChatHttpClient["uploadVideo2AudioOriginal"];
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

/** Process-local owner-bound MP4 handles. Upload receipts never grant generation authority. */
export class OwnerVideo2AudioOriginalReferenceService {
  readonly #profile: OwnerVideo2AudioSourceProfile;
  readonly #profileHash: string;
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: OwnerVideo2AudioOriginalReferenceServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #records = new Map<string, RecordEntry>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  readonly #allOperations = new Set<Promise<void>>();
  #pendingCount = 0;
  #lastNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerVideo2AudioOriginalReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["profile", "binding", "linkService", "resolveClient"], ["now"]);
    if (!isAuthenticOwnerVideo2AudioSourceProfile(fields.profile) || !PROFILE_HASH.test(fields.profile.profileSchemaHash) ||
        !isObjectPort(fields.linkService) || typeof getDataMethod(fields.linkService, "getStatus") !== "function" ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#profile = fields.profile;
    this.#profileHash = fields.profile.profileSchemaHash;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as OwnerVideo2AudioOriginalReferenceServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    SERVICE_INSTANCES.add(this);
    Object.freeze(this);
  }

  async uploadOriginal(input: OwnerVideo2AudioOriginalUploadInput | unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioOriginalUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input, signal);
    const operation = this.#begin(request.attemptId, signal, true);
    let validated: ReturnType<typeof validateOwnerVideo2AudioOriginalUploadRequest> | undefined;
    let uploadBytes: Uint8Array | undefined;
    let semanticKey: string | undefined;
    let nativeInvoked = false;
    let unknownOutcome = false;
    try {
      try {
        validated = validateOwnerVideo2AudioOriginalUploadRequest({ bytes: request.bytes, filename: request.filename, mime_type: request.mime_type }, this.#profile);
      } catch {
        fail("INVALID_REQUEST");
      }
      this.#assertProfile();
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const semantic = getSemanticKey(principal, this.#profileHash, validated.sha256, validated.size);
      semanticKey = semantic;
      if (this.#unknownSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semantic)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic);
      const native = snapshotNativeClient(this.#resolveClient(request.attemptId));
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const expiresAt = issuedAt + TTL_MS;
      uploadBytes = validated.bytes;
      this.#throwIfClosedOrAborted(operation.controller);
      if (this.#invalidating.has(request.attemptId)) fail("REQUEST_ABORTED");

      nativeInvoked = true;
      const nativeReference = await Reflect.apply(native.upload, native.client, [{ bytes: uploadBytes,
        filename: validated.filename, mime_type: validated.mime_type }, operation.controller.signal]);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!isOwnerVideo2AudioOriginalReferenceForClient(native.client, this.#profile, nativeReference)) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const details = readOwnerVideo2AudioOriginalReferenceForClient(native.client, this.#profile, nativeReference);
      if (!details || details.profile_schema_hash !== this.#profileHash || details.sha256 !== validated.sha256 ||
          details.mime_type !== validated.mime_type || details.size !== validated.size) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const duration = validateOwnerVideo2AudioTrustedUploadDuration(details.duration_seconds, this.#profile);
      const acknowledgedAt = this.#readNow();
      if (expiresAt - acknowledgedAt < 1_000 || (this.#epochs.get(request.attemptId) ?? 0) !== operation.epoch ||
          this.#invalidating.has(request.attemptId) || !this.#pendingSemantics.has(semantic)) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal).catch(() => {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      });
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        unknownOutcome = true;
        void this.#invalidate(request.attemptId);
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      this.#assertProfile();
      const handle = `video2audio_original_${randomUUID()}`;
      const record: RecordEntry = Object.freeze({ handle, attemptId: request.attemptId, principal,
        profileHash: this.#profileHash, sha256: validated.sha256, size: validated.size, durationSeconds: duration,
        expiresAt, epoch: operation.epoch, client: native.client, nativeReference });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", video_original_handle: handle, mime_type: "video/mp4", size: record.size,
        sha256: record.sha256, duration_seconds: record.durationSeconds, expires_in_seconds: Math.floor((expiresAt - acknowledgedAt) / 1000) });
    } catch (error) {
      if (error instanceof OwnerVideo2AudioOriginalReferenceServiceError) {
        if (nativeInvoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") {
          unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome ||= nativeInvoked;
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) {
        if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && isKnownRejection(error.code)) fail("UPLOAD_REJECTED");
      if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      throw error;
    } finally {
      if (semanticKey !== undefined) {
        if (unknownOutcome) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      uploadBytes?.fill(0);
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveOriginal(input: OwnerVideo2AudioOriginalResolveInput | unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioOriginalResolution> {
    this.#assertOpen();
    const request = snapshotResolve(input, signal);
    const operation = this.#begin(request.attemptId, signal);
    try {
      this.#assertProfile();
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const record = this.#records.get(request.handle);
      const now = this.#readNow();
      if (!record || record.attemptId !== request.attemptId) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      if (record.epoch !== epoch || record.profileHash !== this.#profileHash ||
          !sameGenerationPrincipal(record.principal, principal) ||
          !isOwnerVideo2AudioOriginalReferenceForClient(record.client, this.#profile, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");
      const details = readOwnerVideo2AudioOriginalReferenceForClient(record.client, this.#profile, record.nativeReference);
      if (!details || details.sha256 !== record.sha256 || details.mime_type !== "video/mp4" || details.size !== record.size ||
          details.duration_seconds !== record.durationSeconds) fail("REFERENCE_UNAVAILABLE");
      await this.#resolvePrincipal(request.attemptId, operation.controller.signal).then((latest) => {
        this.#throwIfClosedOrAborted(operation.controller);
        if (!sameGenerationPrincipal(latest, record.principal)) {
          void this.#invalidate(request.attemptId);
          fail("PRINCIPAL_NOT_LINKED");
        }
      });
      this.#assertProfile();
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch || this.#invalidating.has(request.attemptId)) fail("REFERENCE_EXPIRED");
      const resolution: OwnerVideo2AudioOriginalResolution = Object.freeze({ role: "video2audio_original", wire_type: "video",
        principal: record.principal, attempt_id: record.attemptId, source_profile_id: this.#profile.profileId,
        profile_schema_hash: record.profileHash, video_original_handle: record.handle, sha256: record.sha256,
        mime_type: "video/mp4", size: record.size, duration_seconds: record.durationSeconds, expires_at: record.expiresAt,
        epoch: record.epoch, generation_permit: false });
      RESOLUTIONS.set(resolution, { service: this, record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerVideo2AudioOriginalReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedOriginalResolution(value: unknown, input: OwnerVideo2AudioOriginalResolveInput | unknown): boolean {
    try {
      this.#assertOpen();
      const request = snapshotResolve(input);
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value);
      const record = this.#records.get(request.handle);
      if (!owned || owned.service !== this || !record || owned.record !== record ||
          record.attemptId !== request.attemptId || record.profileHash !== this.#profileHash ||
          record.expiresAt <= this.#readNow() || record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || !isOwnerVideo2AudioOriginalReferenceForClient(record.client, this.#profile, record.nativeReference)) return false;
      return exactResolutionMatches(value, record, this.#profile);
    } catch { return false; }
  }

  /** Internal-only: returns the exact uploaded native witness after the service's nominal guard. */
  getNativeReference(value: unknown, client: unknown): OwnerVideo2AudioOriginalReference {
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value as object) : undefined;
    const native = snapshotNativeClient(client);
    if (!owned || owned.service !== this || owned.record.client !== native.client ||
        !this.isOwnedOriginalResolution(value, { attempt_id: owned.record.attemptId, video_original_handle: owned.record.handle }) ||
        !isOwnerVideo2AudioOriginalReferenceForClient(native.client, this.#profile, owned.record.nativeReference)) fail("REFERENCE_UNAVAILABLE");
    return owned.record.nativeReference;
  }

  /**
   * Narrow internal integration seam for a generation preparer. The supplied
   * resolution must be the fresh result of resolveOriginal; the exact upload
   * client/reference pair is exposed only for the duration of this callback.
   * This does not create a generation permit or extend the input TTL.
   */
  withCapturedNativeOriginal<T>(
    value: unknown,
    input: OwnerVideo2AudioOriginalResolveInput | unknown,
    consume: (client: SyntxChatHttpClient, reference: OwnerVideo2AudioOriginalReference) => T
  ): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const request = snapshotResolve(input);
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value as object) : undefined;
    if (!owned || owned.service !== this || owned.record.attemptId !== request.attemptId || owned.record.handle !== request.handle ||
        !this.isOwnedOriginalResolution(value, input) ||
        !isOwnerVideo2AudioOriginalReferenceForClient(owned.record.client, this.#profile, owned.record.nativeReference)) {
      fail("REFERENCE_UNAVAILABLE");
    }
    return consume(owned.record.client, owned.record.nativeReference);
  }

  invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return Promise.resolve();
    return this.#invalidate(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const attempts = this.#activeAttempts();
    const invalidations = [...attempts].map((attemptId) => this.#invalidate(attemptId));
    const pending = [...this.#allOperations];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
      this.#unknownSemantics.clear(); this.#pendingSemantics.clear(); this.#invalidating.clear(); this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerVideo2AudioOriginalReferenceServiceError("REQUEST_ABORTED"));
    const operation = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return operation;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerVideo2AudioOriginalReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([operation, aborted]).finally(remove);
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const previous = this.#principalByAttempt.get(attemptId);
    if (previous && !sameGenerationPrincipal(previous, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal);
    return true;
  }

  #begin(attemptId: string, parent?: AbortSignal, prune = false): PendingOperation {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    if (prune) this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abort),
      epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done); this.#pendingCount += 1;
    return operation;
  }

  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1; operation.finish(); this.#allOperations.delete(operation.done); this.#maybeRelease(attemptId);
  }

  #activeAttempts(): Set<string> {
    return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]);
  }

  #invalidate(attemptId: string): Promise<void> {
    const prior = this.#invalidations.get(attemptId);
    if (prior) return prior;
    this.#invalidating.add(attemptId);
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptRecords(attemptId);
    this.#principalByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    const done = Promise.allSettled(pending).then(() => {
      this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeRelease(attemptId);
    });
    this.#invalidations.set(attemptId, done);
    return done;
  }

  #removeAttemptRecords(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#records.delete(handle);
    this.#handlesByAttempt.delete(attemptId);
  }

  #removeRecord(handle: string): void {
    const record = this.#records.get(handle);
    if (!record) return;
    this.#records.delete(handle);
    const handles = this.#handlesByAttempt.get(record.attemptId);
    handles?.delete(handle);
    if (!handles?.size) this.#handlesByAttempt.delete(record.attemptId);
    this.#maybeRelease(record.attemptId);
  }

  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeRecord(handle);
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }

  #maybeRelease(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principalByAttempt.delete(attemptId);
  }

  #assertProfile(): void {
    if (!isAuthenticOwnerVideo2AudioSourceProfile(this.#profile) || this.#profile.profileSchemaHash !== this.#profileHash) fail("PROFILE_BINDING_MISMATCH");
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #throwIfClosedOrAborted(operation: PendingOperation["controller"]): void {
    this.#assertOpen();
    if (operation.signal.aborted) fail("REQUEST_ABORTED");
  }
  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 ||
        (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number;
    return value as number;
  }
}

function snapshotUpload(input: unknown, signal?: AbortSignal): Readonly<OwnerVideo2AudioOriginalUploadInput> {
  const fields = exactRecord(input, ["attemptId", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.filename !== "string" ||
      fields.mime_type !== "video/mp4" || !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes) ||
      (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, filename: fields.filename, mime_type: "video/mp4", bytes: fields.bytes });
}

function snapshotResolve(input: unknown, signal?: AbortSignal): Readonly<{ attemptId: string; handle: string }> {
  const fields = exactRecord(input, ["attempt_id", "video_original_handle"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) || typeof fields.video_original_handle !== "string" ||
      !HANDLE.test(fields.video_original_handle) || (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attempt_id, handle: fields.video_original_handle });
}

function snapshotNativeClient(value: unknown): NativeClientPort {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof SyntxChatHttpClient)) fail("PROFILE_BINDING_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "uploadVideo2AudioOriginal");
  if (prototype !== SyntxChatHttpClient.prototype || !descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD ||
      typeof descriptor.value !== "function") fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ client: value, upload: NATIVE_UPLOAD });
}

function exactResolutionMatches(value: object, record: RecordEntry, profile: OwnerVideo2AudioSourceProfile): boolean {
  const f = exactRecord(value, ["role", "wire_type", "principal", "attempt_id", "source_profile_id", "profile_schema_hash",
    "video_original_handle", "sha256", "mime_type", "size", "duration_seconds", "expires_at", "epoch", "generation_permit"]);
  return f.role === "video2audio_original" && f.wire_type === "video" && f.attempt_id === record.attemptId &&
    f.source_profile_id === profile.profileId && f.profile_schema_hash === record.profileHash && f.video_original_handle === record.handle &&
    f.sha256 === record.sha256 && f.mime_type === "video/mp4" && f.size === record.size &&
    f.duration_seconds === record.durationSeconds && f.expires_at === record.expiresAt && f.epoch === record.epoch && f.generation_permit === false &&
    isSamePrincipal(f.principal, record.principal);
}

function isSamePrincipal(value: unknown, expected: Readonly<GenerationPrincipalRef>): boolean {
  try { return sameGenerationPrincipal(snapshotGenerationPrincipal(value as GenerationPrincipalRef), expected); } catch { return false; }
}

function getSemanticKey(principal: Readonly<GenerationPrincipalRef>, profileHash: string, sha256: string, size: number): string {
  return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, model_id: "video2audio",
    profile_schema_hash: profileHash, sha256, mime_type: "video/mp4", size });
}

function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length === 0 || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || fields.subject.length === 0 || fields.subject.length > 512) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); }
  catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isObjectPort(value: unknown): value is object { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => {
    let result: unknown;
    try { result = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED");
    return result as number;
  };
}
function isKnownRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function fail(code: OwnerVideo2AudioOriginalReferenceServiceErrorCode): never { throw new OwnerVideo2AudioOriginalReferenceServiceError(code); }
