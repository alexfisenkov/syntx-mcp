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
  isValidatedOwnerSeedanceEditorVideo, readValidatedOwnerSeedanceEditorVideo, releaseValidatedOwnerSeedanceEditorVideo,
  validateOwnerSeedanceEditorVideo, type OwnerSeedanceEditorVideoMimeType, type ValidatedOwnerSeedanceEditorVideo
} from "./owner-seedance-editor-video-policy.js";
import { getOwnerSeedanceEditorSourceProfile } from "./owner-seedance-editor-parameters.js";

const MODEL_ID = "seedance-2.5-editor" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^seedance_editor_reference_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerSeedanceEditorVideo") as unknown;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const TA = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TA_LENGTH = Object.getOwnPropertyDescriptor(TA, "byteLength")?.get;
const TA_BUFFER = Object.getOwnPropertyDescriptor(TA, "buffer")?.get;
const TA_OFFSET = Object.getOwnPropertyDescriptor(TA, "byteOffset")?.get;
const ARRAY_BUFFER_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const PROFILE_SHA256 = getOwnerSeedanceEditorSourceProfile().source_sha256;

export interface OwnerSeedanceEditorReferenceServiceOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown; readonly ffprobePath: string;
  readonly maxVideoFileBytes?: number; readonly now?: () => number;
}
export interface OwnerSeedanceEditorReferenceUploadInput {
  readonly attemptId: string; readonly model_id: typeof MODEL_ID; readonly filename: string;
  readonly mime_type: OwnerSeedanceEditorVideoMimeType; readonly bytes: Uint8Array;
}
export interface OwnerSeedanceEditorReferenceUploadReceipt {
  readonly status: "uploaded"; readonly reference_handle: string; readonly model_id: typeof MODEL_ID;
  readonly kind: "video"; readonly mime_type: OwnerSeedanceEditorVideoMimeType; readonly size: number;
  readonly sha256: string; readonly width: number; readonly height: number; readonly duration_seconds: number;
  readonly expires_in_seconds: number; readonly input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE";
}
export interface OwnerSeedanceEditorOwnedReferences {
  readonly attempt_id: string; readonly model_id: typeof MODEL_ID; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string; readonly expires_at: number; readonly epoch: number;
  readonly references: readonly Readonly<{ reference_handle: string; kind: "video"; mime_type: string; size: number;
    sha256: string; width: number; height: number; duration_seconds: number }>[];
  readonly generation_permit: false;
}
export type OwnerSeedanceEditorReferenceServiceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" |
  "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "VALIDATION_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" |
  "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerSeedanceEditorReferenceServiceError extends Error {
  constructor(readonly code: OwnerSeedanceEditorReferenceServiceErrorCode) {
    super("The owner Seedance Editor video reference is unavailable."); this.name = "OwnerSeedanceEditorReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly epoch: number; readonly expiresAt: number;
  readonly url: string; readonly fileId?: string; readonly mimeType: OwnerSeedanceEditorVideoMimeType;
  readonly size: number; readonly sha256: string; readonly width: number; readonly height: number; readonly duration: number;
}
interface Pending { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void;
  readonly removeAbort: () => void; readonly epoch: number }
interface OwnedState { readonly service: OwnerSeedanceEditorReferenceService; readonly record: RecordEntry;
  readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly epoch: number; readonly expiresAt: number }
interface UploadSnapshot { readonly attemptId: string; readonly filename: string; readonly mimeType: OwnerSeedanceEditorVideoMimeType; readonly bytes: Buffer }
interface ResolveSnapshot { readonly attemptId: string; readonly handle: string }
const OWNED = new WeakMap<object, OwnedState>();
const SERVICES = new WeakSet<object>();

/** Process-local Seedance Editor video URL vault. Handles grant access to an uploaded source, never generation authority. */
export class OwnerSeedanceEditorReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (id: string) => unknown; readonly #ffprobePath: string; readonly #maxVideoBytes: number; readonly #now: () => number;
  readonly #records = new Map<string, RecordEntry>(); readonly #handles = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>(); readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<Pending>>(); readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>(); readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>(); readonly #all = new Set<Promise<void>>();
  #pendingCount = 0; #lastNow: number | undefined; #closed = false; #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerSeedanceEditorReferenceServiceOptions | unknown) {
    const f = exactRecord(optionsInput, ["binding", "linkService", "resolveClient", "ffprobePath"], ["maxVideoFileBytes", "now"]);
    if (!genuineLinks(f.linkService) || typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) ||
        typeof f.ffprobePath !== "string" || !f.ffprobePath ||
        (f.maxVideoFileBytes !== undefined && (!Number.isSafeInteger(f.maxVideoFileBytes) || (f.maxVideoFileBytes as number) < 1 || (f.maxVideoFileBytes as number) > 100 * 1024 * 1024)) ||
        (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now))) || typeof NATIVE_UPLOAD !== "function") fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(f.binding); this.#links = f.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = f.resolveClient as (id: string) => unknown; this.#ffprobePath = f.ffprobePath;
    this.#maxVideoBytes = (f.maxVideoFileBytes as number | undefined) ?? 64 * 1024 * 1024;
    this.#now = f.now === undefined ? Date.now : readClock(f.now);
    SERVICES.add(this); Object.freeze(this);
  }

  async uploadReference(input: OwnerSeedanceEditorReferenceUploadInput | unknown, signalInput?: AbortSignal): Promise<OwnerSeedanceEditorReferenceUploadReceipt> {
    this.#assertOpen(); const q = snapshotUpload(input, this.#maxVideoBytes); let op: Pending;
    try { op = this.#begin(q.attemptId, exactSignal(signalInput)); } catch (error) { q.bytes.fill(0); throw error; }
    let validated: Readonly<ValidatedOwnerSeedanceEditorVideo> | undefined;
    let semantic: string | undefined; let reserved = false; let nativeInvoked = false; let published = false;
    try {
      const principal = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      if (!this.#rememberPrincipal(q.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const initialClient = clientSnapshot(this.#resolveClient(q.attemptId));
      try { validated = await validateOwnerSeedanceEditorVideo({ filename: q.filename, mime_type: q.mimeType, bytes: q.bytes,
        ffprobePath: this.#ffprobePath, maxFileBytes: this.#maxVideoBytes }, op.controller.signal); }
      catch { this.#stopped(op); fail("VALIDATION_REJECTED"); }
      this.#stopped(op); const media = readValidatedOwnerSeedanceEditorVideo(validated);
      if (!media) fail("VALIDATION_REJECTED");
      let meta: Readonly<{ mime_type: OwnerSeedanceEditorVideoMimeType; size: number; sha256: string; width: number; height: number; duration_seconds: number }>;
      try {
        meta = Object.freeze({ mime_type: media.mime_type, size: media.size, sha256: media.sha256, width: media.width,
          height: media.height, duration_seconds: media.duration_seconds });
      } finally { media.bytes.fill(0); }
      semantic = semanticKey(principal, meta.sha256, meta.mime_type, meta.size);
      if (this.#unknownSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semantic)) fail("SERVICE_BUSY");
      this.#prune(this.#time()); if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic); reserved = true;
      const before = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      const client = clientSnapshot(this.#resolveClient(q.attemptId));
      if (!sameGenerationPrincipal(principal, before) || client.client !== initialClient.client) fail("PRINCIPAL_NOT_LINKED");
      if (!isValidatedOwnerSeedanceEditorVideo(validated) || PROFILE_SHA256 !== getOwnerSeedanceEditorSourceProfile().source_sha256) fail("VALIDATION_REJECTED");
      const issued = this.#time(); if (issued > Number.MAX_SAFE_INTEGER - TTL) fail("SERVICE_CLOSED");
      nativeInvoked = true; let native: InternalUploadReference;
      try { native = await Reflect.apply(NATIVE_UPLOAD as Function, client.client, [validated, op.controller.signal]) as InternalUploadReference; }
      catch { this.#unknownIfStopped(op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#unknownIfStopped(op); const nativeRef = readNativeReference(native); if (!nativeRef) fail("UPLOAD_OUTCOME_UNKNOWN");
      let after: Readonly<GenerationPrincipalRef>;
      try { after = await this.#principal(q.attemptId, op.controller.signal); } catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#unknownIfStopped(op); const afterClient = clientSnapshot(this.#resolveClient(q.attemptId));
      if (!sameGenerationPrincipal(principal, after) || afterClient.client !== client.client) fail("UPLOAD_OUTCOME_UNKNOWN");
      const ack = this.#time(), expiresAt = issued + TTL, epoch = op.epoch;
      if (expiresAt - ack < 1000 || epoch !== (this.#epochs.get(q.attemptId) ?? 0) || this.#invalidating.has(q.attemptId) ||
          this.#records.size + this.#unknownSemantics.size >= MAX_RECORDS || !this.#pendingSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const conflicts = [...this.#records.values()].filter(r => r.principal.tenant_id === principal.tenant_id &&
        r.principal.subject_id === principal.subject_id && r.url === nativeRef.url);
      if (conflicts.some(r => r.sha256 !== meta.sha256 || r.mimeType !== meta.mime_type || r.size !== meta.size ||
          r.width !== meta.width || r.height !== meta.height || r.duration !== meta.duration_seconds)) {
        for (const r of conflicts) { this.#unknownSemantics.add(semanticKey(r.principal, r.sha256, r.mimeType, r.size)); this.#remove(r.handle); }
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const handle = "seedance_editor_reference_" + randomUUID();
      const record: RecordEntry = Object.freeze({ handle, attemptId: q.attemptId, principal, client: client.client, epoch, expiresAt,
        url: nativeRef.url, ...(nativeRef.file_id === undefined ? {} : { fileId: nativeRef.file_id }), mimeType: meta.mime_type,
        size: meta.size, sha256: meta.sha256, width: meta.width, height: meta.height, duration: meta.duration_seconds });
      this.#records.set(handle, record); const set = this.#handles.get(q.attemptId) ?? new Set<string>(); set.add(handle); this.#handles.set(q.attemptId, set); published = true;
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: MODEL_ID, kind: "video", mime_type: record.mimeType,
        size: record.size, sha256: record.sha256, width: record.width, height: record.height, duration_seconds: record.duration,
        expires_in_seconds: Math.floor((expiresAt - ack) / 1000), input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE" });
    } catch (error) {
      if (error instanceof OwnerSeedanceEditorReferenceServiceError) { if (nativeInvoked && !published && error.code !== "UPLOAD_OUTCOME_UNKNOWN") fail("UPLOAD_OUTCOME_UNKNOWN"); throw error; }
      if (error instanceof OwnerReferencePrincipalError) { if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN"); fail("PRINCIPAL_NOT_LINKED"); }
      if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN"); if (op.controller.signal.aborted) fail("REQUEST_ABORTED"); return fail("VALIDATION_REJECTED");
    } finally {
      if (semantic && reserved) { if (nativeInvoked && !published) this.#unknownSemantics.add(semantic); this.#pendingSemantics.delete(semantic); }
      if (validated) releaseValidatedOwnerSeedanceEditorVideo(validated); q.bytes.fill(0); this.#finish(q.attemptId, op);
    }
  }

  async resolveReferences(input: unknown, signalInput?: AbortSignal): Promise<OwnerSeedanceEditorOwnedReferences> {
    this.#assertOpen(); const q = snapshotResolve(input); const op = this.#begin(q.attemptId, exactSignal(signalInput));
    try {
      const principal = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      if (!this.#rememberPrincipal(q.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = clientSnapshot(this.#resolveClient(q.attemptId)).client; const record = this.#records.get(q.handle); const now = this.#time();
      if (!record || record.handle !== q.handle || record.attemptId !== q.attemptId || !sameGenerationPrincipal(record.principal, principal)) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#remove(q.handle); fail("REFERENCE_EXPIRED"); }
      if (record.epoch !== op.epoch || record.client !== client || !isSafeUploadReferenceUrl(record.url)) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      if (!sameGenerationPrincipal(latest, principal) || clientSnapshot(this.#resolveClient(q.attemptId)).client !== client) fail("PRINCIPAL_NOT_LINKED");
      const ack = this.#time(); if (record.expiresAt <= ack || this.#records.get(record.handle) !== record || record.epoch !== (this.#epochs.get(q.attemptId) ?? 0) ||
          this.#invalidating.has(q.attemptId) || record.client !== client) fail("REFERENCE_EXPIRED");
      const references = Object.freeze([Object.freeze({ reference_handle: record.handle, kind: "video" as const, mime_type: record.mimeType,
        size: record.size, sha256: record.sha256, width: record.width, height: record.height, duration_seconds: record.duration })]);
      const owned: OwnerSeedanceEditorOwnedReferences = Object.freeze({ attempt_id: q.attemptId, model_id: MODEL_ID, principal,
        profile_sha256: PROFILE_SHA256, expires_at: record.expiresAt, epoch: op.epoch, references, generation_permit: false });
      OWNED.set(owned, Object.freeze({ service: this, record, attemptId: q.attemptId, principal, client, epoch: op.epoch, expiresAt: record.expiresAt }));
      return owned;
    } catch (error) {
      if (error instanceof OwnerSeedanceEditorReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (op.controller.signal.aborted) fail("REQUEST_ABORTED"); fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(q.attemptId, op); }
  }

  isOwnedReferences(value: unknown): value is OwnerSeedanceEditorOwnedReferences {
    try {
      this.#assertOpen(); if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const state = OWNED.get(value); const remembered = state ? this.#principalByAttempt.get(state.attemptId) : undefined;
      if (!state || state.service !== this || this.#time() >= state.expiresAt || state.epoch !== (this.#epochs.get(state.attemptId) ?? 0) ||
          this.#invalidating.has(state.attemptId) || !remembered || !sameGenerationPrincipal(remembered, state.principal) || !exactOwned(value, state)) return false;
      const r = state.record;
      return this.#records.get(r.handle) === r && r.expiresAt > this.#lastNow! && r.epoch === state.epoch &&
        sameGenerationPrincipal(r.principal, state.principal) && clientSnapshot(this.#resolveClient(r.attemptId)).client === state.client &&
        isSafeUploadReferenceUrl(r.url);
    } catch { return false; }
  }

  withCapturedReferences<T>(value: unknown, consume: (client: SyntxChatHttpClient, rows: readonly Readonly<{
    reference_handle: string; kind: "video"; url: string; sha256: string; duration_seconds: number
  }>[]) => T): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const state = value && typeof value === "object" && !types.isProxy(value) ? OWNED.get(value) : undefined;
    if (!state || state.service !== this || !this.isOwnedReferences(value)) fail("REFERENCE_UNAVAILABLE");
    const r = state.record; if (r.client !== state.client || clientSnapshot(this.#resolveClient(r.attemptId)).client !== state.client) fail("REFERENCE_UNAVAILABLE");
    return consume(state.client, Object.freeze([Object.freeze({ reference_handle: r.handle, kind: "video" as const, url: r.url,
      sha256: r.sha256, duration_seconds: r.duration })]));
  }

  invalidateAttempt(value: unknown): Promise<void> { return typeof value === "string" && ATTEMPT.test(value) ? this.#invalidate(value) : Promise.resolve(); }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    const invalid = [...this.#active()].map(id => this.#invalidate(id)); const pending = [...this.#all];
    this.#closing = Promise.allSettled([...invalid, ...pending]).then(() => {
      this.#records.clear(); this.#handles.clear(); this.#principalByAttempt.clear(); this.#epochs.clear(); this.#pendingSemantics.clear();
      this.#unknownSemantics.clear(); this.#invalidating.clear(); this.#invalidations.clear(); this.#all.clear();
    }); return this.#closing;
  }

  #principal(id: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerSeedanceEditorReferenceServiceError("REQUEST_ABORTED"));
    const promise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: id, linkService: this.#links }); if (!signal) return promise;
    let remove = () => {}; const aborted = new Promise<never>((_resolve, reject) => { const onAbort = () => reject(new OwnerSeedanceEditorReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); } });
    return Promise.race([promise, aborted]).finally(remove);
  }
  #rememberPrincipal(id: string, p: Readonly<GenerationPrincipalRef>): boolean { const prior = this.#principalByAttempt.get(id); if (prior && !sameGenerationPrincipal(prior, p)) return false; this.#principalByAttempt.set(id, p); return true; }
  #begin(id: string, parent?: AbortSignal): Pending {
    this.#assertOpen(); if (this.#invalidating.has(id)) fail("REQUEST_ABORTED"); this.#prune(this.#time());
    if (!this.#active().has(id) && this.#active().size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED"); if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const set = this.#pendingByAttempt.get(id) ?? new Set<Pending>(); const op = { controller, done, finish,
      removeAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(id) ?? 0 };
    set.add(op); this.#pendingByAttempt.set(id, set); this.#all.add(done); this.#pendingCount++; return op;
  }
  #finish(id: string, op: Pending): void { op.removeAbort(); const set = this.#pendingByAttempt.get(id); set?.delete(op); if (!set?.size) this.#pendingByAttempt.delete(id);
    this.#pendingCount--; op.finish(); this.#all.delete(op.done); this.#release(id); }
  #stopped(op: Pending): void { this.#assertOpen(); if (op.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #unknownIfStopped(op: Pending): void { if (this.#closed || op.controller.signal.aborted) fail("UPLOAD_OUTCOME_UNKNOWN"); }
  #active(): Set<string> { return new Set([...this.#handles.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]); }
  #invalidate(id: string): Promise<void> {
    const prior = this.#invalidations.get(id); if (prior) return prior; this.#invalidating.add(id); this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1);
    this.#removeAttempt(id); this.#principalByAttempt.delete(id); for (const op of this.#pendingByAttempt.get(id) ?? []) op.controller.abort();
    const waits = [...(this.#pendingByAttempt.get(id) ?? [])].map(op => op.done);
    const done = Promise.allSettled(waits).then(() => { this.#invalidating.delete(id); this.#invalidations.delete(id); this.#release(id); });
    this.#invalidations.set(id, done); return done;
  }
  #removeAttempt(id: string): void { for (const handle of this.#handles.get(id) ?? []) this.#records.delete(handle); this.#handles.delete(id); }
  #remove(handle: string): void { const r = this.#records.get(handle); if (!r) return; this.#records.delete(handle); const set = this.#handles.get(r.attemptId);
    set?.delete(handle); if (!set?.size) this.#handles.delete(r.attemptId); this.#release(r.attemptId); }
  #prune(now: number): void { for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#remove(handle); }
  #release(id: string): void { if (this.#handles.has(id) || this.#pendingByAttempt.has(id) || this.#invalidating.has(id)) return;
    this.#epochs.delete(id); this.#principalByAttempt.delete(id); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #time(): number { let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number; }
}
Object.freeze(OwnerSeedanceEditorReferenceService.prototype);
export function isOwnerSeedanceEditorReferenceService(value: unknown): value is OwnerSeedanceEditorReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerSeedanceEditorReferenceService.prototype && Object.isFrozen(value);
}

function snapshotUpload(value: unknown, maxBytes: number): UploadSnapshot {
  const f = exactRecord(value, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || f.model_id !== MODEL_ID || typeof f.filename !== "string" ||
      (f.mime_type !== "video/mp4" && f.mime_type !== "video/quicktime") || !supportedBytes(f.bytes)) fail("INVALID_REQUEST");
  const size = byteLength(f.bytes); if (size < 1 || size > maxBytes) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, filename: f.filename, mimeType: f.mime_type, bytes: copyBytes(f.bytes) });
}
function snapshotResolve(value: unknown): ResolveSnapshot {
  const f = exactRecord(value, ["attemptId", "model_id", "reference_handles"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || f.model_id !== MODEL_ID || !Array.isArray(f.reference_handles) ||
      types.isProxy(f.reference_handles) || Object.getPrototypeOf(f.reference_handles) !== Array.prototype) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(f.reference_handles) as unknown as PropertyDescriptorMap; } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), length = descriptors.length, first = descriptors["0"];
  if (keys.length !== 2 || !Object.hasOwn(descriptors, "length") || !Object.hasOwn(descriptors, "0") ||
      !length || !Object.hasOwn(length, "value") || length.value !== 1 || length.enumerable !== false ||
      !first || !first.enumerable || !Object.hasOwn(first, "value") || typeof first.value !== "string" || !exactMatch(HANDLE, first.value)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, handle: first.value });
}
function exactOwned(value: object, state: OwnedState): boolean {
  try {
    const f = exactRecord(value, ["attempt_id", "model_id", "principal", "profile_sha256", "expires_at", "epoch", "references", "generation_permit"]);
    const r = state.record;
    if (f.attempt_id !== state.attemptId || f.model_id !== MODEL_ID || f.principal !== state.principal || f.profile_sha256 !== PROFILE_SHA256 ||
        f.expires_at !== state.expiresAt || f.epoch !== state.epoch || f.generation_permit !== false || !Array.isArray(f.references) ||
        !Object.isFrozen(f.references) || f.references.length !== 1 || !Object.isFrozen(f.references[0])) return false;
    const row = exactRecord(f.references[0], ["reference_handle", "kind", "mime_type", "size", "sha256", "width", "height", "duration_seconds"]);
    return row.reference_handle === r.handle && row.kind === "video" && row.mime_type === r.mimeType && row.size === r.size &&
      row.sha256 === r.sha256 && row.width === r.width && row.height === r.height && row.duration_seconds === r.duration;
  } catch { return false; }
}
function clientSnapshot(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    const method = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerSeedanceEditorVideo");
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadOwnerSeedanceEditorVideo") || method !== NATIVE_UPLOAD || Reflect.get(value, "uploadOwnerSeedanceEditorVideo") !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch (error) { if (error instanceof OwnerSeedanceEditorReferenceServiceError) throw error; fail("INVALID_REQUEST"); }
}
function readNativeReference(value: unknown): Readonly<InternalUploadReference> | null {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return null;
    const f = exactRecord(value, ["url"], ["file_id"]);
    if (typeof f.url !== "string" || !isSafeUploadReferenceUrl(f.url) || (f.file_id !== undefined && (typeof f.file_id !== "string" || !MAX_FILE_ID.test(f.file_id)))) return null;
    return Object.freeze({ url: f.url, ...(f.file_id === undefined ? {} : { file_id: f.file_id as string }) });
  } catch { return null; }
}
function semanticKey(principal: Readonly<GenerationPrincipalRef>, sha256: string, mime: string, size: number): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, model_id: MODEL_ID, profile_sha256: PROFILE_SHA256, sha256, mime_type: mime, size });
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  let prototype: object | null; let descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some(key => !Object.hasOwn(descriptors, key)) ||
      keys.some(key => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) out[key] = descriptors[key]!.value; return out;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> {
  const f = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id || f.tenant_id.length > 256 || typeof f.subject !== "string" || !f.subject || f.subject.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(f.tenant_id) || /[\u0000-\u001f\u007f]/u.test(f.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject });
}
function genuineLinks(value: unknown): value is PerUserLinkService {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
      PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
  return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_STATUS;
}
function exactSignal(value: AbortSignal | undefined): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof AbortSignal) || Object.getPrototypeOf(value) !== AbortSignal.prototype) fail("INVALID_REQUEST");
  return value;
}
function supportedBytes(value: unknown): value is Uint8Array {
  if (!value || typeof value !== "object" || types.isProxy(value) || !(value instanceof Uint8Array) ||
      (Object.getPrototypeOf(value) !== Uint8Array.prototype && Object.getPrototypeOf(value) !== Buffer.prototype) ||
      ["buffer", "byteLength", "byteOffset", "length"].some(key => Object.hasOwn(value, key))) return false;
  try {
    if (!TA_LENGTH || !TA_BUFFER || !TA_OFFSET || !ARRAY_BUFFER_LENGTH) return false;
    const buffer = Reflect.apply(TA_BUFFER, value, []) as unknown;
    return !!buffer && typeof buffer === "object" && !types.isProxy(buffer) && Object.getPrototypeOf(buffer) === ArrayBuffer.prototype &&
      !Object.hasOwn(buffer, "byteLength") && Reflect.apply(ARRAY_BUFFER_LENGTH, buffer, []) >= Reflect.apply(TA_LENGTH, value, []);
  } catch { return false; }
}
function byteLength(value: Uint8Array): number { try { return Reflect.apply(TA_LENGTH!, value, []) as number; } catch { fail("INVALID_REQUEST"); } }
function copyBytes(value: Uint8Array): Buffer { try { return Buffer.from(new Uint8Array(Reflect.apply(TA_BUFFER!, value, []) as ArrayBuffer,
  Reflect.apply(TA_OFFSET!, value, []) as number, byteLength(value))); } catch { fail("INVALID_REQUEST"); } }
function readClock(value: unknown): () => number { return () => { let result: unknown; try { result = Reflect.apply(value as Function, undefined, []); } catch { fail("SERVICE_CLOSED"); }
  if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED"); return result as number; }; }
function exactMatch(regex: RegExp, value: string): boolean { return regex.exec(value)?.[0] === value; }
function fail(code: OwnerSeedanceEditorReferenceServiceErrorCode): never { throw new OwnerSeedanceEditorReferenceServiceError(code); }
