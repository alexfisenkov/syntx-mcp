import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient, isExactOwnerElevenLabsStsUploadClient,
  readOwnerElevenLabsStsOriginalUploadForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerElevenLabsStsOriginalUploadReference } from "../adapter/syntx/owner-elevenlabs-sts-original-upload.js";
import { createOwnerElevenLabsStsOriginalProbe, isTrustedOwnerElevenLabsStsOriginalProbeResult,
  releaseTrustedOwnerElevenLabsStsOriginalProbeResult, type OwnerElevenLabsStsOriginalProbeResult } from "./owner-elevenlabs-sts-original-probe.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^elevenlabs_sts_original_[0-9a-f-]{36}$/u;
const MODEL_TYPE = "eleven_multilingual_sts_v2" as const;
const SOURCE_PROFILE = "OWNER_ELEVENLABS_STS_SOURCE_UI_V1" as const;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadElevenLabsStsOriginal;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLUTIONS = new WeakMap<object, { readonly service: OwnerElevenLabsStsOriginalReferenceService; readonly record: RecordEntry }>();

export interface OwnerElevenLabsStsOriginalReferenceServiceOptions {
  /** Trusted absolute server configuration; never accept this path from a tool caller. */
  readonly ffprobePath: string;
  /** Explicit trusted server destination; the web receipt proves no default. */
  readonly destination: "uploaded" | "hidden";
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerElevenLabsStsOriginalUploadInput {
  readonly attemptId: string;
  readonly filename: string;
  readonly mime_type: "audio/mpeg";
  readonly bytes: Uint8Array;
}
export interface OwnerElevenLabsStsOriginalUploadReceipt {
  readonly status: "uploaded";
  readonly audio_original_handle: string;
  readonly sha256: string;
  readonly size: number;
  readonly mime_type: "audio/mpeg";
  readonly duration_seconds: number;
  readonly expires_in_seconds: number;
}
export interface OwnerElevenLabsStsOriginalResolveInput {
  readonly attempt_id: string;
  readonly audio_original_handle: string;
}
export interface OwnerElevenLabsStsOriginalResolution {
  readonly role: "elevenlabs_sts_original";
  readonly wire_type: "audio";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_type: typeof MODEL_TYPE;
  readonly audio_original_handle: string;
  readonly sha256: string;
  readonly mime_type: "audio/mpeg";
  readonly size: number;
  readonly duration_seconds: number;
  readonly destination: "uploaded" | "hidden";
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}
export type OwnerElevenLabsStsOriginalReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "PROBE_REJECTED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN"
  | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerElevenLabsStsOriginalReferenceServiceError extends Error {
  constructor(readonly code: OwnerElevenLabsStsOriginalReferenceServiceErrorCode) {
    super("The owner ElevenLabs STS original is unavailable.");
    this.name = "OwnerElevenLabsStsOriginalReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly sourceSha256: string;
  readonly size: number;
  readonly durationSeconds: number;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly client: SyntxChatHttpClient;
  readonly nativeReference: OwnerElevenLabsStsOriginalUploadReference;
}
interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentAbort: () => void;
  readonly epoch: number;
}

/** Process-local current-owner STS uploads. It creates no generation permit. */
export class OwnerElevenLabsStsOriginalReferenceService {
  readonly #probe: ReturnType<typeof createOwnerElevenLabsStsOriginalProbe>;
  readonly #destination: "uploaded" | "hidden";
  readonly #binding: Readonly<AuthBinding>;
  readonly #linkService: PerUserLinkService;
  readonly #resolveClient: (attemptId: string) => unknown;
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

  constructor(optionsInput: OwnerElevenLabsStsOriginalReferenceServiceOptions | unknown) {
    const fields = exactRecord(optionsInput, ["ffprobePath", "destination", "binding", "linkService", "resolveClient"], ["now"]);
    if (typeof fields.ffprobePath !== "string" || !isGenuineLinkService(fields.linkService) ||
        (fields.destination !== "uploaded" && fields.destination !== "hidden") || typeof fields.resolveClient !== "function" ||
        types.isProxy(fields.resolveClient) || (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
    this.#probe = createOwnerElevenLabsStsOriginalProbe({ ffprobePath: fields.ffprobePath });
    this.#destination = fields.destination;
    this.#binding = snapshotBinding(fields.binding);
    this.#linkService = fields.linkService as PerUserLinkService;
    this.#resolveClient = fields.resolveClient as (attemptId: string) => unknown;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    Object.freeze(this);
  }

  async uploadOriginal(input: OwnerElevenLabsStsOriginalUploadInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsOriginalUploadReceipt> {
    this.#assertOpen();
    const request = snapshotUpload(input, signal);
    const operation = this.#begin(request.attemptId, signal);
    let probeResult: Readonly<OwnerElevenLabsStsOriginalProbeResult> | undefined;
    let semanticKey: string | undefined;
    let nativeInvoked = false;
    let unknownOutcome = false;
    try {
      const principal = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = snapshotNativeClient(this.#resolveClient(request.attemptId));
      probeResult = await this.#probe.probe({ filename: request.filename, mime_type: request.mime_type, bytes: request.bytes },
        { signal: operation.controller.signal });
      this.#throwIfStopped(operation);
      if (!isTrustedOwnerElevenLabsStsOriginalProbeResult(probeResult)) fail("PROBE_REJECTED");
      semanticKey = semanticKeyFor(principal, probeResult);
      if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semanticKey);

      const beforeUpload = await this.#resolvePrincipal(request.attemptId, operation.controller.signal);
      this.#throwIfStopped(operation);
      const beforeUploadClient = snapshotNativeClient(this.#resolveClient(request.attemptId));
      if (!sameGenerationPrincipal(principal, beforeUpload) || beforeUploadClient.client !== client.client) fail("PRINCIPAL_NOT_LINKED");

      const issuedAt = this.#readNow();
      if (issuedAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      nativeInvoked = true;
      const nativeReference = await Reflect.apply(NATIVE_UPLOAD, client.client,
        [probeResult, this.#destination, operation.controller.signal]) as OwnerElevenLabsStsOriginalUploadReference;
      this.#throwIfStopped(operation);
      const witness = readOwnerElevenLabsStsOriginalUploadForClient(client.client, nativeReference);
      if (!witness || witness.destination !== this.#destination || witness.model_type !== MODEL_TYPE ||
          witness.source_sha256 !== probeResult.source_sha256 || witness.size !== probeResult.bytes_copied ||
          witness.mime_type !== probeResult.mime_type || witness.duration_seconds !== probeResult.metadata.duration_seconds) {
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
      const handle = `elevenlabs_sts_original_${randomUUID()}`;
      const record: RecordEntry = Object.freeze({ handle, attemptId: request.attemptId, principal,
        sourceSha256: probeResult.source_sha256, size: probeResult.bytes_copied,
        durationSeconds: probeResult.metadata.duration_seconds, expiresAt, epoch: operation.epoch,
        client: client.client, nativeReference });
      this.#records.set(handle, record);
      const handles = this.#handlesByAttempt.get(request.attemptId) ?? new Set<string>();
      handles.add(handle); this.#handlesByAttempt.set(request.attemptId, handles);
      return Object.freeze({ status: "uploaded", audio_original_handle: handle, sha256: record.sourceSha256,
        size: record.size, mime_type: "audio/mpeg", duration_seconds: record.durationSeconds,
        expires_in_seconds: Math.floor((expiresAt - acknowledgedAt) / 1_000) });
    } catch (error) {
      if (error instanceof OwnerElevenLabsStsOriginalReferenceServiceError) {
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
      return fail("PROBE_REJECTED");
    } finally {
      if (semanticKey !== undefined) {
        if (unknownOutcome) this.#unknownSemantics.add(semanticKey);
        this.#pendingSemantics.delete(semanticKey);
      }
      if (probeResult && isTrustedOwnerElevenLabsStsOriginalProbeResult(probeResult)) {
        try { releaseTrustedOwnerElevenLabsStsOriginalProbeResult(probeResult); } catch { /* wipe after operation drains */ }
      }
      this.#finish(request.attemptId, operation);
    }
  }

  async resolveOriginal(input: OwnerElevenLabsStsOriginalResolveInput | unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsOriginalResolution> {
    this.#assertOpen();
    const request = snapshotResolve(input);
    const operation = this.#begin(request.attempt_id, signal);
    try {
      const principal = await this.#resolvePrincipal(request.attempt_id, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!this.#rememberPrincipal(request.attempt_id, principal)) fail("PRINCIPAL_NOT_LINKED");
      const record = this.#records.get(request.audio_original_handle);
      if (!record || record.attemptId !== request.attempt_id) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= this.#readNow()) { this.#removeRecord(record.handle); fail("REFERENCE_EXPIRED"); }
      if (record.epoch !== (this.#epochs.get(request.attempt_id) ?? 0) || !sameGenerationPrincipal(record.principal, principal) ||
          !readOwnerElevenLabsStsOriginalUploadForClient(record.client, record.nativeReference)) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#resolvePrincipal(request.attempt_id, operation.controller.signal);
      this.#throwIfStopped(operation);
      if (!sameGenerationPrincipal(latest, record.principal)) fail("PRINCIPAL_NOT_LINKED");
      if (record.expiresAt <= this.#readNow() || this.#records.get(record.handle) !== record ||
          record.epoch !== (this.#epochs.get(request.attempt_id) ?? 0) || this.#invalidating.has(request.attempt_id)) fail("REFERENCE_EXPIRED");
      const resolution: OwnerElevenLabsStsOriginalResolution = Object.freeze({ role: "elevenlabs_sts_original", wire_type: "audio",
        principal: record.principal, attempt_id: record.attemptId, model_type: MODEL_TYPE, audio_original_handle: record.handle,
        sha256: record.sourceSha256, mime_type: "audio/mpeg", size: record.size, duration_seconds: record.durationSeconds,
        destination: this.#destination, expires_at: record.expiresAt, epoch: record.epoch, generation_permit: false });
      RESOLUTIONS.set(resolution, { service: this, record });
      return resolution;
    } catch (error) {
      if (error instanceof OwnerElevenLabsStsOriginalReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(request.attempt_id, operation); }
  }

  isOwnedOriginalResolution(value: unknown, input: OwnerElevenLabsStsOriginalResolveInput | unknown): boolean {
    try {
      this.#assertOpen();
      const request = snapshotResolve(input);
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value), record = this.#records.get(request.audio_original_handle);
      if (!owned || owned.service !== this || !record || owned.record !== record || record.attemptId !== request.attempt_id ||
          record.expiresAt <= this.#readNow() || record.epoch !== (this.#epochs.get(request.attempt_id) ?? 0) ||
          this.#invalidating.has(request.attempt_id) || !readOwnerElevenLabsStsOriginalUploadForClient(record.client, record.nativeReference)) return false;
      return exactResolutionMatches(value, record, this.#destination);
    } catch { return false; }
  }

  withCapturedNativeOriginal<T>(value: unknown, input: OwnerElevenLabsStsOriginalResolveInput | unknown,
    consume: (client: SyntxChatHttpClient, reference: OwnerElevenLabsStsOriginalUploadReference) => T): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const request = snapshotResolve(input);
    const owned = value !== null && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value as object) : undefined;
    if (!owned || owned.service !== this || owned.record.attemptId !== request.attempt_id || owned.record.handle !== request.audio_original_handle ||
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
    if (signal?.aborted) return Promise.reject(new OwnerElevenLabsStsOriginalReferenceServiceError("REQUEST_ABORTED"));
    const resolution = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService });
    if (!signal) return resolution;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerElevenLabsStsOriginalReferenceServiceError("REQUEST_ABORTED"));
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
    const operation = { controller, done, finish, removeParentAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attemptId) ?? 0 };
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

function snapshotUpload(input: unknown, signal?: AbortSignal): Readonly<OwnerElevenLabsStsOriginalUploadInput> {
  const f = exactRecord(input, ["attemptId", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.filename !== "string" ||
      f.mime_type !== "audio/mpeg" || !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes) ||
      (signal !== undefined && (!signal || typeof signal !== "object" || types.isProxy(signal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, filename: f.filename, mime_type: "audio/mpeg", bytes: f.bytes });
}
function snapshotResolve(input: unknown): Readonly<{ attempt_id: string; audio_original_handle: string }> {
  const f = exactRecord(input, ["attempt_id", "audio_original_handle"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.audio_original_handle !== "string" || !HANDLE.test(f.audio_original_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attempt_id: f.attempt_id, audio_original_handle: f.audio_original_handle });
}
function snapshotNativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  if (!isExactOwnerElevenLabsStsUploadClient(value) || SyntxChatHttpClient.prototype.uploadElevenLabsStsOriginal !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
  const descriptor = Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, "uploadElevenLabsStsOriginal");
  if (!descriptor || !("value" in descriptor) || descriptor.value !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
  return Object.freeze({ client: value });
}
function exactResolutionMatches(value: object, record: RecordEntry, destination: "uploaded" | "hidden"): boolean {
  const f = exactRecord(value, ["role", "wire_type", "principal", "attempt_id", "model_type", "audio_original_handle", "sha256",
    "mime_type", "size", "duration_seconds", "destination", "expires_at", "epoch", "generation_permit"]);
  return f.role === "elevenlabs_sts_original" && f.wire_type === "audio" && f.attempt_id === record.attemptId && f.model_type === MODEL_TYPE &&
    f.audio_original_handle === record.handle && f.sha256 === record.sourceSha256 && f.mime_type === "audio/mpeg" && f.size === record.size &&
    f.duration_seconds === record.durationSeconds && f.destination === destination && f.expires_at === record.expiresAt && f.epoch === record.epoch &&
    f.generation_permit === false && samePrincipal(f.principal, record.principal);
}
function samePrincipal(value: unknown, expected: Readonly<GenerationPrincipalRef>): boolean {
  try { return sameGenerationPrincipal(snapshotGenerationPrincipal(value as GenerationPrincipalRef), expected); } catch { return false; }
}
function semanticKeyFor(principal: Readonly<GenerationPrincipalRef>, probe: OwnerElevenLabsStsOriginalProbeResult): string {
  return schemaHash({ owner: { tenant_id: principal.tenant_id, subject_id: principal.subject_id }, model_type: MODEL_TYPE,
    source_profile: SOURCE_PROFILE, sha256: probe.source_sha256, mime_type: probe.mime_type, size: probe.bytes_copied });
}
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
function fail(code: OwnerElevenLabsStsOriginalReferenceServiceErrorCode): never { throw new OwnerElevenLabsStsOriginalReferenceServiceError(code); }
