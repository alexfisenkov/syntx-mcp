import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import type { OwnerIdeogramImageCatalogPort } from "./owner-ideogram-image-source-profile.js";
import { getOwnerIdeogramImageSourceProfile } from "./owner-ideogram-image-source-profile.js";
import type { OwnerIdeogramImageUploadService, OwnerIdeogramPrivateImageReferenceResolution } from "./owner-ideogram-image-upload-service.js";
import { OwnerIdeogramImageUploadService as UploadService } from "./owner-ideogram-image-upload-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import { encodeOwnerIdeogramPaintedMaskVariants } from "./owner-ideogram-painted-mask-codec.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^ideogram_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_PENDING = 4;
const MAX_RECORDS = 128;
const MAX_UNKNOWN_INTENTS = 128;
const UPLOAD_VARIANT_METHOD = SyntxChatHttpClient.prototype.uploadIdeogramPaintedMaskVariant;
const RESOLVE_IMAGE_METHOD = UploadService.prototype.resolveImageReference;

export interface OwnerIdeogramImageMaskUploadServiceOptions {
  readonly baseUploadService: OwnerIdeogramImageUploadService;
  readonly catalog: OwnerIdeogramImageCatalogPort;
  readonly catalog_version: string;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerIdeogramImageMaskUploadInput {
  readonly attemptId: string;
  readonly base_reference_handle: string;
  readonly painted_rgba_png_base64: string;
  readonly signal?: AbortSignal;
}
export interface OwnerIdeogramImageMaskUploadReceipt {
  readonly status: "uploaded";
  readonly mask_handle: string;
  readonly width: number;
  readonly height: number;
  readonly pair_sha256: `sha256:${string}`;
  readonly expires_in_seconds: number;
  readonly confidence_scope: "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE";
}
export interface OwnerIdeogramImageMaskResolveInput {
  readonly attemptId: string;
  readonly mask_handle: string;
  readonly base_reference_handle: string;
  readonly signal?: AbortSignal;
}
export interface OwnerIdeogramPrivateMaskResolution {
  readonly role: "mask";
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly model_id: "ideogram_45";
  readonly mode: "precise_edit";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly mask_handle: string;
  readonly base_reference_handle: string;
  readonly base_sha256: `sha256:${string}`;
  readonly base_width: number;
  readonly base_height: number;
  readonly width: number;
  readonly height: number;
  readonly pair_sha256: `sha256:${string}`;
  readonly normal_sha256: `sha256:${string}`;
  readonly inverse_sha256: `sha256:${string}`;
  readonly normal_url: string;
  readonly inverse_url: string;
  readonly primary_url: string;
  readonly expires_at: number;
  readonly epoch: number;
  readonly base_epoch: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly geometry_verified: false;
  readonly generation_permit: false;
}
export type OwnerIdeogramImageMaskUploadServiceErrorCode =
  | "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED"
  | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "BASE_REFERENCE_UNAVAILABLE"
  | "BASE_REFERENCE_EXPIRED" | "INVALID_PAINTED_MASK" | "LOCAL_RESOURCE_LIMIT_EXCEEDED"
  | "MASK_GEOMETRY_MISMATCH" | "MASK_HANDLE_UNAVAILABLE" | "MASK_HANDLE_EXPIRED"
  | "MASK_OUTCOME_UNKNOWN" | "REQUEST_ABORTED";

export class OwnerIdeogramImageMaskUploadServiceError extends Error {
  constructor(readonly code: OwnerIdeogramImageMaskUploadServiceErrorCode) {
    super("The owner Ideogram mask upload is unavailable.");
    this.name = "OwnerIdeogramImageMaskUploadServiceError";
  }
}

interface PrivateRecord {
  readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly catalogVersion: string; readonly profileSchemaHash: string; readonly baseHandle: string;
  readonly baseSha256: `sha256:${string}`; readonly baseWidth: number; readonly baseHeight: number;
  readonly width: number; readonly height: number; readonly pairSha256: `sha256:${string}`;
  readonly normalSha256: `sha256:${string}`; readonly inverseSha256: `sha256:${string}`;
  readonly normalUrl: string; readonly inverseUrl: string; readonly expiresAt: number;
  readonly epoch: number; readonly baseEpoch: number; readonly intentKey: string; readonly cacheKey: string;
}
interface PendingOperation {
  readonly controller: AbortController; readonly done: Promise<void>; readonly finish: () => void;
  readonly epoch: number; readonly removeParentAbort: () => void;
}

/** Local, process-only pair uploader. A mask handle is not a generation permit or provider-acceptance proof. */
export class OwnerIdeogramImageMaskUploadService {
  readonly #base: OwnerIdeogramImageUploadService;
  readonly #catalog: OwnerIdeogramImageCatalogPort;
  readonly #catalogVersion: string;
  readonly #resolveClient: OwnerIdeogramImageMaskUploadServiceOptions["resolveClient"];
  readonly #now: () => number;
  readonly #records = new Map<string, PrivateRecord>();
  readonly #cache = new Map<string, string>();
  readonly #epochs = new Map<string, number>();
  readonly #pendingByAttempt = new Map<string, Set<PendingOperation>>();
  readonly #allOperations = new Set<Promise<void>>();
  readonly #unknownIntents = new Set<string>();
  readonly #reservedIntents = new Set<string>();
  #pendingCount = 0;
  #reservedSlots = 0;
  #closed = false;
  #closing: Promise<void> | undefined;
  #lastNow: number | undefined;

  constructor(input: OwnerIdeogramImageMaskUploadServiceOptions | unknown) {
    const options = exactRecord(input, ["baseUploadService", "catalog", "catalog_version", "resolveClient"], ["now"]);
    if (!options.baseUploadService || types.isProxy(options.baseUploadService) ||
        Object.getPrototypeOf(options.baseUploadService) !== UploadService.prototype ||
        options.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || !isObject(options.catalog) ||
        typeof options.resolveClient !== "function" || types.isProxy(options.resolveClient) ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("MODEL_BINDING_MISMATCH");
    this.#base = options.baseUploadService as OwnerIdeogramImageUploadService;
    this.#catalog = options.catalog as OwnerIdeogramImageCatalogPort;
    this.#catalogVersion = options.catalog_version as string;
    this.#resolveClient = options.resolveClient as OwnerIdeogramImageMaskUploadServiceOptions["resolveClient"];
    this.#now = options.now === undefined ? Date.now : options.now as () => number;
    this.#readProfileHash();
  }

  async upload(input: OwnerIdeogramImageMaskUploadInput | unknown): Promise<OwnerIdeogramImageMaskUploadReceipt> {
    const request = snapshotUpload(input);
    this.#assertOpen();
    const operation = this.#begin(request.attemptId, request.signal);
    let variants: ReturnType<typeof encodeOwnerIdeogramPaintedMaskVariants> | undefined;
    let started = false;
    let reserved = false;
    let intentKey: string | undefined;
    try {
      const base = await this.#resolveBase(request.attemptId, request.base_reference_handle, operation.controller.signal);
      this.#assertCurrent(operation, request.attemptId, base);
      variants = encodeOwnerIdeogramPaintedMaskVariants(request.painted_rgba_png_base64);
      const normal = variants.source_inverted_mask_false;
      const inverse = variants.source_inverted_mask_true;
      if (normal.width !== base.width || normal.height !== base.height || inverse.width !== base.width || inverse.height !== base.height) fail("MASK_GEOMETRY_MISMATCH");
      const now = this.#readNow();
      if (base.expires_at <= now) fail("BASE_REFERENCE_EXPIRED");
      intentKey = hashTuple([base.principal.tenant_id, base.principal.subject_id, "ideogram_45", "precise_edit", base.sha256,
        hashPngBase64(request.painted_rgba_png_base64)]);
      if (this.#unknownIntents.has(intentKey)) fail("MASK_OUTCOME_UNKNOWN");
      this.#prune(now);
      const cacheKey = hashTuple([request.attemptId, request.base_reference_handle, base.sha256, normal.sha256, inverse.sha256]);
      const cachedHandle = this.#cache.get(cacheKey);
      if (cachedHandle) {
        const cached = this.#records.get(cachedHandle);
        if (cached && cached.expiresAt > now && cached.epoch === operation.epoch && cached.baseEpoch === base.epoch && sameGenerationPrincipal(cached.principal, base.principal)) {
          return receipt(cached, now);
        }
        this.#remove(cachedHandle);
      }
      if (this.#reservedIntents.has(intentKey)) fail("SERVICE_BUSY");
      if (this.#unknownIntents.size + this.#reservedSlots >= MAX_UNKNOWN_INTENTS ||
          this.#records.size + this.#reservedSlots >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#reservedIntents.add(intentKey); this.#reservedSlots += 1; reserved = true;
      const profileSchemaHash = this.#readProfileHash();
      const client = snapshotMaskClient(this.#resolveClient(request.attemptId));
      const expiresAt = Math.min(base.expires_at, now + TTL_MS);
      if (expiresAt <= now) fail("BASE_REFERENCE_EXPIRED");
      const epoch = operation.epoch;
      const normalBytes = Buffer.from(normal.bytes);
      const inverseBytes = Buffer.from(inverse.bytes);
      let normalReceipt: InternalUploadReference | undefined;
      let inverseReceipt: InternalUploadReference | undefined;
      try {
        this.#assertCurrent(operation, request.attemptId, await this.#resolveBase(request.attemptId, request.base_reference_handle, operation.controller.signal));
        started = true;
        normalReceipt = await Reflect.apply(client.method, client.client, [Object.freeze({ bytes: normalBytes, filename: "ideogram-mask-normal.png" }), operation.controller.signal]);
        this.#assertCurrent(operation, request.attemptId, await this.#resolveBase(request.attemptId, request.base_reference_handle, operation.controller.signal));
        inverseReceipt = await Reflect.apply(client.method, client.client, [Object.freeze({ bytes: inverseBytes, filename: "ideogram-mask-inverse.png" }), operation.controller.signal]);
        const current = await this.#resolveBase(request.attemptId, request.base_reference_handle, operation.controller.signal);
        this.#assertCurrent(operation, request.attemptId, current);
        if (this.#readProfileHash() !== profileSchemaHash || this.#readNow() >= expiresAt) fail("MODEL_BINDING_MISMATCH");
        const normalUrl = parseReference(normalReceipt);
        const inverseUrl = parseReference(inverseReceipt);
        if (normalUrl === inverseUrl) fail("MASK_OUTCOME_UNKNOWN");
        const handle = `ideogram_mask_${randomUUID()}`;
        const pairSha256 = hashTuple([normal.sha256, inverse.sha256]);
        const record: PrivateRecord = Object.freeze({ handle, attemptId: request.attemptId, principal: snapshotGenerationPrincipal(base.principal),
          catalogVersion: this.#catalogVersion, profileSchemaHash, baseHandle: request.base_reference_handle,
          baseSha256: base.sha256, baseWidth: base.width, baseHeight: base.height, width: normal.width, height: normal.height,
          pairSha256, normalSha256: normal.sha256, inverseSha256: inverse.sha256, normalUrl, inverseUrl, expiresAt,
          epoch, baseEpoch: base.epoch, intentKey, cacheKey });
        this.#records.set(handle, record);
        this.#cache.set(cacheKey, handle);
        this.#releaseReservation(intentKey); reserved = false;
        return receipt(record, this.#readNow());
      } catch (error) {
        if (started) {
          this.#unknownIntents.add(intentKey);
          this.#releaseReservation(intentKey); reserved = false;
          fail("MASK_OUTCOME_UNKNOWN");
        }
        if (error instanceof OwnerIdeogramImageMaskUploadServiceError) throw error;
        fail("BASE_REFERENCE_UNAVAILABLE");
      } finally {
        normalBytes.fill(0); inverseBytes.fill(0);
      }
    } catch (error) {
      if (error instanceof OwnerIdeogramImageMaskUploadServiceError) throw error;
      if (error && typeof error === "object" && "code" in error) {
        const code = String((error as { code: unknown }).code);
        if (code.includes("RESOURCE_LIMIT") || code.includes("LIMIT")) fail("LOCAL_RESOURCE_LIMIT_EXCEEDED");
      }
      return fail("INVALID_PAINTED_MASK");
    } finally {
      variants?.source_inverted_mask_false.bytes.fill(0);
      variants?.source_inverted_mask_true.bytes.fill(0);
      if (reserved && intentKey) this.#releaseReservation(intentKey);
      this.#finish(request.attemptId, operation);
    }
    return fail("INVALID_REQUEST");
  }

  async resolveMask(input: OwnerIdeogramImageMaskResolveInput | unknown): Promise<OwnerIdeogramPrivateMaskResolution> {
    const request = snapshotResolve(input);
    this.#assertOpen();
    const operation = this.#begin(request.attemptId, request.signal);
    try {
      const record = this.#records.get(request.mask_handle);
      if (!record || record.attemptId !== request.attemptId || record.baseHandle !== request.base_reference_handle) fail("MASK_HANDLE_UNAVAILABLE");
      const now = this.#readNow();
      if (record.expiresAt <= now) { this.#remove(record.handle); fail("MASK_HANDLE_EXPIRED"); }
      const base = await this.#resolveBase(request.attemptId, request.base_reference_handle, operation.controller.signal);
      this.#assertCurrent(operation, request.attemptId, base);
      if (record.epoch !== operation.epoch || record.baseEpoch !== base.epoch || !sameGenerationPrincipal(record.principal, base.principal) ||
          record.baseSha256 !== base.sha256 || record.baseWidth !== base.width || record.baseHeight !== base.height ||
          record.profileSchemaHash !== this.#readProfileHash() || record.catalogVersion !== this.#catalogVersion || record.expiresAt <= this.#readNow()) {
        this.#remove(record.handle); fail("MASK_HANDLE_UNAVAILABLE");
      }
      return Object.freeze({ role: "mask", principal: record.principal, attempt_id: record.attemptId, model_id: "ideogram_45",
        mode: "precise_edit", catalog_version: record.catalogVersion, profile_schema_hash: record.profileSchemaHash,
        mask_handle: record.handle, base_reference_handle: record.baseHandle, base_sha256: record.baseSha256,
        base_width: record.baseWidth, base_height: record.baseHeight, width: record.width, height: record.height,
        pair_sha256: record.pairSha256, normal_sha256: record.normalSha256, inverse_sha256: record.inverseSha256,
        normal_url: record.normalUrl, inverse_url: record.inverseUrl, primary_url: record.normalUrl,
        expires_at: record.expiresAt, epoch: record.epoch, base_epoch: record.baseEpoch,
        metadata_confidence: "CONTAINER_METADATA_ONLY", geometry_verified: false, generation_permit: false });
    } catch (error) {
      if (error instanceof OwnerIdeogramImageMaskUploadServiceError) throw error;
      fail("MASK_HANDLE_UNAVAILABLE");
    } finally { this.#finish(request.attemptId, operation); }
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (typeof attemptId !== "string" || !ATTEMPT.test(attemptId)) return;
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])];
    const hasRecords = [...this.#records.values()].some((record) => record.attemptId === attemptId);
    if (pending.length === 0 && !hasRecords) return;
    this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const record of [...this.#records.values()]) if (record.attemptId === attemptId) this.#remove(record.handle);
    for (const operation of pending) operation.controller.abort();
    await Promise.allSettled(pending.map((operation) => operation.done));
    this.#cleanupEpoch(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const [attemptId, pending] of this.#pendingByAttempt) {
      this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
      for (const operation of pending) operation.controller.abort();
    }
    this.#closing = Promise.allSettled([...this.#allOperations]).then(() => {
      this.#records.clear(); this.#cache.clear(); this.#epochs.clear(); this.#pendingByAttempt.clear();
      this.#unknownIntents.clear(); this.#allOperations.clear();
    });
    return this.#closing;
  }

  #resolveBase(attemptId: string, handle: string, signal: AbortSignal): Promise<OwnerIdeogramPrivateImageReferenceResolution> {
    if (signal.aborted) return Promise.reject(new OwnerIdeogramImageMaskUploadServiceError("REQUEST_ABORTED"));
    let remove = () => {};
    const read = Reflect.apply(RESOLVE_IMAGE_METHOD, this.#base, [{ attemptId, model_id: "ideogram_45", mode: "precise_edit", reference_handle: handle }]) as Promise<OwnerIdeogramPrivateImageReferenceResolution>;
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new OwnerIdeogramImageMaskUploadServiceError("REQUEST_ABORTED"));
      signal.addEventListener("abort", onAbort, { once: true }); remove = () => signal.removeEventListener("abort", onAbort);
    });
    return Promise.race([read, aborted]).catch((error: unknown) => {
      if (error instanceof OwnerIdeogramImageMaskUploadServiceError) throw error;
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      if (code === "REFERENCE_EXPIRED") fail("BASE_REFERENCE_EXPIRED");
      if (code === "PRINCIPAL_NOT_LINKED") fail("PRINCIPAL_NOT_LINKED");
      fail("BASE_REFERENCE_UNAVAILABLE");
    }).finally(remove);
  }

  #assertCurrent(operation: PendingOperation, attemptId: string, base: OwnerIdeogramPrivateImageReferenceResolution): void {
    this.#assertOpen();
    if (operation.controller.signal.aborted) fail("REQUEST_ABORTED");
    if ((this.#epochs.get(attemptId) ?? 0) !== operation.epoch) fail("REQUEST_ABORTED");
    if (base.role !== "ordinary_image_reference" || base.attempt_id !== attemptId || base.model_id !== "ideogram_45" ||
        base.mode !== "precise_edit" || base.generation_permit !== false || base.metadata_confidence !== "CONTAINER_METADATA_ONLY" ||
        !IMAGE_HANDLE.test(base.reference_handle) || !isSafeUploadReferenceUrl(base.file_url) ||
        !/^sha256:[a-f0-9]{64}$/u.test(base.sha256) || !Number.isSafeInteger(base.width) || !Number.isSafeInteger(base.height) ||
        base.width < 1 || base.height < 1 || base.expires_at <= this.#readNow() || base.catalog_version !== this.#catalogVersion ||
        base.profile_schema_hash !== this.#readProfileHash()) fail("BASE_REFERENCE_UNAVAILABLE");
  }

  #begin(attemptId: string, parent?: AbortSignal): PendingOperation {
    this.#assertOpen();
    if (this.#pendingCount >= MAX_PENDING) fail("SERVICE_BUSY");
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort(); else parent?.addEventListener("abort", abort, { once: true });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const operation: PendingOperation = { controller, done, finish, epoch: this.#epochs.get(attemptId) ?? 0,
      removeParentAbort: () => parent?.removeEventListener("abort", abort) };
    const set = this.#pendingByAttempt.get(attemptId) ?? new Set<PendingOperation>();
    set.add(operation); this.#pendingByAttempt.set(attemptId, set); this.#allOperations.add(done); this.#pendingCount += 1;
    return operation;
  }
  #finish(attemptId: string, operation: PendingOperation): void {
    operation.removeParentAbort(); const set = this.#pendingByAttempt.get(attemptId); set?.delete(operation);
    if (set?.size === 0) this.#pendingByAttempt.delete(attemptId);
    this.#pendingCount -= 1; this.#allOperations.delete(operation.done); operation.finish(); this.#cleanupEpoch(attemptId);
  }
  #readProfileHash(): string {
    try {
      const profile = getOwnerIdeogramImageSourceProfile("ideogram_45", "precise_edit", this.#catalog, this.#catalogVersion);
      if (profile.public_catalog_version !== this.#catalogVersion || !/^sha256:[a-f0-9]{64}$/u.test(profile.profile_schema_hash)) fail("MODEL_BINDING_MISMATCH");
      return profile.profile_schema_hash;
    } catch { return fail("MODEL_BINDING_MISMATCH"); }
  }
  #readNow(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.#lastNow !== undefined && value < this.#lastNow)) fail("SERVICE_CLOSED");
    this.#lastNow = value; return value;
  }
  #prune(now: number): void { for (const record of [...this.#records.values()]) if (record.expiresAt <= now) this.#remove(record.handle); }
  #remove(handle: string): void {
    const record = this.#records.get(handle); if (!record) return;
    this.#records.delete(handle); if (this.#cache.get(record.cacheKey) === handle) this.#cache.delete(record.cacheKey);
    this.#cleanupEpoch(record.attemptId);
  }
  #releaseReservation(intentKey: string): void { this.#reservedIntents.delete(intentKey); this.#reservedSlots -= 1; }
  #cleanupEpoch(attemptId: string): void {
    if (this.#pendingByAttempt.has(attemptId) || [...this.#records.values()].some((record) => record.attemptId === attemptId)) return;
    this.#epochs.delete(attemptId);
  }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
}

function snapshotUpload(value: unknown): Readonly<OwnerIdeogramImageMaskUploadInput> {
  const fields = exactRecord(value, ["attemptId", "base_reference_handle", "painted_rgba_png_base64"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.base_reference_handle !== "string" ||
      !IMAGE_HANDLE.test(fields.base_reference_handle) || typeof fields.painted_rgba_png_base64 !== "string") fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, base_reference_handle: fields.base_reference_handle,
    painted_rgba_png_base64: fields.painted_rgba_png_base64, ...(fields.signal === undefined ? {} : { signal: readSignal(fields.signal) }) });
}
function snapshotResolve(value: unknown): Readonly<OwnerIdeogramImageMaskResolveInput> {
  const fields = exactRecord(value, ["attemptId", "mask_handle", "base_reference_handle"], ["signal"]);
  if (typeof fields.attemptId !== "string" || !ATTEMPT.test(fields.attemptId) || typeof fields.mask_handle !== "string" || fields.mask_handle.length > 128 ||
      typeof fields.base_reference_handle !== "string" || !IMAGE_HANDLE.test(fields.base_reference_handle)) fail("INVALID_REQUEST");
  return Object.freeze({ attemptId: fields.attemptId, mask_handle: fields.mask_handle, base_reference_handle: fields.base_reference_handle,
    ...(fields.signal === undefined ? {} : { signal: readSignal(fields.signal) }) });
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) fail("INVALID_REQUEST");
    result[key] = descriptor.value;
  }
  return result;
}
function readSignal(value: unknown): AbortSignal {
  if (types.isProxy(value) || !(value instanceof AbortSignal)) fail("INVALID_REQUEST");
  return value;
}
function snapshotMaskClient(value: unknown): { readonly client: SyntxChatHttpClient; readonly method: SyntxChatHttpClient["uploadIdeogramPaintedMaskVariant"] } {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype) fail("MODEL_BINDING_MISMATCH");
  const descriptor = Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, "uploadIdeogramPaintedMaskVariant");
  if (!descriptor || !("value" in descriptor) || descriptor.value !== UPLOAD_VARIANT_METHOD) fail("MODEL_BINDING_MISMATCH");
  return { client: value as SyntxChatHttpClient, method: descriptor.value as SyntxChatHttpClient["uploadIdeogramPaintedMaskVariant"] };
}
function parseReference(value: unknown): string {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("MASK_OUTCOME_UNKNOWN");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some((key) => key !== "url" && key !== "file_id") || !fields.url || !("value" in fields.url) ||
      typeof fields.url.value !== "string" || !isSafeUploadReferenceUrl(fields.url.value) ||
      (fields.file_id !== undefined && !("value" in fields.file_id))) fail("MASK_OUTCOME_UNKNOWN");
  return fields.url.value;
}
function receipt(record: PrivateRecord, now: number): OwnerIdeogramImageMaskUploadReceipt {
  return Object.freeze({ status: "uploaded", mask_handle: record.handle, width: record.width, height: record.height,
    pair_sha256: record.pairSha256, expires_in_seconds: Math.max(0, Math.floor((record.expiresAt - now) / 1000)),
    confidence_scope: "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE" });
}
function hashTuple(parts: readonly string[]): `sha256:${string}` { return `sha256:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`; }
function hashPngBase64(value: string): `sha256:${string}` {
  const bytes = Buffer.from(value, "base64");
  try { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
  finally { bytes.fill(0); }
}
function isObject(value: unknown): value is object { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value); }
function fail(code: OwnerIdeogramImageMaskUploadServiceErrorCode): never { throw new OwnerIdeogramImageMaskUploadServiceError(code); }
