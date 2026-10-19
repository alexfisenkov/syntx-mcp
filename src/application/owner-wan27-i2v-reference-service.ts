import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { readValidatedOwnerWan27I2vImage, releaseValidatedOwnerWan27I2vImage, validateOwnerWan27I2vImage,
  OWNER_WAN27_I2V_IMAGE_POLICY, type OwnerWan27I2vImageSourceMimeType, type OwnerWan27I2vImageMimeType,
  type ValidatedOwnerWan27I2vImage } from "./owner-wan27-i2v-image-policy.js";
import { readOwnerWan27I2vUploadReferenceForClient, type OwnerWan27I2vImageUploadContext } from "../adapter/syntx/owner-wan27-i2v-native-context.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u, HANDLE = /^wan27i2v_image_[0-9a-f-]{36}$/u;
const TTL = 15 * 60_000, MAX_RECORDS = 128, MAX_PENDING = 4;
const NATIVE_UPLOAD = Reflect.get(SyntxChatHttpClient.prototype, "uploadOwnerWan27I2vImage");
const LINK_STATUS = PerUserLinkService.prototype.getStatus;
const OWNED = new WeakMap<object, Readonly<{ service: OwnerWan27I2vReferenceService; entry: Entry }>>();
const SERVICES = new WeakSet<object>();
interface NativeWan27I2vUploadClient extends SyntxChatHttpClient {
  uploadOwnerWan27I2vImage(input: unknown, signal?: AbortSignal): Promise<OwnerWan27I2vImageUploadContext>;
}

export type OwnerWan27I2vUploadDestination = "uploaded" | "hidden";
export interface OwnerWan27I2vReferenceServiceOptions {
  readonly binding: AuthBinding; readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveChatClient: (attemptId: string) => unknown; readonly uploadDestination: OwnerWan27I2vUploadDestination;
  readonly now?: () => number;
}
export interface OwnerWan27I2vUploadInput {
  readonly attemptId: string; readonly model_id: "wan_27_i2v"; readonly filename: string; readonly mime_type: OwnerWan27I2vImageSourceMimeType;
  readonly bytes: Uint8Array;
}
export interface OwnerWan27I2vImageReceipt {
  readonly status: "uploaded"; readonly image_handle: string; readonly model_id: "wan_27_i2v";
  readonly filename: string; readonly mime_type: OwnerWan27I2vImageMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly expires_in_seconds: 900;
  readonly metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED"; readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
}
export interface OwnerWan27I2vOwnedImage {
  readonly attempt_id: string; readonly model_id: "wan_27_i2v"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly image: Readonly<{ image_handle: string; mime_type: OwnerWan27I2vImageMimeType; size: number;
    sha256: string; width: number; height: number }>; readonly expires_at: number; readonly epoch: number;
  readonly generation_permit: false;
}
interface Entry {
  readonly handle: string; readonly attempt: string; readonly model: "wan_27_i2v"; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly client: SyntxChatHttpClient; readonly epoch: number; readonly expires: number; readonly context: OwnerWan27I2vImageUploadContext;
  readonly destination: OwnerWan27I2vUploadDestination; readonly filename: string; readonly mime: OwnerWan27I2vImageMimeType;
  readonly size: number; readonly sha256: string; readonly width: number; readonly height: number; readonly semantic: string;
}
export class OwnerWan27I2vReferenceServiceError extends Error {
  constructor(readonly code: string) { super("The owner WAN 2.7 I2V image reference could not be established safely."); this.name = "OwnerWan27I2vReferenceServiceError"; }
}
export class OwnerWan27I2vReferenceService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: Pick<PerUserLinkService, "getStatus">;
  readonly #resolve: (attempt: string) => unknown; readonly #destination: OwnerWan27I2vUploadDestination; readonly #now: () => number;
  readonly #entries = new Map<string, Entry>(); readonly #epochs = new Map<string, number>(); readonly #pending = new Set<Promise<unknown>>();
  readonly #pendingSemantics = new Set<string>(); readonly #unknownSemantics = new Set<string>(); readonly #knownSemantics = new Map<string,string>();
  #lastNow = -1; #closed = false;
  constructor(input: OwnerWan27I2vReferenceServiceOptions | unknown) {
    const f = exact(input, ["binding", "linkService", "resolveChatClient", "uploadDestination"], ["now"]);
    if (!isLinks(f.linkService) || typeof f.resolveChatClient !== "function" ||
        (f.uploadDestination !== "uploaded" && f.uploadDestination !== "hidden") ||
        (f.now !== undefined && typeof f.now !== "function") || typeof NATIVE_UPLOAD !== "function") fail("INVALID_REQUEST");
    this.#binding = binding(f.binding); this.#links = f.linkService as Pick<PerUserLinkService, "getStatus">;
    this.#resolve = f.resolveChatClient as (attempt: string) => unknown;
    this.#destination = f.uploadDestination as OwnerWan27I2vUploadDestination;
    this.#now = typeof f.now === "function" ? f.now as () => number : Date.now;
    SERVICES.add(this); Object.freeze(this);
  }
  async uploadImage(input: OwnerWan27I2vUploadInput | unknown, signal?: AbortSignal): Promise<OwnerWan27I2vImageReceipt> {
    this.#assertOpen(); const request = snapshotUpload(input);
    if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
    if (this.#pending.size >= MAX_PENDING) fail("SERVICE_BUSY");
    const stop = new AbortController(), combined = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    const task = this.#upload(request, combined); this.#pending.add(task);
    try { return await task; } finally { this.#pending.delete(task); }
  }
  async resolveImage(input: unknown): Promise<Readonly<OwnerWan27I2vOwnedImage>> {
    this.#assertOpen(); const f = exact(input, ["attemptId", "model_id", "image_handle"]);
    if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || f.model_id !== "wan_27_i2v" ||
        typeof f.image_handle !== "string" || !HANDLE.test(f.image_handle)) fail("INVALID_REQUEST");
    const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: f.attemptId, linkService: this.#links });
    const entry = this.#entries.get(f.image_handle);
    if (!entry || entry.attempt !== f.attemptId || !sameGenerationPrincipal(entry.principal, principal) ||
        entry.epoch !== (this.#epochs.get(entry.attempt) ?? 0) || entry.expires <= this.#time() ||
        this.#resolve(entry.attempt) !== entry.client || !readOwnerWan27I2vUploadReferenceForClient(entry.client, entry.context)) fail("REFERENCE_UNAVAILABLE");
    const owned = Object.freeze({ attempt_id: entry.attempt, model_id: entry.model, principal, expires_at: entry.expires, epoch: entry.epoch,
      image: Object.freeze({ image_handle: entry.handle, mime_type: entry.mime, size: entry.size, sha256: entry.sha256,
        width: entry.width, height: entry.height }), generation_permit: false as const });
    OWNED.set(owned, Object.freeze({ service: this, entry })); return owned;
  }
  withCapturedImage<T>(image: OwnerWan27I2vOwnedImage, callback: (client: SyntxChatHttpClient,
    captured: Readonly<{ url: string; sha256: string; mime_type: OwnerWan27I2vImageMimeType; size: number; width: number; height: number }>) => T): T {
    const state = image && typeof image === "object" && !types.isProxy(image) ? OWNED.get(image) : undefined;
    if (!state || state.service !== this || !this.isOwnedImage(image) || typeof callback !== "function") fail("REFERENCE_UNAVAILABLE");
    const url = readOwnerWan27I2vUploadReferenceForClient(state.entry.client, state.entry.context);
    if (!url) fail("REFERENCE_UNAVAILABLE");
    return callback(state.entry.client, Object.freeze({ url: url.url, sha256: state.entry.sha256, mime_type: state.entry.mime,
      size: state.entry.size, width: state.entry.width, height: state.entry.height }));
  }
  isOwnedImage(value: unknown): value is OwnerWan27I2vOwnedImage {
    const state = value && typeof value === "object" && !types.isProxy(value) ? OWNED.get(value) : undefined;
    if (!state || state.service !== this || this.#closed) return false;
    const e = state.entry;
    try { return this.#entries.get(e.handle) === e && e.epoch === (this.#epochs.get(e.attempt) ?? 0) &&
      e.expires > this.#time() && this.#resolve(e.attempt) === e.client &&
      readOwnerWan27I2vUploadReferenceForClient(e.client,e.context) !== null; } catch { return false; }
  }
  async invalidateAttempt(attempt: string): Promise<void> {
    if (!ATTEMPT.test(attempt)) return;
    this.#epochs.set(attempt, (this.#epochs.get(attempt) ?? 0) + 1);
    for (const [id,entry] of this.#entries) if (entry.attempt === attempt) {
      this.#entries.delete(id); this.#knownSemantics.delete(entry.semantic);
    }
    await Promise.allSettled([...this.#pending]);
  }
  async close(): Promise<void> { this.#closed = true; this.#entries.clear(); this.#knownSemantics.clear(); await Promise.allSettled([...this.#pending]); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  async #upload(request: UploadSnapshot, signal: AbortSignal): Promise<OwnerWan27I2vImageReceipt> {
    let validated: Readonly<ValidatedOwnerWan27I2vImage> | undefined, readCopy: Uint8Array | undefined;
    let invoked = false, published = false, semantic: string | undefined;
    try {
      if (signal.aborted) fail("REQUEST_ABORTED");
      const principal = await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId: request.attemptId, linkService: this.#links });
      const client = this.#resolve(request.attemptId);
      if (!isExactClient(client)) fail("PRINCIPAL_NOT_LINKED");
      validated = validateOwnerWan27I2vImage({ model_id: "wan_27_i2v", filename: request.filename, mime_type: request.mime, bytes: request.bytes });
      const media = readValidatedOwnerWan27I2vImage(validated); if (!media) fail("VALIDATION_REJECTED"); readCopy = media.bytes;
      semantic = schemaHash({ tenant_id: principal.tenant_id, subject_id: principal.subject_id, model_id: "wan_27_i2v",
        filename: media.filename, mime_type: media.mime_type, size: media.size, sha256: media.sha256, width: media.width, height: media.height,
        destination: this.#destination });
      if (this.#unknownSemantics.has(semantic)) fail("UPLOAD_OUTCOME_UNKNOWN");
      if (this.#pendingSemantics.has(semantic)) fail("SERVICE_BUSY");
      const prior = this.#knownSemantics.get(semantic), priorEntry = prior ? this.#entries.get(prior) : undefined;
      if (priorEntry && priorEntry.expires > this.#time() && priorEntry.epoch === (this.#epochs.get(request.attemptId) ?? 0) &&
          priorEntry.client === client) return imageReceipt(priorEntry);
      if (prior) this.#knownSemantics.delete(semantic);
      if (this.#entries.size + this.#pendingSemantics.size + this.#unknownSemantics.size >= MAX_RECORDS) fail("CAPACITY_EXCEEDED");
      this.#pendingSemantics.add(semantic);
      const epoch = this.#epochs.get(request.attemptId) ?? 0; invoked = true;
      const context = await client.uploadOwnerWan27I2vImage({ media: validated, destination: this.#destination }, signal);
      if (signal.aborted || epoch !== (this.#epochs.get(request.attemptId) ?? 0) || this.#resolve(request.attemptId) !== client) fail("UPLOAD_OUTCOME_UNKNOWN");
      const reference = readOwnerWan27I2vUploadReferenceForClient(client,context), c = context as OwnerWan27I2vImageUploadContext;
      if (!reference || c.model_id !== "wan_27_i2v" || c.destination !== this.#destination || c.sha256 !== media.sha256 ||
          c.mime_type !== media.mime_type || c.size !== media.size || c.width !== media.width || c.height !== media.height) fail("UPLOAD_OUTCOME_UNKNOWN");
      const now = this.#time(); if (this.#entries.size >= MAX_RECORDS || now > Number.MAX_SAFE_INTEGER - TTL) fail("CAPACITY_EXCEEDED");
      const handle = "wan27i2v_image_" + randomUUID(), entry: Entry = Object.freeze({ handle, attempt: request.attemptId,
        model: "wan_27_i2v", principal, client, epoch, expires: now + TTL, context, destination: this.#destination,
        filename: media.filename, mime: media.mime_type, size: media.size, sha256: media.sha256, width: media.width, height: media.height, semantic });
      this.#entries.set(handle,entry); this.#knownSemantics.set(semantic,handle); published=true;
      return imageReceipt(entry);
    } catch (error) {
      if (error instanceof OwnerWan27I2vReferenceServiceError) throw error;
      return fail(invoked ? "UPLOAD_OUTCOME_UNKNOWN" : signal.aborted ? "REQUEST_ABORTED" : "VALIDATION_REJECTED");
    } finally {
      if (semantic) {
        this.#pendingSemantics.delete(semantic);
        if (invoked && !published) this.#unknownSemantics.add(semantic);
      }
      readCopy?.fill(0); if (validated) releaseValidatedOwnerWan27I2vImage(validated); request.bytes.fill(0);
    }
  }
  #time(): number {
    let value: unknown; try { value = this.#now(); } catch { return fail("CLOCK_INVALID"); }
    if (!Number.isSafeInteger(value) || (value as number) < this.#lastNow) return fail("CLOCK_INVALID"); this.#lastNow = value as number; return value as number;
  }
}
Object.freeze(OwnerWan27I2vReferenceService.prototype);
export function isOwnerWan27I2vReferenceService(value: unknown): value is OwnerWan27I2vReferenceService {
  return !!value && typeof value === "object" && !types.isProxy(value) && SERVICES.has(value) &&
    Object.getPrototypeOf(value) === OwnerWan27I2vReferenceService.prototype && Object.isFrozen(value);
}
interface UploadSnapshot { readonly attemptId: string; readonly filename: string; readonly mime: OwnerWan27I2vImageSourceMimeType; readonly bytes: Buffer; }
function snapshotUpload(input: unknown): UploadSnapshot {
  const f = exact(input, ["attemptId", "model_id", "filename", "mime_type", "bytes"]);
  if (typeof f.attemptId !== "string" || !ATTEMPT.test(f.attemptId) || f.model_id !== "wan_27_i2v" ||
      typeof f.filename !== "string" || !f.filename || Buffer.byteLength(f.filename,"utf8") > 255 ||
      typeof f.mime_type !== "string" || !(OWNER_WAN27_I2V_IMAGE_POLICY.source_mime_types as readonly string[]).includes(f.mime_type) ||
      !(f.bytes instanceof Uint8Array) || types.isProxy(f.bytes)) fail("INVALID_REQUEST");
  return { attemptId: f.attemptId, filename: f.filename, mime: f.mime_type as OwnerWan27I2vImageSourceMimeType, bytes: Buffer.from(f.bytes) };
}
function binding(value: unknown): Readonly<AuthBinding> {
  const f = exact(value,["tenant_id","subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id || typeof f.subject !== "string" || !f.subject) fail("INVALID_REQUEST");
  return Object.freeze({tenant_id:f.tenant_id,subject:f.subject});
}
function isLinks(value: unknown): boolean {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === PerUserLinkService.prototype &&
    Reflect.get(value,"getStatus") === LINK_STATUS;
}
function isExactClient(value: unknown): value is NativeWan27I2vUploadClient {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    Reflect.get(value,"uploadOwnerWan27I2vImage") === NATIVE_UPLOAD;
}
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if (keys.some(k => typeof k !== "string" || (!required.includes(k) && !optional.includes(k)) ||
      !Object.hasOwn(d[k]!,"value") || d[k]!.enumerable !== true) || required.some(k => !Object.hasOwn(d,k))) fail("INVALID_REQUEST");
  const out = Object.create(null) as Record<string,unknown>; for (const k of keys as string[]) out[k]=d[k]!.value; return out;
}
function fail(code: string): never { throw new OwnerWan27I2vReferenceServiceError(code); }
function imageReceipt(entry: Entry): OwnerWan27I2vImageReceipt {
  return Object.freeze({ status: "uploaded", image_handle: entry.handle, model_id: entry.model, filename: entry.filename,
    mime_type: entry.mime, size: entry.size, sha256: entry.sha256, width: entry.width, height: entry.height,
    expires_in_seconds: 900,
    metadata_confidence: "STRUCTURALLY_VALIDATED_NOT_PIXEL_DECODED", provider_acceptance: "UNPROVEN", generation_permit: false });
}
