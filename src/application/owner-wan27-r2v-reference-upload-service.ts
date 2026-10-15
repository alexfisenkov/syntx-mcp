import { isAbsolute, basename } from "node:path";
import { types } from "node:util";
import { OwnerWan27R2vImagePolicyError, releaseValidatedOwnerWan27R2vImage, validateOwnerWan27R2vImage } from "./owner-wan27-r2v-image-policy.js";
import { createOwnerWan27R2vOriginalProbe, OwnerWan27R2vOriginalProbeError, releaseTrustedOwnerWan27R2vOriginalProbeResult } from "./owner-wan27-r2v-original-probe.js";
import { createOwnerWan27R2vVideoCropProcessor, OwnerWan27R2vVideoCropError, releaseTrustedOwnerWan27R2vVideoCropReceipt } from "./owner-wan27-r2v-video-crop.js";
import { validateOwnerWan27R2vVideoSelection, OwnerWan27R2vVideoSelectionError } from "./owner-wan27-r2v-video-selection.js";
import {
  isOwnerWan27R2vReferenceService, OwnerWan27R2vReferenceService, OwnerWan27R2vReferenceServiceError,
  type OwnerWan27R2vManifestDraft, type OwnerWan27R2vManifestReference, type OwnerWan27R2vReferenceManifest
} from "./owner-wan27-r2v-reference-service.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const MAX_PENDING = 4;
const OPERATION_TIMEOUT_MS = 60_000;
const SERVICES = new WeakSet<object>();
const REF_CREATE = OwnerWan27R2vReferenceService.prototype.createManifest;
const REF_DRAFT = OwnerWan27R2vReferenceService.prototype.getDraftManifest;
const REF_ADD_IMAGE = OwnerWan27R2vReferenceService.prototype.addImage;
const REF_ADD_VIDEO = OwnerWan27R2vReferenceService.prototype.addSelectedVideo;
const REF_FINALIZE = OwnerWan27R2vReferenceService.prototype.finalizeManifest;

export interface OwnerWan27R2vReferenceUploadServiceOptions {
  readonly referenceService: OwnerWan27R2vReferenceService;
  readonly ffprobePath: string;
  readonly ffmpegPath: string;
}
export interface OwnerWan27R2vReferenceUploadInput {
  readonly attemptId: string; readonly manifest_handle: string; readonly filename: string;
  readonly mime_type: string; readonly bytes: Uint8Array;
}
export interface OwnerWan27R2vReferenceVideoUploadInput extends OwnerWan27R2vReferenceUploadInput {
  readonly start_seconds: number; readonly end_seconds: number;
}
export type OwnerWan27R2vReferenceUploadResult = OwnerWan27R2vManifestReference;

export type OwnerWan27R2vReferenceUploadErrorCode =
  | "INVALID_REQUEST" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "SERVICE_CLOSED"
  | "MANIFEST_UNAVAILABLE" | "MANIFEST_EXPIRED" | "MANIFEST_INCOMPLETE" | "MANIFEST_VIDEO_COUNT_INVALID"
  | "PRINCIPAL_NOT_LINKED" | "CAPACITY_EXCEEDED" | "IMAGE_REJECTED" | "VIDEO_REJECTED"
  | "LOCAL_RESOURCE_LIMIT_EXCEEDED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE";

export class OwnerWan27R2vReferenceUploadServiceError extends Error {
  constructor(readonly code: OwnerWan27R2vReferenceUploadErrorCode) {
    super("The owner WAN 2.7 R2V reference upload is unavailable.");
    this.name = "OwnerWan27R2vReferenceUploadServiceError";
  }
}

interface PendingOperation {
  readonly attemptId: string;
  readonly controller: AbortController;
  readonly done: Promise<void>;
  readonly finish: () => void;
  readonly removeParentSignal: () => void;
  readonly timer: NodeJS.Timeout;
}

/** Bridges user-provided bytes to the existing owner-bound manifest and local media policy seams. */
export class OwnerWan27R2vReferenceUploadService {
  readonly #references: OwnerWan27R2vReferenceService;
  readonly #probe: ReturnType<typeof createOwnerWan27R2vOriginalProbe>;
  readonly #crop: ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>;
  readonly #pending = new Set<PendingOperation>();
  readonly #invalidating = new Set<string>();
  readonly #invalidations = new Map<string, Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerWan27R2vReferenceUploadServiceOptions | unknown) {
    const fields = exactRecord(options, ["referenceService", "ffprobePath", "ffmpegPath"]);
    if (!isOwnerWan27R2vReferenceService(fields.referenceService) || !sameReferenceApi() ||
        !trustedPath(fields.ffprobePath) || !trustedPath(fields.ffmpegPath)) fail("INVALID_REQUEST");
    this.#references = fields.referenceService;
    this.#probe = createOwnerWan27R2vOriginalProbe({ ffprobePath: fields.ffprobePath });
    this.#crop = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: fields.ffmpegPath, ffprobePath: fields.ffprobePath });
    SERVICES.add(this);
    Object.freeze(this);
  }

  async createManifest(input: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vManifestDraft> {
    const request = exactRecord(input, ["attemptId", "video_reference_count"]);
    assertAttempt(request.attemptId);
    return this.#run(request.attemptId, signal, (activeSignal) =>
      Reflect.apply(REF_CREATE, this.#references, [request, activeSignal]) as Promise<OwnerWan27R2vManifestDraft>);
  }

  async uploadImage(input: OwnerWan27R2vReferenceUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan27R2vReferenceUploadResult> {
    const request = exactRecord(input, ["attemptId", "manifest_handle", "filename", "mime_type", "bytes"]);
    assertUploadRequest(request);
    return this.#run(request.attemptId as string, signal, async (activeSignal) => {
      await this.#draft(request.attemptId as string, request.manifest_handle as string, activeSignal);
      let image: ReturnType<typeof validateOwnerWan27R2vImage> | undefined;
      try {
        try { image = validateOwnerWan27R2vImage({ filename: request.filename, mime_type: request.mime_type, bytes: request.bytes }); }
        catch (error) { return mapImageError(error); }
        this.#stopped(activeSignal);
        await this.#draft(request.attemptId as string, request.manifest_handle as string, activeSignal);
        return await Reflect.apply(REF_ADD_IMAGE, this.#references, [{ manifest_handle: request.manifest_handle, image }, activeSignal]) as OwnerWan27R2vReferenceUploadResult;
      } finally { if (image) releaseValidatedOwnerWan27R2vImage(image); }
    });
  }

  async uploadVideo(input: OwnerWan27R2vReferenceVideoUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan27R2vReferenceUploadResult> {
    const request = exactRecord(input, ["attemptId", "manifest_handle", "filename", "mime_type", "bytes", "start_seconds", "end_seconds"]);
    assertUploadRequest(request);
    if (typeof request.start_seconds !== "number" || typeof request.end_seconds !== "number") fail("INVALID_REQUEST");
    return this.#run(request.attemptId as string, signal, async (activeSignal) => {
      const draft = await this.#draft(request.attemptId as string, request.manifest_handle as string, activeSignal);
      if (draft.video_reference_count < 1) fail("MANIFEST_VIDEO_COUNT_INVALID");
      let original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> | undefined;
      let crop: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>> | undefined;
      try {
        try {
          original = await this.#probe.probe({ filename: request.filename, mime_type: request.mime_type, bytes: request.bytes }, { signal: activeSignal });
        } catch (error) { return mapProbeError(error); }
        this.#stopped(activeSignal);
        let selection;
        try {
          selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: request.start_seconds,
            end_seconds: request.end_seconds, video_reference_count: draft.video_reference_count });
        } catch (error) { return mapSelectionError(error); }
        try { crop = await this.#crop.crop(original, selection, { signal: activeSignal }); }
        catch (error) { return mapCropError(error); }
        this.#stopped(activeSignal);
        await this.#draft(request.attemptId as string, request.manifest_handle as string, activeSignal);
        return await Reflect.apply(REF_ADD_VIDEO, this.#references, [{ manifest_handle: request.manifest_handle, crop }, activeSignal]) as OwnerWan27R2vReferenceUploadResult;
      } finally {
        if (crop) releaseTrustedOwnerWan27R2vVideoCropReceipt(crop);
        if (original) releaseTrustedOwnerWan27R2vOriginalProbeResult(original);
      }
    });
  }

  async finalizeManifest(input: unknown, signal?: AbortSignal): Promise<OwnerWan27R2vReferenceManifest> {
    const request = exactRecord(input, ["attemptId", "manifest_handle"]);
    assertAttempt(request.attemptId);
    if (typeof request.manifest_handle !== "string") fail("INVALID_REQUEST");
    return this.#run(request.attemptId as string, signal, async (activeSignal) => {
      await this.#draft(request.attemptId as string, request.manifest_handle as string, activeSignal);
      return await Reflect.apply(REF_FINALIZE, this.#references, [{ manifest_handle: request.manifest_handle }, activeSignal]) as OwnerWan27R2vReferenceManifest;
    });
  }

  async invalidateAttempt(value: unknown): Promise<void> {
    if (typeof value !== "string" || !ATTEMPT.test(value)) return;
    const previous = this.#invalidations.get(value);
    if (previous) return previous;
    this.#invalidating.add(value);
    const pending = [...this.#pending].filter((operation) => operation.attemptId === value);
    for (const operation of pending) operation.controller.abort();
    const draining = Promise.allSettled(pending.map((operation) => operation.done)).then(() => {
      this.#invalidating.delete(value);
      this.#invalidations.delete(value);
    });
    this.#invalidations.set(value, draining);
    return draining;
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    const pending = [...this.#pending];
    for (const operation of pending) operation.controller.abort();
    this.#closing = Promise.allSettled([...pending.map((operation) => operation.done), ...this.#invalidations.values()]).then(() => { this.#invalidating.clear(); this.#invalidations.clear(); });
    return this.#closing;
  }

  async #draft(attemptId: string, manifestHandle: string, signal: AbortSignal): Promise<OwnerWan27R2vManifestDraft> {
    return await Reflect.apply(REF_DRAFT, this.#references, [{ attemptId, manifest_handle: manifestHandle }, signal]) as OwnerWan27R2vManifestDraft;
  }

  #run<T>(attemptId: string, parentSignal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen();
    if (this.#invalidating.has(attemptId)) fail("REQUEST_ABORTED");
    if (this.#pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort(); else parentSignal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = { attemptId, controller, done, finish,
      removeParentSignal: () => parentSignal?.removeEventListener("abort", abort),
      timer: setTimeout(() => controller.abort(new Error("deadline")), OPERATION_TIMEOUT_MS) };
    this.#pending.add(operation);
    return (async () => {
      try {
        this.#stopped(controller.signal);
        const result = await work(controller.signal);
        return result;
      } catch (error) {
        if (error instanceof OwnerWan27R2vReferenceServiceError) throw error;
        if (controller.signal.aborted) fail("REQUEST_ABORTED");
        throw error;
      } finally {
        clearTimeout(operation.timer); operation.removeParentSignal(); this.#pending.delete(operation); finish();
      }
    })();
  }

  #stopped(signal: AbortSignal): void {
    this.#assertOpen();
    if (signal.aborted) fail("REQUEST_ABORTED");
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

Object.freeze(OwnerWan27R2vReferenceUploadService.prototype);

export function isOwnerWan27R2vReferenceUploadService(value: unknown): value is OwnerWan27R2vReferenceUploadService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value);
}

function sameReferenceApi(): boolean {
  return OwnerWan27R2vReferenceService.prototype.createManifest === REF_CREATE &&
    OwnerWan27R2vReferenceService.prototype.getDraftManifest === REF_DRAFT &&
    OwnerWan27R2vReferenceService.prototype.addImage === REF_ADD_IMAGE &&
    OwnerWan27R2vReferenceService.prototype.addSelectedVideo === REF_ADD_VIDEO &&
    OwnerWan27R2vReferenceService.prototype.finalizeManifest === REF_FINALIZE;
}
function trustedPath(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value) && value === value.trim() && !value.includes("\0") && !!basename(value);
}
function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || actual.length !== keys.length || actual.some((key) =>
      typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of actual as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch (error) { if (error instanceof OwnerWan27R2vReferenceUploadServiceError) throw error; fail("INVALID_REQUEST"); }
}
function assertAttempt(value: unknown): asserts value is string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); }
function assertUploadRequest(request: Record<string, unknown>): void {
  assertAttempt(request.attemptId);
  if (typeof request.manifest_handle !== "string" || typeof request.filename !== "string" || typeof request.mime_type !== "string" ||
      types.isProxy(request.bytes) || !(request.bytes instanceof Uint8Array)) fail("INVALID_REQUEST");
}
function mapImageError(error: unknown): never {
  if (error instanceof OwnerWan27R2vImagePolicyError) fail(error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED" ? error.code : "IMAGE_REJECTED");
  fail("IMAGE_REJECTED");
}
function mapProbeError(error: unknown): never {
  if (error instanceof OwnerWan27R2vOriginalProbeError) fail(error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED" ? "LOCAL_RESOURCE_LIMIT_EXCEEDED" : error.code === "PROBE_ABORTED" ? "REQUEST_ABORTED" : "VIDEO_REJECTED");
  fail("VIDEO_REJECTED");
}
function mapSelectionError(error: unknown): never {
  if (error instanceof OwnerWan27R2vVideoSelectionError) fail("VIDEO_REJECTED");
  fail("VIDEO_REJECTED");
}
function mapCropError(error: unknown): never {
  if (error instanceof OwnerWan27R2vVideoCropError) fail(error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED" ? error.code : error.code === "CROP_ABORTED" ? "REQUEST_ABORTED" : "VIDEO_REJECTED");
  fail("VIDEO_REJECTED");
}
function fail(code: OwnerWan27R2vReferenceUploadErrorCode): never { throw new OwnerWan27R2vReferenceUploadServiceError(code); }
