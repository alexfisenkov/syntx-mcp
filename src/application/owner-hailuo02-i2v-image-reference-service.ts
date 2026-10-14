import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readOwnerHailuo02I2vUploadReferenceForClient } from "../adapter/syntx/hailuo02-i2v-upload-context.js";
import type { OwnerHailuo02I2vImageUploadContext } from "../adapter/syntx/hailuo02-i2v-upload-context.js";
import { releaseValidatedOwnerHailuo02I2vImageUpload,
  validateOwnerHailuo02I2vImageUpload, type OwnerHailuo02I2vCanonicalMimeType } from "./owner-hailuo02-i2v-image-policy.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^h02img_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const NATIVE_UPLOAD = SyntxChatHttpClient.prototype.uploadHailuo02I2vImage;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLUTIONS = new WeakMap<object, { service: OwnerHailuo02I2vImageReferenceService; record: RecordEntry }>();

export interface OwnerHailuo02I2vImageReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerHailuo02I2vImageUploadInput {
  readonly attemptId: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
}
export interface OwnerHailuo02I2vImageUploadReceipt {
  readonly status: "uploaded";
  readonly image_handle: string;
  readonly model_id: "hailuo-02";
  readonly mime_type: OwnerHailuo02I2vCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_in_seconds: number;
}
export interface OwnerHailuo02I2vImageResolveInput { readonly attempt_id: string; readonly image_handle: string; }
export interface OwnerHailuo02I2vImageResolution {
  readonly role: "hailuo02_i2v_image";
  readonly wire_type: "image";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly image_handle: string;
  readonly mime_type: OwnerHailuo02I2vCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}
export type OwnerHailuo02I2vImageReferenceServiceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" |
  "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "IMAGE_REJECTED" |
  "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerHailuo02I2vImageReferenceServiceError extends Error {
  constructor(readonly code: OwnerHailuo02I2vImageReferenceServiceErrorCode) {
    super("The owner Hailuo-02 I2V image reference is unavailable."); this.name = "OwnerHailuo02I2vImageReferenceServiceError";
  }
}
interface RecordEntry {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly mime: OwnerHailuo02I2vCanonicalMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly expiresAt: number; readonly epoch: number;
  readonly client: SyntxChatHttpClient; readonly nativeReference: OwnerHailuo02I2vImageUploadContext;
}
interface Pending { readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void; readonly remove: () => void; readonly epoch: number; }

/** Process-local, owner-bound Hailuo-02 I2V image uploads. No generation permit is issued. */
export class OwnerHailuo02I2vImageReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService;
  readonly #resolveClient: (attemptId: string) => unknown; readonly #now: () => number;
  readonly #records = new Map<string, RecordEntry>(); readonly #byAttempt = new Map<string, Set<string>>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>(); readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<Pending>>(); readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>(); readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>(); readonly #operations = new Set<Promise<void>>();
  #pendingCount = 0; #lastNow: number | undefined; #closed = false; #closing: Promise<void> | undefined;

  constructor(input: OwnerHailuo02I2vImageReferenceServiceOptions | unknown) {
    const f = exactRecord(input, ["binding", "linkService", "resolveClient"], ["now"]);
    if (!isLinkService(f.linkService) || typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) ||
        (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(f.binding); this.#links = f.linkService as PerUserLinkService;
    this.#resolveClient = f.resolveClient as (attemptId: string) => unknown;
    this.#now = f.now === undefined ? Date.now : readClock(f.now); Object.freeze(this);
  }

  async uploadImage(input: OwnerHailuo02I2vImageUploadInput | unknown, signal?: AbortSignal): Promise<OwnerHailuo02I2vImageUploadReceipt> {
    this.#assertOpen(); const req = snapshotUpload(input, signal); const op = this.#begin(req.attemptId, signal);
    let policyReceipt: ReturnType<typeof validateOwnerHailuo02I2vImageUpload> | undefined;
    let semantic: string | undefined; let invoked = false; let unknown = false;
    try {
      const principal = await this.#principal(req.attemptId, op.controller.signal); this.#stopped(op);
      if (!this.#remember(req.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = nativeClient(this.#resolveClient(req.attemptId));
      policyReceipt = validateOwnerHailuo02I2vImageUpload({ filename: req.filename, mime_type: req.mime_type, bytes: req.bytes });
      semantic = JSON.stringify([principal.tenant_id, principal.subject_id, policyReceipt.sha256, policyReceipt.mime_type, policyReceipt.size]);
      if (this.#unknownSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semantic)) fail("SERVICE_BUSY");
      this.#prune(this.#readNow());
      if (this.#records.size + this.#unknownSemantics.size + this.#pendingSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic);
      const before = await this.#principal(req.attemptId, op.controller.signal); this.#stopped(op);
      if (!sameGenerationPrincipal(principal, before) || nativeClient(this.#resolveClient(req.attemptId)).client !== client.client) fail("PRINCIPAL_NOT_LINKED");
      const started = this.#readNow(); if (started > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      invoked = true;
      const native = await Reflect.apply(NATIVE_UPLOAD, client.client, [policyReceipt, op.controller.signal]) as OwnerHailuo02I2vImageUploadContext;
      this.#stopped(op);
      const details = readOwnerHailuo02I2vUploadReferenceForClient(client.client, native);
      if (!details || native.status !== "uploaded" || native.model_id !== "hailuo-02" || native.mime_type !== policyReceipt.mime_type ||
          native.size !== policyReceipt.size || native.sha256 !== policyReceipt.sha256 || native.width !== policyReceipt.width || native.height !== policyReceipt.height) {
        unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      const after = await this.#principal(req.attemptId, op.controller.signal).catch(() => { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); });
      this.#stopped(op);
      if (!sameGenerationPrincipal(principal, after) || nativeClient(this.#resolveClient(req.attemptId)).client !== client.client) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const acknowledged = this.#readNow(), expiresAt = started + TTL_MS;
      if (expiresAt - acknowledged < 1_000 || op.epoch !== (this.#epochs.get(req.attemptId) ?? 0) || this.#invalidating.has(req.attemptId)) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const handle = `h02img_${randomUUID().replaceAll("-", "")}`;
      const record: RecordEntry = Object.freeze({ handle, attemptId: req.attemptId, principal, mime: native.mime_type,
        size: native.size, sha256: native.sha256, width: native.width, height: native.height, expiresAt, epoch: op.epoch, client: client.client, nativeReference: native });
      this.#records.set(handle, record); const set = this.#byAttempt.get(req.attemptId) ?? new Set<string>(); set.add(handle); this.#byAttempt.set(req.attemptId, set);
      return Object.freeze({ status: "uploaded", image_handle: handle, model_id: "hailuo-02", mime_type: record.mime,
        size: record.size, sha256: record.sha256, width: record.width, height: record.height, expires_in_seconds: Math.floor((expiresAt - acknowledged) / 1000) });
    } catch (error) {
      if (error instanceof OwnerHailuo02I2vImageReferenceServiceError) {
        if (invoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        unknown ||= error.code === "UPLOAD_OUTCOME_UNKNOWN" && invoked; throw error;
      }
      if (error instanceof OwnerReferencePrincipalError) { if (invoked) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); } fail("PRINCIPAL_NOT_LINKED"); }
      if (error instanceof SyntxHttpError && ["INVALID_REQUEST", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED"].includes(error.code)) fail("UPLOAD_REJECTED");
      if (invoked) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); } return fail("IMAGE_REJECTED");
    } finally {
      if (semantic) { if (unknown) this.#unknownSemantics.add(semantic); this.#pendingSemantics.delete(semantic); }
      if (policyReceipt) releaseValidatedOwnerHailuo02I2vImageUpload(policyReceipt);
      req.bytes.fill(0);
      this.#finish(req.attemptId, op);
    }
  }

  async resolveReference(input: OwnerHailuo02I2vImageResolveInput | unknown, signal?: AbortSignal): Promise<OwnerHailuo02I2vImageResolution> {
    this.#assertOpen(); const req = snapshotResolve(input); const op = this.#begin(req.attemptId, signal);
    try {
      const principal = await this.#principal(req.attemptId, op.controller.signal); this.#stopped(op);
      if (!this.#remember(req.attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const rec = this.#records.get(req.handle); if (!rec || rec.attemptId !== req.attemptId) fail("REFERENCE_UNAVAILABLE");
      if (rec.expiresAt <= this.#readNow()) { this.#remove(req.handle); fail("REFERENCE_EXPIRED"); }
      if (rec.epoch !== (this.#epochs.get(req.attemptId) ?? 0) || !sameGenerationPrincipal(rec.principal, principal) ||
          !readOwnerHailuo02I2vUploadReferenceForClient(rec.client, rec.nativeReference)) fail("REFERENCE_UNAVAILABLE");
      const latest = await this.#principal(req.attemptId, op.controller.signal); this.#stopped(op);
      if (!sameGenerationPrincipal(rec.principal, latest)) fail("PRINCIPAL_NOT_LINKED");
      if (rec.expiresAt <= this.#readNow() || this.#records.get(rec.handle) !== rec || rec.epoch !== (this.#epochs.get(req.attemptId) ?? 0) || this.#invalidating.has(req.attemptId)) fail("REFERENCE_EXPIRED");
      const result: OwnerHailuo02I2vImageResolution = Object.freeze({ role: "hailuo02_i2v_image", wire_type: "image", principal: rec.principal,
        attempt_id: rec.attemptId, image_handle: rec.handle, mime_type: rec.mime, size: rec.size, sha256: rec.sha256,
        width: rec.width, height: rec.height, expires_at: rec.expiresAt, epoch: rec.epoch, generation_permit: false });
      RESOLUTIONS.set(result, { service: this, record: rec }); return result;
    } catch (error) { if (error instanceof OwnerHailuo02I2vImageReferenceServiceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); return fail("REFERENCE_UNAVAILABLE");
    } finally { this.#finish(req.attemptId, op); }
  }

  isOwnedResolution(value: unknown, input: OwnerHailuo02I2vImageResolveInput | unknown): boolean {
    try { this.#assertOpen(); const req = snapshotResolve(input); if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = RESOLUTIONS.get(value), rec = this.#records.get(req.handle);
      return !!owned && owned.service === this && owned.record === rec && !!rec && rec.attemptId === req.attemptId && rec.expiresAt > this.#readNow() &&
        rec.epoch === (this.#epochs.get(req.attemptId) ?? 0) && !this.#invalidating.has(req.attemptId) &&
        !!readOwnerHailuo02I2vUploadReferenceForClient(rec.client, rec.nativeReference) && exactResolution(value, rec);
    } catch { return false; }
  }

  withCapturedNativeImage<T>(value: unknown, input: OwnerHailuo02I2vImageResolveInput | unknown,
    consume: (client: SyntxChatHttpClient, reference: OwnerHailuo02I2vImageUploadContext) => T): T {
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST"); const req = snapshotResolve(input);
    const owned = value && typeof value === "object" && !types.isProxy(value) ? RESOLUTIONS.get(value as object) : undefined;
    if (!owned || owned.service !== this || owned.record.handle !== req.handle || owned.record.attemptId !== req.attemptId || !this.isOwnedResolution(value, input)) fail("REFERENCE_UNAVAILABLE");
    return consume(owned.record.client, owned.record.nativeReference);
  }

  invalidateAttempt(value: unknown): Promise<void> { return typeof value === "string" && ATTEMPT.test(value) ? this.#invalidate(value) : Promise.resolve(); }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    const invalidations = [...this.#activeAttempts()].map((id) => this.#invalidate(id)); const pending = [...this.#operations];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => { this.#records.clear(); this.#byAttempt.clear(); this.#principals.clear(); this.#epochs.clear(); this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear(); });
    return this.#closing;
  }
  #principal(attemptId: string, signal?: AbortSignal) {
    if (signal?.aborted) return Promise.reject(new OwnerHailuo02I2vImageReferenceServiceError("REQUEST_ABORTED"));
    const result = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
    if (!signal) return result; let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => { const fn = () => reject(new OwnerHailuo02I2vImageReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) fn(); else { signal.addEventListener("abort", fn, { once: true }); remove = () => signal.removeEventListener("abort", fn); } });
    return Promise.race([result, aborted]).finally(remove);
  }
  #remember(id: string, p: Readonly<GenerationPrincipalRef>): boolean { const old = this.#principals.get(id); if (old && !sameGenerationPrincipal(old, p)) return false; this.#principals.set(id, p); return true; }
  #begin(id: string, parent?: AbortSignal): Pending {
    this.#assertOpen(); if (this.#invalidating.has(id)) fail("REQUEST_ABORTED"); this.#readNow();
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY"); if (!this.#activeAttempts().has(id) && this.#activeAttempts().size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason); if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); const set = this.#pendingByAttempt.get(id) ?? new Set<Pending>();
    const op = { controller, done, finish, remove: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(id) ?? 0 };
    set.add(op); this.#pendingByAttempt.set(id, set); this.#operations.add(done); this.#pendingCount++; return op;
  }
  #finish(id: string, op: Pending): void { op.remove(); const set = this.#pendingByAttempt.get(id); set?.delete(op); if (!set?.size) this.#pendingByAttempt.delete(id); this.#pendingCount--; op.finish(); this.#operations.delete(op.done); this.#maybeRelease(id); }
  #stopped(op: Pending): void { this.#assertOpen(); if (op.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #activeAttempts(): Set<string> { return new Set([...this.#byAttempt.keys(), ...this.#principals.keys(), ...this.#pendingByAttempt.keys()]); }
  #invalidate(id: string): Promise<void> { const old = this.#invalidations.get(id); if (old) return old; this.#invalidating.add(id); this.#epochs.set(id, (this.#epochs.get(id) ?? 0) + 1); this.#removeAttempt(id); this.#principals.delete(id);
    for (const op of this.#pendingByAttempt.get(id) ?? []) op.controller.abort(); const waits = [...(this.#pendingByAttempt.get(id) ?? [])].map((op) => op.done);
    const done = Promise.allSettled(waits).then(() => { this.#invalidating.delete(id); this.#invalidations.delete(id); this.#maybeRelease(id); }); this.#invalidations.set(id, done); return done; }
  #removeAttempt(id: string): void { for (const handle of this.#byAttempt.get(id) ?? []) this.#records.delete(handle); this.#byAttempt.delete(id); }
  #remove(handle: string): void { const rec = this.#records.get(handle); if (!rec) return; this.#records.delete(handle); const set = this.#byAttempt.get(rec.attemptId); set?.delete(handle); if (!set?.size) this.#byAttempt.delete(rec.attemptId); this.#maybeRelease(rec.attemptId); }
  #prune(now: number): void { for (const [handle, rec] of this.#records) if (rec.expiresAt <= now) this.#remove(handle); for (const id of this.#epochs.keys()) if (!this.#activeAttempts().has(id)) this.#epochs.delete(id); }
  #maybeRelease(id: string): void { if (this.#byAttempt.has(id) || this.#pendingByAttempt.has(id) || this.#invalidating.has(id)) return; this.#epochs.delete(id); this.#principals.delete(id); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number { let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); } if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED"); this.#lastNow = value as number; return value as number; }
}

function snapshotUpload(input: unknown, signal?: AbortSignal): Readonly<OwnerHailuo02I2vImageUploadInput> {
  const f = exactRecord(input, ["attemptId", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.filename !== "string" || typeof f.mime_type !== "string" ||
      !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes) || (signal !== undefined && (!signal || typeof signal !== "object" || types.isProxy(signal)))) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, filename: f.filename, mime_type: f.mime_type, bytes: new Uint8Array(f.bytes) });
}
function snapshotResolve(input: unknown): Readonly<{ attemptId: string; handle: string }> { const f = exactRecord(input, ["attempt_id", "image_handle"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.image_handle !== "string" || !HANDLE.test(f.image_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attempt_id, handle: f.image_handle }); }
function nativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
      SyntxChatHttpClient.prototype.uploadHailuo02I2vImage !== NATIVE_UPLOAD || Object.hasOwn(value, "uploadHailuo02I2vImage")) fail("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, "uploadHailuo02I2vImage"); if (!d || !("value" in d) || d.value !== NATIVE_UPLOAD) fail("INVALID_REQUEST"); return Object.freeze({ client: value as SyntxChatHttpClient });
}
function exactResolution(value: object, r: RecordEntry): boolean { const f = exactRecord(value, ["role", "wire_type", "principal", "attempt_id", "image_handle", "mime_type", "size", "sha256", "width", "height", "expires_at", "epoch", "generation_permit"]);
  return f.role === "hailuo02_i2v_image" && f.wire_type === "image" && f.attempt_id === r.attemptId && f.image_handle === r.handle && f.mime_type === r.mime && f.size === r.size && f.sha256 === r.sha256 && f.width === r.width && f.height === r.height && f.expires_at === r.expiresAt && f.epoch === r.epoch && f.generation_permit === false && f.principal === r.principal; }
function snapshotBinding(input: unknown): Readonly<AuthBinding> { const f = exactRecord(input, ["tenant_id", "subject"]); if (typeof f.tenant_id !== "string" || !f.tenant_id || f.tenant_id.length > 256 || typeof f.subject !== "string" || !f.subject || f.subject.length > 512) fail("INVALID_REQUEST"); return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> { if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST"); let proto: object | null, desc: PropertyDescriptorMap; try { proto = Object.getPrototypeOf(input); desc = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(desc), allowed = [...required, ...optional]; if ((proto !== Object.prototype && proto !== null) || required.some((key) => !Object.hasOwn(desc, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in desc[key]!) || desc[key]!.enumerable !== true)) fail("INVALID_REQUEST"); const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) out[key] = desc[key]!.value; return out; }
function isLinkService(v: unknown): v is PerUserLinkService { if (!v || typeof v !== "object" || types.isProxy(v) || Object.getPrototypeOf(v) !== PerUserLinkService.prototype || PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(v, "getStatus")) return false; const d = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus"); return !!d && "value" in d && d.value === NATIVE_LINK_STATUS; }
function readClock(value: unknown): () => number { if (typeof value !== "function" || types.isProxy(value)) fail("INVALID_REQUEST"); return () => { let n: unknown; try { n = Reflect.apply(value, undefined, []); } catch { fail("SERVICE_CLOSED"); } if (!Number.isSafeInteger(n) || (n as number) < 0) fail("SERVICE_CLOSED"); return n as number; }; }
function fail(code: OwnerHailuo02I2vImageReferenceServiceErrorCode): never { throw new OwnerHailuo02I2vImageReferenceServiceError(code); }
