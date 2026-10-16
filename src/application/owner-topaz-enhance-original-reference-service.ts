import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient, readOwnerTopazEnhanceOriginalUploadForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerTopazEnhanceOriginalUploadContext } from "../adapter/syntx/topaz-enhance-original-upload.js";
import {
  OWNER_TOPAZ_ENHANCE_MODEL_ID,
  OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION,
  getOwnerTopazEnhanceSourceProfile
} from "./owner-topaz-enhance-source-profile.js";
import {
  createOwnerTopazEnhanceOriginalProbe,
  isTrustedOwnerTopazEnhanceOriginalProbeResult,
  releaseTrustedOwnerTopazEnhanceOriginalProbeResult,
  OwnerTopazEnhanceOriginalProbeError,
  type OwnerTopazEnhanceOriginalProbeResult
} from "./owner-topaz-enhance-original-probe.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^topaz_enhance_original_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadTopazEnhanceOriginal;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerTopazEnhanceOriginalReferenceService; readonly record: RecordEntry }>();

export interface OwnerTopazEnhanceOriginalReferenceServiceOptions {
  /** Trusted operator config, never sourced from request data. */
  readonly ffprobePath: string;
  readonly destination: "uploaded" | "hidden";
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerTopazEnhanceOriginalUploadInput {
  readonly attemptId: string;
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly bytes: Uint8Array;
}
export interface OwnerTopazEnhanceOriginalUploadReceipt {
  readonly status: "uploaded";
  readonly topaz_original_handle: string;
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly frame_count: number;
  readonly expires_in_seconds: number;
}
export interface OwnerTopazEnhanceOriginalResolveInput {
  readonly attempt_id: string;
  readonly topaz_original_handle: string;
}
export interface OwnerTopazEnhanceOriginalResolution {
  readonly role: "topaz_enhance_original";
  readonly wire_type: "video";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: typeof OWNER_TOPAZ_ENHANCE_MODEL_ID;
  readonly ai_name: "topaz_ai";
  readonly source_catalog_version: typeof OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION;
  readonly profile_schema_hash: string;
  readonly topaz_original_handle: string;
  readonly sha256: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly frame_count: number;
  readonly destination: "uploaded" | "hidden";
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}
export type OwnerTopazEnhanceOriginalReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "PROBE_REJECTED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerTopazEnhanceOriginalReferenceServiceError extends Error {
  constructor(readonly code: OwnerTopazEnhanceOriginalReferenceServiceErrorCode) {
    super("The owner Topaz Enhance original is unavailable.");
    this.name = "OwnerTopazEnhanceOriginalReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profileHash: string;
  readonly sourceSha256: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly frameCount: number;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly nativeReference: OwnerTopazEnhanceOriginalUploadContext;
}
interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

/** Process-local owner-bound Enhance references. Upload success never grants generation permission. */
export class OwnerTopazEnhanceOriginalReferenceService {
  readonly #probe: ReturnType<typeof createOwnerTopazEnhanceOriginalProbe>;
  readonly #destination: "uploaded" | "hidden";
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: OwnerTopazEnhanceOriginalReferenceServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #profileHash: string;
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

  constructor(optionsInput: OwnerTopazEnhanceOriginalReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["ffprobePath", "destination", "binding", "linkService", "resolveClient"], ["now"]);
    if (typeof fields.ffprobePath !== "string" || !isGenuineLinkService(fields.linkService) ||
        (fields.destination !== "uploaded" && fields.destination !== "hidden") || typeof fields.resolveClient !== "function" ||
        types.isProxy(fields.resolveClient) || (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
    const profile = getOwnerTopazEnhanceSourceProfile(OWNER_TOPAZ_ENHANCE_MODEL_ID);
    if (!profile || profile.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID || profile.ai_name !== "topaz_ai" ||
        profile.source_pins.public_catalog_version !== OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION) fail("INVALID_REQUEST");
    this.#probe = createOwnerTopazEnhanceOriginalProbe({ ffprobePath: fields.ffprobePath });
    this.#destination = fields.destination;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as OwnerTopazEnhanceOriginalReferenceServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    this.#profileHash = schemaHash(profile);
    Object.freeze(this);
  }

  async uploadOriginal(input: OwnerTopazEnhanceOriginalUploadInput | unknown, signalInput?: AbortSignal): Promise<OwnerTopazEnhanceOriginalUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input);
    const parentSignal = exactSignal(signalInput);
    const operation = this.#begin(request.attemptId, parentSignal);
    let probe: Readonly<OwnerTopazEnhanceOriginalProbeResult> | undefined;
    let semanticKey: string | undefined;
    let nativeInvoked = false;
    let unknownOutcome = false;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = snapshotNativeClient(this.#resolveClient(request.attemptId));
      probe = await this.#probe.probe({ model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID, ai_name: "topaz_ai",
        source_catalog_version: OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION,
        filename: request.filename, mime_type: request.mime_type, bytes: request.bytes }, { signal: operation.controller.signal });
      this.#throwIfStopped(operation);
      if (!isTrustedOwnerTopazEnhanceOriginalProbeResult(probe) || probe.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID ||
          probe.ai_name !== "topaz_ai" || probe.source_catalog_version !== OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION) fail("PROBE_REJECTED");
      const profile = getOwnerTopazEnhanceSourceProfile(OWNER_TOPAZ_ENHANCE_MODEL_ID);
      if (!profile || schemaHash(profile) !== this.#profileHash) fail("PROBE_REJECTED");
      semanticKey = this.#semanticKey(principal, probe);
      if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semanticKey);

      const beforeUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      const clientBeforeUpload = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, beforeUpload) || clientBeforeUpload.client !== client.client) fail("PRINCIPAL_NOT_LINKED");
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      nativeInvoked = true;
      const nativeReference = await Reflect.apply(NATIVE_UPLOAD, client.client, [probe, this.#destination, operation.controller.signal]) as OwnerTopazEnhanceOriginalUploadContext;
      this.#throwIfStopped(operation);
      const witness = readOwnerTopazEnhanceOriginalUploadForClient(client.client, nativeReference);
      if (!witness || !this.#matchesProbe(witness, probe)) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const afterUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal).catch(() => {
        unknownOutcome = true;
        fail("UPLOAD_OUTCOME_UNKNOWN");
      });
      this.#throwIfStopped(operation);
      const clientAfterUpload = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, afterUpload) || clientAfterUpload.client !== client.client ||
          !readOwnerTopazEnhanceOriginalUploadForClient(client.client, nativeReference)) {
        unknownOutcome = true;
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const acknowledgedAt = this.#readNow();
      const expiresAt = issuedAt + TTL_MS;
      if (expiresAt - acknowledgedAt < 1_000 || operation.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || !this.#pendingSemantics.has(semanticKey)) {
        unknownOutcome = true;
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const handle = `topaz_enhance_original_${randomUUID()}`;
      const video = probe.metadata.video;
      const record: RecordEntry = Object.freeze({ handle, attemptId: request.attemptId, principal, profileHash: this.#profileHash,
        sourceSha256: probe.source_sha256, size: probe.bytes_copied, width: video.width, height: video.height,
        durationSeconds: video.duration_seconds, frameCount: video.frame_count, expiresAt, epoch: operation.epoch,
        client: client.client, nativeReference });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle);
      this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", topaz_original_handle: handle, model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID,
        mime_type: "video/mp4", size: record.size, sha256: record.sourceSha256, width: record.width, height: record.height,
        duration_seconds: record.durationSeconds, frame_count: record.frameCount,
        expires_in_seconds: Math.floor((expiresAt - acknowledgedAt) / 1000) });
    } catch (error) {
      if (error instanceof OwnerTopazEnhanceOriginalReferenceServiceError) {
        if (nativeInvoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") {
          unknownOutcome = true;
          fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome ||= nativeInvoked;
        throw error;
      }
      if (error instanceof OwnerTopazEnhanceOriginalProbeError && error.code === "PROBE_ABORTED" ||
          operation.controller.signal.aborted && !nativeInvoked) fail("REQUEST_ABORTED");
      if (error instanceof OwnerReferencePrincipalError) {
        if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        fail("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof SyntxHttpError && isKnownRejection(error.code)) fail("UPLOAD_REJECTED");
      if (nativeInvoked) { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      return fail("PROBE_REJECTED");
    } finally {
      if (semanticKey !== undefined) {
        if (unknownOutcome) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      if (probe && isTrustedOwnerTopazEnhanceOriginalProbeResult(probe)) {
        try { releaseTrustedOwnerTopazEnhanceOriginalProbeResult(probe); } catch { /* best effort after drain */ }
      }
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveOriginal(input: OwnerTopazEnhanceOriginalResolveInput | unknown, signalInput?: AbortSignal): Promise<OwnerTopazEnhanceOriginalResolution> {
    this.#assertOpen();
    const request = snapshotResolve(input);
    const operation = this.#begin(request.attemptId, exactSignal(signalInput));
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const record = this.#records.get(request.handle);
      if (!record || record.attemptId !== request.attemptId) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      if (record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || !sameGenerationPrincipal(record.principal, principal) ||
          snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client ||
          !readOwnerTopazEnhanceOriginalUploadForClient(record.client, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(latest, record.principal) || snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client) fail("PRINCIPAL_NOT_LINKED");
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#invalidating.has(request.attemptId) ||
          !readOwnerTopazEnhanceOriginalUploadForClient(record.client, record.nativeReference)) fail("REFERENCE_EXPIRED");
      const resolution: OwnerTopazEnhanceOriginalResolution = Object.freeze({ role: "topaz_enhance_original", wire_type: "video",
        principal: record.principal, attempt_id: record.attemptId, model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID, ai_name: "topaz_ai",
        source_catalog_version: OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION, profile_schema_hash: record.profileHash,
        topaz_original_handle: record.handle, sha256: record.sourceSha256, mime_type: "video/mp4", size: record.size,
        width: record.width, height: record.height, duration_seconds: record.durationSeconds, frame_count: record.frameCount,
        destination: this.#destination, expires_at: record.expiresAt, epoch: record.epoch, generation_permit: false });
      RESOLUTIONS.set(resolution, { service: this, record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerTopazEnhanceOriginalReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedOriginalResolution(value: unknown, input: OwnerTopazEnhanceOriginalResolveInput | unknown): boolean {
    try {
      this.#assertOpen();
      const request = snapshotResolve(input);
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value), record = this.#records.get(request.handle);
      if (!owned || owned.service !== this || !record || owned.record !== record || record.attemptId !== request.attemptId ||
          record.expiresAt <= this.#readNow() || record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || !readOwnerTopazEnhanceOriginalUploadForClient(record.client, record.nativeReference)) return false;
      if (snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== record.client) return false;
      return exactResolutionMatches(value, record, this.#destination);
    } catch { return false; }
  }

  withCapturedNativeOriginal<T>(value: unknown, input: OwnerTopazEnhanceOriginalResolveInput | unknown,
    consume: (client: SyntxChatHttpClient, reference: OwnerTopazEnhanceOriginalUploadContext) => T): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const request = snapshotResolve(input);
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value) : undefined;
    if (!owned || owned.service !== this || owned.record.attemptId !== request.attemptId || owned.record.handle !== request.handle ||
        !this.isOwnedOriginalResolution(value, input)) fail("REFERENCE_UNAVAILABLE");
    return consume(owned.record.client, owned.record.nativeReference);
  }

  invalidateAttempt(attemptIdInput: unknown): Promise<void> {
    if (typeof attemptIdInput !== "string" || !ATTEMPT.test(attemptIdInput)) return Promise.resolve();
    return this.#invalidate(attemptIdInput);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const invalidations = [...this.#activeAttempts()].map((attemptId) => this.#invalidate(attemptId));
    const pending = [...this.#allOperations];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#records.clear(); this.#handlesByAttempt.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
      this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear(); this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerTopazEnhanceOriginalReferenceServiceError("REQUEST_ABORTED"));
    const pending = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return pending;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerTopazEnhanceOriginalReferenceServiceError("REQUEST_ABORTED"));
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
    if (!this.#activeAttempts().has(attemptId) && this.#activeAttempts().size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation: PendingOperation = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abort),
      epoch: this.#epochs.get(attemptId) ?? 0 };
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
      this.#invalidating.delete(attemptId);
      this.#invalidations.delete(attemptId);
      this.#maybeRelease(attemptId);
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
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }

  #maybeRelease(attemptId: string): void {
    if (this.#handlesByAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId);
    this.#principalByAttempt.delete(attemptId);
  }

  #semanticKey(principal: Readonly<GenerationPrincipalRef>, probe: OwnerTopazEnhanceOriginalProbeResult): string {
    return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, model_id: probe.model_id,
      profile_schema_hash: this.#profileHash, sha256: probe.source_sha256, mime_type: probe.mime_type, size: probe.bytes_copied });
  }

  #matchesProbe(witness: OwnerTopazEnhanceOriginalUploadContext & Readonly<{ url: string }>, probe: OwnerTopazEnhanceOriginalProbeResult): boolean {
    const video = probe.metadata.video;
    return witness.status === "OWNER_TOPAZ_ENHANCE_ORIGINAL_UPLOADED" && witness.model_id === probe.model_id &&
      witness.ai_name === probe.ai_name && witness.source_catalog_version === probe.source_catalog_version &&
      witness.destination === this.#destination && witness.source_sha256 === probe.source_sha256 &&
      witness.source_size === probe.bytes_copied && witness.source_mime_type === probe.mime_type &&
      witness.width === video.width && witness.height === video.height && witness.duration_seconds === video.duration_seconds &&
      witness.frame_count === video.frame_count;
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

function snapshotUpload(input: unknown): Readonly<OwnerTopazEnhanceOriginalUploadInput> {
  const fields = exactRecord(input, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || fields.model_id !== OWNER_TOPAZ_ENHANCE_MODEL_ID ||
      typeof fields.filename !== "string" || fields.mime_type !== "video/mp4" || !fields.bytes || typeof fields.bytes !== "object" ||
      types.isProxy(fields.bytes) || !(fields.bytes instanceof Uint8Array)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, model_id: OWNER_TOPAZ_ENHANCE_MODEL_ID, filename: fields.filename,
    mime_type: "video/mp4", bytes: fields.bytes as Uint8Array });
}

function snapshotResolve(input: unknown): Readonly<{ attemptId: string; handle: string }> {
  const fields = exactRecord(input, ["attempt_id", "topaz_original_handle"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) || typeof fields.topaz_original_handle !== "string" ||
      !HANDLE.test(fields.topaz_original_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attempt_id, handle: fields.topaz_original_handle });
}

function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
      SyntxChatHttpClient.prototype.uploadTopazEnhanceOriginal !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
  const descriptor = Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, "uploadTopazEnhanceOriginal");
  if (!descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
  return Object.freeze({ client: value as SyntxChatHttpClient });
}

function exactResolutionMatches(value: object, record: RecordEntry, destination: "uploaded" | "hidden"): boolean {
  const fields = exactRecord(value, ["role", "wire_type", "principal", "attempt_id", "model_id", "ai_name", "source_catalog_version",
    "profile_schema_hash", "topaz_original_handle", "sha256", "mime_type", "size", "width", "height", "duration_seconds",
    "frame_count", "destination", "expires_at", "epoch", "generation_permit"]);
  return fields.role === "topaz_enhance_original" && fields.wire_type === "video" && fields.attempt_id === record.attemptId &&
    fields.model_id === OWNER_TOPAZ_ENHANCE_MODEL_ID && fields.ai_name === "topaz_ai" &&
    fields.source_catalog_version === OWNER_TOPAZ_ENHANCE_PUBLIC_CATALOG_VERSION && fields.profile_schema_hash === record.profileHash &&
    fields.topaz_original_handle === record.handle && fields.sha256 === record.sourceSha256 && fields.mime_type === "video/mp4" &&
    fields.size === record.size && fields.width === record.width && fields.height === record.height &&
    fields.duration_seconds === record.durationSeconds && fields.frame_count === record.frameCount && fields.destination === destination &&
    fields.expires_at === record.expiresAt && fields.epoch === record.epoch && fields.generation_permit === false &&
    samePrincipal(fields.principal, record.principal);
}

function samePrincipal(value: unknown, expected: Readonly<GenerationPrincipalRef>): boolean {
  try { return sameGenerationPrincipal(snapshotGenerationPrincipal(value as GenerationPrincipalRef), expected); } catch { return false; }
}

function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function exactSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (!signal || typeof signal !== "object" || types.isProxy(signal) || !(signal instanceof AbortSignal)) fail("INVALID_REQUEST");
  return signal;
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

function isKnownRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function fail(code: OwnerTopazEnhanceOriginalReferenceServiceErrorCode): never {
  throw new OwnerTopazEnhanceOriginalReferenceServiceError(code);
}
