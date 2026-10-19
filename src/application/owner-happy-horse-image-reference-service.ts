import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { readOwnerHappyHorseUploadReference, type OwnerHappyHorseImageUploadContext,
  type OwnerHappyHorseUploadDestination, type OwnerHappyHorseUploadReference } from "../adapter/syntx/owner-happy-horse-image-context.js";
import { validateOwnerHappyHorseImage, readValidatedOwnerHappyHorseImage, releaseValidatedOwnerHappyHorseImage,
  type OwnerHappyHorseImageMimeType, type OwnerHappyHorseValidatedImage } from "./owner-happy-horse-image-policy.js";
import { getOwnerHappyHorseSourceProfile, isOwnerHappyHorseImageModelId, type OwnerHappyHorseImageModelId } from "./owner-happy-horse-parameters.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE = /^happy_horse_image_[0-9a-f-]{36}$/u;
const TTL_MS = 15 * 60_000;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerHappyHorseImage");
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")!.get!;
const TYPED_ARRAY_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")!.get!;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")!.get!;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const RECORDS = new WeakMap<object, OwnedState>();
const SERVICES = new WeakSet<object>();

export interface OwnerHappyHorseImageReferenceServiceOptions {
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveClient: (attemptId: string) => unknown;
  readonly uploadDestination: OwnerHappyHorseUploadDestination;
  readonly now?: () => number;
}
export interface OwnerHappyHorseImageUploadInput {
  readonly attemptId: string; readonly model_id: OwnerHappyHorseImageModelId; readonly filename: string;
  readonly mime_type: OwnerHappyHorseImageMimeType; readonly bytes: Uint8Array;
}
export interface OwnerHappyHorseImageUploadReceipt {
  readonly status: "uploaded"; readonly reference_handle: string; readonly model_id: OwnerHappyHorseImageModelId;
  readonly mime_type: OwnerHappyHorseImageMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly expires_in_seconds: number;
  readonly metadata_confidence: "BOUNDED_CONTAINER_METADATA_NOT_DECODED_PIXELS";
  readonly size_limit_confidence: "CATALOG_METADATA_AND_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN"; readonly generation_permit: false;
}
export interface OwnerHappyHorseOwnedImage {
  readonly attempt_id: string; readonly model_id: OwnerHappyHorseImageModelId; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_sha256: string; readonly expires_at: number; readonly generation_permit: false;
  readonly image: Readonly<{ reference_handle: string; mime_type: OwnerHappyHorseImageMimeType; size: number;
    sha256: string; width: number; height: number }>;
}
export type OwnerHappyHorseReferenceErrorCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "UPLOAD_OUTCOME_UNKNOWN" |
  "VALIDATION_REJECTED" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED" | "SERVICE_CLOSED";
export class OwnerHappyHorseReferenceError extends Error {
  constructor(readonly code: OwnerHappyHorseReferenceErrorCode) { super("The HappyHorse image reference is unavailable."); this.name = "OwnerHappyHorseReferenceError"; }
}
interface Entry {
  readonly handle: string; readonly attempt: string; readonly model: OwnerHappyHorseImageModelId; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly context: OwnerHappyHorseImageUploadContext; readonly destination: OwnerHappyHorseUploadDestination;
  readonly expiresAt: number; readonly epoch: number; readonly mime: OwnerHappyHorseImageMimeType; readonly size: number;
  readonly sha256: string; readonly width: number; readonly height: number;
}
interface OwnedState { readonly service: OwnerHappyHorseImageReferenceService; readonly entry: Entry; readonly client: SyntxChatHttpClient }

/** Draft process-local owner vault; upload uncertainty is sticky and handles never reveal provider URLs. */
export class OwnerHappyHorseImageReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolveClient: (attemptId: string) => unknown; readonly #destination: OwnerHappyHorseUploadDestination;
  readonly #now: () => number; readonly #entries = new Map<string, Entry>(); readonly #epochs = new Map<string, number>();
  readonly #unknown = new Set<string>(); #closed = false; #lastTime = 0;

  constructor(options: OwnerHappyHorseImageReferenceServiceOptions) {
    if (!options || types.isProxy(options) || !genuineLinks(options.linkService) || typeof options.resolveClient !== "function" ||
        types.isProxy(options.resolveClient) || (options.uploadDestination !== "uploaded" && options.uploadDestination !== "hidden") ||
        (options.now !== undefined && (typeof options.now !== "function" || types.isProxy(options.now))) || typeof NATIVE_UPLOAD !== "function") fail("INVALID_REQUEST");
    this.#binding = Object.freeze({ ...options.binding }); this.#links = options.linkService; this.#resolveClient = options.resolveClient;
    this.#destination = options.uploadDestination; this.#now = options.now ?? Date.now; this.#time(); SERVICES.add(this); Object.freeze(this);
  }

  async uploadReference(input: unknown, signal?: AbortSignal): Promise<OwnerHappyHorseImageUploadReceipt> {
    this.#assertOpen(); const request = snapshotUpload(input); let validated: Readonly<OwnerHappyHorseValidatedImage> | undefined;
    let nativeInvoked = false, semantic = "";
    try {
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: request.attempt, linkService: this.#links });
      const client = clientSnapshot(this.#resolveClient(request.attempt));
      validated = validateOwnerHappyHorseImage({ model_id: request.model, filename: request.filename, mime_type: request.mime, bytes: request.bytes });
      const metadata = readValidatedOwnerHappyHorseImage(validated); if (!metadata) fail("VALIDATION_REJECTED");
      semantic = `${principal.tenant_id}:${principal.subject_id}:${request.model}:${metadata.sha256}:${metadata.size}`;
      if (this.#unknown.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      const epoch = this.#epochs.get(request.attempt) ?? 0, expiresAt = this.#time() + TTL_MS;
      nativeInvoked = true;
      let context: OwnerHappyHorseImageUploadContext;
      try {
        context = await Reflect.apply(NATIVE_UPLOAD as Function, client, [{ media: validated, destination: this.#destination }, signal]) as OwnerHappyHorseImageUploadContext;
      } catch { this.#unknown.add(semantic); fail("UPLOAD_OUTCOME_UNKNOWN"); }
      const ref = readOwnerHappyHorseUploadReference(client, context);
      if (!ref || ref.type !== "image" || !isSafeUploadReferenceUrl(ref.url) || context.model_id !== request.model ||
          context.destination !== this.#destination || context.sha256 !== metadata.sha256 || context.size !== metadata.size ||
          context.mime_type !== metadata.mime_type || context.width !== metadata.width || context.height !== metadata.height) fail("UPLOAD_OUTCOME_UNKNOWN");
      const after = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: request.attempt, linkService: this.#links });
      if (!sameGenerationPrincipal(principal, after) || clientSnapshot(this.#resolveClient(request.attempt)) !== client ||
          (this.#epochs.get(request.attempt) ?? 0) !== epoch || this.#closed) fail("UPLOAD_OUTCOME_UNKNOWN");
      const now = this.#time(); if (expiresAt - now < 1_000) fail("UPLOAD_OUTCOME_UNKNOWN");
      const handle = `happy_horse_image_${randomUUID()}`;
      const entry: Entry = Object.freeze({ handle, attempt: request.attempt, model: request.model, principal, client, context,
        destination: this.#destination, expiresAt, epoch, mime: metadata.mime_type, size: metadata.size,
        sha256: metadata.sha256, width: metadata.width, height: metadata.height });
      this.#entries.set(handle, entry);
      return Object.freeze({ status: "uploaded", reference_handle: handle, model_id: request.model, mime_type: entry.mime,
        size: entry.size, sha256: entry.sha256, width: entry.width, height: entry.height,
        expires_in_seconds: Math.floor((expiresAt - now) / 1000), metadata_confidence: "BOUNDED_CONTAINER_METADATA_NOT_DECODED_PIXELS",
        size_limit_confidence: "CATALOG_METADATA_AND_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT", provider_acceptance: "UNPROVEN", generation_permit: false });
    } catch (error) {
      if (nativeInvoked) this.#unknown.add(semantic);
      if (error instanceof OwnerHappyHorseReferenceError) throw error;
      if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED");
      return fail("VALIDATION_REJECTED");
    } finally { validated && releaseValidatedOwnerHappyHorseImage(validated); request.bytes.fill(0); }
  }

  async resolveReference(input: unknown, signal?: AbortSignal): Promise<OwnerHappyHorseOwnedImage> {
    this.#assertOpen(); const f = exact(input, ["attemptId", "model_id", "reference_handle"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !isOwnerHappyHorseImageModelId(f.model_id) ||
        typeof f.reference_handle !== "string" || !HANDLE.test(f.reference_handle)) fail("INVALID_REQUEST");
    if (signal?.aborted) fail("INVALID_REQUEST");
    const attempt = f.attemptId, model = f.model_id, principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#links });
    const entry = this.#entries.get(f.reference_handle);
    if (!entry || entry.attempt !== attempt || entry.model !== model || !sameGenerationPrincipal(entry.principal, principal)) fail("REFERENCE_UNAVAILABLE");
    const now = this.#time(); if (entry.expiresAt <= now) { this.#entries.delete(entry.handle); fail("REFERENCE_EXPIRED"); }
    if (clientSnapshot(this.#resolveClient(attempt)) !== entry.client || (this.#epochs.get(attempt) ?? 0) !== entry.epoch) fail("REFERENCE_UNAVAILABLE");
    const native = readOwnerHappyHorseUploadReference(entry.client, entry.context); if (!native || !isSafeUploadReferenceUrl(native.url)) fail("REFERENCE_UNAVAILABLE");
    const latest = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: attempt, linkService: this.#links });
    if (!sameGenerationPrincipal(principal, latest) || entry.expiresAt <= this.#time()) fail("REFERENCE_EXPIRED");
    const owned = Object.freeze({ attempt_id: attempt, model_id: model, principal, profile_sha256: getOwnerHappyHorseSourceProfile().source_sha256,
      expires_at: entry.expiresAt, generation_permit: false as const, image: Object.freeze({ reference_handle: entry.handle,
        mime_type: entry.mime, size: entry.size, sha256: entry.sha256, width: entry.width, height: entry.height }) });
    RECORDS.set(owned, Object.freeze({ service: this, entry, client: entry.client })); return owned;
  }

  isOwnedReference(value: unknown): value is OwnerHappyHorseOwnedImage {
    try {
      if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
      const state = RECORDS.get(value), entry = state?.entry;
      return !!state && state.service === this && !!entry && this.#entries.get(entry.handle) === entry && entry.expiresAt > this.#time() &&
        entry.epoch === (this.#epochs.get(entry.attempt) ?? 0) && entry.client === state.client &&
        readOwnerHappyHorseUploadReference(entry.client, entry.context) !== null;
    } catch { return false; }
  }

  withCapturedReference<T>(owned: unknown, consume: (client: SyntxChatHttpClient, image: OwnerHappyHorseUploadReference) => T): T {
    this.#assertOpen();
    if (!owned || typeof owned !== "object" || types.isProxy(owned) || !Object.isFrozen(owned)) fail("REFERENCE_UNAVAILABLE");
    const state = RECORDS.get(owned); if (!state || state.service !== this || state.entry.expiresAt <= this.#time()) fail("REFERENCE_EXPIRED");
    const ref = readOwnerHappyHorseUploadReference(state.client, state.entry.context);
    if (!ref || !isSafeUploadReferenceUrl(ref.url)) fail("REFERENCE_UNAVAILABLE");
    return consume(state.client, ref);
  }

  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return;
    this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const [handle, row] of this.#entries) if (row.attempt === attempt) this.#entries.delete(handle);
  }
  async close(): Promise<void> { this.#closed = true; this.#entries.clear(); this.#unknown.clear(); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #time(): number { const now = this.#now(); if (!Number.isSafeInteger(now) || now < this.#lastTime) fail("INVALID_REQUEST"); this.#lastTime = now; return now; }
}
export function isOwnerHappyHorseImageReferenceService(value: unknown): value is OwnerHappyHorseImageReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerHappyHorseImageReferenceService.prototype && Object.isFrozen(value);
}
function snapshotUpload(input: unknown): Readonly<{ attempt: string; model: OwnerHappyHorseImageModelId; filename: string; mime: OwnerHappyHorseImageMimeType; bytes: Buffer }> {
  const f = exact(input, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || !isOwnerHappyHorseImageModelId(f.model_id) || typeof f.filename !== "string" ||
      typeof f.mime_type !== "string" || !( ["image/jpeg", "image/jpg", "image/png", "image/webp"] as readonly string[]).includes(f.mime_type) ||
      !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes)) fail("INVALID_REQUEST");
  const bytes = copyBytes(f.bytes); return Object.freeze({ attempt: f.attemptId, model: f.model_id, filename: f.filename,
    mime: f.mime_type as OwnerHappyHorseImageMimeType, bytes });
}
function copyBytes(value: Uint8Array): Buffer {
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) ||
        ["buffer", "byteOffset", "byteLength", "length"].some(key => Object.hasOwn(value, key))) fail("INVALID_REQUEST");
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as ArrayBuffer;
    const offset = Reflect.apply(TYPED_ARRAY_OFFSET_GETTER, value, []) as number;
    const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as number;
    const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, buffer, []) as number;
    if (types.isProxy(buffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(length) || length < 1 || length > 10 * 1024 * 1024 || offset + length > backingLength) fail("INVALID_REQUEST");
    const view = new Uint8Array(buffer, offset, length), copy = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index++) copy[index] = view[index]!;
    return copy;
  } catch { return fail("INVALID_REQUEST"); }
}
function clientSnapshot(value: unknown): SyntxChatHttpClient {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype ||
      Reflect.get(value, "uploadOwnerHappyHorseImage") !== NATIVE_UPLOAD) fail("INVALID_REQUEST"); return value as SyntxChatHttpClient;
}
function genuineLinks(value: unknown): value is Pick<PerUserLinkService, "getStatus"> {
  try { return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    Reflect.get(value, "getStatus") === PerUserLinkService.prototype.getStatus; } catch { return false; }
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try { const proto = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(ds);
    if ((proto !== Object.prototype && proto !== null) || own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k) || !Object.hasOwn(ds[k]!, "value") || ds[k]!.enumerable !== true)) fail("INVALID_REQUEST");
    const out = Object.create(null) as Record<string, unknown>; for (const k of keys) out[k] = ds[k]!.value; return out;
  } catch { return fail("INVALID_REQUEST"); }
}
function fail(code: OwnerHappyHorseReferenceErrorCode): never { throw new OwnerHappyHorseReferenceError(code); }
