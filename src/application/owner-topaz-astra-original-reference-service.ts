import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient, readOwnerTopazAstraOriginalUploadForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerTopazAstraOriginalUploadContext } from "../adapter/syntx/topaz-astra-original-upload.js";
import { createOwnerTopazAstraOriginalProbe, isTrustedOwnerTopazAstraOriginalProbeResult,
  releaseTrustedOwnerTopazAstraOriginalProbeResult, type OwnerTopazAstraOriginalProbeResult } from "./owner-topaz-astra-original-probe.js";
import { getOwnerTopazAstraSourceProfile, type OwnerTopazAstraModelId } from "./owner-topaz-astra-source-profile.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^topaz_astra_original_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadTopazAstraOriginal;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerTopazAstraOriginalReferenceService; readonly record: RecordEntry }>();

export interface OwnerTopazAstraOriginalReferenceServiceOptions {
  /** Trusted server/operator configuration. Never populate this from MCP arguments. */
  readonly ffprobePath: string;
  /** Explicit trusted composition choice; this is not a public upload argument. */
  readonly destination: "uploaded" | "hidden";
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerTopazAstraOriginalUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerTopazAstraModelId;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly bytes: Uint8Array;
}
export interface OwnerTopazAstraOriginalUploadReceipt {
  readonly status: "uploaded";
  readonly topaz_original_handle: string;
  readonly model_id: OwnerTopazAstraModelId;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly decoded_frame_count: number;
  readonly expires_in_seconds: number;
}
export interface OwnerTopazAstraOriginalResolveInput {
  readonly attempt_id: string;
  readonly topaz_original_handle: string;
}
export interface OwnerTopazAstraOriginalResolution {
  readonly role: "topaz_astra_original";
  readonly wire_type: "video";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: OwnerTopazAstraModelId;
  readonly profile_schema_hash: string;
  readonly topaz_original_handle: string;
  readonly sha256: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly decoded_frame_count: number;
  readonly destination: "uploaded" | "hidden";
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}
export type OwnerTopazAstraOriginalReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "PROBE_REJECTED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerTopazAstraOriginalReferenceServiceError extends Error {
  constructor(readonly code: OwnerTopazAstraOriginalReferenceServiceErrorCode) {
    super("The owner Topaz Astra original is unavailable.");
    this.name = "OwnerTopazAstraOriginalReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profileHash: string; readonly probe: Readonly<OwnerTopazAstraOriginalProbeResult>;
  readonly expiresAt: number; readonly epoch: number; readonly client: SyntxChatHttpClient;
  readonly nativeReference: OwnerTopazAstraOriginalUploadContext;
}
interface PendingOperation {
  readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void;
  readonly removeParentAbort: () => void; readonly epoch: number;
}

/** Process-local, owner-bound Topaz upload handles. This service never issues a generation permit. */
export class OwnerTopazAstraOriginalReferenceService {
  readonly #probe: ReturnType<typeof createOwnerTopazAstraOriginalProbe>;
  readonly #destination: "uploaded" | "hidden";
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: OwnerTopazAstraOriginalReferenceServiceOptions["resolveClient"];
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
  #pendingCount = 0; #lastNow: number | undefined; #closed = false; #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerTopazAstraOriginalReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["ffprobePath", "destination", "binding", "linkService", "resolveClient"], ["now"]);
    if (typeof fields.ffprobePath !== "string" || !fields.ffprobePath || !isGenuineLinkService(fields.linkService) ||
        (fields.destination !== "uploaded" && fields.destination !== "hidden") || typeof fields.resolveClient !== "function" ||
        types.isProxy(fields.resolveClient) || (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
    this.#probe = createOwnerTopazAstraOriginalProbe({ ffprobePath: fields.ffprobePath });
    this.#destination = fields.destination;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = fields.resolveClient as OwnerTopazAstraOriginalReferenceServiceOptions["resolveClient"];
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    Object.freeze(this);
  }

  async uploadOriginal(input: OwnerTopazAstraOriginalUploadInput | unknown, signal?: AbortSignal): Promise<OwnerTopazAstraOriginalUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input, signal);
    const operation = this.#begin(request.attemptId, signal);
    let probeResult: Readonly<OwnerTopazAstraOriginalProbeResult> | undefined;
    let semanticKey: string | undefined;
    let nativeInvoked = false;
    let unknownOutcome = false;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = snapshotNativeClient(this.#resolveClient(request.attemptId));
      probeResult = await this.#probe.probe({ model_id: request.model_id, filename: request.filename,
        mime_type: request.mime_type, bytes: request.bytes }, { signal: operation.controller.signal });
      this.#throwIfStopped(operation);
      const profile = getOwnerTopazAstraSourceProfile(request.model_id);
      if (!profile || !isTrustedOwnerTopazAstraOriginalProbeResult(probeResult)) fail("PROBE_REJECTED");
      semanticKey = semanticKeyFor(principal, profile, probeResult);
      if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semanticKey);
      const beforeUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(principal, beforeUpload) || snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== client.client) {
        fail("PRINCIPAL_NOT_LINKED");
      }
      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      nativeInvoked = true;
      const nativeReference = await Reflect.apply(NATIVE_UPLOAD, client.client, [probeResult, this.#destination, operation.controller.signal]);
      this.#throwIfStopped(operation);
      const details = readOwnerTopazAstraOriginalUploadForClient(client.client, nativeReference);
      if (!details || details.destination !== this.#destination || details.model_id !== request.model_id ||
          details.source_sha256 !== probeResult.source_sha256 || details.source_size !== probeResult.bytes_copied ||
          details.source_mime_type !== probeResult.mime_type || details.width !== probeResult.metadata.width ||
          details.height !== probeResult.metadata.height || details.duration_seconds !== probeResult.metadata.duration_seconds ||
          details.decoded_frame_count !== probeResult.metadata.decoded_frame_count) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const afterUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal).catch(() => {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      });
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(principal, afterUpload) || snapshotNativeClient(this.#resolveClient(request.attemptId)).client !== client.client) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const acknowledgedAt = this.#readNow();
      const expiresAt = issuedAt + TTL_MS;
      if (expiresAt - acknowledgedAt < 1_000 || operation.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || !this.#pendingSemantics.has(semanticKey)) {
        unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const handle = `topaz_astra_original_${randomUUID()}`;
      const record: RecordEntry = Object.freeze({ handle, attemptId: request.attemptId, principal, profileHash: profileHash(profile),
        probe: probeResult, expiresAt, epoch: operation.epoch, client: client.client, nativeReference });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      const remaining = Math.floor((expiresAt - acknowledgedAt) / 1000);
      return Object.freeze({ status: "uploaded", topaz_original_handle: handle, model_id: request.model_id,
        mime_type: probeResult.mime_type, size: probeResult.bytes_copied, sha256: probeResult.source_sha256,
        width: probeResult.metadata.width, height: probeResult.metadata.height,
        duration_seconds: probeResult.metadata.duration_seconds, decoded_frame_count: probeResult.metadata.decoded_frame_count,
        expires_in_seconds: remaining });
    } catch (error) {
      if (error instanceof OwnerTopazAstraOriginalReferenceServiceError) {
        if (nativeInvoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") { unknownOutcome = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        if (error.code === "UPLOAD_OUTCOME_UNKNOWN") unknownOutcome ||= nativeInvoked;
        throw error;
      }
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
      if (probeResult && isTrustedOwnerTopazAstraOriginalProbeResult(probeResult)) {
        try { releaseTrustedOwnerTopazAstraOriginalProbeResult(probeResult); } catch { /* best-effort wipe after drain */ }
      }
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveOriginal(input: OwnerTopazAstraOriginalResolveInput | unknown, signal?: AbortSignal): Promise<OwnerTopazAstraOriginalResolution> {
    this.#assertOpen();
    const request = snapshotResolve(input);
    const operation = this.#begin(request.attemptId, signal);
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const record = this.#records.get(request.handle);
      if (!record || record.attemptId !== request.attemptId) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      if (record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || !sameGenerationPrincipal(record.principal, principal) ||
          !readOwnerTopazAstraOriginalUploadForClient(record.client, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(latest, record.principal)) fail("PRINCIPAL_NOT_LINKED");
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#invalidating.has(request.attemptId)) fail("REFERENCE_EXPIRED");
      const resolution: OwnerTopazAstraOriginalResolution = Object.freeze({ role: "topaz_astra_original", wire_type: "video",
        principal: record.principal, attempt_id: record.attemptId, model_id: record.probe.model_id,
        profile_schema_hash: record.profileHash, topaz_original_handle: record.handle, sha256: record.probe.source_sha256,
        mime_type: record.probe.mime_type, size: record.probe.bytes_copied, width: record.probe.metadata.width,
        height: record.probe.metadata.height, duration_seconds: record.probe.metadata.duration_seconds,
      decoded_frame_count: record.probe.metadata.decoded_frame_count, destination: this.#destination, expires_at: record.expiresAt,
        epoch: record.epoch, generation_permit: false });
      RESOLUTIONS.set(resolution, { service: this, record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerTopazAstraOriginalReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  isOwnedOriginalResolution(value: unknown, input: OwnerTopazAstraOriginalResolveInput | unknown): boolean {
    try {
      this.#assertOpen();
      const request = snapshotResolve(input);
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value), record = this.#records.get(request.handle);
      if (!owned || owned.service !== this || !record || owned.record !== record || record.attemptId !== request.attemptId ||
          record.expiresAt <= this.#readNow() || record.epoch !== (this.#epochs.get(request.attemptId) ?? 0) ||
          this.#invalidating.has(request.attemptId) || !readOwnerTopazAstraOriginalUploadForClient(record.client, record.nativeReference)) return false;
      return exactResolutionMatches(value, record);
    } catch { return false; }
  }

  withCapturedNativeOriginal<T>(value: unknown, input: OwnerTopazAstraOriginalResolveInput | unknown,
    consume: (client: SyntxChatHttpClient, reference: OwnerTopazAstraOriginalUploadContext) => T): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const request = snapshotResolve(input);
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value as object) : undefined;
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
      this.#unknownSemantics.clear(); this.#pendingSemantics.clear(); this.#invalidating.clear(); this.#invalidations.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #resolvePrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerTopazAstraOriginalReferenceServiceError("REQUEST_ABORTED"));
    const resolution = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return resolution;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerTopazAstraOriginalReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([resolution, aborted]).finally(remove);
  }
  #rememberPrincipal(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(attemptId);
    if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(attemptId, principal); return true;
  }
  #begin(attemptId: string, parent?: AbortSignal): PendingOperation {
    this.#assertOpen(); if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    this.#prune(this.#readNow()); if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    if (!this.#activeAttempts().has(attemptId) && this.#activeAttempts().size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const operation = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abort),
      epoch: this.#epochs.get(attemptId) ?? 0 };
    pending.add(operation); this.#pendingByAttempt.set(attemptId, pending); this.#allOperations.add(done); this.#pendingCount++;
    return operation;
  }
  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort(); const pending = this.#pendingByAttempt.get(attemptId);
    pending?.delete(operation); if (!pending?.size) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount--; operation.finish(); this.#allOperations.delete(operation.done); this.#maybeRelease(attemptId);
  }
  #throwIfStopped(operation: PendingOperation): void { this.#assertOpen(); if (operation.controller.signal.aborted) fail("REQUEST_ABORTED"); }
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
  #removeAttemptRecords(attemptId: string): void { for (const handle of this.#handlesByAttempt.get(attemptId) ?? []) this.#records.delete(handle); this.#handlesByAttempt.delete(attemptId); }
  #removeRecord(handle: string): void {
    const record = this.#records.get(handle); if (!record) return; this.#records.delete(handle);
    const handles = this.#handlesByAttempt.get(record.attemptId); handles?.delete(handle); if (!handles?.size) this.#handlesByAttempt.delete(record.attemptId);
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
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number {
    let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number;
  }
}

function snapshotUpload(input: unknown, signal?: AbortSignal): Readonly<OwnerTopazAstraOriginalUploadInput> {
  const f = exactRecord(input, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.model_id !== "string" ||
      !getOwnerTopazAstraSourceProfile(f.model_id) || typeof f.filename !== "string" ||
      (f.mime_type !== "video/mp4" && f.mime_type !== "video/quicktime") || !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes) ||
      (signal !== undefined && (!signal || typeof signal !== "object" || types.isProxy(signal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, model_id: f.model_id as OwnerTopazAstraModelId, filename: f.filename,
    mime_type: f.mime_type, bytes: f.bytes as Uint8Array });
}
function snapshotResolve(input: unknown): Readonly<{ attemptId: string; handle: string }> {
  const f = exactRecord(input, ["attempt_id", "topaz_original_handle"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.topaz_original_handle !== "string" || !HANDLE.test(f.topaz_original_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attempt_id, handle: f.topaz_original_handle });
}
function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
      SyntxChatHttpClient.prototype.uploadTopazAstraOriginal !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
  const descriptor = Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, "uploadTopazAstraOriginal");
  if (!descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
  return Object.freeze({ client: value as SyntxChatHttpClient });
}
function exactResolutionMatches(value: object, record: RecordEntry): boolean {
  const f = exactRecord(value, ["role", "wire_type", "principal", "attempt_id", "model_id", "profile_schema_hash", "topaz_original_handle",
    "sha256", "mime_type", "size", "width", "height", "duration_seconds", "decoded_frame_count", "destination", "expires_at", "epoch", "generation_permit"]);
  const p = record.probe;
  return f.role === "topaz_astra_original" && f.wire_type === "video" && f.attempt_id === record.attemptId && f.model_id === p.model_id &&
    f.profile_schema_hash === record.profileHash && f.topaz_original_handle === record.handle && f.sha256 === p.source_sha256 &&
    f.mime_type === p.mime_type && f.size === p.bytes_copied && f.width === p.metadata.width && f.height === p.metadata.height &&
    f.duration_seconds === p.metadata.duration_seconds && f.decoded_frame_count === p.metadata.decoded_frame_count &&
    f.destination === record.nativeReference.destination &&
    f.expires_at === record.expiresAt && f.epoch === record.epoch && f.generation_permit === false && samePrincipal(f.principal, record.principal);
}
function samePrincipal(value: unknown, expected: Readonly<GenerationPrincipalRef>): boolean {
  try { return sameGenerationPrincipal(snapshotGenerationPrincipal(value as GenerationPrincipalRef), expected); } catch { return false; }
}
function semanticKeyFor(principal: Readonly<GenerationPrincipalRef>, profile: NonNullable<ReturnType<typeof getOwnerTopazAstraSourceProfile>>,
  probe: OwnerTopazAstraOriginalProbeResult): string {
  return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, model_id: probe.model_id,
    profile_schema_hash: profileHash(profile), sha256: probe.source_sha256, mime_type: probe.mime_type, size: probe.bytes_copied });
}
function profileHash(profile: NonNullable<ReturnType<typeof getOwnerTopazAstraSourceProfile>>): string { return schemaHash(profile); }
function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const f = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id || f.tenant_id.length > 256 || typeof f.subject !== "string" || !f.subject || f.subject.length > 512) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject });
}
function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value; return result;
}
function isGenuineLinkService(value: unknown): value is PerUserLinkService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
      PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
  return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_STATUS && typeof descriptor.value === "function";
}
function readClock(value: unknown): () => number {
  if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST");
  return () => { let result: unknown; try { result = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED"); return result as number; };
}
function isKnownRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}
function fail(code: OwnerTopazAstraOriginalReferenceServiceErrorCode): never { throw new OwnerTopazAstraOriginalReferenceServiceError(code); }
