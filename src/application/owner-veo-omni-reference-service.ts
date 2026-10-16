import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import {
  isOwnerVeoOmniValidatedReference,
  releaseOwnerVeoOmniValidatedReference,
  validateOwnerVeoOmniReferenceInput,
  type OwnerVeoOmniReferenceMimeType,
  type OwnerVeoOmniValidatedReference
} from "./owner-veo-omni-reference-input-validator.js";
import { getOwnerVeoOmniReferenceProfile } from "./owner-veo-omni-reference-profile.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^veo_omni_reference_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadOwnerVeoOmniReference;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const UINT8_ARRAY_PROTOTYPE = Uint8Array.prototype;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(UINT8_ARRAY_PROTOTYPE) as object;
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const TYPED_ARRAY_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_BYTE_OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const OWNED_REFERENCES = new WeakMap<object, Readonly<{ service: OwnerVeoOmniReferenceService; records: readonly ReferenceRecord[];
  attemptId: string; principal: Readonly<GenerationPrincipalRef>; epoch: number; expiresAt: number }>>();
const REFERENCE_SERVICES = new WeakSet<object>();

export interface OwnerVeoOmniReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly ffprobePath: string;
  readonly maxFileBytes?: number;
  readonly now?: () => number;
}

export interface OwnerVeoOmniReferenceUploadInput {
  readonly attemptId: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
}

export interface OwnerVeoOmniReferenceUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: "veo_omni";
  readonly kind: "image" | "video";
  readonly mime_type: OwnerVeoOmniReferenceMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number | null;
  readonly expires_in_seconds: number;
  readonly input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE";
}

export interface OwnerVeoOmniOwnedReferences {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly references: readonly Readonly<{
    reference_handle: string;
    kind: "image" | "video";
    mime_type: OwnerVeoOmniReferenceMimeType;
    size: number;
    sha256: string;
    width: number;
    height: number;
    duration_seconds: number | null;
  }>[];
  readonly generation_permit: false;
}

export type OwnerVeoOmniReferenceServiceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" |
  "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "VALIDATION_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" |
  "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";

export class OwnerVeoOmniReferenceServiceError extends Error {
  constructor(readonly code: OwnerVeoOmniReferenceServiceErrorCode) {
    super("The owner Veo Omni reference is unavailable.");
    this.name = "OwnerVeoOmniReferenceServiceError";
  }
}

interface ReferenceRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profileHash: string;
  readonly kind: "image" | "video";
  readonly mimeType: OwnerVeoOmniReferenceMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number | null;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly url: string;
  readonly fileId?: string;
}

interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

interface UploadSnapshot {
  readonly attemptId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

interface ResolveSnapshot { readonly attemptId: string; readonly handles: readonly string[]; }

/** Process-local owner store. Handles confer reference access only, never generation permission. */
export class OwnerVeoOmniReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown;
  readonly #ffprobePath: string;
  readonly #maxFileBytes: number;
  readonly #now: () => number;
  readonly #profileHash: string;
  readonly #records = new Map<string, ReferenceRecord>();
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

  constructor(optionsInput: OwnerVeoOmniReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["binding", "linkService", "resolveClient", "ffprobePath"], ["maxFileBytes", "now"]);
    const profile = getOwnerVeoOmniReferenceProfile();
    if (!isGenuineLinkService(fields.linkService) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        typeof fields.ffprobePath !== "string" || !fields.ffprobePath ||
        (fields.maxFileBytes !== undefined && (!Number.isSafeInteger(fields.maxFileBytes) ||
          (fields.maxFileBytes as number) < 1 || (fields.maxFileBytes as number) > profile.public_limits.max_file_size_bytes)) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now))) ||
        profile.identity.model_id !== "veo_omni" || profile.dispatch_allowed !== false || profile.runtime_usable !== false ||
        !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_sha256)) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as (attemptId: string) => unknown;
    this.#ffprobePath = fields.ffprobePath;
    this.#maxFileBytes = (fields.maxFileBytes as number | undefined) ?? profile.local_resource_policy.default_max_file_bytes;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#profileHash = profile.profile_sha256;
    REFERENCE_SERVICES.add(this);
    Object.freeze(this);
  }

  async uploadReference(input: OwnerVeoOmniReferenceUploadInput | unknown, signalInput?: AbortSignal): Promise<OwnerVeoOmniReferenceUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input, this.#maxFileBytes);
    let operation: PendingOperation;
    try { operation = this.#begin(request.attemptId, exactSignal(signalInput)); }
    catch (error) { request.bytes.fill(0); throw error; }

    let validation: Readonly<OwnerVeoOmniValidatedReference> | undefined;
    let semanticKey: string | undefined;
    let ownsSemanticReservation = false;
    let nativeInvoked = false;
    let published = false;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const initialClient = snapshotNativeClient(this.#resolveClient(request.attemptId));
      try {
        validation = await validateOwnerVeoOmniReferenceInput({ filename: request.filename, mime_type: request.mimeType,
          bytes: request.bytes, ffprobePath: this.#ffprobePath, maxFileBytes: this.#maxFileBytes },
          operation.controller.signal);
      } catch { this.#throwIfStopped(operation); fail("VALIDATION_REJECTED"); }
      this.#throwIfStopped(operation);
      if (!isOwnerVeoOmniValidatedReference(validation) || validation.model_id !== "veo_omni" ||
          validation.size !== request.bytes.byteLength || validation.mime_type !== normalizedSourceMime(request.mimeType) ||
          validation.source_mime_type !== request.mimeType || validation.dispatch_allowed !== false ||
          validation.owner_upload_binding !== "NOT_ESTABLISHED" || validation.policy_id !== "OWNER_VEO_OMNI_REFERENCE_INPUT_C19_V1" ||
          validation.source_build_id !== "1792156098" || validation.source_catalog_version !== getOwnerVeoOmniReferenceProfile().source_pins.public_catalog_version ||
          !/^[a-f0-9]{64}$/u.test(validation.sha256) || !Number.isSafeInteger(validation.size) || validation.size < 1 ||
          !Number.isSafeInteger(validation.width) || validation.width < 1 || !Number.isSafeInteger(validation.height) || validation.height < 1 ||
          (validation.kind === "image" ? validation.duration_seconds !== null :
            typeof validation.duration_seconds !== "number" || !Number.isFinite(validation.duration_seconds) || validation.duration_seconds <= 0)) {
        fail("VALIDATION_REJECTED");
      }
      semanticKey = semanticKeyFor(principal, validation, this.#profileHash);
      if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semanticKey);
      ownsSemanticReservation = true;

      const beforeUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      const clientBeforeUpload = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, beforeUpload) || clientBeforeUpload.client !== initialClient.client) fail("PRINCIPAL_NOT_LINKED");
      if (getOwnerVeoOmniReferenceProfile().profile_sha256 !== this.#profileHash ||
          !isOwnerVeoOmniValidatedReference(validation)) fail("VALIDATION_REJECTED");
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");

      nativeInvoked = true;
      let nativeReference: InternalUploadReference;
      try {
        nativeReference = await Reflect.apply(NATIVE_UPLOAD, clientBeforeUpload.client,
          [validation, operation.controller.signal]) as InternalUploadReference;
      } catch { this.#throwAsUnknownIfStopped(operation); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#throwAsUnknownIfStopped(operation);
      const nativeFields = readNativeReference(nativeReference);
      if (!nativeFields) fail("UPLOAD_OUTCOME_UNKNOWN");

      let afterUpload: Readonly<GenerationPrincipalRef>;
      try { afterUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal); }
      catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#throwAsUnknownIfStopped(operation);
      const clientAfterUpload = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, afterUpload) || clientAfterUpload.client !== clientBeforeUpload.client) fail("UPLOAD_OUTCOME_UNKNOWN");
      const acknowledgedAt = this.#readNow();
      const expiresAt = issuedAt + TTL_MS;
      const epoch = operation.epoch;
      if (expiresAt - acknowledgedAt < 1_000 || epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || this.#records.size + this.#unknownSemantics.size >= MAX_RECORDS ||
          !this.#pendingSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");

      const handle = `veo_omni_reference_${randomUUID()}`;
      const record: ReferenceRecord = Object.freeze({ handle, attemptId: request.attemptId, principal, profileHash: this.#profileHash,
        kind: validation.kind, mimeType: validation.mime_type, size: validation.size, sha256: validation.sha256,
        width: validation.width, height: validation.height, durationSeconds: validation.duration_seconds,
        expiresAt, epoch, client: clientBeforeUpload.client, url: nativeFields.url,
        ...(nativeFields.file_id === undefined ? {} : { fileId: nativeFields.file_id }) });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      published = true;
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: "veo_omni", kind: record.kind,
        mime_type: record.mimeType, size: record.size, sha256: record.sha256, width: record.width, height: record.height,
        duration_seconds: record.durationSeconds, expires_in_seconds: Math.floor((expiresAt - acknowledgedAt) / 1_000),
        input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE" });
    } catch (error) {
      if (error instanceof OwnerVeoOmniReferenceServiceError) {
        if (nativeInvoked && !published && error.code !== "UPLOAD_OUTCOME_UNKNOWN") fail("UPLOAD_OUTCOME_UNKNOWN");
        throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) {
        if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      return fail("VALIDATION_REJECTED");
    } finally {
      if (semanticKey !== undefined && ownsSemanticReservation) {
        if (nativeInvoked && !published) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      if (validation && isOwnerVeoOmniValidatedReference(validation)) releaseOwnerVeoOmniValidatedReference(validation);
      request.bytes.fill(0);
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveReferences(input: unknown, signalInput?: AbortSignal): Promise<OwnerVeoOmniOwnedReferences> {
    this.#assertOpen();
    const request = snapshotResolve(input);
    const operation = this.#begin(request.attemptId, exactSignal(signalInput));
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const records: ReferenceRecord[] = [];
      const now = this.#readNow();
      for (const handle of request.handles) {
        const record = this.#records.get(handle);
        if (!record || record.handle !== handle || record.attemptId !== request.attemptId || !sameGenerationPrincipal(record.principal, principal)) {
          fail("REFERENCE_UNAVAILABLE");
        }
        if (record.expiresAt <= now) { this.#removeRecord(handle); fail("REFERENCE_EXPIRED"); }
        if (record.epoch !== operation.epoch || record.profileHash !== this.#profileHash ||
            snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client || !isSafeUploadReferenceUrl(record.url)) {
          fail("REFERENCE_UNAVAILABLE");
        }
        records.push(record);
      }
      const latest = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(latest, principal)) fail("PRINCIPAL_NOT_LINKED");
      const referencePrincipal = records[0]!.principal;
      const expiresAt = Math.min(...records.map((record) => record.expiresAt));
      const acknowledgedAt = this.#readNow();
      for (const record of records) {
        if (record.expiresAt <= acknowledgedAt || this.#records.get(record.handle) !== record ||
            record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#invalidating.has(request.attemptId) ||
            snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client || !sameGenerationPrincipal(record.principal, latest)) {
          fail("REFERENCE_EXPIRED");
        }
      }
      const references = Object.freeze(records.map((record) => Object.freeze({ reference_handle: record.handle, kind: record.kind,
        mime_type: record.mimeType, size: record.size, sha256: record.sha256, width: record.width, height: record.height,
        duration_seconds: record.durationSeconds })));
      const owned: OwnerVeoOmniOwnedReferences = Object.freeze({ attempt_id: request.attemptId, principal: referencePrincipal,
        profile_sha256: this.#profileHash, expires_at: expiresAt, epoch: operation.epoch, references, generation_permit: false });
      OWNED_REFERENCES.set(owned, Object.freeze({ service: this, records: Object.freeze([...records]), attemptId: request.attemptId,
        principal: referencePrincipal, epoch: operation.epoch, expiresAt }));
      return owned;
    } catch (error) {
      if (error instanceof OwnerVeoOmniReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedReferences(value: unknown): value is OwnerVeoOmniOwnedReferences {
    try {
      this.#assertOpen();
      if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const owned = OWNED_REFERENCES.get(value);
      const rememberedPrincipal = owned ? this.#principalByAttempt.get(owned.attemptId) : undefined;
      if (!owned || owned.service !== this || !Object.isFrozen(owned.records) || this.#readNow() >= owned.expiresAt ||
          owned.epoch !== (this.#epochs.get(owned.attemptId) ?? 0) || this.#invalidating.has(owned.attemptId) ||
          !rememberedPrincipal || !sameGenerationPrincipal(rememberedPrincipal, owned.principal) ||
          !exactOwnedShape(value, owned, this.#profileHash)) return false;
      for (const record of owned.records) {
        if (this.#records.get(record.handle) !== record || record.expiresAt <= this.#lastNow! || record.epoch !== owned.epoch ||
            !sameGenerationPrincipal(record.principal, owned.principal) || record.profileHash !== this.#profileHash ||
            snapshotNativeClient(this.#resolveClient(record.attemptId)).client !== record.client || !isSafeUploadReferenceUrl(record.url)) return false;
      }
      return true;
    } catch { return false; }
  }

  withCapturedReferences<T>(
    value: unknown,
    consume: (client: SyntxChatHttpClient,
      refs: readonly Readonly<{ reference_handle: string; kind: "image" | "video"; url: string }>[]) => T
  ): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? OWNED_REFERENCES.get(value) : undefined;
    if (!owned || owned.service !== this || !this.isOwnedReferences(value)) fail("REFERENCE_UNAVAILABLE");
    const client = owned.records[0]?.client;
    if (!client) fail("REFERENCE_UNAVAILABLE");
    const references = Object.freeze(owned.records.map((record) => Object.freeze({
      reference_handle: record.handle, kind: record.kind, url: record.url
    })));
    for (const record of owned.records) {
      if (record.client !== client || snapshotNativeClient(this.#resolveClient(record.attemptId)).client !== client) fail("REFERENCE_UNAVAILABLE");
    }
    return consume(client, references);
  }

  invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT_PATTERN.test(attemptIdInput)) return Promise.resolve();
    return this.#invalidate(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const invalidations = [...this.#activeAttempts()].map((attemptId) => this.#invalidate(attemptId));
    const pending = [...this.#allOperations];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
      this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear();
      this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerVeoOmniReferenceServiceError("REQUEST_ABORTED"));
    const pending = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return pending;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerVeoOmniReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([pending, aborted]).finally(remove);
  }

  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId);
    if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal);
    return true;
  }

  #begin(attemptId: string, parent?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    this.#prune(this.#readNow());
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation: PendingOperation = { controller, done, finish,
      removeParentAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done); this.#pendingCount++;
    return operation;
  }

  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort();
    const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation);
    if (!pending?.size) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount--;
    operation.finish();
    this.#allOperations.delete(operation.done);
    this.#maybeRelease(attemptId);
  }

  #throwIfStopped(operation: PendingOperation): void {
    this.#assertOpen();
    if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
  }

  #throwAsUnknownIfStopped(operation: PendingOperation): void {
    if (this.#closed || operation.controller.signal.aborted) fail("UPLOAD_OUTCOME_UNKNOWN");
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
    const completed = Promise.allSettled(pending).then(() => {
      this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeRelease(attemptId);
    });
    this.#invalidations.set(attemptId, completed);
    return completed;
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
  }

  #maybeRelease(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId);
    this.#principalByAttempt.delete(attemptId);
  }

  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }

  #readNow(): number {
    let value: unknown;
    try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number;
    return value as number;
  }
}

Object.freeze(OwnerVeoOmniReferenceService.prototype);

export function isOwnerVeoOmniReferenceService(value: unknown): value is OwnerVeoOmniReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && REFERENCE_SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerVeoOmniReferenceService.prototype && Object.isFrozen(value);
}

function snapshotUpload(input: unknown, maxFileBytes: number): UploadSnapshot {
  const fields = exactRecord(input, ["attemptId", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId) || typeof fields.filename !== "string" ||
      typeof fields.mime_type !== "string" || !isSupportedBytes(fields.bytes)) fail("INVALID_REQUEST");
  const byteLength = intrinsicByteLength(fields.bytes);
  if (byteLength < 1 || byteLength > maxFileBytes) fail("INVALID_REQUEST");
  const bytes = snapshotBytes(fields.bytes);
  return Object.freeze({ attemptId: fields.attemptId, filename: fields.filename, mimeType: fields.mime_type, bytes });
}

function snapshotResolve(input: unknown): ResolveSnapshot {
  const fields = exactRecord(input, ["attemptId", "reference_handles"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId)) fail("INVALID_REQUEST");
  const handles = snapshotHandles(fields.reference_handles);
  if (new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, handles });
}

function snapshotHandles(value: unknown): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const length = descriptors.length;
    if (!length || !Object.hasOwn(length, "value") || !Number.isSafeInteger(length.value) || length.value < 1 || length.value > 7 ||
        Reflect.ownKeys(descriptors).length !== length.value + 1) fail("INVALID_REQUEST");
    const handles: string[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value") ||
          typeof descriptor.value !== "string" || !isExactMatch(HANDLE_PATTERN, descriptor.value)) fail("INVALID_REQUEST");
      handles.push(descriptor.value);
    }
    return Object.freeze(handles);
  } catch (error) {
    if (error instanceof OwnerVeoOmniReferenceServiceError) throw error;
    fail("INVALID_REQUEST");
  }
}

function exactOwnedShape(value: object, owned: NonNullable<ReturnType<typeof OWNED_REFERENCES.get>>, profileHash: string): boolean {
  try {
    const fields = exactRecord(value, ["attempt_id", "principal", "profile_sha256", "expires_at", "epoch", "references", "generation_permit"]);
    if (fields.attempt_id !== owned.attemptId || fields.principal !== owned.principal || fields.profile_sha256 !== profileHash ||
        fields.expires_at !== owned.expiresAt || fields.epoch !== owned.epoch || fields.generation_permit !== false ||
        !Array.isArray(fields.references) || types.isProxy(fields.references) || !Object.isFrozen(fields.references) ||
        fields.references.length !== owned.records.length) return false;
    for (let index = 0; index < owned.records.length; index += 1) {
      const actual = fields.references[index], record = owned.records[index];
      if (!actual || typeof actual !== "object" || types.isProxy(actual) || !Object.isFrozen(actual) || !record) return false;
      const ref = exactRecord(actual, ["reference_handle", "kind", "mime_type", "size", "sha256", "width", "height", "duration_seconds"]);
      if (ref.reference_handle !== record.handle || ref.kind !== record.kind || ref.mime_type !== record.mimeType ||
          ref.size !== record.size || ref.sha256 !== record.sha256 || ref.width !== record.width || ref.height !== record.height ||
          ref.duration_seconds !== record.durationSeconds) return false;
    }
    return true;
  } catch { return false; }
}

function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) copy[key] = descriptors[key]!.value;
  return copy;
}

function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(fields.tenant_id) || /[\u0000-\u001f\u007f]/u.test(fields.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadOwnerVeoOmniReference") || getDataMethod(value, "uploadOwnerVeoOmniReference") !== NATIVE_UPLOAD ||
        SyntxChatHttpClient.prototype.uploadOwnerVeoOmniReference !== NATIVE_UPLOAD ||
        Reflect.get(value, "uploadOwnerVeoOmniReference") !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch (error) {
    if (error instanceof OwnerVeoOmniReferenceServiceError) throw error;
    fail("INVALID_REQUEST");
  }
}

function readNativeReference(input: unknown): Readonly<InternalUploadReference> | undefined {
  try {
    if (!input || typeof input !== "object" || types.isProxy(input) || !Object.isFrozen(input)) return undefined;
    const fields = exactRecord(input, ["url"], ["file_id"]);
    if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
        (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !MAX_FILE_ID.test(fields.file_id)))) return undefined;
    return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id as string }) });
  } catch { return undefined; }
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal) ||
      Object.getPrototypeOf(signal) !== AbortSignal.prototype) fail("INVALID_REQUEST");
  return signal;
}

function isSupportedBytes(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== UINT8_ARRAY_PROTOTYPE && !Buffer.isBuffer(value)) ||
      ["buffer", "byteLength", "byteOffset", "length"].some((key) => Object.hasOwn(value, key))) return false;
  try {
    if (!TYPED_ARRAY_BYTE_LENGTH || !TYPED_ARRAY_BUFFER || !TYPED_ARRAY_BYTE_OFFSET) return false;
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER, value, []);
    return backing instanceof ArrayBuffer && Object.getPrototypeOf(backing) === ArrayBuffer.prototype &&
      Number.isSafeInteger(Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, [])) &&
      Number.isSafeInteger(Reflect.apply(TYPED_ARRAY_BYTE_OFFSET, value, []));
  } catch { return false; }
}

function snapshotBytes(value: Uint8Array): Buffer {
  if (!TYPED_ARRAY_BUFFER || !TYPED_ARRAY_BYTE_OFFSET) return fail("INVALID_REQUEST");
  try {
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER, value, []) as ArrayBuffer;
    const offset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET, value, []) as number;
    const length = intrinsicByteLength(value);
    return Buffer.from(new Uint8Array(backing, offset, length));
  } catch { return fail("INVALID_REQUEST"); }
}

function intrinsicByteLength(value: Uint8Array): number {
  try { if (!TYPED_ARRAY_BYTE_LENGTH) fail("INVALID_REQUEST"); return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, []) as number; }
  catch { return fail("INVALID_REQUEST"); }
}

function isGenuineLinkService(value: unknown): value is PerUserLinkService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
      PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
  return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_STATUS && typeof descriptor.value === "function";
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

function normalizedSourceMime(value: string): OwnerVeoOmniReferenceMimeType | undefined {
  return value === "image/jpg" ? "image/jpeg" : value as OwnerVeoOmniReferenceMimeType;
}

function semanticKeyFor(principal: Readonly<GenerationPrincipalRef>, reference: Readonly<OwnerVeoOmniValidatedReference>, profileHash: string): string {
  return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, profile_hash: profileHash,
    sha256: reference.sha256, mime_type: reference.mime_type, size: reference.size });
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function isExactMatch(pattern: RegExp, value: string): boolean {
  const match = pattern.exec(value);
  return match?.[0] === value;
}

function fail(code: OwnerVeoOmniReferenceServiceErrorCode): never {
  throw new OwnerVeoOmniReferenceServiceError(code);
}
