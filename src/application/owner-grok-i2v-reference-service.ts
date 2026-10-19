import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { OwnerGrokI2vImageUploadContext, OwnerGrokI2vUploadDestination } from "../adapter/syntx/owner-grok-i2v-upload-context.js";
import { readOwnerGrokI2vUploadReferenceForClient } from "../adapter/syntx/owner-grok-i2v-upload-context.js";
import {
  OWNER_GROK_I2V_IMAGE_POLICY,
  OwnerGrokI2vImagePolicyError,
  validateOwnerGrokI2vImageUpload,
  readValidatedOwnerGrokI2vImageUpload,
  releaseValidatedOwnerGrokI2vImageUpload,
  type OwnerGrokI2vImageMimeType,
  type OwnerGrokI2vImageModelId,
  type ValidatedOwnerGrokI2vImageUpload
} from "./owner-grok-i2v-image-policy.js";
import { getOwnerGrokI2vSourceProfile, isOwnerGrokI2vModelId } from "./owner-grok-i2v-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^grok_i2v_reference_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerGrokI2vImage") as unknown;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const PROFILE_SHA256 = getOwnerGrokI2vSourceProfile().source_sha256;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;

export interface OwnerGrokI2vReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly uploadDestination: OwnerGrokI2vUploadDestination;
  readonly now?: () => number;
}
export interface OwnerGrokI2vReferenceUploadInput {
  readonly attemptId: string;
  readonly model_id: OwnerGrokI2vImageModelId;
  readonly filename: string;
  readonly mime_type: OwnerGrokI2vImageMimeType;
  readonly bytes: Uint8Array;
}
export interface OwnerGrokI2vReferenceUploadReceipt {
  readonly status: "uploaded";
  readonly reference_handle: string;
  readonly model_id: OwnerGrokI2vImageModelId;
  readonly media_type: "image";
  readonly mime_type: OwnerGrokI2vImageMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN";
  readonly upload_authority: false;
  readonly generation_permit: false;
}
export interface OwnerGrokI2vOwnedReferences {
  readonly attempt_id: string;
  readonly model_id: OwnerGrokI2vImageModelId;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly references: readonly Readonly<{ reference_handle: string; media_type: "image";
    mime_type: OwnerGrokI2vImageMimeType; size: number; sha256: string; width: number; height: number }> [];
  readonly generation_permit: false;
}
export type OwnerGrokI2vReferenceServiceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" |
  "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "VALIDATION_REJECTED" |
  "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerGrokI2vReferenceServiceError extends Error {
  constructor(readonly code: OwnerGrokI2vReferenceServiceErrorCode) {
    super("The owner Grok I2V image reference is unavailable."); this.name = "OwnerGrokI2vReferenceServiceError";
  }
}

interface RecordEntry {
  readonly handle: string; readonly attemptId: string; readonly uploadModelId: OwnerGrokI2vImageModelId;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient; readonly epoch: number;
  readonly expiresAt: number; readonly context: OwnerGrokI2vImageUploadContext; readonly destination: OwnerGrokI2vUploadDestination;
  readonly mimeType: OwnerGrokI2vImageMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number;
}
interface Pending { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void;
  readonly removeAbort: () => void; readonly epoch: number }
interface OwnedState { readonly service: OwnerGrokI2vReferenceService; readonly record: RecordEntry; readonly attemptId: string;
  readonly modelId: OwnerGrokI2vImageModelId; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly epoch: number; readonly expiresAt: number }
interface UploadSnapshot { readonly attemptId: string; readonly modelId: OwnerGrokI2vImageModelId;
  readonly filename: string; readonly mimeType: OwnerGrokI2vImageMimeType; readonly bytes: Buffer }
interface ResolveSnapshot { readonly attemptId: string; readonly modelId: OwnerGrokI2vImageModelId; readonly handle: string }
const OWNED = new WeakMap<object, OwnedState>();
const SERVICES = new WeakSet<object>();

/** Process-local reference vault. Public receipts contain no provider URL or generation authority. */
export class OwnerGrokI2vReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (id: string) => unknown;
  readonly #uploadDestination: OwnerGrokI2vUploadDestination;
  readonly #now: () => number;
  readonly #records = new Map<string, RecordEntry>();
  readonly #handles = new Map<string, Set<string>>();
  readonly #principalByAttempt = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<Pending>>();
  readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  readonly #all = new Set<Promise<void>>();
  #pendingCount = 0; #lastNow: number | undefined; #closed = false; #closing: Promise<void> | undefined;

  constructor(optionsInput: OwnerGrokI2vReferenceServiceOptions | unknown) {
    const f = exactRecord(optionsInput, ["binding", "linkService", "resolveClient", "uploadDestination"], ["now"]);
    if (!genuineLinks(f.linkService) || typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) ||
        (f.uploadDestination !== "uploaded" && f.uploadDestination !== "hidden") ||
        (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now))) || typeof NATIVE_UPLOAD !== "function" ||
        typeof readOwnerGrokI2vUploadReferenceForClient !== "function") fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(f.binding); this.#links = f.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = f.resolveClient as (id: string) => unknown;
    this.#uploadDestination = f.uploadDestination as OwnerGrokI2vUploadDestination;
    this.#now = f.now === undefined ? Date.now : readClock(f.now); SERVICES.add(this); Object.freeze(this);
  }

  async uploadReference(input: OwnerGrokI2vReferenceUploadInput | unknown, signalInput?: AbortSignal): Promise<OwnerGrokI2vReferenceUploadReceipt> {
    this.#assertOpen(); const q = snapshotUpload(input);
    let op: Pending; try { op = this.#begin(q.attemptId, exactSignal(signalInput)); } catch (error) { q.bytes.fill(0); throw error; }
    let validated: Readonly<ValidatedOwnerGrokI2vImageUpload> | undefined;
    let semantic: string | undefined, reserved = false, nativeInvoked = false, published = false;
    try {
      const principal = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      if (!this.#rememberPrincipal(q.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const initialClient = clientSnapshot(this.#resolveClient(q.attemptId));
      try { validated = validateOwnerGrokI2vImageUpload({ model_id: q.modelId, filename: q.filename, mime_type: q.mimeType, bytes: q.bytes }); }
      catch (error) { this.#stopped(op); if (error instanceof OwnerGrokI2vImagePolicyError) fail("VALIDATION_REJECTED"); fail("VALIDATION_REJECTED"); }
      this.#stopped(op);
      const media = readValidatedOwnerGrokI2vImageUpload(validated); if (!media) fail("VALIDATION_REJECTED");
      const meta = Object.freeze({ model_id: media.model_id, mime_type: media.mime_type, size: media.size, sha256: media.sha256,
        width: media.width, height: media.height });
      media.bytes.fill(0);
      semantic = semanticKey(principal, meta.sha256, meta.mime_type, meta.size, meta.width, meta.height);
      if (this.#unknownSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semantic)) fail("SERVICE_BUSY");
      this.#prune(this.#time());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic); reserved = true;
      const before = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      const client = clientSnapshot(this.#resolveClient(q.attemptId));
      if (!sameGenerationPrincipal(principal, before) || client.client !== initialClient.client) fail("PRINCIPAL_NOT_LINKED");
      if (meta.model_id !== q.modelId) fail("VALIDATION_REJECTED");
      const issued = this.#time(); if (issued > Number.MAX_SAFE_INTEGER - TTL) fail("SERVICE_CLOSED");
      nativeInvoked = true;
      let context: OwnerGrokI2vImageUploadContext;
      try { context = await Reflect.apply(NATIVE_UPLOAD as Function, client.client,
        [{ media: validated, destination: this.#uploadDestination }, op.controller.signal]) as OwnerGrokI2vImageUploadContext; }
      catch { this.#unknownIfStopped(op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      this.#unknownIfStopped(op);
      const nativeRef = readOwnerGrokI2vUploadReferenceForClient(client.client, context);
      if (!nativeRef || nativeRef.type !== "image" || !isSafeUploadReferenceUrl(nativeRef.url)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const after = await this.#principal(q.attemptId, op.controller.signal); this.#unknownIfStopped(op);
      const afterClient = clientSnapshot(this.#resolveClient(q.attemptId));
      if (!sameGenerationPrincipal(principal, after) || afterClient.client !== client.client) fail("UPLOAD_OUTCOME_UNKNOWN");
      const ack = this.#time(), expiresAt = issued + TTL, epoch = op.epoch;
      if (expiresAt - ack < 1000 || epoch !== (this.#epochs.get(q.attemptId) ?? 0) || this.#invalidating.has(q.attemptId) ||
          this.#records.size + this.#unknownSemantics.size >= MAX_RECORDS || !this.#pendingSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const conflicts = [...this.#records.values()].filter(record => {
        const prior = readOwnerGrokI2vUploadReferenceForClient(record.client, record.context);
        return record.principal.tenant_id === principal.tenant_id && record.principal.subject_id === principal.subject_id && prior?.url === nativeRef.url;
      });
      if (conflicts.some(record => record.sha256 !== meta.sha256 || record.mimeType !== meta.mime_type || record.size !== meta.size ||
          record.width !== meta.width || record.height !== meta.height)) {
        for (const record of conflicts) {
          this.#unknownSemantics.add(semanticKey(record.principal, record.sha256, record.mimeType, record.size, record.width, record.height));
          this.#remove(record.handle);
        }
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const handle = `grok_i2v_reference_${randomUUID()}`;
      const record: RecordEntry = Object.freeze({ handle, attemptId: q.attemptId, uploadModelId: meta.model_id,
        principal, client: client.client, epoch, expiresAt, context, destination: this.#uploadDestination,
        mimeType: meta.mime_type, size: meta.size, sha256: meta.sha256, width: meta.width, height: meta.height });
      this.#records.set(handle, record); const set = this.#handles.get(q.attemptId) ?? new Set<string>();
      set.add(handle); this.#handles.set(q.attemptId, set); published = true;
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: meta.model_id, media_type: "image",
        mime_type: meta.mime_type, size: meta.size, sha256: meta.sha256, width: meta.width, height: meta.height,
        expires_in_seconds: Math.floor((expiresAt - ack) / 1000), metadata_confidence: OWNER_GROK_I2V_IMAGE_POLICY.metadata_confidence,
        size_limit_confidence: OWNER_GROK_I2V_IMAGE_POLICY.local_max_bytes_policy, provider_acceptance: "UNPROVEN",
        upload_authority: false, generation_permit: false });
    } catch (error) {
      if (error instanceof OwnerGrokI2vReferenceServiceError) {
        if (nativeInvoked && !published && error.code !== "UPLOAD_OUTCOME_UNKNOWN") fail("UPLOAD_OUTCOME_UNKNOWN"); throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) { if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN"); fail("PRINCIPAL_NOT_LINKED"); }
      if (nativeInvoked) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (op.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("VALIDATION_REJECTED");
    } finally {
      if (semantic && reserved) { if (nativeInvoked && !published) this.#unknownSemantics.add(semantic); this.#pendingSemantics.delete(semantic); }
      if (validated) releaseValidatedOwnerGrokI2vImageUpload(validated);
      q.bytes.fill(0); this.#finish(q.attemptId, op);
    }
    return fail("VALIDATION_REJECTED");
  }

  async resolveReferences(input: unknown, signalInput?: AbortSignal): Promise<OwnerGrokI2vOwnedReferences> {
    this.#assertOpen(); const q = snapshotResolve(input), op = this.#begin(q.attemptId, exactSignal(signalInput));
    try {
      const principal = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      if (!this.#rememberPrincipal(q.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = clientSnapshot(this.#resolveClient(q.attemptId)).client, record = this.#records.get(q.handle), now = this.#time();
      if (!record || record.attemptId !== q.attemptId || !sameGenerationPrincipal(record.principal, principal)) fail("REFERENCE_UNAVAILABLE");
      if (record.expiresAt <= now) { this.#remove(q.handle); fail("REFERENCE_EXPIRED"); }
      const nativeRef = readOwnerGrokI2vUploadReferenceForClient(client, record.context);
      if (record.epoch !== op.epoch || record.client !== client || !contextMatchesRecord(record, nativeRef) || !nativeRef || !isSafeUploadReferenceUrl(nativeRef.url)) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#principal(q.attemptId, op.controller.signal); this.#stopped(op);
      if (!sameGenerationPrincipal(latest, principal) || clientSnapshot(this.#resolveClient(q.attemptId)).client !== client) fail("PRINCIPAL_NOT_LINKED");
      const ack = this.#time();
      if (record.expiresAt <= ack || this.#records.get(record.handle) !== record || record.epoch !== (this.#epochs.get(q.attemptId) ?? 0) ||
          this.#invalidating.has(q.attemptId) || record.client !== client) fail("REFERENCE_EXPIRED");
      const references = Object.freeze([Object.freeze({ reference_handle: record.handle, media_type: "image" as const,
        mime_type: record.mimeType, size: record.size, sha256: record.sha256, width: record.width, height: record.height })]);
      const owned: OwnerGrokI2vOwnedReferences = Object.freeze({ attempt_id: q.attemptId, model_id: q.modelId, principal,
        profile_sha256: PROFILE_SHA256, expires_at: record.expiresAt, epoch: op.epoch, references, generation_permit: false });
      OWNED.set(owned, Object.freeze({ service: this, record, attemptId: q.attemptId, modelId: q.modelId,
        principal, client, epoch: op.epoch, expiresAt: record.expiresAt }));
      return owned;
    } catch (error) {
      if (error instanceof OwnerGrokI2vReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      if (op.controller.signal.aborted) fail("REQUEST_ABORTED");
      fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(q.attemptId, op); }
  }

  isOwnedReferences(value: unknown): value is OwnerGrokI2vOwnedReferences {
    try {
      this.#assertOpen();
      if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const state = OWNED.get(value), remembered = state ? this.#principalByAttempt.get(state.attemptId) : undefined;
      if (!state || state.service !== this || this.#time() >= state.expiresAt || state.epoch !== (this.#epochs.get(state.attemptId) ?? 0) ||
          this.#invalidating.has(state.attemptId) || !remembered || !sameGenerationPrincipal(remembered, state.principal) || !exactOwned(value, state)) return false;
      const record = state.record, ref = readOwnerGrokI2vUploadReferenceForClient(state.client, record.context);
      return this.#records.get(record.handle) === record && record.expiresAt > this.#lastNow! && record.epoch === state.epoch &&
        sameGenerationPrincipal(record.principal, state.principal) && clientSnapshot(this.#resolveClient(record.attemptId)).client === state.client &&
        contextMatchesRecord(record, ref);
    } catch { return false; }
  }

  withCapturedReferences<T>(value: unknown, request: unknown, consume: (client: SyntxChatHttpClient, references: readonly Readonly<{
    reference_handle: string; type: "image"; url: string; sha256: string; width: number; height: number;
  }>[]) => T): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const modelId = snapshotModelRequest(request), state = value && typeof value === "object" && !types.isProxy(value) ? OWNED.get(value) : undefined;
    if (!state || state.service !== this || state.modelId !== modelId || !this.isOwnedReferences(value)) fail("REFERENCE_UNAVAILABLE");
    const record = state.record, captured = readOwnerGrokI2vUploadReferenceForClient(state.client, record.context);
    if (!contextMatchesRecord(record, captured) || !captured || clientSnapshot(this.#resolveClient(record.attemptId)).client !== state.client) fail("REFERENCE_UNAVAILABLE");
    return consume(state.client, Object.freeze([Object.freeze({ reference_handle: record.handle, type: "image" as const,
      url: captured.url, sha256: record.sha256, width: record.width, height: record.height })]));
  }

  invalidateAttempt(value: unknown): Promise<void> { return typeof value === "string" && ATTEMPT.test(value) ? this.#invalidate(value) : Promise.resolve(); }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true; const invalid = [...this.#active()].map(id => this.#invalidate(id)), pending = [...this.#all];
    this.#closing = Promise.allSettled([...invalid, ...pending]).then(() => {
      this.#records.clear(); this.#handles.clear(); this.#principalByAttempt.clear(); this.#epochs.clear();
      this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear(); this.#invalidations.clear(); this.#all.clear();
    }); return this.#closing;
  }

  #principal(id: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) return Promise.reject(new OwnerGrokI2vReferenceServiceError("REQUEST_ABORTED"));
    const promise = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: id, linkService: this.#links });
    if (!signal) return promise;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { const onAbort = () => reject(new OwnerGrokI2vReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort(); else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); } });
    return Promise.race([promise, aborted]).finally(remove);
  }
  #rememberPrincipal(id: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const prior = this.#principalByAttempt.get(id); if (prior && !sameGenerationPrincipal(prior, principal)) return false;
    this.#principalByAttempt.set(id, principal); return true;
  }
  #begin(id: string, parent?: AbortSignal): Pending {
    this.#assertOpen(); if (this.#invalidating.has(id)) fail("REQUEST_ABORTED"); this.#prune(this.#time());
    if (!this.#active().has(id) && this.#active().size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const set = this.#pendingByAttempt.get(id) ?? new Set<Pending>();
    const op: Pending = { controller, done, finish, removeAbort: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(id) ?? 0 };
    set.add(op); this.#pendingByAttempt.set(id, set); this.#all.add(done); this.#pendingCount++; return op;
  }
  #finish(id: string, op: Pending): void {
    op.removeAbort(); const set = this.#pendingByAttempt.get(id); set?.delete(op); if (!set?.size) this.#pendingByAttempt.delete(id);
    this.#pendingCount--; op.finish(); this.#all.delete(op.done); this.#release(id);
  }
  #stopped(op: Pending): void { this.#assertOpen(); if (op.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #unknownIfStopped(op: Pending): void { if (this.#closed || op.controller.signal.aborted) fail("UPLOAD_OUTCOME_UNKNOWN"); }
  #active(): Set<string> { return new Set([...this.#handles.keys(), ...this.#principalByAttempt.keys(), ...this.#pendingByAttempt.keys()]); }
  #invalidate(id: string): Promise<void> {
    const prior = this.#invalidations.get(id); if (prior) return prior;
    this.#invalidating.add(id); this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1); this.#removeAttempt(id); this.#principalByAttempt.delete(id);
    for (const op of this.#pendingByAttempt.get(id) ?? []) op.controller.abort();
    const done = Promise.allSettled([...(this.#pendingByAttempt.get(id) ?? [])].map(op => op.done)).then(() => {
      this.#invalidating.delete(id); this.#invalidations.delete(id); this.#release(id);
    }); this.#invalidations.set(id, done); return done;
  }
  #removeAttempt(id: string): void { for (const handle of this.#handles.get(id) ?? []) this.#records.delete(handle); this.#handles.delete(id); }
  #remove(handle: string): void { const record = this.#records.get(handle); if (!record) return; this.#records.delete(handle);
    const set = this.#handles.get(record.attemptId); set?.delete(handle); if (!set?.size) this.#handles.delete(record.attemptId); this.#release(record.attemptId); }
  #prune(now: number): void { for (const [handle, record] of this.#records) if (record.expiresAt <= now) this.#remove(handle); }
  #release(id: string): void { if (this.#handles.has(id) || this.#pendingByAttempt.has(id) || this.#invalidating.has(id)) return;
    this.#epochs.delete(id); this.#principalByAttempt.delete(id); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #time(): number {
    let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number;
  }
}
Object.freeze(OwnerGrokI2vReferenceService.prototype);

export function isOwnerGrokI2vReferenceService(value: unknown): value is OwnerGrokI2vReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerGrokI2vReferenceService.prototype && Object.isFrozen(value);
}

function snapshotUpload(value: unknown): UploadSnapshot {
  const f = exactRecord(value, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !isOwnerGrokI2vModelId(f.model_id) ||
      typeof f.filename !== "string" || typeof f.mime_type !== "string" || !supportedBytes(f.bytes)) fail("INVALID_REQUEST");
  const length = safeByteLength(f.bytes), maximum = OWNER_GROK_I2V_IMAGE_POLICY.local_max_bytes[f.model_id];
  if (length < 1 || length > maximum) fail("INVALID_REQUEST");
  const bytes = copyBytes(f.bytes);
  try { return Object.freeze({ attemptId: f.attemptId, modelId: f.model_id, filename: f.filename,
    mimeType: f.mime_type as OwnerGrokI2vImageMimeType, bytes }); }
  catch (error) { bytes.fill(0); throw error; }
}
function snapshotResolve(value: unknown): ResolveSnapshot {
  const f = exactRecord(value, ["attemptId", "model_id", "reference_handles"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !isOwnerGrokI2vModelId(f.model_id) ||
      !Array.isArray(f.reference_handles) || types.isProxy(f.reference_handles) || Object.getPrototypeOf(f.reference_handles) !== Array.prototype) fail("INVALID_REQUEST");
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(f.reference_handles) as unknown as PropertyDescriptorMap; } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), length = descriptors.length, first = descriptors["0"];
  if (keys.length !== 2 || !length || !Object.hasOwn(length, "value") || length.value !== 1 || length.enumerable !== false ||
      !first || !first.enumerable || !Object.hasOwn(first, "value") || typeof first.value !== "string" || !exactMatch(HANDLE, first.value)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, modelId: f.model_id, handle: first.value });
}
function snapshotModelRequest(value: unknown): OwnerGrokI2vImageModelId {
  const f = exactRecord(value, ["model_id"]); if (!isOwnerGrokI2vModelId(f.model_id)) fail("INVALID_REQUEST"); return f.model_id;
}
function exactOwned(value: object, state: OwnedState): boolean {
  try {
    const f = exactRecord(value, ["attempt_id", "model_id", "principal", "profile_sha256", "expires_at", "epoch", "references", "generation_permit"]), r = state.record;
    if (f.attempt_id !== state.attemptId || f.model_id !== state.modelId || f.principal !== state.principal || f.profile_sha256 !== PROFILE_SHA256 ||
        f.expires_at !== state.expiresAt || f.epoch !== state.epoch || f.generation_permit !== false ||
        !Array.isArray(f.references) || !Object.isFrozen(f.references) || f.references.length !== 1 || !Object.isFrozen(f.references[0])) return false;
    const row = exactRecord(f.references[0], ["reference_handle", "media_type", "mime_type", "size", "sha256", "width", "height"]);
    return row.reference_handle === r.handle && row.media_type === "image" && row.mime_type === r.mimeType && row.size === r.size &&
      row.sha256 === r.sha256 && row.width === r.width && row.height === r.height;
  } catch { return false; }
}
function contextMatchesRecord(r: RecordEntry, reference: Readonly<{ type: "image"; url: string }> | null): boolean {
  const c = r.context;
  return !!reference && reference.type === "image" && isSafeUploadReferenceUrl(reference.url) && c.status === "uploaded" &&
    c.model_id === r.uploadModelId && c.destination === r.destination && c.media_type === "image" && c.mime_type === r.mimeType &&
    c.size === r.size && c.sha256 === r.sha256 && c.width === r.width && c.height === r.height &&
    c.metadata_confidence === OWNER_GROK_I2V_IMAGE_POLICY.metadata_confidence && c.provider_acceptance === "UNPROVEN" &&
    c.generation_permit === false && c.owner_upload_binding === "SAME_CLIENT_NATIVE_UPLOAD";
}
function clientSnapshot(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    const method = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerGrokI2vImage");
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadOwnerGrokI2vImage") || method !== NATIVE_UPLOAD || Reflect.get(value, "uploadOwnerGrokI2vImage") !== NATIVE_UPLOAD) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch (error) { if (error instanceof OwnerGrokI2vReferenceServiceError) throw error; fail("INVALID_REQUEST"); }
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
  const d = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
  return !!d && "value" in d && d.value === NATIVE_LINK_STATUS;
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
    if (!TYPED_ARRAY_BUFFER_GETTER || !TYPED_ARRAY_OFFSET_GETTER || !TYPED_ARRAY_LENGTH_GETTER || !ARRAY_BUFFER_LENGTH_GETTER) return false;
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as unknown;
    return !!buffer && typeof buffer === "object" && !types.isProxy(buffer) && Object.getPrototypeOf(buffer) === ArrayBuffer.prototype &&
      !Object.hasOwn(buffer, "byteLength") && Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, buffer, []) >= Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []);
  } catch { return false; }
}
function safeByteLength(value: Uint8Array): number { try { return Reflect.apply(TYPED_ARRAY_LENGTH_GETTER!, value, []) as number; } catch { fail("INVALID_REQUEST"); } }
function copyBytes(value: Uint8Array): Buffer {
  try { return Buffer.from(new Uint8Array(Reflect.apply(TYPED_ARRAY_BUFFER_GETTER!, value, []) as ArrayBuffer,
    Reflect.apply(TYPED_ARRAY_OFFSET_GETTER!, value, []) as number, safeByteLength(value))); } catch { fail("INVALID_REQUEST"); }
}
function semanticKey(principal: Readonly<GenerationPrincipalRef>, sha256: string, mime: string, size: number, width: number, height: number): string {
  return schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, profile_sha256: PROFILE_SHA256, sha256,
    mime_type: mime, size, width, height });
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
function readClock(value: unknown): () => number {
  return () => { let result: unknown; try { result = Reflect.apply(value as Function, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(result) || (result as number) < 0) fail("SERVICE_CLOSED"); return result as number; };
}
function exactMatch(regex: RegExp, value: string): boolean { return regex.exec(value)?.[0] === value; }
function fail(code: OwnerGrokI2vReferenceServiceErrorCode): never { throw new OwnerGrokI2vReferenceServiceError(code); }
