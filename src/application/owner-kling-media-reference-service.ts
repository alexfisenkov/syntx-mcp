import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal, OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import { createOwnerKlingMotionControlVideoProbe, copyTrustedOwnerKlingMotionControlVideoBytes,
  isTrustedOwnerKlingMotionControlVideoProbeResult, releaseTrustedOwnerKlingMotionControlVideoProbeResult } from "./owner-kling-motion-control-video-probe.js";
import { validateOwnerKlingI2VImageBytes, readValidatedOwnerKlingI2VImageInput } from "./owner-kling-i2v-input-policy.js";
import { isOwnerKlingMediaModelId, getOwnerKlingMediaSourceProfile, type OwnerKlingMediaModelId } from "./owner-kling-media-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^kling_media_reference_[0-9a-f-]{36}$/u;
const MIME_IMAGE = ["image/jpeg", "image/jpg", "image/png", "image/avif"] as const;
const MIME_VIDEO = ["video/mp4", "video/quicktime"] as const;
const TTL_MS = 15 * 60_000;
const MAX_VIDEO_BYTES_LOCAL = 100 * 1024 * 1024;
const OWNED = new WeakMap<object, { readonly service: OwnerKlingMediaReferenceService; readonly entry: Entry }>();
const SERVICES = new WeakSet<object>();
const TYPED_ARRAY_PROTO = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTO, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTO, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTO, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
type MediaType = "image" | "video";
export type OwnerKlingMediaUploadDestination = "uploaded" | "hidden";
type UploadMeta = Readonly<{ type: MediaType; model_id: OwnerKlingMediaModelId; filename: string; mime_type: string;
  size: number; sha256: string; width: number; height: number; duration_seconds: number | null }>;
interface Entry extends UploadMeta { readonly handle: string; readonly attempt: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly url: string; readonly expires_at: number; readonly epoch: number }
export interface OwnerKlingMediaReferenceServiceOptions { readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown; readonly uploadDestination: OwnerKlingMediaUploadDestination; readonly ffprobePath: string; readonly now?: () => number }
export interface OwnerKlingMediaUploadReceipt { readonly status: "uploaded"; readonly reference_handle: string; readonly model_id: OwnerKlingMediaModelId;
  readonly media_type: MediaType; readonly mime_type: string; readonly size: number; readonly sha256: string; readonly width: number; readonly height: number;
  readonly measured_duration_seconds: number | null; readonly expires_in_seconds: number; readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false }
export interface OwnerKlingMediaResolvedReference extends UploadMeta { readonly attempt_id: string; readonly reference_handle: string;
  readonly principal: Readonly<GenerationPrincipalRef>; readonly profile_sha256: string; readonly expires_at: number; readonly generation_permit: false }
export class OwnerKlingMediaReferenceError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "VALIDATION_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" |
    "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "SERVICE_CLOSED" | "CAPACITY_EXCEEDED") {
    super("The owner Kling media reference could not be established safely."); this.name = "OwnerKlingMediaReferenceError";
  }
}

/** One source-typed, owner-bound image or video upload. Uncertain uploads are never replayed. */
export class OwnerKlingMediaReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: OwnerKlingMediaReferenceServiceOptions["resolveClient"]; readonly #destination: "uploaded" | "hidden";
  readonly #probe: ReturnType<typeof createOwnerKlingMotionControlVideoProbe>; readonly #now: () => number;
  readonly #entries = new Map<string, Entry>(); readonly #semantic = new Map<string, string>(); readonly #unknown = new Set<string>();
  readonly #epochs = new Map<string, number>(); #closed = false; #lastTime = 0;
  constructor(options: OwnerKlingMediaReferenceServiceOptions) {
    if (!options || types.isProxy(options) || !genuineLinks(options.linkService) || typeof options.resolveClient !== "function" || types.isProxy(options.resolveClient) ||
        (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden") || typeof options.ffprobePath !== "string" || !options.ffprobePath ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now)))) fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ ...options.binding }); this.#links = options.linkService; this.#resolveClient = options.resolveClient;
    this.#destination = options.uploadDestination; this.#probe = createOwnerKlingMotionControlVideoProbe({ ffprobePath: options.ffprobePath });
    this.#now = options.now ?? Date.now; this.#time(); SERVICES.add(this); Object.freeze(this);
  }

  async upload(input: unknown, signal?: AbortSignal): Promise<OwnerKlingMediaUploadReceipt> {
    this.#assertOpen(); const req = snapshotUpload(input); const bytes = req.bytes; let semanticKey: string | undefined, uploadStarted = false;
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: req.attempt, linkService: this.#links });
      const client = this.#client(req.attempt), meta = await this.#validate(req, signal);
      const semantic = semanticKey = `${principal.tenant_id}:${principal.subject_id}:${meta.model_id}:${meta.sha256}:${meta.size}:${meta.mime_type}:${this.#destination}`;
      const cached = this.#semantic.get(semantic), old = cached ? this.#entries.get(cached) : undefined;
      if (old && old.expires_at > this.#time() && old.epoch === (this.#epochs.get(req.attempt) ?? 0) && old.client === client) return this.#receipt(old);
      if (this.#unknown.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#entries.size >= 128) fail("CAPACITY_EXCEEDED");
      let references: InternalUploadReference[];
      uploadStarted = true;
      try { references = await client.uploadFileReferences({ bytes, filename: meta.filename, mime_type: meta.mime_type,
        destination: this.#destination, check_duplicates: true, model_type: meta.model_id }, signal); }
      catch { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      if (references.length !== 1 || !isSafeUploadReferenceUrl(references[0]!.url)) { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const after = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: req.attempt, linkService: this.#links });
      if (!sameGenerationPrincipal(principal, after) || this.#client(req.attempt) !== client || this.#closed) { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const handle = `kling_media_reference_${randomUUID()}`, expires_at = this.#time() + TTL_MS, epoch = this.#epochs.get(req.attempt) ?? 0;
      const entry: Entry = Object.freeze({ ...meta, handle, attempt: req.attempt, principal, client, url: references[0]!.url, expires_at, epoch });
      this.#entries.set(handle, entry); this.#semantic.set(semantic, handle); return this.#receipt(entry);
    } catch (error) {
      if (uploadStarted && semanticKey) this.#unknown.add(semanticKey);
      if (error instanceof OwnerKlingMediaReferenceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      fail("VALIDATION_REJECTED");
    } finally { bytes.fill(0); }
  }

  async resolve(input: unknown): Promise<OwnerKlingMediaResolvedReference> {
    this.#assertOpen(); const f = exact(input, ["attemptId", "model_id", "reference_handle"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !isOwnerKlingMediaModelId(f.model_id) ||
        typeof f.reference_handle !== "string" || !HANDLE.test(f.reference_handle)) fail("INVALID_REQUEST");
    const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: f.attemptId, linkService: this.#links });
    const entry = this.#entries.get(f.reference_handle);
    if (!entry || entry.attempt !== f.attemptId || entry.model_id !== f.model_id || !sameGenerationPrincipal(entry.principal, principal) ||
        this.#client(f.attemptId) !== entry.client || entry.epoch !== (this.#epochs.get(f.attemptId) ?? 0)) fail("REFERENCE_UNAVAILABLE");
    if (entry.expires_at <= this.#time()) { this.#entries.delete(entry.handle); fail("REFERENCE_EXPIRED"); }
    if (!isSafeUploadReferenceUrl(entry.url)) fail("REFERENCE_UNAVAILABLE");
    const latest = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: f.attemptId, linkService: this.#links });
    if (!sameGenerationPrincipal(principal, latest)) fail("PRINCIPAL_NOT_LINKED");
    const owned = Object.freeze({ type: entry.type, model_id: entry.model_id, filename: entry.filename, mime_type: entry.mime_type, size: entry.size,
      sha256: entry.sha256, width: entry.width, height: entry.height, duration_seconds: entry.duration_seconds,
      attempt_id: entry.attempt, reference_handle: entry.handle, principal, profile_sha256: getOwnerKlingMediaSourceProfile().source_sha256,
      expires_at: entry.expires_at, generation_permit: false as const });
    OWNED.set(owned, { service: this, entry }); return owned;
  }
  isOwnedReference(value: unknown): value is OwnerKlingMediaResolvedReference {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const row = OWNED.get(value); return !!row && row.service === this && this.#entries.get(row.entry.handle) === row.entry &&
      row.entry.expires_at > this.#time() && row.entry.epoch === (this.#epochs.get(row.entry.attempt) ?? 0);
  }
  withCapturedReference<T>(owned: unknown, consume: (client: SyntxChatHttpClient, reference: OwnerKlingMediaUploadReference) => T): T {
    if (!this.isOwnedReference(owned)) fail("REFERENCE_UNAVAILABLE"); const entry = OWNED.get(owned as object)!.entry;
    if (!isSafeUploadReferenceUrl(entry.url)) fail("REFERENCE_UNAVAILABLE");
    return consume(entry.client, Object.freeze({ type: entry.type, url: entry.url, sha256: entry.sha256 }));
  }
  async invalidateAttempt(attempt: string): Promise<void> { if (!ATTEMPT.test(attempt)) return; this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const [id, row] of this.#entries) if (row.attempt === attempt) this.#entries.delete(id); }
  async close(): Promise<void> { this.#closed = true; this.#entries.clear(); this.#semantic.clear(); this.#unknown.clear(); }

  async #validate(req: UploadRequest, signal?: AbortSignal): Promise<UploadMeta> {
    if (req.model === "kling_elements" || req.model === "kling_o1_image2video") {
      if (typeof req.mime !== "string" || !(MIME_IMAGE as readonly string[]).includes(req.mime)) fail("VALIDATION_REJECTED");
      const validated = validateOwnerKlingI2VImageBytes({ bytes: req.bytes, filename: req.filename, mime_type: req.mime });
      const image = readValidatedOwnerKlingI2VImageInput(validated); if (!image) fail("VALIDATION_REJECTED");
      if (req.model === "kling_elements" && image.size > 10 * 1024 * 1024) { image.bytes.fill(0); fail("VALIDATION_REJECTED"); }
      const result = Object.freeze({ type: "image" as const, model_id: req.model, filename: image.filename, mime_type: image.mime_type, size: image.size,
        sha256: image.sha256, width: image.width, height: image.height, duration_seconds: null });
      image.bytes.fill(0); return result;
    }
    if (req.model !== "kling_o1_video2video" || typeof req.mime !== "string" || !(MIME_VIDEO as readonly string[]).includes(req.mime)) fail("VALIDATION_REJECTED");
    const raw = await this.#probe.probe({ filename: req.filename, mime_type: req.mime, bytes: req.bytes }, { ...(signal ? { signal } : {}) });
    try {
      if (!isTrustedOwnerKlingMotionControlVideoProbeResult(raw) || raw.bytes_copied > MAX_VIDEO_BYTES_LOCAL || raw.bytes_copied !== req.bytes.byteLength ||
          raw.metadata.duration_seconds < 3 || raw.metadata.duration_seconds > 10 || raw.metadata.width < 1 || raw.metadata.height < 1 ||
          !raw.metadata.codec_streams.some(stream => stream.type === "video")) fail("VALIDATION_REJECTED");
      const copy = copyTrustedOwnerKlingMotionControlVideoBytes(raw); try {
        if (createHash("sha256").update(copy).digest("hex") !== raw.source_sha256) fail("VALIDATION_REJECTED");
      } finally { copy.fill(0); }
      return Object.freeze({ type: "video", model_id: req.model, filename: raw.filename, mime_type: raw.mime_type, size: raw.bytes_copied,
        sha256: raw.source_sha256, width: raw.metadata.width, height: raw.metadata.height, duration_seconds: raw.metadata.duration_seconds });
    } finally { releaseTrustedOwnerKlingMotionControlVideoProbeResult(raw); }
  }
  #receipt(entry: Entry): OwnerKlingMediaUploadReceipt { return Object.freeze({ status: "uploaded", reference_handle: entry.handle,
    model_id: entry.model_id, media_type: entry.type, mime_type: entry.mime_type, size: entry.size, sha256: entry.sha256, width: entry.width,
    height: entry.height, measured_duration_seconds: entry.duration_seconds, expires_in_seconds: Math.max(0, Math.floor((entry.expires_at - this.#time()) / 1_000)),
    provider_acceptance: "UNPROVEN", generation_permit: false }); }
  #client(attempt: string): SyntxChatHttpClient { let v: unknown; try { v = this.#resolveClient(attempt); } catch { fail("PRINCIPAL_NOT_LINKED"); }
    if (!v || typeof v !== "object" || types.isProxy(v) || Object.getPrototypeOf(v) !== SyntxChatHttpClient.prototype ||
        Reflect.get(v, "uploadFileReferences") !== SyntxChatHttpClient.prototype.uploadFileReferences) fail("PRINCIPAL_NOT_LINKED"); return v as SyntxChatHttpClient; }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #time(): number { const t = this.#now(); if (!Number.isSafeInteger(t) || t < this.#lastTime) fail("INVALID_REQUEST"); this.#lastTime = t; return t; }
}
export interface OwnerKlingMediaUploadReference { readonly type: MediaType; readonly url: string; readonly sha256: string }
export function isOwnerKlingMediaReferenceService(value: unknown): value is OwnerKlingMediaReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) && Object.getPrototypeOf(value) === OwnerKlingMediaReferenceService.prototype && Object.isFrozen(value);
}
interface UploadRequest { readonly attempt: string; readonly model: OwnerKlingMediaModelId; readonly filename: string; readonly mime: string; readonly bytes: Buffer }
function snapshotUpload(input: unknown): UploadRequest {
  const f = exact(input, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !isOwnerKlingMediaModelId(f.model_id) || typeof f.filename !== "string" ||
      f.filename.length < 1 || f.filename.length > 255 || typeof f.mime_type !== "string" || !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes) ||
      ((f.model_id === "kling_o1_video2video") !== (f.mime_type.startsWith("video/")))) fail("INVALID_REQUEST");
  return Object.freeze({ attempt: f.attemptId, model: f.model_id, filename: f.filename, mime: f.mime_type, bytes: copyBytes(f.bytes) });
}
function copyBytes(value: Uint8Array): Buffer {
  try {
    const proto = Object.getPrototypeOf(value);
    if ((proto !== Uint8Array.prototype && proto !== Buffer.prototype) || ["buffer", "byteOffset", "byteLength", "length"].some(k => Object.hasOwn(value, k))) fail("INVALID_REQUEST");
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
    const offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number, length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
    const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []) as number;
    if (types.isProxy(backing) || Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 || length > MAX_VIDEO_BYTES_LOCAL || offset + length > backingLength) fail("INVALID_REQUEST");
    const source = new Uint8Array(backing, offset, length), copy = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i += 1) copy[i] = source[i]!; return copy;
  } catch { return fail("INVALID_REQUEST"); }
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const p = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(d);
    if ((p !== Object.prototype && p !== null) || own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k) ||
        !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) fail("INVALID_REQUEST");
    const out = Object.create(null) as Record<string, unknown>; for (const k of keys) out[k] = d[k]!.value; return out;
  } catch { return fail("INVALID_REQUEST"); }
}
function genuineLinks(value: unknown): value is Pick<PerUserLinkService, "getStatus"> {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; }
}
function fail(code: OwnerKlingMediaReferenceError["code"]): never { throw new OwnerKlingMediaReferenceError(code); }
