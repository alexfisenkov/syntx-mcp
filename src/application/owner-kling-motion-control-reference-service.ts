import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { isAbsolute } from "node:path";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { SyntxChatHttpClient, readOwnerKlingMotionControlUploadReferenceForClient } from "../adapter/syntx/chat-http-client.js";
import type { OwnerKlingMotionControlImageUploadContext, OwnerKlingMotionControlVideoUploadContext } from "../adapter/syntx/kling-motion-control-upload-context.js";
import { OwnerKlingMotionControlImagePolicyError, releaseValidatedOwnerKlingMotionControlImage, validateOwnerKlingMotionControlImage, type ValidatedOwnerKlingMotionControlImage } from "./owner-kling-motion-control-image-policy.js";
import { OwnerKlingMotionControlVideoProbeError, createOwnerKlingMotionControlVideoProbe, releaseTrustedOwnerKlingMotionControlVideoProbeResult, type OwnerKlingMotionControlVideoProbeResult } from "./owner-kling-motion-control-video-probe.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^kling_motion_control_image_[0-9a-f-]{36}$/u;
const VIDEO_HANDLE = /^kling_motion_control_video_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000;
const MAX_RECORDS = 128;
const MAX_PENDING = 4;
const MAX_IMAGE_BASE64 = Math.ceil(64 * 1024 * 1024 / 3) * 4;
const MAX_VIDEO_BASE64 = Math.ceil(100 * 1024 * 1024 / 3) * 4;
const NATIVE_IMAGE = SyntxChatHttpClient.prototype.uploadKlingMotionControlImage;
const NATIVE_VIDEO = SyntxChatHttpClient.prototype.uploadKlingMotionControlVideo;
const NATIVE_READER = readOwnerKlingMotionControlUploadReferenceForClient;
const IMAGE_RESOLUTIONS = new WeakMap<object, { service: OwnerKlingMotionControlReferenceService; record: ImageRecord }>();
const PAIR_RESOLUTIONS = new WeakMap<object, { service: OwnerKlingMotionControlReferenceService; image: ImageRecord; video: VideoRecord }>();

export const OWNER_KLING_MOTION_CONTROL_REFERENCE_INPUT_LIMITS = Object.freeze({
  image_max_bytes: 64 * 1024 * 1024, video_max_bytes: 100 * 1024 * 1024,
  image_max_base64_chars: MAX_IMAGE_BASE64, video_max_base64_chars: MAX_VIDEO_BASE64
});

export interface OwnerKlingMotionControlReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly ffprobePath: string;
  readonly now?: () => number;
}
export interface OwnerKlingMotionControlUploadInput {
  readonly attemptId: string; readonly content_base64: string; readonly filename: string; readonly mime_type: string;
}
export interface OwnerKlingMotionControlImageUploadReceipt {
  readonly status: "uploaded"; readonly image_handle: string; readonly model_id: "kling_motion_control";
  readonly filename: string; readonly mime_type: string; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly expires_in_seconds: number; readonly generation_permit: false;
}
export interface OwnerKlingMotionControlVideoUploadReceipt {
  readonly status: "uploaded"; readonly video_handle: string; readonly model_id: "kling_motion_control";
  readonly filename: string; readonly mime_type: string; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly duration_seconds: number; readonly expires_in_seconds: number;
  readonly metadata_confidence: "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED"; readonly generation_permit: false;
}
export interface OwnerKlingMotionControlImageResolveInput { readonly attempt_id: string; readonly image_handle: string; }
export interface OwnerKlingMotionControlOwnPairResolveInput {
  readonly attempt_id: string; readonly image_handle: string; readonly video_handle: string;
}
export interface OwnerKlingMotionControlImageResolution {
  readonly model_id: "kling_motion_control"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string; readonly image: Readonly<Omit<OwnerKlingMotionControlImageUploadReceipt, "status" | "expires_in_seconds">>;
  readonly expires_at: number; readonly epoch: number; readonly generation_permit: false;
}
export interface OwnerKlingMotionControlOwnPairResolution {
  readonly model_id: "kling_motion_control"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string; readonly image: OwnerKlingMotionControlImageResolution["image"];
  readonly video: Readonly<Omit<OwnerKlingMotionControlVideoUploadReceipt, "status" | "expires_in_seconds" | "metadata_confidence">>;
  readonly expires_at: number; readonly epoch: number; readonly generation_permit: false;
}
export type OwnerKlingMotionControlNativeImageConsumer<T> = (client: SyntxChatHttpClient, image: OwnerKlingMotionControlImageUploadContext) => T;
export type OwnerKlingMotionControlNativeOwnPairConsumer<T> = (
  client: SyntxChatHttpClient, pair: readonly [OwnerKlingMotionControlImageUploadContext, OwnerKlingMotionControlVideoUploadContext]
) => T;
export type OwnerKlingMotionControlReferenceErrorCode = "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH" | "PRINCIPAL_NOT_LINKED" |
  "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED" | "UPLOAD_REJECTED" |
  "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerKlingMotionControlReferenceServiceError extends Error {
  constructor(readonly code: OwnerKlingMotionControlReferenceErrorCode) {
    super("The owner Kling Motion Control reference could not be established safely."); this.name = "OwnerKlingMotionControlReferenceServiceError";
  }
}

interface BaseRecord {
  readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly client: SyntxChatHttpClient;
  readonly context: OwnerKlingMotionControlImageUploadContext | OwnerKlingMotionControlVideoUploadContext;
  readonly expiresAt: number; readonly epoch: number; readonly semanticKey: string;
}
interface ImageRecord extends BaseRecord { readonly kind: "image"; readonly handle: string; readonly context: OwnerKlingMotionControlImageUploadContext; readonly receipt: OwnerKlingMotionControlImageUploadReceipt; }
interface VideoRecord extends BaseRecord { readonly kind: "video"; readonly handle: string; readonly context: OwnerKlingMotionControlVideoUploadContext; readonly receipt: OwnerKlingMotionControlVideoUploadReceipt; }
interface Operation { readonly attemptId: string; readonly controller: AbortController; readonly done: Promise<void>; finish(): void; remove(): void; readonly epoch: number; }

/** Owner-bound MCV image/video upload handles and typed reference seams; no generation authority. */
export class OwnerKlingMotionControlReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #linkService: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown; readonly #probe: ReturnType<typeof createOwnerKlingMotionControlVideoProbe>;
  readonly #now: () => number; readonly #records = new Map<string, ImageRecord | VideoRecord>();
  readonly #known = new Map<string, string>(); readonly #pendingSemantics = new Set<string>();
  readonly #byAttempt = new Map<string, Set<string>>(); readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #clients = new Map<string, SyntxChatHttpClient>(); readonly #epochs = new Map<string, number>();
  readonly #pending = new Map<string, Set<Operation>>(); readonly #unknown = new Set<string>();
  readonly #invalidating = new Set<string>(); readonly #invalidations = new Map<string, Promise<void>>();
  #lastNow = -1; #closed = false; #pendingCount = 0; #closing: Promise<void> | undefined;

  constructor(input: OwnerKlingMotionControlReferenceServiceOptions | unknown) {
    const f = exactRecord(input, ["binding", "linkService", "resolveClient", "ffprobePath"], ["now"]);
    if (typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) || typeof f.ffprobePath !== "string" ||
      !isAbsolute(f.ffprobePath) || f.ffprobePath.includes("\0") || !isObject(f.linkService) || typeof dataMethod(f.linkService, "getStatus") !== "function" ||
      (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(f.binding); this.#linkService = f.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolveClient = f.resolveClient as (attemptId: string) => unknown;
    this.#probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath: f.ffprobePath });
    this.#now = f.now === undefined ? Date.now : f.now as () => number; Object.freeze(this);
  }

  async uploadImage(input: OwnerKlingMotionControlUploadInput | unknown, signal?: AbortSignal): Promise<OwnerKlingMotionControlImageUploadReceipt> {
    const request = snapshotUpload(input); const op = this.#begin(request.attemptId, signal); let validated: Readonly<ValidatedOwnerKlingMotionControlImage> | undefined;
    let key: string | undefined; let posted = false; let unknown = false; let claimed = false;
    try {
      validated = validateImage(request); this.#throw(op);
      const principal = await this.#principal(request.attemptId); this.#throw(op); this.#remember(request.attemptId, principal);
      const client = await this.#client(request.attemptId, op); key = semantic(principal, request.attemptId, "image", validated.sha256, validated.filename);
      const prior = this.#existing<ImageRecord>(key, "image"); if (prior) return prior.receipt;
      this.#claim(key); claimed = true; this.#checkCapacity();
      posted = true;
      const context = await Reflect.apply(NATIVE_IMAGE, client, [validated, op.controller.signal]) as OwnerKlingMotionControlImageUploadContext;
      this.#throw(op); const native = NATIVE_READER(client, context);
      if (!native) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const latest = await this.#principal(request.attemptId); const latestClient = await this.#client(request.attemptId, op);
      if (!sameGenerationPrincipal(principal, latest) || latestClient !== client) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const now = this.#time(); const recordId = `kling_motion_control_image_${randomUUID()}`; const expiresAt = now + TTL;
      const receipt = Object.freeze({ status: "uploaded" as const, image_handle: recordId, model_id: "kling_motion_control" as const,
        filename: validated.filename, mime_type: validated.mime_type, size: validated.size, sha256: validated.sha256,
        width: validated.width, height: validated.height, expires_in_seconds: 900, generation_permit: false as const });
      this.#store(Object.freeze({ kind: "image", handle: recordId, attemptId: request.attemptId, principal, client, context,
        receipt, expiresAt, epoch: op.epoch, semanticKey: key })); return receipt;
    } catch (error) { if (posted && !isRejected(error)) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); } throw mapError(error); }
    finally { if (validated) releaseValidatedOwnerKlingMotionControlImage(validated); if (key && claimed) this.#pendingSemantics.delete(key); if (key && unknown) this.#unknown.add(key); this.#finish(op); }
  }

  async uploadVideo(input: OwnerKlingMotionControlUploadInput | unknown, signal?: AbortSignal): Promise<OwnerKlingMotionControlVideoUploadReceipt> {
    const request = snapshotUpload(input); const op = this.#begin(request.attemptId, signal); let probe: Readonly<OwnerKlingMotionControlVideoProbeResult> | undefined;
    let key: string | undefined; let posted = false; let unknown = false; let claimed = false;
    try {
      const bytes = decodeBase64(request.content_base64, MAX_VIDEO_BASE64);
      try { probe = await this.#probe.probe({ filename: request.filename, mime_type: request.mime_type, bytes }, { signal: op.controller.signal }); }
      finally { bytes.fill(0); }
      this.#throw(op); const principal = await this.#principal(request.attemptId); this.#throw(op); this.#remember(request.attemptId, principal);
      const client = await this.#client(request.attemptId, op); key = semantic(principal, request.attemptId, "video", probe.source_sha256, probe.filename);
      const prior = this.#existing<VideoRecord>(key, "video"); if (prior) return prior.receipt;
      this.#claim(key); claimed = true; this.#checkCapacity(); posted = true;
      const context = await Reflect.apply(NATIVE_VIDEO, client, [probe, op.controller.signal]) as OwnerKlingMotionControlVideoUploadContext;
      this.#throw(op); if (!NATIVE_READER(client, context)) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const latest = await this.#principal(request.attemptId); const latestClient = await this.#client(request.attemptId, op);
      if (!sameGenerationPrincipal(principal, latest) || latestClient !== client) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const recordId = `kling_motion_control_video_${randomUUID()}`; const now = this.#time();
      const receipt = Object.freeze({ status: "uploaded" as const, video_handle: recordId, model_id: "kling_motion_control" as const,
        filename: probe.filename, mime_type: probe.mime_type, size: probe.bytes_copied, sha256: context.sha256,
        width: probe.metadata.width, height: probe.metadata.height, duration_seconds: probe.metadata.duration_seconds,
        expires_in_seconds: 900, metadata_confidence: probe.metadata_confidence, generation_permit: false as const });
      this.#store(Object.freeze({ kind: "video", handle: recordId, attemptId: request.attemptId, principal, client, context, receipt,
        expiresAt: now + TTL, epoch: op.epoch, semanticKey: key })); return receipt;
    } catch (error) { if (posted && !isRejected(error)) { unknown = true; this.#revokeAttempt(request.attemptId, op); fail("UPLOAD_OUTCOME_UNKNOWN"); } throw mapError(error); }
    finally { if (probe) releaseTrustedOwnerKlingMotionControlVideoProbeResult(probe); if (key && claimed) this.#pendingSemantics.delete(key); if (key && unknown) this.#unknown.add(key); this.#finish(op); }
  }

  async resolveImage(input: OwnerKlingMotionControlImageResolveInput | unknown, signal?: AbortSignal): Promise<OwnerKlingMotionControlImageResolution> {
    const request = imageInput(input); const op = this.#begin(request.attempt_id, signal);
    try {
      const principal = await this.#principal(request.attempt_id); this.#throw(op); this.#remember(request.attempt_id, principal);
      const record = this.#records.get(request.image_handle);
      if (!record || record.kind !== "image" || record.attemptId !== request.attempt_id) fail("REFERENCE_UNAVAILABLE");
      await this.#verifyRecords(request.attempt_id, principal, [record], op);
      const resolution = Object.freeze({ model_id: "kling_motion_control" as const, principal, attempt_id: request.attempt_id,
        image: safeImage(record), expires_at: record.expiresAt, epoch: op.epoch, generation_permit: false as const });
      IMAGE_RESOLUTIONS.set(resolution, { service: this, record }); return resolution;
    } catch (error) { throw mapError(error); } finally { this.#finish(op); }
  }
  isOwnedImageResolution(value: unknown, input: OwnerKlingMotionControlImageResolveInput | unknown): boolean {
    try { const f = imageInput(input); if (!isObject(value)) return false; const owned = IMAGE_RESOLUTIONS.get(value);
      return !!owned && owned.service === this && owned.record.attemptId === f.attempt_id && owned.record.handle === f.image_handle && this.#live(owned.record); }
    catch { return false; }
  }
  async resolveOwnPair(input: OwnerKlingMotionControlOwnPairResolveInput | unknown, signal?: AbortSignal): Promise<OwnerKlingMotionControlOwnPairResolution> {
    const request = pairInput(input); const op = this.#begin(request.attempt_id, signal);
    try {
      const principal = await this.#principal(request.attempt_id); this.#throw(op); this.#remember(request.attempt_id, principal);
      const image = this.#records.get(request.image_handle), video = this.#records.get(request.video_handle);
      if (!image || image.kind !== "image" || !video || video.kind !== "video" || image.attemptId !== request.attempt_id || video.attemptId !== request.attempt_id) fail("REFERENCE_UNAVAILABLE");
      await this.#verifyRecords(request.attempt_id, principal, [image, video], op);
      const resolution = Object.freeze({ model_id: "kling_motion_control" as const, principal, attempt_id: request.attempt_id,
        image: safeImage(image), video: safeVideo(video), expires_at: Math.min(image.expiresAt, video.expiresAt), epoch: op.epoch, generation_permit: false as const });
      PAIR_RESOLUTIONS.set(resolution, { service: this, image, video }); return resolution;
    } catch (error) { throw mapError(error); } finally { this.#finish(op); }
  }
  isOwnedOwnPairResolution(value: unknown, input: OwnerKlingMotionControlOwnPairResolveInput | unknown): boolean {
    try { const f = pairInput(input); if (!isObject(value)) return false; const owned = PAIR_RESOLUTIONS.get(value);
      return !!owned && owned.service === this && owned.image.attemptId === f.attempt_id && owned.image.handle === f.image_handle &&
        owned.video.handle === f.video_handle && this.#live(owned.image) && this.#live(owned.video); }
    catch { return false; }
  }
  withNativeImage<T>(value: unknown, input: OwnerKlingMotionControlImageResolveInput | unknown, consume: OwnerKlingMotionControlNativeImageConsumer<T>): T {
    const f = imageInput(input); if (typeof consume !== "function" || types.isProxy(consume) || !isObject(value)) fail("REFERENCE_UNAVAILABLE");
    const owned = IMAGE_RESOLUTIONS.get(value); if (!owned || owned.service !== this || owned.record.handle !== f.image_handle || owned.record.attemptId !== f.attempt_id) fail("REFERENCE_UNAVAILABLE");
    this.#assertCaptured([owned.record]); const result = consume(owned.record.client, owned.record.context); this.#assertCaptured([owned.record]); return result;
  }
  withNativeOwnPair<T>(value: unknown, input: OwnerKlingMotionControlOwnPairResolveInput | unknown, consume: OwnerKlingMotionControlNativeOwnPairConsumer<T>): T {
    const f = pairInput(input); if (typeof consume !== "function" || types.isProxy(consume) || !isObject(value)) fail("REFERENCE_UNAVAILABLE");
    const owned = PAIR_RESOLUTIONS.get(value); if (!owned || owned.service !== this || owned.image.handle !== f.image_handle || owned.video.handle !== f.video_handle || owned.image.attemptId !== f.attempt_id) fail("REFERENCE_UNAVAILABLE");
    this.#assertCaptured([owned.image, owned.video]); const contexts = Object.freeze([owned.image.context, owned.video.context]) as readonly [OwnerKlingMotionControlImageUploadContext, OwnerKlingMotionControlVideoUploadContext];
    const result = consume(owned.image.client, contexts); this.#assertCaptured([owned.image, owned.video]); return result;
  }

  invalidateAttempt(input: unknown): Promise<void> {
    if (typeof input !== "string" || !ATTEMPT.test(input)) return Promise.resolve();
    const attemptId = input; const previous = this.#invalidations.get(attemptId); if (previous) return previous;
    this.#revokeAttempt(attemptId);
    const ops = [...(this.#pending.get(attemptId) ?? [])]; for (const op of ops) op.controller.abort();
    const done = Promise.allSettled(ops.map((op) => op.done)).then(() => {
      this.#principals.delete(attemptId); this.#clients.delete(attemptId); this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId);
    });
    this.#invalidations.set(attemptId, done); return done;
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    const attempts = new Set([...this.#byAttempt.keys(), ...this.#pending.keys()]);
    this.#closing = Promise.allSettled([...attempts].map((id) => this.invalidateAttempt(id))).then(() => {
      this.#records.clear(); this.#byAttempt.clear(); this.#principals.clear(); this.#clients.clear(); this.#unknown.clear();
    }); return this.#closing;
  }
  #begin(attemptId: string, parent?: AbortSignal): Operation {
    if (this.#closed) fail("SERVICE_CLOSED"); if (this.#invalidating.has(attemptId) || this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController(); const onAbort = () => controller.abort(parent?.reason);
    if (parent?.aborted) onAbort(); else parent?.addEventListener("abort", onAbort, { once: true });
    let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); const op = { attemptId, controller, done, finish,
      remove: () => parent?.removeEventListener("abort", onAbort), epoch: this.#epochs.get(attemptId) ?? 0 };
    const set = this.#pending.get(attemptId) ?? new Set<Operation>(); set.add(op); this.#pending.set(attemptId, set); this.#pendingCount++; return op;
  }
  #finish(op: Operation): void {
    op.remove(); const pending = this.#pending.get(op.attemptId); pending?.delete(op); if (!pending?.size) this.#pending.delete(op.attemptId);
    this.#pendingCount--; op.finish();
    if (!pending?.size && this.#invalidating.has(op.attemptId) && !this.#invalidations.has(op.attemptId)) this.#invalidating.delete(op.attemptId);
  }
  #throw(op: Operation): void { if (this.#closed) fail("SERVICE_CLOSED"); if (op.controller.signal.aborted) fail("REQUEST_ABORTED"); if ((this.#epochs.get(op.attemptId) ?? 0) !== op.epoch) fail("REQUEST_ABORTED"); }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> {
    try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#linkService }); } catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); fail("PRINCIPAL_NOT_LINKED"); }
  }
  async #client(attemptId: string, operation?: Operation): Promise<SyntxChatHttpClient> {
    let value: unknown; try { value = await this.#resolveClient(attemptId); } catch { fail("PROFILE_BINDING_MISMATCH"); }
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
      Object.hasOwn(value, "uploadKlingMotionControlImage") || Object.hasOwn(value, "uploadKlingMotionControlVideo") ||
      SyntxChatHttpClient.prototype.uploadKlingMotionControlImage !== NATIVE_IMAGE || SyntxChatHttpClient.prototype.uploadKlingMotionControlVideo !== NATIVE_VIDEO) fail("PROFILE_BINDING_MISMATCH");
    const client = value as SyntxChatHttpClient; const old = this.#clients.get(attemptId);
    if (old && old !== client) { this.#revokeAttempt(attemptId, operation); fail("PROFILE_BINDING_MISMATCH"); }
    this.#clients.set(attemptId, client); return client;
  }
  #remember(attemptId: string, principal: Readonly<GenerationPrincipalRef>): void { const old = this.#principals.get(attemptId); if (old && !sameGenerationPrincipal(old, principal)) fail("PRINCIPAL_NOT_LINKED"); this.#principals.set(attemptId, principal); }
  #store(record: ImageRecord | VideoRecord): void {
    this.#records.set(record.handle, record); this.#known.set(record.semanticKey, record.handle); const set = this.#byAttempt.get(record.attemptId) ?? new Set<string>(); set.add(record.handle); this.#byAttempt.set(record.attemptId, set);
  }
  #checkCapacity(): void { if (this.#records.size + this.#unknown.size + this.#pendingSemantics.size > MAX_RECORDS) fail("CAPACITY_EXCEEDED"); }
  #existing<T extends ImageRecord | VideoRecord>(key: string, kind: T["kind"]): T | undefined {
    if (this.#unknown.has(key)) fail("UPLOAD_OUTCOME_UNKNOWN"); if (this.#pendingSemantics.has(key)) fail("SERVICE_BUSY");
    const record = this.#records.get(this.#known.get(key) ?? "");
    if (record && record.kind === kind && this.#live(record)) return record as T;
    if (record) { this.#records.delete(record.handle); this.#byAttempt.get(record.attemptId)?.delete(record.handle); this.#known.delete(key); }
    return undefined;
  }
  #claim(key: string): void { if (this.#unknown.has(key)) fail("UPLOAD_OUTCOME_UNKNOWN"); if (this.#pendingSemantics.has(key)) fail("SERVICE_BUSY"); this.#pendingSemantics.add(key); }
  #live(record: ImageRecord | VideoRecord): boolean { return !this.#closed && this.#records.get(record.handle) === record && record.expiresAt > this.#time() && record.epoch === (this.#epochs.get(record.attemptId) ?? 0); }
  #assertCaptured(records: readonly (ImageRecord | VideoRecord)[]): void {
    const first = records[0]; if (!first || !records.every((r) => this.#live(r) && r.client === first.client && sameGenerationPrincipal(r.principal, first.principal)) ||
      this.#clients.get(first.attemptId) !== first.client || !sameGenerationPrincipal(this.#principals.get(first.attemptId)!, first.principal) ||
      records.some((r) => !NATIVE_READER(first.client, r.context))) fail("REFERENCE_EXPIRED");
  }
  async #verifyRecords(attemptId: string, principal: Readonly<GenerationPrincipalRef>, records: readonly (ImageRecord | VideoRecord)[], op: Operation): Promise<void> {
    const client = await this.#client(attemptId, op); this.#throw(op);
    if (records.some((r) => !this.#live(r) || r.client !== client || !sameGenerationPrincipal(r.principal, principal) || !NATIVE_READER(client, r.context))) fail("REFERENCE_UNAVAILABLE");
    const latest = await this.#principal(attemptId); const latestClient = await this.#client(attemptId, op); this.#throw(op);
    if (!sameGenerationPrincipal(latest, principal) || latestClient !== client) { this.#revokeAttempt(attemptId, op); fail("PRINCIPAL_NOT_LINKED"); }
    this.#assertCaptured(records);
  }
  #remove(attemptId: string): void { for (const handle of this.#byAttempt.get(attemptId) ?? []) { const record = this.#records.get(handle); if (record) this.#known.delete(record.semanticKey); this.#records.delete(handle); } this.#byAttempt.delete(attemptId); }
  #revokeAttempt(attemptId: string, exclude?: Operation): void {
    if (!this.#invalidating.has(attemptId)) this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#invalidating.add(attemptId); this.#remove(attemptId); this.#principals.delete(attemptId); this.#clients.delete(attemptId);
    for (const op of this.#pending.get(attemptId) ?? []) if (op !== exclude) op.controller.abort();
  }
  #time(): number { const n = this.#now(); if (!Number.isSafeInteger(n) || n < 0 || n < this.#lastNow) fail("SERVICE_CLOSED"); this.#lastNow = n; return n; }
}

function validateImage(r: OwnerKlingMotionControlUploadInput): Readonly<ValidatedOwnerKlingMotionControlImage> {
  const bytes = decodeBase64(r.content_base64, MAX_IMAGE_BASE64);
  try { return validateOwnerKlingMotionControlImage({ filename: r.filename, mime_type: r.mime_type, bytes }); }
  catch { fail("INVALID_REQUEST"); } finally { bytes.fill(0); }
}
function decodeBase64(s: string, max: number): Buffer {
  if (!s || s.length > max || s.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(s)) fail("INVALID_REQUEST");
  const b = Buffer.from(s, "base64"); if (b.length === 0 || b.toString("base64") !== s) { b.fill(0); fail("INVALID_REQUEST"); } return b;
}
function snapshotUpload(v: unknown): OwnerKlingMotionControlUploadInput {
  const f = exactRecord(v, ["attemptId", "content_base64", "filename", "mime_type"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || typeof f.content_base64 !== "string" || typeof f.filename !== "string" || typeof f.mime_type !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: f.attemptId, content_base64: f.content_base64, filename: f.filename, mime_type: f.mime_type });
}
function imageInput(v: unknown): OwnerKlingMotionControlImageResolveInput { const f = exactRecord(v, ["attempt_id", "image_handle"]); if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.image_handle !== "string" || !IMAGE_HANDLE.test(f.image_handle)) fail("INVALID_REQUEST"); return f as unknown as OwnerKlingMotionControlImageResolveInput; }
function pairInput(v: unknown): OwnerKlingMotionControlOwnPairResolveInput { const f = exactRecord(v, ["attempt_id", "image_handle", "video_handle"]); if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || typeof f.image_handle !== "string" || !IMAGE_HANDLE.test(f.image_handle) || typeof f.video_handle !== "string" || !VIDEO_HANDLE.test(f.video_handle)) fail("INVALID_REQUEST"); return f as unknown as OwnerKlingMotionControlOwnPairResolveInput; }
function exactRecord(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isObject(v)) fail("INVALID_REQUEST"); const p = Object.getPrototypeOf(v); const d = Object.getOwnPropertyDescriptors(v); const keys = Reflect.ownKeys(d), allowed = [...required, ...optional];
  if ((p !== Object.prototype && p !== null) || required.some((k) => !Object.hasOwn(d, k)) || keys.some((k) => typeof k !== "string" || !allowed.includes(k) || !("value" in d[k]!) || d[k]!.enumerable !== true)) fail("INVALID_REQUEST");
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) out[k] = d[k]!.value; return out;
}
function snapshotBinding(v: unknown): Readonly<AuthBinding> { const f = exactRecord(v, ["tenant_id", "subject"]); if (typeof f.tenant_id !== "string" || !f.tenant_id || typeof f.subject !== "string" || !f.subject) fail("INVALID_REQUEST"); return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function isObject(v: unknown): v is object { return !!v && typeof v === "object" && !Array.isArray(v) && !types.isProxy(v); }
function dataMethod(o: object, k: string): unknown { let p: object | null = o; while (p) { const d = Object.getOwnPropertyDescriptor(p, k); if (d) return "value" in d ? d.value : undefined; p = Object.getPrototypeOf(p) as object | null; } return undefined; }
function semantic(p: Readonly<GenerationPrincipalRef>, a: string, kind: string, hash: string, name: string): string { return JSON.stringify([p.tenant_id, p.subject_id, p.connection_id, a, kind, hash, name]); }
function safeImage(r: ImageRecord): OwnerKlingMotionControlImageResolution["image"] { return Object.freeze({ image_handle: r.handle, model_id: r.receipt.model_id, filename: r.receipt.filename, mime_type: r.receipt.mime_type, size: r.receipt.size, sha256: r.receipt.sha256, width: r.receipt.width, height: r.receipt.height, generation_permit: false }); }
function safeVideo(r: VideoRecord): OwnerKlingMotionControlOwnPairResolution["video"] { return Object.freeze({ video_handle: r.handle, model_id: r.receipt.model_id, filename: r.receipt.filename, mime_type: r.receipt.mime_type, size: r.receipt.size, sha256: r.receipt.sha256, width: r.receipt.width, height: r.receipt.height, duration_seconds: r.receipt.duration_seconds, generation_permit: false }); }
function isRejected(e: unknown): boolean { return !!e && typeof e === "object" && "code" in e && ["INVALID_REQUEST", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED"].includes(String(e.code)); }
function mapError(e: unknown): unknown {
  if (e instanceof OwnerKlingMotionControlReferenceServiceError) return e;
  if (e instanceof OwnerReferencePrincipalError) return new OwnerKlingMotionControlReferenceServiceError("PRINCIPAL_NOT_LINKED");
  if (e instanceof OwnerKlingMotionControlImagePolicyError || e instanceof OwnerKlingMotionControlVideoProbeError) return new OwnerKlingMotionControlReferenceServiceError("INVALID_REQUEST");
  return new OwnerKlingMotionControlReferenceServiceError("REFERENCE_UNAVAILABLE");
}
function fail(c: OwnerKlingMotionControlReferenceErrorCode): never { throw new OwnerKlingMotionControlReferenceServiceError(c); }
