import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readOwnerWan25I2vUploadReferenceForClient, type OwnerWan25I2vImageUploadContext } from "../adapter/syntx/wan25-i2v-upload-context.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { releaseValidatedOwnerWan25I2vPreviewImage, validateOwnerWan25I2vPreviewImage, OwnerWan25I2vPreviewImagePolicyError,
  type ValidatedOwnerWan25I2vPreviewImage } from "./owner-wan25-i2v-image-policy.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^wan25image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4;
const NATIVE_LINK_STATUS = PerUserLinkService.prototype.getStatus;
const RESOLUTIONS = new WeakMap<object, ResolutionState>();
const SERVICES = new WeakSet<object>();

export interface OwnerWan25I2vReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly now?: () => number;
}
export interface OwnerWan25I2vImageUploadInput {
  readonly attemptId: string; readonly model_id: typeof MODEL_ID; readonly content_base64: string;
  readonly filename: string; readonly mime_type: string;
}
export interface OwnerWan25I2vImageUploadReceipt {
  readonly status: "uploaded"; readonly model_id: typeof MODEL_ID; readonly image_handle: string;
  readonly filename: string; readonly mime_type: string; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly expires_in_seconds: 900; readonly generation_permit: false;
}
export interface OwnerWan25I2vReferenceResolveInput {
  readonly attempt_id: string; readonly model_id: typeof MODEL_ID; readonly image_handle: string; readonly audio_handle: null;
}
export interface OwnerWan25I2vReferenceResolution {
  readonly model_id: typeof MODEL_ID; readonly principal: Readonly<GenerationPrincipalRef>; readonly attempt_id: string;
  readonly image: Readonly<Omit<OwnerWan25I2vImageUploadReceipt, "status" | "image_handle" | "expires_in_seconds"> & { image_handle: string }>;
  readonly audio: null; readonly audio_integration_status: "NATIVE_AUDIO_CONTEXT_NOT_AVAILABLE";
  readonly expires_at: number; readonly epoch: number; readonly generation_permit: false;
}
export type OwnerWan25I2vNativeReferenceTuple = readonly [OwnerWan25I2vImageUploadContext];
export type OwnerWan25I2vNativeReferenceConsumer<T> = (client: SyntxChatHttpClient, references: OwnerWan25I2vNativeReferenceTuple) => T | Promise<T>;
export type OwnerWan25I2vReferenceServiceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH" |
  "SERVICE_CLOSED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "REQUEST_ABORTED" | "UPLOAD_REJECTED" |
  "UPLOAD_OUTCOME_UNKNOWN" | "AUDIO_REFERENCE_NOT_READY" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
export class OwnerWan25I2vReferenceServiceError extends Error {
  constructor(readonly code: OwnerWan25I2vReferenceServiceErrorCode) {
    super("The owner WAN 2.5 I2V preview reference could not be established safely."); this.name = "OwnerWan25I2vReferenceServiceError";
  }
}
interface ImageRecord { readonly handle: string; readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly context: OwnerWan25I2vImageUploadContext; readonly receipt: OwnerWan25I2vImageUploadReceipt;
  readonly expiresAt: number; readonly epoch: number }
interface ResolutionState { readonly service: OwnerWan25I2vReferenceService; readonly image: ImageRecord;
  readonly input: Readonly<OwnerWan25I2vReferenceResolveInput> }

/** Process-local owner-bound image upload handles. This service grants no generation authority. */
export class OwnerWan25I2vReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService; readonly #resolveClient: (attemptId: string) => unknown;
  readonly #now: () => number; readonly #records = new Map<string, ImageRecord>(); readonly #clients = new Map<string, SyntxChatHttpClient>();
  readonly #principals = new Map<string, Readonly<GenerationPrincipalRef>>(); readonly #epochs = new Map<string, number>();
  readonly #unknown = new Set<string>(); readonly #pending = new Set<string>(); #closed = false; #lastNow = -1;
  constructor(optionsInput: OwnerWan25I2vReferenceServiceOptions | unknown) {
    const f = exactRecord(optionsInput, ["binding", "linkService", "resolveClient"], ["now"]);
    if (!isLinkService(f.linkService) || typeof f.resolveClient !== "function" || types.isProxy(f.resolveClient) ||
        (f.now !== undefined && (typeof f.now !== "function" || types.isProxy(f.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(f.binding); this.#links = f.linkService as PerUserLinkService;
    this.#resolveClient = f.resolveClient as (attemptId: string) => unknown;
    const now = f.now === undefined ? () => performance.now() : f.now as () => number;
    this.#now = () => { let value: unknown; try { value = Reflect.apply(now, undefined, []); } catch { fail("SERVICE_CLOSED"); }
      if (typeof value !== "number" || !Number.isFinite(value) || value < this.#lastNow || value > Number.MAX_SAFE_INTEGER) fail("SERVICE_CLOSED");
      this.#lastNow = value; return value; };
    SERVICES.add(this); Object.freeze(this);
  }

  async uploadImage(inputValue: OwnerWan25I2vImageUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan25I2vImageUploadReceipt> {
    this.#assertOpen(); this.#prune(); const request = uploadInput(inputValue);
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
    if (signal?.aborted) fail("REQUEST_ABORTED");
    const bytes = decodeBase64(request.content_base64); let receipt: Readonly<ValidatedOwnerWan25I2vPreviewImage> | undefined;
    let semanticKey: string | undefined; let posted = false;
    try {
      receipt = validateOwnerWan25I2vPreviewImage({ model_id: MODEL_ID, filename: request.filename, mime_type: request.mime_type, bytes });
      if (signal?.aborted) fail("REQUEST_ABORTED");
      const principal = await this.#principal(request.attemptId, signal);
      this.#assertOpen(); if (signal?.aborted) fail("REQUEST_ABORTED");
      this.#remember(request.attemptId, principal);
      const client = await this.#client(request.attemptId);
      this.#assertOpen(); if (signal?.aborted) fail("REQUEST_ABORTED");
      const digest = receipt.sha256;
      const semantic = [...this.#records.values()].find((record) => record.attemptId === request.attemptId &&
        sameGenerationPrincipal(record.principal, principal) && record.client === client && record.receipt.sha256 === digest &&
        record.receipt.mime_type === receipt!.mime_type && record.receipt.filename === receipt!.filename && this.#live(record));
      if (semantic) return semantic.receipt;
      semanticKey = JSON.stringify([request.attemptId, principal.tenant_id, principal.subject_id, digest, receipt.mime_type, receipt.filename]);
      if (this.#unknown.has(semanticKey)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pending.has(semanticKey)) fail("SERVICE_BUSY");
      if (this.#unknown.size >= 128) fail("CAPACITY_EXCEEDED");
      if (this.#records.size >= 128 || this.#pending.size >= 4) fail("CAPACITY_EXCEEDED");
      this.#pending.add(semanticKey);
      if (signal?.aborted) fail("REQUEST_ABORTED");
      let context: OwnerWan25I2vImageUploadContext;
      posted = true;
      try { context = await client.uploadWan25I2vImage(receipt, signal); }
      catch (error) { if (isKnownRejection(error)) fail("UPLOAD_REJECTED"); throw error; }
      this.#assertOpen();
      if (signal?.aborted || !sameImageContext(client, context, receipt)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const verifiedPrincipal = await this.#principal(request.attemptId, signal), verifiedClient = await this.#client(request.attemptId);
      if (!sameGenerationPrincipal(principal, verifiedPrincipal) || verifiedClient !== client) fail("UPLOAD_OUTCOME_UNKNOWN");
      const createdAt = this.#now(); if (createdAt > Number.MAX_SAFE_INTEGER - TTL_MS) fail("SERVICE_CLOSED");
      const handle = `wan25image_${randomUUID()}`;
      const safe = Object.freeze({ status: "uploaded" as const, model_id: MODEL_ID, image_handle: handle,
        filename: receipt.filename, mime_type: context.mime_type, size: context.size, sha256: context.sha256,
        width: context.width, height: context.height, expires_in_seconds: 900 as const, generation_permit: false as const });
      this.#records.set(handle, Object.freeze({ handle, attemptId: request.attemptId, principal, client, context, receipt: safe,
        expiresAt: createdAt + TTL_MS, epoch: this.#epochs.get(request.attemptId) ?? 0 }));
      return safe;
    } catch (error) {
      if (posted && !(error instanceof OwnerWan25I2vReferenceServiceError && error.code === "UPLOAD_REJECTED")) {
        if (semanticKey) this.#unknown.add(semanticKey); this.#revoke(request.attemptId);
        fail("UPLOAD_OUTCOME_UNKNOWN");
      }
      throw this.#map(error);
    } finally { if (semanticKey) this.#pending.delete(semanticKey); bytes.fill(0); if (receipt) releaseValidatedOwnerWan25I2vPreviewImage(receipt); }
  }

  async resolveReferences(inputValue: OwnerWan25I2vReferenceResolveInput | unknown, signal?: AbortSignal): Promise<OwnerWan25I2vReferenceResolution> {
    this.#assertOpen(); this.#prune(); const input = resolveInput(inputValue); if (signal?.aborted) fail("REQUEST_ABORTED");
    try {
      const principal = await this.#principal(input.attempt_id, signal); this.#assertOpen(); this.#remember(input.attempt_id, principal);
      const record = this.#records.get(input.image_handle);
      if (!record || record.attemptId !== input.attempt_id || record.context.model_id !== input.model_id) fail("REFERENCE_UNAVAILABLE");
      await this.#verifyRecord(record, principal, signal);
      const resolution = Object.freeze({ model_id: MODEL_ID, principal, attempt_id: input.attempt_id,
        image: Object.freeze({ image_handle: record.handle, model_id: MODEL_ID, filename: record.receipt.filename,
          mime_type: record.receipt.mime_type, size: record.receipt.size, sha256: record.receipt.sha256,
          width: record.receipt.width, height: record.receipt.height, generation_permit: false as const }),
        audio: null, audio_integration_status: "NATIVE_AUDIO_CONTEXT_NOT_AVAILABLE" as const,
        expires_at: record.expiresAt, epoch: this.#epochs.get(input.attempt_id) ?? 0, generation_permit: false as const });
      RESOLUTIONS.set(resolution, Object.freeze({ service: this, image: record, input })); return resolution;
    } catch (error) { throw this.#map(error); }
  }

  isOwnedReferenceResolution(value: unknown, inputValue: OwnerWan25I2vReferenceResolveInput | unknown): boolean {
    try { const input = resolveInput(inputValue); if (!isPlainObject(value)) return false; const state = RESOLUTIONS.get(value);
      return !!state && state.service === this && sameInput(state.input, input) && this.#live(state.image) &&
        state.image.epoch === (this.#epochs.get(input.attempt_id) ?? 0); } catch { return false; }
  }

  async withCapturedNativeReferences<T>(value: unknown, inputValue: OwnerWan25I2vReferenceResolveInput | unknown,
    consume: OwnerWan25I2vNativeReferenceConsumer<T>, signal?: AbortSignal): Promise<T> {
    this.#assertOpen(); const input = resolveInput(inputValue); if (typeof consume !== "function" || types.isProxy(consume) || !isPlainObject(value)) fail("INVALID_REQUEST");
    const state = RESOLUTIONS.get(value); if (!state || state.service !== this || !sameInput(state.input, input)) fail("REFERENCE_UNAVAILABLE");
    const principal = await this.#principal(input.attempt_id, signal); await this.#verifyRecord(state.image, principal, signal);
    const tuple = Object.freeze([state.image.context]) as OwnerWan25I2vNativeReferenceTuple;
    const result = await consume(state.image.client, tuple);
    const checked = await this.#principal(input.attempt_id, signal); await this.#verifyRecord(state.image, checked, signal);
    if (!sameGenerationPrincipal(principal, checked)) fail("PRINCIPAL_NOT_LINKED"); return result;
  }

  invalidateAttempt(value: unknown): Promise<void> {
    if (typeof value !== "string" || !ATTEMPT.test(value)) return Promise.resolve(); this.#revoke(value); this.#prune(); return Promise.resolve();
  }
  async close(): Promise<void> { if (this.#closed) return; this.#closed = true; this.#records.clear(); this.#clients.clear(); this.#principals.clear(); this.#unknown.clear(); }

  async #principal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    this.#assertOpen(); if (signal?.aborted) fail("REQUEST_ABORTED");
    try { return await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links }); }
    catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); throw error; }
  }
  async #client(attemptId: string): Promise<SyntxChatHttpClient> {
    let value: unknown; try { value = await Reflect.apply(this.#resolveClient, undefined, [attemptId]); } catch { fail("PROFILE_BINDING_MISMATCH"); }
    const client = exactNativeClient(value); const prior = this.#clients.get(attemptId);
    if (prior && prior !== client) { this.#revoke(attemptId); fail("PROFILE_BINDING_MISMATCH"); }
    this.#clients.set(attemptId, client); return client;
  }
  #remember(attemptId: string, principal: Readonly<GenerationPrincipalRef>): void {
    const prior = this.#principals.get(attemptId); if (prior && !sameGenerationPrincipal(prior, principal)) { this.#revoke(attemptId); fail("PRINCIPAL_NOT_LINKED"); }
    this.#principals.set(attemptId, principal);
  }
  async #verifyRecord(record: ImageRecord, principal: Readonly<GenerationPrincipalRef>, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) fail("REQUEST_ABORTED");
    if (!this.#live(record) || !sameGenerationPrincipal(record.principal, principal) || record.epoch !== (this.#epochs.get(record.attemptId) ?? 0)) fail("REFERENCE_EXPIRED");
    const client = await this.#client(record.attemptId); const latest = await this.#principal(record.attemptId, signal);
    if (client !== record.client || !sameGenerationPrincipal(latest, principal) || !readOwnerWan25I2vUploadReferenceForClient(client, record.context)) {
      this.#revoke(record.attemptId); fail("REFERENCE_UNAVAILABLE");
    }
  }
  #live(record: ImageRecord): boolean { return !this.#closed && this.#now() < record.expiresAt && this.#records.get(record.handle) === record; }
  #prune(): void {
    const current = this.#now();
    for (const [handle, record] of this.#records) if (record.expiresAt <= current) this.#records.delete(handle);
    const active = new Set([...this.#records.values()].map((record) => record.attemptId));
    for (const key of this.#pending) { try { const attemptId = JSON.parse(key)[0]; if (typeof attemptId === "string") active.add(attemptId); } catch { /* private keys are internally created */ } }
    for (const attemptId of this.#clients.keys()) if (!active.has(attemptId)) this.#clients.delete(attemptId);
    for (const attemptId of this.#principals.keys()) if (!active.has(attemptId)) this.#principals.delete(attemptId);
    for (const attemptId of this.#epochs.keys()) if (!active.has(attemptId)) this.#epochs.delete(attemptId);
  }
  #revoke(attemptId: string): void {
    const tracked = this.#clients.has(attemptId) || this.#principals.has(attemptId) || [...this.#records.values()].some((r) => r.attemptId === attemptId);
    if (tracked) this.#epochs.set(attemptId, (this.#epochs.get(attemptId) ?? 0) + 1);
    for (const [handle, record] of this.#records) if (record.attemptId === attemptId) this.#records.delete(handle);
    this.#clients.delete(attemptId); this.#principals.delete(attemptId); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #map(error: unknown): OwnerWan25I2vReferenceServiceError {
    if (error instanceof OwnerWan25I2vReferenceServiceError) return error;
    if (error instanceof OwnerReferencePrincipalError) return new OwnerWan25I2vReferenceServiceError("PRINCIPAL_NOT_LINKED");
    if (error instanceof OwnerWan25I2vPreviewImagePolicyError) return new OwnerWan25I2vReferenceServiceError("INVALID_REQUEST");
    if (error instanceof SyntxHttpError && isKnownRejection(error)) return new OwnerWan25I2vReferenceServiceError("UPLOAD_REJECTED");
    return new OwnerWan25I2vReferenceServiceError("REFERENCE_UNAVAILABLE");
  }
}

export function isOwnerWan25I2vReferenceService(value: unknown): value is OwnerWan25I2vReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value as object);
}
export function createOwnerWan25I2vReferenceService(options: OwnerWan25I2vReferenceServiceOptions | unknown): OwnerWan25I2vReferenceService {
  return new OwnerWan25I2vReferenceService(options);
}
function sameImageContext(client: SyntxChatHttpClient, value: unknown, source: Readonly<ValidatedOwnerWan25I2vPreviewImage>): value is OwnerWan25I2vImageUploadContext {
  if (!value || typeof value !== "object" || !Object.isFrozen(value) || !readOwnerWan25I2vUploadReferenceForClient(client, value)) return false;
  const c = value as OwnerWan25I2vImageUploadContext; return c.model_id === MODEL_ID && c.media_type === "image" &&
    c.mime_type === source.mime_type && c.size === source.size && c.sha256 === source.sha256 && c.width === source.width && c.height === source.height;
}
function isKnownRejection(error: unknown): boolean { return error instanceof SyntxHttpError && ["INVALID_REQUEST", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED"].includes(error.code); }
function exactNativeClient(value: unknown): SyntxChatHttpClient {
  try { const prototype = SyntxChatHttpClient.prototype; const upload = getDataMethod(prototype, "uploadFileReferences");
    const create = getDataMethod(prototype, "createChat"), start = getDataMethod(prototype, "startVideo");
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== prototype ||
      Object.hasOwn(value, "uploadFileReferences") || typeof upload !== "function" || typeof create !== "function" || typeof start !== "function" ||
      getDataMethod(value, "uploadFileReferences") !== upload || Reflect.get(value, "uploadFileReferences") !== upload) fail("PROFILE_BINDING_MISMATCH"); return value as SyntxChatHttpClient; }
  catch { fail("PROFILE_BINDING_MISMATCH"); }
}
function getDataMethod(target: object, key: string): unknown { let current: object | null = target; while (current) {
  const descriptor = Object.getOwnPropertyDescriptor(current, key); if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
  current = Object.getPrototypeOf(current) as object | null; } return undefined; }
function isLinkService(value: unknown): value is PerUserLinkService { try { return !!value && typeof value === "object" && !types.isProxy(value) &&
  Object.getPrototypeOf(value) === PerUserLinkService.prototype && !Object.hasOwn(value, "getStatus") && PerUserLinkService.prototype.getStatus === NATIVE_LINK_STATUS; } catch { return false; } }
function snapshotBinding(value: unknown): Readonly<AuthBinding> { const f = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id || f.tenant_id.length > 256 || /[\u0000-\u001f\u007f]/u.test(f.tenant_id) ||
      typeof f.subject !== "string" || !f.subject || f.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(f.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function uploadInput(value: unknown): OwnerWan25I2vImageUploadInput { const f = exactRecord(value, ["attemptId", "model_id", "content_base64", "filename", "mime_type"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || f.model_id !== MODEL_ID || typeof f.content_base64 !== "string" ||
      typeof f.filename !== "string" || typeof f.mime_type !== "string") fail("INVALID_REQUEST"); return Object.freeze({ attemptId: f.attemptId,
        model_id: MODEL_ID, content_base64: f.content_base64, filename: f.filename, mime_type: f.mime_type }) as unknown as OwnerWan25I2vImageUploadInput; }
function resolveInput(value: unknown): Readonly<OwnerWan25I2vReferenceResolveInput> { const f = exactRecord(value, ["attempt_id", "model_id", "image_handle", "audio_handle"]);
  if (typeof f.attempt_id !== "string" || !ATTEMPT.test(f.attempt_id) || f.model_id !== MODEL_ID || typeof f.image_handle !== "string" ||
      !IMAGE_HANDLE.test(f.image_handle)) fail("INVALID_REQUEST"); if (f.audio_handle !== null) fail("AUDIO_REFERENCE_NOT_READY");
  return Object.freeze({ attempt_id: f.attempt_id, model_id: MODEL_ID, image_handle: f.image_handle, audio_handle: null }); }
function decodeBase64(value: string): Buffer { if (!value || value.length > MAX_BASE64 || value.length % 4 !== 0 ||
  !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail("INVALID_REQUEST");
  const bytes = Buffer.from(value, "base64"); if (!bytes.byteLength || bytes.byteLength > MAX_BYTES || bytes.toString("base64") !== value) { bytes.fill(0); fail("INVALID_REQUEST"); } return bytes; }
function sameInput(a: OwnerWan25I2vReferenceResolveInput, b: OwnerWan25I2vReferenceResolveInput): boolean {
  return a.attempt_id === b.attempt_id && a.model_id === b.model_id && a.image_handle === b.image_handle && a.audio_handle === b.audio_handle;
}
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isPlainObject(value)) fail("INVALID_REQUEST"); let descriptors: PropertyDescriptorMap; try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(descriptors), allowed = [...required, ...optional];
  if (required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) out[key] = descriptors[key]!.value; return out;
}
function isPlainObject(value: unknown): value is object { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  try { const p = Object.getPrototypeOf(value); return p === Object.prototype || p === null; } catch { return false; } }
function fail(code: OwnerWan25I2vReferenceServiceErrorCode): never { throw new OwnerWan25I2vReferenceServiceError(code); }
