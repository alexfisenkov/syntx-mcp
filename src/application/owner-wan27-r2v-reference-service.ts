import { randomUUID, createHash } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import {
  readOwnerWan27R2vUploadReferenceForClient,
  type OwnerWan27R2vUploadContext
} from "../adapter/syntx/wan27-r2v-upload-context.js";
import type { ValidatedOwnerWan27R2vImage } from "./owner-wan27-r2v-image-policy.js";
import { readValidatedOwnerWan27R2vImage } from "./owner-wan27-r2v-image-policy.js";
import {
  copyTrustedOwnerWan27R2vVideoCropBytes,
  isTrustedOwnerWan27R2vVideoCropReceipt,
  type OwnerWan27R2vVideoCropReceipt
} from "./owner-wan27-r2v-video-crop.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MANIFEST_HANDLE = /^wan27ref_[A-Za-z0-9_-]{20,120}$/u;
const TTL_MS = 15 * 60_000;
const MAX_MANIFESTS = 128;
const MAX_PENDING = 4;
const NATIVE_IMAGE_UPLOAD = SyntxChatHttpClient.prototype.uploadWan27R2vImage;
const NATIVE_VIDEO_UPLOAD = SyntxChatHttpClient.prototype.uploadWan27R2vSelectedVideo;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const SERVICES = new WeakSet<object>();
const MANIFEST_RECEIPTS = new WeakMap<object, Readonly<{ service: OwnerWan27R2vReferenceService; record: ManifestRecord }>>();

export interface OwnerWan27R2vReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: PerUserLinkService;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerWan27R2vManifestDraftInput { readonly attemptId: string; readonly video_reference_count: number; }
export interface OwnerWan27R2vManifestDraft {
  readonly status: "draft";
  readonly manifest_handle: string;
  readonly video_reference_count: number;
  readonly expires_in_seconds: number;
  readonly generation_permit: false;
}
export interface OwnerWan27R2vAddImageInput { readonly manifest_handle: string; readonly image: ValidatedOwnerWan27R2vImage; }
export interface OwnerWan27R2vAddVideoInput { readonly manifest_handle: string; readonly crop: OwnerWan27R2vVideoCropReceipt; }
export interface OwnerWan27R2vManifestReference {
  readonly reference_handle: string;
  readonly media_type: "image" | "selected_video";
  readonly mime_type: OwnerWan27R2vUploadContext["mime_type"];
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly video_duration_seconds?: number;
  readonly source_sha256?: string;
}
export interface OwnerWan27R2vReferenceManifest {
  readonly status: "ready";
  readonly manifest_handle: string;
  readonly attempt_id: string;
  readonly video_reference_count: number;
  readonly total_reference_count: number;
  readonly references: readonly OwnerWan27R2vManifestReference[];
  readonly expires_at: number;
  readonly epoch: number;
  readonly generation_permit: false;
}
export type OwnerWan27R2vReferenceServiceErrorCode =
  | "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "SERVICE_CLOSED" | "MANIFEST_UNAVAILABLE" | "MANIFEST_EXPIRED" | "MANIFEST_INCOMPLETE"
  | "MANIFEST_VIDEO_COUNT_INVALID" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE";

export class OwnerWan27R2vReferenceServiceError extends Error {
  constructor(readonly code: OwnerWan27R2vReferenceServiceErrorCode) {
    super("The owner WAN 2.7 R2V reference manifest is unavailable.");
    this.name = "OwnerWan27R2vReferenceServiceError";
  }
}

interface ManifestItem {
  readonly metadata: OwnerWan27R2vManifestReference;
  readonly native: OwnerWan27R2vUploadContext;
}
interface ManifestRecord {
  readonly handle: string;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient;
  readonly videoReferenceCount: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly epoch: number;
  readonly items: ManifestItem[];
  busy: boolean;
  state: "draft" | "ready" | "unknown";
  receipt?: OwnerWan27R2vReferenceManifest;
}
interface PendingOperation {
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly remove: () => void;
  readonly epoch: number;
}

/** Process-local owner-bound WAN 2.7 R2V uploads and ordered reference manifests. */
export class OwnerWan27R2vReferenceService {
  readonly #binding: Readonly<AuthBinding>;
  readonly #links: PerUserLinkService;
  readonly #resolveClient: (attemptId: string) => unknown;
  readonly #now: () => number;
  readonly #manifests = new Map<string, ManifestRecord>();
  readonly #byAttempt = new Map<string, Set<string>>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #operations = new Set<Promise<void>>();
  readonly #pendingSemantics = new Set<string>();
  readonly #unknownSemantics = new Set<string>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #pendingCount = 0;
  #lastNow: number | undefined;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerWan27R2vReferenceServiceOptions | unknown) {
    const fields = exactRecord(options, ["binding", "linkService", "resolveClient"], ["now"]);
    if (!isLinkService(fields.linkService) || typeof fields.resolveClient !== "function" || types.isProxy(fields.resolveClient) ||
        (fields.now !== undefined && (typeof fields.now !== "function" || types.isProxy(fields.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(fields.binding);
    this.#links = fields.linkService as PerUserLinkService;
    this.#resolveClient = fields.resolveClient as (attemptId: string) => unknown;
    this.#now = fields.now === undefined ? Date.now : readClock(fields.now);
    SERVICES.add(this);
    Object.freeze(this);
  }

  async createManifest(input: OwnerWan27R2vManifestDraftInput | unknown, signal?: AbortSignal): Promise<OwnerWan27R2vManifestDraft> {
    this.#assertOpen();
    const request = exactRecord(input, ["attemptId", "video_reference_count"]);
    if (typeof request.attemptId !== "string" || !ATTEMPT.test(request.attemptId) || !Number.isSafeInteger(request.video_reference_count) ||
        (request.video_reference_count as number) < 0 || (request.video_reference_count as number) > 5) fail("INVALID_REQUEST");
    const attemptId = request.attemptId;
    const op = this.#begin(attemptId, signal);
    try {
      const principal = await this.#principal(attemptId, op.controller.signal); this.#stopped(op);
      if (!this.#remember(attemptId, principal)) fail("PRINCIPAL_NOT_LINKED");
      const client = nativeClient(this.#resolveClient(attemptId));
      const current = await this.#principal(attemptId, op.controller.signal); this.#stopped(op);
      if (!sameGenerationPrincipal(principal, current) || nativeClient(this.#resolveClient(attemptId)).client !== client.client) fail("PRINCIPAL_NOT_LINKED");
      this.#prune(this.#readNow());
      if (this.#manifests.size >= MAX_MANIFESTS) fail("CAPACITY_EXCEEDED");
      const createdAt = this.#readNow();
      if (createdAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const handle = `wan27ref_${randomUUID().replaceAll("-", "")}`;
      const record: ManifestRecord = {
        handle, attemptId, principal, client: client.client, videoReferenceCount: request.video_reference_count as number,
        createdAt, expiresAt: createdAt + TTL_MS, epoch: op.epoch, items: [], busy: false, state: "draft"
      };
      this.#manifests.set(handle, record);
      const set = this.#byAttempt.get(attemptId) ?? new Set<string>(); set.add(handle); this.#byAttempt.set(attemptId, set);
      return Object.freeze({ status: "draft", manifest_handle: handle, video_reference_count: record.videoReferenceCount,
        expires_in_seconds: 900, generation_permit: false });
    } catch (error) { return this.#mapError(error); }
    finally { this.#finish(attemptId, op); }
  }

  async addImage(input: OwnerWan27R2vAddImageInput | unknown, signal?: AbortSignal): Promise<OwnerWan27R2vManifestReference> {
    this.#assertOpen();
    const request = exactRecord(input, ["manifest_handle", "image"]);
    const record = this.#draft(request.manifest_handle);
    if (record.videoReferenceCount === 0 && record.items.filter((item) => item.native.media_type === "selected_video").length !== 0) fail("MANIFEST_VIDEO_COUNT_INVALID");
    this.#assertAppend(record, "image");
    return this.#upload(record, "image", request.image, signal);
  }

  async addSelectedVideo(input: OwnerWan27R2vAddVideoInput | unknown, signal?: AbortSignal): Promise<OwnerWan27R2vManifestReference> {
    this.#assertOpen();
    const request = exactRecord(input, ["manifest_handle", "crop"]);
    const record = this.#draft(request.manifest_handle);
    if (record.videoReferenceCount < 1 || record.items.filter((item) => item.native.media_type === "selected_video").length >= record.videoReferenceCount) {
      fail("MANIFEST_VIDEO_COUNT_INVALID");
    }
    this.#assertAppend(record, "selected_video");
    return this.#upload(record, "selected_video", request.crop, signal);
  }

  async finalizeManifest(input: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vReferenceManifest> {
    this.#assertOpen();
    const request = exactRecord(input, ["manifest_handle"]);
    const record = this.#draft(request.manifest_handle);
    this.#lock(record);
    let op: PendingOperation;
    try { op = this.#begin(record.attemptId, signal); }
    catch (error) { record.busy = false; throw error; }
    try {
      await this.#assertCurrentAsync(record, op);
      if (record.state !== "draft" || record.items.length < 1 || record.items.length > 5) fail("MANIFEST_INCOMPLETE");
      const videoCount = record.items.filter((item) => item.native.media_type === "selected_video").length;
      if (videoCount !== record.videoReferenceCount || record.items.length < videoCount) fail("MANIFEST_INCOMPLETE");
      if (record.expiresAt - this.#readNow() < 1_000) fail("MANIFEST_EXPIRED");
      const receipt: OwnerWan27R2vReferenceManifest = Object.freeze({ status: "ready", manifest_handle: record.handle,
        attempt_id: record.attemptId, video_reference_count: videoCount, total_reference_count: record.items.length,
        references: Object.freeze(record.items.map((item) => item.metadata)), expires_at: record.expiresAt,
        epoch: record.epoch, generation_permit: false });
      record.state = "ready"; record.receipt = receipt;
      MANIFEST_RECEIPTS.set(receipt, Object.freeze({ service: this, record }));
      return receipt;
    } catch (error) { return this.#mapError(error); }
    finally { record.busy = false; this.#finish(record.attemptId, op); }
  }

  isOwnedManifest(value: unknown): value is OwnerWan27R2vReferenceManifest {
    try {
      this.#assertOpen();
      if (!value || typeof value !== "object" || types.isProxy(value)) return false;
      const owned = MANIFEST_RECEIPTS.get(value);
      return !!owned && owned.service === this && owned.record.receipt === value && owned.record.state === "ready" &&
        this.#manifests.get(owned.record.handle) === owned.record && owned.record.expiresAt > this.#readNow() &&
        owned.record.epoch === (this.#epochs.get(owned.record.attemptId) ?? 0) && !this.#invalidating.has(owned.record.attemptId);
    } catch { return false; }
  }

  async withCapturedNativeReferences<T>(
    manifest: unknown,
    consume: (client: SyntxChatHttpClient, contexts: readonly OwnerWan27R2vUploadContext[]) => T | Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    this.#assertOpen();
    if (typeof consume !== "function" || types.isProxy(consume)) fail("INVALID_REQUEST");
    const owned = manifest && typeof manifest === "object" && !types.isProxy(manifest) ? MANIFEST_RECEIPTS.get(manifest) : undefined;
    if (!owned || owned.service !== this || !this.isOwnedManifest(manifest)) fail("REFERENCE_UNAVAILABLE");
    const record = owned.record;
    let op: PendingOperation;
    try { op = this.#begin(record.attemptId, signal); }
    catch (error) { record.busy = false; throw error; }
    try {
      await this.#assertCurrentAsync(record, op);
      const contexts = Object.freeze(record.items.map((item) => {
        if (!readOwnerWan27R2vUploadReferenceForClient(record.client, item.native)) fail("REFERENCE_UNAVAILABLE");
        return item.native;
      }));
      const result = await consume(record.client, contexts);
      await this.#assertCurrentAsync(record, op);
      if (!this.isOwnedManifest(manifest)) fail("MANIFEST_EXPIRED");
      return result;
    } catch (error) { return this.#mapError(error); }
    finally { this.#finish(record.attemptId, op); }
  }

  invalidateAttempt(value: unknown): Promise<void> {
    return typeof value === "string" && ATTEMPT.test(value) ? this.#invalidate(value) : Promise.resolve();
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const invalidations = [...this.#activeAttempts()].map((id) => this.#invalidate(id));
    const pending = [...this.#operations];
    this.#closing = Promise.allSettled([...invalidations, ...pending]).then(() => {
      this.#manifests.clear(); this.#byAttempt.clear(); this.#principals.clear(); this.#epochs.clear();
      this.#pendingSemantics.clear(); this.#unknownSemantics.clear(); this.#invalidating.clear();
    });
    return this.#closing;
  }

  #upload(record: ManifestRecord, kind: "image" | "selected_video", receipt: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vManifestReference> {
    this.#lock(record);
    let semantic: string | undefined;
    let invoked = false;
    let unknown = false;
    let copy: Uint8Array | undefined;
    let op: PendingOperation;
    try { op = this.#begin(record.attemptId, signal); }
    catch (error) { record.busy = false; throw error; }
    const initialState = () => {
      if (kind === "image") {
        const image = readValidatedOwnerWan27R2vImage(receipt);
        if (!image) fail("INVALID_REQUEST");
        copy = image.bytes;
        return { size: image.size, sha256: image.sha256, mime: image.mime_type, width: image.width, height: image.height,
          duration: undefined, sourceSha: undefined };
      }
      if (!isTrustedOwnerWan27R2vVideoCropReceipt(receipt)) fail("INVALID_REQUEST");
      try { copy = copyTrustedOwnerWan27R2vVideoCropBytes(receipt); } catch { fail("INVALID_REQUEST"); }
      const crop = receipt as OwnerWan27R2vVideoCropReceipt;
      if (crop.model_id !== "wan_27_r2v" || crop.mime_type !== "video/mp4" || crop.bytes !== copy!.byteLength ||
          crop.bytes < 1 || !/^[a-f0-9]{64}$/u.test(crop.crop_sha256) || createHash("sha256").update(copy!).digest("hex") !== crop.crop_sha256 ||
          crop.selection_policy_id !== "OWNER_WAN27_R2V_SELECTED_VIDEO_FRAME_POLICY_V1" || crop.generation_permit !== false ||
          crop.owner_upload_binding !== "NOT_ESTABLISHED" || !Number.isFinite(crop.metadata.video_duration_seconds) ||
          crop.metadata.video_duration_seconds <= 0 || crop.metadata.video_duration_seconds > 5 / record.videoReferenceCount + 0.000001) {
        fail("MANIFEST_VIDEO_COUNT_INVALID");
      }
      return { size: crop.bytes, sha256: crop.crop_sha256, mime: crop.mime_type, width: crop.metadata.width,
        height: crop.metadata.height, duration: crop.metadata.video_duration_seconds, sourceSha: crop.source_sha256 };
    };

    return (async () => {
      try {
        const meta = initialState();
        if (record.state !== "draft" || record.expiresAt <= this.#readNow()) fail("MANIFEST_EXPIRED");
        if (record.items.length >= 5) fail("CAPACITY_EXCEEDED");
        if (kind === "selected_video" && record.items.filter((item) => item.native.media_type === "selected_video").length >= record.videoReferenceCount) {
          fail("MANIFEST_VIDEO_COUNT_INVALID");
        }
        if (kind === "image" && record.items.filter((item) => item.native.media_type === "image").length + record.videoReferenceCount >= 5) {
          fail("CAPACITY_EXCEEDED");
        }
        if (kind === "selected_video") {
          const currentTotal = record.items.reduce((total, item) => total + (item.metadata.video_duration_seconds ?? 0), 0);
          if (currentTotal + meta.duration! > 5 + 0.000001) fail("MANIFEST_VIDEO_COUNT_INVALID");
        }
        const semanticKey = JSON.stringify([record.principal.tenant_id, record.principal.subject_id, kind, meta.sha256, meta.size, meta.mime]);
        semantic = semanticKey;
        if (this.#unknownSemantics.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
        if (this.#pendingSemantics.has(semanticKey)) fail("SERVICE_BUSY");
        if (this.#unknownSemantics.size + this.#pendingSemantics.size + this.#manifests.size >= MAX_MANIFESTS) fail("CAPACITY_EXCEEDED");
        this.#pendingSemantics.add(semanticKey);
        await this.#assertCurrentAsync(record, op);
        const started = this.#readNow();
        if (record.expiresAt - started < 1_000) fail("MANIFEST_EXPIRED");
        invoked = true;
        const native = kind === "image"
          ? await Reflect.apply(NATIVE_IMAGE_UPLOAD, record.client, [receipt, op.controller.signal]) as OwnerWan27R2vUploadContext
          : await Reflect.apply(NATIVE_VIDEO_UPLOAD, record.client, [receipt, op.controller.signal]) as OwnerWan27R2vUploadContext;
        this.#stopped(op);
        const privateReference = readOwnerWan27R2vUploadReferenceForClient(record.client, native);
        if (!privateReference || native.status !== "uploaded" || native.model_id !== "wan_27_r2v" || native.media_type !== kind ||
            native.mime_type !== meta.mime || native.size !== meta.size || native.sha256 !== meta.sha256 || native.width !== meta.width ||
            native.height !== meta.height || (kind === "selected_video" &&
              ((native as Extract<OwnerWan27R2vUploadContext, { media_type: "selected_video" }>).video_duration_seconds !== meta.duration ||
                (native as Extract<OwnerWan27R2vUploadContext, { media_type: "selected_video" }>).source_sha256 !== meta.sourceSha))) {
          unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN");
        }
        await this.#assertCurrentAsync(record, op, true);
        const acknowledged = this.#readNow();
        if (record.expiresAt - acknowledged < 1_000) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        const item: OwnerWan27R2vManifestReference = Object.freeze({ reference_handle: `wan27item_${randomUUID().replaceAll("-", "")}`,
          media_type: kind, mime_type: meta.mime, size: meta.size, sha256: meta.sha256, width: meta.width, height: meta.height,
          ...(meta.duration === undefined ? {} : { video_duration_seconds: meta.duration }),
          ...(meta.sourceSha === undefined ? {} : { source_sha256: meta.sourceSha }) });
        record.items.push(Object.freeze({ metadata: item, native }));
        return item;
      } catch (error) {
        if (error instanceof OwnerWan27R2vReferenceServiceError) {
          if (invoked && error.code !== "UPLOAD_REJECTED" && error.code !== "UPLOAD_OUTCOME_UNKNOWN") { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
          unknown ||= error.code === "UPLOAD_OUTCOME_UNKNOWN" && invoked;
          throw error;
        }
        if (error instanceof OwnerReferencePrincipalError) {
          if (invoked) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
          fail("PRINCIPAL_NOT_LINKED");
        }
        if (error instanceof SyntxHttpError && ["INVALID_REQUEST", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED"].includes(error.code)) {
          fail("UPLOAD_REJECTED");
        }
        if (invoked) { unknown = true; fail("UPLOAD_OUTCOME_UNKNOWN"); }
        return this.#mapError(error);
      } finally {
        if (semantic) {
          if (unknown) this.#unknownSemantics.add(semantic);
          this.#pendingSemantics.delete(semantic);
        }
        copy?.fill(0);
        record.busy = false;
        this.#finish(record.attemptId, op);
      }
    })();
  }

  #assertAppend(record: ManifestRecord, kind: "image" | "selected_video"): void {
    if (record.state !== "draft") fail("MANIFEST_UNAVAILABLE");
    if (record.items.length >= 5) fail("CAPACITY_EXCEEDED");
    const images = record.items.filter((item) => item.native.media_type === "image").length;
    const videos = record.items.length - images;
    if (kind === "image" && images + videos >= 5) fail("CAPACITY_EXCEEDED");
    if (kind === "selected_video" && (record.videoReferenceCount < 1 || videos >= record.videoReferenceCount)) fail("MANIFEST_VIDEO_COUNT_INVALID");
    if (kind === "image" && images + record.videoReferenceCount >= 5) fail("CAPACITY_EXCEEDED");
  }

  #draft(handleInput: unknown): ManifestRecord {
    if (typeof handleInput !== "string" || !MANIFEST_HANDLE.test(handleInput)) fail("MANIFEST_UNAVAILABLE");
    const record = this.#manifests.get(handleInput);
    if (!record || record.state !== "draft") fail("MANIFEST_UNAVAILABLE");
    if (record.expiresAt <= this.#readNow()) { this.#remove(handleInput); fail("MANIFEST_EXPIRED"); }
    if (record.epoch !== (this.#epochs.get(record.attemptId) ?? 0) || this.#invalidating.has(record.attemptId)) fail("MANIFEST_UNAVAILABLE");
    return record;
  }

  #lock(record: ManifestRecord): void {
    if (record.busy) fail("SERVICE_BUSY");
    record.busy = true;
  }

  async #assertCurrentAsync(record: ManifestRecord, op: PendingOperation, unknownOnFailure = false): Promise<void> {
    this.#assertCurrentLocal(record, op, unknownOnFailure);
    try {
      const principal = await this.#principal(record.attemptId, op.controller.signal);
      this.#stopped(op);
      if (!sameGenerationPrincipal(record.principal, principal) || nativeClient(this.#resolveClient(record.attemptId)).client !== record.client) {
        if (unknownOnFailure) fail("UPLOAD_OUTCOME_UNKNOWN");
        fail("PRINCIPAL_NOT_LINKED");
      }
      this.#assertCurrentLocal(record, op, unknownOnFailure);
    } catch (error) {
      if (unknownOnFailure) fail("UPLOAD_OUTCOME_UNKNOWN");
      throw error;
    }
  }

  #assertCurrentLocal(record: ManifestRecord, op: PendingOperation, unknownOnFailure = false): void {
    this.#stopped(op);
    if (record.epoch !== (this.#epochs.get(record.attemptId) ?? 0) || this.#invalidating.has(record.attemptId) ||
        this.#manifests.get(record.handle) !== record || record.expiresAt <= this.#readNow()) {
      if (unknownOnFailure) fail("UPLOAD_OUTCOME_UNKNOWN");
      fail("MANIFEST_EXPIRED");
    }
    if (!sameGenerationPrincipal(record.principal, this.#principals.get(record.attemptId) ?? record.principal)) fail("PRINCIPAL_NOT_LINKED");
    if (nativeClient(this.#resolveClient(record.attemptId)).client !== record.client) {
      if (unknownOnFailure) fail("UPLOAD_OUTCOME_UNKNOWN");
      fail("PRINCIPAL_NOT_LINKED");
    }
  }

  async #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const lookup = resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links });
    if (!signal) return lookup;
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerWan27R2vReferenceServiceError("REQUEST_ABORTED"));
      if (signal.aborted) onAbort();
      else { signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort); }
    });
    return Promise.race([lookup, aborted]).finally(remove);
  }

  #remember(attemptId: string, principal: Readonly<GenerationPrincipalRef>): boolean {
    const old = this.#principals.get(attemptId);
    if (old && !sameGenerationPrincipal(old, principal)) return false;
    this.#principals.set(attemptId, principal); return true;
  }

  #begin(attemptId: string, parent?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    this.#readNow();
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    if (!this.#activeAttempts().has(attemptId) && this.#activeAttempts().size >= MAX_MANIFESTS) fail("CAPACITY_EXCEEDED");
    const controller = new AbortController(), abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const set = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    const op: PendingOperation = { controller, done, finish, remove: () => parent?.removeEventListener("abort", abort), epoch: this.#epochs.get(attemptId) ?? 0 };
    set.add(op); this.#pendingByAttempt.set(attemptId, set); this.#operations.add(done); this.#pendingCount++;
    return op;
  }

  #finish(attemptId: string, op: PendingOperation): void {
    op.remove(); const set = this.#pendingByAttempt.get(attemptId); set?.delete(op); if (!set?.size) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount--; op.finish(); this.#operations.delete(op.done); this.#maybeRelease(attemptId);
  }

  #stopped(op: PendingOperation): void { this.#assertOpen(); if (op.controller.signal.aborted) fail("REQUEST_ABORTED"); }
  #activeAttempts(): Set<string> { return new Set([...this.#byAttempt.keys(), ...this.#principals.keys(), ...this.#pendingByAttempt.keys()]); }
  #invalidate(attemptId: string): Promise<void> {
    const old = this.#invalidations.get(attemptId); if (old) return old;
    this.#invalidating.add(attemptId); this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    this.#removeAttempt(attemptId); this.#principals.delete(attemptId);
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    for (const op of pending) op.controller.abort();
    const done = Promise.allSettled([...pending].map((op) => op.done)).then(() => {
      this.#invalidating.delete(attemptId); this.#invalidations.delete(attemptId); this.#maybeRelease(attemptId);
    });
    this.#invalidations.set(attemptId, done); return done;
  }
  #removeAttempt(attemptId: string): void {
    for (const handle of this.#byAttempt.get(attemptId) ?? []) this.#remove(handle);
    this.#byAttempt.delete(attemptId);
  }
  #remove(handle: string): void {
    const record = this.#manifests.get(handle); if (!record) return;
    this.#manifests.delete(handle); const set = this.#byAttempt.get(record.attemptId); set?.delete(handle); if (!set?.size) this.#byAttempt.delete(record.attemptId);
    this.#maybeRelease(record.attemptId);
  }
  #prune(now: number): void {
    for (const [handle, record] of this.#manifests) if (record.expiresAt <= now && !record.busy) this.#remove(handle);
    for (const attemptId of this.#epochs.keys()) if (!this.#activeAttempts().has(attemptId)) this.#epochs.delete(attemptId);
  }
  #maybeRelease(attemptId: string): void {
    if (this.#byAttempt.has(attemptId) || this.#pendingByAttempt.has(attemptId) || this.#invalidating.has(attemptId)) return;
    this.#epochs.delete(attemptId); this.#principals.delete(attemptId);
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #readNow(): number {
    let value: unknown; try { value = this.#now(); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0 || (this.#lastNow !== undefined && (value as number) < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value as number; return value as number;
  }
  #mapError(error: unknown): never {
    if (error instanceof OwnerWan27R2vReferenceServiceError) throw error;
    if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
    fail("REFERENCE_UNAVAILABLE");
  }
}

export function isOwnerWan27R2vReferenceService(value: unknown): value is OwnerWan27R2vReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value);
}

function nativeClient(value: unknown): Readonly<{ client: SyntxChatHttpClient }> {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(value, "uploadWan27R2vImage") || Object.hasOwn(value, "uploadWan27R2vSelectedVideo") ||
        SyntxChatHttpClient.prototype.uploadWan27R2vImage !== NATIVE_IMAGE_UPLOAD ||
        SyntxChatHttpClient.prototype.uploadWan27R2vSelectedVideo !== NATIVE_VIDEO_UPLOAD ||
        Reflect.get(value, "uploadWan27R2vImage") !== NATIVE_IMAGE_UPLOAD || Reflect.get(value, "uploadWan27R2vSelectedVideo") !== NATIVE_VIDEO_UPLOAD) fail("INVALID_REQUEST");
    return Object.freeze({ client: value as SyntxChatHttpClient });
  } catch { fail("INVALID_REQUEST"); }
}

function isLinkService(value: unknown): value is PerUserLinkService {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== PerUserLinkService.prototype ||
        PerUserLinkService.prototype.getStatus !== NATIVE_LINK_STATUS || Object.hasOwn(value, "getStatus")) return false;
    const descriptor = Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus");
    return !!descriptor && "value" in descriptor && descriptor.value === NATIVE_LINK_STATUS;
  } catch { return false; }
}
function snapshotBinding(input: unknown): Readonly<AuthBinding> {
  const fields = exactRecord(input, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || !fields.tenant_id || fields.tenant_id.length > 256 ||
      typeof fields.subject !== "string" || !fields.subject || fields.subject.length > 512) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}
function readClock(input: unknown): () => number {
  if (typeof input !== "function" || types.isProxy(input)) fail("INVALID_REQUEST");
  return () => { let value: unknown; try { value = Reflect.apply(input, undefined, []); } catch { fail("SERVICE_CLOSED"); }
    if (!Number.isSafeInteger(value) || (value as number) < 0) fail("SERVICE_CLOSED"); return value as number; };
}
function exactRecord(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail("INVALID_REQUEST");
  let prototype: object | null, descriptors: PropertyDescriptorMap;
  try { prototype = Object.getPrototypeOf(input); descriptors = Object.getOwnPropertyDescriptors(input); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function fail(code: OwnerWan27R2vReferenceServiceErrorCode): never { throw new OwnerWan27R2vReferenceServiceError(code); }
