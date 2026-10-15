import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient, readOwnerKlingKeyframesUploadReferenceForClient } from "../adapter/syntx/chat-http-client.js";
import type { SyntxHttpError } from "../adapter/syntx/http-client.js";
import type { OwnerKlingKeyframesUploadContext } from "../adapter/syntx/kling-keyframes-upload-context.js";
import {
  OwnerKlingKeyframesImagePolicyError,
  releaseValidatedOwnerKlingKeyframesImage,
  validateOwnerKlingKeyframesImage,
  type OwnerKlingKeyframesImageCanonicalMimeType,
  type OwnerKlingKeyframesImageSourceMimeType,
  type ValidatedOwnerKlingKeyframesImage
} from "./owner-kling-keyframes-image-policy.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^kling_keyframes_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_ATTEMPTS = 128;
const MAX_BASE64_CHARS = Math.ceil(50 * 1024 * 1024 / 3) * 4;
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerKlingKeyframesReferenceService; readonly records: readonly [ImageRecord, ImageRecord] }>();
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadKlingKeyframesImage;
const NATIVE_READER = readOwnerKlingKeyframesUploadReferenceForClient;

export interface OwnerKlingKeyframesReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}

export interface OwnerKlingKeyframesImageUploadInput {
  readonly attemptId: string;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
}

export interface OwnerKlingKeyframesImageUploadReceipt {
  readonly status: "uploaded";
  readonly image_handle: string;
  readonly model_id: "kling_keyframes";
  readonly filename: string;
  readonly mime_type: OwnerKlingKeyframesImageCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: number;
  readonly generation_permit: false;
}

export interface OwnerKlingKeyframesPairResolveInput {
  readonly attempt_id: string;
  readonly image_handles: readonly [string, string];
}

export interface OwnerKlingKeyframesPairResolution {
  readonly model_id: "kling_keyframes";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly images: readonly [Readonly<SafeImageMetadata>, Readonly<SafeImageMetadata>];
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}

export type OwnerKlingKeyframesNativePairConsumer<T> = (
  client: SyntxChatHttpClient,
  contexts: readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext]
) => T;

interface SafeImageMetadata {
  readonly image_handle: string;
  readonly filename: string;
  readonly mime_type: OwnerKlingKeyframesImageCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export type OwnerKlingKeyframesReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED"
  | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";

export class OwnerKlingKeyframesReferenceServiceError extends Error {
  constructor(readonly code: OwnerKlingKeyframesReferenceServiceErrorCode) {
    super("The owner Kling Keyframes reference could not be established safely.");
    this.name = "OwnerKlingKeyframesReferenceServiceError";
  }
}

interface ImageRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly semanticKey: string;
  readonly filename: string;
  readonly sourceMimeType: OwnerKlingKeyframesImageSourceMimeType;
  readonly mimeType: OwnerKlingKeyframesImageCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly uploadContext: OwnerKlingKeyframesUploadContext;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

/** Local owner-bound upload handles and pair resolution; this service never invokes generation. */
export class OwnerKlingKeyframesReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: OwnerKlingKeyframesReferenceServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #records = new Map<string, ImageRecord>();
  readonly #knownSemantics = new Map<string, string>();
  readonly #handlesByAttempt = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #clientByAttempt = new Map<string, SyntxChatHttpClient>();
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

  constructor(optionsInput: OwnerKlingKeyframesReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "resolveClient"], ["now"]);
    if (!isObjectPort(fields.linkService) || typeof getDataMethod(fields.linkService, "getStatus") !== "function" ||
        typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("PROFILE_BINDING_MISMATCH");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as OwnerKlingKeyframesReferenceServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    Object.freeze(this);
  }

  async upload(input: OwnerKlingKeyframesImageUploadInput | unknown, signal?: AbortSignal): Promise<OwnerKlingKeyframesImageUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input, signal);
    const operation = this.#begin(request.attemptId, signal, true);
    let validated: Readonly<ValidatedOwnerKlingKeyframesImage> | undefined;
    let semanticKey: string | undefined;
    let nativeInvoked = false;
    let unknownOutcome = false;
    try {
      validated = validateEncodedImage(request);
      this.#throwIfClosedOrAborted(operation.controller);
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = await this.#getClient(request.attemptId);
      semanticKey = semanticIdentity(principal, request.attemptId, validated);
      if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      const existingHandle = this.#knownSemantics.get(semanticKey);
      const existing = existingHandle ? this.#records.get(existingHandle) : undefined;
      if (existing && existing.expiresAt > this.#readNow() && existing.epoch === operation.epoch &&
          existing.client === client && sameGenerationPrincipal(existing.principal, principal)) return receiptFor(existing, this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semanticKey);
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const expiresAt = issuedAt + TTL_MS;
      this.#throwIfClosedOrAborted(operation.controller);
      if (this.#invalidating.has(request.attemptId)) fail("REQUEST_ABORTED");
      nativeInvoked = true;
      const uploadContext = await Reflect.apply(NATIVE_UPLOAD, client, [validated, operation.controller.signal]) as OwnerKlingKeyframesUploadContext;
      this.#throwIfClosedOrAborted(operation.controller);
      const reference = NATIVE_READER(client, uploadContext);
      if (!reference || !matchesUploadContext(uploadContext, validated)) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const acknowledgedAt = this.#readNow();
      if (expiresAt - acknowledgedAt < 1_000 || (this.#epochs.get(request.attemptId) ?? 0) !== operation.epoch ||
          this.#invalidating.has(request.attemptId) || !this.#pendingSemantics.has(semanticKey)) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const currentPrincipal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal).catch(() => {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      });
      this.#throwIfClosedOrAborted(operation.controller);
      const currentClient = await this.#getClient(request.attemptId).catch(() => {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      });
      if (!sameGenerationPrincipal(principal, currentPrincipal) || currentClient !== client) {
        unknownOutcome = true; void this.#invalidate(request.attemptId); fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const handle = `kling_keyframes_image_${randomUUID()}`;
      const record: ImageRecord = Object.freeze({ handle, attemptId: request.attemptId, principal, semanticKey,
        filename: validated.filename, sourceMimeType: validated.source_mime_type, mimeType: validated.mime_type,
        size: validated.size, sha256: validated.sha256, width: validated.width, height: validated.height,
        expiresAt, epoch: operation.epoch, client, uploadContext });
      this.#records.set(handle, record);
      this.#knownSemantics.set(semanticKey, handle);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      return receiptFor(record, acknowledgedAt);
    } catch (error) {
      if (error instanceof OwnerKlingKeyframesReferenceServiceError) {
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
      if (isKnownRejection(error)) fail("UPLOAD_REJECTED");
      if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      if (error instanceof OwnerKlingKeyframesImagePolicyError) fail("INVALID_REQUEST");
      throw error;
    } finally {
      if (validated) releaseValidatedOwnerKlingKeyframesImage(validated);
      if (semanticKey !== undefined) {
        if (unknownOutcome) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      this.#finish(request.attemptId, operation);
    }
  }

  async resolvePair(input: OwnerKlingKeyframesPairResolveInput | unknown, signal?: AbortSignal): Promise<OwnerKlingKeyframesPairResolution> {
    this.#assertOpen();
    const request = snapshotPair(input, signal);
    const operation = this.#begin(request.attemptId, signal);
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const records = request.handles.map((handle) => this.#records.get(handle));
      if (!records[0] || !records[1] || records[0] === records[1] || records.some((record) =>
        !record || record.attemptId !== request.attemptId)) fail("REFERENCE_UNAVAILABLE");
      const pair = records as [ImageRecord, ImageRecord];
      const epoch = this.#epochs.get(request.attemptId) ?? 0;
      const client = await this.#getClient(request.attemptId);
      this.#assertLivePair(pair, principal, client, request.attemptId, epoch);
      const refs = await Promise.all(pair.map((record) => Promise.resolve(NATIVE_READER(record.client, record.uploadContext))));
      if (refs.some((reference) => !reference)) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      const latestClient = await this.#getClient(request.attemptId);
      if (!sameGenerationPrincipal(latest, principal) || latestClient !== client) { void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      this.#assertLivePair(pair, latest, latestClient, request.attemptId, epoch);
      const resolution: OwnerKlingKeyframesPairResolution = Object.freeze({ model_id: "kling_keyframes", principal,
        attempt_id: request.attemptId, images: Object.freeze(pair.map(safeMetadata)) as unknown as OwnerKlingKeyframesPairResolution["images"],
        expires_at: Math.min(pair[0].expiresAt, pair[1].expiresAt), epoch, generation_permit: false });
      RESOLUTIONS.set(resolution, { service: this, records: Object.freeze(pair) });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerKlingKeyframesReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) { void this.#invalidate(request.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedPairResolution(value: unknown, input: OwnerKlingKeyframesPairResolveInput | unknown): boolean {
    try {
      this.#assertOpen();
      const request = snapshotPair(input);
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value);
      if (!owned || owned.service !== this || owned.records[0]?.handle !== request.handles[0] ||
          owned.records[1]?.handle !== request.handles[1] || owned.records.some((record) =>
            this.#records.get(record.handle) !== record || record.attemptId !== request.attemptId || record.expiresAt <= this.#readNow())) return false;
      return exactPairMatches(value, owned.records, request.attemptId, this.#epochs.get(request.attemptId) ?? 0);
    } catch { return false; }
  }

  /** Internal consumer: returns only this live pair's ordered native URLs. */
  async getPrivateReferences(value: unknown): Promise<readonly [{ readonly url: string; readonly type: "image" }, { readonly url: string; readonly type: "image" }]> {
    this.#assertOpen();
    if (!value || typeof value !== "object" || types.isProxy(value)) fail("REFERENCE_UNAVAILABLE");
    const owned = RESOLUTIONS.get(value);
    if (!owned || owned.service !== this) fail("REFERENCE_UNAVAILABLE");
    const [first, second] = owned.records;
    if (!first || !second) fail("REFERENCE_UNAVAILABLE");
    const operation = this.#begin(first.attemptId);
    try {
      const principal = await this.#resolvePrincipal(first.attemptId, operation.controller.signal);
      this.#throwIfClosedOrAborted(operation.controller);
      const client = await this.#getClient(first.attemptId);
      const epoch = this.#epochs.get(first.attemptId) ?? 0;
      if (!sameGenerationPrincipal(principal, first.principal) || !sameGenerationPrincipal(first.principal, second.principal) || first.client !== second.client ||
          client !== first.client || !exactPairMatches(value, owned.records, first.attemptId, epoch)) fail("REFERENCE_UNAVAILABLE");
      this.#assertLivePair(owned.records, principal, client, first.attemptId, epoch);
      const refs = await Promise.all(owned.records.map((record) => Promise.resolve(NATIVE_READER(record.client, record.uploadContext))));
      this.#throwIfClosedOrAborted(operation.controller);
      const latest = await this.#resolvePrincipal(first.attemptId, operation.controller.signal);
      const latestClient = await this.#getClient(first.attemptId);
      if (!sameGenerationPrincipal(latest, first.principal) || latestClient !== first.client) { void this.#invalidate(first.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      if (refs.some((reference) => !reference) || !exactPairMatches(value, owned.records, first.attemptId, epoch)) fail("REFERENCE_EXPIRED");
      this.#assertLivePair(owned.records, latest, latestClient, first.attemptId, epoch);
      return Object.freeze(refs.map((reference) => Object.freeze({ url: reference!.url, type: "image" as const }))) as unknown as
        readonly [{ readonly url: string; readonly type: "image" }, { readonly url: string; readonly type: "image" }];
    } catch (error) {
      if (error instanceof OwnerKlingKeyframesReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) { void this.#invalidate(first.attemptId); fail("PRINCIPAL_NOT_LINKED"); }
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(first.attemptId, operation); }
  }

  /** Synchronous trusted capture after async owner/reference revalidation has completed. */
  withCapturedNativePair<T>(value: unknown, input: OwnerKlingKeyframesPairResolveInput | unknown,
    consume: OwnerKlingKeyframesNativePairConsumer<T>): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const request = snapshotPair(input);
    if (!value || typeof value !== "object" || types.isProxy(value)) fail("REFERENCE_UNAVAILABLE");
    const owned = RESOLUTIONS.get(value);
    if (!owned || owned.service !== this || !exactPairMatches(value, owned.records, request.attemptId, this.#epochs.get(request.attemptId) ?? 0) ||
        owned.records[0].handle !== request.handles[0] || owned.records[1].handle !== request.handles[1]) fail("REFERENCE_UNAVAILABLE");
    const [first, second] = owned.records, epoch = this.#epochs.get(request.attemptId) ?? 0;
    const client = first.client;
    this.#assertLivePair(owned.records, first.principal, client, request.attemptId, epoch);
    const currentPrincipal = this.#principalByAttempt.get(request.attemptId);
    if (second.client !== client || this.#clientByAttempt.get(request.attemptId) !== client || !currentPrincipal ||
        !sameGenerationPrincipal(currentPrincipal, first.principal)) fail("REFERENCE_UNAVAILABLE");
    const contexts = Object.freeze([first.uploadContext, second.uploadContext]) as unknown as
      readonly [OwnerKlingKeyframesUploadContext, OwnerKlingKeyframesUploadContext];
    if (contexts.some((context) => !NATIVE_READER(client, context))) fail("REFERENCE_EXPIRED");
    const result = consume(client, contexts);
    this.#assertLivePair(owned.records, first.principal, client, request.attemptId, epoch);
    return result;
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
      this.#clientByAttempt.clear(); this.#epochs.clear(); this.#unknownSemantics.clear(); this.#pendingSemantics.clear();
      this.#invalidating.clear(); this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerKlingKeyframesReferenceServiceError("REQUEST_ABORTED"));
    const operation = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return operation;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerKlingKeyframesReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([operation, aborted]).finally(remove);
  }

  async #getClient(attemptId: string): Promise<SyntxChatHttpClient> {
    let client: unknown;
    try { client = await this.#resolveClient(attemptId); } catch { fail("PROFILE_BINDING_MISMATCH"); }
    if (!client || typeof client !== "object" || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(client, "uploadKlingKeyframesImage") || SyntxChatHttpClient.prototype.uploadKlingKeyframesImage !== NATIVE_UPLOAD) {
      fail("PROFILE_BINDING_MISMATCH");
    }
    const actual = client as SyntxChatHttpClient;
    const previous = this.#clientByAttempt.get(attemptId);
    if (previous && previous !== actual) fail("PROFILE_BINDING_MISMATCH");
    this.#clientByAttempt.set(attemptId, actual);
    return actual;
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
    this.#removeAttemptRecords(attemptId); this.#principalByAttempt.delete(attemptId); this.#clientByAttempt.delete(attemptId);
    for (const operation of this.#pendingByAttempt.get(attemptId) ?? []) operation.controller.abort();
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])].map((operation) => operation.done);
    const done = Promise.allSettled(pending).then(() => { this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeRelease(attemptId); });
    this.#invalidations.set(attemptId, done); return done;
  }
  #removeAttemptRecords(attemptId: string): void { for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#removeRecord(handle); this.#handlesByAttempt.delete(attemptId); }
  #removeRecord(handle: string): void {
    const record = this.#records.get(handle); if (!record) return;
    this.#records.delete(handle); this.#knownSemantics.delete(record.semanticKey);
    const handles = this.#handlesByAttempt.get(record.attemptId); handles?.delete(handle);
    if (!handles?.size) this.#handlesByAttempt.delete(record.attemptId); this.#maybeRelease(record.attemptId);
  }
  #prune(now: number): void {
    for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#removeRecord(handle);
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }
  #maybeRelease(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principalByAttempt.delete(attemptId); this.#clientByAttempt.delete(attemptId);
  }
  #assertLivePair(records: readonly [ImageRecord, ImageRecord], principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient,
    attemptId: string, epoch: number): void {
    const now = this.#readNow();
    if (this.#invalidating.has(attemptId) || (this.#epochs.get(attemptId) ?? 0) !== epoch || records.some((record) =>
      this.#records.get(record.handle) !== record || record.attemptId !== attemptId || record.epoch !== epoch ||
      record.expiresAt <= now || record.client !== client || !sameGenerationPrincipal(record.principal, principal))) fail("REFERENCE_EXPIRED");
  }
  #readNow(): number {
    let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number;
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #throwIfClosedOrAborted(operation: AbortController): void { this.#assertOpen(); if (operation.signal.aborted) fail("REQUEST_ABORTED"); }
}

function validateEncodedImage(request: OwnerKlingKeyframesImageUploadInput): Readonly<ValidatedOwnerKlingKeyframesImage> {
  const value = request.content_base64;
  if (value.length === 0 || value.length > MAX_BASE64_CHARS || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail("INVALID_REQUEST");
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > 50 * 1024 * 1024 || bytes.toString("base64") !== value) { bytes.fill(0); fail("INVALID_REQUEST"); }
  try { return validateOwnerKlingKeyframesImage({ filename: request.filename, mime_type: request.mime_type, bytes }); }
  catch (error) { if (error instanceof OwnerKlingKeyframesImagePolicyError) fail("INVALID_REQUEST"); throw error; }
  finally { bytes.fill(0); }
}

function receiptFor(record: ImageRecord, now: number): OwnerKlingKeyframesImageUploadReceipt {
  return Object.freeze({ status: "uploaded", image_handle: record.handle, model_id: "kling_keyframes", filename: record.filename,
    mime_type: record.mimeType, size: record.size, sha256: record.sha256, width: record.width, height: record.height,
    expires_in_seconds: Math.floor(Math.max(0, record.expiresAt - now) / 1000), generation_permit: false });
}
function safeMetadata(record: ImageRecord): SafeImageMetadata {
  return Object.freeze({ image_handle: record.handle, filename: record.filename, mime_type: record.mimeType,
    size: record.size, sha256: record.sha256, width: record.width, height: record.height });
}
function matchesUploadContext(context: OwnerKlingKeyframesUploadContext, image: ValidatedOwnerKlingKeyframesImage): boolean {
  return context.status === "uploaded" && context.model_id === "kling_keyframes" && context.destination === "uploaded" &&
    context.filename === image.filename && context.source_mime_type === image.source_mime_type && context.mime_type === image.mime_type &&
    context.size === image.size && context.sha256 === image.sha256 && context.width === image.width && context.height === image.height &&
    context.input_acceptance === "UPLOAD_REFERENCE_RECEIVED_PROVIDER_ACCEPTANCE_UNVERIFIED";
}
function semanticIdentity(principal: Readonly<GenerationPrincipalRef>, attemptId: string, image: ValidatedOwnerKlingKeyframesImage): string {
  return JSON.stringify([principal.tenant_id, principal.subject_id, principal.connection_id, attemptId,
    "kling_keyframes", "uploaded", image.filename, image.sha256, image.mime_type]);
}
function exactPairMatches(value: object, records: readonly [ImageRecord, ImageRecord], attemptId: string, epoch: number): boolean {
  const fields = exactRecord(value, ["model_id", "principal", "attempt_id", "images", "expires_at", "epoch", "generation_permit"]);
  const images = fields.images;
  if (fields.model_id !== "kling_keyframes" || fields.attempt_id !== attemptId || fields.epoch !== epoch ||
      fields.expires_at !== Math.min(records[0].expiresAt, records[1].expiresAt) || fields.generation_permit !== false ||
      !isSamePrincipal(fields.principal, records[0].principal) || !sameGenerationPrincipal(records[0].principal, records[1].principal) ||
      !Array.isArray(images) || images.length !== 2) return false;
  return records.every((record, index) => {
    const item: unknown = images[index];
    if (!item || typeof item !== "object" || types.isProxy(item)) return false;
    const metadata = exactRecord(item, ["image_handle", "filename", "mime_type", "size", "sha256", "width", "height"]);
    return metadata.image_handle === record.handle && metadata.filename === record.filename && metadata.mime_type === record.mimeType &&
      metadata.size === record.size && metadata.sha256 === record.sha256 && metadata.width === record.width && metadata.height === record.height;
  });
}
function snapshotUpload(input: unknown, signal?: AbortSignal): Readonly<OwnerKlingKeyframesImageUploadInput> {
  const fields = exactRecord(input, ["attemptId", "content_base64", "filename", "mime_type"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.content_base64 !== "string" ||
      typeof fields.filename !== "string" || typeof fields.mime_type !== "string" ||
      signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, content_base64: fields.content_base64, filename: fields.filename, mime_type: fields.mime_type });
}
function snapshotPair(input: unknown, signal?: AbortSignal): Readonly<{ attemptId: string; handles: readonly [string, string] }> {
  const fields = exactRecord(input, ["attempt_id", "image_handles"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) ||
      signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST");
  const handles = snapshotHandleTuple(fields.image_handles);
  if (handles[0] === handles[1]) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attempt_id, handles });
}
function snapshotHandleTuple(value: unknown): readonly [string, string] {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap; } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors);
  const first = descriptors["0"], second = descriptors["1"], length = descriptors.length;
  if (keys.length !== 3 || !keys.includes("0") || !keys.includes("1") || !keys.includes("length") ||
      !first || !("value" in first) || first.enumerable !== true ||
      !second || !("value" in second) || second.enumerable !== true ||
      !length || !("value" in length) || length.value !== 2 || length.enumerable !== false ||
      length.configurable !== false ||
      typeof first.value !== "string" || !HANDLE.test(first.value) ||
      typeof second.value !== "string" || !HANDLE.test(second.value)) fail("INVALID_REQUEST");
  return Object.freeze([first.value, second.value]);
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
function isKnownRejection(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as SyntxHttpError).code;
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function isSamePrincipal(value: unknown, expected: Readonly<GenerationPrincipalRef>): boolean {
  try { return sameGenerationPrincipal(value as GenerationPrincipalRef, expected); } catch { return false; }
}
function fail(code: OwnerKlingKeyframesReferenceServiceErrorCode): never { throw new OwnerKlingKeyframesReferenceServiceError(code); }
