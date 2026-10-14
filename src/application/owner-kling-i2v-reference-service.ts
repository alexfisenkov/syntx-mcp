import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import type { SyntxChatHttpClient, SyntxUploadDestination } from "../adapter/syntx/chat-http-client.js";
import {
  OwnerKlingI2VImageInputError,
  validateOwnerKlingI2VImageInput,
  type OwnerKlingI2VCanonicalMimeType
} from "./owner-kling-i2v-input-policy.js";
import type { OwnerKlingI2VUploadContext } from "../adapter/syntx/kling-i2v-upload-context.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^kling_i2v_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_ATTEMPTS = 128;
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerKlingI2VImageReferenceService; readonly record: ImageRecord }>();

export interface OwnerKlingI2VImageReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly destination: SyntxUploadDestination;
  readonly now?: () => number;
}

export interface OwnerKlingI2VImageUploadInput {
  readonly attemptId: string;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}

export interface OwnerKlingI2VImageUploadReceipt {
  readonly status: "uploaded";
  readonly image_handle: string;
  readonly model_id: "kling_image2video";
  readonly mime_type: OwnerKlingI2VCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: number;
  readonly input_acceptance: "SOURCE_FORMAT_DECLARED_PROVIDER_ACCEPTANCE_UNVERIFIED";
}

export interface OwnerKlingI2VImageResolveInput {
  readonly attempt_id: string;
  readonly image_handle: string;
}

/** Internal nominal resolution; never expose it as an MCP DTO or treat it as a generation permit. */
export interface OwnerKlingI2VImageResolution {
  readonly role: "kling_i2v_image";
  readonly wire_type: "image";
  readonly model_id: "kling_image2video";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly image_handle: string;
  readonly destination: SyntxUploadDestination;
  readonly sha256: string;
  readonly mime_type: OwnerKlingI2VCanonicalMimeType;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}

export type OwnerKlingI2VImageReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED"
  | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";

export class OwnerKlingI2VImageReferenceServiceError extends Error {
  constructor(readonly code: OwnerKlingI2VImageReferenceServiceErrorCode) {
    super("The owner Kling I2V image reference could not be established safely.");
    this.name = "OwnerKlingI2VImageReferenceServiceError";
  }
}

interface ImageRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly semanticKey: string;
  readonly sha256: string;
  readonly size: number;
  readonly mimeType: OwnerKlingI2VCanonicalMimeType;
  readonly width: number;
  readonly height: number;
  readonly destination: SyntxUploadDestination;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly uploadContext: OwnerKlingI2VUploadContext;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

/** Process-local owner-bound Kling image handles. No method invokes generation. */
export class OwnerKlingI2VImageReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: OwnerKlingI2VImageReferenceServiceOptions["resolveClient"];
  readonly #destination: SyntxUploadDestination;
  readonly #now: () => number;
  readonly #records = new Map<string, ImageRecord>();
  readonly #knownSemantics = new Map<string, string>();
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

  constructor(optionsInput: OwnerKlingI2VImageReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "resolveClient", "destination"], ["now"]);
    if (!isObjectPort(fields.linkService) || typeof getDataMethod(fields.linkService, "getStatus") !== "function" ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        fields.destination !== "hidden" && fields.destination !== "uploaded" ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as OwnerKlingI2VImageReferenceServiceOptions["resolveClient"];
    this.#destination = fields.destination;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    Object.freeze(this);
  }

  async upload(input: OwnerKlingI2VImageUploadInput | unknown, signal?: AbortSignal): Promise<OwnerKlingI2VImageUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input, signal);
    const operation = this.#begin(request.attemptId, signal, true);
    let unknownOutcome = false;
    let semanticKey: string | undefined;
    let nativeInvoked = false;
    try {
      let validated: ReturnType<typeof validateOwnerKlingI2VImageInput>;
      try { validated = validateOwnerKlingI2VImageInput({ content_base64: request.content_base64, filename: request.filename, mime_type: request.mime_type }); }
      catch (error) {
        if (error instanceof OwnerKlingI2VImageInputError) fail("INVALID_REQUEST");
        fail("INVALID_REQUEST");
      }
      this.#throwIfClosedOrAborted(operation.controller);
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      semanticKey = getSemanticKey(principal, validated.sha256, validated.size, validated.mime_type, this.#destination);
      if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      const intentKey = `${request.attemptId}:${semanticKey}`;
      const existingHandle = this.#knownSemantics.get(intentKey);
      if (existingHandle) {
        const existing = this.#records.get(existingHandle);
        if (existing && existing.expiresAt > this.#readNow() && existing.epoch === operation.epoch &&
            sameGenerationPrincipal(existing.principal, principal)) return receiptFor(existing, this.#readNow());
      }
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semanticKey);
      const client = await snapshotNativeClient(this.#resolveClient(request.attemptId));
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const expiresAt = issuedAt + TTL_MS;
      this.#throwIfClosedOrAborted(operation.controller);
      if (this.#invalidating.has(request.attemptId)) fail("REQUEST_ABORTED");
      nativeInvoked = true;
      const uploadContext = await uploadKlingI2VImage(client, {
        content_base64: request.content_base64, filename: request.filename, mime_type: request.mime_type
      }, this.#destination, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      const privateReference = await readKlingI2VUploadReference(client, uploadContext);
      if (!privateReference || uploadContext.model_id !== "kling_image2video" || uploadContext.destination !== this.#destination ||
          uploadContext.source_sha256 !== validated.sha256 || uploadContext.source_size !== validated.size ||
          uploadContext.source_mime_type !== validated.mime_type || uploadContext.width !== validated.width || uploadContext.height !== validated.height) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const acknowledgedAt = this.#readNow();
      if (expiresAt - acknowledgedAt < 1_000 || (this.#epochs.get(request.attemptId) ?? 0) !== operation.epoch ||
          this.#invalidating.has(request.attemptId) || !this.#pendingSemantics.has(semanticKey)) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal).catch(() => {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      });
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        unknownOutcome = true; void this.#invalidate(request.attemptId); fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const handle = `kling_i2v_image_${randomUUID()}`;
      const record: ImageRecord = Object.freeze({ handle, attemptId: request.attemptId, principal, semanticKey,
        sha256: validated.sha256, size: validated.size, mimeType: validated.mime_type, width: validated.width, height: validated.height,
        destination: this.#destination, expiresAt, epoch: operation.epoch, client, uploadContext });
      this.#records.set(handle, record);
      this.#knownSemantics.set(intentKey, handle);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      return receiptFor(record, acknowledgedAt);
    } catch (error) {
      if (error instanceof OwnerKlingI2VImageReferenceServiceError) {
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
      if (nativeInvoked) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      throw error;
    } finally {
      if (semanticKey !== undefined) {
        if (unknownOutcome) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      this.#finish(request.attemptId, operation);
    }
  }

  async resolve(input: OwnerKlingI2VImageResolveInput | unknown, signal?: AbortSignal): Promise<OwnerKlingI2VImageResolution> {
    this.#assertOpen();
    const request = snapshotResolve(input, signal);
    const operation = this.#begin(request.attemptId, signal);
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const record = this.#records.get(request.handle);
      if (!record || record.attemptId !== request.attemptId) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      if (record.epoch !== epoch || !sameGenerationPrincipal(record.principal, principal) ||
          !(await readKlingI2VUploadReference(record.client, record.uploadContext))) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!sameGenerationPrincipal(latest, record.principal)) { void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          (this.#epochs.get(request.attemptId) ?? 0) !== epoch || this.#invalidating.has(request.attemptId)) fail("REFERENCE_EXPIRED");
      const resolution: OwnerKlingI2VImageResolution = Object.freeze({ role: "kling_i2v_image", wire_type: "image",
        model_id: "kling_image2video", principal: record.principal, attempt_id: record.attemptId, image_handle: record.handle,
        destination: record.destination, sha256: record.sha256, mime_type: record.mimeType, size: record.size,
        width: record.width, height: record.height, expires_at: record.expiresAt, epoch: record.epoch, generation_permit: false });
      RESOLUTIONS.set(resolution, { service: this, record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerKlingI2VImageReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) { void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  /** Gives a trusted internal consumer the exact recorded upload context for the callback lifetime only. */
  async withCapturedNativeImage<T>(
    resolutionInput: unknown,
    input: OwnerKlingI2VImageResolveInput | unknown,
    consume: (client: SyntxChatHttpClient, context: OwnerKlingI2VUploadContext, signal: AbortSignal) => T | Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    this.#assertOpen();
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const request = snapshotResolve(input, signal);
    const operation = this.#begin(request.attemptId, signal);
    try {
      this.#throwIfClosedOrAborted(operation.controller);
      if (!resolutionInput || typeof resolutionInput !== "object" || types.isProxy(resolutionInput)) fail("REFERENCE_UNAVAILABLE");
      const owned = RESOLUTIONS.get(resolutionInput);
      const record = this.#records.get(request.handle);
      if (!owned || owned.service !== this || !record || owned.record !== record || record.attemptId !== request.attemptId ||
          record.handle !== request.handle) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      if (!this.isOwnedResolution(resolutionInput, input)) fail("REFERENCE_UNAVAILABLE");
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal) || !sameGenerationPrincipal(principal, record.principal)) {
        void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED");
      }
      if (this.#records.get(record.handle) !== record || record.epoch !== operation.epoch ||
          record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || record.expiresAt <= this.#readNow() ||
          this.#invalidating.has(request.attemptId) || !exactResolutionMatches(resolutionInput, record) ||
          !(await readKlingI2VUploadReference(record.client, record.uploadContext))) fail("REFERENCE_UNAVAILABLE");
      const result = await consume(record.client, record.uploadContext, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (this.#records.get(record.handle) !== record || record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          record.expiresAt <= this.#readNow() || this.#invalidating.has(request.attemptId)) fail("REFERENCE_EXPIRED");
      return result;
    } catch (error) {
      if (error instanceof OwnerKlingI2VImageReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) { void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      throw error;
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedResolution(value: unknown, input: OwnerKlingI2VImageResolveInput | unknown): boolean {
    try {
      this.#assertOpen();
      const request = snapshotResolve(input);
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value);
      const record = this.#records.get(request.handle);
      if (!owned || owned.service !== this || !record || owned.record !== record || record.attemptId !== request.attemptId ||
          record.expiresAt <= this.#readNow() || record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId)) return false;
      return exactResolutionMatches(value, record);
    } catch { return false; }
  }

  /** Internal accessor: rechecks current principal and reveals the R2 URL only to a sealed resolution consumer. */
  async readUploadReference(value: unknown, input: OwnerKlingI2VImageResolveInput | unknown): Promise<Readonly<{ url: string }>> {
    this.#assertOpen();
    const request = snapshotResolve(input);
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value as object) : undefined;
    if (!owned || owned.service !== this || owned.record.attemptId !== request.attemptId || owned.record.handle !== request.handle ||
        !this.isOwnedResolution(value, input)) fail("REFERENCE_UNAVAILABLE");
    const record = owned.record;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId);
      if (!sameGenerationPrincipal(principal, record.principal)) { void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      if (!this.isOwnedResolution(value, input)) fail("REFERENCE_UNAVAILABLE");
      const reference = await readKlingI2VUploadReference(record.client, record.uploadContext);
      if (!reference) fail("REFERENCE_UNAVAILABLE");
      return reference;
    } catch (error) {
      if (error instanceof OwnerKlingI2VImageReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) { void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      fail("REFERENCE_UNAVAILABLE");
    }
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
      this.#records.clear(); this.#knownSemantics.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear();
      this.#epochs.clear(); this.#unknownSemantics.clear(); this.#pendingSemantics.clear(); this.#invalidating.clear();
      this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerKlingI2VImageReferenceServiceError("REQUEST_ABORTED"));
    const operation = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return operation;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerKlingI2VImageReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([operation, aborted]).finally(remove);
  }
  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const previous = this.#principalByAttempt.get(attemptId);
    if (previous && !sameGenerationPrincipal(previous, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal); return true;
  }
  #begin(attemptId: string, parent?: AbortSignal, prune = false): PendingOperation {
    this.#assertOpen(); if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    if (prune) this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const active = this.#activeAttempts();
    if (!active.has(attemptId) && active.size >= MAX_ATTEMPTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(); const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done); this.#pendingCount += 1;
    return operation;
  }
  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort(); const pending = this.#pendingByAttempt.get(attemptId); pending?.delete(operation);
    if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1; operation.finish(); this.#allOperations.delete(operation.done); this.#maybeRelease(attemptId);
  }
  #activeAttempts(): Set<string> { return new Set([...this.#handlesByAttempt.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]); }
  #invalidate(attemptId: string): Promise<void> {
    const prior = this.#invalidations.get(attemptId); if (prior) return prior;
    this.#invalidating.add(attemptId); this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttemptRecords(attemptId); this.#principalByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    const done = Promise.allSettled(pending).then(() => { this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeRelease(attemptId); });
    this.#invalidations.set(attemptId, done); return done;
  }
  #removeAttemptRecords(attemptId: string): void {
    for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#removeRecord(handle);
    this.#handlesByAttempt.delete(attemptId);
  }
  #removeRecord(handle: string): void {
    const record = this.#records.get(handle); if (!record) return;
    this.#records.delete(handle); this.#knownSemantics.delete(`${record.attemptId}:${record.semanticKey}`);
    const handles = this.#handlesByAttempt.get(record.attemptId); handles?.delete(handle);
    if (!handles?.size) this.#handlesByAttempt.delete(record.attemptId); this.#maybeRelease(record.attemptId);
  }
  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeRecord(handle);
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }
  #maybeRelease(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principalByAttempt.delete(attemptId);
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #throwIfClosedOrAborted(operation: AbortController): void {
    this.#assertOpen(); if (operation.signal.aborted) fail("REQUEST_ABORTED");
  }
  #readNow(): number {
    let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number;
  }
}

function receiptFor(record: ImageRecord, now: number): OwnerKlingI2VImageUploadReceipt {
  return Object.freeze({ status: "uploaded", image_handle: record.handle, model_id: "kling_image2video", mime_type: record.mimeType,
    size: record.size, sha256: record.sha256, width: record.width, height: record.height,
    expires_in_seconds: Math.floor(Math.max(0, record.expiresAt - now) / 1000),
    input_acceptance: "SOURCE_FORMAT_DECLARED_PROVIDER_ACCEPTANCE_UNVERIFIED" });
}
function snapshotUpload(input: unknown, signal?: AbortSignal): Readonly<OwnerKlingI2VImageUploadInput> {
  const fields = exactRecord(input, ["attemptId", "content_base64", "filename", "mime_type"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.content_base64 !== "string" ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
      signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, content_base64: fields.content_base64, filename: fields.filename, mime_type: fields.mime_type });
}
function snapshotResolve(input: unknown, signal?: AbortSignal): Readonly<{ attemptId: string; handle: string }> {
  const fields = exactRecord(input, ["attempt_id", "image_handle"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) || typeof fields.image_handle !== "string" ||
      !HANDLE.test(fields.image_handle) || signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attempt_id, handle: fields.image_handle });
}
async function snapshotNativeClient(value: unknown): Promise<SyntxChatHttpClient> {
  const { SyntxChatHttpClient } = await import("../adapter/syntx/chat-http-client.js");
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("PROFILE_BINDING_MISMATCH");
  if (Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype) fail("PROFILE_BINDING_MISMATCH");
  return value as SyntxChatHttpClient;
}
async function uploadKlingI2VImage(client: SyntxChatHttpClient, image: unknown, destination: SyntxUploadDestination,
  signal?: AbortSignal): Promise<OwnerKlingI2VUploadContext> {
  const { uploadOwnerKlingI2VImage } = await import("../adapter/syntx/kling-i2v-upload-context.js");
  return uploadOwnerKlingI2VImage(client, image, destination, signal);
}
async function readKlingI2VUploadReference(client: unknown, context: unknown): Promise<Readonly<{ readonly url: string }> | null> {
  const { readOwnerKlingI2VUploadReferenceForClient } = await import("../adapter/syntx/kling-i2v-upload-context.js");
  return readOwnerKlingI2VUploadReferenceForClient(client, context);
}
function exactResolutionMatches(value: object, record: ImageRecord): boolean {
  const fields = exactRecord(value, ["role", "wire_type", "model_id", "principal", "attempt_id", "image_handle", "destination",
    "sha256", "mime_type", "size", "width", "height", "expires_at", "epoch", "generation_permit"]);
  return fields.role === "kling_i2v_image" && fields.wire_type === "image" && fields.model_id === "kling_image2video" &&
    fields.attempt_id === record.attemptId && fields.image_handle === record.handle && fields.destination === record.destination &&
    fields.sha256 === record.sha256 && fields.mime_type === record.mimeType && fields.size === record.size &&
    fields.width === record.width && fields.height === record.height && fields.expires_at === record.expiresAt && fields.epoch === record.epoch &&
    fields.generation_permit === false && isSamePrincipal(fields.principal, record.principal);
}
function isSamePrincipal(value: unknown, expected: Readonly<GenerationPrincipalRef>): boolean {
  try { return sameGenerationPrincipal(value as GenerationPrincipalRef, expected); } catch { return false; }
}
function getSemanticKey(principal: Readonly<GenerationPrincipalRef>, sha256: string, size: number,
  mimeType: string, destination: SyntxUploadDestination): string {
  return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, model_id: "kling_image2video",
    destination, sha256, size, mime_type: mimeType });
}
function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || fields.tenant_id.length === 0 || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || fields.subject.length === 0 || fields.subject.length > 512) fail("PROFILE_BINDING_MISMATCH");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value; return result;
}
function isObjectPort(value: unknown): value is object { return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) { const descriptor = Object.getOwnPropertyDescriptor(current, key); if (descriptor) return "value" in descriptor ? descriptor.value : undefined; current = Object.getPrototypeOf(current) as object | null; }
  return undefined;
}
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let result: unknown; try { result = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED"); return result as number; };
}
function isKnownRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function fail(code: OwnerKlingI2VImageReferenceServiceErrorCode): never { throw new OwnerKlingI2VImageReferenceServiceError(code); }
